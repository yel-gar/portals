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
});
