import { describe, expect, it } from "vitest";
import { splitForTelegram, TELEGRAM_MAX_CHARS } from "../src/stream.js";

describe("splitForTelegram", () => {
  it("kısa metni tek parça bırakır", () => {
    expect(splitForTelegram("merhaba")).toEqual(["merhaba"]);
  });

  it("boş metin için boş dizi döner", () => {
    expect(splitForTelegram("")).toEqual([]);
  });

  it("4096 karakteri aşan metni böler", () => {
    const text = "x".repeat(TELEGRAM_MAX_CHARS + 100);
    const chunks = splitForTelegram(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBe(TELEGRAM_MAX_CHARS);
    expect(chunks.join("")).toBe(text);
  });

  it("tam sınırda tek parça kalır", () => {
    const text = "y".repeat(TELEGRAM_MAX_CHARS);
    expect(splitForTelegram(text)).toEqual([text]);
  });

  it("çok uzun metni çoklu parçaya böler ve içerik korunur", () => {
    const text = "abc-".repeat(5000); // 20000 karakter
    const chunks = splitForTelegram(text);
    expect(chunks.every((c) => c.length <= TELEGRAM_MAX_CHARS)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});
