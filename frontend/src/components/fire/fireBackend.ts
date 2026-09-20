export type FireBackend = "static" | "webgpu" | "ember";

/**
 * Which renderer the background uses:
 * - reduced motion → static gradient, no animation loop at all;
 * - Windows → ember canvas even with WebGPU present (the shader path has
 *   unresolved driver-specific issues there, while the fallback renders the
 *   same everywhere — revisit once verified on real Windows hardware);
 * - otherwise WebGPU when the browser offers it (a runtime failure degrades
 *   per-panel to the ember canvas);
 * - otherwise the 2D-canvas ember layer.
 */
export function chooseFireBackend(reducedMotion: boolean, gpuAvailable: boolean): FireBackend {
  if (reducedMotion) {
    return "static";
  }
  if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
    return "ember";
  }
  return gpuAvailable ? "webgpu" : "ember";
}
