/**
 * Live-tunable background parameters for the `?fire=` experiment. A plain
 * mutable object: the panel writes into it from sliders, the shader loop
 * reads it every frame — no React state crosses that boundary.
 */

export interface FireTuning {
  /** Main speed of stream layer A (shader units/s). */
  flowA: number;
  /** Main speed of stream layer B. */
  flowB: number;
  /** Domain swirl rate around the screen center. */
  swirl: number;
  /** Turbulence noise frequency. */
  warpFreq: number;
  /** Master brightness multiplier for the streams. */
  bright: number;
}

export const DEFAULT_TUNING: FireTuning = {
  flowA: 0.25,
  flowB: 0.1,
  swirl: 0.05,
  warpFreq: 2.2,
  bright: 0.85,
};

export const fireTuning: FireTuning = { ...DEFAULT_TUNING };

export function setFireTuning<K extends keyof FireTuning>(key: K, value: FireTuning[K]): void {
  fireTuning[key] = value;
}

export function resetFireTuning(): void {
  Object.assign(fireTuning, DEFAULT_TUNING);
}
