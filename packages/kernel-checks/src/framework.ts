/**
 * The check framework: the ONE place the tier ceiling is applied.
 *
 * Blueprint §11.2 and AC-19. A check states what it OBSERVED. This module
 * decides what may be CONCLUDED from that observation, by looking up the
 * governing rule's verification tier and capping the outcome:
 *
 *     outcome = min( check_result , ceiling_for( rule.verification_tier ) )
 *
 * The separation is the whole point, and it is structural rather than a
 * convention: a `Check` returns an `Observation`, which has no severity field
 * that survives to the client. Only `runChecks` produces a `Finding`, and it is
 * the only code that calls `applyCeiling`. A developer therefore cannot write a
 * check that returns PASS against a secondary-sourced rule, because a check
 * cannot produce a Finding at all.
 *
 * This exists because the *Rack Screening Register* Rev A review found 14
 * checks asserting a hard FAIL while their own notes conceded the source had
 * never been read. Discipline did not prevent that. Structure does.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import {
  type RulePack,
  type Severity,
  applyCeiling,
  requiresAhjConfirmation,
  requiresCiteCheckStamp,
} from '@rms/kernel-rules';

import {
  type Finding,
  type FindingParameter,
  FindingError,
} from './finding.js';

/**
 * What a check reports. Deliberately NOT a Finding: it carries no citation, no
 * cite-check stamp and no final severity, because a check is not entitled to
 * determine any of those.
 */
export interface Observation {
  readonly code: string;
  /** What the check saw. The framework may lower this; it will never raise it. */
  readonly observed: Severity;
  readonly subjectObjectIds: readonly string[];
  readonly parameters: readonly FindingParameter[];
  readonly closedBy: string;
}

/**
 * A check: pure, and bound to exactly one rule id.
 *
 * `ruleId` is data on the check rather than a string chosen inside it, so the
 * framework can resolve the tier WITHOUT executing the check. That ordering
 * matters: a NOT_FOUND rule must be reportable even if the check itself cannot
 * run for want of an input.
 */
export interface Check<TInput> {
  readonly code: string;
  readonly ruleId: string;
  /**
   * Returns zero or more observations. Zero means "nothing to report" — which
   * is NOT the same as a pass, and the framework does not invent one.
   */
  run(input: TInput): readonly Observation[];
}

export class CheckFrameworkError extends Error {
  override readonly name = 'CheckFrameworkError';
}

function assertObservation(o: Observation, code: string): void {
  if (o.closedBy.trim() === '') {
    throw new FindingError(
      `check ${code} produced a finding with no closed_by — ` +
        'every finding must state what would resolve it (§11.3)',
    );
  }
  if (o.code.trim() === '') {
    throw new FindingError(`check ${code} produced a finding with no code`);
  }
}

/**
 * Run one check and convert its observations into findings, applying the tier
 * ceiling. The only path from an Observation to a Finding.
 */
export function runCheck<TInput>(
  check: Check<TInput>,
  pack: RulePack,
  input: TInput,
): readonly Finding[] {
  // Resolve the rule FIRST. A check naming a rule the pack does not contain is
  // a programming error, and mustGet throws — silently skipping would let a
  // check evaluate against nothing and report a confident result.
  const rule = pack.mustGet(check.ruleId);

  const observations = check.run(input);

  return Object.freeze(
    observations.map((o): Finding => {
      assertObservation(o, check.code);

      const severity = applyCeiling(rule.tier, o.observed);
      const lowered = severity !== o.observed;

      return Object.freeze({
        code: o.code,
        severity,
        subjectObjectIds: Object.freeze([...o.subjectObjectIds]),
        parameters: Object.freeze([...o.parameters]),
        closedBy: o.closedBy,
        citation: Object.freeze({
          ruleId: rule.id,
          rulePack: pack.manifest.pack,
          rulePackRev: pack.manifest.rev,
          standard: rule.citation.standard,
          edition: rule.citation.edition,
          section: rule.citation.section,
          tier: rule.tier,
          sourceNote: rule.citation.sourceNote,
        }),
        citeCheckStamp: requiresCiteCheckStamp(rule.tier, severity),
        ahjConfirmationRequired: requiresAhjConfirmation(rule.tier),
        ceilingApplied: lowered
          ? Object.freeze({ observed: o.observed, tier: rule.tier })
          : null,
      });
    }),
  );
}

/**
 * Run every check against one input. Order is the caller's, and is preserved,
 * so a report reads the same way twice.
 */
export function runChecks<TInput>(
  checks: readonly Check<TInput>[],
  pack: RulePack,
  input: TInput,
): readonly Finding[] {
  const seen = new Set<string>();
  for (const c of checks) {
    if (seen.has(c.code)) {
      throw new CheckFrameworkError(`duplicate check code '${c.code}'`);
    }
    seen.add(c.code);
  }

  const findings: Finding[] = [];
  for (const check of checks) {
    findings.push(...runCheck(check, pack, input));
  }
  return Object.freeze(findings);
}

/**
 * Whether a set of findings blocks submission.
 *
 * Only a BLOCKER does, and only AFTER the ceiling — which is the point. A
 * check observing a blocker against a secondary-sourced rule does not stop a
 * submission, because the product is not entitled to conclude that it should.
 */
export function blockers(findings: readonly Finding[]): readonly Finding[] {
  return Object.freeze(findings.filter((f) => f.severity === 'BLOCKER'));
}

/** Findings the client can act on themselves. Kept distinct from review items. */
export function clientActionable(findings: readonly Finding[]): readonly Finding[] {
  return Object.freeze(findings.filter((f) => f.severity === 'MISSING_INPUT'));
}

/**
 * Every check that reported nothing at all, named so the screen can say so.
 *
 * §11.1: "Silence is not a pass." A check that did not run must appear on the
 * screen rather than be absent from it, so this returns the codes that produced
 * no finding — the caller renders them as NOT EVALUATED rather than omitting them.
 */
export function silentChecks<TInput>(
  checks: readonly Check<TInput>[],
  findings: readonly Finding[],
): readonly string[] {
  const reported = new Set(findings.map((f) => f.citation.ruleId));
  return Object.freeze(checks.filter((c) => !reported.has(c.ruleId)).map((c) => c.code));
}
