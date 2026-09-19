import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the current time at mount", () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useNow(30_000));
    expect(result.current).toBe(1_000_000);
  });

  it("re-renders with an updated timestamp after the interval", () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useNow(30_000));

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(result.current).toBe(1_030_000);
  });

  it("does not fire before the interval elapses", () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(() => useNow(30_000));

    act(() => {
      vi.setSystemTime(1_010_000);
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current).toBe(1_000_000);
  });
});
