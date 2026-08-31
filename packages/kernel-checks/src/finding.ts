/**
 * The finding shape (blueprint §11.3).
 *
 * A finding is what a check produces. Two details in this shape matter
 * disproportionately, and both exist because a screen is a claim:
 *
 *   - `established` on EVERY parameter. An unestablished parameter renders as
 *     VERIFY, never as a numeral. If the model does not know a number, the
 *     screen must not print one.
 *   - `closedBy` is MANDATORY. Every finding must be able to say what would
 *     resolve it. A finding with no path to resolution is a dead end, and the
 *     client will telephone about it — which is the support-load risk R-15.
 *
 * The type system enforces both: `closedBy` is a required non-optional field,
 * and a parameter cannot be constructed without stating `established`.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { Quantity } from '@rms/kernel-units';
import type { Severity } from '@rms/kernel-rules';

/**
 * One parameter of a finding, in the words a sheet prints.
 *
 * `value` is null exactly when the parameter is not established. That is not a
 * convenience — it makes "unestablished but here is the number anyway"
 * unrepresentable, which is the only way to guarantee AC-07 at the boundary
 * rather than hoping the formatter is called correctly.
 */
export type FindingParameter =
  | {
      readonly name: string;
      readonly established: true;
      readonly value: Quantity;
    }
  | {
      readonly name: string;
      readonly established: false;
      readonly value: null;
      /** Why it is not established, in plain words. Never blank. */
      readonly reason: string;
    };

/** The citation carried on a finding. INTERNAL ONLY — never in a client DTO. */
export interface FindingCitation {
  readonly ruleId: string;
  readonly rulePack: string;
  readonly rulePackRev: string;
  readonly standard: string;
  readonly edition: string;
  readonly section: string;
  readonly tier: string;
  readonly sourceNote: string;
}

export interface Finding {
  /** Stable enum-like code, e.g. 'AISLE_CLEAR_SHORTFALL'. Never renumbered. */
  readonly code: string;
  /** The outcome AFTER the tier ceiling. Never what the check merely observed. */
  readonly severity: Severity;
  /** Which run / bay / level / aisle this is about. */
  readonly subjectObjectIds: readonly string[];
  readonly parameters: readonly FindingParameter[];
  /** Plain-English statement of what would resolve this. Mandatory. */
  readonly closedBy: string;
  /** Internal only. Split into finding_internal_detail at the DTO boundary. */
  readonly citation: FindingCitation;
  /** True when a REPRODUCED-tier rule produced a blocker (§10.5). */
  readonly citeCheckStamp: boolean;
  /** True when the rule is an AHJ interpretation and needs confirmation. */
  readonly ahjConfirmationRequired: boolean;
  /**
   * Set when the framework lowered the check's observation to the tier ceiling.
   * Kept so "why is this not a pass?" is answerable from stored data alone,
   * rather than by re-running anything.
   */
  readonly ceilingApplied: {
    readonly observed: Severity;
    readonly tier: string;
  } | null;
}

export class FindingError extends Error {
  override readonly name = 'FindingError';
}

/** An established parameter: a real quantity that may be rendered as a numeral. */
export function param(name: string, value: Quantity): FindingParameter {
  if (name.trim() === '') {
    throw new FindingError('a finding parameter must be named');
  }
  return Object.freeze({ name, established: true as const, value });
}

/**
 * An unestablished parameter: named, with a reason, and NO value.
 *
 * The reason is required. "Unknown" with no explanation tells the client
 * nothing and cannot be acted on.
 */
export function unknownParam(name: string, reason: string): FindingParameter {
  if (name.trim() === '') {
    throw new FindingError('a finding parameter must be named');
  }
  if (reason.trim() === '') {
    throw new FindingError(
      `parameter '${name}' is unestablished, so it must state why — ` +
        'an unexplained unknown cannot be acted on',
    );
  }
  return Object.freeze({ name, established: false as const, value: null, reason });
}

/** True when every parameter of a finding is established. */
export function allParametersEstablished(finding: Finding): boolean {
  return finding.parameters.every((p) => p.established);
}
