import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context } from "grammy";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isAllowed, loadConfig, loadEnvFile, type Config } from "./config.js";
import { PiController } from "./pi.js";
import { TelegramStreamer } from "./stream.js";
import { HELP_TEXT, startText } from "./commands.js";

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
  await ctx.reply(startText(pi.cwd, true), { parse_mode: "HTML" });
});

bot.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
});

bot.command("status", async (ctx) => {
  const file = pi.sessionFile ?? "(yok)";
  await ctx.reply(
    `📁 cwd: <code>${pi.cwd}</code>\n` +
      `🧠 model: <code>${pi.modelLabel}</code>\n` +
      `📄 session: <code>${file}</code>\n` +
      `⏳ streaming: ${pi.isStreaming ? "evet" : "hayır"}`,
    { parse_mode: "HTML" },
  );
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
  const lines = sessions
    .slice(-15)
    .reverse()
    .map((s) => `<code>${s.id.slice(0, 8)}</code> — ${escapeHtml(s.firstMessage) || "(boş)"}`);
  await ctx.reply(`📚 Son oturumlar:\n${lines.join("\n")}\n\n/resume &lt;id&gt; ile aç`, {
    parse_mode: "HTML",
  });
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
  await pi.resumeSession(found.path);
  await ctx.reply(`✅ Oturum açıldı: ${found.firstMessage || "(isimsiz)"}`);
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
    await ctx.reply(`❌ Dizin yok: <code>${target}</code>`, { parse_mode: "HTML" });
    return;
  }
  try {
    await pi.openInCwd(target);
    await ctx.reply(`✅ cwd → <code>${target}</code>`, { parse_mode: "HTML" });
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

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const stream = startStream(ctx.chat.id);
  try {
    await pi.prompt(text);
  } catch (err) {
    stream.fail(err);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  await pi.init();
  console.log(`[zoria-telegram-pi] hazır | cwd=${pi.cwd} | model=${pi.modelLabel}`);
  console.log(`[zoria-telegram-pi] yetkili kullanıcılar: ${config.allowedIds.join(", ")}`);
  bot.catch((err) => console.error("[bot] hata:", err.error));
  await bot.start({ onStart: () => console.log("[zoria-telegram-pi] bot çalışıyor ✓") });
}

main().catch((err) => {
  console.error("[zoria-telegram-pi] başlatma hatası:", err);
  process.exit(1);
});
