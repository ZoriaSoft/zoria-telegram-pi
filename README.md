# Zoria Telegram Pi

Pi coding agent'ı Telegram'dan kontrol et. Telefondan komut ver, pi senin için kod yazar.

## Ne yapar?

- 📱 Telegram'dan pi'ye **prompt gönder** — çıktı canlı akar (streaming)
- 🔀 `/cd zoria-okey` ile projeler arasında gezin, her projede ayrı oturum
- 💾 `/new`, `/list`, `/resume` ile oturum yönet — kaldığın yerden devam
- 🔒 Tek kullanıcıya kilitli (whitelist) — bot herkese kapalı

## Kurulum

```bash
npm install
cp .env.example .env
# .env'e kendi değerlerini yaz:
#   BOT_TOKEN  — BotFather'dan /newbot
#   ALLOWED_IDS — kendi Telegram user_id'n (@userinfobot'dan öğrenebilirsin)
npm run verify    # build + lint + test
npm run selftest  # pi SDK gerçek model testi
npm start         # bot'u başlat
```

## Komutlar

| Komut | Açıklama |
|---|---|
| `/cd <proje>` | çalışma dizinini değiştir (ör. `/cd zoria-okey`, `/cd ~` köke döner) |
| `/new` | yeni pi oturumu |
| `/list` | oturumları listele |
| `/resume <id>` | eski oturuma dön |
| `/abort` | devam eden işi durdur |
| `/status` | cwd + model + oturum bilgisi |
| düz mesaj | doğrudan pi'ye prompt |

## Stack

Node 22 · grammY · `@earendil-works/pi-coding-agent` (SDK) · tsx · vitest · oxlint

FOSS-first. MIT lisanslı — kendi pi kurulumun için fork'la.
