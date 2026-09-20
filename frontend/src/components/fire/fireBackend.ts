export type FireBackend = "static" | "webgpu" | "ember";

/**
 * Explicit `?fire=` query override for A/B testing the background without
 * code changes (e.g. `?fire=webgpu` forces the shader on Windows). Wins over
 * every heuristic below, reduced motion included.
 */
function queryOverride(): FireBackend | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("fire");
  return value === "webgpu" || value === "ember" || value === "static" ? value : null;
}

/**
 * Which renderer the background uses:
 * - explicit `?fire=` override wins over everything (escape hatch, e.g.
 *   `?fire=ember` forces the fallback);
 * - reduced motion → static gradient, no animation loop at all;
 * - otherwise WebGPU when the browser offers it (a runtime failure degrades
 *   per-panel to the ember canvas);
 * - otherwise the 2D-canvas ember layer.
 */
export function chooseFireBackend(reducedMotion: boolean, gpuAvailable: boolean): FireBackend {
  const override = queryOverride();
  if (override !== null) {
    return override;
  }
  if (reducedMotion) {
    return "static";
  }
  return gpuAvailable ? "webgpu" : "ember";
}
