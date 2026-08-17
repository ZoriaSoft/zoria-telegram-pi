import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface Config {
  botToken: string;
  allowedIds: number[];
  workspaceRoot: string;
  piModel: string | undefined;
  sessionDir: string;
}

/** Minimal .env loader (dotenv bağımlılığı yok). .env'deki değerler process.env'yi ezer — proje config'i global env'den önceliklidir. */
export function loadEnvFile(path = ".env"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return; // .env yok — ortam değişkenlerinden okunur
  }
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("BOT_TOKEN eksik — .env dosyasına BotFather token'ını yaz");
  }

  const allowedIds = (env.ALLOWED_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (allowedIds.length === 0) {
    throw new Error("ALLOWED_IDS eksik — kendi Telegram user_id'nizi virgülle yaz");
  }

  const workspaceRoot = resolve(env.WORKSPACE_ROOT?.trim() || process.cwd());

  return {
    botToken,
    allowedIds,
    workspaceRoot,
    piModel: env.PI_MODEL?.trim() || undefined,
    sessionDir: resolve(homedir(), ".pi", "agent", "telegram-sessions"),
  };
}

export function isAllowed(fromId: number | undefined, allowedIds: number[]): boolean {
  return typeof fromId === "number" && allowedIds.includes(fromId);
}
