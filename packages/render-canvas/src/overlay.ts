/**
 * Screen-space overlays: legend, scale bar, north arrow, interaction hint.
 *
 * These live in **screen space**, not world space, and that is the whole reason
 * they are here rather than in the display list. A legend that scaled with the
 * camera would be unreadable at overview zoom and enormous at bay zoom; a scale
 * bar that scaled with the camera would measure nothing.
 *
 * They are drawn AFTER the world, so culling never reaches them.
 *
 * **The scale bar is the one thing here that states a measurement**, so it is
 * derived rather than drawn to a nominal length: a round number of feet is
 * chosen from the current camera scale and the BAR is sized to match it. The
 * alternative — a fixed-width bar labelled with whatever it happens to span —
 * produces "0.37 ft" captions and a ruler nobody can use.
 *
 * Pure of derivation in the sense that matters: it computes nothing about the
 * RACK. It converts pixels to feet for its own ruler and nothing else.
 */

import type { Camera, Viewport } from './camera.js';
import type { Pens } from './draw.js';

export interface OverlayOptions {
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly pens: Pens;
  readonly dpr: number;
}

const MICROMETRES_PER_FOOT = 304_800;

/** Legend entries, in the artifact's order. */
const LEGEND: readonly { readonly label: string; readonly pen: keyof Pens }[] = Object.freeze([
  { label: 'Upright', pen: 'upright' },
  { label: 'Beam', pen: 'beam' },
  { label: 'Unit load', pen: 'unitLoad' },
  { label: 'Flue', pen: 'flue' },
  { label: 'Clear between loads', pen: 'aisle' },
  { label: 'Dimension', pen: 'inkMuted' },
]);

/**
 * The shortest bar worth drawing, in CSS pixels.
 *
 * A bar needs a LOWER bound as well as an upper one, and the first draft had
 * only the upper: at a very small scale every step in the sequence "fits", so
 * it chose 1000 ft and returned a bar **0.3 pixels long**. A ruler nobody can
 * see is worse than no ruler, because the caption still claims a distance.
 */
const MIN_BAR_PIXELS = 40;

/**
 * A round number of feet for the scale bar, and the pixels it occupies.
 *
 * Steps through a 1-2-5 sequence so the caption is always a number a person
 * reads off a drawing — 5 ft, 20 ft, 100 ft — never 37 ft. Returns null when no
 * step lands between `MIN_BAR_PIXELS` and `maxPixels`, and the caller draws
 * nothing rather than a bar of unusable length.
 */
export function chooseScale(
  scale: number,
  maxPixels: number,
): { readonly feet: number; readonly pixels: number } | null {
  if (!Number.isFinite(scale) || scale <= 0 || maxPixels < MIN_BAR_PIXELS) return null;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let best: { feet: number; pixels: number } | null = null;
  for (const feet of steps) {
    const pixels = feet * MICROMETRES_PER_FOOT * scale;
    if (pixels <= maxPixels && pixels >= MIN_BAR_PIXELS) best = { feet, pixels };
  }
  return best;
}

export function drawOverlays(ctx: CanvasRenderingContext2D, options: OverlayOptions): void {
  const { camera, viewport, pens, dpr } = options;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.font = '11px system-ui, sans-serif';

  // --- legend, bottom left ------------------------------------------------
  const swatch = 14;
  const gap = 10;
  const legendY = viewport.height - 18;
  let x = 12;
  for (const entry of LEGEND) {
    ctx.strokeStyle = pens[entry.pen];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, legendY);
    ctx.lineTo(x + swatch, legendY);
    ctx.stroke();
    x += swatch + 4;
    ctx.fillStyle = pens.inkMuted;
    ctx.fillText(entry.label, x, legendY);
    x += ctx.measureText(entry.label).width + gap;
  }

  // --- scale bar, above the legend ---------------------------------------
  const bar = chooseScale(camera.scale, Math.min(180, viewport.width / 4));
  if (bar !== null) {
    const y = legendY - 22;
    ctx.strokeStyle = pens.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(12 + bar.pixels, y);
    // End ticks, so the bar reads as a measured span rather than a rule.
    ctx.moveTo(12, y - 4);
    ctx.lineTo(12, y + 4);
    ctx.moveTo(12 + bar.pixels, y - 4);
    ctx.lineTo(12 + bar.pixels, y + 4);
    ctx.stroke();
    ctx.fillStyle = pens.inkMuted;
    ctx.fillText('0', 12, y + 12);
    ctx.fillText(`${bar.feet} ft`, 12 + bar.pixels + 6, y);
  }

  // --- north arrow, top right --------------------------------------------
  const nx = viewport.width - 26;
  const ny = 30;
  ctx.strokeStyle = pens.ink;
  ctx.fillStyle = pens.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(nx, ny + 14);
  ctx.lineTo(nx, ny - 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nx, ny - 16);
  ctx.lineTo(nx - 5, ny - 6);
  ctx.lineTo(nx + 5, ny - 6);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillText('N', nx, ny + 24);
  ctx.textAlign = 'left';

  // --- interaction hint, bottom right ------------------------------------
  //
  // "Click a bay or aisle to select" is DELIBERATELY absent: selection is S4 and
  // does not exist. A hint naming an interaction the build does not have is a
  // small false claim, and it is the kind that erodes trust in the rest.
  const hint = 'DRAG TO PAN · SCROLL TO ZOOM';
  ctx.fillStyle = pens.inkMuted;
  ctx.textAlign = 'right';
  ctx.fillText(hint, viewport.width - 12, viewport.height - 40);
  ctx.textAlign = 'left';
}
