import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { StaggerError, narrowestGap, stagger, type StaggerItem } from './stagger.js';

const IN = (n: number): number => n * 25_400;

describe('nothing moves when nothing collides', () => {
  it('leaves well-separated labels exactly where they are', () => {
    const result = stagger(
      [
        { id: 'a', at: IN(100), payload: undefined },
        { id: 'b', at: IN(200), payload: undefined },
        { id: 'c', at: IN(300), payload: undefined },
      ],
      IN(6),
    );
    expect(result.map((r) => r.label)).toEqual([IN(100), IN(200), IN(300)]);
    expect(result.every((r) => r.displaced === 0)).toBe(true);
  });

  it('handles none and one', () => {
    expect(stagger([], IN(6))).toEqual([]);
    const one = stagger([{ id: 'a', at: IN(100), payload: undefined }], IN(6));
    expect(one).toEqual([{ id: 'a', at: IN(100), label: IN(100), displaced: 0, payload: undefined }]);
  });
});

describe('the acceptance criterion — three reference lines never overprint', () => {
  /**
   * The real case. On a 28 ft building the underside of structure, the
   * sprinkler deflector and the maximum top of storage can sit within a few
   * inches of one another; at their true elevations the three labels are one
   * illegible smear.
   */
  it('separates three references crowded within two inches', () => {
    const result = stagger(
      [
        { id: 'deflector', at: IN(320), payload: undefined },
        { id: 'underside', at: IN(321), payload: undefined },
        { id: 'top-of-storage', at: IN(322), payload: undefined },
      ],
      IN(6),
    );
    expect(narrowestGap(result)).toBeGreaterThanOrEqual(IN(6));
  });

  it('separates three references at exactly the same elevation', () => {
    const result = stagger(
      [
        { id: 'a', at: IN(320), payload: undefined },
        { id: 'b', at: IN(320), payload: undefined },
        { id: 'c', at: IN(320), payload: undefined },
      ],
      IN(6),
    );
    expect(narrowestGap(result)).toBeGreaterThanOrEqual(IN(6));
  });

  it('never moves the reference line itself, only its label', () => {
    const input: readonly StaggerItem<undefined>[] = [
      { id: 'a', at: IN(320), payload: undefined },
      { id: 'b', at: IN(321), payload: undefined },
    ];
    const result = stagger(input, IN(6));
    for (const item of input) {
      expect(result.find((r) => r.id === item.id)?.at).toBe(item.at);
    }
  });
});

describe('order is preserved, which is what protects the reader', () => {
  /**
   * If staggering could reorder labels, the topmost text might name the lowest
   * line — and every number on the sheet would still be correct while the
   * drawing said something false.
   */
  it('label order matches elevation order', () => {
    const result = stagger(
      [
        { id: 'c', at: IN(322), payload: undefined },
        { id: 'a', at: IN(320), payload: undefined },
        { id: 'b', at: IN(321), payload: undefined },
      ],
      IN(12),
    );
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const labels = result.map((r) => r.label);
    expect([...labels].sort((x, y) => x - y)).toEqual(labels);
  });

  it('does not depend on the order the caller passed them in', () => {
    const items = [
      { id: 'a', at: IN(320), payload: undefined },
      { id: 'b', at: IN(321), payload: undefined },
      { id: 'c', at: IN(322), payload: undefined },
    ];
    const forward = stagger(items, IN(6));
    const backward = stagger([...items].reverse(), IN(6));
    expect(backward).toEqual(forward);
  });

  it('breaks an exact tie the same way every time', () => {
    const tied = [
      { id: 'z', at: IN(320), payload: undefined },
      { id: 'a', at: IN(320), payload: undefined },
    ];
    expect(stagger(tied, IN(6)).map((r) => r.id)).toEqual(['a', 'z']);
    expect(stagger([...tied].reverse(), IN(6)).map((r) => r.id)).toEqual(['a', 'z']);
  });
});

describe('labels are pushed up, never down', () => {
  /**
   * A label pushed DOWN drifts into the beam levels and unit loads that occupy
   * the body of the elevation — things this function cannot see and therefore
   * cannot avoid. Above the top reference there is only empty sheet.
   */
  it('displacement is never negative', () => {
    const result = stagger(
      [
        { id: 'a', at: IN(320), payload: undefined },
        { id: 'b', at: IN(320), payload: undefined },
        { id: 'c', at: IN(320), payload: undefined },
      ],
      IN(6),
    );
    expect(result.every((r) => r.displaced >= 0)).toBe(true);
  });

  it('leaves the lowest label undisplaced, so the group grows upward', () => {
    const result = stagger(
      [
        { id: 'a', at: IN(320), payload: undefined },
        { id: 'b', at: IN(320), payload: undefined },
      ],
      IN(6),
    );
    expect(result[0]?.displaced).toBe(0);
    expect(result[1]?.displaced).toBe(IN(6));
  });
});

describe('the properties hold for any input', () => {
  const arbItems = fc
    .uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 4 }),
        at: fc.integer({ min: 0, max: 10_000_000 }),
        payload: fc.constant(undefined),
      }),
      { selector: (i) => i.id, minLength: 1, maxLength: 12 },
    );

  it('always separates by at least minSeparation, preserves order, and never moves a line', () => {
    fc.assert(
      fc.property(arbItems, fc.integer({ min: 0, max: 500_000 }), (items, minSeparation) => {
        const result = stagger(items, minSeparation);

        // 1. every label is at least minSeparation from its neighbour
        expect(narrowestGap(result)).toBeGreaterThanOrEqual(
          result.length < 2 ? 0 : minSeparation,
        );
        // 2. order preserved
        const labels = result.map((r) => r.label);
        expect([...labels].sort((a, b) => a - b)).toEqual(labels);
        // 3. no line moved, and no label moved down
        for (const r of result) {
          const original = items.find((i) => i.id === r.id);
          expect(r.at).toBe(original?.at);
          expect(r.displaced).toBeGreaterThanOrEqual(0);
        }
        // 4. every input appears exactly once
        expect(result).toHaveLength(items.length);
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe('it refuses rather than guessing', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses minSeparation %o', (bad) => {
    expect(() => stagger([{ id: 'a', at: 0, payload: undefined }], bad)).toThrow(StaggerError);
  });

  it('refuses a fractional elevation, naming the early pixel conversion', () => {
    expect(() => stagger([{ id: 'a', at: 1.5, payload: undefined }], 0)).toThrow(/integer micrometre/);
  });

  it('refuses duplicate ids rather than silently dropping one', () => {
    expect(() =>
      stagger(
        [
          { id: 'a', at: 0, payload: undefined },
          { id: 'a', at: 1, payload: undefined },
        ],
        0,
      ),
    ).toThrow(/duplicate id/);
  });
});

describe('narrowestGap', () => {
  it('is Infinity for fewer than two labels', () => {
    expect(narrowestGap([])).toBe(Number.POSITIVE_INFINITY);
    expect(narrowestGap(stagger([{ id: 'a', at: 0, payload: undefined }], 0))).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports the smallest gap, not the first', () => {
    const labels = [
      { id: 'a', at: 0, label: 0, displaced: 0, payload: undefined },
      { id: 'b', at: 100, label: 100, displaced: 0, payload: undefined },
      { id: 'c', at: 110, label: 110, displaced: 0, payload: undefined },
    ];
    expect(narrowestGap(labels)).toBe(10);
  });
});
