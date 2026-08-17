# Zoria Telegram Pi — ROADMAP

## v0.1 — Canlı bot (mevcut sprint)
- [x] Bot iskeleti + whitelist
- [x] pi SDK entegrasyonu + selftest (glm-5.3 PASS)
- [x] Streaming + oturum yönetimi
- [x] GitHub repo + verify
- [ ] **BOT_TOKEN + ALLOWED_IDS ile canlıya alma (supervisord)** ← sıradaki
- [ ] Telefondan gerçek kullanım smoke testi

## v0.2 — Kullanılabilirlik
- [ ] /cd ile projeler arası gezinme iyileştirmesi (tab completion benzeri: /cd zor → öneri)
- [ ] Uzun çıktılar için sendDocument (diff/log dosyası olarak)
- [ ] Model değiştirme komutu (/model zai/glm-5.3)
- [ ] Oturum başına kısa özet (/list'te daha iyi ilk mesajlar)

## v0.3 — İleri (istek üzerine)
- [ ] Çoklu kullanıcı (whitelist genişletme) — muhtemelen gerekmez
- [ ] /deploy gibi proje bazlı kısayol komutları (Zoria skill'lerini çağırma)
- [ ] GitHub Actions CI (sandbox dışı doğrulama)
