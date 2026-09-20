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

export interface WgpuFireHandle {
  stop(): void;
}

// One device per page — the background layer draws through it.
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

/**
 * Brightness of one rarefied spark layer covering the whole canvas. Each cell
 * of a hash grid may host one soft particle; `warp` nudges the sampled
 * position so the whole field shimmers with the shared turbulence.
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
  // The field scrolls upward continuously: subtracting `t * speed` keeps the
  // grid glued to the flow, so sparks never pop while crossing cell borders.
  const grid = std.mul(std.sub(st, d.vec2f(0, std.mul(t, speed))), scale);
  const jitter = std.mul(std.sub(std.mul(warp, 2), 1), 0.5);
  const warped = std.add(grid, d.vec2f(jitter, std.mul(jitter, 0.5)));
  const cell = std.floor(warped);
  const local = std.fract(warped);
  const rand = hash21(std.add(cell, d.vec2f(seed, 0)));
  // Only a fraction of the cells host a spark — keeps the field rarefied.
  const density = std.step(0.62, hash21(std.add(cell, d.vec2f(std.add(seed, 7.3), 3.7))));
  const cx = std.fract(std.mul(rand, 7.17));
  const cy = std.fract(std.mul(rand, 3.61));
  const dx = std.sub(local.x, cx);
  const dy = std.sub(local.y, cy);
  const core = std.smoothstep(0.32, 0, std.sqrt(std.add(std.mul(dx, dx), std.mul(dy, dy))));
  const twinkle = std.add(
    0.4,
    std.mul(0.6, std.sin(std.add(std.mul(t, std.add(4, std.mul(rand, 8))), std.mul(rand, 29)))),
  );
  return std.mul(std.mul(std.mul(core, density), twinkle), gain);
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

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      resolution.write(d.vec2f(canvas.width, canvas.height));
    };

    const pipeline = root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: ({ uv }) => {
        "use gpu";
        const t = time.$;
        const size = resolution.$;
        // uv spans [0, 2] × [0, 1] (y down); remap to an aspect-corrected
        // [0..aspect] × [0..1] so the spark density is uniform across screens.
        const st = d.vec2f(uv.x * 0.5 * (size.x / size.y), uv.y);

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

        // Soft elliptical falloff keeps the corners calm.
        const edge = std.smoothstep(
          1.6,
          0.55,
          std.length(std.sub(st, d.vec2f(size.x / (size.y * 2), 0.5))),
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
