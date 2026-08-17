# Zoria Telegram Pi — MEMORY

Son güncelleme: 2026-08-17 (v0.1.0 — ilk sürüm)

## Ne bu?

Pi coding agent'ı (`@earendil-works/pi-coding-agent` SDK) Telegram üzerinden kontrol eden bot.
Node.js + grammY + pi SDK. Tek kullanıcı (whitelist), tek process (supervisord).

## Durum

- **v0.1.0** — bot iskeleti + pi SDK entegrasyonu + oturum yönetimi + streaming
- Selftest PASS: `zai/glm-5.3` ile gerçek model yanıtı + tool çağrıları doğrulandı
- Verify PASS: build (tsc strict) + lint (oxlint) + test (13/13)
- GitHub: `ZoriaSoft/zoria-telegram-pi` (public, main)
- **Canlıda: EVET** — supervisord `zoria-telegram-pi` RUNNING, model `zai/glm-5.3`, bot @zopitelegram_bot
- BOT_TOKEN + ALLOWED_IDS `.env`'de (chmod 600, gitignore'da)

## Komutlar

```bash
npm run verify     # build + lint + test
npm run selftest   # pi SDK gerçek model testi (PI_MODEL env ile model seçilebilir)
npm start          # bot (BOT_TOKEN + ALLOWED_IDS gerekli)
scripts/verify.sh  # aynı verify
```

## Mimari

- `src/index.ts` — grammY bot, whitelist middleware, komut router, streamer bağlama
- `src/pi.ts` — `PiController`: cwd-bound runtime, session yönetimi (new/list/resume/cd), prompt, event subscribe
- `src/stream.ts` — `TelegramStreamer`: text_delta → throttle'lu editMessageText, 4096 char chunk
- `src/config.ts` — .env loader (dotenv'siz), whitelist parse
- `scripts/selftest.ts` — SDK smoke (ModelRuntime + in-memory session + prompt)
- Session'lar: `~/.pi/agent/telegram-sessions/` (kullanıcının pi session'larından ayrı)

## Telegram sınırları (uygulanan)

- Tek mesaj 4096 char → `splitForTelegram` chunk'ı
- Edit throttle 450ms (rate limit) + autoRetry plugin (429)
- Bot geçmişi göremez → oturum geçmişi pi session.jsonl'de (tek kaynak)

## Friction'lar

1. **oxlint "No files found"** — `/home/workspace/.gitignore`'daki `*` pattern'i parent olarak okunuyor; çözüm: **proje git repo'su olmalı** (git init). Repo yoksa oxlint filesystem'de yukarı çıkıp root .gitignore'a takılıyor.
2. **pi SDK ESM-only** — `require()` çalışmaz, ESM import gerekli (`"type": "module"`).
3. **`Model` tipi** `@earendil-works/pi-ai/compat`'dan import edilir (pi-coding-agent re-export etmiyor).
4. **tsx çalışırken .env** — `loadEnvFile()` config'te çağrılır; dotenv bağımlılığı yok.
5. Selftest default model kullanıcının pi settings'inden gelir (`bai/deepseek-v4-flash` görüldü — yasak listede olabilir); bot için **`PI_MODEL=zai/glm-5.3`** önerilir.
6. **`loadEnvFile` .env'i OVERRIDE eder** — global env'de `PI_MODEL=bai/deepseek-v4-flash` tanımlıydı ve .env'deki glm-5.3'ü ezmesi gerekti. .env = proje config'i, önceliği var.
7. **supervisord HOME kritik** — bot pi auth'unu `$HOME/.pi/agent/auth.json`'dan okur. `HOME="/home/workspace"` yapılırsa bot boş auth görür → **0 model** (menüde "Tüm modeller (0)"). `HOME="/root"` olmalı (pi auth `/root/.pi/agent/auth.json`'da).

## Açık işler

- [x] BOT_TOKEN + ALLOWED_IDS ile canlıya alma (supervisord) — @zopitelegram_bot RUNNING
- [x] supervisord.conf'u `/etc/zo/supervisord-user.conf`'a ekleme
- [ ] /resume ile eski oturuma dönüşün gerçek bot üzerinde smoke testi
- [ ] Uzun çıktılar için `sendDocument` (diff/log > 4096 chunk zinciri) — opsiyonel

## DNA

- /home/workspace/Zoria-DNA/
- Kardeş projeler: zoria-stream (CF worker + Pages), isometric-pixel-map (Godot)
