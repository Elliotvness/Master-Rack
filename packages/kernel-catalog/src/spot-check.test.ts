import { describe, expect, it } from 'vitest';

import {
  drawSpotCheckSample,
  drawSupplementarySample,
  readingsCovered,
  requiredSampleSize,
  spotCheckRefusals,
} from './index.js';

// Real-shaped ids: publishedKeyOf parses family/series/span, and a synthetic
// 'beams-cell-N' is not a beam cell id. The fixtures use distinct families so
// no two collapse onto one published value.
const ids = (n: number): readonly string[] =>
  Array.from({ length: n }, (_, i) => `F${i}/F4M/48in`);

function check(over: Partial<Parameters<typeof spotCheckRefusals>[0]> = {}) {
  const cells = 336;
  return {
    dataset: 'beams',
    cells,
    sampledCells: drawSpotCheckSample(ids(cells), 20260901, requiredSampleSize(cells)),
    supplementaryCells: [],
    seed: 20260901,
    checkedBy: 'Elliott Villacorta',
    outcome: 'MATCHED',
    pageRef: 'PSG 2025 p.88',
    ...over,
  };
}

describe('requiredSampleSize — 20 cells or 5%, whichever is greater', () => {
  it('is the floor on a small table', () => {
    expect(requiredSampleSize(336)).toBe(20);
    expect(requiredSampleSize(100)).toBe(20);
  });

  it('is 5%, rounded up, on a large one', () => {
    expect(requiredSampleSize(435)).toBe(22);
    expect(requiredSampleSize(401)).toBe(21);
    expect(requiredSampleSize(10_000)).toBe(500);
  });

  it('never demands more cells than exist', () => {
    // A ten-cell table requires ten. The rule is a floor on effort, not an
    // impossible bar that makes small datasets unapprovable.
    expect(requiredSampleSize(10)).toBe(10);
    expect(requiredSampleSize(0)).toBe(0);
  });

  it('refuses a cell count that is not a whole non-negative number', () => {
    expect(() => requiredSampleSize(-1)).toThrow(RangeError);
    expect(() => requiredSampleSize(1.5)).toThrow(/non-negative integer/);
  });
});

describe('drawSpotCheckSample — reproducible, unbiased, refusing the impossible', () => {
  it('is a pure function of (cells, seed, size)', () => {
    expect(drawSpotCheckSample(ids(50), 7, 20)).toEqual(drawSpotCheckSample(ids(50), 7, 20));
  });

  it('gives a different sample for a different seed', () => {
    expect(drawSpotCheckSample(ids(50), 7, 20)).not.toEqual(drawSpotCheckSample(ids(50), 8, 20));
  });

  it('never draws the same cell twice', () => {
    const drawn = drawSpotCheckSample(ids(50), 7, 20);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('refuses an empty list, an oversized draw, and duplicate ids', () => {
    expect(() => drawSpotCheckSample([], 1, 0)).toThrow(/empty cell list/);
    expect(() => drawSpotCheckSample(ids(5), 1, 6)).toThrow(/cannot draw 6 cells from 5/);
    expect(() => drawSpotCheckSample(['a', 'a'], 1, 1)).toThrow(/must be unique/);
  });
});

describe('spotCheckRefusals — every way a record fails the gate', () => {
  it('accepts an honest record', () => {
    expect(spotCheckRefusals(check(), 'automated extract (Claude)', ids(336))).toEqual([]);
  });

  it('requires a named checker', () => {
    expect(spotCheckRefusals(check({ checkedBy: '  ' }), 'machine', ids(336))).toContainEqual(
      expect.stringContaining('must name who performed it'),
    );
  });

  it('refuses the digitiser checking their own extract', () => {
    // "A machine is a tool, not an independent party." The whole of D-07.
    expect(
      spotCheckRefusals(check({ checkedBy: 'machine' }), 'machine', ids(336)),
    ).toContainEqual(expect.stringContaining('a machine is a tool'));
  });

  it('refuses too few cells', () => {
    expect(
      spotCheckRefusals(check({ sampledCells: ids(336).slice(0, 5) }), 'machine', ids(336)),
    ).toContainEqual(expect.stringContaining('covered 5 cells'));
  });

  it('refuses a sample listing the same cell more than once', () => {
    // Twenty entries, nineteen readings. The count check alone would pass it.
    const drawn = drawSpotCheckSample(ids(336), 20260901, 20);
    const padded = [...drawn.slice(0, 19), drawn[0] as string];
    expect(spotCheckRefusals(check({ sampledCells: padded }), 'machine', ids(336))).toContainEqual(
      expect.stringContaining('lists the same cell more than once'),
    );
  });

  it('refuses a record that does not say which page was read', () => {
    expect(spotCheckRefusals(check({ pageRef: '   ' }), 'machine', ids(336))).toContainEqual(
      expect.stringContaining('must name the page it was read from'),
    );
  });

  it('refuses any outcome that is not MATCHED — there is no partial pass', () => {
    for (const outcome of ['matched', 'MATCHED ', 'MOSTLY', '']) {
      expect(spotCheckRefusals(check({ outcome }), 'machine', ids(336))).toContainEqual(
        expect.stringContaining('any mismatch fails the entire release'),
      );
    }
  });

  it('refuses a cell count that disagrees with the dataset', () => {
    expect(spotCheckRefusals(check({ cells: 40 }), 'machine', ids(336))).toContainEqual(
      expect.stringContaining('records 40 cells but the dataset holds 336'),
    );
  });

  it('refuses a dataset with a repeated id — the draw over it is undefined', () => {
    const dupes = [...ids(335), 'F0/F4M/48in'];
    expect(spotCheckRefusals(check(), 'machine', dupes)).toContainEqual(
      expect.stringContaining('contains a repeated cell id'),
    );
  });

  it('refuses cells that were never drawn, and says which kind of wrong they are', () => {
    const fake = Array.from({ length: 20 }, (_, i) => `TOTALLY/FAKE/CELL-${i}`);
    expect(spotCheckRefusals(check({ sampledCells: fake }), 'machine', ids(336))).toContainEqual(
      expect.stringContaining('not in the dataset at all'),
    );

    const realButWrong = ids(336).slice(0, 20);
    expect(
      spotCheckRefusals(check({ sampledCells: realButWrong }), 'machine', ids(336)),
    ).toContainEqual(expect.stringContaining('are not the ones the tool drew'));
  });
});

describe('drawSupplementarySample — topping up readings, never redrawing', () => {
  const pool = [...ids(30), '59E/F4M/48in', '59ER/F4M/48in'];

  it('returns nothing when nothing is short', () => {
    expect(drawSupplementarySample('beams', pool, 1, ids(5), 0)).toEqual([]);
  });

  it('never draws a cell already in the sample', () => {
    const primary = [...ids(5)];
    const top = drawSupplementarySample('beams', pool, 1, primary, 3);
    expect(top.some((id) => primary.includes(id))).toBe(false);
  });

  it('never draws a cell whose printed value the sample already covers', () => {
    // '59ER/F4M/48in' is the same printed cell as '59E/F4M/48in'.
    const primary = ['59E/F4M/48in'];
    const top = drawSupplementarySample('beams', pool, 1, primary, 5);
    expect(top).not.toContain('59ER/F4M/48in');
  });

  it('is deterministic, and is not a prefix of the primary draw', () => {
    const primary = [...ids(5)];
    const a = drawSupplementarySample('beams', pool, 7, primary, 3);
    expect(drawSupplementarySample('beams', pool, 7, primary, 3)).toEqual(a);
    expect(a).not.toEqual(drawSpotCheckSample(pool, 7, 3));
  });

  it('refuses a bad count, and a pool too small to satisfy it', () => {
    expect(() => drawSupplementarySample('beams', pool, 1, [], -1)).toThrow(/non-negative integer/);
    expect(() => drawSupplementarySample('beams', pool, 1, [], 1.5)).toThrow(/non-negative integer/);
    expect(() => drawSupplementarySample('beams', pool, 1, [], 999)).toThrow(/cannot top up by 999/);
  });
});

describe('the reading floor', () => {
  it('counts a 59E/59ER pair as one reading', () => {
    expect(readingsCovered('beams', ['59E/F4M/48in', '59ER/F4M/48in'], [])).toBe(1);
    expect(readingsCovered('beams', ['59E/F4M/48in'], ['65E/F4M/48in'])).toBe(2);
  });

  it('refuses a sample that reaches the cell count but not the reading count', () => {
    const cellIds = [...ids(334), '59E/F4M/48in', '59ER/F4M/48in'];
    const sampled = [...drawSpotCheckSample(ids(334), 20260901, 18), '59E/F4M/48in', '59ER/F4M/48in'];
    const reasons = spotCheckRefusals(
      { ...check(), sampledCells: sampled, supplementaryCells: [] },
      'machine',
      cellIds,
    );
    expect(reasons).toContainEqual(expect.stringContaining('19 distinct published values'));
  });
});
