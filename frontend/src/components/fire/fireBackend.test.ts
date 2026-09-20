import { describe, expect, it } from "vitest";

import { chooseFireBackend } from "./fireBackend";

describe("chooseFireBackend", () => {
  it("collapses to a static gradient under reduced motion", () => {
    expect(chooseFireBackend(true, true)).toBe("static");
    expect(chooseFireBackend(true, false)).toBe("static");
  });

  it("uses WebGPU when the browser offers it", () => {
    expect(chooseFireBackend(false, true)).toBe("webgpu");
  });

  it("falls back to the ember canvas without WebGPU", () => {
    expect(chooseFireBackend(false, false)).toBe("ember");
  });

  it("prefers the ember canvas on Windows even with WebGPU", () => {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      configurable: true,
    });
    try {
      expect(chooseFireBackend(false, true)).toBe("ember");
      expect(chooseFireBackend(true, true)).toBe("static");
    } finally {
      Object.defineProperty(navigator, "userAgent", { value: original, configurable: true });
    }
  });
});
