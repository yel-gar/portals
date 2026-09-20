import { useLayoutEffect, useRef, type RefObject } from "react";

export interface FlipPosition {
  key: string;
  top: number;
}

export interface FlipStep {
  key: string;
  delta: number;
}

/**
 * Vertical displacement per surviving row between two keyed layouts.
 *
 * `delta = oldTop - newTop`: positive means the row now sits higher on screen,
 * so it must glide down from `translateY(delta)` back to `0`.
 */
export function computeFlipSteps(
  before: readonly FlipPosition[],
  after: readonly FlipPosition[],
): FlipStep[] {
  const afterTop = new Map(after.map((position) => [position.key, position.top]));
  const steps: FlipStep[] = [];
  for (const position of before) {
    const nextTop = afterTop.get(position.key);
    if (nextTop === undefined) {
      continue; // Row left the page — nothing to animate.
    }
    const delta = position.top - nextTop;
    if (delta !== 0) {
      steps.push({ key: position.key, delta });
    }
  }
  return steps;
}

const FLIP_DURATION_MS = 400;
const FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function animateStep(element: HTMLElement, delta: number): void {
  // jsdom and older engines lack WAAPI — the reorder just renders in place.
  if (typeof element.animate !== "function") {
    return;
  }
  element.getAnimations?.().forEach((animation) => animation.cancel());
  element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], {
    duration: FLIP_DURATION_MS,
    easing: FLIP_EASING,
  });
}

/**
 * FLIP move animations for a keyed row list. The caller marks each row with
 * `data-flip-key="<key>"` and returns its key list in render order; whenever
 * that list changes, rows that moved vertically play a short slide from their
 * old position — measured before the swap, all inside one layout effect that
 * runs before paint. Skipped on the first render (no baseline to animate from)
 * and whenever `enabled` is false (reduced motion).
 */
export function useFlip(
  keys: readonly (string | number)[],
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  const prevPositions = useRef<ReadonlyArray<FlipPosition> | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || !enabled) {
      prevPositions.current = null;
      return;
    }

    const baseTop = container.getBoundingClientRect().top;
    const next: FlipPosition[] = [];
    const elementByKey = new Map<string, HTMLElement>();
    for (const key of keys) {
      const keyString = String(key);
      const element = container.querySelector<HTMLElement>(`[data-flip-key="${keyString}"]`);
      if (element === null) {
        continue;
      }
      elementByKey.set(keyString, element);
      next.push({ key: keyString, top: element.getBoundingClientRect().top - baseTop });
    }

    const prev = prevPositions.current;
    if (prev !== null) {
      for (const step of computeFlipSteps(prev, next)) {
        const element = elementByKey.get(step.key);
        if (element !== undefined) {
          animateStep(element, step.delta);
        }
      }
    }
    prevPositions.current = next;
  }, [keys, containerRef, enabled]);
}
