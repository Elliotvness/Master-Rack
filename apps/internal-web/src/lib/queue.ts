/**
 * The submission queue and internal revision derivation
 * (`E-01`, `E-02`, `E-04`, `E-05`).
 *
 * Three rules govern this side of the product, and each is the mirror image of
 * a client-side refusal.
 *
 * **1. The queue spans every organization.** The client app is org-scoped by
 * RLS; the internal app is not, and that asymmetry is the reason the two are
 * separate bundles. A staff principal seeing every tenant is correct here and
 * catastrophic there.
 *
 * **2. A derived internal revision is ABSENT from every client response** \u2014
 * not shown as locked (`AC-14`). "Locked" tells a client that something exists
 * which they may not see, which is itself information: it says we are working
 * on a variant of their job. Absence says nothing.
 *
 * **3. Deriving leaves the source submission's `content_hash` unchanged**, and
 * **waivers do not carry over**. A waiver is a judgement about one specific
 * configuration; carrying it into a derived revision would silently apply a
 * decision to a configuration nobody made it about.
 *
 * Pure: no I/O, no clock, no RNG. Ages are computed from supplied instants.
 */

/** The internal lifecycle, in full. The client sees three states; staff see these. */
export type InternalStatus =
  | 'submitted'
  | 'acknowledged'
  | 'in_review'
  | 'rfi_open'
  | 'quoted'
  | 'declined';

export interface QueueEntry {
  readonly submissionId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectNumber: string;
  readonly status: InternalStatus;
  /** ISO instants, supplied. Nothing here reads a clock. */
  readonly submittedAt: string;
  readonly acknowledgedAt: string | null;
  readonly quotedAt: string | null;
  readonly blockerCount: number;
  readonly reviewCount: number;
}

export class QueueError extends Error {
  override readonly name = 'QueueError';
}

/**
 * Age in whole hours against a supplied instant.
 *
 * `now` is a parameter rather than a clock read, so a queue rendered twice from
 * the same data is identical \u2014 and so this is testable without freezing time.
 */
export function ageHours(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) {
    throw new QueueError('an age needs two parseable ISO instants.');
  }
  if (now < from) {
    throw new QueueError('an age cannot be negative; the instants are out of order.');
  }
  return Math.floor((now - from) / 3_600_000);
}

/**
 * The two clocks, per `OD-11`.
 *
 * **Acknowledgement** stops when a human picks the submission up.
 * **Quote delivery** stops when a quote is returned. Neither is ever labelled
 * *engineering review*: that names an authority this product does not hold, and
 * the wording escapes into UI strings and client emails.
 *
 * A clock that has stopped reports the elapsed time at the stop, not the time
 * since \u2014 a stopped clock that keeps counting is just wrong.
 */
export interface ClockReading {
  readonly hours: number;
  readonly running: boolean;
}

export function acknowledgementClock(entry: QueueEntry, nowIso: string): ClockReading {
  const stop = entry.acknowledgedAt;
  return Object.freeze({
    hours: ageHours(entry.submittedAt, stop ?? nowIso),
    running: stop === null,
  });
}

export function quoteDeliveryClock(entry: QueueEntry, nowIso: string): ClockReading {
  const stop = entry.quotedAt;
  return Object.freeze({
    hours: ageHours(entry.submittedAt, stop ?? nowIso),
    running: stop === null,
  });
}

/**
 * Order the queue.
 *
 * Oldest first, because the queue's purpose is to stop something being
 * forgotten. Ties break on submission id so the order is total and a re-render
 * never reshuffles rows under someone's cursor.
 */
export function orderQueue(entries: readonly QueueEntry[]): readonly QueueEntry[] {
  return Object.freeze(
    [...entries].sort((a, b) => {
      const byTime = Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
      if (byTime !== 0) return byTime;
      // Submission ids are unique, so the equal case cannot arise; comparing
      // with `<` alone gives a total order without a third branch that no
      // input can reach.
      return a.submissionId < b.submissionId ? -1 : 1;
    }),
  );
}

/** The queue spans every organization. Asserted, because the client app must not. */
export function organizationsInQueue(entries: readonly QueueEntry[]): readonly string[] {
  return Object.freeze([...new Set(entries.map((e) => e.organizationId))].sort());
}

/* ------------------------------------------------------------------ *
 * E-04: derive an internal revision.
 * ------------------------------------------------------------------ */

export interface SourceSubmission {
  readonly submissionId: string;
  readonly revisionId: string;
  /** Must be unchanged by derivation. */
  readonly contentHash: string;
  /** Waivers granted on the source. These do NOT carry over. */
  readonly waivers: readonly string[];
}

export interface InternalRevision {
  readonly id: string;
  /** Internal revisions use the C lineage; client revisions use P. */
  readonly code: 'C';
  readonly derivedFromSubmissionId: string;
  readonly derivedFromRevisionId: string;
  readonly waivers: readonly string[];
  /** Never visible to a client, at any nesting depth (AC-14). */
  readonly clientVisible: false;
}

export interface DeriveResult {
  readonly derived: InternalRevision;
  /** Returned so a caller can assert the source was not touched. */
  readonly source: SourceSubmission;
}

export class DerivationError extends Error {
  override readonly name = 'DerivationError';
}

/**
 * Derive an internal revision from a client submission.
 *
 * The derived revision forks into a separate `C` lineage that **cannot write
 * back**. That is what keeps the client's submitted record the thing they
 * actually submitted, rather than a document that quietly changed after they
 * signed off on it.
 */
export function deriveInternalRevision(
  source: SourceSubmission,
  newRevisionId: string,
): DeriveResult {
  if (newRevisionId.trim() === '') {
    throw new DerivationError('a derived revision needs an identifier.');
  }
  if (newRevisionId === source.revisionId) {
    throw new DerivationError('a derived revision must not reuse the source revision id.');
  }
  if (source.contentHash.trim() === '') {
    throw new DerivationError(
      'the source submission must carry a content hash; without one the derived ' +
        'revision has no lineage to record.',
    );
  }

  return Object.freeze({
    derived: Object.freeze({
      id: newRevisionId,
      code: 'C' as const,
      derivedFromSubmissionId: source.submissionId,
      derivedFromRevisionId: source.revisionId,
      // Waivers do NOT carry over. A waiver is a judgement about one specific
      // configuration; carrying it would apply a decision to a configuration
      // nobody made it about.
      waivers: Object.freeze([]),
      clientVisible: false as const,
    }),
    source: Object.freeze({ ...source, waivers: Object.freeze([...source.waivers]) }),
  });
}

/**
 * `AC-14`: filter internal revisions out of anything client-facing.
 *
 * Removes them ENTIRELY rather than marking them locked. A locked row tells the
 * client something exists that they may not see, which is information: it says
 * we are working on a variant of their job, and invites the question we cannot
 * answer.
 */
export function stripInternalRevisions<T extends { readonly clientVisible?: boolean }>(
  items: readonly T[],
): readonly T[] {
  return Object.freeze(items.filter((i) => i.clientVisible !== false));
}

/* ------------------------------------------------------------------ *
 * E-05: internal notes.
 * ------------------------------------------------------------------ */

/**
 * An internal note is a DISTINCT ENTITY from a client-visible message.
 *
 * Not the same table with a flag. A flag is one wrong default, one missing
 * predicate or one `SELECT *` away from being published, and the failure is
 * silent. Two entities make an internal note reaching a client a type error.
 */
export interface InternalNote {
  readonly id: string;
  readonly submissionId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
  /** Structural marker, mirroring the internal revision. */
  readonly clientVisible: false;
}

export function internalNote(input: {
  readonly id: string;
  readonly submissionId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}): InternalNote {
  if (input.body.trim() === '') {
    throw new DerivationError('an internal note must carry a body.');
  }
  return Object.freeze({ ...input, clientVisible: false as const });
}
