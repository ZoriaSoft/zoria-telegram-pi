import {
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  ModelRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai/compat";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import { readFileSync, readdirSync, statSync, writeFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface SessionInfo {
  id: string;
  path: string;
  firstMessage: string;
  cwd: string;
  source: "bot" | "pi";
}

export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
}

export interface SessionSummary {
  total: number;
  first: HistoryEntry[];
  last: HistoryEntry[];
}

export interface PiControllerOptions {
  workspaceRoot: string;
  sessionDir: string;
  /** Örn. "zai/glm-5.3" veya "ts9/deepseek-v4-pro" — boşsa pi default'u (settings). */
  model?: string;
}

/**
 * Pi SDK'sını yönetir: cwd-bound runtime aç/kapat, oturum geçişi,
 * prompt gönderim ve event akışı için tek subscribe noktası.
 */
export class PiController {
  readonly workspaceRoot: string;
  readonly sessionDir: string;
  private modelArg: string | undefined;
  private modelRuntime: ModelRuntime | null = null;
  private resolvedModel: Model<any> | undefined;
  private runtime: AgentSessionRuntime | null = null;
  private session: AgentSession | null = null;
  private currentCwd: string;
  private listeners = new Set<AgentSessionEventListener>();
  private onSessionChangedCb: (() => void) | null = null;

  constructor(opts: PiControllerOptions) {
    this.workspaceRoot = resolve(opts.workspaceRoot);
    this.sessionDir = opts.sessionDir;
    this.currentCwd = this.workspaceRoot;
    // Kalıcı model seçimi (disk'te) varsa onu kullan, yoksa config'ten
    this.modelArg = opts.model;
    try {
      const saved = readFileSync(resolve(this.sessionDir, "selected-model"), "utf8").trim();
      if (saved) this.modelArg = saved;
    } catch {
      // henüz seçim yok
    }
  }

  /** Başlangıç: workspace kökünde oturum açar (en son oturum devam eder). */
  async init(): Promise<void> {
    await this.openInCwd(this.workspaceRoot);
  }

  get cwd(): string {
    return this.currentCwd;
  }

  get activeSession(): AgentSession | null {
    return this.session;
  }

  get sessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  get modelLabel(): string {
    return this.session?.model?.id ?? "default";
  }

  /** Auth'lu modelleri listeler (deterministik sıra, canlı auth check).
   *  Session'a bağlı modelRuntime daralmış olabileceğinden bağımsız örnek kullanılır. */
  async listAvailableModels(): Promise<Array<{ provider: string; id: string }>> {
    const runtime = await ModelRuntime.create();
    const available = await runtime.getAvailable();
    return available
      .map((m) => ({ provider: m.provider, id: m.id }))
      .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
  }

  /** Model değiştir ("provider/id" referansı ile). */
  async setModelByRef(ref: string): Promise<string> {
    const slash = ref.indexOf("/");
    if (slash <= 0) throw new Error(`Geçersiz model referansı: ${ref}`);
    const provider = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    const session = this.session;
    if (!session) throw new Error("aktif session yok");
    if (session.isStreaming) {
      throw new Error("akış sırasında model değişmez — önce /abort");
    }
    this.modelRuntime ??= await ModelRuntime.create();
    const model = this.modelRuntime.getModel(provider, id);
    if (!model) throw new Error(`Model bulunamadı: ${ref}`);
    await session.setModel(model);
    // Kalıcı: seçim disk'e yazılır → restart sonrası da bu modelle başlar
    this.resolvedModel = model;
    try {
      writeFileSync(resolve(this.sessionDir, "selected-model"), ref, "utf8");
    } catch {
      // yazma hatası kritik değil
    }
    return model.id;
  }

  get isStreaming(): boolean {
    return this.session?.isStreaming ?? false;
  }

  /** Session değiştiğinde çağrılır (bot yeniden subscribe eder). */
  onSessionChanged(cb: () => void): void {
    this.onSessionChangedCb = cb;
  }

  private notifySessionChanged(): void {
    this.onSessionChangedCb?.();
  }

  /** Cwd değiştir + orada oturum aç (devam et). */
  async openInCwd(cwd: string): Promise<void> {
    const target = resolve(cwd);
    this.closeRuntime();
    this.currentCwd = target;

    this.modelRuntime ??= await ModelRuntime.create();
    if (!this.resolvedModel && this.modelArg) {
      const resolved = resolveCliModel({ cliModel: this.modelArg, modelRuntime: this.modelRuntime });
      if (resolved.error) {
        throw new Error(`PI_MODEL çözülemedi: ${resolved.error}`);
      }
      this.resolvedModel = resolved.model;
    }

    const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd, modelRuntime: this.modelRuntime! });
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model: this.resolvedModel,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    };

    const runtime = await createAgentSessionRuntime(factory, {
      cwd: target,
      agentDir: getAgentDir(),
      // Devam mantığı: bu cwd'nin en son session'ı varsa devam et, yoksa yeni aç
      sessionManager: latestSessionForCwd(this.sessionDir, target),
    });

    this.runtime = runtime;
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
  }

  /** Yeni boş oturum aç. Eski session dispose edilir (event çiftlenmesini önler). */
  async newSession(): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) throw new Error("runtime yok");
    const old = this.session;
    await runtime.newSession();
    this.disposeOldSession(old);
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
  }

  /** Belirli bir session dosyasını aç. Session'ın cwd'si farklıysa önce oraya geçer. */
  async resumeSession(sessionFile: string, cwd?: string): Promise<void> {
    if (cwd && resolve(cwd) !== resolve(this.currentCwd)) {
      await this.openInCwd(cwd); // runtime'ı session'ın çalıştığı dizine taşı
    }
    const runtime = this.runtime;
    if (!runtime) throw new Error("runtime yok");
    const old = this.session;
    await runtime.switchSession(sessionFile);
    this.disposeOldSession(old);
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
  }

  /** Eski session'ı güvenle kapatır (ayni session ise dokunmaz). */
  private disposeOldSession(old: AgentSession | null): void {
    if (old && old !== this.session) {
      try {
        old.dispose();
      } catch {
        // zaten kapalıysa sessizce geç
      }
    }
  }

  /** Aktif oturumu iptal et (akış sırasında). */
  async abort(): Promise<void> {
    await this.session?.abort();
  }

  subscribe(listener: AgentSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private attachListeners(): void {
    this.session?.subscribe((event) => {
      for (const listener of this.listeners) listener(event);
    });
  }

  /** Session dosyası son windowMs içinde yazıldıysa aktif sayılır (başka process çakışma riski). */
  isSessionActive(sessionFile: string, windowMs = 3 * 60_000): boolean {
    try {
      return Date.now() - statSync(sessionFile).mtimeMs < windowMs;
    } catch {
      return false; // dosya yok — aktif değil
    }
  }

  /** Session özeti: ilk 2 + son 4 mesaj (bağlam + nerede kaldın). */
  getSessionSummary(sessionFile: string, firstCount = 2, lastCount = 4): SessionSummary {
    const all = readSessionHistoryAll(sessionFile);
    const first = all.slice(0, firstCount);
    const last = all.slice(Math.min(all.length, Math.max(firstCount, all.length - lastCount)));
    return { total: all.length, first, last };
  }

  /** Mevcut oturumları listele: bot session'ları + kullanıcının pi session'ları (fs tarama). */
  async listSessions(): Promise<SessionInfo[]> {
    const out: SessionInfo[] = [];
    // Bot session'ları (izole dizin)
    out.push(...scanSessionDir(this.sessionDir, "bot"));
    // Kullanıcının pi session'ları (~/.pi/agent/sessions/**)
    const piSessionsDir = resolve(homedir(), ".pi", "agent", "sessions");
    out.push(...scanSessionDir(piSessionsDir, "pi"));
    // En yeni önce (dosya adındaki ISO timestamp ile)
    out.sort((a, b) => b.path.localeCompare(a.path));
    return out;
  }

  /** Prompt gönder. Streaming sırasındaysa kuyruğa followUp olarak eklenir. Görsel(ler) eklenebilir. */
  async prompt(text: string, images?: ImageContent[]): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("aktif session yok");
    const withImages = images && images.length > 0 ? { images } : {};
    if (session.isStreaming) {
      await session.prompt(text, { streamingBehavior: "followUp", ...withImages });
    } else {
      await session.prompt(text, withImages);
    }
  }

  /** Yalnızca test/selftest için: bir event'i işle (type-only guard). */
static eventKind(event: AgentSessionEvent): string {
  return event.type;
}

  dispose(): void {
    this.closeRuntime();
  }

  private closeRuntime(): void {
    if (this.runtime) {
      try {
        this.runtime.session.dispose();
      } catch {
        // dispose zaten kapalıysa sessizce geç
      }
      this.runtime = null;
      this.session = null;
    }
  }
}

/** Bu cwd'nin en son bot session'ını bulur (yoksa yeni session açılır). */
function latestSessionForCwd(sessionDir: string, cwd: string): SessionManager {
  let latest: { path: string; mtime: number } | null = null;
  try {
    for (const f of readdirSync(sessionDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const path = resolve(sessionDir, f);
      const header = readSessionHeader(path, "bot");
      if (!header || header.cwd !== cwd) continue;
      const mtime = statSync(path).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { path, mtime };
    }
  } catch {
    // dizin yok — yeni session
  }
  if (latest) return SessionManager.open(latest.path);
  return SessionManager.create(cwd, sessionDir);
}

/** Bir dizini (alt klasörler dahil) tarar, .jsonl session'ları okur. */
function scanSessionDir(dir: string, source: "bot" | "pi"): SessionInfo[] {
  const out: SessionInfo[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dizin yok
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".")) {
      out.push(...scanSessionDir(resolve(dir, e.name), source));
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      const info = readSessionHeader(resolve(dir, e.name), source);
      if (info) out.push(info);
    }
  }
  return out;
}

/** JSONL header'ından id/cwd + ilk user mesajını çıkarır. */
function readSessionHeader(path: string, source: "bot" | "pi"): SessionInfo | null {  try {
    const lines = readFileSync(path, "utf8").split("\n");
    const header = lines[0] ? (JSON.parse(lines[0]) as Record<string, unknown>) : null;
    if (header?.type !== "session") return null;
    let firstMessage = "";
    for (const line of lines.slice(1, 30)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, any>;
        if (entry.type === "message" && entry.message?.role === "user") {
          const content = entry.message.content ?? [];
          firstMessage = content
            .map((c: { text?: string }) => c.text ?? "")
            .join(" ")
            .slice(0, 60);
          break;
        }
      } catch {
        // bozuk satır — atla
      }
    }
    return {
      id: String(header.id ?? ""),
      path,
      firstMessage,
      cwd: String(header.cwd ?? ""),
      source,
    };
  } catch {
    return null;
  }
}

/** JSONL'den tüm user/assistant text mesajlarını çıkarır. */
function readSessionHistoryAll(path: string): HistoryEntry[] {
  try {
    const content = readFileSync(path, "utf8");
    const entries: HistoryEntry[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, any>;
        if (entry.type !== "message") continue;
        const role = entry.message?.role;
        if (role !== "user" && role !== "assistant") continue;
        const contentArr: Array<{ type?: string; text?: string }> = entry.message?.content ?? [];
        const text = contentArr
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join(" ")
          .trim();
        if (text) entries.push({ role, text });
      } catch {
        // bozuk satır — atla
      }
    }
    return entries;
  } catch {
    return [];
  }
}
