/**
 * Display list to Canvas 2D.
 *
 * **This module draws what it is given and derives nothing** (ADR-003). It does
 * no arithmetic on a model value beyond the camera transform: no bay pitch, no
 * clear width, no run length. If a dimension is not in the display list, it does
 * not appear — which is the rule that keeps a preview from disagreeing with a
 * plot.
 *
 * It also never formats a number. Every string it prints arrives as a
 * `DisplayText` carrying `established`, and an unestablished one is drawn as
 * `VERIFY` (AC-07). A renderer that called a formatter would be the exact defect
 * ADR-003's amendment records — the elevation printing a real-looking
 * `25'-2"` while the panel beside it said VERIFY for the same quantity.
 */

import type { DisplayItem, DisplayList } from '@rms/display-list';

import { visibleWorldBounds, worldToScreen, type Camera, type Viewport } from './camera.js';

/** Colours are passed in, resolved from CSS custom properties by the caller. */
export interface Pens {
  readonly background: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly upright: string;
  readonly beam: string;
  /** A unit load, drawn at its true footprint including overhang. */
  readonly unitLoad: string;
  /** A flue space. Distinct from the aisle pen: they are different clearances. */
  readonly flue: string;
  readonly aisle: string;
  readonly obstruction: string;
  readonly noRackZone: string;
  readonly selection: string;
  readonly unestablished: string;
}

export interface DrawOptions {
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly pens: Pens;
  /** Device pixel ratio. Re-read on every draw; a window can move screens. */
  readonly dpr: number;
  readonly selectedIds?: ReadonlySet<string>;
}

/** What the last draw put on screen. Returned so a test can assert culling. */
export interface DrawResult {
  readonly drawn: number;
  readonly culled: number;
}

const penFor = (item: DisplayItem['item'], pens: Pens): string => {
  switch (item) {
    case 'upright':
      return pens.upright;
    case 'beam':
      return pens.beam;
    case 'unit-load':
      return pens.unitLoad;
    case 'flue':
      return pens.flue;
    case 'aisle':
      return pens.aisle;
    case 'obstruction':
      return pens.obstruction;
    case 'no-rack-zone':
      return pens.noRackZone;
    case 'annotation':
      return pens.inkMuted;
  }
};

/** The bounding box of an item in world space, for culling. */
function boundsOf(item: DisplayItem): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (item.kind) {
    case 'rect':
      return {
        minX: item.origin.x,
        minY: item.origin.y,
        maxX: item.origin.x + item.width,
        maxY: item.origin.y + item.height,
      };
    case 'line':
    case 'dimension':
      return {
        minX: Math.min(item.from.x, item.to.x),
        minY: Math.min(item.from.y, item.to.y),
        maxX: Math.max(item.from.x, item.to.x),
        maxY: Math.max(item.from.y, item.to.y),
      };
    case 'text':
      return { minX: item.at.x, minY: item.at.y, maxX: item.at.x, maxY: item.at.y };
  }
}

/**
 * The string to print for a display text.
 *
 * One function, one rule, one place. `established: false` prints VERIFY and the
 * value is not consulted at all — not shown in brackets, not shown greyed. A
 * number a reader can see is a number a reader will use.
 */
export function label(text: { readonly text: string; readonly established: boolean }): string {
  return text.established ? text.text : 'VERIFY';
}

export function draw(
  ctx: CanvasRenderingContext2D,
  list: DisplayList,
  options: DrawOptions,
): DrawResult {
  const { camera, viewport, pens, dpr } = options;
  const selected = options.selectedIds ?? new Set<string>();

  // The backing store is device pixels; everything below is in CSS pixels.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pens.background;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const view = visibleWorldBounds(camera, viewport);
  let drawn = 0;
  let culled = 0;

  ctx.lineJoin = 'miter';
  ctx.textBaseline = 'middle';

  for (const item of list.items) {
    const b = boundsOf(item);
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) {
      culled += 1;
      continue;
    }
    drawn += 1;

    const isSelected = selected.has(item.id);
    const pen = isSelected ? pens.selection : penFor(item.item, pens);

    switch (item.kind) {
      case 'rect': {
        const tl = worldToScreen(camera, viewport, item.origin);
        const w = item.width * camera.scale;
        const h = item.height * camera.scale;
        ctx.fillStyle = pen;
        /*
         * Fill weight by kind. A unit load is an OUTLINE — filling it solid
         * hides the frame beneath and with it the overhang, which is the one
         * thing drawing loads at true footprint exists to show. The aisle and
         * flue washes stay light enough to read dimensions through.
         */
        ctx.globalAlpha =
          item.item === 'unit-load'
            ? 0
            : item.item === 'aisle' || item.item === 'no-rack-zone'
              ? 0.1
              : item.item === 'flue'
                ? 0.3
                : 0.85;
        ctx.fillRect(tl.x, tl.y, w, h);
        ctx.globalAlpha = 1;
        // Hairlines are stroked at a constant device width, not scaled with the
        // camera: a 1 px edge that thickens as you zoom in is a drawing whose
        // line weights mean nothing.
        ctx.strokeStyle = pen;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w, h);
        if (item.label !== null) {
          ctx.fillStyle = item.label.established ? pens.ink : pens.unestablished;
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(label(item.label), tl.x + 4, tl.y + 12);
        }
        break;
      }
      case 'line': {
        const a = worldToScreen(camera, viewport, item.from);
        const z = worldToScreen(camera, viewport, item.to);
        ctx.strokeStyle = pen;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(z.x, z.y);
        ctx.stroke();
        break;
      }
      case 'dimension': {
        const a = worldToScreen(camera, viewport, item.from);
        const z = worldToScreen(camera, viewport, item.to);
        ctx.strokeStyle = pens.inkMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(z.x, z.y);
        ctx.stroke();
        ctx.fillStyle = item.text.established ? pens.ink : pens.unestablished;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(label(item.text), (a.x + z.x) / 2, (a.y + z.y) / 2 - 6);
        break;
      }
      case 'text': {
        const at = worldToScreen(camera, viewport, item.at);
        ctx.fillStyle = item.text.established ? pens.ink : pens.unestablished;
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(label(item.text), at.x, at.y);
        break;
      }
    }
  }

  return { drawn, culled };
}
