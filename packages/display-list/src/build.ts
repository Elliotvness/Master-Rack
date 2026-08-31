/**
 * Building plan and elevation display lists from derived geometry.
 *
 * These functions do NO derivation. Every dimension they draw arrives as a
 * provenanced `Quantity` from `kernel-derive`, and every number they print goes
 * through `displayText()`, so an unestablished value becomes VERIFY rather than
 * a numeral. That is the whole point: the builder cannot invent a number
 * because it never does arithmetic on a raw one.
 *
 * The elevation follows `rack-engine/ui_kit.elevation_svg`'s good ideas —
 * one scale on both axes, every dimension a witnessed model value — rebuilt as
 * a display list rather than string-concatenated SVG.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { convert, displayText, type Quantity } from '@rms/kernel-units';

import {
  type DisplayItem,
  type DisplayList,
  dimension,
  displayList,
  line,
  point,
  rect,
  text,
} from './model.js';

/** One run, as the display layer receives it. All lengths provenanced. */
export interface RunGeometry {
  readonly runId: string;
  /** Distance from the front face of the run to the origin. */
  readonly offsetX: Quantity;
  readonly offsetY: Quantity;
  readonly bays: number;
  /** Centre-to-centre bay pitch, from kernel-derive. */
  readonly bayPitch: Quantity;
  /** Overall run length, from kernel-derive (the n+1-upright rule). */
  readonly runLength: Quantity;
  /** Frame depth, drawn as the run's thickness in plan. */
  readonly frameDepth: Quantity;
  readonly uprightFace: Quantity;
}

export interface AisleGeometry {
  readonly aisleId: string;
  readonly offsetX: Quantity;
  readonly offsetY: Quantity;
  readonly length: Quantity;
  /** Clear width between load faces (ADR-006 datum). Null when not derivable. */
  readonly clearWidth: Quantity | null;
}

/**
 * Model-space micrometres for a length.
 *
 * No integer check is performed here, and deliberately so: `kernel-units`
 * stores every length as an integer count of micrometres, and µm has scale 1,
 * so `convert(q, 'um')` is exact by construction. A guard here would be
 * unreachable code implying a doubt the type system has already settled — and
 * an unreachable guard is worse than none, because it suggests the invariant is
 * uncertain when it is not.
 */
function um(q: Quantity): number {
  return convert(q, 'um');
}

/**
 * The plan view: runs as rectangles, aisles annotated with their clear width.
 *
 * An aisle whose clear width the model cannot establish still draws, and still
 * carries a dimension — printing VERIFY. Omitting it would read as "no aisle
 * dimension applies", which is a different claim from "we cannot state it".
 */
export function buildPlan(input: {
  readonly revisionHash: string;
  readonly runs: readonly RunGeometry[];
  readonly aisles: readonly AisleGeometry[];
  readonly extent: { readonly width: Quantity; readonly height: Quantity };
}): DisplayList {
  const items: DisplayItem[] = [];

  for (const run of input.runs) {
    const x = um(run.offsetX);
    const y = um(run.offsetY);
    const length = um(run.runLength);
    const depth = um(run.frameDepth);

    items.push(
      rect({
        item: 'upright',
        id: `${run.runId}:body`,
        origin: point(x, y),
        width: length,
        height: depth,
        label: displayText(run.runLength),
      }),
    );

    // Bay divisions. The n+1 rule is kernel-derive's, and it shows here: a run
    // of n bays draws n+1 upright lines, not n.
    const pitch = um(run.bayPitch);
    for (let i = 0; i <= run.bays; i += 1) {
      const at = x + i * pitch;
      items.push(
        line({
          item: 'upright',
          id: `${run.runId}:upright:${i}`,
          from: point(at, y),
          to: point(at, y + depth),
        }),
      );
    }

    items.push(
      dimension({
        id: `${run.runId}:dim:length`,
        from: point(x, y - 100_000),
        to: point(x + length, y - 100_000),
        text: displayText(run.runLength, { metric: true }),
      }),
    );
  }

  for (const aisle of input.aisles) {
    const x = um(aisle.offsetX);
    const y = um(aisle.offsetY);
    const length = um(aisle.length);

    // An aisle with no established clear width still draws, and its dimension
    // prints VERIFY. This is AC-07 at the drawing layer.
    const widthText =
      aisle.clearWidth === null
        ? Object.freeze({ text: 'VERIFY', established: false })
        : displayText(aisle.clearWidth, { metric: true });

    const drawnWidth = aisle.clearWidth === null ? 0 : um(aisle.clearWidth);

    items.push(
      rect({
        item: 'aisle',
        id: `${aisle.aisleId}:body`,
        origin: point(x, y),
        width: length,
        height: drawnWidth,
        label: widthText,
      }),
      dimension({
        id: `${aisle.aisleId}:dim:clear`,
        from: point(x, y),
        to: point(x, y + drawnWidth),
        text: widthText,
      }),
    );
  }

  return displayList({
    view: 'plan',
    extent: {
      width: um(input.extent.width),
      height: um(input.extent.height),
    },
    items,
    revisionHash: input.revisionHash,
  });
}

export interface LevelGeometry {
  readonly levelId: string;
  readonly elevation: Quantity;
  readonly load: Quantity | null;
}

/**
 * The elevation: one bay in section, with a witnessed dimension per level.
 *
 * One scale on both axes is the renderer's responsibility, but it is possible
 * only because everything here is in one unit — which is why the model carries
 * micrometres rather than each view choosing its own.
 */
export function buildElevation(input: {
  readonly revisionHash: string;
  readonly runId: string;
  readonly frameHeight: Quantity;
  readonly bayPitch: Quantity;
  readonly levels: readonly LevelGeometry[];
}): DisplayList {
  const items: DisplayItem[] = [];
  const height = um(input.frameHeight);
  const width = um(input.bayPitch);

  items.push(
    line({
      item: 'upright',
      id: `${input.runId}:upright:left`,
      from: point(0, 0),
      to: point(0, height),
    }),
    line({
      item: 'upright',
      id: `${input.runId}:upright:right`,
      from: point(width, 0),
      to: point(width, height),
    }),
  );

  for (const level of input.levels) {
    const y = um(level.elevation);
    items.push(
      line({
        item: 'beam',
        id: `${level.levelId}:beam`,
        from: point(0, y),
        to: point(width, y),
      }),
      // Witnessed from the floor datum, not from the level below: a chain of
      // relative dimensions accumulates the reader's error, and the elevation
      // that matters is always from the slab.
      dimension({
        id: `${level.levelId}:dim:elevation`,
        from: point(-100_000, 0),
        to: point(-100_000, y),
        text: displayText(level.elevation, { metric: true }),
      }),
    );

    // A level with no stated load prints VERIFY rather than nothing, so the
    // sheet shows that a load was expected and is not known.
    const loadText =
      level.load === null
        ? Object.freeze({ text: 'VERIFY', established: false })
        : displayText(level.load);
    items.push(
      text({
        id: `${level.levelId}:load`,
        at: point(width, y),
        text: loadText,
      }),
    );
  }

  return displayList({
    view: 'elevation',
    extent: { width, height },
    items,
    revisionHash: input.revisionHash,
  });
}
