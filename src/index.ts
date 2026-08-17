import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context } from "grammy";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isAllowed, loadConfig, loadEnvFile, type Config } from "./config.js";
import { PiController } from "./pi.js";
import { TelegramStreamer } from "./stream.js";
import { COMMANDS, HELP_TEXT, startText } from "./commands.js";
import {
  escapeHtml,
  handleCallback,
  listProjects,
  mainMenu,
  modelMenu,
  msg,
  statusText,
} from "./menu.js";

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
  });
  streamer = s;
  return s;
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
  await pi.resumeSession(found.path, found.cwd);
  await ctx.reply(`✅ Oturum açıldı: ${escapeHtml(found.firstMessage || "(isimsiz)")}\n📁 <code>${found.cwd}</code>`, {
    parse_mode: "HTML",
  });
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
  await handleCallback(ctx, pi, config.workspaceRoot);
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
