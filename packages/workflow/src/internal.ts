/**
 * Internal revision derivation and internal notes (`E-04`, `E-05`, `AC-14`).
 *
 * Audit **D-01b**. All of this used to live in `apps/internal-web`, alongside
 * the queue's view logic. Deriving a revision and deciding what a client may
 * see are **server authorities**, and the same reasoning that moved `submit()`
 * here in T-07 applies: if the only thing enforcing a rule ships in a bundle, a
 * caller reaching the endpoints directly is not bound by it.
 *
 * `stripInternalRevisions` in particular is **not deleted and not weakened** by
 * the move. It is relocated, and demoted from sole enforcement to defence in
 * depth: T-03 put `audience` into the revision RLS policy, so the database now
 * refuses first and this filter is the second line rather than the only one.
 *
 * **There are no effects to inject here, and that is worth stating rather than
 * inventing a seam for.** All three functions are pure constructors over their
 * arguments — unlike `submit()`, which orchestrates a nine-step transaction and
 * needs `SubmitEffects`. Persisting a derived revision or a note needs tables
 * that do not exist yet; when they do, `apps/api` supplies the effects and owns
 * the transaction exactly as it does for submit. A `DeriveEffects` interface
 * with nothing behind it would be a control that states its own method and has
 * no mechanism — the shape this repository keeps finding in itself.
 *
 * Pure: no I/O, no clock, no RNG.
 */

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
export function stripInternalRevisions<T extends object>(
  items: readonly T[],
): readonly T[] {
  return Object.freeze(items.filter((i) => !isInternal(i)));
}

/**
 * F-27. The constraint used to be `{ readonly clientVisible?: boolean }`, and it
 * refused both shapes a real caller holds:
 *
 *   - **present-but-undefined** — `{ clientVisible: undefined }` is rejected
 *     under `exactOptionalPropertyTypes`, and that is exactly what a row read
 *     back from Postgres with a NULL column looks like;
 *   - **absent entirely** — the old constraint was a WEAK TYPE, every property
 *     optional, so TypeScript refused any object literal sharing no property
 *     with it. `stripInternalRevisions([{ id: 'p1' }])` did not compile.
 *
 * The danger was never the type error; it was what a caller does about one.
 * The path of least resistance is a cast, and a cast around the function that
 * decides what a client may see is how `AC-14` silently stops applying — with
 * nothing going red. `T extends object` accepts every real shape, and the
 * membership test below reads the marker without a cast of its own.
 *
 * Behaviour is unchanged: an item is internal only when it CARRIES the marker
 * and the marker is exactly `false`. Absent and undefined both mean "not
 * internal", which is what `!== false` meant before.
 */
function isInternal(item: object): boolean {
  return 'clientVisible' in item && item.clientVisible === false;
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
