# Changelog

Tüm önemli değişiklikler bu dosyada tutulur. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-08-17

### Eklendi
- Telegram bot (grammY) + pi SDK entegrasyonu (aynı process, `createAgentSessionRuntime`)
- Komutlar: /start /help /status /new /list /resume /cd /abort
- Düz mesaj → pi prompt; streaming sırasında gelen mesajlar followUp kuyruğuna
- Canlı akış: text_delta → editMessageText (450ms throttle) + 4096 char chunk
- Güvenlik: ALLOWED_IDS whitelist, yetkisiz mesajlar sessizce yutulur
- Oturum yönetimi: `/new`, `/list`, `/resume <id>` (SessionManager), `/cd <proje>`
- `~/.pi/agent/telegram-sessions/` ayrı session alanı
- Selftest: gerçek model smoke (ModelRuntime + in-memory session)
- Verify pipeline: tsc strict + oxlint + vitest (13 test)
- Supervisord config, .env.example, doküman seti (MEMORY/AGENTS/DECISIONS)
