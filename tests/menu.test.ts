import { describe, expect, it } from "vitest";
import { categorize } from "../src/menu.js";

describe("categorize", () => {
  const sample = [
    "grok-tavla",
    "isometric-pixel-map",
    "napkin-plan",
    "zoria-okey",
    "nvidiaupstream",
    "zoria-auth-host",
    "zoria-platform",
    "zoria-stream",
    "zoriapdf",
    "zoriapdf-web",
    "zoriashield-web",
    "zoriatools.com",
    "unknown-thing",
  ];

  it("projeleri kategori kurallarına göre gruplar", () => {
    const cats = categorize(sample);
    const flat: Record<string, string[]> = {};
    for (const c of cats) flat[c.name] = c.items;

    expect(flat["🎮 Oyun"]).toEqual([
      "grok-tavla",
      "isometric-pixel-map",
      "napkin-plan",
      "zoria-okey",
    ]);
    expect(flat["⚙️ Servis"]).toEqual(["nvidiaupstream", "zoria-auth-host", "zoria-platform"]);
    expect(flat["📡 Medya"]).toEqual(["zoria-stream"]);
    expect(flat["📄 PDF"]).toEqual(["zoriapdf", "zoriapdf-web"]);
    expect(flat["🌐 Web/UI"]).toEqual(["zoriashield-web", "zoriatools.com"]);
    expect(flat["📦 Diğer"]).toEqual(["unknown-thing"]);
  });

  it("boş liste için boş dizi döner", () => {
    expect(categorize([])).toEqual([]);
  });

  it("tüm projeler kaybolmadan gruplanır", () => {
    const cats = categorize(sample);
    const total = cats.reduce((sum, c) => sum + c.items.length, 0);
    expect(total).toBe(sample.length);
  });
});
