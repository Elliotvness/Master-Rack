/**
 * Verification tiers and the outcome ceiling.
 *
 * Blueprint §10.5 and §11.2. This module is the single most important piece of
 * policy in the product, and it exists because of a specific, documented
 * failure: an adversarial review of the *Rack Screening Register* Rev A found
 * the prose scrupulously honest and the RETURNS dishonest — 14 checks asserted
 * a hard FAIL while the same check's own notes conceded the source had never
 * been read. Five survived as genuinely FAIL-capable.
 *
 * The lesson is not "write more careful checks". It is that a check must not be
 * ABLE to overstate its own authority. So the outcome is computed:
 *
 *     outcome = min( check_result , ceiling_for( rule.verification_tier ) )
 *
 * and `min` is applied by the framework in `kernel-checks`, never by a check.
 * A check states what it observed; the framework decides what may be concluded.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/**
 * How well a rule's source is established. Ordered from most to least
 * authoritative; the order is meaningful and is asserted in the tests.
 */
export type VerificationTier =
  | 'PRIMARY'
  | 'REPRODUCED'
  | 'AHJ_INTERPRETATION'
  | 'SECONDARY'
  | 'NOT_FOUND';

/**
 * The seven finding severities of §11.1. This is the complete vocabulary: a
 * check may not invent an eighth state.
 */
export type Severity =
  | 'PASS'
  | 'BLOCKER'
  | 'WARNING'
  | 'MISSING_INPUT'
  | 'ASSUMPTION'
  | 'ENGINEERING_REVIEW_REQUIRED'
  | 'NOT_EVALUATED';

export class RulesError extends Error {
  override readonly name: string = 'RulesError';
}

/**
 * Tier order, most authoritative first. Exported so a caller can reason about
 * relative authority without hard-coding the list a second time.
 */
export const TIER_ORDER: readonly VerificationTier[] = Object.freeze([
  'PRIMARY',
  'REPRODUCED',
  'AHJ_INTERPRETATION',
  'SECONDARY',
  'NOT_FOUND',
]);

/**
 * The severities each tier permits, as data rather than as a switch statement.
 *
 * Read this table as "the most a rule at this tier is allowed to conclude".
 * `PRIMARY` is the only tier that may return a clean PASS, and the only tier
 * that may assert a plain BLOCKER: if the standard has not been read, the
 * product does not get to say the configuration definitively fails.
 *
 * `REPRODUCED` may still block — a reconciled reproduction is strong enough to
 * stop a submission — but it carries a cite-check stamp and cannot return PASS.
 * Saying "this is fine" on a source nobody read is the failure mode above.
 */
const PERMITTED: Readonly<Record<VerificationTier, readonly Severity[]>> = Object.freeze({
  PRIMARY: Object.freeze<Severity[]>([
    'PASS',
    'BLOCKER',
    'WARNING',
    'MISSING_INPUT',
    'ASSUMPTION',
    'ENGINEERING_REVIEW_REQUIRED',
    'NOT_EVALUATED',
  ]),
  REPRODUCED: Object.freeze<Severity[]>([
    'BLOCKER',
    'WARNING',
    'MISSING_INPUT',
    'ASSUMPTION',
    'ENGINEERING_REVIEW_REQUIRED',
    'NOT_EVALUATED',
  ]),
  AHJ_INTERPRETATION: Object.freeze<Severity[]>([
    'MISSING_INPUT',
    'ASSUMPTION',
    'ENGINEERING_REVIEW_REQUIRED',
    'NOT_EVALUATED',
  ]),
  SECONDARY: Object.freeze<Severity[]>([
    'MISSING_INPUT',
    'ASSUMPTION',
    'ENGINEERING_REVIEW_REQUIRED',
    'NOT_EVALUATED',
  ]),
  NOT_FOUND: Object.freeze<Severity[]>(['NOT_EVALUATED']),
});

/**
 * What a tier degrades to when a check tries to exceed it.
 *
 * `NOT_FOUND` collapses to NOT EVALUATED — "no source located" can never be
 * rendered as a pass, and §11.1 requires it be NAMED on screen rather than
 * omitted. Silence is not a pass.
 */
const CEILING: Readonly<Record<VerificationTier, Severity>> = Object.freeze({
  PRIMARY: 'PASS',
  REPRODUCED: 'ENGINEERING_REVIEW_REQUIRED',
  AHJ_INTERPRETATION: 'ENGINEERING_REVIEW_REQUIRED',
  SECONDARY: 'ENGINEERING_REVIEW_REQUIRED',
  NOT_FOUND: 'NOT_EVALUATED',
});

/** True when a rule at this tier may return this severity unchanged. */
export function permits(tier: VerificationTier, severity: Severity): boolean {
  const allowed = PERMITTED[tier];
  return allowed.includes(severity);
}

/** The severities a tier permits. Frozen; safe to expose. */
export function permittedSeverities(tier: VerificationTier): readonly Severity[] {
  return PERMITTED[tier];
}

/**
 * Apply the tier ceiling to a check's observation. THE function this package
 * exists for.
 *
 * A check says what it saw. This says what may be concluded from it. When a
 * check's result is not permitted at the rule's tier, the result degrades to
 * that tier's ceiling — it is never returned as written, and never silently
 * dropped, because a check that did not conclude must still appear on screen.
 */
export function applyCeiling(tier: VerificationTier, observed: Severity): Severity {
  return permits(tier, observed) ? observed : CEILING[tier];
}

/**
 * Whether an outcome at this tier must carry a cite-check stamp.
 *
 * §10.5: a REPRODUCED rule may block, but the blocker is only honest if it
 * travels with the fact that the standard itself was not read.
 */
export function requiresCiteCheckStamp(tier: VerificationTier, outcome: Severity): boolean {
  return tier === 'REPRODUCED' && outcome === 'BLOCKER';
}

/**
 * Whether a tier's outcome should be flagged for AHJ confirmation. An
 * authority's handout binds in that jurisdiction and nowhere else.
 */
export function requiresAhjConfirmation(tier: VerificationTier): boolean {
  return tier === 'AHJ_INTERPRETATION';
}

/** True when a severity stops a submission. Only BLOCKER does. */
export function blocksSubmission(severity: Severity): boolean {
  return severity === 'BLOCKER';
}

export function isVerificationTier(value: unknown): value is VerificationTier {
  return typeof value === 'string' && (TIER_ORDER as readonly string[]).includes(value);
}
