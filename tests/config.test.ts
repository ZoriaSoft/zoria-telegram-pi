import { describe, expect, it } from "vitest";
import { isAllowed, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("eksik BOT_TOKEN hatası fırlatır", () => {
    expect(() => loadConfig({})).toThrow(/BOT_TOKEN/);
  });

  it("eksik ALLOWED_IDS hatası fırlatır", () => {
    expect(() => loadConfig({ BOT_TOKEN: "x" })).toThrow(/ALLOWED_IDS/);
  });

  it("geçerli env'i ayrıştırır", () => {
    const cfg = loadConfig({
      BOT_TOKEN: "123:abc",
      ALLOWED_IDS: " 42 , 7 , 99 ",
      WORKSPACE_ROOT: "/tmp/ws",
    });
    expect(cfg.botToken).toBe("123:abc");
    expect(cfg.allowedIds).toEqual([42, 7, 99]);
    expect(cfg.workspaceRoot).toBe("/tmp/ws");
  });

  it("PI_MODEL opsiyoneldir", () => {
    const cfg = loadConfig({ BOT_TOKEN: "x", ALLOWED_IDS: "1" });
    expect(cfg.piModel).toBeUndefined();
  });

  it("boş/geçersiz ID'leri filtreler", () => {
    const cfg = loadConfig({ BOT_TOKEN: "x", ALLOWED_IDS: "1,abc,,-3,5" });
    expect(cfg.allowedIds).toEqual([1, 5]);
  });
});

describe("isAllowed", () => {
  it("whitelist'teki id'yi kabul eder", () => {
    expect(isAllowed(42, [42, 7])).toBe(true);
  });

  it("whitelist dışını reddeder", () => {
    expect(isAllowed(99, [42, 7])).toBe(false);
  });

  it("undefined id'yi reddeder", () => {
    expect(isAllowed(undefined, [42])).toBe(false);
  });
});
