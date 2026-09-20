/**
 * 2D-canvas fallback for the background spark field: additive ember sparks
 * drifting upward, deterministic per spark and per frame. Used whenever
 * WebGPU is unavailable or fails to init. The class is inert where there is
 * no canvas 2D context (e.g. jsdom in tests).
 */
import { fitCanvasSize } from "./canvasSize";

const SPARKS = 140;
const FLICKER_MIN = 0.45;
const FLICKER_MAX = 1;

/** Layered-sine flicker factor; deterministic per (time, phase). */
export function flicker(timeMs: number, phase: number): number {
  const t = timeMs / 1000;
  const raw = 0.72 + 0.18 * Math.sin(t * 1.9 + phase) + 0.1 * Math.sin(t * 3.4 + phase * 1.7);
  return Math.min(FLICKER_MAX, Math.max(FLICKER_MIN, raw));
}

/** Deterministic pseudo-random in [0, 1) — stable across frames and runs. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface SparkSpec {
  /** Horizontal anchor as a fraction of the width. */
  x: number;
  /** Vertical phase as a fraction of the height; rises over time. */
  y: number;
  /** Max radius as a fraction of the smaller canvas dimension. */
  size: number;
  /** Upward velocity in screen-height fractions per second. */
  speed: number;
  /** Flicker phase, in radians. */
  phase: number;
}

/** Static per-spark parameters, deterministic from the index alone. */
export function sparkSpec(index: number): SparkSpec {
  return {
    x: hash(index * 7.31 + 1.7),
    y: hash(index * 13.7 + 5.3),
    size: 0.0025 + hash(index * 3.77 + 9.9) * 0.006,
    speed: 0.025 + hash(index * 5.9 + 17.3) * 0.085,
    phase: hash(index * 11.31 + 23.7) * Math.PI * 2,
  };
}

/** Draws one soft rising spark, additively blended over the previous frame. */
function drawSpark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
  index: number,
): void {
  const spec = sparkSpec(index);
  const t = nowMs / 1000;
  const progress = (spec.y + t * spec.speed) % 1;
  const sx = spec.x * width + Math.sin(t * 1.3 + spec.phase * 2) * width * 0.004;
  const sy = height * (1 - progress) + Math.sin(t * 1.9 + spec.phase) * height * 0.006;
  // Sparks dim as they climb and grow back down near the hearth.
  const intensity = flicker(nowMs, spec.phase) * (1 - progress * 0.75);
  const radius = Math.max(1, spec.size * Math.min(width, height) * (1.4 - progress * 0.6));

  const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
  gradient.addColorStop(0, `rgba(255, 196, 118, ${(0.9 * intensity).toFixed(3)})`);
  gradient.addColorStop(0.35, `rgba(255, 106, 0, ${(0.45 * intensity).toFixed(3)})`);
  gradient.addColorStop(1, "rgba(255, 61, 0, 0)");
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Draws the whole spark field over the canvas. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
): void {
  ctx.globalCompositeOperation = "lighter";
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < SPARKS; i += 1) {
    drawSpark(ctx, width, height, nowMs, i);
  }
  ctx.globalCompositeOperation = "source-over";
}

export class EmberLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private running = false;
  private observer: ResizeObserver | null = null;
  /** Live counters for the console debug probe (see `FirePanels.getFireDebug`). */
  readonly debug = { frames: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // jsdom (vitest) has no 2D canvas — the layer then stays inert.
    this.ctx = canvas.getContext?.("2d") ?? null;
  }

  /** Starts the animation loop (no-op without a 2D context). */
  start(): void {
    if (this.ctx === null || this.running) {
      return;
    }
    this.running = true;
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.canvas);
    }
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = null;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Half CSS resolution, like the WebGPU path: soft dots upscale invisibly.
    const size = fitCanvasSize(rect.width, rect.height, 0.5);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
  }

  private frame(now: number): void {
    if (!this.running || this.ctx === null) {
      return;
    }
    drawFrame(this.ctx, this.canvas.width, this.canvas.height, now);
    this.debug.frames += 1;
    this.raf = requestAnimationFrame((then) => this.frame(then));
  }
}
