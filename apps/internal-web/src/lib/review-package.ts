/**
 * The internal review package (§11.6, figure 1 step 7).
 *
 * What an internal reviewer opens when a submission arrives: the plan, the
 * elevation, the inputs, the assumptions, the findings and the internal
 * takeoff. This module decides only ONE thing about it, and it is the thing
 * §11.6 states outright — *"Assumptions appear in the pre-submit confirmation,
 * in the client PDF, and at the top of the internal review package."*
 *
 * Top is not a styling preference. The register is what settles the sentence
 * §11.6 quotes — *"you accepted a 4-inch overhang assumption"* — and a register
 * printed below the BOM is one a reviewer quoting that sentence has already
 * scrolled past. Key order here is the whole assertion, so it is fixed in
 * `REVIEW_PACKAGE_KEYS` and checked against the assembled object by a test
 * rather than left to the order someone happened to type the fields in.
 *
 * The refusals are the other half. A frozen submission cannot exist with an
 * unacknowledged register — `submit` refuses first — so a package that arrives
 * here without one describes a state the system says is impossible. Assembling
 * it anyway would let a reviewer read assumptions with no acknowledgement
 * attached and reasonably conclude the client saw them.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { Acknowledgement, Assumption } from '@rms/contracts';

/**
 * The package's top-level keys, in the order it presents them.
 *
 * `assumptions` first is §11.6. Its audit event id rides immediately behind it
 * because it is the register's provenance and reads as part of it. The rest
 * follow figure 1's step 7 — plan · elevation · inputs, findings, internal
 * BOM / takeoff.
 */
export const REVIEW_PACKAGE_KEYS = Object.freeze([
  'assumptions',
  'acknowledgementAuditEventId',
  'plan',
  'elevation',
  'inputs',
  'findings',
  'bom',
] as const);

export type ReviewPackageKey = (typeof REVIEW_PACKAGE_KEYS)[number];

export class ReviewPackageError extends Error {
  override readonly name = 'ReviewPackageError';
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`The review package cannot be assembled: ${reasons.join(' | ')}`);
    this.reasons = Object.freeze([...reasons]);
  }
}

/** A reference to a stored display list — the renderer's input, not a picture. */
export interface DisplayListRef {
  readonly displayListId: string;
}

export interface ReviewPackageFinding {
  readonly code: string;
  readonly severity: string;
}

export interface ReviewPackageInput {
  readonly submissionId: string;
  /** The §11.6 register as the client acknowledged it. */
  readonly assumptions: readonly Assumption[];
  /** Absent only when the register is empty. */
  readonly acknowledgement?: Acknowledgement;
  readonly plan: DisplayListRef;
  readonly elevation: DisplayListRef;
  readonly inputs: { readonly revisionId: string; readonly facilityId: string };
  readonly findings: readonly ReviewPackageFinding[];
  readonly bom: { readonly lineCount: number };
}

export interface ReviewPackage {
  /** FIRST. §11.6. Each entry stamped with who acknowledged it and when. */
  readonly assumptions: readonly Assumption[];
  /** Absent when there was nothing to acknowledge. */
  readonly acknowledgementAuditEventId?: string;
  readonly plan: DisplayListRef;
  readonly elevation: DisplayListRef;
  readonly inputs: { readonly revisionId: string; readonly facilityId: string };
  readonly findings: readonly ReviewPackageFinding[];
  readonly bom: { readonly lineCount: number };
}

/**
 * Assemble the package, or refuse and say why.
 *
 * Refuses rather than degrades: a package missing its acknowledgement is not a
 * package with one field blank, it is a claim about what a client accepted
 * with nothing behind it.
 */
export function assembleReviewPackage(input: ReviewPackageInput): ReviewPackage {
  const reasons: string[] = [];
  const { acknowledgement } = input;

  if (input.assumptions.length > 0 && acknowledgement === undefined) {
    reasons.push(
      `submission ${input.submissionId} carries ${String(input.assumptions.length)} assumption(s) and no acknowledgement; a frozen submission cannot exist in that state`,
    );
  }

  if (acknowledgement !== undefined) {
    if (input.assumptions.length === 0) {
      reasons.push('an acknowledgement was supplied over an empty register; there was nothing to accept');
    }
    if (acknowledgement.auditEventId.trim() === '') {
      reasons.push('the acknowledgement carries no audit event id, so it cannot be checked against the chain (AC-15)');
    }
    // WHO and WHEN are stamped onto every assumption below. A package that
    // asserts an acceptance and names no-one is worse than one that asserts
    // nothing, because a reviewer reads it as evidence.
    if (acknowledgement.acknowledgedBy.trim() === '') {
      reasons.push('the acknowledgement names no-one who acknowledged it');
    }
    if (acknowledgement.acknowledgedAt.trim() === '') {
      reasons.push('the acknowledgement records no time it was given');
    }

    // Both directions. Missing keys mean the client accepted less than the
    // register holds; extra keys mean the acknowledgement was taken against a
    // DIFFERENT register, and neither is visible from reading the package.
    const covered = new Set(acknowledgement.keys);
    const held = new Set(input.assumptions.map((a) => a.key));
    const uncovered = input.assumptions.filter((a) => !covered.has(a.key)).map((a) => a.key);
    const foreign = acknowledgement.keys.filter((k) => !held.has(k));
    if (uncovered.length > 0) {
      reasons.push(`the acknowledgement does not cover every assumption in the register: ${uncovered.join(', ')}`);
    }
    if (foreign.length > 0) {
      reasons.push(`the acknowledgement covers keys this register does not hold: ${foreign.join(', ')}`);
    }
  }

  if (reasons.length > 0) {
    throw new ReviewPackageError(reasons);
  }

  // Stamped here, not carried in: the register is derived, the acknowledgement
  // is recorded, and this is the one place the two are joined for reading.
  //
  // No acknowledgement means an empty register — the refusal above is what
  // makes that true, so there is nothing to stamp and no third case to handle.
  const stamped: readonly Assumption[] =
    acknowledgement === undefined
      ? []
      : input.assumptions.map((a) =>
          Object.freeze({
            ...a,
            acknowledgedBy: acknowledgement.acknowledgedBy,
            acknowledgedAt: acknowledgement.acknowledgedAt,
          }),
        );

  // Key order IS the §11.6 assertion. Do not reorder.
  return Object.freeze({
    assumptions: Object.freeze(stamped),
    ...(acknowledgement === undefined
      ? {}
      : { acknowledgementAuditEventId: acknowledgement.auditEventId }),
    plan: input.plan,
    elevation: input.elevation,
    inputs: input.inputs,
    findings: Object.freeze([...input.findings]),
    bom: input.bom,
  });
}
