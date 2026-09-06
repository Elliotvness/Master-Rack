import { describe, expect, it } from 'vitest';

import {
  FT,
  IN,
  LengthError,
  MICROMETRES_PER_INCH,
  MICROMETRES_PER_MIL,
  convertsExactly,
  inchesToMicrometres,
  isMicrometres,
  milToMicrometres,
} from './length.js';

describe('the constants are the definitions, not measurements', () => {
  it('1 in = 25,400 µm and 1 mil = 25.4 µm', () => {
    expect(MICROMETRES_PER_INCH).toBe(25_400);
    expect(MICROMETRES_PER_MIL).toBe(25.4);
    expect(MICROMETRES_PER_INCH).toBe(MICROMETRES_PER_MIL * 1000);
  });
});

describe('milToMicrometres converts exactly or refuses', () => {
  it.each([
    [0, 0],
    [1000, 25_400],
    [96_000, 2_438_400],
    [5, 127],
    [-1000, -25_400],
  ])('%i mil is %i µm', (mil, um) => {
    expect(milToMicrometres(mil)).toBe(um);
  });

  /**
   * The whole reason DEC-2 exists. 25.4 is not an integer, so an odd mil value
   * does not land on a whole micrometre — 1 mil is 25.4 µm, 3 mil is 76.2 µm.
   * Rounding is refused because a silently rounded length is a drawing that
   * disagrees with the number printed beside it.
   */
  it.each([1, 2, 3, 4, 6, 7, 999])('refuses %i mil rather than rounding', (mil) => {
    expect(() => milToMicrometres(mil)).toThrow(LengthError);
    expect(() => milToMicrometres(mil)).toThrow(/not a whole micrometre/);
  });

  it('says what the inexact value would have been', () => {
    expect(() => milToMicrometres(3)).toThrow(/76\.2 µm/);
  });

  it('multiples of 5 are exact, and nothing else is', () => {
    for (let mil = 0; mil < 40; mil += 1) {
      expect(convertsExactly(mil)).toBe(mil % 5 === 0);
    }
  });

  /**
   * `mil * 25.4` gives 76.19999999999999 for 3 mil, so an `isInteger` test on
   * the float form answers a question about IEEE-754 rather than about the
   * value. The integer path is why 5 mil is accepted and 3 is not.
   */
  it('decides exactness in integers, not in floats', () => {
    expect(3 * 25.4).not.toBe(76.2);
    expect(convertsExactly(5)).toBe(true);
    expect(milToMicrometres(5)).toBe(127);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
    'refuses %o as a mil value',
    (bad) => {
      expect(() => milToMicrometres(bad)).toThrow(LengthError);
      expect(convertsExactly(bad)).toBe(false);
    },
  );
});

describe('inches and feet', () => {
  it.each([
    [0, 0],
    [1, 25_400],
    [42, 1_066_800],
    [96, 2_438_400],
    [0.5, 12_700],
  ])('%o in is %i µm', (inches, um) => {
    expect(inchesToMicrometres(inches)).toBe(um);
    expect(IN(inches)).toBe(um);
  });

  it('feet are twelve inches', () => {
    expect(FT(20)).toBe(IN(240));
    expect(FT(28)).toBe(8_534_400);
  });

  it('refuses an inch value finer than a micrometre rather than rounding', () => {
    expect(() => inchesToMicrometres(1 / 3)).toThrow(LengthError);
  });
});

describe('isMicrometres', () => {
  it.each([0, 1, -1, 25_400])('accepts the safe integer %i', (v) => {
    expect(isMicrometres(v)).toBe(true);
  });

  it.each([1.5, Number.NaN, '25400', null, undefined, Number.MAX_SAFE_INTEGER + 2])(
    'rejects %o',
    (v) => {
      expect(isMicrometres(v)).toBe(false);
    },
  );
});
