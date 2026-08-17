# Zoria Telegram Pi — DECISIONS

## ADR-0001 — Stack: Node.js + grammY + pi SDK (2026-08-17)

**Karar:** Node 22, grammY (Telegram bot), `@earendil-works/pi-coding-agent` SDK (aynı process), tsx ile çalıştırma.

**Neden:**
- pi SDK aynı process'te çalışabilir (`createAgentSession`) → oturum state'i, compaction, skill'ler otomatik devralınır
- RPC mode (`pi --mode rpc`) yerine SDK: tip güvenliği + aynı süreçte akış yönetimi
- grammY: TS-first, autoRetry plugin (429), minimal
- Cloudflare Worker değil (uzun süreli process + yerel fs + pi auth gerekir)

## ADR-0002 — Tek kullanıcı whitelist (2026-08-17)

**Karar:** `ALLOWED_IDS` env'i; whitelist dışı tüm mesajlar sessizce yutulur.

**Neden:** Bot bash/read/edit yetenekli pi'yi çalıştırıyor — açık bot = herkes için shell. En az yetki: tek kişi.

## ADR-0003 — Ayrı session dizini (2026-08-17)

**Karar:** `~/.pi/agent/telegram-sessions/` — kullanıcının normal pi session'larından ayrı.

**Neden:** İki process aynı session dosyasını açarsa çakışır. Bot kendi yaşam alanında kalır; `/cd` ile proje bazlı oturumlar burada birikir.

## ADR-0004 — Streaming: editMessageText + 4096 chunk (2026-08-17)

**Karar:** text_delta'ları biriktir, 450ms throttle ile aynı mesajı güncelle; 4096'ya ulaşınca dondur + yeni mesaj.

**Neden:** Telegram'ın tek mesaj limiti 4096 char; sık edit 429 çeker (autoRetry + throttle). Dosya gönderimi (sendDocument) v1'de yok — chunk zinciri yeterli.

## ADR-0005 — Model default zai/glm-5.3 (2026-08-17)

**Karar:** `PI_MODEL` env ile model seçilir; önerilen `zai/glm-5.3`. Boşsa pi settings default'u kullanılır (dikkat: `bai/deepseek-v4-flash` görülebilir — DNA yasak listesi).

**Neden:** AGENTS.md "Pi default: zai/glm-5.3". Selftest'te glm-5.3 doğrulandı (114 char yanıt + 2 tool çağrısı).
