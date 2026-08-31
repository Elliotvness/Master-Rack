/**
 * The renderer-neutral drawing model (blueprint C-06, ADR-003).
 *
 * One display list, three renderers: Canvas 2D for plans, inline SVG for
 * elevations, server-side PDF for documents. The engine emits this once and
 * renderers consume it.
 *
 * The boundary rule that gives it teeth (§8): **a renderer consumes a display
 * list; it may not recompute a dimension.** A drawing must never print a number
 * the model did not produce. If a renderer could do its own arithmetic, every
 * provenance guarantee upstream would be void at the last inch — the screen
 * would be making claims the model never made.
 *
 * Two consequences are built into the types here rather than left to review:
 *
 *   1. Every text entry is a `DisplayText` carrying `{text, established}`,
 *      never a bare string. A bare string has already lost the distinction
 *      between "144 inches" and "we do not know", and by then it is too late to
 *      refuse. An unestablished value renders VERIFY (AC-07).
 *   2. Geometry is carried as integer micrometres in MODEL space. Renderers
 *      apply their own transform. Nothing here is in pixels, because a pixel is
 *      a rendering decision and baking one in is how two renderers drift.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { type DisplayText } from '@rms/kernel-units';

/** A point in model space, integer micrometres. Never pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ItemKind =
  | 'upright'
  | 'beam'
  | 'aisle'
  | 'obstruction'
  | 'no-rack-zone'
  | 'annotation';

/**
 * A drawable item. Deliberately a small closed set: a renderer switches over
 * these and a new shape means editing this union, which is a review point
 * rather than a silent addition.
 */
export type DisplayItem =
  | {
      readonly kind: 'rect';
      readonly item: ItemKind;
      readonly id: string;
      readonly origin: Point;
      readonly width: number;
      readonly height: number;
      /** Optional label. Carries its own establishment flag. */
      readonly label: DisplayText | null;
    }
  | {
      readonly kind: 'line';
      readonly item: ItemKind;
      readonly id: string;
      readonly from: Point;
      readonly to: Point;
    }
  | {
      /**
       * A witnessed dimension: the two points it spans, plus the text. Ported
       * in spirit from `rack-engine/ui_kit.elevation_svg`, whose dimensions are
       * every one a witnessed model value rather than a drawn guess.
       */
      readonly kind: 'dimension';
      readonly item: 'annotation';
      readonly id: string;
      readonly from: Point;
      readonly to: Point;
      readonly text: DisplayText;
    }
  | {
      readonly kind: 'text';
      readonly item: 'annotation';
      readonly id: string;
      readonly at: Point;
      readonly text: DisplayText;
    };

export type ViewKind = 'plan' | 'elevation';

export interface DisplayList {
  readonly view: ViewKind;
  /** Model-space extent, so a renderer can fit without measuring the items. */
  readonly extent: { readonly width: number; readonly height: number };
  readonly items: readonly DisplayItem[];
  /**
   * The revision this was derived from. A renderer showing a display list
   * alongside a different revision's numbers is a bug worth making detectable.
   */
  readonly revisionHash: string;
}

export class DisplayListError extends Error {
  override readonly name = 'DisplayListError';
}

function assertIntegerUm(value: number, what: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new DisplayListError(
      `${what} must be an integer micrometre value, got ${String(value)} — ` +
        'a fractional model coordinate means someone converted to pixels early',
    );
  }
}

function assertPoint(p: Point, what: string): void {
  assertIntegerUm(p.x, `${what}.x`);
  assertIntegerUm(p.y, `${what}.y`);
}

export function point(x: number, y: number): Point {
  assertIntegerUm(x, 'point.x');
  assertIntegerUm(y, 'point.y');
  return Object.freeze({ x, y });
}

export function rect(input: {
  readonly item: ItemKind;
  readonly id: string;
  readonly origin: Point;
  readonly width: number;
  readonly height: number;
  readonly label?: DisplayText | null;
}): DisplayItem {
  assertPoint(input.origin, 'rect.origin');
  assertIntegerUm(input.width, 'rect.width');
  assertIntegerUm(input.height, 'rect.height');
  if (input.width < 0 || input.height < 0) {
    throw new DisplayListError(`rect '${input.id}' has a negative dimension`);
  }
  return Object.freeze({
    kind: 'rect' as const,
    item: input.item,
    id: input.id,
    origin: input.origin,
    width: input.width,
    height: input.height,
    label: input.label ?? null,
  });
}

export function line(input: {
  readonly item: ItemKind;
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
}): DisplayItem {
  assertPoint(input.from, 'line.from');
  assertPoint(input.to, 'line.to');
  return Object.freeze({
    kind: 'line' as const,
    item: input.item,
    id: input.id,
    from: input.from,
    to: input.to,
  });
}

/**
 * A witnessed dimension. The text is a `DisplayText`, so a dimension whose
 * value the model cannot establish draws its witness lines and prints VERIFY
 * rather than silently omitting itself — an absent dimension reads as "not
 * applicable", which is a different claim from "not known".
 */
export function dimension(input: {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  readonly text: DisplayText;
}): DisplayItem {
  assertPoint(input.from, 'dimension.from');
  assertPoint(input.to, 'dimension.to');
  return Object.freeze({
    kind: 'dimension' as const,
    item: 'annotation' as const,
    id: input.id,
    from: input.from,
    to: input.to,
    text: input.text,
  });
}

export function text(input: {
  readonly id: string;
  readonly at: Point;
  readonly text: DisplayText;
}): DisplayItem {
  assertPoint(input.at, 'text.at');
  return Object.freeze({
    kind: 'text' as const,
    item: 'annotation' as const,
    id: input.id,
    at: input.at,
    text: input.text,
  });
}

export function displayList(input: {
  readonly view: ViewKind;
  readonly extent: { readonly width: number; readonly height: number };
  readonly items: readonly DisplayItem[];
  readonly revisionHash: string;
}): DisplayList {
  assertIntegerUm(input.extent.width, 'extent.width');
  assertIntegerUm(input.extent.height, 'extent.height');
  if (input.revisionHash.trim() === '') {
    throw new DisplayListError(
      'a display list must name the revision it was derived from, so a renderer ' +
        'cannot pair it with another revision\u2019s numbers',
    );
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) {
      throw new DisplayListError(`duplicate display item id '${item.id}'`);
    }
    seen.add(item.id);
  }
  return Object.freeze({
    view: input.view,
    extent: Object.freeze({ ...input.extent }),
    items: Object.freeze([...input.items]),
    revisionHash: input.revisionHash,
  });
}

/* ------------------------------------------------------------------ *
 * Queries a renderer or a test may ask.
 * ------------------------------------------------------------------ */

/** Every text-bearing entry, whatever its shape. */
export function textEntries(list: DisplayList): readonly DisplayText[] {
  const out: DisplayText[] = [];
  for (const item of list.items) {
    if (item.kind === 'dimension' || item.kind === 'text') {
      out.push(item.text);
    } else if (item.kind === 'rect' && item.label !== null) {
      out.push(item.label);
    }
  }
  return Object.freeze(out);
}

/**
 * Every entry whose value the model could not establish.
 *
 * This is the predicate `AC-07` is asserted with: none of these may render as
 * a numeral, in the UI, in the display list, or in a PDF.
 */
export function unestablishedEntries(list: DisplayList): readonly DisplayText[] {
  return Object.freeze(textEntries(list).filter((e) => !e.established));
}

/** Items of one kind, in list order. */
export function itemsOfKind(list: DisplayList, kind: ItemKind): readonly DisplayItem[] {
  return Object.freeze(list.items.filter((i) => i.item === kind));
}
