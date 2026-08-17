import type { Api } from "grammy";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** Telegram tek mesaj limiti. */
export const TELEGRAM_MAX_CHARS = 4096;
/** Art arda edit çağrıları arası minimum bekleme (rate limit). */
export const EDIT_INTERVAL_MS = 450;

/**
 * Metni Telegram'a sığacak parçalara böler.
 * Boşluk kırma yok — diff/code çıktısı için karakter bazlı kesim daha güvenli.
 */
export function splitForTelegram(text: string, max = TELEGRAM_MAX_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    chunks.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  return chunks;
}

interface StreamState {
  chatId: number;
  api: Api;
  /** Mevcut mesaj zincirindeki aktif mesaj id'si (null = henüz mesaj yok). */
  messageId: number | null;
  /** Aktif mesajın buffer'ı. */
  buffer: string;
  /** Telegram'a son gönderilen içerik (aynı içerik edit'i atlanır). */
  lastSent: string;
  /** Kapatılmış tamamlanmış chunk'lar. */
  done: number;
  editTimer: ReturnType<typeof setTimeout> | null;
  lastEditAt: number;
  closed: boolean;
  pendingError: string | null;
  toolCount: number;
  startTime: number;
}

/**
 * Pi'nin text_delta akışını Telegram'a yönlendirir:
 * throttle'lu editMessageText + 4096 karakter chunk'ı.
 */
export class TelegramStreamer {
  private st: StreamState;
  private onDone: (() => void) | null = null;

  constructor(chatId: number, api: Api) {
    this.st = {
      chatId,
      api,
      messageId: null,
      buffer: "",
      lastSent: "",
      done: 0,
      editTimer: null,
      lastEditAt: 0,
      closed: false,
      pendingError: null,
      toolCount: 0,
      startTime: Date.now(),
    };
  }

  /** Akış tamamlandığında çağrılır (agent_end). */
  onClose(cb: () => void): void {
    this.onDone = cb;
  }

  /** Pi session event'lerini işler. */
  handleEvent(event: AgentSessionEvent): void {
    if (this.st.closed) return;
    if (event.type === "message_update") {
      const ev = event.assistantMessageEvent;
      if (ev.type === "text_delta") {
        this.append(ev.delta);
      }
    } else if (event.type === "tool_execution_start") {
      this.st.toolCount += 1;
      this.append(`\n\n🔧 ${event.toolName}`);
    } else if (event.type === "tool_execution_end") {
      this.append(` ✓`);
    } else if (event.type === "agent_end") {
      this.finish();
    }
  }

  /** İş istatistikleri (iş bitince özet için). */
  getStats(): { durationMs: number; toolCount: number } {
    return { durationMs: Date.now() - this.st.startTime, toolCount: this.st.toolCount };
  }

  append(delta: string): void {
    if (this.st.closed || !delta) return;
    this.st.buffer += delta;
    if (this.st.buffer.length > TELEGRAM_MAX_CHARS) {
      this.freezeChunk();
    }
    this.scheduleFlush();
  }

  /** 4096 limitini aşan buffer'ı dondurup yeni mesaja geçer. */
  freezeChunk(): void {
    const head = this.st.buffer.slice(0, TELEGRAM_MAX_CHARS);
    this.st.buffer = this.st.buffer.slice(TELEGRAM_MAX_CHARS);
    this.st.done += 1;
    void this.sendNow(head);
    this.st.messageId = null;
  }

  /** Hata durumunda akışı kapatıp hatayı gösterir. */
  fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.st.pendingError = `❌ Hata: ${message}`;
    this.finish();
  }

  /** Akışı bitir: kalan buffer'ı gönder, timer'ı temizle. */
  finish(): void {
    if (this.st.closed) return;
    this.st.closed = true;
    if (this.st.editTimer) {
      clearTimeout(this.st.editTimer);
      this.st.editTimer = null;
    }
    if (this.st.buffer || this.st.pendingError) {
      const final = this.st.pendingError ?? this.st.buffer;
      this.st.buffer = "";
      void this.sendNow(final);
    }
    this.onDone?.();
  }

  private scheduleFlush(): void {
    if (this.st.editTimer) return;
    const wait = Math.max(0, EDIT_INTERVAL_MS - (Date.now() - this.st.lastEditAt));
    this.st.editTimer = setTimeout(() => {
      this.st.editTimer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.st.closed || !this.st.buffer) return;
    const now = Date.now();
    if (now - this.st.lastEditAt < EDIT_INTERVAL_MS) {
      this.scheduleFlush();
      return;
    }
    await this.sendNow(this.st.buffer);
  }

  private async sendNow(text: string): Promise<void> {
    if (!text || text === this.st.lastSent) return;
    this.st.lastSent = text;
    this.st.lastEditAt = Date.now();
    const st = this.st;
    try {
      if (st.messageId === null) {
        const sent = await st.api.sendMessage(st.chatId, text);
        st.messageId = sent.message_id;
      } else {
        await st.api.editMessageText(st.chatId, st.messageId, text);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "message is not modified" tarzı zararsız hataları yut, diğerlerini logla
      if (!/not modified|message to edit not found/i.test(message)) {
        console.error("[stream] gönderim hatası:", message);
      }
    }
  }
}
