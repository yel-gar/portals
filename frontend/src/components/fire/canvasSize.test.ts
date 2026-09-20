import { describe, expect, it } from "vitest";

import { fitCanvasSize } from "./canvasSize";

describe("fitCanvasSize", () => {
  it("scales CSS pixels by the device pixel ratio", () => {
    expect(fitCanvasSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it("never drops below one pixel", () => {
    expect(fitCanvasSize(0, 0, 1)).toEqual({ width: 1, height: 1 });
  });

  it("caps the long side so the texture stays creatable", () => {
    // A document-tall canvas (2545×8577 device px) killed the swapchain on
    // real hardware: clamp the long side, keep the aspect.
    const size = fitCanvasSize(2545, 8577, 1);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
    expect(size.width / size.height).toBeCloseTo(2545 / 8577, 3);
  });
});
