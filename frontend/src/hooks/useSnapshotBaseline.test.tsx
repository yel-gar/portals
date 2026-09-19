import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSnapshotBaseline } from "./useSnapshotBaseline";

interface Snapshot {
  a: number;
}

describe("useSnapshotBaseline", () => {
  it("returns the previous snapshot from the second one onward", () => {
    const snap1: Snapshot = { a: 1 };
    const snap2: Snapshot = { a: 2 };
    const snap3: Snapshot = { a: 3 };

    const { result, rerender } = renderHook(
      ({ scope, current }: { scope: unknown; current: Snapshot | undefined }) =>
        useSnapshotBaseline(scope, current),
      { initialProps: { scope: "k1", current: snap1 as Snapshot | undefined } },
    );

    // First snapshot in a scope: nothing to compare against.
    expect(result.current).toBeUndefined();
    // Same snapshot identity (e.g. a `now`-driven re-render): stable.
    rerender({ scope: "k1", current: snap1 });
    expect(result.current).toBeUndefined();

    // A newer snapshot becomes the baseline, the previous one is returned.
    rerender({ scope: "k1", current: snap2 });
    expect(result.current).toBe(snap1);
    // The delta stays visible until a newer snapshot arrives.
    rerender({ scope: "k1", current: snap2 });
    expect(result.current).toBe(snap1);

    rerender({ scope: "k1", current: snap3 });
    expect(result.current).toBe(snap2);
  });

  it("ignores undefined loads and keeps the last known delta", () => {
    const snap1: Snapshot = { a: 1 };
    const snap2: Snapshot = { a: 2 };
    const { result, rerender } = renderHook(
      ({ scope, current }: { scope: unknown; current: Snapshot | undefined }) =>
        useSnapshotBaseline(scope, current),
      { initialProps: { scope: "k1", current: snap1 as Snapshot | undefined } },
    );
    rerender({ scope: "k1", current: snap2 });
    expect(result.current).toBe(snap1);

    // Loading state (undefined) must not wipe the displayed delta.
    rerender({ scope: "k1", current: undefined });
    expect(result.current).toBe(snap1);
  });

  it("resets the baseline when the scope changes", () => {
    const snap1: Snapshot = { a: 1 };
    const snap2: Snapshot = { a: 2 };
    const other: Snapshot = { a: 10 };
    const { result, rerender } = renderHook(
      ({ scope, current }: { scope: unknown; current: Snapshot | undefined }) =>
        useSnapshotBaseline(scope, current),
      { initialProps: { scope: "k1", current: snap1 as Snapshot | undefined } },
    );
    rerender({ scope: "k1", current: snap2 });
    expect(result.current).toBe(snap1);

    // Page/filter change: snapshots from another scope are irrelevant.
    rerender({ scope: "k2", current: other });
    expect(result.current).toBeUndefined();
  });
});
