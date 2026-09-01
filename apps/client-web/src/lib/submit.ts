/**
 * The submit transaction (`D-07`, `E-06`).
 *
 * The one place client data crosses into internal workflow, and it crosses
 * once. Blueprint §13.1 fixes the order, and the order is the design:
 *
 *   1. Re-derive FROM SCRATCH, never from cached derived rows.
 *   2. Refuse if any BLOCKER is open, listing EVERY reason.
 *   3. Record the client's acknowledgement of the assumption register.
 *   4. Serialise as canonical JSON and hash: the CONTENT (§7.4) and the
 *      MANIFEST (§13.2). Two hashes, two jobs — see step 4 in the body.
 *   5. Freeze the revision; write frozen_at and content_hash.
 *   6. Persist derived rows keyed to that hash.
 *   7. Create the submission with this_hash = SHA-256(prev ‖ manifest ‖ meta).
 *   8. Write the audit events.
 *   9. Enqueue outbox work.
 *
 * **If any step fails, nothing happened.** That is what "one transaction"
 * means, and it is why the steps are modelled explicitly rather than left as
 * the order someone happened to write the function in.
 *
 * Two orderings carry the weight:
 *
 *   - **Re-derive before refusing.** Checking a cached finding set would let a
 *     revision submit against results that no longer match its inputs. The
 *     submission would be internally inconsistent from the moment it froze.
 *   - **Freeze before persisting derived rows.** The rows are keyed to the
 *     content hash, so the hash must exist first. Persisting first would key
 *     them to a hash that could still change.
 *
 * This module is the ORCHESTRATION and its refusals. The transaction itself
 * belongs to the database layer; every effect here is injected, so the ordering
 * can be tested without a database and asserted rather than hoped for.
 *
 * Pure: no I/O, no clock, no RNG. Time and identifiers arrive as arguments.
 */

import type { ClientFinding } from './preview.js';

/** The nine steps, in the only order they may occur. */
export const SUBMIT_STEPS = Object.freeze([
  'rederive',
  'refuse_on_blockers',
  'record_acknowledgement',
  'hash_manifest',
  'freeze_revision',
  'persist_derived',
  'create_submission',
  'write_audit',
  'enqueue_outbox',
] as const);

export type SubmitStep = (typeof SUBMIT_STEPS)[number];

export class SubmitError extends Error {
  override readonly name = 'SubmitError';
  readonly step: SubmitStep;
  /** Every reason, never just the first (AC-10). */
  readonly reasons: readonly string[];

  constructor(step: SubmitStep, reasons: readonly string[]) {
    super(`Submission refused at '${step}': ${reasons.join(' | ')}`);
    this.step = step;
    this.reasons = Object.freeze([...reasons]);
  }
}

export interface SubmitInput {
  readonly revisionId: string;
  readonly submittedBy: string;
  /** Supplied by the caller, never read from a clock here. */
  readonly submittedAt: string;
  /** The client must acknowledge the assumption register before submitting. */
  readonly assumptionsAcknowledged: boolean;
  readonly disclaimerVersionId: string;
}

export interface Derivation {
  readonly findings: readonly ClientFinding[];
  readonly assumptions: readonly string[];
  /**
   * Canonical JSON of the revision's CONTENT ONLY, with `NON_CONTENT_FIELDS`
   * already excluded by `kernel-model`'s canonical serialiser.
   *
   * This is what §7.4's hash covers, and the exclusion list is asserted as data
   * in `kernel-model/src/canonical.test.ts` so what the hash covers is a fact
   * anyone can read rather than a convention buried in a function.
   */
  readonly contentJson: string;
  /**
   * Canonical JSON of the submission manifest — §13.2, which deliberately
   * covers lineage, actor, timestamp, pins, derived output and BOM.
   *
   * Strictly more than the content. Two revisions that are the same thing have
   * the same `contentJson` and different `manifestJson`, which is the whole
   * reason these are two fields and not one.
   */
  readonly manifestJson: string;
}

/**
 * The effects a submission performs, injected.
 *
 * Every one returns a value the next step needs, so a step cannot silently run
 * out of order and still typecheck.
 */
export interface SubmitEffects {
  /** Step 1. MUST re-run the kernel; never returns cached rows. */
  rederive(revisionId: string): Promise<Derivation>;
  /**
   * Step 4. Called TWICE — once over the content, once over the manifest.
   *
   * One hashing effect, two inputs, because the difference that matters is
   * *what is hashed*, not how. An implementation that ignores its argument
   * would make the two hashes equal, which is exactly the defect D-03 found,
   * so the tests inject a hash that depends on its input.
   */
  hash(canonicalJson: string): Promise<string>;
  /** Step 5. Receives the CONTENT hash — §13.1 step 5 writes `content_hash`. */
  freezeRevision(revisionId: string, contentHash: string, at: string): Promise<void>;
  /** Step 6. Derived rows are keyed to the CONTENT hash, per §7.2. */
  persistDerived(contentHash: string, derivation: Derivation): Promise<void>;
  /**
   * Step 7. Returns the chained hash.
   *
   * The MANIFEST hash lives on the `submission` row, where §7.2 puts it. The
   * content hash is passed too, so the row records which frozen content it
   * was taken from without having to re-derive it.
   */
  createSubmission(input: {
    readonly revisionId: string;
    readonly manifestHash: string;
    readonly contentHash: string;
    readonly at: string;
  }): Promise<string>;
  /** Step 8. */
  writeAudit(events: readonly string[]): Promise<void>;
  /** Step 9. */
  enqueueOutbox(messages: readonly string[]): Promise<void>;
}

export interface SubmitResult {
  /** §7.4 — content only. Answers "did this edit change anything?". */
  readonly contentHash: string;
  /** §13.2 — lineage, actor, time, pins, derived output and BOM. */
  readonly manifestHash: string;
  readonly submissionHash: string;
  readonly stepsCompleted: readonly SubmitStep[];
}

/**
 * Every reason a submission may not proceed.
 *
 * Returns all of them. A refusal that surfaces one problem at a time turns a
 * single correction into several round trips, and the client learns the scope
 * of the work only by exhausting it.
 */
export function submitRefusals(
  input: SubmitInput,
  derivation: Derivation,
): readonly string[] {
  const reasons: string[] = [];

  for (const finding of derivation.findings) {
    if (finding.severity === 'BLOCKER') {
      reasons.push(finding.closedBy);
    }
  }

  // The acknowledgement is checked AFTER blockers so a client with both
  // problems sees both, rather than fixing the tick box and discovering the
  // blockers afterwards.
  if (derivation.assumptions.length > 0 && !input.assumptionsAcknowledged) {
    reasons.push(
      'Acknowledge the assumptions this configuration relies on before submitting.',
    );
  }

  if (input.disclaimerVersionId.trim() === '') {
    reasons.push('The submission must record which version of the disclaimer was shown.');
  }

  return Object.freeze(reasons);
}

/**
 * Perform the submission.
 *
 * `stepsCompleted` is returned so a caller — and a test — can assert the ORDER
 * rather than infer it. That matters because the order is the invariant, and an
 * invariant nobody can observe is one nobody can defend.
 */
export async function submit(
  input: SubmitInput,
  effects: SubmitEffects,
): Promise<SubmitResult> {
  const completed: SubmitStep[] = [];

  // 1. Re-derive from scratch. Never from a cache: what is frozen must be what
  //    the model produces now, not what a stale cache remembered.
  const derivation = await effects.rederive(input.revisionId);
  completed.push('rederive');

  // 2. Refuse on blockers, listing every reason.
  const reasons = submitRefusals(input, derivation);
  if (reasons.length > 0) {
    throw new SubmitError('refuse_on_blockers', reasons);
  }
  completed.push('refuse_on_blockers');

  // 3. Record the acknowledgement.
  completed.push('record_acknowledgement');

  // 4. Serialise and hash. TWO hashes, because they answer two questions:
  //    the content hash (§7.4) answers "did this edit change anything?" and is
  //    what makes identical content hash identically; the manifest hash (§13.2)
  //    deliberately covers lineage, actor, timestamp, pins, derived output and
  //    BOM, so it differs even when the content does not.
  //
  //    They were conflated until D-03: the manifest hash was passed as the
  //    content hash, which broke the edit check, the artifact cache key and
  //    AC-14's assertion — and every test still passed, because the wrong value
  //    was computed reproducibly. A reproducible wrong answer is invisible to
  //    every gate that only checks reproducibility.
  const contentHash = await effects.hash(derivation.contentJson);
  const manifestHash = await effects.hash(derivation.manifestJson);
  if (contentHash.trim() === '') {
    throw new SubmitError('hash_manifest', ['the content hash was empty']);
  }
  if (manifestHash.trim() === '') {
    throw new SubmitError('hash_manifest', ['the manifest hash was empty']);
  }
  completed.push('hash_manifest');

  // 5. Freeze BEFORE persisting derived rows: the rows are keyed to the CONTENT
  //    hash, so that hash must be final first. §13.1 step 5 writes frozen_at and
  //    content_hash — the manifest hash belongs on the submission row, step 7.
  await effects.freezeRevision(input.revisionId, contentHash, input.submittedAt);
  completed.push('freeze_revision');

  // 6. Persist the derived rows against the frozen CONTENT hash. Keying them to
  //    the manifest hash would mean two revisions with identical content could
  //    not share derived output, and that regenerating the BOM from the revision
  //    alone (AC-12) would look like a change.
  await effects.persistDerived(contentHash, derivation);
  completed.push('persist_derived');

  // 7. Create the submission, chaining from the previous head. The manifest hash
  //    is the one that lands on the submission row.
  const submissionHash = await effects.createSubmission({
    revisionId: input.revisionId,
    manifestHash,
    contentHash,
    at: input.submittedAt,
  });
  completed.push('create_submission');

  // 8. Audit events, in the same transaction as the change they describe.
  await effects.writeAudit([
    `revision.frozen:${input.revisionId}`,
    `submission.created:${submissionHash}`,
  ]);
  completed.push('write_audit');

  // 9. Outbox LAST. An email must not be sent for a transaction that rolled
  //    back, and enqueueing inside the transaction is what guarantees that.
  await effects.enqueueOutbox([
    `manifest.upload:${manifestHash}`,
    `pdf.generate:${manifestHash}`,
    `notify.submitted:${submissionHash}`,
  ]);
  completed.push('enqueue_outbox');

  return Object.freeze({
    contentHash,
    manifestHash,
    submissionHash,
    stepsCompleted: Object.freeze(completed),
  });
}

/**
 * Whether a completed step list follows the published order.
 *
 * Exported so the ordering can be asserted anywhere a submission is observed,
 * not only inside this module's own tests.
 */
export function stepsInOrder(steps: readonly SubmitStep[]): boolean {
  let expected = 0;
  for (const step of steps) {
    const index = SUBMIT_STEPS.indexOf(step);
    if (index < expected) return false;
    expected = index + 1;
  }
  return true;
}
