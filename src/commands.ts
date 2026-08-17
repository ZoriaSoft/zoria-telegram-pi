export const COMMANDS: Array<{ command: string; description: string }> = [
  { command: "menu", description: "Ana menü" },
  { command: "cd", description: "Proje değiştir (örn. /cd okey)" },
  { command: "new", description: "Yeni oturum aç" },
  { command: "list", description: "Oturumları listele" },
  { command: "resume", description: "Oturuma dön (/resume id)" },
  { command: "abort", description: "Devam eden işi durdur" },
  { command: "status", description: "Durum: cwd + model + session" },
  { command: "model", description: "Model değiştir" },
  { command: "help", description: "Yardım" },
];

export const HELP_TEXT = `🤖 <b>Zoria Telegram Pi</b> — pi coding agent'ı Telegram'dan kontrol et

<b>Komutlar</b>
/menu — ana menü (butonlarla gezin)
/cd &lt;proje&gt; — proje değiştir; kısmi ad yeterli (örn. <code>/cd okey</code> → zoria-okey)
/new — yeni oturum
/list — oturumları listele
/resume &lt;id&gt; — eski oturuma dön
/abort — devam eden işi durdur
/status — cwd + oturum + model bilgisi
/help — bu liste

<b>Düz mesaj</b> doğrudan pi'ye prompt olarak gider.
Pi çalışırken yazarsanız sıraya alınır (followUp).

<b>İpuçları</b>
• /menu ile projelere butondan geç
• /cd <b>okey</b> gibi kısmi isim tamamlanır
• /list → id'yi kopyala → /resume &lt;id&gt;
• Çıktı 4096 karakteri aşarsa otomatik bölünür
`;

export function startText(cwd: string): string {
  return `👋 Hoş geldin! Pi hazır.

Çalışma kökü: <code>${cwd}</code>

/menu ile butonlu menüyü aç, ya da direkt yazmaya başla.`;
}
