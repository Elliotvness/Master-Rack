/**
 * The internal takeoff BOM (blueprint §12).
 *
 * MVP-1 builds the *as-configured* node and the internal takeoff derived from
 * it. This is not a quote, it is not priced, and it is never shown to a client.
 *
 * The governing rule, from `rack-engine/CLAUDE.md` rule 9: a quantity nobody
 * can defend is worse than a blank. So a line is EITHER a quantity or an
 * unresolved reason, never both and never neither, and the type system makes
 * the third state unrepresentable rather than merely refusing it at runtime.
 *
 * Determinism is a hard requirement here (§12.2): no clock, no live data, no
 * unordered iteration, no locale-dependent formatting. Every implicit input is
 * an explicit, recorded one, so the same revision regenerates byte-identically.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { Quantity } from '@rms/kernel-units';

export type BomCategory =
  | 'FRAME'
  | 'BEAM'
  | 'DECK'
  | 'SPACER'
  | 'FOOTPLATE'
  | 'ANCHOR'
  | 'ACCESSORY';

/**
 * A part reference. Exactly one branch, mirroring the database's XOR CHECK.
 *
 * The second branch is not an edge case: two of four structural jobs in the
 * audit involve material with no published capacity, so a shape where every
 * line must resolve to a catalog part cannot represent half the work.
 */
export type PartRef =
  | { readonly kind: 'catalog'; readonly partRevisionId: string }
  | {
      readonly kind: 'uncatalogued';
      readonly uncataloguedPartId: string;
      /** Measured geometry only. There is deliberately no capacity field. */
      readonly measuredGeometry: string;
    };

/**
 * A BOM line. `qty` and `unresolvedReason` are a discriminated union rather
 * than two nullable fields, so "a quantity AND a reason" and "neither" are both
 * unrepresentable in the type system, not merely rejected at the database.
 */
export type BomLine = {
  readonly category: BomCategory;
  readonly partRef: PartRef;
  readonly uom: string;
  /** The quantity rule in the words a sheet prints. Never blank. */
  readonly ruleText: string;
  readonly ruleId: string | null;
  /**
   * Is the governing rule established, or a one-job observation? A confirmed
   * line and an unconfirmed one look identical on a sheet unless this is
   * carried, which is how a single job's coincidence becomes a company standard.
   */
  readonly confirmed: boolean;
  /** Which runs / bays / levels produced this line. Sorted, for determinism. */
  readonly sourceObjectIds: readonly string[];
} & (
  | { readonly resolved: true; readonly qty: Quantity; readonly unresolvedReason: null }
  | { readonly resolved: false; readonly qty: null; readonly unresolvedReason: string }
);

export class BomError extends Error {
  override readonly name = 'BomError';
}

function assertCommon(
  category: BomCategory,
  ruleText: string,
  sourceObjectIds: readonly string[],
): readonly string[] {
  if (ruleText.trim() === '') {
    throw new BomError(
      `${category}: every BOM line must carry the rule that produced it, in words`,
    );
  }
  // Sorted so the same revision produces byte-identical output regardless of
  // the order the caller happened to walk its own structures.
  return Object.freeze([...sourceObjectIds].sort());
}

/** A line with an established quantity. */
export function resolvedLine(input: {
  readonly category: BomCategory;
  readonly partRef: PartRef;
  readonly qty: Quantity;
  readonly uom: string;
  readonly ruleText: string;
  readonly ruleId: string | null;
  readonly confirmed: boolean;
  readonly sourceObjectIds: readonly string[];
}): BomLine {
  const ids = assertCommon(input.category, input.ruleText, input.sourceObjectIds);
  if (input.qty.value < 0) {
    throw new BomError(`${input.category}: a quantity may not be negative`);
  }
  return Object.freeze({
    category: input.category,
    partRef: input.partRef,
    uom: input.uom,
    ruleText: input.ruleText,
    ruleId: input.ruleId,
    confirmed: input.confirmed,
    sourceObjectIds: ids,
    resolved: true as const,
    qty: input.qty,
    unresolvedReason: null,
  });
}

/**
 * A line whose quantity the rules cannot establish. This is a FEATURE, not a
 * degraded output: it carries the reason, and never a plausible number.
 */
export function unresolvedLine(input: {
  readonly category: BomCategory;
  readonly partRef: PartRef;
  readonly uom: string;
  readonly ruleText: string;
  readonly ruleId: string | null;
  readonly sourceObjectIds: readonly string[];
  readonly reason: string;
}): BomLine {
  const ids = assertCommon(input.category, input.ruleText, input.sourceObjectIds);
  if (input.reason.trim() === '') {
    throw new BomError(
      `${input.category}: an unresolved line must state WHY the quantity could not be established`,
    );
  }
  return Object.freeze({
    category: input.category,
    partRef: input.partRef,
    uom: input.uom,
    ruleText: input.ruleText,
    ruleId: input.ruleId,
    // An unresolved line is never "confirmed": there is no established rule
    // behind it, which is the whole reason it is unresolved.
    confirmed: false,
    sourceObjectIds: ids,
    resolved: false as const,
    qty: null,
    unresolvedReason: input.reason,
  });
}

/** Every line whose quantity could not be established, with its reason. */
export function unresolvedLines(lines: readonly BomLine[]): readonly BomLine[] {
  return Object.freeze(lines.filter((l) => !l.resolved));
}

/** Every line resting on a rule that is not established. */
export function unconfirmedLines(lines: readonly BomLine[]): readonly BomLine[] {
  return Object.freeze(lines.filter((l) => l.resolved && !l.confirmed));
}

/** Lines referencing material with no published capacity. */
export function uncataloguedLines(lines: readonly BomLine[]): readonly BomLine[] {
  return Object.freeze(lines.filter((l) => l.partRef.kind === 'uncatalogued'));
}
