/**
 * Quantity — a number that carries its unit and its origin.
 *
 * The stored value is always an integer in the dimension's storage unit
 * (micrometres for length, millipounds for load, each for counts). There is no
 * floating point in a stored quantity, ever.
 *
 * Design notes carried from the reference projects:
 *  - value/unit/origin are plain JSON types, so content hashing hashes content
 *    rather than a wrapped object (rack-engine/model/quantity.py).
 *  - Addition of two different-but-compatible units raises rather than
 *    converting, because a silent conversion puts a number in a package that
 *    nobody entered.
 *  - Division that is not exact is refused; use allocate().
 */

import {
  BasisBoundError,
  DimensionMismatchError,
  InexactDivisionError,
  InexactValueError,
  NotStorableError,
  UnitMismatchError,
} from './errors.js';
import {
  dimensionOf,
  isBasisBound,
  isStorable,
  scaleOf,
  storageUnitFor,
  type Dimension,
  type Origin,
  type Unit,
} from './units.js';

/**
 * A quantity. `value` is an integer count of `unit`, and `unit` is always the
 * storage unit for its dimension — display units never appear on a stored
 * quantity, only in a formatted string.
 *
 * The one exception is `lb/pr`, which is a storage unit in its own right
 * precisely so that it cannot be confused with `lb`.
 */
export interface Quantity {
  readonly value: number;
  readonly unit: Unit;
  readonly origin: Origin;
}

function assertSafeInteger(value: number, context: string): void {
  if (!Number.isFinite(value)) {
    throw new InexactValueError(`${context} is ${String(value)}, which is not a finite number.`);
  }
  if (!Number.isInteger(value)) {
    throw new InexactValueError(`${context} is ${value}, which is not an integer.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new InexactValueError(
      `${context} is ${value}, which exceeds the safe integer range and would lose precision.`,
    );
  }
}

/**
 * Build a quantity from an exact count of storage units.
 */
export function quantity(value: number, unit: Unit, origin: Origin): Quantity {
  if (!isStorable(unit)) throw new NotStorableError(unit);
  assertSafeInteger(value, `Quantity value for ${unit}`);
  const storage = storageUnitFor(unit);
  // lb/pr is basis-bound and is its own storage unit; everything else must be
  // expressed in the storage unit for its dimension.
  if (unit !== storage && !isBasisBound(unit)) {
    throw new InexactValueError(
      `Quantity was given in ${unit}, but stored quantities of dimension ` +
        `${dimensionOf(unit)} are held in ${storage}. Use fromUnit() to convert exactly.`,
    );
  }
  return Object.freeze({ value, unit, origin });
}

/**
 * Build a quantity from a value expressed in any storable unit, converting
 * exactly. A conversion that would not be exact is refused rather than rounded.
 *
 * This is the entry point for catalog data and client input: 48 inches becomes
 * 1,219,200 um exactly, and a value that cannot land on a whole storage unit is
 * a data error worth hearing about.
 */
export function fromUnit(value: number, unit: Unit, origin: Origin): Quantity {
  if (!isStorable(unit)) throw new NotStorableError(unit);
  if (!Number.isFinite(value)) {
    throw new InexactValueError(`Value for ${unit} is ${String(value)}, which is not finite.`);
  }

  // Basis-bound units are their own storage unit: they do not convert, so the
  // scale is applied and the unit is kept exactly as given.
  const scaled = value * scaleOf(unit);
  const rounded = Math.round(scaled);
  // Guard against binary floating point: 5.92 * 25400 is 150368.00000000003.
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new InexactValueError(
      `${value} ${unit} is ${scaled} ${storageUnitFor(unit)}, which is not a whole ` +
        `${storageUnitFor(unit)}.`,
    );
  }
  assertSafeInteger(rounded, `${value} ${unit} in ${storageUnitFor(unit)}`);

  if (isBasisBound(unit)) {
    return Object.freeze({ value: rounded, unit, origin });
  }
  return Object.freeze({ value: rounded, unit: storageUnitFor(unit), origin });
}

/** Convenience constructors for the storage bases. */
export const um = (value: number, origin: Origin = 'DERIVED'): Quantity =>
  quantity(value, 'um', origin);
export const mlb = (value: number, origin: Origin = 'DERIVED'): Quantity =>
  quantity(value, 'mlb', origin);
export const each = (value: number, origin: Origin = 'DERIVED'): Quantity =>
  quantity(value, 'ea', origin);

/** Inches in, micrometres stored. Exact for every published inch value. */
export const inches = (value: number, origin: Origin = 'INPUT'): Quantity =>
  fromUnit(value, 'in', origin);
/** Millimetres in, micrometres stored. Exact for every whole millimetre. */
export const millimetres = (value: number, origin: Origin = 'INPUT'): Quantity =>
  fromUnit(value, 'mm', origin);
/** Pounds in, millipounds stored. */
export const pounds = (value: number, origin: Origin = 'INPUT'): Quantity =>
  fromUnit(value, 'lb', origin);
/** Pounds per pair. Basis-bound: this will not convert to pounds. */
export const poundsPerPair = (value: number, origin: Origin = 'CATALOG'): Quantity =>
  fromUnit(value, 'lb/pr', origin);

/**
 * Convert a quantity into another unit for a caller that needs the number.
 * Refuses a basis-bound source, and refuses a cross-dimension conversion.
 *
 * `q.value` is always an integer count of its dimension's storage unit, so the
 * conversion is a single division by the target's scale. Multiplying by the
 * source scale as well would double-count, which is the defect the identity
 * conversion test caught.
 */
export function convert(q: Quantity, to: Unit): number {
  if (isBasisBound(q.unit) && q.unit !== to) {
    throw new BasisBoundError(q.unit, to);
  }
  if (isBasisBound(to) && q.unit !== to) {
    throw new BasisBoundError(to, q.unit);
  }
  if (dimensionOf(q.unit) !== dimensionOf(to)) {
    throw new DimensionMismatchError(dimensionOf(q.unit), dimensionOf(to));
  }
  return q.value / scaleOf(to);
}

function assertSameUnit(a: Quantity, b: Quantity): void {
  if (dimensionOf(a.unit) !== dimensionOf(b.unit)) {
    throw new DimensionMismatchError(dimensionOf(a.unit), dimensionOf(b.unit));
  }
  if (a.unit !== b.unit) {
    throw new UnitMismatchError(a.unit, b.unit);
  }
}

/**
 * The origin of a combined value. Any UNKNOWN input makes the result UNKNOWN;
 * otherwise a combination is DERIVED. Combining never launders an unknown into
 * something that looks established.
 */
function combineOrigin(a: Origin, b: Origin): Origin {
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 'UNKNOWN';
  return 'DERIVED';
}

export function add(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  const value = a.value + b.value;
  assertSafeInteger(value, `Sum in ${a.unit}`);
  return Object.freeze({ value, unit: a.unit, origin: combineOrigin(a.origin, b.origin) });
}

export function subtract(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  const value = a.value - b.value;
  assertSafeInteger(value, `Difference in ${a.unit}`);
  return Object.freeze({ value, unit: a.unit, origin: combineOrigin(a.origin, b.origin) });
}

/** Scale by a dimensionless integer. */
export function scale(q: Quantity, factor: number): Quantity {
  assertSafeInteger(factor, 'Scale factor');
  const value = q.value * factor;
  assertSafeInteger(value, `Scaled value in ${q.unit}`);
  return Object.freeze({
    value,
    unit: q.unit,
    origin: q.origin === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED',
  });
}

/**
 * Exact division only. A division with a remainder is refused, because the
 * remainder has to go somewhere and silently dropping it is how a rounding
 * error appears at one face of a rack and not the other.
 */
export function divideExact(q: Quantity, divisor: number): Quantity {
  assertSafeInteger(divisor, 'Divisor');
  if (divisor === 0) {
    throw new InexactDivisionError('Division by zero.');
  }
  if (q.value % divisor !== 0) {
    throw new InexactDivisionError(
      `${q.value} ${q.unit} does not divide exactly by ${divisor} ` +
        `(remainder ${q.value % divisor} ${q.unit}).`,
    );
  }
  return Object.freeze({
    value: q.value / divisor,
    unit: q.unit,
    origin: q.origin === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED',
  });
}

/**
 * Split a quantity into `parts` shares whose sum is exactly the original.
 *
 * The remainder is distributed one storage unit at a time from the front, so
 * the odd micrometre lands on a named side rather than disappearing. This is
 * the "allocate, never divide" rule: the caller can always say which share
 * carries the extra.
 */
export function allocate(q: Quantity, parts: number): readonly Quantity[] {
  assertSafeInteger(parts, 'Allocation part count');
  if (parts <= 0) {
    throw new InexactDivisionError(`Cannot allocate into ${parts} parts.`);
  }

  const negative = q.value < 0;
  const magnitude = Math.abs(q.value);
  const base = Math.floor(magnitude / parts);
  let remainder = magnitude - base * parts;

  const origin: Origin = q.origin === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED';
  const shares: Quantity[] = [];
  for (let i = 0; i < parts; i += 1) {
    let share = base;
    if (remainder > 0) {
      share += 1;
      remainder -= 1;
    }
    shares.push(Object.freeze({ value: negative ? -share : share, unit: q.unit, origin }));
  }
  return Object.freeze(shares);
}

/**
 * Allocate into explicit named shares. Same guarantee, but the caller names
 * where the remainder goes, which is what a front/rear pallet overhang needs.
 */
export function allocateNamed<K extends string>(
  q: Quantity,
  names: readonly K[],
): Readonly<Record<K, Quantity>> {
  const shares = allocate(q, names.length);
  const out = {} as Record<K, Quantity>;
  names.forEach((name, i) => {
    // allocate() returns exactly names.length shares.
    out[name] = shares[i] as Quantity;
  });
  return Object.freeze(out);
}

export function isZero(q: Quantity): boolean {
  return q.value === 0;
}

export function compare(a: Quantity, b: Quantity): number {
  assertSameUnit(a, b);
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

export function equals(a: Quantity, b: Quantity): boolean {
  return a.unit === b.unit && a.value === b.value;
}

export function dimension(q: Quantity): Dimension {
  return dimensionOf(q.unit);
}
