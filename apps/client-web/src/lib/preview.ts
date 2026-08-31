/**
 * The preview and findings panel (`D-04`, `D-05`).
 *
 * The governing requirement: **every parameter change re-derives plan,
 * elevation, counts, assumptions and findings within one interaction, and
 * nothing displays from a stale computation.**
 *
 * That second clause is the hard part, and it is a correctness requirement
 * rather than a performance one. A client changes a span, then changes it
 * again before the first result lands. If the slower earlier response arrives
 * second, the screen shows a drawing that does not match the form — and the
 * client has no way to know. They would be reading a real drawing of a
 * configuration they no longer have.
 *
 * So every derivation carries a generation number, and a result is applied
 * only if it is still the newest request. Late results are DISCARDED, not
 * merged, not queued.
 *
 * Findings are split for the reason §11.1 gives: **missing input is not the
 * same as engineering review.** One the client can fix in thirty seconds; the
 * other needs a person with authority. Collapsing them buries the actionable
 * list inside a wall of things the client cannot act on.
 *
 * Pure: no I/O, no clock, no RNG. The derivation is injected.
 */

import type { DisplayList } from '@rms/display-list';

/** A finding as the CLIENT sees it. No citation, no rule id, no tier. */
export interface ClientFinding {
  readonly code: string;
  readonly severity:
    | 'PASS'
    | 'BLOCKER'
    | 'WARNING'
    | 'MISSING_INPUT'
    | 'ASSUMPTION'
    | 'ENGINEERING_REVIEW_REQUIRED'
    | 'NOT_EVALUATED';
  /** Plain-English statement of what would resolve this. Never empty. */
  readonly closedBy: string;
  readonly subjectObjectIds: readonly string[];
}

export interface PreviewResult {
  readonly plan: DisplayList;
  readonly elevation: DisplayList;
  readonly netPositions: number | null;
  readonly findings: readonly ClientFinding[];
}

export type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'deriving'; readonly generation: number }
  | { readonly status: 'ready'; readonly generation: number; readonly result: PreviewResult }
  | { readonly status: 'failed'; readonly generation: number; readonly message: string };

/**
 * Sequences derivations so a stale result can never reach the screen.
 *
 * Deliberately a small explicit object rather than a hook or a framework
 * feature: the property it guarantees is worth being able to read in one
 * screenful, and worth testing without a renderer.
 */
export class PreviewSequencer {
  private generation = 0;
  private state: PreviewState = { status: 'idle' };
  /** Every generation whose result arrived too late. Kept for assertion. */
  private readonly discarded: number[] = [];

  current(): PreviewState {
    return this.state;
  }

  get discardedGenerations(): readonly number[] {
    return Object.freeze([...this.discarded]);
  }

  /** Begin a derivation. Returns the generation token the caller must present. */
  begin(): number {
    this.generation += 1;
    this.state = { status: 'deriving', generation: this.generation };
    return this.generation;
  }

  /**
   * Offer a result. Applied only if it belongs to the newest request.
   *
   * Returns whether it was applied, so a caller can assert the discard rather
   * than infer it from state that looks unchanged.
   */
  settle(generation: number, result: PreviewResult): boolean {
    if (generation !== this.generation) {
      this.discarded.push(generation);
      return false;
    }
    this.state = { status: 'ready', generation, result };
    return true;
  }

  /** Offer a failure. Same staleness rule: a late failure is also discarded. */
  fail(generation: number, message: string): boolean {
    if (generation !== this.generation) {
      this.discarded.push(generation);
      return false;
    }
    this.state = { status: 'failed', generation, message };
    return true;
  }

  /**
   * Whether the screen currently shows something derived from the newest
   * inputs. A renderer showing anything while this is false is showing a
   * stale drawing.
   */
  isCurrent(): boolean {
    return this.state.status === 'ready' && this.state.generation === this.generation;
  }
}

/* ------------------------------------------------------------------ *
 * The findings panel.
 * ------------------------------------------------------------------ */

export interface FindingGroups {
  /** Stops submission. Shown first, with what would clear it. */
  readonly blockers: readonly ClientFinding[];
  /** The client can fix these themselves, usually in seconds. */
  readonly missingInputs: readonly ClientFinding[];
  /** Allowed, but likely to change under review. */
  readonly warnings: readonly ClientFinding[];
  /** A stated planning value stood in for a missing one. Acknowledged at submit. */
  readonly assumptions: readonly ClientFinding[];
  /** Needs a person with authority. NOT the client's to fix. */
  readonly forReview: readonly ClientFinding[];
  /** Named on screen, never omitted, never rendered as a pass. */
  readonly notEvaluated: readonly ClientFinding[];
  readonly passed: readonly ClientFinding[];
}

/**
 * Group findings for display.
 *
 * The split is the point. `missingInputs` and `forReview` are separate lists
 * because they ask different things of the client: one is a task, the other is
 * a notification. A single "issues" list makes the client's actionable work
 * unfindable, which is the §11.1 failure mode and the R-15 support risk.
 */
export function groupFindings(findings: readonly ClientFinding[]): FindingGroups {
  const by = (s: ClientFinding['severity']): readonly ClientFinding[] =>
    Object.freeze(findings.filter((f) => f.severity === s));

  return Object.freeze({
    blockers: by('BLOCKER'),
    missingInputs: by('MISSING_INPUT'),
    warnings: by('WARNING'),
    assumptions: by('ASSUMPTION'),
    forReview: by('ENGINEERING_REVIEW_REQUIRED'),
    notEvaluated: by('NOT_EVALUATED'),
    passed: by('PASS'),
  });
}

/** Whether the configuration may be submitted. Only a BLOCKER stops it. */
export function canSubmit(findings: readonly ClientFinding[]): boolean {
  return !findings.some((f) => f.severity === 'BLOCKER');
}

/**
 * The client-facing wording for a review-tier finding.
 *
 * `R-15`: exposing the mechanism ("the governing rule is below primary tier")
 * invites a question the client cannot act on. They are told a person will
 * look, which is the part that concerns them.
 */
export const REVIEW_WORDING = 'Our team will review this before your quote is issued.';

/**
 * Everything the client is asked to do, in one ordered list.
 *
 * Blockers first because they stop progress, then missing inputs because they
 * are quick. Review items are deliberately EXCLUDED: they are not tasks.
 */
export function clientActionList(groups: FindingGroups): readonly string[] {
  return Object.freeze([
    ...groups.blockers.map((f) => f.closedBy),
    ...groups.missingInputs.map((f) => f.closedBy),
  ]);
}

/**
 * Counts for the summary strip.
 *
 * `netPositions` is null when the model could not establish it, and the strip
 * must render that as VERIFY rather than as 0 — a zero position count is a
 * claim, and a badly wrong one.
 */
export interface SummaryCounts {
  readonly netPositions: number | null;
  readonly blockerCount: number;
  readonly actionCount: number;
  readonly reviewCount: number;
}

export function summarise(result: PreviewResult): SummaryCounts {
  const groups = groupFindings(result.findings);
  return Object.freeze({
    netPositions: result.netPositions,
    blockerCount: groups.blockers.length,
    actionCount: clientActionList(groups).length,
    reviewCount: groups.forReview.length,
  });
}
