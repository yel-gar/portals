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
