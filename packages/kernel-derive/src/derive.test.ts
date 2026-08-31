import { describe, it, expect } from 'vitest';
import {
  add,
  convert,
  each,
  equals,
  inches,
  quantity,
  scale,
  subtract,
  um,
  type Quantity,
} from '@rms/kernel-units';
import { isEstablished, rulesUsed, nodeCount } from '@rms/kernel-units';
import {
  DerivationError,
  aisleClearWidth,
  allocateOverhang,
  bayPitch,
  grossPositions,
  positionAccounting,
  runLength,
} from './derive.js';

/**
 * C-02 kernel-derive.
 *
 * Everything here is pure arithmetic over established quantities. The rules are
 * the blueprint's, and the two that carry the most weight are tested from both
 * ends:
 *   - a run of n bays has n+1 uprights (the off-by-one that looks correct);
 *   - overhang is allocated front and rear, never halved into a lost half-µm.
 */

describe('bayPitch', () => {
  it('is the beam clear span plus one upright face', () => {
    const pitch = bayPitch(inches(96), inches(3));
    // 96" + 3" = 99" = 2 514 600 µm
    expect(convert(pitch.quantity, 'in')).toBe(99);
    expect(pitch.quantity.unit).toBe('um');
  });

  it('carries an established provenance naming the rule', () => {
    const pitch = bayPitch(inches(96), inches(3));
    expect(isEstablished(pitch.provenance)).toBe(true);
    expect(rulesUsed(pitch.provenance)).toContain('derive.bay_pitch');
  });

  it('propagates an unknown input as an unknown result — never launders it', () => {
    const unknownSpan = quantity(2_438_400, 'um', 'UNKNOWN');
    const pitch = bayPitch(unknownSpan, inches(3));
    expect(pitch.quantity.origin).toBe('UNKNOWN');
    expect(isEstablished(pitch.provenance)).toBe(false);
  });
});

describe('runLength', () => {
  it('is n pitches plus one closing upright face', () => {
    const pitch = bayPitch(inches(96), inches(3)); // 99"
    const length = runLength(pitch.quantity, 10, inches(3));
    // 10 × 99" + 3" = 993"
    expect(convert(length.quantity, 'in')).toBe(993);
  });

  it('a one-bay run is one clear span between two uprights', () => {
    const pitch = bayPitch(inches(96), inches(3)); // 99"
    const length = runLength(pitch.quantity, 1, inches(3));
    // 1 × 99" + 3" = 102" = 96" span + 2 × 3" uprights
    expect(convert(length.quantity, 'in')).toBe(102);
  });

  it('property: a run of n bays carries exactly n+1 upright faces', () => {
    const span = inches(96);
    const face = inches(3);
    const pitch = bayPitch(span, face);
    for (const n of [1, 2, 5, 20, 82]) {
      const length = runLength(pitch.quantity, n, face);
      // length − n × clearSpan = (n+1) × uprightFace
      const spans = scale(span, n);
      const uprights = subtract(length.quantity, spans);
      expect(equals(uprights, scale(face, n + 1))).toBe(true);
    }
  });

  it('nests the bay-pitch derivation inside its own provenance', () => {
    const pitch = bayPitch(inches(96), inches(3));
    const length = runLength(pitch.quantity, 4, inches(3));
    const rules = rulesUsed(length.provenance);
    expect(rules).toContain('derive.run_length');
    // the whole tree carries at least the run-length step plus its leaves
    expect(nodeCount(length.provenance)).toBeGreaterThan(1);
  });

  it('refuses a zero bay count', () => {
    const pitch = bayPitch(inches(96), inches(3));
    expect(() => runLength(pitch.quantity, 0, inches(3))).toThrow(DerivationError);
  });

  it('refuses a negative bay count', () => {
    const pitch = bayPitch(inches(96), inches(3));
    expect(() => runLength(pitch.quantity, -2, inches(3))).toThrow(/positive integer/);
  });

  it('refuses a fractional bay count', () => {
    const pitch = bayPitch(inches(96), inches(3));
    expect(() => runLength(pitch.quantity, 3.5, inches(3))).toThrow(/positive integer/);
  });
});

describe('allocateOverhang', () => {
  it('splits an even overhang equally front and rear', () => {
    const split = allocateOverhang(inches(6)); // 152 400 µm
    expect(split.front.value).toBe(76_200);
    expect(split.rear.value).toBe(76_200);
  });

  it('sums to the original exactly, odd µm and all', () => {
    const overhang = um(101, 'INPUT');
    const split = allocateOverhang(overhang);
    expect(add(split.front, split.rear).value).toBe(101);
  });

  it('gives the odd µm to the front, the conservative side', () => {
    const split = allocateOverhang(um(101, 'INPUT'));
    expect(split.front.value).toBe(51);
    expect(split.rear.value).toBe(50);
  });

  it('allocates a zero overhang to two zeroes', () => {
    const split = allocateOverhang(um(0, 'INPUT'));
    expect(split.front.value).toBe(0);
    expect(split.rear.value).toBe(0);
  });

  it('carries an established provenance', () => {
    const split = allocateOverhang(inches(4));
    expect(isEstablished(split.provenance)).toBe(true);
    expect(rulesUsed(split.provenance)).toContain('derive.overhang_allocation');
  });

  it('refuses a negative overhang', () => {
    expect(() => allocateOverhang(um(-10, 'INPUT'))).toThrow(DerivationError);
  });

  it('propagates an unknown overhang as unknown on both shares', () => {
    const split = allocateOverhang(quantity(200, 'um', 'UNKNOWN'));
    expect(split.front.origin).toBe('UNKNOWN');
    expect(split.rear.origin).toBe('UNKNOWN');
    expect(isEstablished(split.provenance)).toBe(false);
  });
});

describe('aisleClearWidth', () => {
  it('is the distance between two load faces, low face first', () => {
    const width = aisleClearWidth(inches(10), inches(154)); // 144" clear
    expect(convert(width.quantity, 'in')).toBe(144);
  });

  it('is the same distance regardless of which face is passed first', () => {
    const a = aisleClearWidth(inches(10), inches(154));
    const b = aisleClearWidth(inches(154), inches(10));
    expect(equals(a.quantity, b.quantity)).toBe(true);
  });

  it('is zero when the faces coincide', () => {
    const width = aisleClearWidth(inches(42), inches(42));
    expect(width.quantity.value).toBe(0);
  });

  it('names the rule in its provenance', () => {
    const width = aisleClearWidth(inches(10), inches(154));
    expect(rulesUsed(width.provenance)).toContain('derive.aisle_clear_width');
    expect(isEstablished(width.provenance)).toBe(true);
  });

  it('propagates an unknown face position as an unknown width', () => {
    const width = aisleClearWidth(quantity(0, 'um', 'UNKNOWN'), inches(154));
    expect(width.quantity.origin).toBe('UNKNOWN');
    expect(isEstablished(width.provenance)).toBe(false);
  });
});

describe('grossPositions', () => {
  it('is positions per bay × bays × storage levels', () => {
    // 2 wide × 12 bays × 4 beam levels, no floor storage = 96
    const gross = grossPositions({
      positionsPerBay: 2,
      bayCount: 12,
      beamLevels: 4,
      floorStores: false,
    });
    expect(gross.quantity.unit).toBe('ea');
    expect(gross.quantity.value).toBe(96);
  });

  it('counts the floor as a storage level when the floor stores pallets', () => {
    const without = grossPositions({
      positionsPerBay: 2,
      bayCount: 12,
      beamLevels: 4,
      floorStores: false,
    });
    const withFloor = grossPositions({
      positionsPerBay: 2,
      bayCount: 12,
      beamLevels: 4,
      floorStores: true,
    });
    // one extra level of 2 × 12 = 24 positions
    expect(withFloor.quantity.value - without.quantity.value).toBe(24);
  });

  it('is zero when nothing stores', () => {
    const gross = grossPositions({
      positionsPerBay: 2,
      bayCount: 12,
      beamLevels: 0,
      floorStores: false,
    });
    expect(gross.quantity.value).toBe(0);
  });

  it('carries an established provenance naming the rule', () => {
    const gross = grossPositions({
      positionsPerBay: 2,
      bayCount: 12,
      beamLevels: 4,
      floorStores: true,
    });
    expect(isEstablished(gross.provenance)).toBe(true);
    expect(rulesUsed(gross.provenance)).toContain('derive.gross_positions');
  });

  it('refuses a non-positive positions-per-bay', () => {
    expect(() =>
      grossPositions({ positionsPerBay: 0, bayCount: 12, beamLevels: 4, floorStores: false }),
    ).toThrow(/positive integer/);
  });

  it('refuses a non-positive bay count', () => {
    expect(() =>
      grossPositions({ positionsPerBay: 2, bayCount: 0, beamLevels: 4, floorStores: false }),
    ).toThrow(/positive integer/);
  });

  it('refuses a negative beam-level count', () => {
    expect(() =>
      grossPositions({ positionsPerBay: 2, bayCount: 12, beamLevels: -1, floorStores: false }),
    ).toThrow(/non-negative integer/);
  });

  it('refuses a fractional beam-level count', () => {
    expect(() =>
      grossPositions({ positionsPerBay: 2, bayCount: 12, beamLevels: 2.5, floorStores: false }),
    ).toThrow(/non-negative integer/);
  });
});

describe('positionAccounting', () => {
  const gross = grossPositions({
    positionsPerBay: 2,
    bayCount: 12,
    beamLevels: 4,
    floorStores: false,
  }); // 96

  it('reports gross, lost and net together, net = gross − lost', () => {
    const acc = positionAccounting(gross, [
      { reason: 'shortened bay', count: each(6, 'DERIVED') },
      { reason: 'split run', count: each(2, 'DERIVED') },
    ]);
    expect(acc.gross.value).toBe(96);
    expect(acc.lost.value).toBe(8);
    expect(acc.net.value).toBe(88);
  });

  it('breaks the loss down by reason, and the breakdown sums to lost', () => {
    const acc = positionAccounting(gross, [
      { reason: 'shortened bay', count: each(6, 'DERIVED') },
      { reason: 'split run', count: each(2, 'DERIVED') },
    ]);
    const sum = acc.byReason.reduce((n, r) => n + r.count.value, 0);
    expect(sum).toBe(acc.lost.value);
  });

  it('with no losses, net equals gross and lost is zero', () => {
    const acc = positionAccounting(gross, []);
    expect(acc.lost.value).toBe(0);
    expect(acc.net.value).toBe(96);
    expect(acc.byReason).toHaveLength(0);
  });

  it('satisfies the identity net + lost = gross for every case', () => {
    const acc = positionAccounting(gross, [{ reason: 'tunnel', count: each(10, 'DERIVED') }]);
    expect(acc.net.value + acc.lost.value).toBe(acc.gross.value);
  });

  it('names the rule in its provenance', () => {
    const acc = positionAccounting(gross, [{ reason: 'tunnel', count: each(10, 'DERIVED') }]);
    expect(rulesUsed(acc.provenance)).toContain('derive.net_positions');
  });

  it('refuses to lose more positions than exist', () => {
    expect(() =>
      positionAccounting(gross, [{ reason: 'tunnel', count: each(200, 'DERIVED') }]),
    ).toThrow(/more positions than exist/);
  });

  it('refuses a negative loss count', () => {
    expect(() =>
      positionAccounting(gross, [{ reason: 'tunnel', count: each(-1, 'DERIVED') }]),
    ).toThrow(/non-negative integer/);
  });

  it('refuses a loss reason with no text', () => {
    expect(() =>
      positionAccounting(gross, [{ reason: '  ', count: each(1, 'DERIVED') }]),
    ).toThrow(/reason/);
  });

  it('refuses a loss counted in a non-count unit', () => {
    const badCount = { value: 5, unit: 'um', origin: 'DERIVED' } as unknown as Quantity;
    expect(() =>
      positionAccounting(gross, [{ reason: 'tunnel', count: badCount }]),
    ).toThrow(DerivationError);
  });
});
