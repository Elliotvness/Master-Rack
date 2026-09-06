import { inches, um } from '@rms/kernel-units';
import { describe, expect, it } from 'vitest';

import { buildDetailedPlan, gridRef, type DetailAisle, type DetailRun } from './detail.js';
import { itemsOfKind, textEntries, type DisplayList } from './model.js';

const IN = (n: number): number => n * 25_400;

function run(over: Partial<DetailRun> = {}): DetailRun {
  const bays = Array.from({ length: 3 }, (_, i) => ({
    bayId: `bay_${i}`,
    index: i,
    locked: false,
    x: IN(3) + i * IN(99),
    width: IN(96),
  }));
  return {
    runId: 'run_1',
    label: 'Run 1',
    x: 0,
    y: 0,
    runLength: inches(300),
    bayPitch: inches(99),
    uprightFace: IN(3),
    rows: [
      { y: 0, depth: IN(42) },
      { y: IN(54), depth: IN(42) },
    ],
    bays,
    pallets: [
      { id: 'p0', x: IN(8), y: IN(-3), width: IN(40), depth: IN(48) },
      { id: 'p1', x: IN(53), y: IN(-3), width: IN(40), depth: IN(48) },
    ],
    longitudinalFlue: { y: IN(45), height: IN(6), width: inches(6) },
    ...over,
  };
}

function aisle(over: Partial<DetailAisle> = {}): DetailAisle {
  return {
    aisleId: 'gap_1',
    x: 0,
    y: IN(96),
    length: IN(300),
    frameToFrame: inches(132),
    clearBetweenLoads: inches(126),
    ...over,
  };
}

function build(runs: DetailRun[], aisles: DetailAisle[] = []): DisplayList {
  return buildDetailedPlan({
    revisionHash: 'sha256:test',
    runs,
    aisles,
    extent: { width: inches(400), height: inches(200) },
    overallLength: inches(1191),
  });
}

const texts = (list: DisplayList): string[] => textEntries(list).map((t) => t.text);
const ids = (list: DisplayList): string[] => list.items.map((i) => i.id);

describe('a back-to-back run draws two rows, not one block', () => {
  it('emits one rect per row', () => {
    const list = build([run()]);
    expect(ids(list).filter((id) => id.includes(':row:'))).toHaveLength(2);
  });

  it('a single-row run emits one', () => {
    const list = build([run({ rows: [{ y: 0, depth: IN(42) }], longitudinalFlue: null })]);
    expect(ids(list).filter((id) => id.includes(':row:'))).toHaveLength(1);
  });

  /** n bays close with n+1 uprights — kernel-derive's rule, visible here. */
  it('draws n+1 uprights per row', () => {
    const list = build([run()]);
    expect(ids(list).filter((id) => id.includes(':upright:'))).toHaveLength(2 * (3 + 1));
  });

  it('draws a beam at both faces of every row', () => {
    const list = build([run()]);
    expect(ids(list).filter((id) => id.includes(':beam:'))).toHaveLength(4);
  });
});

describe('unit loads and flues', () => {
  it('emits one item per unit load', () => {
    const list = build([run()]);
    expect(itemsOfKind(list, 'unit-load')).toHaveLength(2);
  });

  it('emits the longitudinal flue with its width as a label', () => {
    const list = build([run()]);
    expect(texts(list)).toContain(`6"`);
  });

  it('omits the longitudinal flue for a single-row run', () => {
    const list = build([run({ rows: [{ y: 0, depth: IN(42) }], longitudinalFlue: null })]);
    expect(ids(list).some((id) => id.includes('flue:longitudinal'))).toBe(false);
  });

  /** The transverse flue is taken from the loads, so it cannot disagree with them. */
  it('emits a transverse flue between adjacent loads in a row', () => {
    const list = build([run()]);
    const transverse = ids(list).filter((id) => id.includes('flue:transverse'));
    expect(transverse).toHaveLength(1);
  });

  it('emits none when the loads touch, rather than a zero-width one', () => {
    const touching = run({
      pallets: [
        { id: 'p0', x: 0, y: 0, width: IN(40), depth: IN(48) },
        { id: 'p1', x: IN(40), y: 0, width: IN(40), depth: IN(48) },
      ],
    });
    expect(ids(build([touching])).some((id) => id.includes('flue:transverse'))).toBe(false);
  });

  it('groups by row, so loads in different rows are not paired across the flue', () => {
    const twoRows = run({
      pallets: [
        { id: 'a', x: 0, y: 0, width: IN(40), depth: IN(48) },
        { id: 'b', x: IN(50), y: 0, width: IN(40), depth: IN(48) },
        { id: 'c', x: 0, y: IN(54), width: IN(40), depth: IN(48) },
        { id: 'd', x: IN(50), y: IN(54), width: IN(40), depth: IN(48) },
      ],
    });
    // One gap per row, not three from treating all four as one line.
    expect(ids(build([twoRows])).filter((id) => id.includes('flue:transverse'))).toHaveLength(2);
  });
});

describe('both aisle datums are drawn, on separate lines', () => {
  /**
   * Frame to frame is what a tape measure reads; load face to load face is
   * what a truck must fit between. One dimension invites the reader to use it
   * for the other question.
   */
  it('emits a dimension for each', () => {
    const list = build([run()], [aisle()]);
    expect(ids(list)).toContain('gap_1:frame-to-frame');
    expect(ids(list)).toContain('gap_1:clear-between-loads');
  });

  it('names the datum in each string', () => {
    const t = texts(build([run()], [aisle()]));
    expect(t.some((s) => s.includes('FRAME TO FRAME'))).toBe(true);
    expect(t.some((s) => s.includes('CLEAR BETWEEN LOADS'))).toBe(true);
  });

  it('prints them in feet and inches, as a drawing does', () => {
    const t = texts(build([run()], [aisle()]));
    expect(t.some((s) => s.startsWith(`11'-0"`))).toBe(true);
    expect(t.some((s) => s.startsWith(`10'-6"`))).toBe(true);
  });

  it('places them on different datums across the aisle', () => {
    const list = build([run()], [aisle()]);
    const f = list.items.find((i) => i.id === 'gap_1:frame-to-frame');
    const c = list.items.find((i) => i.id === 'gap_1:clear-between-loads');
    const fy = f?.kind === 'dimension' ? f.from.y : 0;
    const cy = c?.kind === 'dimension' ? c.from.y : 0;
    expect(fy).not.toBe(cy);
  });

  /**
   * An unestablished dimension prints VERIFY and must NOT gain the datum
   * suffix — "VERIFY FRAME TO FRAME" reads as a measured datum awaiting
   * confirmation rather than as no measurement at all.
   */
  it('an unestablished datum prints VERIFY alone', () => {
    const t = texts(build([run()], [aisle({ frameToFrame: um(1000, 'UNKNOWN') })]));
    expect(t).toContain('VERIFY');
    expect(t.some((s) => s.startsWith('VERIFY') && s.includes('FRAME TO FRAME'))).toBe(false);
  });
});

describe('grid, labels and the overall dimension', () => {
  it('labels every run', () => {
    expect(texts(build([run()]))).toContain('Run 1');
  });

  it('emits a grid bubble per upright of the longest run', () => {
    const list = build([run()]);
    expect(ids(list).filter((id) => id.startsWith('grid:') && !id.includes('tick'))).toHaveLength(
      3 + 1 + 1, // 4 bubbles + the pitch dimension
    );
  });

  it('draws the overall length', () => {
    const t = texts(build([run()]));
    expect(t.some((s) => s.includes('OVERALL'))).toBe(true);
    expect(t.some((s) => s.startsWith(`99'-3"`))).toBe(true);
  });

  it('takes the longest run for the grid, not the first', () => {
    // Distinct pallet ids: the display list refuses duplicates, which is a
    // guarantee worth having and which this fixture tripped once.
    const short = run({ runId: 'short', runLength: inches(100), bays: [], pallets: [] });
    const long = run({
      runId: 'long',
      runLength: inches(400),
      pallets: [{ id: 'q0', x: IN(8), y: IN(-3), width: IN(40), depth: IN(48) }],
    });
    const a = ids(build([short, long])).filter((id) => id.startsWith('grid:'));
    const b = ids(build([long, short])).filter((id) => id.startsWith('grid:'));
    expect(a).toEqual(b);
  });

  it('emits no grid at all for an empty plan', () => {
    const list = build([]);
    expect(ids(list).some((id) => id.startsWith('grid:'))).toBe(false);
  });
});

describe('gridRef counts like a drawing set', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
  ])('%i is %s', (index, expected) => {
    expect(gridRef(index)).toBe(expected);
  });
});

describe('a run with no rows still draws without inventing a position', () => {
  /**
   * `rows` is empty only for a malformed run, but the fallbacks exist and an
   * untested fallback is a branch nobody has seen behave.
   */
  it('places the label and the grid from the run origin', () => {
    const list = build([run({ rows: [], pallets: [], longitudinalFlue: null })]);
    expect(texts(list)).toContain('Run 1');
    expect(ids(list).some((id) => id.startsWith('grid:'))).toBe(true);
  });
});
