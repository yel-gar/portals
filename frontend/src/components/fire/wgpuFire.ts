/**
 * WebGPU fire renderer built on TypeGPU (TS-first WGSL).
 *
 * This module is only ever loaded via dynamic `import()` from `FirePanels`,
 * so browsers without WebGPU never download the TypeGPU chunk. Any failure
 * here degrades to `null` and the caller rolls back to the ember canvas.
 */
import { common, d, std, tgpu } from "typegpu";
import type { TgpuRoot } from "typegpu";
import type { v2f } from "typegpu/data";

export interface WgpuFireHandle {
  stop(): void;
}

// One device per page — both side panels draw through it.
let rootPromise: Promise<TgpuRoot | null> | null = null;
let rootUsers = 0;

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

/** Four-octave fractal Brownian motion in roughly [0, 1). */
const fbm = (seed: v2f): number => {
  "use gpu";
  let total = 0;
  let amplitude = 0.5;
  // A fresh vector copy — WGSL references cannot seed a `let` binding.
  let pos = d.vec2f(seed.x, seed.y);
  for (let octave = 0; octave < 4; octave += 1) {
    total += amplitude * valueNoise(pos);
    amplitude *= 0.5;
    pos = std.mul(pos, 2);
  }
  return total;
};

/**
 * Creates a fire pipeline on the given canvas and starts rendering frames.
 * Returns `null` (after cleanup) when WebGPU is unavailable or fails to init.
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

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  };

  try {
    // Premultiplied alpha so transparent flame tips composite over the page.
    context = root.configureContext({ canvas, alphaMode: "premultiplied" });
    const time = root.createUniform(d.f32, 0);
    const pipeline = root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: ({ uv }) => {
        "use gpu";
        // uv spans [0, 2] × [0, 1] (y down); remap to a centered bottom-up frame.
        const t = time.$;
        const x = uv.x - 1;
        const u = 1 - uv.y;

        // Upward-scrolling value noise shaped into flame tongues.
        const noise = fbm(d.vec2f(x * 2.4 + std.sin(t * 0.9) * 0.1, u * 6 - t * 1.35));
        const flame = std.smoothstep(0.05, 0.3, noise - (1 - u));
        const core = std.smoothstep(0.55, 0.95, flame) * (1 - std.abs(x) * 0.4);

        const ember = d.vec3f(0.4, 0.05, 0);
        const orange = d.vec3f(1, 0.47, 0.06);
        const hot = d.vec3f(1, 0.94, 0.6);
        const color = std.mix(std.mix(ember, orange, flame), hot, core);

        // Fade toward the strip borders and the top edge.
        const alpha = flame * std.smoothstep(1, 0.45, std.abs(x)) * std.smoothstep(0.92, 0.4, u);
        return d.vec4f(color, alpha);
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
        }
      },
    };
  } catch {
    observer?.disconnect();
    return null;
  }
}
