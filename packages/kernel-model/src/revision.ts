/**
 * The revision lifecycle.
 *
 * A revision is the only thing stored as fact; everything else is derived from
 * it. So the rules about when a revision may change, and what happens when it
 * may not, are the spine of the product.
 *
 * Four behaviours here are deliberate and look like over-engineering until you
 * have been burned by their absence:
 *
 *   1. A refusal lists EVERY reason, not the first. Fixing one blocker only to
 *      be told about the next is how a client abandons a submission.
 *   2. A refusal is itself an audit event. "The system stopped me" has to be
 *      provable later, not just experienced at the time.
 *   3. Publishing DEEP FREEZES the revision, so a later mutation is a
 *      TypeError rather than a silent write nobody notices.
 *   4. The content hash excludes lineage and timestamps, so two revisions with
 *      the same content are recognisably the same content.
 *
 * Ported in shape from rack-studio/packages/model/revision.ts.
 */

import { contentHash } from './canonical.js';

/**
 * Lifecycle state.
 *
 * DRAFT     being configured; the only editable state.
 * FROZEN    submitted. Immutable for everyone, including us.
 * SUPERSEDED  a later revision replaced it. Still immutable, still renderable.
 * WITHDRAWN the commercial request was withdrawn. The record does not change.
 */
export type LifecycleState = 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';

/** Who a revision is for. Internal revisions are absent from client responses. */
export type Audience = 'client' | 'internal';

export interface Revision {
  readonly id: string;
  /** P01 for client-facing preliminary, C01 for internal contractual. */
  readonly revision_code: string;
  readonly iteration: number;
  readonly lifecycle_state: LifecycleState;
  readonly audience: Audience;
  readonly parent_revision_id: string | null;
  readonly derived_from_revision_id: string | null;
  /** Pins live inside the hashed content: a catalog change cannot alter a submission. */
  readonly catalog_release_id: string;
  readonly rule_pack_release_id: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly content_hash: string | null;
  readonly frozen_at: string | null;
}

/**
 * A refused transition, carrying every reason.
 *
 * This is an error rather than a returned union because a caller that ignores
 * a refusal must not be able to carry on as though it succeeded.
 */
export class TransitionRefusedError extends Error {
  override readonly name = 'TransitionRefusedError';
  readonly reasons: readonly string[];
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  /**
   * The refusal as an audit event. Carried on the error so a caller that
   * catches it still has the record to write: a refusal nobody can prove
   * happened is not much better than no refusal.
   */
  readonly audit: AuditEvent;

  constructor(
    from: LifecycleState,
    to: LifecycleState,
    reasons: readonly string[],
    resourceId: string,
  ) {
    super(
      `Refused to move revision from ${from} to ${to}. ` +
        `${reasons.length} reason(s): ${reasons.join(' | ')}`,
    );
    this.from = from;
    this.to = to;
    this.reasons = Object.freeze([...reasons]);
    this.audit = Object.freeze({
      action: `revision.${to.toLowerCase()}_refused`,
      resource_type: 'revision' as const,
      resource_id: resourceId,
      outcome: 'denied' as const,
      reasons: this.reasons,
    });
  }
}

/**
 * Waiver authority is undecided (OD-09).
 *
 * This THROWS rather than returning false. Returning false would silently
 * default to a policy nobody chose; throwing names the open decision and makes
 * the gap impossible to ship past by accident.
 */
export class UndecidedAuthorityError extends Error {
  override readonly name = 'UndecidedAuthorityError';
  constructor(decision: string) {
    super(
      `${decision} is not decided. This function refuses rather than defaulting to a ` +
        'policy nobody chose. Answer the decision, then implement it deliberately.',
    );
  }
}

/** Permitted transitions. Anything absent here is refused. */
const ALLOWED: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  DRAFT: ['FROZEN'],
  FROZEN: ['SUPERSEDED', 'WITHDRAWN'],
  SUPERSEDED: [],
  WITHDRAWN: [],
};

/**
 * An audit event. Written in the same transaction as the change it describes —
 * including when the "change" is a refusal, because a refusal is a fact about
 * the system that someone may need to prove later.
 */
export interface AuditEvent {
  readonly action: string;
  readonly resource_type: 'revision';
  readonly resource_id: string;
  readonly outcome: 'success' | 'denied';
  readonly reasons: readonly string[];
}

export interface TransitionResult {
  readonly revision: Revision;
  readonly audit: AuditEvent;
}

/**
 * Every reason a transition is not permitted. Empty means it is.
 *
 * Exposed separately from the transition itself so a UI can show the whole list
 * before the user commits to the action.
 */
export function transitionRefusals(
  revision: Revision,
  to: LifecycleState,
  openBlockerCodes: readonly string[] = [],
): readonly string[] {
  const reasons: string[] = [];
  const from = revision.lifecycle_state;

  if (from === to) {
    reasons.push(`the revision is already ${to}`);
  } else if (!(ALLOWED[from] as readonly LifecycleState[]).includes(to)) {
    const permitted = ALLOWED[from];
    reasons.push(
      permitted.length === 0
        ? `${from} is a terminal state and permits no transition`
        : `${from} may only move to ${permitted.join(' or ')}`,
    );
  }

  if (to === 'FROZEN') {
    // Every blocker is listed, not just the first. This is the whole point.
    for (const code of openBlockerCodes) {
      reasons.push(`blocker ${code} is open`);
    }
    if (revision.catalog_release_id === '') {
      reasons.push('no catalog release is pinned');
    }
    if (revision.rule_pack_release_id === '') {
      reasons.push('no rule pack release is pinned');
    }
  }

  return Object.freeze(reasons);
}

export function canTransition(
  revision: Revision,
  to: LifecycleState,
  openBlockerCodes: readonly string[] = [],
): boolean {
  return transitionRefusals(revision, to, openBlockerCodes).length === 0;
}

/** Recursively freeze, so a nested mutation is a TypeError rather than a silent write. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Freeze a revision at submission.
 *
 * Computes the content hash, records the frozen timestamp supplied by the
 * caller — never read from a clock here, because the kernel is deterministic —
 * and deep-freezes the result.
 *
 * Refuses with every reason if the transition is not permitted, and that
 * refusal is itself an audit event.
 */
export function freeze(
  revision: Revision,
  frozenAt: string,
  openBlockerCodes: readonly string[] = [],
): TransitionResult {
  const reasons = transitionRefusals(revision, 'FROZEN', openBlockerCodes);
  if (reasons.length > 0) {
    throw new TransitionRefusedError(revision.lifecycle_state, 'FROZEN', reasons, revision.id);
  }

  const frozen: Revision = {
    ...revision,
    lifecycle_state: 'FROZEN',
    frozen_at: frozenAt,
    content_hash: contentHash(revision.content),
  };

  return Object.freeze({
    revision: deepFreeze(frozen),
    audit: Object.freeze({
      action: 'revision.frozen',
      resource_type: 'revision' as const,
      resource_id: revision.id,
      outcome: 'success' as const,
      reasons: Object.freeze([]) as readonly string[],
    }),
  });
}

/**
 * Clone a frozen revision into a new draft.
 *
 * The source is untouched: `derived_from_revision_id` is recorded on the child,
 * and the parent's hash is unchanged by construction because nothing writes to
 * it. That is the invariant that makes internal refinement safe.
 */
export function cloneToDraft(
  source: Revision,
  newId: string,
  newRevisionCode: string,
  audience: Audience = source.audience,
): Revision {
  return Object.freeze({
    ...source,
    id: newId,
    revision_code: newRevisionCode,
    iteration: 1,
    lifecycle_state: 'DRAFT' as const,
    audience,
    parent_revision_id: source.id,
    derived_from_revision_id: source.id,
    content_hash: null,
    frozen_at: null,
    // Content is carried forward; it is re-derived and re-hashed on the next freeze.
    content: source.content,
  });
}

/**
 * May this actor waive this finding?
 *
 * Deliberately unimplemented. OD-09 — who may waive what — is genuinely
 * undecided, and the correct behaviour for an undecided authority question is
 * to refuse loudly rather than to pick a default that then becomes policy by
 * accident.
 */
export function mayWaive(): never {
  throw new UndecidedAuthorityError('OD-09 (waiver authority)');
}
