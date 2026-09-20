import { describe, expect, it } from "vitest";

import { flicker, tongueHeight } from "./emberLayer";

describe("emberLayer", () => {
  it("flicker is deterministic for the same inputs", () => {
    expect(flicker(1234, 1.7)).toBe(flicker(1234, 1.7));
  });

  it("flicker stays within its bounded range", () => {
    const values = Array.from({ length: 200 }, (_, i) => flicker(i * 50, i * 0.3));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0.55);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("tongue height never exceeds the canvas", () => {
    expect(tongueHeight(1.5, 5, 1.7)).toBeLessThanOrEqual(1);
    expect(tongueHeight(0.5, 5, 1.7)).toBeGreaterThan(0);
  });
});
