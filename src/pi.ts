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
import { resolve } from "node:path";

export interface SessionInfo {
  id: string;
  path: string;
  firstMessage: string;
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
    this.modelArg = opts.model;
    this.currentCwd = this.workspaceRoot;
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

  /** Auth'lu modelleri listeler (deterministik sıra). */
  listAvailableModels(): Array<{ provider: string; id: string }> {
    const snap = this.modelRuntime?.getAvailableSnapshot() ?? [];
    return snap
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
      sessionManager: SessionManager.create(target, this.sessionDir),
    });

    this.runtime = runtime;
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
  }

  /** Yeni boş oturum aç. */
  async newSession(): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) throw new Error("runtime yok");
    await runtime.newSession();
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
  }

  /** Belirli bir session dosyasını aç. */
  async resumeSession(sessionFile: string): Promise<void> {
    const runtime = this.runtime;
    if (!runtime) throw new Error("runtime yok");
    await runtime.switchSession(sessionFile);
    this.session = runtime.session;
    this.attachListeners();
    this.notifySessionChanged();
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

  /** Mevcut oturumları listele (tüm cwd'ler için). */
  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await SessionManager.list(this.workspaceRoot, this.sessionDir);
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      firstMessage: (s.firstMessage ?? "").slice(0, 60),
    }));
  }

  /** Prompt gönder. Streaming sırasındaysa kuyruğa followUp olarak eklenir. */
  async prompt(text: string): Promise<void> {
    const session = this.session;
    if (!session) throw new Error("aktif session yok");
    if (session.isStreaming) {
      await session.prompt(text, { streamingBehavior: "followUp" });
    } else {
      await session.prompt(text);
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
