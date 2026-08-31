import { describe, it, expect } from 'vitest';
import { convert, inches } from '@rms/kernel-units';
import { ClearanceIndex, GeomError, face, minClearanceBrute, type Face } from './geom.js';

/**
 * C-03 kernel-geom.
 *
 * The load-bearing test is the agreement between the brute-force oracle and the
 * span-bucketed index across a whole synthetic scene: a faster wrong answer is
 * not a result. The rest pin the face semantics — opposing normal, span
 * overlap, facing direction — and the refusals.
 */

const IN = (inch: number): number => convert(inches(inch), 'um');

function f(spec: Partial<Face> & { id: string; axis: 'x' | 'y'; coord: number }): Face {
  return face({
    kind: spec.kind ?? 'test',
    lo: spec.lo ?? 0,
    hi: spec.hi ?? IN(120),
    normal: spec.normal ?? 1,
    ...spec,
  });
}

describe('face', () => {
  it('stores an axis-aligned face in integer µm', () => {
    const wall = f({ id: 'w', axis: 'y', coord: IN(10), lo: 0, hi: IN(400), normal: 1 });
    expect(wall.coord).toBe(IN(10));
    expect(wall.normal).toBe(1);
  });

  it('refuses an empty span', () => {
    expect(() => f({ id: 'z', axis: 'x', coord: 0, lo: 100, hi: 100 })).toThrow(/empty span/);
  });

  it('refuses an inverted span', () => {
    expect(() => f({ id: 'z', axis: 'x', coord: 0, lo: 200, hi: 100 })).toThrow(GeomError);
  });

  it('refuses a non-integer coordinate', () => {
    expect(() => f({ id: 'z', axis: 'x', coord: 1.5, lo: 0, hi: 10 })).toThrow(/integer µm/);
  });

  it('refuses a face with no id', () => {
    expect(() => f({ id: '  ', axis: 'x', coord: 0, lo: 0, hi: 10 })).toThrow(/id/);
  });
});

describe('minClearanceBrute — face semantics', () => {
  it('measures the gap between two opposing, overlapping faces', () => {
    // one face at x=10" looking +, another at x=154" looking −: 144" clear
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), lo: 0, hi: IN(400), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(154), lo: 0, hi: IN(400), normal: -1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBe(IN(144));
    expect(minClearanceBrute(faces, 1)).toBe(IN(144));
  });

  it('ignores a face with the same normal (they do not oppose)', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(50), normal: 1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBeNull();
  });

  it('ignores a face on the other axis', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), normal: 1 }),
      f({ id: 'b', axis: 'y', coord: IN(50), normal: -1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBeNull();
  });

  it('ignores a face that does not overlap in span', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), lo: 0, hi: IN(50), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(60), lo: IN(60), hi: IN(120), normal: -1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBeNull();
  });

  it('ignores a face behind it (wrong side)', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(100), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(40), normal: -1 }),
    ];
    // a looks toward increasing x; b is at smaller x, behind it
    expect(minClearanceBrute(faces, 0)).toBeNull();
  });

  it('returns the nearest of several opposing faces', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(0), normal: 1 }),
      f({ id: 'far', axis: 'x', coord: IN(200), normal: -1 }),
      f({ id: 'near', axis: 'x', coord: IN(90), normal: -1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBe(IN(90));
  });

  it('measures a negative-normal face looking back the other way', () => {
    const faces = [
      f({ id: 'a', axis: 'y', coord: IN(200), normal: -1 }),
      f({ id: 'b', axis: 'y', coord: IN(56), normal: 1 }),
    ];
    expect(minClearanceBrute(faces, 0)).toBe(IN(144));
  });

  it('refuses an out-of-range index', () => {
    expect(() => minClearanceBrute([], 0)).toThrow(GeomError);
  });
});

describe('ClearanceIndex', () => {
  it('agrees with brute force on a small opposing pair', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), lo: 0, hi: IN(400), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(154), lo: 0, hi: IN(400), normal: -1 }),
    ];
    const idx = new ClearanceIndex(faces);
    expect(idx.minClearance(0)).toBe(IN(144));
    expect(idx.minClearance(1)).toBe(IN(144));
  });

  it('returns null where nothing opposes', () => {
    const faces = [f({ id: 'a', axis: 'x', coord: IN(10), normal: 1 })];
    const idx = new ClearanceIndex(faces);
    expect(idx.minClearance(0)).toBeNull();
  });

  it('finds a face whose span sits in a different bucket', () => {
    // spans far apart on the span axis but overlapping, forcing multi-bucket keys
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(0), lo: 0, hi: IN(600), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(96), lo: IN(300), hi: IN(600), normal: -1 }),
    ];
    const idx = new ClearanceIndex(faces);
    expect(idx.minClearance(0)).toBe(minClearanceBrute(faces, 0));
    expect(idx.minClearance(0)).toBe(IN(96));
  });

  it('exposes a bucket count and an µm bucket width', () => {
    const idx = new ClearanceIndex([f({ id: 'a', axis: 'x', coord: 0 })]);
    expect(idx.bucketCount).toBeGreaterThan(0);
    expect(ClearanceIndex.BUCKET_UM).toBe(3_048_000);
  });

  it('returns a clearance as a µm quantity with the caller-stated origin', () => {
    const faces = [
      f({ id: 'a', axis: 'x', coord: IN(10), normal: 1 }),
      f({ id: 'b', axis: 'x', coord: IN(154), normal: -1 }),
    ];
    const idx = new ClearanceIndex(faces);
    const q = idx.minClearanceQuantity(0);
    expect(q).not.toBeNull();
    expect(q?.unit).toBe('um');
    expect(convert(q!, 'in')).toBe(144);
    expect(q?.origin).toBe('DERIVED');
    expect(idx.minClearanceQuantity(0, 'UNKNOWN')?.origin).toBe('UNKNOWN');
  });

  it('returns a null quantity where nothing opposes', () => {
    const idx = new ClearanceIndex([f({ id: 'a', axis: 'x', coord: 0, normal: 1 })]);
    expect(idx.minClearanceQuantity(0)).toBeNull();
  });

  it('refuses an out-of-range index', () => {
    const idx = new ClearanceIndex([f({ id: 'a', axis: 'x', coord: 0 })]);
    expect(() => idx.minClearance(5)).toThrow(GeomError);
  });
});

/* ── the agreement property: a full synthetic scene ─────────────────────── */

/**
 * A scene modelled on the Task 0.4 benchmark, scaled down so the test stays
 * fast: back-to-back rows with upright and pallet-overhang faces, building
 * columns with guard envelopes, dock-door jambs, a closed perimeter, and a
 * no-rack zone. The point is not speed here but that the index and the oracle
 * agree on every face of a realistic, irregular scene.
 */
function buildScene(): Face[] {
  const faces: Face[] = [];
  // Whole-inch dimensions so every µm coordinate is exact (kernel-units refuses
  // a fractional µm). The scene's job is irregularity for the agreement check,
  // not dimensional fidelity to the benchmark.
  const bayPitch = IN(98.5);
  const frameDepth = IN(42);
  const overhang = IN(3);
  const backToBack = IN(12);
  const aisleWidth = IN(106);
  const baysPerRun = 12;
  const runPairs = 4;
  let n = 0;
  const push = (
    axis: 'x' | 'y',
    coord: number,
    lo: number,
    hi: number,
    normal: 1 | -1,
    kind: string,
  ): void => {
    faces.push(face({ id: `f${n++}`, kind, axis, coord, lo, hi, normal }));
  };

  let y = IN(120);
  for (let p = 0; p < runPairs; p += 1) {
    const frontY = y;
    const rearY = y + frameDepth + backToBack + frameDepth;
    for (let b = 0; b <= baysPerRun; b += 1) {
      const x = b * bayPitch;
      push('x', x, frontY, frontY + frameDepth, 1, 'upright');
      push('x', x, rearY - frameDepth, rearY, 1, 'upright');
    }
    for (let b = 0; b < baysPerRun; b += 1) {
      const x0 = b * bayPitch;
      const x1 = x0 + bayPitch;
      push('y', frontY - overhang, x0, x1, -1, 'pallet-overhang');
      push('y', frontY + frameDepth + overhang, x0, x1, 1, 'pallet-overhang');
      push('y', rearY - frameDepth - overhang, x0, x1, -1, 'pallet-overhang');
      push('y', rearY + overhang, x0, x1, 1, 'pallet-overhang');
    }
    y = rearY + aisleWidth;
  }

  // building columns with guard envelopes
  const guard = IN(6);
  for (let i = 0; i < 8; i += 1) {
    const cx = (i % 4) * IN(360) + IN(180);
    const cy = Math.floor(i / 4) * IN(400) + IN(200);
    const w = IN(14) + 2 * guard;
    push('x', cx - w / 2, cy - w / 2, cy + w / 2, -1, 'column-guard');
    push('x', cx + w / 2, cy - w / 2, cy + w / 2, 1, 'column-guard');
    push('y', cy - w / 2, cx - w / 2, cx + w / 2, -1, 'column-guard');
    push('y', cy + w / 2, cx - w / 2, cx + w / 2, 1, 'column-guard');
  }

  // dock-door jambs
  for (let i = 0; i < 4; i += 1) {
    const x = IN(200) + i * IN(360);
    push('x', x, 0, IN(60), 1, 'door-jamb');
    push('x', x + IN(108), 0, IN(60), -1, 'door-jamb');
  }

  // closed perimeter
  const W = IN(1400);
  const H = IN(1600);
  push('y', 0, 0, W, 1, 'wall');
  push('y', H, 0, W, -1, 'wall');
  push('x', 0, 0, H, 1, 'wall');
  push('x', W, 0, H, -1, 'wall');

  // one no-rack zone
  const zx = IN(300);
  const zy = IN(1200);
  push('x', zx, zy, zy + IN(240), -1, 'no-rack');
  push('x', zx + IN(240), zy, zy + IN(240), 1, 'no-rack');
  push('y', zy, zx, zx + IN(240), -1, 'no-rack');
  push('y', zy + IN(240), zx, zx + IN(240), 1, 'no-rack');

  return faces;
}

describe('ClearanceIndex — agreement with the oracle on a full scene', () => {
  const faces = buildScene();
  const idx = new ClearanceIndex(faces);

  it('builds a non-trivial scene with many faces', () => {
    expect(faces.length).toBeGreaterThan(300);
  });

  it('returns identical clearance to brute force for every single face', () => {
    let mismatches = 0;
    for (let i = 0; i < faces.length; i += 1) {
      if (idx.minClearance(i) !== minClearanceBrute(faces, i)) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it('finds a real aisle clearance somewhere in the scene', () => {
    // at least one pallet-overhang face resolves to a positive clearance
    const someClearance = faces.some(
      (fc, i) => fc.kind === 'pallet-overhang' && (idx.minClearance(i) ?? 0) > 0,
    );
    expect(someClearance).toBe(true);
  });
});
