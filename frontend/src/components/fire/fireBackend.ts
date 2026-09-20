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
