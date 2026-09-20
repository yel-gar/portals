/**
 * 2D-canvas fallback for the fiery side panels: additive flame tongues with a
 * deterministic flicker. Used whenever WebGPU is unavailable or fails to init.
 * The class is inert where there is no canvas 2D context (e.g. jsdom in tests).
 */

const TONGUES = 11;
const FLICKER_MIN = 0.55;
const FLICKER_MAX = 1;

/** Layered-sine flicker factor; deterministic per (time, phase). */
export function flicker(timeMs: number, phase: number): number {
  const t = timeMs / 1000;
  const raw = 0.78 + 0.15 * Math.sin(t * 1.7 + phase) + 0.07 * Math.sin(t * 3.1 + phase * 1.7);
  return Math.min(FLICKER_MAX, Math.max(FLICKER_MIN, raw));
}

/** How tall a flame tongue reaches, as a fraction of the canvas height. */
export function tongueHeight(baseFraction: number, timeMs: number, phase: number): number {
  return Math.min(1, baseFraction * flicker(timeMs, phase));
}

/**
 * Draws one flame tongue as a teardrop with a vertical warm gradient,
 * additively blended over the previous frame.
 */
function drawTongue(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
  index: number,
  tongueCount: number,
): void {
  const phase = index * 1.9;
  const centerX = ((index + 0.65) / tongueCount) * width;
  const tongueWidth = width * (0.16 + 0.05 * Math.sin(nowMs / 800 + phase));
  const heightPx = height * tongueHeight(0.45 + 0.35 * Math.sin(phase), nowMs, phase);

  const gradient = ctx.createLinearGradient(0, height, 0, height - heightPx);
  gradient.addColorStop(0, "rgba(255, 106, 0, 0.5)");
  gradient.addColorStop(0.4, "rgba(255, 70, 0, 0.28)");
  gradient.addColorStop(1, "rgba(255, 61, 0, 0)");

  ctx.beginPath();
  ctx.moveTo(centerX, height);
  ctx.bezierCurveTo(
    centerX - tongueWidth / 2,
    height - heightPx * 0.35,
    centerX - tongueWidth / 3,
    height - heightPx * 0.85,
    centerX,
    height - heightPx,
  );
  ctx.bezierCurveTo(
    centerX + tongueWidth / 3,
    height - heightPx * 0.85,
    centerX + tongueWidth / 2,
    height - heightPx * 0.35,
    centerX,
    height,
  );
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Draws the full flame column: tongues over a constant warm bottom band. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
): void {
  ctx.globalCompositeOperation = "lighter";
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < TONGUES; i += 1) {
    drawTongue(ctx, width, height, nowMs, i, TONGUES);
  }

  const band = ctx.createLinearGradient(0, height, 0, height - height * 0.16);
  band.addColorStop(0, "rgba(255, 94, 0, 0.25)");
  band.addColorStop(1, "rgba(255, 94, 0, 0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, height - height * 0.16, width, height * 0.16);

  ctx.globalCompositeOperation = "source-over";
}

export class EmberLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private running = false;
  private observer: ResizeObserver | null = null;

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
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private frame(now: number): void {
    if (!this.running || this.ctx === null) {
      return;
    }
    drawFrame(this.ctx, this.canvas.width, this.canvas.height, now);
    this.raf = requestAnimationFrame((then) => this.frame(then));
  }
}
