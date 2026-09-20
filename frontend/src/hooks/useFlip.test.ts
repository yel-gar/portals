import { describe, expect, it } from "vitest";

import { computeFlipSteps } from "./useFlip";

describe("computeFlipSteps", () => {
  it("reports negative delta for a row that moved down and positive for one that rose", () => {
    const steps = computeFlipSteps(
      [
        { key: "a", top: 10 },
        { key: "b", top: 40 },
      ],
      [
        { key: "b", top: 10 },
        { key: "a", top: 40 },
      ],
    );
    expect(steps).toEqual([
      { key: "a", delta: -30 }, // swapped into the lower slot
      { key: "b", delta: 30 }, // swapped into the upper slot
    ]);
  });

  it("skips rows that left the list", () => {
    const steps = computeFlipSteps(
      [
        { key: "a", top: 10 },
        { key: "removed", top: 20 },
      ],
      [{ key: "a", top: 10 }],
    );
    expect(steps).toEqual([]);
  });

  it("ignores rows that stayed put", () => {
    const steps = computeFlipSteps(
      [
        { key: "a", top: 10 },
        { key: "b", top: 40 },
      ],
      [
        { key: "a", top: 10 },
        { key: "b", top: 40 },
      ],
    );
    expect(steps).toEqual([]);
  });

  it("produces no steps for the first render (no baseline)", () => {
    expect(computeFlipSteps([], [{ key: "a", top: 10 }])).toEqual([]);
  });
});
