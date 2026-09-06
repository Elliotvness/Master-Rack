/**
 * Lengths, and the one conversion the migration needs.
 *
 * **v2 stores integer micrometres**, per ADR-005 and DEC-2. The v1 prototype
 * stores integer **mil** (thousandths of an inch). The chain has to cross that
 * boundary exactly once, at `migrate_v1_to_v2`, and this module is the only
 * place it happens.
 *
 * 1 mil = 25.4 µm **exactly**, and 25.4 is not an integer. So a mil value that
 * is not a multiple of 5 does not land on a whole micrometre — 1 mil is 25.4 µm,
 * and 3 mil is 76.2 µm. DEC-2 records the consequence: mil fixtures cannot
 * simply be converted, they are re-derived, and the continuity suite records the
 * sub-mil difference per value.
 *
 * This module therefore **refuses rather than rounds**. Every length in the
 * v1 prototype comes from `IN()` or `FT()` and is a multiple of 1,000 mil, so
 * the real conversion is exact for every value in the fixture; a value that is
 * not exact is a value somebody typed by hand into a saved file, and quietly
 * rounding it is how a drawing comes to disagree with the number beside it.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Integer micrometres. The storage basis for every v2 length. */
export type Micrometres = number;

/** Integer thousandths of an inch. v1 only. */
export type Mil = number;

/** Exact, by definition of the inch: 1 in = 25.4 mm = 25,400 µm = 1,000 mil. */
export const MICROMETRES_PER_MIL = 25.4;
export const MICROMETRES_PER_INCH = 25_400;

export class LengthError extends Error {
  override readonly name = 'LengthError';
}

/** Is this a whole number of micrometres we are willing to store? */
export function isMicrometres(value: unknown): value is Micrometres {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Convert mil to micrometres, exactly or not at all.
 *
 * The multiplication is done in integers — `mil * 254` then a check that the
 * result divides by 10 — rather than `mil * 25.4`, because the float form
 * produces 76.19999999999999 for 3 mil and a `Number.isInteger` test on that is
 * answering a question about IEEE-754 rather than about the value.
 */
export function milToMicrometres(mil: Mil): Micrometres {
  if (!Number.isSafeInteger(mil)) {
    throw new LengthError(`a mil value must be a safe integer, got ${String(mil)}`);
  }
  const tenths = mil * 254;
  if (tenths % 10 !== 0) {
    throw new LengthError(
      `${mil} mil is ${tenths / 10} µm, which is not a whole micrometre. ` +
        'Refusing rather than rounding: DEC-2 records that mil values are re-derived in µm, ' +
        'not converted, and a silently rounded length is a drawing that disagrees with the ' +
        'number printed beside it. Re-enter this value.',
    );
  }
  return tenths / 10;
}

/** True when the conversion above would succeed. For reporting, not control flow. */
export function convertsExactly(mil: Mil): boolean {
  return Number.isSafeInteger(mil) && (mil * 254) % 10 === 0;
}

/** Inches to micrometres. Exact for any inch value with at most 5 decimals. */
export function inchesToMicrometres(inches: number): Micrometres {
  const um = inches * MICROMETRES_PER_INCH;
  if (!Number.isSafeInteger(um)) {
    throw new LengthError(
      `${inches} in is ${um} µm, which is not a whole micrometre. Refusing rather than rounding.`,
    );
  }
  return um;
}

/** Convenience for readable fixtures and defaults. */
export const IN = inchesToMicrometres;
export const FT = (feet: number): Micrometres => inchesToMicrometres(feet * 12);
