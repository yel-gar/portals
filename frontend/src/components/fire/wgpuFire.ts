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
        // A lost device (TDR/driver reset under load) must not freeze the
        // background forever: drop the cached root so the next mount
        // re-initializes (falling back to embers if that fails).
        void device.lost.then(() => {
          rootPromise = null;
          adapterDescription = null;
        });
        return tgpu.initFromDevice({ device });
      } catch {
        return null;
      }
    })();
  }
  return rootPromise;
}

/**
 * Cheap sin-free hash of a 2D point → value in [0, 1). A multiplicative
 * cascade only (`fract`/`mul`/`add`): `sin` of large arguments needs range
 * reduction that is slow on some drivers, and its precision varies per GPU
 * (visible as extra flicker). Identical results everywhere.
 */
const hash21 = (p: v2f): number => {
  "use gpu";
  const h = std.fract(std.add(std.mul(p.x, 0.1031), std.mul(p.y, 0.1097)));
  return std.fract(std.mul(std.add(std.mul(h, h), 19.19), std.add(h, 7.13)));
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
 * Spark centers are constrained to [R, 1 - R] inside their cell, where R is
 * the falloff radius: no dot ever crosses a cell border, so a single tap per
 * pixel is exact (no neighbourhood search, no cut-off square edges).
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
  const cell = std.floor(warped);
  const local = std.fract(warped);
  // One hash feeds every per-cell value (density, center, phase).
  const rand = hash21(std.add(cell, d.vec2f(seed, 0)));
  // Only a fraction of the cells host a spark — keeps the field rarefied.
  const density = std.step(0.62, std.fract(std.mul(rand, 9.17)));
  const R = 0.24;
  const span = std.sub(1, std.add(R, R));
  const cx = std.add(R, std.mul(span, std.fract(std.mul(rand, 7.17))));
  const cy = std.add(R, std.mul(span, std.fract(std.mul(rand, 3.61))));
  const dx = std.sub(local.x, cx);
  const dy = std.sub(local.y, cy);
  // Reversed smoothstep edges are undefined behavior in WGSL (garbage on some
  // drivers, e.g. DirectX — the black squares), so spell the falloff out
  // explicitly.
  const core = std.sub(
    1,
    std.smoothstep(0, R, std.sqrt(std.add(std.mul(dx, dx), std.mul(dy, dy)))),
  );
  // Same gentle twinkle as the 2D fallback: slow, shallow, floored.
  const phase = std.mul(rand, 6.2831);
  const twinkle = std.max(
    0.45,
    std.add(
      0.72,
      std.add(
        std.mul(0.18, std.sin(std.add(std.mul(t, 1.9), phase))),
        std.mul(0.1, std.sin(std.add(std.mul(t, 3.4), std.mul(phase, 1.7)))),
      ),
    ),
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
    // Opaque surface: the shader never outputs partial alpha, so the browser
    // can skip blend work when compositing under the DOM.
    context = root.configureContext({ canvas, alphaMode: "opaque" });
    const time = root.createUniform(d.f32, 0);
    const resolution = root.createUniform(d.vec2f, d.vec2f(1, 1));
    const adapterInfo = adapterDescription ?? "unknown adapter";
    const debug = {
      frames: 0,
      adapter: adapterInfo,
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      // Half CSS resolution: soft dots upscale invisibly while the fill cost
      // quarters every frame and on every recomposite.
      const size = fitCanvasSize(rect.width, rect.height, 0.5);
      // Assigning canvas.width resets the backing store (and the swapchain),
      // so only assign on a real change — e.g. a scrollbar toggling during a
      // data update must not reconfigure mid-frame.
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
        resolution.write(d.vec2f(canvas.width, canvas.height));
      }
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
        // Fractional seeds: integer literals infer i32 and raise conversion
        // warnings at resolve time; the offsets only need distinctness.
        const s1 = sparkLayer(st, t, 15, 0.05, 1, 0.5, warp);
        color = std.add(color, std.mul(d.vec3f(1, 0.62, 0.16), s1));
        const s2 = sparkLayer(st, t, 29, 0.085, 0.5, 3.5, warp);
        color = std.add(color, std.mul(d.vec3f(0.8, 0.4, 0.1), s2));
        const s3 = sparkLayer(st, t, 52, 0.12, 0.26, 6.5, warp);
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
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      // Wrapped to hours: unbounded f32 time loses fractional precision,
      // which shows up as flicker/jitter (the grid math needs the fraction).
      time.write((now / 1000) % 3600);
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
