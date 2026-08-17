/**
 * Selftest: pi SDK gerçekten çalışıyor mu?
 * - ModelRuntime + kullanıcının mevcut auth'u (zai/glm-5.3 vb.)
 * - In-memory session'da kısa prompt, text_delta'ları topla
 * - PASS/FAIL çıktısı + model bilgisi
 *
 * Kullanım: bun run selftest
 */
import { ModelRuntime, createAgentSession, resolveCliModel, SessionManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const MODEL_ARG = process.env.PI_MODEL?.trim() || undefined;

async function main(): Promise<void> {
  console.log("[selftest] ModelRuntime.create() ...");
  const modelRuntime = await ModelRuntime.create();

  const available = await modelRuntime.getAvailable();
  console.log(`[selftest] kullanılabilir model: ${available.length}`);
  if (available.length === 0) {
    console.error("[selftest] FAIL — hiçbir model auth'lu değil (auth.json / env anahtarları yok)");
    process.exit(1);
  }
  for (const m of available.slice(0, 5)) {
    console.log(`  - ${m.provider}/${m.id}`);
  }

  console.log("[selftest] in-memory session açılıyor ...");
  let model;
  if (MODEL_ARG) {
    const resolved = resolveCliModel({ cliModel: MODEL_ARG, modelRuntime });
    if (resolved.error) throw new Error(`PI_MODEL çözülemedi: ${resolved.error}`);
    model = resolved.model;
  }
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(ROOT),
    modelRuntime,
    model,
  });

  console.log(`[selftest] model: ${session.model?.id ?? "default"}`);

  let text = "";
  let toolCount = 0;
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    } else if (event.type === "tool_execution_start") {
      toolCount += 1;
    }
  });

  console.log("[selftest] prompt atılıyor ...");
  await session.prompt("Tek cümleyle yanıtla: selftest başarılı mı?");

  console.log(`[selftest] alınan metin (${text.length} karakter):`);
  console.log(text.trim().slice(0, 300));
  console.log(`[selftest] tool çağrısı: ${toolCount}`);

  if (text.trim().length < 5) {
    console.error("[selftest] FAIL — anlamlı yanıt alınamadı");
    process.exit(1);
  }
  session.dispose();
  console.log("[selftest] PASS ✓");
}

main().catch((err) => {
  console.error("[selftest] FAIL —", err);
  process.exit(1);
});
