/**
 * Canonical serialisation and content hashing.
 *
 * Two revisions with identical content must produce identical hashes on any
 * machine, in any order, forever. That is what makes "did this edit actually
 * change anything?" a one-comparison question, and what lets a submitted
 * revision be re-derived and re-verified two years later.
 *
 * The rules, each of which exists because the obvious alternative is wrong:
 *
 *   sorted keys          object key order is an implementation detail; array
 *                        order is content and is preserved.
 *   explicit types       1 and "1" must never collide, so every scalar is
 *                        tagged with its type.
 *   undefined dropped    absent means absent. null is a value and is kept.
 *   non-content excluded lineage, timestamps, author and note do not change
 *                        what the thing IS. The exclusion list is data.
 *   bounded depth        exceeded depth FAILS LOUDLY. A truncating hash
 *                        silently reports two different documents as the same,
 *                        which is the one failure mode a hash must not have.
 *   refuse the undecidable  functions, symbols, bigints, Dates, NaN, Infinity
 *                        and -0 have no single deterministic encoding, so they
 *                        are refused rather than guessed at.
 */

import { sha256 } from './sha256.js';

/** Maximum nesting depth. Matches the provenance walker's bound. */
export const MAX_CANONICAL_DEPTH = 32;

/**
 * Fields excluded from the hash.
 *
 * Held as data, not as a convention buried in a function, so a test can assert
 * exactly what the hash covers. Carried from rack-app/model/revision.py, which
 * held the same list for the same reason.
 *
 * These describe *where a revision came from* and *when it was recorded*, not
 * *what it is*. Two revisions with the same content are the same content even
 * if different people saved them at different times.
 */
export const NON_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'author',
  'created_at',
  'updated_at',
  'frozen_at',
  'note',
  'parent_revision_id',
  'derived_from_revision_id',
  'iteration',
]);

export class CanonicalError extends Error {
  override readonly name: string = 'CanonicalError';
}

/** Depth bound exceeded, or a cycle. Refused, never truncated. */
export class CanonicalDepthError extends CanonicalError {
  override readonly name = 'CanonicalDepthError';
  constructor(path: string) {
    super(
      `Canonical serialisation exceeded its depth bound of ${MAX_CANONICAL_DEPTH} at '${path}'. ` +
        'Refusing rather than truncating: a truncated hash reports two different ' +
        'documents as identical. If this is a cycle, the structure is malformed.',
    );
  }
}

/** A value with no single deterministic encoding. */
export class UnhashableValueError extends CanonicalError {
  override readonly name = 'UnhashableValueError';
  constructor(path: string, detail: string) {
    super(
      `Cannot canonicalise '${path}': ${detail} There is no single deterministic ` +
        'encoding for it, and guessing one would make the hash unreproducible.',
    );
  }
}

/**
 * Format a number so that every spelling of the same value produces the same
 * text, and no value is silently mangled.
 *
 * `JSON.stringify` turns NaN and Infinity into `null`, which would make three
 * distinct broken states hash identically to each other and to a real null.
 * Those are refused instead. Large integers are written in full rather than in
 * exponent form, because `1e21` and `1000000000000000000000` are the same
 * number and must not produce two hashes.
 */
function formatNumber(value: number, path: string): string {
  if (Number.isNaN(value)) {
    throw new UnhashableValueError(path, 'the value is NaN.');
  }
  if (!Number.isFinite(value)) {
    throw new UnhashableValueError(path, 'the value is infinite.');
  }
  if (Object.is(value, -0)) {
    throw new UnhashableValueError(
      path,
      'the value is negative zero, which compares equal to zero but serialises differently.',
    );
  }
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return value.toFixed(0);
  }
  if (Number.isInteger(value)) {
    // Beyond 1e21 toString uses exponent notation. Expand it so two spellings
    // of one value cannot diverge.
    return BigInt(value).toString();
  }
  return String(value);
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function encode(value: unknown, depth: number, path: string): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new CanonicalDepthError(path);
  }

  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      // Tagged, so the string "1" can never collide with the number 1.
      return `s${quote(value)}`;
    case 'number':
      return `n${formatNumber(value, path)}`;
    case 'boolean':
      return `b${value ? '1' : '0'}`;
    case 'bigint':
      throw new UnhashableValueError(
        path,
        'bigint has no agreed JSON encoding; store it as a string or a fixed-point integer.',
      );
    case 'function':
      throw new UnhashableValueError(path, 'a function is behaviour, not content.');
    case 'symbol':
      throw new UnhashableValueError(path, 'a symbol has no serialisable identity.');
    case 'undefined':
      // Reached only inside an array, where a hole is a real position.
      return 'null';
    default:
      break;
  }

  if (Array.isArray(value)) {
    // Array order IS content: a run of bays in a different order is a
    // different building. Never sorted.
    const parts = value.map((item, i) => encode(item, depth + 1, `${path}[${i}]`));
    return `[${parts.join(',')}]`;
  }

  if (value instanceof Date) {
    throw new UnhashableValueError(
      path,
      'a Date is a timestamp, and timestamps are not content. If it belongs in the ' +
        'hash, store it as an explicit ISO 8601 string field.',
    );
  }

  if (value instanceof Map || value instanceof Set) {
    throw new UnhashableValueError(
      path,
      `a ${value.constructor.name} has insertion-order semantics that do not survive ` +
        'serialisation. Convert it to a plain object or a sorted array first.',
    );
  }

  // Everything reaching here is a plain object: every other `typeof` is
  // handled above, and arrays, Dates, Maps and Sets were dealt with first.
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source)
    .filter((key) => !NON_CONTENT_FIELDS.has(key))
    .filter((key) => source[key] !== undefined)
    .sort();

  const parts = keys.map(
    (key) => `${quote(key)}:${encode(source[key], depth + 1, path === '' ? key : `${path}.${key}`)}`,
  );
  return `{${parts.join(',')}}`;
}

/**
 * Canonical text for a value. Deterministic, and stable across machines and
 * across runs. This text is what gets hashed, and it is worth being able to
 * print it: when two hashes disagree, diffing the canonical text says why.
 */
export function canonicalise(value: unknown): string {
  return encode(value, 0, '');
}

/**
 * SHA-256 over the canonical text, as 64 lowercase hex characters.
 *
 * Honest limit, carried from the blueprint: this gives **tamper evidence**, not
 * tamper proofing. It detects modification to anyone holding a later head hash.
 * It does not stop a database superuser. Never describe it as "tamper-proof".
 */
export function contentHash(value: unknown): string {
  return sha256(canonicalise(value));
}
