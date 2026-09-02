/**
 * The submission queue's VIEW logic (`E-01`, `E-02`).
 *
 * **T-08 moved derivation, internal notes and `stripInternalRevisions` out of
 * this file** and into `@rms/workflow` — they are server authorities, and this
 * is an app bundle. What remains is what a screen legitimately computes:
 * ordering, the two OD-11 clocks, and ages. Rules 2 and 3 below are recorded
 * here because they are why the split exists, and are enforced in
 * `packages/workflow/src/internal.ts`.
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
