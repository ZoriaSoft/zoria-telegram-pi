# Zoria Telegram Pi — AGENTS.md

## Ne bu
Pi coding agent SDK'sını Telegram'dan kontrol eden tek kullanıcılı bot. Node 22 + grammY + `@earendil-works/pi-coding-agent`.

## Komutlar
```bash
npm run verify    # CI eşdeğeri: tsc strict + oxlint + vitest
npm run selftest  # SDK smoke — gerçek model yanıtı (PI_MODEL=zai/glm-5.3 önerilir)
npm start         # bot (BOT_TOKEN + ALLOWED_IDS .env'de)
```

## Kurallar
1. **Whitelist şart** — `ALLOWED_IDS` boşsa bot başlamaz. Asla kaldırma.
2. **Model default** `zai/glm-5.3` — `PI_MODEL` ile override. Yasak listeye (deepseek-v4-flash) düşme.
3. **Session'lar** `~/.pi/agent/telegram-sessions/` altında — kullanıcının pi session'larına dokunma.
4. **4096 char kuralı** — Telegram'a giden her mesaj `splitForTelegram`'dan geçer.
5. **Verify = CI** — commit öncesi `npm run verify` yeşil olmalı.
6. Bot mesajlarında `parse_mode: "HTML"` kullanırken kullanıcı içeriğini `escapeHtml`'den geçir.

## Mimari haritası
- `src/index.ts` — bot wiring (komutlar, streamer bağlama, whitelist)
- `src/pi.ts` — PiController (runtime/session/prompt — SDK'nın tek soyutlama noktası)
- `src/stream.ts` — TelegramStreamer (delta → editMessageText, chunk, throttle)
- `src/config.ts` — env + whitelist
- `scripts/selftest.ts` — canlı model smoke testi
- `supervisord/zoria-telegram-pi.conf` — production supervisor config

## Friction (tekrar yaşamamak için)
- `git init` yokken oxlint her şeyi ignore eder (root `/home/workspace/.gitignore` → `*`).
- pi SDK ESM-only; `Model` tipi `@earendil-works/pi-ai/compat`'dan.
- TS strict: `Model<any>` generic argüman ister.
