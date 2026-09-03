/**
 * Hash stability.
 *
 * THIS TEST WAS WRITTEN BEFORE THE HASHING CODE. That order is advice given
 * independently by two of the four reference projects and by the blueprint, and
 * it is right: a hash function is trivially easy to write and almost impossible
 * to change later, because every stored hash in the system depends on it.
 *
 * What these assertions pin down:
 *   - the same content always produces the same hash, regardless of key order,
 *     construction order, or which machine ran it;
 *   - non-content fields (lineage, timestamps, author, note) are EXCLUDED, and
 *     the exclusion list is data a test can read rather than a convention;
 *   - a structure deeper than the bound FAILS LOUDLY rather than truncating.
 *     A truncating hash is the one failure mode a hash must not have, because
 *     it silently reports two different documents as identical.
 */

import { describe, expect, it } from 'vitest';
import { inches, pounds, um } from '@rms/kernel-units';

import {
  CanonicalDepthError,
  MAX_CANONICAL_DEPTH,
  NON_CONTENT_FIELDS,
  UnhashableValueError,
  canonicalise,
  canonicaliseAll,
  contentHash,
} from './canonical.js';

describe('determinism', () => {
  it('produces the same hash for the same content', () => {
    const a = { beam: inches(96), levels: 4 };
    const b = { beam: inches(96), levels: 4 };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('is independent of key insertion order', () => {
    const a = { alpha: 1, beta: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 1, beta: 2 };
    expect(canonicalise(a)).toBe(canonicalise(b));
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('is independent of key order at every nesting level', () => {
    const a = { outer: { x: 1, y: { p: 1, q: 2 } } };
    const b = { outer: { y: { q: 2, p: 1 }, x: 1 } };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('is NOT independent of array order, because order is content', () => {
    // A run of bays is ordered. Two orders are two different buildings.
    expect(contentHash({ bays: [1, 2] })).not.toBe(contentHash({ bays: [2, 1] }));
  });

  it('produces a different hash for different content', () => {
    expect(contentHash({ levels: 4 })).not.toBe(contentHash({ levels: 5 }));
  });

  it('distinguishes a missing key from an explicitly null one', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 1, b: null }));
  });

  it('drops undefined rather than encoding it, so absent means absent', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it('never confuses the number 1 with the string "1"', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: '1' }));
  });

  it('never confuses a quantity with its bare numeric value', () => {
    expect(contentHash({ span: inches(96) })).not.toBe(contentHash({ span: 2_438_400 }));
  });

  it('distinguishes two quantities that differ only in unit', () => {
    // Same magnitude, different basis. These must never collide.
    expect(contentHash({ cap: pounds(5400) })).not.toBe(
      contentHash({ cap: { value: 5_400_000, unit: 'lb/pr', origin: 'CATALOG' } }),
    );
  });

  it('distinguishes two quantities that differ only in origin', () => {
    expect(contentHash({ v: um(100, 'INPUT') })).not.toBe(
      contentHash({ v: um(100, 'CATALOG') }),
    );
  });

  it('returns a 64-character lowercase hex digest', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('what the hash covers', () => {
  it('holds the excluded field list as data a test can read', () => {
    expect([...NON_CONTENT_FIELDS].sort()).toEqual(
      [
        'author',
        'created_at',
        'derived_from_revision_id',
        'frozen_at',
        'iteration',
        'note',
        'parent_revision_id',
        'updated_at',
      ].sort(),
    );
  });

  it('ignores every non-content field', () => {
    const base = { beam: inches(96), levels: 4 };
    const withLineage = {
      ...base,
      author: 'someone',
      created_at: '2026-08-31T00:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      note: 'a note nobody should be able to change the hash with',
      parent_revision_id: 'rev_1',
      derived_from_revision_id: 'rev_0',
      iteration: 7,
      frozen_at: '2026-08-31T13:00:00Z',
    };
    expect(contentHash(withLineage)).toBe(contentHash(base));
  });

  it('excludes non-content fields at every depth, not just the root', () => {
    const a = { unit: { option: { levels: 4, author: 'x', note: 'y' } } };
    const b = { unit: { option: { levels: 4 } } };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('still hashes a content field whose name merely resembles an excluded one', () => {
    // 'authored_by' is not 'author'. Exclusion is exact, never prefix-based.
    expect(contentHash({ authored_by: 'x' })).not.toBe(contentHash({}));
  });
});

describe('scalar encoding', () => {
  it('encodes booleans, and never confuses them with strings or numbers', () => {
    expect(contentHash({ b: true })).not.toBe(contentHash({ b: false }));
    expect(contentHash({ b: true })).not.toBe(contentHash({ b: 'true' }));
    expect(contentHash({ b: true })).not.toBe(contentHash({ b: 1 }));
    expect(contentHash({ b: false })).not.toBe(contentHash({ b: 0 }));
    expect(contentHash({ b: true })).toBe(contentHash({ b: true }));
  });

  it('encodes strings, including ones that look like other types', () => {
    expect(canonicalise({ s: 'hello' })).toContain('"hello"');
    expect(contentHash({ s: 'null' })).not.toBe(contentHash({ s: null }));
    expect(contentHash({ s: 'true' })).not.toBe(contentHash({ s: true }));
  });

  it('escapes strings so a quote cannot forge structure', () => {
    expect(contentHash({ a: '","b":"' })).not.toBe(contentHash({ a: '', b: '' }));
  });

  it('preserves an explicit null', () => {
    expect(canonicalise({ a: null })).toBe('{"a":null}');
  });
});

describe('arrays', () => {
  it('preserves order and length', () => {
    expect(canonicalise({ a: [1, 2, 3] })).toBe('{"a":[n1,n2,n3]}');
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [1, 2, 3] }));
  });

  it('encodes a hole as null, because position in an array is content', () => {
    // Dropping an undefined here would shift every later element's index.
    const sparse = [1, undefined, 3];
    expect(canonicalise({ a: sparse })).toBe('{"a":[n1,null,n3]}');
    expect(contentHash({ a: sparse })).not.toBe(contentHash({ a: [1, 3] }));
  });

  it('handles an empty array distinctly from an absent key', () => {
    expect(contentHash({ a: [] })).not.toBe(contentHash({}));
  });

  it('recurses into nested arrays', () => {
    expect(canonicalise({ a: [[1], [2]] })).toBe('{"a":[[n1],[n2]]}');
  });
});

describe('collections with order semantics are refused', () => {
  it('refuses a Map', () => {
    expect(() => contentHash({ m: new Map([['a', 1]]) })).toThrow(UnhashableValueError);
    expect(() => contentHash({ m: new Map() })).toThrow(/insertion-order/);
  });

  it('refuses a Set', () => {
    expect(() => contentHash({ s: new Set([1, 2]) })).toThrow(UnhashableValueError);
    expect(() => contentHash({ s: new Set() })).toThrow(/Set/);
  });
});

describe('failing loudly', () => {
  it('refuses a structure deeper than the bound rather than truncating', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i <= MAX_CANONICAL_DEPTH + 1; i += 1) {
      deep = { nested: deep };
    }
    expect(() => contentHash(deep)).toThrow(CanonicalDepthError);
  });

  it('accepts a structure exactly at the bound', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_CANONICAL_DEPTH - 1; i += 1) {
      deep = { nested: deep };
    }
    expect(() => contentHash(deep)).not.toThrow();
  });

  it('refuses a cycle instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => contentHash(cyclic)).toThrow(CanonicalDepthError);
  });

  it('refuses a value it cannot canonicalise deterministically', () => {
    expect(() => contentHash({ fn: () => 1 })).toThrow(UnhashableValueError);
    expect(() => contentHash({ sym: Symbol('x') })).toThrow(UnhashableValueError);
    expect(() => contentHash({ big: 1n })).toThrow(UnhashableValueError);
  });

  it('refuses a non-finite number rather than encoding it as null', () => {
    // JSON.stringify turns NaN and Infinity into null, which would make three
    // distinct broken states hash identically to each other.
    expect(() => contentHash({ n: Number.NaN })).toThrow(UnhashableValueError);
    expect(() => contentHash({ n: Number.POSITIVE_INFINITY })).toThrow(UnhashableValueError);
  });

  it('refuses negative zero, which compares equal to zero but serialises apart', () => {
    expect(() => contentHash({ n: -0 })).toThrow(UnhashableValueError);
  });

  it('refuses a Date, because a timestamp is not content', () => {
    expect(() => contentHash({ d: new Date(0) })).toThrow(UnhashableValueError);
  });
});

describe('number formatting is fixed', () => {
  it('formats integers without exponent notation', () => {
    expect(canonicalise({ n: 1e21 })).toContain('1000000000000000000000');
  });

  it('expands very large integers rather than letting two spellings diverge', () => {
    // Above 1e21 JavaScript switches to exponent form. Both spellings of one
    // value must produce one hash.
    expect(canonicalise({ n: 1e22 })).toBe('{"n":n10000000000000000000000}');
    expect(contentHash({ n: 1e22 })).toBe(contentHash({ n: 10000000000000000000000 }));
  });

  it('never lets two spellings of the same number hash differently', () => {
    expect(contentHash({ n: 1.0 })).toBe(contentHash({ n: 1 }));
  });

  it('formats a fractional number stably', () => {
    expect(canonicalise({ n: 1.5 })).toBe('{"n":n1.5}');
    expect(contentHash({ n: 1.5 })).not.toBe(contentHash({ n: 1.50001 }));
  });

  it('formats negative numbers', () => {
    expect(canonicalise({ n: -42 })).toBe('{"n":n-42}');
    expect(contentHash({ n: -42 })).not.toBe(contentHash({ n: 42 }));
  });
});

describe('canonicaliseAll — the omit-set is empty, and that is the whole point', () => {
  it('keeps every field canonicalise drops, at the top level', () => {
    for (const field of NON_CONTENT_FIELDS) {
      // canonicalise cannot see the difference; canonicaliseAll must.
      expect(canonicalise({ [field]: 'a' })).toBe(canonicalise({ [field]: 'b' }));
      expect(canonicaliseAll({ [field]: 'a' })).not.toBe(canonicaliseAll({ [field]: 'b' }));
    }
  });

  it('keeps them at depth, not just at the root', () => {
    const a = { outer: { inner: [{ note: 'first' }] } };
    const b = { outer: { inner: [{ note: 'second' }] } };
    expect(canonicalise(a)).toBe(canonicalise(b));
    expect(canonicaliseAll(a)).not.toBe(canonicaliseAll(b));
  });

  it('agrees with canonicalise on a value that carries no dropped field', () => {
    const value = { bays: [1, 2, 3], label: 'row A', nested: { deep: true } };
    expect(canonicaliseAll(value)).toBe(canonicalise(value));
  });

  it('keeps every other refusal — depth, Date, Map, Set, bigint', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i <= MAX_CANONICAL_DEPTH + 1; i += 1) deep = { deep };
    expect(() => canonicaliseAll(deep)).toThrow(CanonicalDepthError);
    expect(() => canonicaliseAll({ d: new Date(0) })).toThrow(UnhashableValueError);
    expect(() => canonicaliseAll({ m: new Map() })).toThrow(UnhashableValueError);
    expect(() => canonicaliseAll({ s: new Set() })).toThrow(UnhashableValueError);
    expect(() => canonicaliseAll({ b: 1n })).toThrow(UnhashableValueError);
  });

  it('sorts keys and drops undefined exactly as canonicalise does', () => {
    expect(canonicaliseAll({ b: 1, a: 2 })).toBe(canonicaliseAll({ a: 2, b: 1 }));
    expect(canonicaliseAll({ a: 1, b: undefined })).toBe(canonicaliseAll({ a: 1 }));
  });

  it('still tags types, so "1" and 1 cannot collide', () => {
    expect(canonicaliseAll({ v: '1' })).not.toBe(canonicaliseAll({ v: 1 }));
  });
});
