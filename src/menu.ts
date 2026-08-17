import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_TEXT } from "./commands.js";
import type { PiController } from "./pi.js";

/** Callback data prefix'leri (64 byte limiti içinde). */
const CB = {
  main: "m:main",
  cats: "m:cats",
  list: "m:list:", // m:list:<catIdx>:<page>
  cd: "cd:", // cd:<projeAdı>
  sess: "m:sess",
  resume: "rs:", // rs:<id8>
  new: "act:new",
  abort: "act:abort",
  status: "act:status",
  help: "act:help",
  root: "act:root",
} as const;

const PAGE_SIZE = 6;

/** Kategori kuralları — yeni projeler otomatik kategorize olur. */
const CATEGORY_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "🎮 Oyun", re: /^(grok-|zoria-okey|isometric-|napkin-)/ },
  { name: "⚙️ Servis", re: /^(nvidia|zoria-auth|zoria-autoflow|zoria-cloudflare-|zoria-platform)/ },
  { name: "📡 Medya", re: /^(cloudflare-mail|zoria-mail|zoria-radio|zoria-stream)/ },
  { name: "📄 PDF", re: /^zoriapdf/ },
  { name: "🌐 Web/UI", re: /^(zoria-ui|zoriaconverter|zoriaguide|zorianews|zoriashield|zoriatools)/ },
];

export function listProjects(workspaceRoot: string): string[] {
  return readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "C:")
    .map((d) => d.name)
    .sort();
}

/** Projeleri kategori listesine ayırır: her kategori için proje adları. */
export function categorize(projects: string[]): Array<{ name: string; items: string[] }> {
  const cats = CATEGORY_RULES.map((r) => ({ name: r.name, items: [] as string[] }));
  const other = { name: "📦 Diğer", items: [] as string[] };
  for (const p of projects) {
    const hit = CATEGORY_RULES.findIndex((r) => r.re.test(p));
    if (hit >= 0) cats[hit]!.items.push(p);
    else other.items.push(p);
  }
  const result = cats.filter((c) => c.items.length > 0);
  if (other.items.length > 0) result.push(other);
  return result;
}

function backRow(): InlineKeyboard {
  return new InlineKeyboard().text("◀️ Ana menü", CB.main);
}

export function mainMenu(): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard()
    .text("📁 Projeler", CB.cats)
    .text("📚 Oturumlar", CB.sess)
    .row()
    .text("🆕 Yeni oturum", CB.new)
    .text("⏹️ İptal", CB.abort)
    .row()
    .text("⚙️ Durum", CB.status)
    .text("ℹ️ Yardım", CB.help);
  return { text: "🗂 <b>Menü</b> — ne yapmak istersin?", kb };
}

export function categoryMenu(projects: string[]): { text: string; kb: InlineKeyboard } {
  const cats = categorize(projects);
  const kb = new InlineKeyboard();
  for (let i = 0; i < cats.length; i += 2) {
    const row = [cats[i]!];
    if (cats[i + 1]) row.push(cats[i + 1]!);
    const btnRow = row.map((c) => InlineKeyboard.text(`${c.name} · ${c.items.length}`, `${CB.list}${cats.indexOf(c)}:0`));
    kb.add(...btnRow).row();
  }
  kb.add(...backRow().inline_keyboard[0]!);
  return { text: `📂 <b>Projeler</b> (${projects.length}) — kategoriden seç:`, kb };
}

export function projectListMenu(
  cats: Array<{ name: string; items: string[] }>,
  catIdx: number,
  page: number,
): { text: string; kb: InlineKeyboard } {
  const cat = cats[catIdx]!;
  const totalPages = Math.max(1, Math.ceil(cat.items.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const items = cat.items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const kb = new InlineKeyboard();
  items.forEach((name, i) => {
    if (i % 3 === 0 && i > 0) kb.row();
    kb.text(name, `${CB.cd}${name}`);
  });
  kb.row();
  if (safePage > 0) kb.text("◀️", `${CB.list}${catIdx}:${safePage - 1}`);
  kb.text(`📋 ${safePage + 1}/${totalPages}`, `${CB.list}${catIdx}:${safePage}`);
  if (safePage < totalPages - 1) kb.text("▶️", `${CB.list}${catIdx}:${safePage + 1}`);
  kb.row();
  kb.add(...backRow().inline_keyboard[0]!);

  return {
    text: `📂 <b>${cat.name}</b> — proje seç (sayfa ${safePage + 1}/${totalPages}):`,
    kb,
  };
}

export function sessionsMenu(sessions: Array<{ id: string; firstMessage: string }>): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  const recent = sessions.slice(-8).reverse();
  if (recent.length === 0) {
    return {
      text: "Henüz oturum yok — 🆕 ile başla.",
      kb: new InlineKeyboard().text("🆕 Yeni oturum", CB.new).row().add(...backRow().inline_keyboard[0]!),
    };
  }
  recent.forEach((s, i) => {
    if (i % 2 === 0 && i > 0) kb.row();
    const label = `${s.id.slice(0, 8)} · ${(s.firstMessage || "boş").slice(0, 18)}`;
    kb.text(label, `${CB.resume}${s.id.slice(0, 8)}`);
  });
  kb.row().text("🆕 Yeni oturum", CB.new).row();
  kb.add(...backRow().inline_keyboard[0]!);
  return {
    text: `📚 <b>Oturumlar</b> (${sessions.length}) — açılacak oturumu seç:`,
    kb,
  };
}

/** Callback query'leri işler. ctx.editMessageText ile mevcut mesajı günceller. */
export async function handleCallback(
  ctx: Context,
  pi: PiController,
  workspaceRoot: string,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const edit = (text: string, kb?: InlineKeyboard): Promise<unknown> =>
    ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...(kb ? { reply_markup: kb } : {}),
    });

  if (data === CB.main) {
    const m = mainMenu();
    await edit(m.text, m.kb);
    return;
  }
  if (data === CB.cats) {
    const m = categoryMenu(listProjects(workspaceRoot));
    await edit(m.text, m.kb);
    return;
  }
  if (data.startsWith(CB.list)) {
    const parts = data.slice(CB.list.length).split(":");
    const cats = categorize(listProjects(workspaceRoot));
    const m = projectListMenu(cats, Number(parts[0]) || 0, Number(parts[1]) || 0);
    await edit(m.text, m.kb);
    return;
  }
  if (data.startsWith(CB.cd)) {
    const name = data.slice(CB.cd.length);
    await ctx.answerCallbackQuery({ text: `📂 ${name} açılıyor...` });
    try {
      await pi.openInCwd(resolve(workspaceRoot, name));
      const m = mainMenu();
      await edit(`✅ cwd → <code>${name}</code>\n\nNe yapmak istersin?`, m.kb);
    } catch (err) {
      await edit(`❌ Proje açılamadı: ${msg(err)}`);
    }
    return;
  }
  if (data === CB.sess) {
    const sessions = await pi.listSessions();
    const m = sessionsMenu(sessions);
    await edit(m.text, m.kb);
    return;
  }
  if (data.startsWith(CB.resume)) {
    const id = data.slice(CB.resume.length);
    const sessions = await pi.listSessions();
    const found = sessions.find((s) => s.id.startsWith(id));
    if (!found) {
      await edit(`❌ Oturum bulunamadı: ${id}`);
      return;
    }
    await pi.resumeSession(found.path);
    const m = mainMenu();
    await edit(`✅ Oturum açıldı: ${escapeHtml(found.firstMessage || "(isimsiz)")}`, m.kb);
    return;
  }
  if (data === CB.new) {
    await pi.newSession();
    const m = mainMenu();
    await edit(`✅ Yeni oturum açıldı (<code>${pi.cwd}</code>)`, m.kb);
    return;
  }
  if (data === CB.abort) {
    const was = pi.isStreaming;
    if (was) await pi.abort();
    await edit(was ? "⏹️ İptal edildi." : "Şu an çalışan bir iş yok.");
    return;
  }
  if (data === CB.status) {
    await edit(statusText(pi));
    return;
  }
  if (data === CB.help) {
    await edit(HELP_TEXT);
    return;
  }
  if (data === CB.root) {
    await pi.openInCwd(workspaceRoot);
    const m = mainMenu();
    await edit(`✅ cwd → <code>${workspaceRoot}</code>`, m.kb);
  }
}

export function statusText(pi: PiController): string {
  const file = pi.sessionFile ?? "(yok)";
  return (
    `📁 cwd: <code>${pi.cwd}</code>\n` +
    `🧠 model: <code>${pi.modelLabel}</code>\n` +
    `📄 session: <code>${file}</code>\n` +
    `⏳ streaming: ${pi.isStreaming ? "evet" : "hayır"}`
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
