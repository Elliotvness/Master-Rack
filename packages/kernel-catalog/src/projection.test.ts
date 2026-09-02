import { describe, expect, it } from 'vitest';

import { ProjectionError, projectBeamRelease } from './index.js';
import type { BeamRow } from './lookup.js';

function beam(over: Partial<BeamRow> = {}): BeamRow {
  return {
    family: '27E',
    series: 'F3M',
    faceHeightIn: 2.75,
    spanIn: 48,
    partNumber: 'U0200310',
    code18: 'IB27ET04800RCA2000',
    capacityLbs: 5610,
    ...over,
  };
}

describe('T-09 — projecting a release into part / part_revision rows', () => {
  it('emits one part and one revision per published row', () => {
    const p = projectBeamRelease('Interlake Mecalux', [beam(), beam({ code18: 'X2', spanIn: 60 })]);
    expect(p.parts).toHaveLength(2);
    expect(p.partRevisions).toHaveLength(2);
  });

  it('keys the part on code_18, not the part number', () => {
    // The load-bearing decision, and it is measured rather than assumed: in the
    // approved release UM005516 appears on two rows with different spans and
    // different capacities, and so does UM005517. code_18 is unique across all
    // 336. A projection keyed on the part number could not load the catalog.
    const p = projectBeamRelease('Interlake Mecalux', [
      beam({ code18: 'IB65QT05400RSA400', partNumber: 'UM005516', spanIn: 54, capacityLbs: 24940 }),
      beam({ code18: 'IB65QT06000RSA4000', partNumber: 'UM005516', spanIn: 60, capacityLbs: 22540 }),
    ]);
    expect(p.parts.map((x) => x.code18)).toEqual(['IB65QT05400RSA400', 'IB65QT06000RSA4000']);
    expect(p.partRevisions.map((x) => x.partNumber)).toEqual(['UM005516', 'UM005516']);
  });

  it('refuses a release that repeats a code_18', () => {
    // The unique constraint in 0010 would refuse this at write time; refusing
    // here names the duplicate instead of surfacing a constraint violation.
    expect(() => projectBeamRelease('Interlake Mecalux', [beam(), beam()])).toThrow(
      ProjectionError,
    );
    expect(() => projectBeamRelease('Interlake Mecalux', [beam(), beam()])).toThrow(
      /appears twice/,
    );
  });

  it('refuses an empty release rather than writing nothing and reporting success', () => {
    expect(() => projectBeamRelease('Interlake Mecalux', [])).toThrow(/empty release/);
  });

  it('refuses a projection with no manufacturer', () => {
    expect(() => projectBeamRelease('   ', [beam()])).toThrow(ProjectionError);
  });

  it('copies the published row verbatim rather than re-deriving it', () => {
    // The files are the source of truth and the thing the content hash covers.
    // A projection that recomputed a capacity would be a second engine.
    const row = beam({ capacityLbs: 5610, faceHeightIn: 2.75 });
    const [rev] = projectBeamRelease('Interlake Mecalux', [row]).partRevisions;
    expect(rev?.publishedRow).toEqual({
      family: '27E',
      series: 'F3M',
      face_height_in: 2.75,
      span_in: 48,
      part_number: 'U0200310',
      code_18: 'IB27ET04800RCA2000',
      capacity_lbs: 5610,
    });
  });

  it('returns frozen rows, so a caller cannot mutate the projection it was handed', () => {
    const p = projectBeamRelease('Interlake Mecalux', [beam()]);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.parts)).toBe(true);
    expect(Object.isFrozen(p.partRevisions[0])).toBe(true);
  });
});
