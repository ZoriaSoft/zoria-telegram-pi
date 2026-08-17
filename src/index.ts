import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isAllowed, loadConfig, loadEnvFile, type Config } from "./config.js";
import { PiController } from "./pi.js";
import { TelegramStreamer } from "./stream.js";
import { COMMANDS, HELP_TEXT, startText } from "./commands.js";
import {
  escapeHtml,
  formatSessionSummary,
  handleCallback,
  listProjects,
  mainMenu,
  modelMenu,
  msg,
  servicesMenu,
  statusText,
} from "./menu.js";
import { listServices } from "./services.js";

loadEnvFile();

const config: Config = loadConfig();
const pi = new PiController({
  workspaceRoot: config.workspaceRoot,
  sessionDir: config.sessionDir,
  model: config.piModel,
});

const bot = new Bot<Context>(config.botToken);
bot.api.config.use(autoRetry({ maxRetryAttempts: 3 }));

/** Güvenlik: whitelist dışı mesajları görmezden gel. */
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (!isAllowed(fromId, config.allowedIds)) {
    return; // yetkisiz kullanıcı — sessizce yut
  }
  await next();
});

/** Aktif streamer — her prompt için yeniden kurulur. */
let streamer: TelegramStreamer | null = null;

/** Pi event'lerini aktif streamer'a yönlendir. */
pi.onSessionChanged(() => {
  pi.subscribe((event) => {
    if (!streamer) return;
    streamer.handleEvent(event);
  });
});

function startStream(chatId: number): TelegramStreamer {
  streamer?.finish();
  const s = new TelegramStreamer(chatId, bot.api);
  s.onClose(() => {
    if (streamer === s) streamer = null;
    // Uzun/tool'lu işlerde bitiş özeti (kısa cevaplarda spam yapma)
    const { durationMs, toolCount } = s.getStats();
    if (toolCount > 0 || durationMs > 20_000) {
      bot.api
        .sendMessage(chatId, `✅ İş tamamlandı · ${Math.round(durationMs / 1000)}sn · ${toolCount} tool çağrısı`)
        .catch(() => {});
    }
  });
  streamer = s;
  return s;
}

/** Telegram dosya sunucusundan indirir. */
async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`indirme hatası: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Dosya adını güvenli hale getirir (path traversal engeli). */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/]/g, "_").replace(/\.\./g, "_").trim();
  return cleaned || `dosya_${Date.now()}`;
}

bot.command("start", async (ctx) => {
  const m = mainMenu();
  await ctx.reply(startText(pi.cwd), { parse_mode: "HTML", reply_markup: m.kb });
});

bot.command("menu", async (ctx) => {
  const m = mainMenu();
  await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.kb });
});

bot.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
});

bot.command("status", async (ctx) => {
  await ctx.reply(statusText(pi), { parse_mode: "HTML" });
});

bot.command("model", async (ctx) => {
  const m = modelMenu(pi, await pi.listAvailableModels());
  await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.kb });
});

bot.command("services", async (ctx) => {
  try {
    const m = servicesMenu(listServices(config.supervisorConf));
    await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.kb });
  } catch (err) {
    await ctx.reply(`❌ ${msg(err)}`);
  }
});

bot.command("new", async (ctx) => {
  await pi.newSession();
  await ctx.reply(`✅ Yeni oturum açıldı (${pi.cwd})`);
});

bot.command("list", async (ctx) => {
  const sessions = await pi.listSessions();
  if (sessions.length === 0) {
    await ctx.reply("Henüz oturum yok.");
    return;
  }
  const botSessions = sessions.filter((s) => s.source === "bot").slice(0, 10);
  const piSessions = sessions.filter((s) => s.source === "pi").slice(0, 15);
  const fmt = (s: { id: string; firstMessage: string; cwd: string; source: "bot" | "pi" }): string => {
    const where = s.cwd === "/home/workspace" ? "~" : s.cwd.split("/").pop() ?? "?";
    return `<code>${s.id.slice(0, 8)}</code> · ${where} — ${escapeHtml(s.firstMessage) || "(boş)"}`;
  };
  const lines: string[] = [];
  if (botSessions.length > 0) lines.push("🤖 <b>Bot oturumları:</b>\n" + botSessions.map(fmt).join("\n"));
  if (piSessions.length > 0) lines.push("🧑 <b>Pi oturumların:</b>\n" + piSessions.map(fmt).join("\n"));
  await ctx.reply(`📚 ${lines.join("\n\n")}\n\n/resume &lt;id&gt; ile aç`, { parse_mode: "HTML" });
});

bot.command("resume", async (ctx) => {
  const id = ctx.match.trim();
  if (!id) {
    await ctx.reply("Kullanım: /resume <id> — id'yi /list'ten al.");
    return;
  }
  const sessions = await pi.listSessions();
  const found = sessions.find((s) => s.id.startsWith(id));
  if (!found) {
    await ctx.reply(`❌ "${id}" ile başlayan oturum bulunamadı.`);
    return;
  }
  if (pi.isSessionActive(found.path)) {
    const kb = new InlineKeyboard()
      .text("⚠️ Yine de devral", `rsf:${found.id.slice(0, 8)}`)
      .row()
      .text("◀️ Vazgeç", "m:sess");
    await ctx.reply(
      `⚠️ Bu oturum <b>şu an başka yerde aktif</b> görünüyor (son yazma birkaç dakika içinde).\n\nDevralırsan iki yer aynı anda yazabilir ve konuşma dalları karışabilir.\n\nÖnce pi'deki o sohbeti kapat, sonra devral.`,
      { parse_mode: "HTML", reply_markup: kb },
    );
    return;
  }
  await pi.resumeSession(found.path, found.cwd);
  const summary = pi.getSessionSummary(found.path, 3, 5);
  await ctx.reply(
    `✅ Oturum açıldı: ${escapeHtml(found.firstMessage || "(isimsiz)")}\n📁 <code>${found.cwd}</code>${formatSessionSummary(summary)}\n\nDevam etmek için yaz 👇`,
    { parse_mode: "HTML" },
  );
});

bot.command("cd", async (ctx) => {
  const arg = ctx.match.trim();
  if (!arg) {
    await ctx.reply(`Kullanım: /cd <proje>\nMevcut: <code>${pi.cwd}</code>`, {
      parse_mode: "HTML",
    });
    return;
  }
  const target = arg === "~" ? config.workspaceRoot : resolve(config.workspaceRoot, arg);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    // Kısmi ad tamamlaması: startsWith eşleşen tek proje varsa onu kullan
    const matches = listProjects(config.workspaceRoot).filter(
      (p) => p.startsWith(arg) || p.includes(arg),
    );
    if (matches.length === 1) {
      const m = mainMenu();
      await ctx.reply(`📂 <code>${matches[0]}</code> açılıyor...`, { parse_mode: "HTML" });
      try {
        await pi.openInCwd(resolve(config.workspaceRoot, matches[0]!));
        await ctx.reply(`✅ cwd → <code>${matches[0]}</code>\n\nNe yapmak istersin?`, {
          parse_mode: "HTML",
          reply_markup: m.kb,
        });
      } catch (err) {
        await ctx.reply(`❌ Proje açılamadı: ${msg(err)}`);
      }
      return;
    }
    if (matches.length > 1) {
      await ctx.reply(
        `❌ "<code>${escapeHtml(arg)}</code>" belirsiz — eşleşenler:\n` +
          matches.map((p) => `• ${p}`).join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    await ctx.reply(`❌ Dizin yok: <code>${target}</code>`, { parse_mode: "HTML" });
    return;
  }
  try {
    await pi.openInCwd(target);
    const m = mainMenu();
    await ctx.reply(`✅ cwd → <code>${target}</code>\n\nNe yapmak istersin?`, {
      parse_mode: "HTML",
      reply_markup: m.kb,
    });
  } catch (err) {
    await ctx.reply(`❌ cwd değiştirilemedi: ${msg(err)}`);
  }
});

bot.command("abort", async (ctx) => {
  if (!pi.isStreaming) {
    await ctx.reply("Şu an çalışan bir iş yok.");
    return;
  }
  await pi.abort();
  await ctx.reply("⏹️ İptal edildi.");
});

/** Menü butonları. */
bot.on("callback_query:data", async (ctx) => {
  await handleCallback(ctx, pi, config.workspaceRoot, config.supervisorConf);
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const stream = startStream(ctx.chat.id);
  try {
    await pi.prompt(text);
  } catch (err) {
    stream.fail(err);
  }
});

/** 📸 Görsel → pi'ye vision prompt (vision destekli modellerde). */
bot.on("message:photo", async (ctx) => {
  const photo = [...ctx.message.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
  if (!photo) return;
  const caption = ctx.message.caption?.trim() || "Bu görseli incele ve özetle.";
  try {
    const file = await ctx.api.getFile(photo.file_id);
    if (!file.file_path) {
      await ctx.reply("❌ Dosya alınamadı.");
      return;
    }
    const buf = await downloadTelegramFile(file.file_path);
    const stream = startStream(ctx.chat.id);
    try {
      await pi.prompt(caption, [
        { type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" },
      ]);
    } catch (err) {
      stream.fail(err);
    }
  } catch (err) {
    await ctx.reply(`❌ Görsel işlenemedi: ${msg(err)}`);
  }
});

/** 📄 Dosya gönder → aktif cwd'ye kaydet. */
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const name = sanitizeFilename(doc.file_name ?? `dosya_${Date.now()}`);
  const sizeMb = (doc.file_size ?? 0) / (1024 * 1024);
  if (sizeMb > 45) {
    await ctx.reply(`❌ Dosya çok büyük (${sizeMb.toFixed(1)}MB) — 45MB sınırı.`);
    return;
  }
  try {
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) {
      await ctx.reply("❌ Dosya alınamadı.");
      return;
    }
    const buf = await downloadTelegramFile(file.file_path);
    const target = resolve(pi.cwd, name);
    await writeFile(target, buf);
    await ctx.reply(`✅ <code>${name}</code> (${(buf.length / 1024).toFixed(1)}KB) → <code>${pi.cwd}</code>`, {
      parse_mode: "HTML",
    });
  } catch (err) {
    await ctx.reply(`❌ Dosya kaydedilemedi: ${msg(err)}`);
  }
});

/** 📤 /send <dosya> — cwd'deki dosyayı Telegram'a gönder. */
bot.command("send", async (ctx) => {
  const arg = ctx.match.trim();
  if (!arg) {
    await ctx.reply(`Kullanım: /send <dosya>\nMevcut cwd: <code>${pi.cwd}</code>`, { parse_mode: "HTML" });
    return;
  }
  const cwd = resolve(pi.cwd);
  const target = resolve(cwd, arg);
  if (target !== cwd && !target.startsWith(cwd + "/")) {
    await ctx.reply("❌ cwd dışına erişim yasak.");
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    await ctx.reply(`❌ Dosya yok: <code>${target}</code>`, { parse_mode: "HTML" });
    return;
  }
  if (statSync(target).size > 45 * 1024 * 1024) {
    await ctx.reply("❌ Dosya 45MB sınırını aşıyor.");
    return;
  }
  try {
    await ctx.replyWithDocument(new InputFile(target), { caption: `📤 ${basename(target)}` });
  } catch (err) {
    await ctx.reply(`❌ Gönderilemedi: ${msg(err)}`);
  }
});

/** 📦 /zip [proje] — projeyi arşivleyip gönder (node_modules/.git/build hariç). */
bot.command("zip", async (ctx) => {
  const arg = ctx.match.trim();
  const base = arg ? resolve(pi.cwd, arg) : pi.cwd;
  if (!existsSync(base) || !statSync(base).isDirectory()) {
    await ctx.reply(`❌ Dizin yok: <code>${base}</code>`, { parse_mode: "HTML" });
    return;
  }
  const { spawnSync } = await import("node:child_process");
  const outPath = `/tmp/zoria-${Date.now()}.tar.gz`;
  const result = spawnSync(
    "tar",
    [
      "czf", outPath,
      "--exclude=node_modules", "--exclude=.git", "--exclude=build", "--exclude=.godot",
      "--exclude=dist", "--exclude=.import", "--exclude=*.log",
      "-C", dirname(base), basename(base),
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (result.status !== 0 || !existsSync(outPath)) {
    await ctx.reply(`❌ Arşiv oluşturulamadı: ${msg(result.stderr)}`);
    return;
  }
  if (statSync(outPath).size > 45 * 1024 * 1024) {
    await ctx.reply("❌ Arşiv 45MB sınırını aşıyor.");
    return;
  }
  try {
    await ctx.replyWithDocument(new InputFile(outPath), { caption: `📦 ${basename(base)}.tar.gz` });
  } catch (err) {
    await ctx.reply(`❌ Gönderilemedi: ${msg(err)}`);
  }
});

async function main(): Promise<void> {
  await pi.init();
  await bot.api.setMyCommands(COMMANDS);
  console.log(`[zoria-telegram-pi] hazır | cwd=${pi.cwd} | model=${pi.modelLabel}`);
  console.log(`[zoria-telegram-pi] yetkili kullanıcılar: ${config.allowedIds.join(", ")}`);
  bot.catch((err) => console.error("[bot] hata:", err.error));
  await bot.start({ onStart: () => console.log("[zoria-telegram-pi] bot çalışıyor ✓") });
}

main().catch((err) => {
  console.error("[zoria-telegram-pi] başlatma hatası:", err);
  process.exit(1);
});
