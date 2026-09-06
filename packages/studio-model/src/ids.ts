/**
 * Deterministic entity ids.
 *
 * The prototype's shape is kept verbatim — `prefix_` plus a base-36 counter
 * padded to four characters — because the 22 interaction checks and the
 * continuity fixture both address entities by these strings. Changing the shape
 * would silently invalidate the fixture that exists to prove nothing changed.
 *
 * Two things are different, and both are deliberate.
 *
 * **The counter is not module state.** The prototype holds `_idSeq` as a module
 * variable and calls `resetIds(0)` inside `newDocument()`. That makes id
 * assignment depend on how many documents the process has built, which is a
 * hidden input — the exact shape `check-language`'s sibling rule bans for
 * `Date.now()` and `Math.random()`. Here the counter is passed in and returned,
 * so a command's ids are a function of its arguments and nothing else.
 *
 * **Resumption is explicit.** Loading a saved document and then minting a new
 * id must never collide with one already in the file. `resumeFrom` reads the
 * highest counter present and continues past it, rather than trusting a
 * separately stored "next id" that can drift from the document it describes.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Entity kinds that carry an id. The prefix is part of the id's contract. */
export const ID_PREFIXES = Object.freeze(['prj', 'bt', 'run', 'bay'] as const);
export type IdPrefix = (typeof ID_PREFIXES)[number];

/** `prj_0002`, `bay_001a`. Four base-36 characters, then as many as needed. */
export type EntityId = string;

/** Thrown rather than guessing when an id cannot be read. */
export class IdError extends Error {
  override readonly name = 'IdError';
}

const ID_RE = /^([a-z]+)_([0-9a-z]+)$/;

/** The counter a generator is at. Threaded through, never global. */
export interface IdCounter {
  readonly next: number;
}

export const counterAt = (next: number): IdCounter => {
  if (!Number.isInteger(next) || next < 0) {
    throw new IdError(`an id counter must be a non-negative integer, got ${String(next)}`);
  }
  return { next };
};

/** The counter a fresh document starts from. */
export const INITIAL_COUNTER: IdCounter = counterAt(0);

/**
 * Mint one id, returning it with the advanced counter.
 *
 * Returning the counter rather than mutating it is what makes a command
 * replayable: the same document and the same counter always produce the same
 * ids, which is what lets the undo ledger and the audit log describe the same
 * events.
 */
export function mintId(
  counter: IdCounter,
  prefix: IdPrefix,
): { readonly id: EntityId; readonly counter: IdCounter } {
  const n = counter.next + 1;
  return { id: `${prefix}_${n.toString(36).padStart(4, '0')}`, counter: counterAt(n) };
}

/** Mint several at once, in order. */
export function mintIds(
  counter: IdCounter,
  prefix: IdPrefix,
  howMany: number,
): { readonly ids: readonly EntityId[]; readonly counter: IdCounter } {
  if (!Number.isInteger(howMany) || howMany < 0) {
    throw new IdError(`howMany must be a non-negative integer, got ${String(howMany)}`);
  }
  const ids: EntityId[] = [];
  let c = counter;
  for (let i = 0; i < howMany; i += 1) {
    const minted = mintId(c, prefix);
    ids.push(minted.id);
    c = minted.counter;
  }
  return { ids, counter: c };
}

/** The numeric part of an id, or null when the string is not one of ours. */
export function counterOf(id: string): number | null {
  const m = ID_RE.exec(id);
  if (m === null) return null;
  const n = Number.parseInt(m[2] as string, 36);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * A counter that will not collide with any id already present.
 *
 * Walks whatever it is given and takes the maximum. Anything unrecognisable is
 * ignored rather than throwing: a document may legitimately carry ids this
 * build did not mint (a future prefix, an imported entity), and refusing to
 * open it would be worse than continuing past the ones we can read. What must
 * never happen is *reusing* a number, and taking the maximum of the readable
 * ids cannot do that for ids we could read.
 *
 * **The residual risk, stated:** an id whose counter we cannot parse could in
 * principle collide later. Nothing in this build mints such an id, and
 * `counterOf` is the single place that decides readability.
 */
export function resumeFrom(ids: Iterable<string>): IdCounter {
  let max = 0;
  for (const id of ids) {
    const n = counterOf(id);
    if (n !== null && n > max) max = n;
  }
  return counterAt(max);
}

/** Every id in a document-shaped object, for `resumeFrom`. */
export function collectIds(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    if (ID_RE.test(value)) into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // Only fields that hold ids are walked for strings; every other string is
      // free text and a project NAMED "run_0001" must not move the counter.
      if (key === 'id' || key.endsWith('Id')) collectIds(v, into);
      else if (typeof v === 'object') collectIds(v, into);
    }
  }
  return into;
}
