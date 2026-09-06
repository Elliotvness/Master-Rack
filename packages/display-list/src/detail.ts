/**
 * The detailed plan — build-plan **S3.1**.
 *
 * `buildPlan` draws a run as one rectangle with bay divisions. That is enough
 * to show where a run is and nothing else, and a plan that shows only that is
 * plausible without being useful: it cannot show a load overhanging its frame,
 * a flue closing up, or the difference between the two aisle datums.
 *
 * This emits what the drawing actually needs — the frame rows of a back-to-back
 * run, every unit load at its true footprint, the longitudinal flue between the
 * rows, grid bubbles, run labels, and **both** aisle dimensions on separate
 * datums.
 *
 * **It derives nothing.** Every length arrives as a provenanced `Quantity` or as
 * an integer micrometre value already computed by `studio-model.planGeometry`,
 * whose formulas are the prototype's. This module is a translation from
 * geometry to marks, and the moment it computes a dimension it becomes a second
 * place a number can be wrong.
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

const um = (q: Quantity): number => convert(q, 'um');

export interface DetailRow {
  readonly y: number;
  readonly depth: number;
}

export interface DetailBay {
  readonly bayId: string;
  readonly index: number;
  readonly locked: boolean;
  readonly x: number;
  readonly width: number;
}

export interface DetailPallet {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
}

export interface DetailFlue {
  readonly y: number;
  readonly height: number;
  readonly width: Quantity;
}

export interface DetailRun {
  readonly runId: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly runLength: Quantity;
  readonly bayPitch: Quantity;
  readonly uprightFace: number;
  readonly rows: readonly DetailRow[];
  readonly bays: readonly DetailBay[];
  readonly pallets: readonly DetailPallet[];
  readonly longitudinalFlue: DetailFlue | null;
}

export interface DetailAisle {
  readonly aisleId: string;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly frameToFrame: Quantity;
  readonly clearBetweenLoads: Quantity;
}

/**
 * Where the two aisle dimension strings sit across the aisle's depth.
 *
 * The artifact puts frame-to-frame at 28% and clear-between-loads at 68%, and
 * the separation is the point rather than a style choice: two dimensions on one
 * datum read as one measurement disagreeing with itself.
 */
const FRAME_TO_FRAME_AT = 0.28;
const CLEAR_BETWEEN_LOADS_AT = 0.68;

export function buildDetailedPlan(input: {
  readonly revisionHash: string;
  readonly runs: readonly DetailRun[];
  readonly aisles: readonly DetailAisle[];
  readonly extent: { readonly width: Quantity; readonly height: Quantity };
  readonly overallLength: Quantity;
}): DisplayList {
  const items: DisplayItem[] = [];

  for (const run of input.runs) {
    const runLength = um(run.runLength);

    // Frame rows. A back-to-back run is TWO rows with a flue between them, not
    // one solid block — drawing it solid hides the flue entirely.
    for (const [i, row] of run.rows.entries()) {
      items.push(
        rect({
          item: 'upright',
          id: `${run.runId}:row:${i}`,
          origin: point(run.x, row.y),
          width: runLength,
          height: row.depth,
          label: null,
        }),
      );
    }

    // Uprights: n bays close with n+1 uprights (kernel-derive's rule).
    const pitch = um(run.bayPitch);
    for (const row of run.rows) {
      for (let i = 0; i <= run.bays.length; i += 1) {
        const at = run.x + i * pitch;
        items.push(
          line({
            item: 'upright',
            id: `${run.runId}:upright:${row.y}:${i}`,
            from: point(at, row.y),
            to: point(at, row.y + row.depth),
          }),
        );
      }
    }

    // Beams, front and back face of every row.
    for (const row of run.rows) {
      for (const edge of [row.y, row.y + row.depth]) {
        items.push(
          line({
            item: 'beam',
            id: `${run.runId}:beam:${row.y}:${edge}`,
            from: point(run.x, edge),
            to: point(run.x + runLength, edge),
          }),
        );
      }
    }

    // Unit loads, at their true footprint. This is what makes an overhang
    // visible, and an overhang nobody can see is a flue nobody checks.
    for (const p of run.pallets) {
      items.push(
        rect({
          item: 'unit-load',
          id: p.id,
          origin: point(p.x, p.y),
          width: p.width,
          height: p.depth,
          label: null,
        }),
      );
    }

    /*
     * Transverse flues: the gap between adjacent loads along a row, including
     * the wider one at each upright where two bays' end gaps meet.
     *
     * Taken from the LOADS themselves rather than from a separate calculation.
     * A flue derived twice is a flue that can disagree with the loads bounding
     * it, and the whole reason to draw loads at true footprint is so the gap
     * between them is the real one. `plan.ts` derives the width AT AN UPRIGHT;
     * this shows where every flue is.
     *
     * Loads in one row share a y, so grouping by y is the row split.
     */
    const byRow = new Map<number, DetailPallet[]>();
    for (const p of run.pallets) {
      const row = byRow.get(p.y);
      if (row === undefined) byRow.set(p.y, [p]);
      else row.push(p);
    }
    for (const [rowY, group] of byRow) {
      const along = [...group].sort((a, b) => a.x - b.x);
      for (let k = 0; k + 1 < along.length; k += 1) {
        const left = along[k] as DetailPallet;
        const right = along[k + 1] as DetailPallet;
        const x = left.x + left.width;
        const width = right.x - x;
        // Loads that touch leave no flue. Not an error, and not drawn as one.
        if (width <= 0) continue;
        items.push(
          rect({
            item: 'flue',
            id: `${run.runId}:flue:transverse:${rowY}:${k}`,
            origin: point(x, left.y),
            width,
            height: left.depth,
            label: null,
          }),
        );
      }
    }

    if (run.longitudinalFlue !== null) {
      items.push(
        rect({
          item: 'flue',
          id: `${run.runId}:flue:longitudinal`,
          origin: point(run.x, run.longitudinalFlue.y),
          width: runLength,
          height: run.longitudinalFlue.height,
          label: displayText(run.longitudinalFlue.width, { feetInches: true }),
        }),
      );
    }

    // The run label sits outside the footprint, to the left.
    items.push(
      text({
        id: `${run.runId}:label`,
        at: point(run.x - 900_000, (run.rows[0]?.y ?? run.y) + 400_000),
        text: { text: run.label, established: true },
      }),
    );
  }

  // Grid bubbles along the top, one per upright of the longest run.
  const longest = [...input.runs].sort((a, b) => um(b.runLength) - um(a.runLength))[0];
  if (longest !== undefined) {
    const pitch = um(longest.bayPitch);
    const top = Math.min(...input.runs.map((r) => r.rows[0]?.y ?? r.y));
    for (let i = 0; i <= longest.bays.length; i += 1) {
      const at = longest.x + i * pitch;
      items.push(
        text({
          id: `grid:${i}`,
          at: point(at, top - 1_400_000),
          // Column references are letters, as on the artifact and every drawing
          // set: A, B, C … then AA, AB for a run longer than the alphabet.
          text: { text: gridRef(i), established: true },
        }),
        line({
          item: 'annotation',
          id: `grid:tick:${i}`,
          from: point(at, top - 1_100_000),
          to: point(at, top),
        }),
      );
    }
    // Grid spacing, once, between the first two bubbles.
    items.push(
      dimension({
        id: 'grid:pitch',
        from: point(longest.x, top - 1_250_000),
        to: point(longest.x + pitch, top - 1_250_000),
        text: displayText(longest.bayPitch, { feetInches: true }),
      }),
    );
  }

  // Both aisle datums, on separate lines across the aisle.
  for (const aisle of input.aisles) {
    const depth = um(aisle.frameToFrame);
    items.push(
      rect({
        item: 'aisle',
        id: aisle.aisleId,
        origin: point(aisle.x, aisle.y),
        width: aisle.length,
        height: depth,
        label: null,
      }),
      dimension({
        id: `${aisle.aisleId}:frame-to-frame`,
        from: point(aisle.x + aisle.length * 0.12, aisle.y + depth * FRAME_TO_FRAME_AT),
        to: point(aisle.x + aisle.length * 0.42, aisle.y + depth * FRAME_TO_FRAME_AT),
        text: withSuffix(aisle.frameToFrame, 'FRAME TO FRAME'),
      }),
      dimension({
        id: `${aisle.aisleId}:clear-between-loads`,
        from: point(aisle.x + aisle.length * 0.6, aisle.y + depth * CLEAR_BETWEEN_LOADS_AT),
        to: point(aisle.x + aisle.length * 0.9, aisle.y + depth * CLEAR_BETWEEN_LOADS_AT),
        text: withSuffix(aisle.clearBetweenLoads, 'CLEAR BETWEEN LOADS'),
      }),
    );
  }

  // Overall, below everything.
  const bottom = Math.max(
    ...input.runs.map((r) => (r.rows.at(-1)?.y ?? r.y) + (r.rows.at(-1)?.depth ?? 0)),
    0,
  );
  const left = Math.min(...input.runs.map((r) => r.x), 0);
  items.push(
    dimension({
      id: 'overall',
      from: point(left, bottom + 1_200_000),
      to: point(left + um(input.overallLength), bottom + 1_200_000),
      text: withSuffix(input.overallLength, 'OVERALL'),
    }),
  );

  return displayList({
    view: 'plan',
    extent: { width: um(input.extent.width), height: um(input.extent.height) },
    items,
    revisionHash: input.revisionHash,
  });
}

/**
 * A grid reference: A..Z, then AA, AB…
 *
 * Letters rather than numbers because that is what a drawing set uses, and a
 * plan whose column references do not match the architectural grid is a plan
 * nobody can talk about on site.
 */
export function gridRef(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * A dimension's text with its datum named.
 *
 * The suffix is appended only when the value is ESTABLISHED. An unestablished
 * quantity renders `VERIFY`, and `VERIFY FRAME TO FRAME` would read as a
 * measured datum awaiting confirmation rather than as no measurement at all.
 */
function withSuffix(q: Quantity, suffix: string): { text: string; established: boolean } {
  const base = displayText(q, { feetInches: true });
  return base.established
    ? { text: `${base.text}  ${suffix}`, established: true }
    : base;
}
