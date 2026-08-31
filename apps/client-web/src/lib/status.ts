/**
 * Status view and clone-to-draft (`D-08`).
 *
 * Two decisions govern this screen, and both are refusals dressed as features.
 *
 * **1. The client status vocabulary is COARSE, deliberately** (`OD-12`).
 * Three states, not the internal lifecycle. A client watching a submission
 * move through seven internal stages learns our process rather than their
 * answer, and every stage transition becomes a question we have to field. The
 * internal states exist; they are simply not this screen's business.
 *
 * **2. Cloning never touches the original.** A frozen revision is immutable at
 * the database layer, so a clone that mutated its source would fail anyway —
 * but failing at the database is a 500, and refusing here is a design. The
 * clone records `derived_from_revision_id` and the source's `content_hash`
 * stays byte-identical, which is what makes the lineage checkable later.
 *
 * The SLA clocks are also constrained (`OD-11`): targets stay hidden from
 * external users until a baseline exists over ten live submissions, and neither
 * clock is ever labelled *engineering review* — that names an authority this
 * product does not hold, and the label escapes into UI strings and emails.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** What the CLIENT sees. Three states (`OD-12`), never the internal lifecycle. */
export type ClientStatus = 'draft' | 'submitted' | 'answered';

/**
 * The internal lifecycle, listed here ONLY to map it away.
 *
 * Keeping the mapping in one place, with the internal names visible, is what
 * stops someone "helpfully" surfacing `in_engineering_review` on a client
 * screen — the mapping is the decision, and it is greppable.
 */
export type InternalStatus =
  | 'draft'
  | 'submitted'
  | 'acknowledged'
  | 'in_review'
  | 'rfi_open'
  | 'quoted'
  | 'declined';

const STATUS_MAP: Readonly<Record<InternalStatus, ClientStatus>> = Object.freeze({
  draft: 'draft',
  submitted: 'submitted',
  // Everything between submission and an answer looks the same to the client.
  acknowledged: 'submitted',
  in_review: 'submitted',
  rfi_open: 'submitted',
  quoted: 'answered',
  declined: 'answered',
});

export class StatusError extends Error {
  override readonly name = 'StatusError';
}

/** Map an internal status to what the client may see. */
export function clientStatusFor(internal: InternalStatus): ClientStatus {
  const mapped = STATUS_MAP[internal];
  if (mapped === undefined) {
    // Fail closed: an unmapped internal state must not leak its own name.
    throw new StatusError(
      `no client status mapped for internal state '${internal}'. An unmapped state ` +
        'must not reach a client screen under its internal name.',
    );
  }
  return mapped;
}

/** The wording shown for each client status. */
export const STATUS_WORDING: Readonly<Record<ClientStatus, string>> = Object.freeze({
  draft: 'In progress. You can keep editing this.',
  submitted: 'With our team. We will come back to you.',
  answered: 'We have responded. See the details below.',
});

/**
 * Whether an SLA target may be shown to an external user.
 *
 * `OD-11`: hidden until a baseline exists over ten live submissions. Showing a
 * target before it is measured is a promise made from a guess, and the first
 * time it is missed the client is right to be annoyed.
 */
export const SLA_BASELINE_SUBMISSIONS = 10;

export function slaTargetsVisible(liveSubmissionsMeasured: number): boolean {
  return liveSubmissionsMeasured >= SLA_BASELINE_SUBMISSIONS;
}

/**
 * The two clocks, named for what they deliver.
 *
 * Never *prelim turnaround* or *engineering review*: the latter implies an
 * authority this product does not hold, and wording like that escapes into UI
 * strings and client emails where it cannot be recalled.
 */
export const CLOCK_NAMES = Object.freeze({
  acknowledgement: 'Acknowledgement',
  quoteDelivery: 'Quote delivery',
});

/** Wording that must never appear on a client-facing status screen. */
export const FORBIDDEN_STATUS_WORDING = Object.freeze([
  'engineering review',
  'prelim turnaround',
  'preliminary turnaround',
  'stamped',
  'sealed',
  'certified',
  'approved by engineer',
]);

/**
 * Check a client-facing string for wording that claims an authority the
 * product does not hold. Returns every problem, not the first.
 */
export function forbiddenWordingIn(text: string): readonly string[] {
  const lowered = text.toLowerCase();
  return Object.freeze(FORBIDDEN_STATUS_WORDING.filter((f) => lowered.includes(f)));
}

/* ------------------------------------------------------------------ *
 * Clone to draft.
 * ------------------------------------------------------------------ */

export interface Revision {
  readonly id: string;
  readonly code: string;
  readonly iteration: number;
  readonly frozen: boolean;
  readonly contentHash: string | null;
  readonly derivedFromRevisionId: string | null;
}

export interface CloneResult {
  readonly clone: Revision;
  /** The source, returned unchanged so a caller can assert it was not touched. */
  readonly source: Revision;
}

/**
 * Clone a frozen revision into a new draft.
 *
 * The source is returned alongside, deliberately: a test — and a caller —
 * should be able to assert the original's `content_hash` is byte-identical
 * rather than trust that nothing happened to it.
 */
export function cloneToDraft(source: Revision, newId: string): CloneResult {
  if (!source.frozen) {
    throw new StatusError(
      'only a frozen revision may be cloned. Cloning a draft would produce two ' +
        'editable copies of the same unfinished work, and no way to say which is current.',
    );
  }
  if (source.contentHash === null || source.contentHash.trim() === '') {
    throw new StatusError(
      'a frozen revision must carry a content hash; without one the clone has no ' +
        'lineage to record.',
    );
  }
  if (newId.trim() === '') {
    throw new StatusError('a clone needs an identifier.');
  }
  if (newId === source.id) {
    throw new StatusError('a clone must not reuse the source revision id.');
  }

  const clone: Revision = Object.freeze({
    id: newId,
    code: source.code,
    iteration: source.iteration + 1,
    frozen: false,
    // A new draft has no content hash: it has not been frozen, so there is
    // nothing to hash yet, and carrying the source's would be a lie.
    contentHash: null,
    derivedFromRevisionId: source.id,
  });

  return Object.freeze({ clone, source: Object.freeze({ ...source }) });
}

/**
 * Whether a revision may be edited.
 *
 * Frozen revisions are immutable, enforced in the database. This is the
 * screen's copy of that rule, so the UI does not offer an edit that the
 * database will refuse — an action that always fails is worse than an absent one.
 */
export function editable(revision: Revision): boolean {
  return !revision.frozen;
}
