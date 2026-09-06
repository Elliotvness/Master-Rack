import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';
import { allocateGaps, overhangOf, planGeometry } from './plan.js';
import { BridgeError } from './to-kernel.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;
const inches = (um: number): number => um / 25_400;

/**
 * **Continuity with the published artifact.**
 *
 * These are the figures printed on the artifact's own screen, read off it and
 * asserted here: 576 pallet positions, 36 bays, a narrowest clear aisle of
 * 10'-6", 11'-0" frame to frame, and 99'-3" overall. They are the reason the
 * continuity fixture exists — DEC-2 re-derived every length from mil into
 * micrometres, and a re-derivation that changed an answer would be a silent
 * regression in the only direction that matters.
 *
 * They are also the guard against the thing that produced this file: the plan
 * was first drawn with none of this geometry, and it looked plausible. A
 * drawing that is merely plausible is the failure these numbers detect.
 */
describe('the published artifact\'s figures reproduce exactly', () => {
  const p = planGeometry(doc());

  it('576 pallet positions', () => {
    expect(p.totalPositions).toBe(576);
  });

  it('36 bays', () => {
    expect(p.totalBays).toBe(36);
  });

  it('narrowest clear aisle is 10\'-6"', () => {
    expect(inches(p.narrowestClearAisle?.value ?? 0)).toBe(126);
  });

  it('frame to frame is 11\'-0"', () => {
    expect(inches(p.aisles[0]?.frameToFrame.value ?? 0)).toBe(132);
  });

  it('overall length is 99\'-3"', () => {
    expect(inches(p.overallLength.value)).toBe(99 * 12 + 3);
  });

  it('overhang is 3 in — (48 pallet − 42 frame) ÷ 2', () => {
    expect(inches(p.runs[0]?.overhang.value ?? 0)).toBe(3);
  });

  it('longitudinal flue is 6 in — 12 spacer − 3 − 3', () => {
    expect(inches(p.runs[0]?.longitudinalFlue?.width.value ?? 0)).toBe(6);
  });
});

describe('the two aisle datums are different numbers, and both are carried', () => {
  /**
   * Frame to frame is what a tape measure reads on site; load face to load face
   * is ADR-006's datum and what a truck must fit between. A drawing showing one
   * invites the reader to use it for the other question — which is a 6 in.
   * error in the direction that matters.
   */
  it('clear between loads is narrower than frame to frame by the overhang each side', () => {
    const p = planGeometry(doc());
    const a = p.aisles[0];
    const runs = p.runs;
    expect(a?.clearBetweenLoads.value).toBe(
      (a?.frameToFrame.value ?? 0) - (runs[0]?.overhang.value ?? 0) - (runs[1]?.overhang.value ?? 0),
    );
    expect(a?.clearBetweenLoads.value).toBeLessThan(a?.frameToFrame.value ?? 0);
  });
});

describe('rows, bays and unit loads', () => {
  const p = planGeometry(doc());
  const run = p.runs[0];

  it('a back-to-back run draws two frame rows', () => {
    expect(run?.rows).toHaveLength(2);
  });

  it('the second row sits a row spacer behind the first', () => {
    const [a, b] = [run?.rows[0], run?.rows[1]];
    expect((b?.y ?? 0) - ((a?.y ?? 0) + (a?.depth ?? 0))).toBe(IN(12));
  });

  it('a single-row run draws one', () => {
    const d = doc();
    const single = { ...d, runs: [{ ...d.runs[0]!, backToBack: false }] };
    expect(planGeometry(single).runs[0]?.rows).toHaveLength(1);
    expect(planGeometry(single).runs[0]?.longitudinalFlue).toBeNull();
  });

  it('every bay is one clear beam span wide', () => {
    for (const bay of run?.bays ?? []) expect(bay.width).toBe(IN(96));
  });

  it('bays are pitched by beam length plus one upright face', () => {
    const bays = run?.bays ?? [];
    expect((bays[1]?.x ?? 0) - (bays[0]?.x ?? 0)).toBe(IN(96) + IN(3));
  });

  it('12 bays × 2 pallets × 2 rows is 48 unit loads drawn per run', () => {
    expect(run?.pallets).toHaveLength(48);
  });

  it('a unit load overhangs its frame equally front and back', () => {
    const pallet = run?.pallets[0];
    const row = run?.rows[0];
    expect(pallet?.y).toBe((row?.y ?? 0) - (run?.overhang.value ?? 0));
    expect(pallet?.depth).toBe(IN(48));
  });

  it('unit loads sit inside their bay, never across an upright', () => {
    for (const bay of run?.bays ?? []) {
      const inBay = (run?.pallets ?? []).filter(
        (p) => p.x >= bay.x && p.x + p.width <= bay.x + bay.width,
      );
      // 2 pallets per bay per row, 2 rows.
      expect(inBay).toHaveLength(4);
    }
  });
});

describe('allocateGaps spreads the remainder rather than dividing', () => {
  it('sums exactly to the span', () => {
    for (const [total, count] of [
      [IN(96) - 2 * IN(40), 3],
      [100, 3],
      [7, 2],
      [0, 1],
    ] as const) {
      expect(allocateGaps(total, count).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('spreads the remainder one unit at a time, front first', () => {
    expect(allocateGaps(10, 3)).toEqual([4, 3, 3]);
  });

  it('is equal when it divides evenly', () => {
    expect(allocateGaps(9, 3)).toEqual([3, 3, 3]);
  });

  it.each([0, -1, 1.5])('refuses %o gaps', (bad) => {
    expect(() => allocateGaps(100, bad)).toThrow(BridgeError);
  });
});

describe('overhangOf', () => {
  it('is half the difference', () => {
    expect(overhangOf(IN(48), IN(42))).toBe(IN(3));
  });

  /**
   * A pallet shallower than the frame is a real configuration — it is the one
   * that raises the pallet-support finding — so this must not clamp to zero.
   */
  it('is negative when the pallet is shallower than the frame', () => {
    expect(overhangOf(IN(36), IN(42))).toBe(IN(-3));
  });

  it('truncates toward zero, so equal magnitudes round alike', () => {
    expect(overhangOf(5, 0)).toBe(2);
    expect(overhangOf(-5, 0)).toBe(-2);
  });

  it('a shallow pallet leaves the flue wider, not narrower', () => {
    const d = doc();
    const shallow = { ...d, unitLoad: { ...d.unitLoad, palletD: IN(36) } };
    const flue = planGeometry(shallow).runs[0]?.longitudinalFlue;
    expect(inches(flue?.width.value ?? 0)).toBe(18);
  });
});

describe('aisles are between runs that actually face each other', () => {
  /**
   * Defect D-B: pairing "next in y order" reports a NEGATIVE frame-to-frame gap
   * between a split run and its sibling, which sit side by side at the same y.
   */
  it('two runs at the same y are beside each other, not across an aisle', () => {
    const d = doc();
    const [a, b] = [d.runs[0]!, d.runs[1]!];
    const side = { ...d, runs: [a, { ...b, y: a.y, x: a.x + IN(2000) }] };
    expect(planGeometry(side).aisles).toHaveLength(0);
  });

  it('runs that share no x-extent are not across an aisle either', () => {
    const d = doc();
    const [a, b] = [d.runs[0]!, d.runs[1]!];
    const apart = { ...d, runs: [a, { ...b, x: a.x + IN(100_000) }] };
    expect(planGeometry(apart).aisles).toHaveLength(0);
  });

  it('every reported aisle has a positive frame-to-frame gap', () => {
    for (const a of planGeometry(doc()).aisles) {
      expect(a.frameToFrame.value).toBeGreaterThan(0);
    }
  });

  it('reports no narrowest aisle when there are no aisles', () => {
    const d = doc();
    expect(planGeometry({ ...d, runs: [d.runs[0]!] }).narrowestClearAisle).toBeNull();
  });
});

describe('planGeometry refuses what it cannot derive', () => {
  it('a dangling bay type', () => {
    const d = doc();
    const broken = { ...d, runs: [{ ...d.runs[0]!, bayTypeId: 'bt_gone' }] };
    expect(() => planGeometry(broken)).toThrow(BridgeError);
  });

  it('an empty document produces an empty plan rather than throwing', () => {
    const p = planGeometry({ ...doc(), runs: [] });
    expect(p.runs).toEqual([]);
    expect(p.totalPositions).toBe(0);
    expect(p.overallLength.value).toBe(0);
  });
});

describe('positions count storeys, rows and pallets per bay', () => {
  it('floor storage adds a storey', () => {
    const d = doc();
    const noFloor = { ...d, runs: d.runs.map((r) => ({ ...r, floorStorage: false })) };
    // 3 beam levels instead of 4 storeys: 576 × 3/4.
    expect(planGeometry(noFloor).totalPositions).toBe(432);
  });

  it('a single-row run holds half as many', () => {
    const d = doc();
    const single = { ...d, runs: d.runs.map((r) => ({ ...r, backToBack: false })) };
    expect(planGeometry(single).totalPositions).toBe(288);
  });
});

describe('the narrowest aisle is the narrowest, not the last', () => {
  it('picks the smaller of two unequal aisles whichever order they appear in', () => {
    const d = doc();
    const [a, b, c] = [d.runs[0]!, d.runs[1]!, d.runs[2]!];
    // Widen the second gap so the first is the narrow one, and vice versa.
    const firstNarrow = { ...d, runs: [a, b, { ...c, y: c.y + IN(60) }] };
    const p1 = planGeometry(firstNarrow);
    expect(p1.aisles).toHaveLength(2);
    expect(p1.narrowestClearAisle?.value).toBe(
      Math.min(...p1.aisles.map((x) => x.clearBetweenLoads.value)),
    );

    const secondNarrow = { ...d, runs: [a, { ...b, y: b.y + IN(60) }, c] };
    const p2 = planGeometry(secondNarrow);
    expect(p2.narrowestClearAisle?.value).toBe(
      Math.min(...p2.aisles.map((x) => x.clearBetweenLoads.value)),
    );
  });
});
