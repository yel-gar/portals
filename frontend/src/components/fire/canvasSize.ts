/**
 * Backing-store size for the decorative background canvases (WebGPU + 2D).
 * The layer is viewport-sized (`position: fixed`), so the canvas never grows
 * with the document — a document-tall canvas both distorts the spark field
 * (extreme aspect) and can exceed the GPU texture limit. Both renderers draw
 * at half CSS resolution and let the browser upscale: soft dots upscale
 * invisibly while the fill cost quarters. The long side is additionally
 * capped so ultrawide viewports stay worst-case safe.
 */

const MAX_SIDE = 4096;

export interface CanvasSize {
  width: number;
  height: number;
}

/** Backing pixels for a CSS box at the given resolution scale, capped to a safe texture size. */
export function fitCanvasSize(
  cssWidth: number,
  cssHeight: number,
  resolutionScale: number,
): CanvasSize {
  const width = Math.max(1, Math.round(cssWidth * resolutionScale));
  const height = Math.max(1, Math.round(cssHeight * resolutionScale));
  const shrink = Math.min(1, MAX_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * shrink)),
    height: Math.max(1, Math.round(height * shrink)),
  };
}
