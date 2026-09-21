/**
 * WebGPU background renderer built on TypeGPU (TS-first WGSL).
 *
 * Paints the entire background as slow orange streams of light flowing
 * through swirling turbulence. This module is only ever loaded via dynamic
 * `import()` from `FirePanels`, so browsers without WebGPU never download the
 * TypeGPU chunk. Any failure here degrades to `null` and the caller rolls back
 * to the ember canvas.
 */
import { common, d, std, tgpu } from "typegpu";
import type { TgpuRoot } from "typegpu";
import type { v2f } from "typegpu/data";

import { fitCanvasSize } from "./canvasSize";
import { fireTuning } from "./fireTuning";

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
 * Creates a background fire pipeline on the given canvas and starts rendering
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
    // Live tuning knobs for the `?fire=` experiment panel (see fireTuning).
    const tuneA = root.createUniform(
      d.vec4f,
      d.vec4f(fireTuning.flowA, fireTuning.flowB, fireTuning.swirl, fireTuning.warpFreq),
    );
    const bright = root.createUniform(d.f32, fireTuning.bright);
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
        // Live knobs from the experiment panel (rewritten every frame).
        const ta = tuneA.$;
        const brightK = bright.$;
        // Visible uv is [0, 1] × [0, 1] (y down: uv.y = 1 at the NDC
        // bottom); remap to an aspect-corrected [0..aspect] × [0..1] so the
        // flow pattern is uniform across screens.
        const base = d.vec2f(uv.x * (size.x / size.y), uv.y);

        // Fast-evolving turbulence — a single shared noise sample.
        const warp = valueNoise(
          std.add(
            std.mul(base, d.vec2f(ta.w, ta.w)),
            d.vec2f(std.sin(t * 0.22) * 0.5, std.sin(t * 0.18) * 0.45),
          ),
        );

        // Large-scale slow swirl: rotate the sampling domain around the
        // screen center so currents curl into each other (cos via a sin
        // shift). The edge falloff below shares the center, so it is
        // unaffected by the rotation.
        const swirlA = std.add(std.mul(t, ta.z), std.mul(warp, 2.5));
        const swirlC = std.sin(std.add(swirlA, 1.5708));
        const swirlS = std.sin(swirlA);
        const swirlX = std.sub(base.x, std.mul(size.x / size.y, 0.5));
        const swirlY = std.sub(base.y, 0.5);
        const st = d.vec2f(
          std.add(
            std.sub(std.mul(swirlC, swirlX), std.mul(swirlS, swirlY)),
            std.mul(size.x / size.y, 0.5),
          ),
          std.add(std.add(std.mul(swirlS, swirlX), std.mul(swirlC, swirlY)), 0.5),
        );

        // Dark ember base, faintly breathing with the turbulence.
        let color = std.mul(d.vec3f(0.026, 0.01, 0.004), std.add(1, std.mul(warp, 1.5)));

        // Long magic streams flowing across the screen: noise stretched along
        // x, sharpened into thin currents, riding the shared turbulence.
        const flowA = valueNoise(
          std.add(
            std.add(std.mul(st, d.vec2f(1.6, 7.0)), d.vec2f(std.mul(t, ta.x), std.mul(t, 0.02))),
            d.vec2f(std.mul(warp, 1.6), std.mul(warp, 0.9)),
          ),
        );
        const bandA = std.smoothstep(0.52, 0.92, flowA);
        const streamA = std.mul(bandA, bandA);
        color = std.add(
          color,
          std.mul(d.vec3f(0.95, 0.42, 0.08), std.mul(streamA, std.mul(0.55, brightK))),
        );

        const flowB = valueNoise(
          std.sub(
            std.add(
              std.mul(st, d.vec2f(2.3, 11.0)),
              d.vec2f(std.mul(warp, 1.6), std.mul(warp, 0.9)),
            ),
            d.vec2f(std.mul(t, ta.y), std.mul(t, 0.03)),
          ),
        );
        const bandB = std.smoothstep(0.58, 0.95, flowB);
        const streamB = std.mul(bandB, bandB);
        color = std.add(
          color,
          std.mul(d.vec3f(0.7, 0.25, 0.05), std.mul(streamB, std.mul(0.4, brightK))),
        );

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
      tuneA.write(
        d.vec4f(fireTuning.flowA, fireTuning.flowB, fireTuning.swirl, fireTuning.warpFreq),
      );
      bright.write(fireTuning.bright);
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
