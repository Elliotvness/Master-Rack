/**
 * BOM derivation (blueprint §12.3).
 *
 * Three quantities are established and are derived here. Everything else in the
 * MVP takeoff is emitted UNRESOLVED with its reason, because no defensible rule
 * exists for it yet.
 *
 * That asymmetry is the deliverable, not a gap in it. The reference projects
 * contain plausible formulas for the unresolved lines; adopting any of them
 * would produce a complete-looking BOM resting on numbers nobody can defend,
 * which is the precise failure this product exists to prevent.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { each, type Quantity } from '@rms/kernel-units';

import {
  type BomLine,
  type PartRef,
  BomError,
  resolvedLine,
  unresolvedLine,
} from './line.js';

export interface RunTakeoff {
  readonly runId: string;
  readonly bays: number;
  readonly rows: number;
  /** Beam levels carrying a pair of beams. The floor is not one. */
  readonly beamLevels: number;
  readonly frameRef: PartRef;
  readonly beamRef: PartRef;
  readonly anchorRef: PartRef;
  readonly deckRef: PartRef;
  readonly spacerRef: PartRef;
  readonly footplateRef: PartRef;
}

function assertCount(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new BomError(`${what} must be a non-negative integer, got ${n}`);
  }
}

/* ------------------------------------------------------------------ *
 * The three established rules.
 * ------------------------------------------------------------------ */

/**
 * Upright frames = (bays + 1) × rows.
 *
 * The `+1` is where estimates go wrong, and back-to-back rows do NOT share
 * frames — both recorded in `rack-takeoff/HANDOFF.md` as institutional
 * knowledge that exists nowhere else. A back-to-back pair is two rows of
 * frames standing back to back, not one shared line of uprights.
 */
export function frameQty(bays: number, rows: number): number {
  assertCount(bays, 'bays');
  assertCount(rows, 'rows');
  if (bays === 0 || rows === 0) return 0;
  return (bays + 1) * rows;
}

/** Load beams = bays × levels × 2 × rows. A pair per level. */
export function beamQty(bays: number, beamLevels: number, rows: number): number {
  assertCount(bays, 'bays');
  assertCount(beamLevels, 'beam levels');
  assertCount(rows, 'rows');
  return bays * beamLevels * 2 * rows;
}

/**
 * Wedge anchors = frames × 4.
 *
 * Verified against a delivered job: 3,812 / 953 = 4.000 exactly. One of the
 * few quantities in the reference material with a clean two-source agreement.
 */
export function anchorQty(frames: number): number {
  assertCount(frames, 'frames');
  return frames * 4;
}

/* ------------------------------------------------------------------ *
 * The unresolved register.
 *
 * Each entry names what would resolve it, so the register is a roadmap rather
 * than a list of complaints.
 * ------------------------------------------------------------------ */

/**
 * The wire-deck reason, written out in full deliberately.
 *
 * Three conflicting formulas exist across the reference projects and none is
 * confirmable. Naming all three is what stops a future reader "restoring" one
 * of them under the impression it was lost by accident.
 */
export const WIRE_DECK_REASON =
  'Deck count per level depends on deck width and a support rule the published ' +
  'catalog does not state. Three conflicting formulas exist in the reference ' +
  'projects — (len >= 132 ? 3 : 2), max(2, ceil(len/60)), and a one-job ' +
  'observation of about 1.14 per bay — and none is sourced. Resolved by a ' +
  'published deck-support rule from the manufacturer, or by a written company ' +
  'standard adopted as a rule-pack entry.';

export const ROW_SPACER_REASON =
  'Row spacer count depends on the fire and storage profile and on the flue ' +
  'width, neither of which is pinned at this stage. The reference ' +
  'implementation hardcodes a 12" spec string while ignoring its own editable ' +
  'flue field, which is a live defect and is not carried forward. Resolved by ' +
  'pinning the flue width and the governing storage profile.';

export const FOOTPLATE_REASON =
  'Footplate and shim requirements depend on the slab condition, which is not ' +
  'surveyed at this stage. Resolved by a slab survey, or by an estimator ' +
  'supplying the allowance explicitly.';

/**
 * Derive the internal takeoff for one run.
 *
 * Deterministic: the output depends only on the input, and the line order is
 * fixed by this function rather than by iteration order anywhere else.
 */
export function deriveRunBom(run: RunTakeoff): readonly BomLine[] {
  assertCount(run.bays, 'bays');
  assertCount(run.rows, 'rows');
  assertCount(run.beamLevels, 'beam levels');

  const ids = [run.runId];
  const frames = frameQty(run.bays, run.rows);
  const beams = beamQty(run.bays, run.beamLevels, run.rows);
  const anchors = anchorQty(frames);

  const lines: BomLine[] = [
    resolvedLine({
      category: 'FRAME',
      partRef: run.frameRef,
      qty: each(frames),
      uom: 'EA',
      ruleText: 'frames = (bays + 1) x rows; back-to-back rows do not share frames',
      ruleId: 'BOM-FRAME-COUNT',
      confirmed: true,
      sourceObjectIds: ids,
    }),
    resolvedLine({
      category: 'BEAM',
      partRef: run.beamRef,
      qty: each(beams),
      uom: 'EA',
      ruleText: 'beams = bays x beam levels x 2 x rows; a pair per level',
      ruleId: 'BOM-BEAM-COUNT',
      confirmed: true,
      sourceObjectIds: ids,
    }),
    resolvedLine({
      category: 'ANCHOR',
      partRef: run.anchorRef,
      qty: each(anchors),
      uom: 'EA',
      ruleText: 'wedge anchors = frames x 4',
      ruleId: 'BOM-ANCHOR-COUNT',
      confirmed: true,
      sourceObjectIds: ids,
    }),
    unresolvedLine({
      category: 'DECK',
      partRef: run.deckRef,
      uom: 'EA',
      ruleText: 'wire deck count per level — no sourced rule',
      ruleId: null,
      sourceObjectIds: ids,
      reason: WIRE_DECK_REASON,
    }),
    unresolvedLine({
      category: 'SPACER',
      partRef: run.spacerRef,
      uom: 'EA',
      ruleText: 'row spacer count — depends on unpinned inputs',
      ruleId: null,
      sourceObjectIds: ids,
      reason: ROW_SPACER_REASON,
    }),
    unresolvedLine({
      category: 'FOOTPLATE',
      partRef: run.footplateRef,
      uom: 'EA',
      ruleText: 'footplates and shims — depends on slab condition',
      ruleId: null,
      sourceObjectIds: ids,
      reason: FOOTPLATE_REASON,
    }),
  ];

  return Object.freeze(lines);
}

/**
 * Derive the BOM for a whole revision. Runs are processed in the order given
 * and the result is a flat, ordered list — the same revision in, the same bytes
 * out (AC-12).
 */
export function deriveBom(runs: readonly RunTakeoff[]): readonly BomLine[] {
  const seen = new Set<string>();
  for (const r of runs) {
    if (seen.has(r.runId)) {
      throw new BomError(`duplicate run id '${r.runId}'`);
    }
    seen.add(r.runId);
  }
  const lines: BomLine[] = [];
  for (const run of runs) {
    lines.push(...deriveRunBom(run));
  }
  return Object.freeze(lines);
}

/**
 * A stable, canonical serialisation of a BOM, for the byte-identical
 * regeneration guarantee (AC-12) and for hashing.
 *
 * Deliberately hand-written rather than JSON.stringify over the objects: key
 * order is fixed here, so a future field reordering cannot silently change a
 * stored hash.
 */
export function canonicalBom(lines: readonly BomLine[]): string {
  return lines
    .map((l) => {
      const ref =
        l.partRef.kind === 'catalog'
          ? `catalog:${l.partRef.partRevisionId}`
          : `uncatalogued:${l.partRef.uncataloguedPartId}:${l.partRef.measuredGeometry}`;
      const qty = l.resolved ? `${l.qty.value}${l.qty.unit}` : `UNRESOLVED:${l.unresolvedReason}`;
      return [
        l.category,
        ref,
        qty,
        l.uom,
        l.ruleText,
        l.ruleId ?? '',
        l.confirmed ? 'confirmed' : 'unconfirmed',
        l.sourceObjectIds.join(','),
      ].join('\u0000');
    })
    .join('\n');
}

/** Total of one category's resolved quantities. Unresolved lines contribute nothing. */
export function categoryTotal(lines: readonly BomLine[], category: string): Quantity | null {
  const matching = lines.filter((l) => l.category === category && l.resolved);
  if (matching.length === 0) return null;
  let total = 0;
  for (const l of matching) {
    if (l.resolved) total += l.qty.value;
  }
  return each(total);
}
