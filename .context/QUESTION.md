# QUESTION — WebGPU spark background lags on Windows (NVIDIA), fine on Linux

Please diagnose the performance problem described below. All related sources are embedded at the end.

## Setup

- React + Vite SPA, Ant Design UI. Decorative full-viewport background canvas (`position: fixed; inset: 0; z-index: -1`), one instance for the whole app.
- Renderer A (preferred): WebGPU via TypeGPU 0.12.5 (`typegpu`), TS-first WGSL, dynamically imported. Runs when `navigator.gpu` exists and `requestAdapter()` resolves.
- Renderer B (fallback): 2D-canvas ember sparks. Runs when WebGPU is missing/fails, and **always on the Linux machine** (no usable adapter there).
- `prefers-reduced-motion` → static CSS gradient, no loop (not relevant here).
- History: the shader previously had reversed `smoothstep` edges (WGSL UB → black squares on DirectX), a wrong scroll sign (sparks flew down), a wrong UV-range assumption, an integer loop accumulator that truncated all brightness to 0, and a document-tall canvas that exceeded the texture limit. All fixed; boxes gone after switching to 3×3 neighbourhood sampling.

## Current symptoms (Windows, Chrome, NVIDIA adapter)

1. **Lags.** Rendering hitches; also a small freeze every time the dashboard data updates (10 s simulator tick → WebSocket snapshot → table re-render + FLIP row animation; plus aligned 10 s stats/detail REST polls).
2. **No box artifacts anymore** after the 3×3 change. Dots are smaller now (core radius 0.2 of a cell).
3. **On Linux everything is fine, and dots there fly much slower and flicker significantly less.** (Linux runs renderer B, so this may be expected — different code, different constants.)
4. No console errors anymore. There are benign TypeGPU `implicit-conversion` warnings (int→float, value-preserving); they only appear where the shader compiles, i.e. never on Linux.

## Live debug probe (`fireDebug()` in devtools console)

```json
{"requested":"webgpu","active":"webgpu","frames":0,"cssWidth":1717,"cssHeight":1450,"canvasWidth":1717,"canvasHeight":1450,"dpr":0.8999999761581421,"adapter":"nvidia"}
```

(`frames: 0` was captured right at startup; canvas is viewport-sized at DPR 1 by design.)

## Questions

1. What in `wgpuFire.ts` is the most likely per-frame cost driver on DirectX/NVIDIA (9-tap × 3 layers with `sin`/`fract` hashing, `valueNoise`, fullscreen overdraw)? What would you simplify first without visibly changing the look?
2. Is there anything in the frame loop (`time.write`, `resolution.write`, `withColorAttachment(...).draw(3)` per rAF, ResizeObserver) that could stall or re-allocate per frame under Dawn?
3. Could the small freeze on every data update be explained by anything here (e.g. canvas resize/reconfigure racing React commits), or is it more likely React-side (table reconciliation + FLIP forced layout + recomposite over a live canvas)? What measurement would distinguish the two?
4. Linux-vs-Windows speed/flicker difference: is matching renderer A's constants to renderer B's (`speed` 0.025–0.11 heights/s, flicker `0.72 + 0.18·sin(1.9t) + 0.1·sin(3.4t)`) the right way to get parity, or would you parametrize differently?
5. Any TypeGPU 0.12.5-specific gotchas in the code below (uniform updates, `alphaMode: "premultiplied"` with `vec4f(color, 1)`, `fullScreenTriangle` UV conventions)?

## Sources

### `frontend/src/components/fire/wgpuFire.ts`

```ts
/**
 * WebGPU background renderer built on TypeGPU (TS-first WGSL).
 *
 * Paints the entire background as a rarefied field of ember spark particles
 * drifting upward through slow swirling turbulence. This module is only ever
 * loaded via dynamic `import()` from `FirePanels`, so browsers without WebGPU
 * never download the TypeGPU chunk. Any failure here degrades to `null` and
 * the caller rolls back to the ember canvas.
 */
import { common, d, std, tgpu } from "typegpu";
import type { TgpuRoot } from "typegpu";
import type { v2f } from "typegpu/data";

import { fitCanvasSize } from "./canvasSize";

export interface WgpuFireHandle {
  stop(): void;
  /** Live counters for the console debug probe (see `FirePanels.getFireDebug`). */
  debug: {
    frames: number;
    adapter: string;
  };
}

// One device per page — the background layer draws through it.
let rootPromise: Promise<TgpuRoot | null> | null = null;
let rootUsers = 0;
let adapterDescription: string | null = null;

function describeAdapter(info: GPUAdapterInfo): string {
  return info.description || info.device || info.vendor || "unknown adapter";
}

function getRoot(): Promise<TgpuRoot | null> {
  if (rootPromise === null) {
    rootPromise = (async (): Promise<TgpuRoot | null> => {
      try {
        if (typeof navigator === "undefined" || navigator.gpu === undefined) {
          return null;
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter === null) {
          return null;
        }
        adapterDescription = describeAdapter(await adapter.info);
        const device = await adapter.requestDevice();
        return tgpu.initFromDevice({ device });
      } catch {
        return null;
      }
    })();
  }
  return rootPromise;
}

/** Hash of a 2D point → smooth pseudo-random value in [0, 1). */
const hash21 = (p: v2f): number => {
  "use gpu";
  return std.fract(std.sin(std.dot(p, d.vec2f(127.1, 311.7))) * 43758.5453);
};

/** Bilinear value noise in [0, 1). */
const valueNoise = (p: v2f): number => {
  "use gpu";
  const cell = d.vec2f(std.floor(p.x), std.floor(p.y));
  const offset = d.vec2f(std.fract(p.x), std.fract(p.y));
  const blend = std.mul(std.mul(offset, offset), std.sub(3, std.mul(2, offset)));
  const a = hash21(cell);
  const b = hash21(std.add(cell, d.vec2f(1, 0)));
  const c = hash21(std.add(cell, d.vec2f(0, 1)));
  const e = hash21(std.add(cell, d.vec2f(1, 1)));
  return std.mix(std.mix(a, b, blend.x), std.mix(c, e, blend.x), blend.y);
};

/**
 * Brightness of one rarefied spark layer covering the whole canvas. Each cell
 * of a hash grid may host one soft particle; `warp` nudges the sampled
 * position so the whole field shimmers with the shared turbulence.
 *
 * Every pixel considers the 3×3 cells around it and keeps the brightest
 * spark: dots centered near a cell border render whole instead of being cut
 * at the grid line (the visible square edges).
 */
const sparkLayer = (
  st: v2f,
  t: number,
  scale: number,
  speed: number,
  gain: number,
  seed: number,
  warp: number,
): number => {
  "use gpu";
  // The field scrolls upward continuously: adding `t * speed` shifts the
  // sampled window downward in texture space, so on the y-down screen the
  // sparks drift up and never pop while crossing cell borders.
  const grid = std.mul(std.add(st, d.vec2f(0, std.mul(t, speed))), scale);
  const jitter = std.mul(std.sub(std.mul(warp, 2), 1), 0.5);
  const warped = std.add(grid, d.vec2f(jitter, std.mul(jitter, 0.5)));
  const base = std.floor(warped);
  // f32 zero on purpose: a bare `0` literal infers i32 here, and every stored
  // brightness would truncate to an integer (no dots at all).
  let best = std.sub(t, t);
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      const cell = std.add(base, d.vec2f(i, j));
      const rand = hash21(std.add(cell, d.vec2f(seed, 0)));
      // Only a fraction of the cells host a spark — keeps the field rarefied.
      const density = std.step(0.62, hash21(std.add(cell, d.vec2f(std.add(seed, 7.3), 3.7))));
      const cx = std.fract(std.mul(rand, 7.17));
      const cy = std.fract(std.mul(rand, 3.61));
      const shift = std.sub(std.sub(warped, cell), d.vec2f(cx, cy));
      // Reversed smoothstep edges are undefined behavior in WGSL (garbage on
      // some drivers, e.g. DirectX — the black squares), so spell the falloff
      // out explicitly. The core radius stays well below half a cell.
      const core = std.sub(
        1,
        std.smoothstep(
          0,
          0.2,
          std.sqrt(std.add(std.mul(shift.x, shift.x), std.mul(shift.y, shift.y))),
        ),
      );
      const twinkle = std.add(
        0.4,
        std.mul(0.6, std.sin(std.add(std.mul(t, std.add(4, std.mul(rand, 8))), std.mul(rand, 29)))),
      );
      best = std.max(best, std.mul(std.mul(std.mul(core, density), twinkle), gain));
    }
  }
  return best;
};

/**
 * Creates a background spark pipeline on the given canvas and starts rendering
 * frames. Returns `null` (after cleanup) when WebGPU is unavailable or fails
 * to init.
 */
export async function createWgpuFire(canvas: HTMLCanvasElement): Promise<WgpuFireHandle | null> {
  const root = await getRoot();
  if (root === null) {
    return null;
  }

  let stopped = false;
  let raf = 0;
  let observer: ResizeObserver | null = null;
  let context: GPUCanvasContext | null = null;

  try {
    context = root.configureContext({ canvas, alphaMode: "premultiplied" });
    const time = root.createUniform(d.f32, 0);
    const resolution = root.createUniform(d.vec2f, d.vec2f(1, 1));
    const adapterInfo = adapterDescription ?? "unknown adapter";
    const debug = {
      frames: 0,
      adapter: adapterInfo,
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      // Soft embers need no retina density: CSS resolution quarters the fill
      // cost, which matters every frame and on every recomposite.
      const size = fitCanvasSize(rect.width, rect.height, 1);
      canvas.width = size.width;
      canvas.height = size.height;
      resolution.write(d.vec2f(canvas.width, canvas.height));
    };

    const pipeline = root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: ({ uv }) => {
        "use gpu";
        const t = time.$;
        const size = resolution.$;
        // Visible uv is [0, 1] × [0, 1] (y down: uv.y = 1 at the NDC
        // bottom); remap to an aspect-corrected [0..aspect] × [0..1] so the
        // spark density is uniform across screens.
        const st = d.vec2f(uv.x * (size.x / size.y), uv.y);

        // Slow swirling turbulence — a single shared noise sample.
        const warp = valueNoise(
          std.add(
            std.mul(st, d.vec2f(1.35, 1.35)),
            d.vec2f(std.sin(t * 0.21) * 0.35, std.sin(t * 0.17) * 0.3),
          ),
        );

        // Dark ember base, faintly breathing with the turbulence.
        let color = std.mul(d.vec3f(0.026, 0.01, 0.004), std.add(1, std.mul(warp, 1.5)));

        // Three rarefied spark layers — sparse large, medium, dense tiny.
        const s1 = sparkLayer(st, t, 15, 0.05, 1, 0, warp);
        color = std.add(color, std.mul(d.vec3f(1, 0.62, 0.16), s1));
        const s2 = sparkLayer(st, t, 29, 0.085, 0.5, 3, warp);
        color = std.add(color, std.mul(d.vec3f(0.8, 0.4, 0.1), s2));
        const s3 = sparkLayer(st, t, 52, 0.12, 0.26, 6, warp);
        color = std.add(color, std.mul(d.vec3f(0.5, 0.22, 0.05), s3));

        // Soft elliptical falloff keeps the corners calm (spelled without
        // reversed smoothstep edges — those are WGSL undefined behavior).
        const edge = std.sub(
          1,
          std.smoothstep(0.55, 1.6, std.length(std.sub(st, d.vec2f(size.x / (size.y * 2), 0.5)))),
        );
        color = std.mul(color, std.add(0.3, std.mul(edge, 0.7)));

        return d.vec4f(color, 1);
      },
    });

    resize();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    }
    rootUsers += 1;

    const frame = (now: number): void => {
      if (stopped) {
        return;
      }
      time.write(now / 1000);
      if (context !== null) {
        pipeline.withColorAttachment({ view: context }).draw(3);
      }
      debug.frames += 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return {
      stop: () => {
        stopped = true;
        cancelAnimationFrame(raf);
        observer?.disconnect();
        rootUsers -= 1;
        if (rootUsers <= 0) {
          void rootPromise?.then((resolved) => resolved?.destroy());
          rootPromise = null;
          adapterDescription = null;
        }
      },
      debug,
    };
  } catch {
    observer?.disconnect();
    return null;
  }
}
```

### `frontend/src/components/fire/emberLayer.ts` (2D fallback — this is what Linux runs)

```ts
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
      this.observer.observe(canvas);
    }
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(raf);
    this.observer?.disconnect();
    this.observer = null;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Soft embers need no retina density: CSS resolution quarters the fill
    // cost, which matters every frame and on every recomposite.
    const size = fitCanvasSize(rect.width, rect.height, 1);
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
```

### `frontend/src/components/fire/FirePanels.tsx` (mounting + debug probe)

```tsx
import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { EmberLayer } from "./emberLayer";
import { chooseFireBackend, type FireBackend } from "./fireBackend";

interface FirePanelProps {
  backend: FireBackend;
}

/** Live decorative-layer state for console diagnosis — call `fireDebug()` in devtools. */
export interface FireDebugSnapshot {
  requested: FireBackend;
  active: FireBackend;
  frames: number;
  cssWidth: number;
  cssHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  adapter: string | null;
}

let debugReader: (() => FireDebugSnapshot | null) | null = null;

export function getFireDebug(): FireDebugSnapshot | null {
  return debugReader?.() ?? null;
}

function FirePanel({ backend }: FirePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Which backend actually paints the background — WebGPU may fail at init and
  // roll back to the ember canvas. Exposed as a data attribute for tests.
  const [active, setActive] = useState<FireBackend>(backend === "webgpu" ? "ember" : backend);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || backend === "static") {
      return;
    }
    let disposed = false;
    let effect: { stop(): void; debug: { frames: number } } | null = null;
    let resolved: FireBackend = backend === "webgpu" ? "ember" : backend;
    let adapter: string | null = null;

    debugReader = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        requested: backend,
        active: resolved,
        frames: effect?.debug.frames ?? 0,
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        dpr: globalThis.devicePixelRatio ?? 1,
        adapter,
      };
    };

    const report = (): void => {
      console.info("[fire]", JSON.stringify(debugReader?.() ?? null));
    };

    const startEmber = (): void => {
      if (!disposed) {
        const layer = new EmberLayer(canvas);
        layer.start();
        effect = layer;
        resolved = "ember";
        setActive("ember");
        report();
      }
    };

    if (backend === "webgpu") {
      void import("./wgpuFire")
        .then(async ({ createWgpuFire: create }) => {
          const handle = await create(canvas);
          if (disposed) {
            handle?.stop();
            return;
          }
          if (handle !== null) {
            effect = handle;
            adapter = handle.debug.adapter;
            resolved = "webgpu";
            setActive("webgpu");
            report();
          } else {
            startEmber();
          }
        })
        .catch(() => startEmber());
    } else {
      startEmber();
    }

    return () => {
      disposed = true;
      effect?.stop();
    };
  }, [backend]);

  return (
    <aside
      className={`fire-panel${backend === "static" ? " fire-panel--static" : ""}`}
      data-fire-backend={active}
      aria-hidden="true"
    >
      {backend === "static" ? null : <canvas ref={canvasRef} className="fire-panel-canvas" />}
    </aside>
  );
}

/**
 * Decorative full-background layer mounted behind the signed-in layout: a
 * WebGPU spark-particle shader when the browser supports it, a 2D-canvas ember
 * fallback otherwise, and a static gradient under reduced motion.
 */
export function FirePanels() {
  const reduced = usePrefersReducedMotion();
  const backend = chooseFireBackend(
    reduced,
    typeof navigator !== "undefined" && navigator.gpu !== undefined,
  );

  useEffect(() => {
    const scope = window as unknown as { fireDebug?: typeof getFireDebug };
    scope.fireDebug = getFireDebug;
    return () => {
      if (scope.fireDebug === getFireDebug) {
        delete scope.fireDebug;
      }
    };
  }, []);

  return (
    <div className="fire-panels" aria-hidden="true">
      <FirePanel backend={backend} />
    </div>
  );
}
```

### `frontend/src/components/fire/fireBackend.ts` + `canvasSize.ts`

```ts
export type FireBackend = "static" | "webgpu" | "ember";

/**
 * Which renderer the side panels use:
 * - reduced motion → static gradient, no animation loop at all;
 * - otherwise WebGPU when the browser offers it (a runtime failure degrades
 *   per-panel to the ember canvas);
 * - otherwise the 2D-canvas ember layer.
 */
export function chooseFireBackend(reducedMotion: boolean, gpuAvailable: boolean): FireBackend {
  if (reducedMotion) {
    return "static";
  }
  return gpuAvailable ? "webgpu" : "ember";
}
```

```ts
/**
 * Backing-store size for the decorative background canvases (WebGPU + 2D).
 * The layer is viewport-sized (`position: fixed`), so the canvas never grows
 * with the document — a document-tall canvas both distorts the spark field
 * (extreme aspect) and can exceed the GPU texture limit. The long side is
 * additionally capped so ultrawide/retina viewports stay worst-case safe; the
 * browser upscales the small remainder, which is invisible on soft embers.
 */

const MAX_SIDE = 4096;

export interface CanvasSize {
  width: number;
  height: number;
}

/** Device pixels for a CSS box, DPR-aware and capped at the safe texture size. */
export function fitCanvasSize(cssWidth: number, cssHeight: number, dpr: number): CanvasSize {
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  const shrink = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * shrink)),
    height: Math.max(1, Math.round(height * shrink)),
  };
}
```

### `frontend/src/app.css` (fire layer rules)

```css
/* Decorative viewport-fixed spark field: a WebGPU shader (or a 2D-canvas
   ember fallback) painted behind every surface of the signed-in layout,
   sidebar included. `fixed` (not `absolute`) keeps the canvas viewport-sized:
   a document-tall canvas both distorts the spark field and can exceed the GPU
   texture limit on long pages. z-index: -1 keeps it under the translucent
   chrome and cards while it still fills every gap between them, so the whole
   app is framed by the effect. */
.fire-panels {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

.fire-panel {
  position: absolute;
  inset: 0;
}

.fire-panel-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

(TypeGPU 0.12.5, `vite.config.ts` uses `unplugin-typegpu` to compile the TS-first WGSL at build; the `wgpuFire` chunk is lazy-loaded via dynamic `import()` and excluded from the eager vendor chunk. `common.fullScreenTriangle` emits `uv` `(0,1), (2,1), (0,-1)` over NDC `(-1,-1), (3,-1), (-1,3)` — i.e. visible uv is `[0,1]×[0,1]`, y-down.)
