import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_TEXT } from "./commands.js";
import type { HistoryEntry, PiController, SessionInfo, SessionSummary } from "./pi.js";
import { listServices, restartService, serviceLine, type ServiceInfo } from "./services.js";

/** Callback data prefix'leri (64 byte limiti içinde). */
const CB = {
  main: "m:main",
  cats: "m:cats",
  list: "m:list:", // m:list:<catIdx>:<page>
  cd: "cd:", // cd:<projeAdı>
  sess: "m:sess",
  resume: "rs:", // rs:<id8>
  resumeForce: "rsf:", // rsf:<id8> — aktiflik uyarısını geç
  new: "act:new",
  abort: "act:abort",
  status: "act:status",
  help: "act:help",
  root: "act:root",
  model: "mdl:main",
  modelPick: "mdl:pick:", // mdl:pick:<provider>/<id>
  modelAll: "mdl:all:", // mdl:all:<page>
  svcList: "svc:list",
  svcRestart: "svc:restart:", // svc:restart:<name>
} as const;

/** DNA yasak listesi — bu modeller asla önerilmez/gösterilmez. */
const FORBIDDEN_MODELS = new Set([
  "ts9/deepseek-v4-flash",
  "ts9/deepseek-v4-flash-0731",
  "ts9/deepseek-v4-pro-0813",
  "ts9/qwen3.8-max",
]);

/** Kısayol model prefix'leri (önerilen). */
const QUICK_MODEL_PREFIXES = ["zai/", "ts9/deepseek-v4-pro", "ts9/iamhc/DeepSeek-V4-Pro"];

const MODEL_PAGE_SIZE = 4;

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
    .text("🧠 Model", CB.model)
    .text("🛠 Servisler", CB.svcList)
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

/** Model menüsü: kısayollar + tüm modeller kapısı. */
export function modelMenu(
  pi: PiController,
  models: Array<{ provider: string; id: string }>,
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  const quick = models.filter((m) => {
    const ref = `${m.provider}/${m.id}`;
    if (FORBIDDEN_MODELS.has(ref)) return false;
    return QUICK_MODEL_PREFIXES.some((p) => ref.startsWith(p));
  });
  const rows: Array<Array<{ ref: string; label: string }>> = [];
  let current = -1;
  for (const m of quick) {
    const ref = `${m.provider}/${m.id}`;
    const label = m.provider === "zai" ? m.id : ref;
    if (current === -1 || rows[current]!.length >= 2) {
      rows.push([]);
      current += 1;
    }
    rows[current]!.push({ ref, label });
  }
  for (const row of rows) {
    kb.add(...row.map((b) => InlineKeyboard.text(b.label, `${CB.modelPick}${b.ref}`))).row();
  }
  kb.text(`🔍 Tüm modeller (${models.length})`, `${CB.modelAll}0`).row();
  kb.add(...backRow().inline_keyboard[0]!);
  return {
    text: `🧠 <b>Model</b> — mevcut: <code>${pi.modelLabel}</code>\n\nSeç: (akış sırasında değişmez, önce /abort)`,
    kb,
  };
}

/** Tüm modeller — sayfalı liste. */
export function allModelsMenu(
  models: Array<{ provider: string; id: string }>,
  page: number,
): { text: string; kb: InlineKeyboard } {
  const totalPages = Math.max(1, Math.ceil(models.length / MODEL_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const items = models.slice(safePage * MODEL_PAGE_SIZE, (safePage + 1) * MODEL_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const m of items) {
    const ref = `${m.provider}/${m.id}`;
    if (FORBIDDEN_MODELS.has(ref)) continue;
    kb.text(ref, `${CB.modelPick}${ref}`).row();
  }
  kb.row();
  if (safePage > 0) kb.text("◀️", `${CB.modelAll}${safePage - 1}`);
  kb.text(`📋 ${safePage + 1}/${totalPages}`, `${CB.modelAll}${safePage}`);
  if (safePage < totalPages - 1) kb.text("▶️", `${CB.modelAll}${safePage + 1}`);
  kb.row().text("◀️ Model menüsü", CB.model).row();
  kb.add(...backRow().inline_keyboard[0]!);
  return {
    text: `🔍 <b>Tüm modeller</b> (${models.length}) — sayfa ${safePage + 1}/${totalPages}:`,
    kb,
  };
}

/** Session özeti render'ı: ilk + son mesajlar, ~3000 char bütçe. */
export function formatSessionSummary(summary: SessionSummary): string {
  if (summary.total === 0) return "";
  const first = summary.first;
  const last = summary.last;
  const msgs = [...first, ...last];
  const overhead = 90; // başlık + "⋯" + satır boşlukları
  const maxMsg = Math.max(80, Math.floor((SUMMARY_BUDGET - overhead) / Math.max(1, msgs.length)));
  const fmt = (h: HistoryEntry): string => {
    const cut = h.text.length > maxMsg ? h.text.slice(0, maxMsg) + " …" : h.text;
    return `${h.role === "user" ? "👤" : "🤖"}: ${escapeHtml(cut)}`;
  };
  const parts: string[] = [];
  for (const h of first) parts.push(fmt(h));
  if (summary.total > first.length + last.length) parts.push("⋯");
  for (const h of last) parts.push(fmt(h));
  return `\n\n📜 <b>Konuşma</b> (${summary.total} mesaj):\n${parts.join("\n")}`;
}

const SUMMARY_BUDGET = 3000;

/** Oturum menüsü — bot + pi oturumları butonlu. */
export function sessionsMenu(sessions: SessionInfo[]): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  const recent = sessions.slice(0, 8); // listSessions zaten en yeni önce sıralar
  if (recent.length === 0) {
    return {
      text: "Henüz oturum yok — 🆕 ile başla.",
      kb: new InlineKeyboard().text("🆕 Yeni oturum", CB.new).row().add(...backRow().inline_keyboard[0]!),
    };
  }
  recent.forEach((s, i) => {
    if (i % 2 === 0 && i > 0) kb.row();
    const icon = s.source === "pi" ? "🧑" : "🤖";
    const where = s.cwd === "/home/workspace" ? "~" : s.cwd.split("/").pop() ?? "?";
    const label = `${icon} ${s.id.slice(0, 8)} · ${where} · ${(s.firstMessage || "boş").slice(0, 12)}`;
    kb.text(label, `${CB.resume}${s.id.slice(0, 8)}`);
  });
  kb.row().text("🆕 Yeni oturum", CB.new).row();
  kb.add(...backRow().inline_keyboard[0]!);
  const botCount = sessions.filter((s) => s.source === "bot").length;
  const piCount = sessions.filter((s) => s.source === "pi").length;
  return {
    text: `📚 <b>Oturumlar</b> — 🤖 bot ${botCount} · 🧑 pi ${piCount}\n\n🤖 = bot'un, 🧑 = senin pi oturumların (devralma):`,
    kb,
  };
}

/** Servis menüsü — tüm Zo servisleri durum + restart butonu. */
export function servicesMenu(services: ServiceInfo[]): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  services.forEach((s, i) => {
    if (i % 2 === 0 && i > 0) kb.row();
    kb.text(`🔄 ${s.name}`, `${CB.svcRestart}${s.name}`);
  });
  kb.row();
  kb.add(...backRow().inline_keyboard[0]!);
  const lines = services.map(serviceLine);
  return {
    text: `🛠 <b>Zo Servisleri</b> (${services.length}):\n\n${lines.join("\n")}\n\nRestart için butona dokun:`,
    kb,
  };
}

/** Callback query'leri işler. ctx.editMessageText ile mevcut mesajı günceller. */
export async function handleCallback(
  ctx: Context,
  pi: PiController,
  workspaceRoot: string,
  supervisorConf: string,
  onAbort?: () => void,
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
  if (data.startsWith(CB.resume) || data.startsWith(CB.resumeForce)) {
    const force = data.startsWith(CB.resumeForce);
    const id = (force ? data.slice(CB.resumeForce.length) : data.slice(CB.resume.length)).slice(0, 8);
    const sessions = await pi.listSessions();
    const found = sessions.find((s) => s.id.startsWith(id));
    if (!found) {
      await edit(`❌ Oturum bulunamadı: ${id}`);
      return;
    }
    if (!force && pi.isSessionActive(found.path)) {
      const kb = new InlineKeyboard()
        .text("⚠️ Yine de devral", `${CB.resumeForce}${id}`)
        .row()
        .add(...backRow().inline_keyboard[0]!);
      await edit(
        `⚠️ Bu oturum <b>şu an başka yerde aktif</b> görünüyor (son yazma birkaç dakika içinde).\n\nDevralırsan iki yer aynı anda yazabilir ve konuşma dalları karışabilir.\n\nÖnce pi'deki o sohbeti kapat, sonra devral.`,
        kb,
      );
      return;
    }
    await pi.resumeSession(found.path, found.cwd);
    const m = mainMenu();
    const who = found.source === "pi" ? "🧑 pi oturumu" : "🤖 bot oturumu";
    const summary = pi.getSessionSummary(found.path, 3, 5);
    await edit(
      `✅ ${who} açıldı: ${escapeHtml(found.firstMessage || "(isimsiz)")}\n📁 <code>${found.cwd}</code>${formatSessionSummary(summary)}\n\nDevam etmek için yaz 👇`,
      m.kb,
    );
    return;
  }
  if (data === CB.new) {
    await pi.newSession();
    const m = mainMenu();
    await edit(`✅ Yeni oturum açıldı (<code>${pi.cwd}</code>)`, m.kb);
    return;
  }
  if (data === CB.abort) {
    onAbort?.();
    const was = pi.isStreaming;
    if (was) await pi.abort();
    const m = mainMenu();
    await edit(`⏹️ ${was ? "İptal edildi." : "Şu an çalışan bir iş yok."}\n\n${m.text}`, m.kb);
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
  if (data === CB.model) {
    const m = modelMenu(pi, await pi.listAvailableModels());
    await edit(m.text, m.kb);
    return;
  }
  if (data.startsWith(CB.modelPick)) {
    const ref = data.slice(CB.modelPick.length);
    try {
      const id = await pi.setModelByRef(ref);
      const m = modelMenu(pi, await pi.listAvailableModels());
      await edit(`✅ Model → <code>${escapeHtml(id)}</code>`, m.kb);
    } catch (err) {
      await edit(`❌ ${escapeHtml(msg(err))}`);
    }
    return;
  }
  if (data.startsWith(CB.modelAll)) {
    const page = Number(data.slice(CB.modelAll.length)) || 0;
    const m = allModelsMenu(await pi.listAvailableModels(), page);
    await edit(m.text, m.kb);
    return;
  }
  if (data === CB.svcList) {
    try {
      const m = servicesMenu(listServices(supervisorConf));
      await edit(m.text, m.kb);
    } catch (err) {
      await edit(`❌ ${escapeHtml(msg(err))}`);
    }
    return;
  }
  if (data.startsWith(CB.svcRestart)) {
    const name = data.slice(CB.svcRestart.length);
    try {
      await ctx.answerCallbackQuery({ text: `🔄 ${name} yeniden başlatılıyor...` });
      const result = restartService(supervisorConf, name);
      const m = servicesMenu(listServices(supervisorConf));
      await edit(`✅ <code>${name}</code> yeniden başlatıldı — ${escapeHtml(result)}\n\n${m.text}`, m.kb);
    } catch (err) {
      await edit(`❌ ${escapeHtml(msg(err))}`);
    }
    return;
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
