/**
 * Refusals.
 *
 * Every refusal names what was refused and why, because the product
 * constitution is "never guess, preserve provenance, surface uncertainty" and a
 * bare `throw new Error('invalid')` surfaces nothing.
 */

export class UnitError extends Error {
  override readonly name: string = 'UnitError';
}

/** Two values whose dimensions differ can never combine. */
export class DimensionMismatchError extends UnitError {
  override readonly name = 'DimensionMismatchError';
  constructor(left: string, right: string) {
    super(
      `Cannot combine a ${left} quantity with a ${right} quantity. ` +
        'Dimensions never convert into one another.',
    );
  }
}

/**
 * Two values of the same dimension but different units. Refused rather than
 * silently converted: a silent foot-to-inch conversion puts a number in a
 * package that nobody entered.
 */
export class UnitMismatchError extends UnitError {
  override readonly name = 'UnitMismatchError';
  constructor(left: string, right: string) {
    super(
      `Cannot combine ${left} with ${right} without an explicit conversion. ` +
        'Convert deliberately, or the arithmetic hides a unit change.',
    );
  }
}

/**
 * A per-basis unit refusing conversion. The single most valuable refusal in
 * this module: converting lb/pr to lb is arithmetically a no-op and
 * semantically turns a per-pair capacity into a per-beam one.
 */
export class BasisBoundError extends UnitError {
  override readonly name = 'BasisBoundError';
  constructor(from: string, to: string) {
    super(
      `${from} is basis-bound and will not convert to ${to}. ` +
        `The magnitudes may match, but ${from} states what the quantity is measured ` +
        'against. Converting it silently changes the claim.',
    );
  }
}

/** A value that is not an exact integer in its storage unit. */
export class InexactValueError extends UnitError {
  override readonly name = 'InexactValueError';
  constructor(detail: string) {
    super(
      `${detail} Fixed-point storage refuses inexact values rather than rounding ` +
        'silently, because a rounded lookup key no longer matches its own table.',
    );
  }
}

/** Division that would not be exact. Use allocate() instead. */
export class InexactDivisionError extends UnitError {
  override readonly name = 'InexactDivisionError';
  constructor(detail: string) {
    super(
      `${detail} Use allocate() so the remainder goes somewhere explicit rather ` +
        'than into rounding drift.',
    );
  }
}

/** A display unit used where a stored value was required. */
export class NotStorableError extends UnitError {
  override readonly name = 'NotStorableError';
  constructor(unit: string) {
    super(
      `${unit} is a display unit and cannot be stored or used as an input. ` +
        'It is derived one-way for rendering and never parsed back.',
    );
  }
}

/**
 * A provenance walk that exceeded its depth bound. Fails loudly. A walker that
 * silently truncates reports a clean provenance for a graph it never finished
 * reading, which is worse than no walker.
 */
export class ProvenanceDepthError extends UnitError {
  override readonly name = 'ProvenanceDepthError';
  constructor(limit: number) {
    super(
      `Provenance walk exceeded its depth bound of ${limit}. Refusing rather than ` +
        'truncating: a truncated walk reports an incomplete graph as complete.',
    );
  }
}
