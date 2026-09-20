import { describe, expect, it } from "vitest";

import { flicker, sparkSpec } from "./emberLayer";

describe("emberLayer", () => {
  it("flicker is deterministic for the same inputs", () => {
    expect(flicker(1234, 1.7)).toBe(flicker(1234, 1.7));
  });

  it("flicker stays within its bounded range", () => {
    const values = Array.from({ length: 200 }, (_, i) => flicker(i * 50, i * 0.3));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0.45);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("spark specs are deterministic and distinct per index", () => {
    const first = sparkSpec(3);
    expect(sparkSpec(3)).toEqual(first);
    expect(sparkSpec(4)).not.toEqual(first);
  });

  it("spark specs stay inside their bounds", () => {
    for (let i = 0; i < 300; i += 1) {
      const spec = sparkSpec(i);
      expect(spec.x).toBeGreaterThanOrEqual(0);
      expect(spec.x).toBeLessThan(1);
      expect(spec.y).toBeGreaterThanOrEqual(0);
      expect(spec.y).toBeLessThan(1);
      expect(spec.size).toBeGreaterThan(0);
      expect(spec.size).toBeLessThan(0.012);
      expect(spec.speed).toBeGreaterThan(0.02);
      expect(spec.speed).toBeLessThan(0.12);
      expect(spec.phase).toBeGreaterThanOrEqual(0);
      expect(spec.phase).toBeLessThanOrEqual(Math.PI * 2);
    }
  });
});
