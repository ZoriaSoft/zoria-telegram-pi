export const HELP_TEXT = `🤖 <b>Zoria Telegram Pi</b> — pi coding agent'ı Telegram'dan kontrol et

<b>Komutlar</b>
/new — yeni oturum aç
/list — oturumları listele
/resume &lt;id&gt; — eski oturuma dön
/cd &lt;proje&gt; — çalışma dizinini değiştir (örn. /cd zoria-okey, /cd ~ köke döner)
/abort — devam eden işi durdur
/status — cwd + oturum + model bilgisi
/help — bu liste

<b>Düz mesaj</b> doğrudan pi'ye prompt olarak gider.
Pi çalışırken yazarsanız sıraya alınır (followUp).

<b>İpuçları</b>
• /cd ile projeler arasında gezin, orada pi oturumu açılır
• /list → id'yi kopyala → /resume &lt;id&gt; ile kaldığın yerden devam
• Çıktı 4096 karakteri aşarsa otomatik bölünür
`;

export function startText(cwd: string, allowed: boolean): string {
  if (!allowed) return "🚫 Erişim reddedildi. Bu bot sadece yetkili kullanıcılar içindir.";
  return `👋 Hoş geldin! Pi hazır.

Çalışma kökü: <code>${cwd}</code>

/help ile komutları gör, ya da direkt yazmaya başla.`;
}
