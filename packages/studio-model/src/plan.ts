/**
 * Full plan geometry — build-plan **S3.1**.
 *
 * `to-kernel.ts` produces the coarse shape a run occupies. This produces what
 * the drawing actually shows: the two frame rows of a back-to-back run, every
 * bay, every unit load at its true footprint including overhang, the
 * longitudinal flue between the rows, and both aisle datums.
 *
 * **Every formula here is the prototype's**, not a reinvention. They were read
 * out of `rack-studio-v1/prototype/kernel.js` and are cited at each function,
 * because the continuity fixture exists to prove the µm re-derivation did not
 * change an answer — and it cannot prove that against arithmetic that was
 * invented here.
 *
 * **The two aisle datums are both carried, and that is the point.** Frame to
 * frame is what a tape measure reads on site; load face to load face is
 * ADR-006's datum and what a truck must actually fit between. They differ by
 * the overhang at each side, and a drawing that shows only one of them invites
 * the reader to use it for the other question.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { Quantity } from '@rms/kernel-units';

import { bayTypeForRun, type StudioDocument } from './document.js';
import type { Micrometres } from './length.js';
import { BridgeError, length, runGeometry } from './to-kernel.js';

/** One frame row. A back-to-back run has two; a single-row run has one. */
export interface RowRect {
  readonly y: Micrometres;
  readonly depth: Micrometres;
}

/** One bay's clear span along the run, between its two uprights. */
export interface BayRect {
  readonly bayId: string;
  readonly index: number;
  readonly locked: boolean;
  readonly x: Micrometres;
  readonly width: Micrometres;
}

/** One unit load, at its true footprint including overhang. */
export interface PalletRect {
  readonly id: string;
  readonly x: Micrometres;
  readonly y: Micrometres;
  readonly width: Micrometres;
  readonly depth: Micrometres;
}

/** The longitudinal flue between the two rows of a back-to-back run. */
export interface FlueRect {
  readonly y: Micrometres;
  readonly height: Micrometres;
  readonly width: Quantity;
}

export interface RunPlan {
  readonly runId: string;
  readonly label: string;
  readonly x: Micrometres;
  readonly y: Micrometres;
  readonly runLength: Quantity;
  readonly bayPitch: Quantity;
  readonly uprightFace: Micrometres;
  /** Frames only — the datum a frame-to-frame aisle is measured to. */
  readonly rowBlockFrames: Quantity;
  /** Frames plus overhang each face — what a load actually occupies. */
  readonly rowBlockPallets: Quantity;
  readonly overhang: Quantity;
  readonly rows: readonly RowRect[];
  readonly bays: readonly BayRect[];
  readonly pallets: readonly PalletRect[];
  readonly longitudinalFlue: FlueRect | null;
  readonly transverseFlueAtUpright: Quantity;
  readonly positions: number;
}

/** An aisle carries BOTH datums, because they answer different questions. */
export interface AislePlan {
  readonly aisleId: string;
  readonly x: Micrometres;
  readonly y: Micrometres;
  readonly length: Micrometres;
  readonly frameToFrame: Quantity;
  readonly clearBetweenLoads: Quantity;
}

export interface PlanGeometry {
  readonly runs: readonly RunPlan[];
  readonly aisles: readonly AislePlan[];
  readonly extent: { readonly width: Quantity; readonly height: Quantity };
  readonly overallLength: Quantity;
  readonly totalPositions: number;
  readonly totalBays: number;
  readonly narrowestClearAisle: Quantity | null;
}

/**
 * Gaps are ALLOCATED, not divided (`kernel.js:319`).
 *
 * The remainder is spread one unit at a time so the parts sum EXACTLY to the
 * beam. Dividing gives equal gaps each a fraction short, and the dimension
 * string then disagrees with the sum of its own parts.
 */
export function allocateGaps(clearTotal: Micrometres, count: number): readonly Micrometres[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new BridgeError(`a bay needs at least one gap, got ${String(count)}.`);
  }
  const base = Math.floor(clearTotal / count);
  const extra = clearTotal - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Overhang is HALF the difference, and it may be negative (`kernel.js:316`).
 *
 * A pallet shallower than the frame is a real configuration — the one that
 * raises the pallet-support finding — so this does not clamp. Truncation is
 * toward zero so equal magnitudes round alike (ADR-005).
 */
export function overhangOf(palletDepth: Micrometres, frameDepth: Micrometres): Micrometres {
  return Math.trunc((palletDepth - frameDepth) / 2);
}

/** The whole plan: rows, bays, unit loads, flues and both aisle datums. */
export function planGeometry(doc: StudioDocument): PlanGeometry {
  const palletW = doc.unitLoad.palletW;
  const palletD = doc.unitLoad.palletD;

  const runs: RunPlan[] = doc.runs.map((run) => {
    const bt = bayTypeForRun(doc, run);
    if (bt === undefined) {
      throw new BridgeError(
        `run ${run.id} (${run.name}) references bay type ${run.bayTypeId}, which is not in ` +
          'this document. Refusing rather than falling back to the first bay type.',
      );
    }

    const g = runGeometry(doc, run);
    const overhang = overhangOf(palletD, bt.frameDepth);
    const rowCount = run.backToBack ? 2 : 1;
    const rowBlockFrames = run.backToBack ? bt.frameDepth * 2 + run.rowSpacer : bt.frameDepth;
    const rowBlockPallets = rowBlockFrames + Math.max(0, overhang) * 2;
    const rowYs = run.backToBack ? [run.y, run.y + rowBlockFrames - bt.frameDepth] : [run.y];

    const gaps = allocateGaps(bt.beamLength - bt.palletsPerBay * palletW, bt.palletsPerBay + 1);

    // Uprights sit at each bay boundary; the clear span starts after one.
    const bays: BayRect[] = run.bays.map((bay, i) => ({
      bayId: bay.id,
      index: i,
      locked: bay.locked,
      x: run.x + i * (bt.beamLength + bt.uprightWidth) + bt.uprightWidth,
      width: bt.beamLength,
    }));

    const pallets: PalletRect[] = [];
    for (const [rowIndex, rowY] of rowYs.entries()) {
      for (const bay of bays) {
        let x = bay.x;
        for (let p = 0; p < bt.palletsPerBay; p += 1) {
          x += gaps[p] as number;
          pallets.push({
            id: `${bay.bayId}:r${rowIndex}:p${p}`,
            x,
            // Centred on the frame, so it overhangs each face equally.
            y: rowY - overhang,
            width: palletW,
            depth: palletD,
          });
          x += palletW;
        }
      }
    }

    const storeys = bt.beamLevels.length + (run.floorStorage ? 1 : 0);
    const clamped = Math.max(0, overhang);

    return {
      runId: run.id,
      label: run.name,
      x: run.x,
      y: run.y,
      runLength: g.runLength,
      bayPitch: g.bayPitch,
      uprightFace: bt.uprightWidth,
      rowBlockFrames: length(rowBlockFrames, 'DERIVED'),
      rowBlockPallets: length(rowBlockPallets, 'DERIVED'),
      overhang: length(overhang, 'DERIVED'),
      rows: rowYs.map((y) => ({ y, depth: bt.frameDepth })),
      bays,
      pallets,
      longitudinalFlue: run.backToBack
        ? {
            y: run.y + bt.frameDepth + clamped,
            height: run.rowSpacer - clamped * 2,
            width: length(run.rowSpacer - overhang * 2, 'DERIVED'),
          }
        : null,
      transverseFlueAtUpright: length(
        (gaps[0] as number) + (gaps[gaps.length - 1] as number) + bt.uprightWidth,
        'DERIVED',
      ),
      positions: run.bays.length * bt.palletsPerBay * storeys * rowCount,
    };
  });

  /**
   * An aisle is between a run and the NEAREST run below it that shares any
   * x-extent (`kernel.js:409`). Runs side by side at the same y — a split run —
   * do not face each other across an aisle, and pairing "next in y order"
   * reports a negative frame-to-frame gap between them. That is defect D-B.
   */
  const overlaps = (a: RunPlan, b: RunPlan): boolean =>
    Math.max(a.x, b.x) < Math.min(a.x + a.runLength.value, b.x + b.runLength.value);

  const order = [...runs].sort((a, b) => a.y - b.y);
  const aisles: AislePlan[] = [];

  for (const a of order) {
    const yEnd = a.y + a.rowBlockFrames.value;
    const below = order.filter((b) => b.runId !== a.runId && b.y >= yEnd && overlaps(a, b));
    if (below.length === 0) continue;
    const nearest = Math.min(...below.map((b) => b.y));
    // No de-duplication set is needed, and the prototype's was carried over
    // once before coverage showed it never fired: the outer loop visits each
    // run as `a` exactly once, so every (a, b) pair is reached exactly once.
    // A guard no input can trigger is a guard nobody can test.
    for (const b of below.filter((x) => x.y === nearest)) {
      const frameToFrame = b.y - yEnd;
      aisles.push({
        aisleId: `gap_${a.runId}_${b.runId}`,
        x: Math.min(a.x, b.x),
        y: yEnd,
        length: Math.max(a.runLength.value, b.runLength.value),
        frameToFrame: length(frameToFrame, 'DERIVED'),
        clearBetweenLoads: length(
          frameToFrame - a.overhang.value - b.overhang.value,
          'DERIVED',
        ),
      });
    }
  }

  const width = runs.reduce((m, r) => Math.max(m, r.x + r.runLength.value), 0);
  const height = runs.reduce((m, r) => Math.max(m, r.y + r.rowBlockPallets.value), 0);
  const minX = runs.length === 0 ? 0 : Math.min(...runs.map((r) => r.x));

  const narrowest =
    aisles.length === 0
      ? null
      : aisles.map((a) => a.clearBetweenLoads).reduce((m, q) => (q.value < m.value ? q : m));

  return {
    runs,
    aisles,
    extent: { width: length(width, 'DERIVED'), height: length(height, 'DERIVED') },
    overallLength: length(width - minX, 'DERIVED'),
    totalPositions: runs.reduce((n, r) => n + r.positions, 0),
    totalBays: runs.reduce((n, r) => n + r.bays.length, 0),
    narrowestClearAisle: narrowest,
  };
}
