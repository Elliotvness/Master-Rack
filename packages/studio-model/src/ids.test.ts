import { describe, expect, it } from 'vitest';

import {
  ID_PREFIXES,
  INITIAL_COUNTER,
  IdError,
  collectIds,
  counterAt,
  counterOf,
  mintId,
  mintIds,
  resumeFrom,
} from './ids.js';

describe('mintId keeps the prototype\'s id shape', () => {
  it('is prefix, underscore, four base-36 characters', () => {
    expect(mintId(INITIAL_COUNTER, 'bay').id).toBe('bay_0001');
  });

  it('counts in base 36, so the tenth is 000a', () => {
    expect(mintIds(INITIAL_COUNTER, 'bay', 10).ids.at(-1)).toBe('bay_000a');
  });

  it('grows past four characters rather than wrapping', () => {
    expect(mintId(counterAt(36 ** 4 - 1), 'run').id).toBe('run_10000');
  });

  it.each(ID_PREFIXES)('mints for the %s prefix', (prefix) => {
    expect(mintId(INITIAL_COUNTER, prefix).id.startsWith(`${prefix}_`)).toBe(true);
  });
});

describe('the counter is threaded, not global', () => {
  /**
   * The prototype holds `_idSeq` as module state, so the ids a call produces
   * depend on how many documents the process has already built. That is a
   * hidden input of exactly the kind the eslint config bans `Date.now()` for.
   */
  it('the same counter always produces the same id', () => {
    expect(mintId(counterAt(41), 'run').id).toBe(mintId(counterAt(41), 'run').id);
  });

  it('returns the advanced counter rather than mutating the one given', () => {
    const before = counterAt(5);
    const after = mintId(before, 'bay').counter;
    expect(before.next).toBe(5);
    expect(after.next).toBe(6);
  });

  it('mints a run of ids in order', () => {
    const { ids, counter } = mintIds(counterAt(0), 'bay', 3);
    expect(ids).toEqual(['bay_0001', 'bay_0002', 'bay_0003']);
    expect(counter.next).toBe(3);
  });

  it('minting none advances nothing', () => {
    const { ids, counter } = mintIds(counterAt(7), 'bay', 0);
    expect(ids).toEqual([]);
    expect(counter.next).toBe(7);
  });
});

describe('a counter refuses nonsense rather than coercing it', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %o', (bad) => {
    expect(() => counterAt(bad)).toThrow(IdError);
  });

  it.each([-1, 2.5])('refuses %o as a count', (bad) => {
    expect(() => mintIds(INITIAL_COUNTER, 'bay', bad)).toThrow(IdError);
  });
});

describe('counterOf reads the numeric part, or says it cannot', () => {
  it('reads base 36', () => {
    expect(counterOf('bay_000a')).toBe(10);
    expect(counterOf('run_0001')).toBe(1);
  });

  it.each(['', 'bay', 'bay_', '_0001', 'BAY_0001', 'bay-0001', 'bay_00 1'])(
    'returns null for %o',
    (bad) => {
      expect(counterOf(bad)).toBeNull();
    },
  );
});

describe('resumeFrom will not reissue an id already present', () => {
  it('continues past the highest it can read', () => {
    expect(resumeFrom(['bay_0001', 'run_000z', 'bt_0002']).next).toBe(35);
  });

  it('ignores what it cannot parse rather than throwing', () => {
    // A document may legitimately carry ids this build did not mint. Refusing to
    // open it would be worse than continuing past the ones we can read.
    expect(resumeFrom(['bay_0005', 'something-else', '']).next).toBe(5);
  });

  it('is zero for an empty document', () => {
    expect(resumeFrom([]).next).toBe(0);
  });

  it('the next id minted is beyond every one seen', () => {
    const ids = ['bay_0001', 'bay_000f'];
    const next = mintId(resumeFrom(ids), 'bay').id;
    expect(ids).not.toContain(next);
    expect(counterOf(next)).toBeGreaterThan(15);
  });
});

describe('collectIds walks id fields and only id fields', () => {
  it('finds ids on `id` and `*Id` keys at any depth', () => {
    const doc = {
      id: 'prj_0001',
      runs: [{ id: 'run_0002', bayTypeId: 'bt_0003', bays: [{ id: 'bay_0004' }] }],
    };
    expect(collectIds(doc).sort()).toEqual(['bay_0004', 'bt_0003', 'prj_0001', 'run_0002']);
  });

  /**
   * The case that makes the key filter worth having: a project NAMED like an id
   * must not move the counter, or one badly chosen project name silently burns
   * a block of ids.
   */
  it('ignores an id-shaped string in a free-text field', () => {
    expect(collectIds({ id: 'prj_0001', name: 'run_9999' })).toEqual(['prj_0001']);
  });

  it('returns nothing for a document with no ids', () => {
    expect(collectIds({ name: 'x', nested: { note: 'y' } })).toEqual([]);
  });

  it('handles null and primitives without throwing', () => {
    expect(collectIds(null)).toEqual([]);
    expect(collectIds(42)).toEqual([]);
    expect(collectIds({ id: null })).toEqual([]);
  });
});

describe('an id whose counter is beyond safe integers is unreadable, not wrong', () => {
  /**
   * `parseInt(…, 36)` happily returns 1e21 for a long enough string. Treating
   * that as a counter would let `resumeFrom` return a number arithmetic can no
   * longer increment reliably — so it is reported as unreadable instead, and
   * `resumeFrom` skips it exactly as it skips anything else it cannot parse.
   */
  it('returns null rather than an unsafe number', () => {
    expect(counterOf(`bay_${'z'.repeat(20)}`)).toBeNull();
  });

  it('does not let one move the counter', () => {
    expect(resumeFrom(['bay_0003', `bay_${'z'.repeat(20)}`]).next).toBe(3);
  });
});
