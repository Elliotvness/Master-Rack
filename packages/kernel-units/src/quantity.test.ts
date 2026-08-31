import { describe, expect, it } from 'vitest';
import {
  BasisBoundError,
  DimensionMismatchError,
  InexactDivisionError,
  InexactValueError,
  NotStorableError,
  UnitMismatchError,
  add,
  allocate,
  allocateNamed,
  compare,
  convert,
  dimension,
  divideExact,
  each,
  equals,
  fromUnit,
  inches,
  isBasisBound,
  isZero,
  millimetres,
  mlb,
  pounds,
  poundsPerPair,
  quantity,
  scale,
  subtract,
  um,
} from './index.js';

describe('storage base', () => {
  it('stores 48 inches as exactly 1,219,200 micrometres', () => {
    expect(inches(48).value).toBe(1_219_200);
    expect(inches(48).unit).toBe('um');
  });

  it('round-trips every published inch value exactly', () => {
    // The published beam-face value that motivated the base choice.
    expect(inches(5.92).value).toBe(150_368);
    expect(convert(inches(5.92), 'in')).toBeCloseTo(5.92, 12);
  });

  it('stores whole millimetres exactly', () => {
    expect(millimetres(1219).value).toBe(1_219_000);
    expect(convert(millimetres(1219), 'mm')).toBe(1219);
  });

  /**
   * The regression that justifies micrometres over millimetres.
   *
   * The blueprint states that 18 of the 21 published spans miss their own
   * lookup key under integer-millimetre storage. That exact figure is now
   * PROVEN against the real published span list in
   * packages/kernel-catalog/src/lookup.test.ts, which loads the actual
   * extracted catalog. This test keeps the list-independent property that lives
   * naturally in the units package: micrometres preserve every span exactly.
   */
  it('preserves every published span as an exact lookup key', () => {
    // The REAL Interlake published spans (see data/catalog/interlake-2026-08).
    const spans = [
      48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156,
      162, 168,
    ];

    // Micrometres: every span round-trips exactly. This is the guarantee.
    const exactUnderMicrometres = spans.filter((span) => convert(inches(span), 'in') === span);
    expect(exactUnderMicrometres).toHaveLength(spans.length);

    // Integer millimetres lose exactly 18 of the 21. Asserted exactly here now
    // that the real span list is known.
    const lostUnderMillimetres = spans.filter(
      (span) => Math.round(span * 25.4) / 25.4 !== span,
    );
    expect(lostUnderMillimetres).toHaveLength(18);
  });

  it('refuses a value that is not a whole storage unit', () => {
    // 0.00001 inch is 0.254 um, which is not a whole micrometre.
    expect(() => inches(0.00001)).toThrow(InexactValueError);
  });

  it('refuses a non-integer stored value', () => {
    expect(() => um(1.5)).toThrow(InexactValueError);
  });

  it('refuses a non-finite value', () => {
    expect(() => um(Number.NaN)).toThrow(InexactValueError);
    expect(() => um(Number.POSITIVE_INFINITY)).toThrow(InexactValueError);
    expect(() => fromUnit(Number.NaN, 'in', 'INPUT')).toThrow(InexactValueError);
  });

  it('refuses a value beyond the safe integer range', () => {
    expect(() => um(Number.MAX_SAFE_INTEGER + 2)).toThrow(InexactValueError);
    expect(() => fromUnit(1e300, 'in', 'INPUT')).toThrow(InexactValueError);
  });

  it('refuses a stored quantity given in a non-storage unit', () => {
    expect(() => quantity(48, 'in', 'INPUT')).toThrow(InexactValueError);
  });

  it('refuses a display-only unit as a stored value', () => {
    expect(() => fromUnit(100, 'kg', 'INPUT')).toThrow(NotStorableError);
    expect(() => quantity(100, 'kg', 'INPUT')).toThrow(NotStorableError);
  });
});

describe('basis-bound units', () => {
  it('marks lb/pr as basis-bound and lb as not', () => {
    expect(isBasisBound('lb/pr')).toBe(true);
    expect(isBasisBound('lb')).toBe(false);
  });

  it('keeps lb/pr in its own unit rather than collapsing it to millipounds', () => {
    const cap = poundsPerPair(5400);
    expect(cap.unit).toBe('lb/pr');
    expect(cap.value).toBe(5_400_000);
  });

  it('refuses to convert a per-pair capacity to pounds', () => {
    expect(() => convert(poundsPerPair(5400), 'lb')).toThrow(BasisBoundError);
    expect(() => convert(poundsPerPair(5400), 'mlb')).toThrow(BasisBoundError);
  });

  it('refuses to convert pounds into a per-pair capacity', () => {
    expect(() => convert(pounds(5400), 'lb/pr')).toThrow(BasisBoundError);
  });

  it('permits the identity conversion', () => {
    expect(convert(poundsPerPair(5400), 'lb/pr')).toBe(5400);
  });

  it('refuses to add a per-pair capacity to a plain load', () => {
    expect(() => add(poundsPerPair(5400), pounds(100))).toThrow(UnitMismatchError);
  });
});

describe('arithmetic', () => {
  it('adds two quantities of the same unit', () => {
    expect(add(um(100), um(50)).value).toBe(150);
  });

  it('subtracts', () => {
    expect(subtract(um(100), um(50)).value).toBe(50);
  });

  it('refuses to combine different dimensions', () => {
    expect(() => add(um(1), mlb(1))).toThrow(DimensionMismatchError);
    expect(() => subtract(um(1), each(1))).toThrow(DimensionMismatchError);
  });

  it('refuses a cross-dimension conversion', () => {
    expect(() => convert(um(1), 'lb')).toThrow(DimensionMismatchError);
  });

  it('scales by an integer', () => {
    expect(scale(um(100), 3).value).toBe(300);
  });

  it('refuses a non-integer scale factor', () => {
    expect(() => scale(um(100), 1.5)).toThrow(InexactValueError);
  });

  it('refuses an overflowing sum', () => {
    expect(() => add(um(Number.MAX_SAFE_INTEGER), um(Number.MAX_SAFE_INTEGER))).toThrow(
      InexactValueError,
    );
    expect(() => subtract(um(-Number.MAX_SAFE_INTEGER), um(Number.MAX_SAFE_INTEGER))).toThrow(
      InexactValueError,
    );
    expect(() => scale(um(Number.MAX_SAFE_INTEGER), 3)).toThrow(InexactValueError);
  });

  it('divides exactly', () => {
    expect(divideExact(um(100), 4).value).toBe(25);
  });

  it('refuses a division with a remainder', () => {
    expect(() => divideExact(um(100), 3)).toThrow(InexactDivisionError);
  });

  it('refuses division by zero and a non-integer divisor', () => {
    expect(() => divideExact(um(100), 0)).toThrow(InexactDivisionError);
    expect(() => divideExact(um(100), 2.5)).toThrow(InexactValueError);
  });

  it('compares and tests equality within a unit', () => {
    expect(compare(um(1), um(2))).toBe(-1);
    expect(compare(um(2), um(1))).toBe(1);
    expect(compare(um(1), um(1))).toBe(0);
    expect(equals(um(1), um(1))).toBe(true);
    expect(equals(um(1), mlb(1))).toBe(false);
    expect(() => compare(um(1), mlb(1))).toThrow(DimensionMismatchError);
  });

  it('reports whether a quantity is zero', () => {
    expect(isZero(um(0))).toBe(true);
    expect(isZero(um(1))).toBe(false);
  });

  it('reports the dimension of a quantity', () => {
    expect(dimension(um(1))).toBe('length');
    expect(dimension(mlb(1))).toBe('load');
    expect(dimension(each(1))).toBe('count');
    expect(dimension(poundsPerPair(1))).toBe('load');
  });
});

describe('allocate — never divide', () => {
  it('always sums back to the original', () => {
    for (let total = 0; total <= 200; total += 1) {
      for (let parts = 1; parts <= 7; parts += 1) {
        const shares = allocate(um(total), parts);
        const sum = shares.reduce((acc, s) => acc + s.value, 0);
        expect(sum).toBe(total);
        expect(shares).toHaveLength(parts);
      }
    }
  });

  it('puts the remainder at the front, so the odd micrometre has a name', () => {
    const shares = allocate(um(100), 3);
    expect(shares.map((s) => s.value)).toEqual([34, 33, 33]);
  });

  it('handles a negative total without losing the remainder', () => {
    const shares = allocate(um(-100), 3);
    expect(shares.map((s) => s.value)).toEqual([-34, -33, -33]);
    expect(shares.reduce((a, s) => a + s.value, 0)).toBe(-100);
  });

  it('allocates a pallet overhang to named sides', () => {
    // 100 um of overhang across two faces: the odd unit is named, not lost.
    const sides = allocateNamed(um(101), ['front', 'rear']);
    expect(sides.front.value).toBe(51);
    expect(sides.rear.value).toBe(50);
    expect(sides.front.value + sides.rear.value).toBe(101);
  });

  it('refuses a non-positive or non-integer part count', () => {
    expect(() => allocate(um(10), 0)).toThrow(InexactDivisionError);
    expect(() => allocate(um(10), -1)).toThrow(InexactDivisionError);
    expect(() => allocate(um(10), 1.5)).toThrow(InexactValueError);
  });
});

describe('origin', () => {
  it('marks a combination of established values as DERIVED', () => {
    expect(add(um(1, 'INPUT'), um(1, 'CATALOG')).origin).toBe('DERIVED');
  });

  it('never launders an UNKNOWN into something established', () => {
    expect(add(um(1, 'INPUT'), um(1, 'UNKNOWN')).origin).toBe('UNKNOWN');
    expect(subtract(um(2, 'UNKNOWN'), um(1, 'INPUT')).origin).toBe('UNKNOWN');
    expect(scale(um(1, 'UNKNOWN'), 2).origin).toBe('UNKNOWN');
    expect(divideExact(um(2, 'UNKNOWN'), 2).origin).toBe('UNKNOWN');
    expect(allocate(um(2, 'UNKNOWN'), 2)[0]?.origin).toBe('UNKNOWN');
  });
});

describe('immutability', () => {
  it('freezes every quantity it returns', () => {
    const q = um(1);
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(add(q, q))).toBe(true);
    expect(Object.isFrozen(allocate(q, 1))).toBe(true);
  });
});
