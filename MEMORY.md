# Zoria Telegram Pi — MEMORY

Son güncelleme: 2026-08-17 (v0.1.0 — ilk sürüm)

## Ne bu?

Pi coding agent'ı (`@earendil-works/pi-coding-agent` SDK) Telegram üzerinden kontrol eden bot.
Node.js + grammY + pi SDK. Tek kullanıcı (whitelist), tek process (supervisord).

## Durum

- **v0.2+** — menü + model seçimi + servisler + görsel/vision + dosya al/gönder + zip + iş özeti
- Selftest PASS: `zai/glm-5.3` ile gerçek model yanıtı + tool çağrıları doğrulandı
- Verify PASS: build (tsc strict) + lint (oxlint) + test (16/16)
- GitHub: `ZoriaSoft/zoria-telegram-pi` (public, main)
- **Canlı:** supervisord `zoria-telegram-pi` RUNNING · @zopitelegram_bot · HOME=/root · glm-5.3

## Özellikler (v0.2)

- **Menü:** /menu — Projeler (kategorili, sayfalı), Oturumlar, Model, Servisler, Durum, Yardım; setMyCommands
- **/cd fuzzy:** kısmi proje adı tamamlanır (/cd okey → zoria-okey)
- **/model:** kısayollar (zai GLM + ts9 deepseek) + 🔍 tüm modeller sayfalı; yasak liste filtresi (DNA)
- **/services:** supervisorctl status (14 servis) + 🔄 restart butonları (spawnSync — status exit 3 yutulur)
- **Görsel vision:** 📸 foto → base64 ImageContent → prompt (model destekliyorsa)
- **Dosya:** 📄 gönder → cwd'ye kaydet; /send <dosya>; /zip [proje] → tar.gz (node_modules/.git hariç)
- **İş özeti:** agent_end → ✅ tamamlandı · süre · tool sayısı (tool>0 veya >20sn)
- **Session birleşik:** 🤖 bot + 🧑 pi session'ları (fs tarama, cwd+ilk mesaj+özet); resume cwd-farkında
- **Aktiflik koruması:** resume'de mtime <3dk ise ⚠️ uyarı + "Yine de devral" butonu
- Thinking seviyesi: kullanıcı istediği gibi **high** (değiştirilmedi)

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
- [x] Menü + model + servisler + görsel/dosya/zip + iş özeti (v0.2)
- [ ] İki yönlü session senkronu (bot da kullanıcının dizinine yazsın) — kullanıcı isterse
- [ ] GitHub Actions CI (lint+test) — isteğe bağlı

## DNA

- /home/workspace/Zoria-DNA/
- Kardeş projeler: zoria-stream (CF worker + Pages), isometric-pixel-map (Godot)
