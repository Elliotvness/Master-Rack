import { describe, expect, it } from 'vitest';
import {
  VERIFY,
  displayText,
  each,
  format,
  formatCount,
  formatLength,
  formatLoad,
  inches,
  mlb,
  pounds,
  poundsPerPair,
  um,
} from './index.js';

describe('AC-07 — an unestablished value never renders as a numeral', () => {
  it('renders VERIFY for an unknown length', () => {
    expect(formatLength(um(1_219_200, 'UNKNOWN'))).toBe(VERIFY);
  });

  it('renders VERIFY for an unknown load', () => {
    expect(formatLoad(mlb(5_400_000, 'UNKNOWN'))).toBe(VERIFY);
    expect(formatLoad(poundsPerPair(5400, 'UNKNOWN'))).toBe(VERIFY);
  });

  it('renders VERIFY for an unknown count', () => {
    expect(formatCount(each(12, 'UNKNOWN'))).toBe(VERIFY);
  });

  it('contains no digit at all when the value is unestablished', () => {
    expect(format(um(1_219_200, 'UNKNOWN'))).not.toMatch(/[0-9]/);
  });
});

describe('length formatting', () => {
  it('shows US Customary as primary', () => {
    expect(formatLength(inches(48))).toBe('48"');
  });

  it('shows metric in parentheses, derived one way', () => {
    expect(formatLength(inches(48), { metric: true })).toBe('48" (1219.2 mm)');
  });

  it('honours a requested precision', () => {
    expect(formatLength(inches(5.92), { precision: 2 })).toBe('5.92"');
  });

  it('refuses a quantity of the wrong dimension', () => {
    expect(() => formatLength(mlb(1))).toThrow(TypeError);
  });
});

describe('load formatting', () => {
  it('shows pounds', () => {
    expect(formatLoad(pounds(5400))).toBe('5400 lb');
  });

  it('shows kilograms as a one-way display value', () => {
    expect(formatLoad(pounds(1000), { metric: true })).toBe('1000 lb (453.6 kg)');
  });

  it('keeps the basis in the string for a per-pair capacity', () => {
    expect(formatLoad(poundsPerPair(5400))).toBe('5400 lb/pr');
  });

  it('never renders a per-pair capacity as plain pounds', () => {
    expect(formatLoad(poundsPerPair(5400))).not.toBe('5400 lb');
  });

  it('refuses a quantity of the wrong dimension', () => {
    expect(() => formatLoad(um(1))).toThrow(TypeError);
  });
});

describe('count formatting', () => {
  it('formats a count', () => {
    expect(formatCount(each(916))).toBe('916');
    expect(format(each(916))).toBe('916');
  });

  it('refuses a quantity of the wrong dimension', () => {
    expect(() => formatCount(um(1))).toThrow(TypeError);
  });
});

describe('format dispatches on dimension', () => {
  it('routes a length', () => {
    expect(format(inches(48))).toBe('48"');
  });

  it('routes a load, including a basis-bound one', () => {
    expect(format(pounds(5400))).toBe('5400 lb');
    expect(format(poundsPerPair(5400))).toBe('5400 lb/pr');
  });

  it('routes a count', () => {
    expect(format(each(4))).toBe('4');
  });

  it('passes options through to the dimension formatter', () => {
    expect(format(inches(48), { metric: true })).toBe('48" (1219.2 mm)');
    expect(format(pounds(1000), { metric: true })).toBe('1000 lb (453.6 kg)');
  });
});

describe('display entries carry establishment, never a bare string', () => {
  it('marks an established value', () => {
    const d = displayText(inches(48));
    expect(d).toEqual({ text: '48"', established: true });
  });

  it('marks an unestablished value without printing a number', () => {
    const d = displayText(um(1_219_200, 'UNKNOWN'));
    expect(d).toEqual({ text: VERIFY, established: false });
  });
});

describe('formatLength — feet, inches and sixteenths', () => {
  /**
   * The convention a drawing uses. Ported from the v1 prototype's `fmtFtIn`,
   * and these are the exact strings the published artifact prints.
   */
  it.each([
    [132, `11'-0"`],
    [126, `10'-6"`],
    [99, `8'-3"`],
    [99 * 12 + 3, `99'-3"`],
    [96, `8'-0"`],
    [12, `1'-0"`],
  ])('%i in renders as %s', (value, expected) => {
    expect(formatLength(inches(value), { feetInches: true })).toBe(expected);
  });

  it('omits the feet below one foot', () => {
    expect(formatLength(inches(6), { feetInches: true })).toBe('6"');
    expect(formatLength(inches(0), { feetInches: true })).toBe('0"');
  });

  it('keeps a zero inches, because 11\'-0" is what a dimension string looks like', () => {
    expect(formatLength(inches(24), { feetInches: true })).toBe(`2'-0"`);
  });

  it('reduces the fraction to lowest terms', () => {
    expect(formatLength(inches(5.125), { feetInches: true })).toBe('5 1/8"');
    expect(formatLength(inches(5.25), { feetInches: true })).toBe('5 1/4"');
    expect(formatLength(inches(5.375), { feetInches: true })).toBe('5 3/8"');
    expect(formatLength(inches(5.5), { feetInches: true })).toBe('5 1/2"');
    expect(formatLength(inches(5.75), { feetInches: true })).toBe('5 3/4"');
  });

  /**
   * **A sixteenth of an inch cannot be stored.** 1/16" is 1,587.5 µm, and this
   * package refuses a value that is not a whole micrometre rather than rounding
   * it silently. So the sixteenths grid is a DISPLAY grid: eighths and coarser
   * are exact, and anything finer is a rounding on the way to the screen of a
   * value that was never a sixteenth.
   *
   * Worth knowing before someone reads `5 5/16"` off a drawing and assumes the
   * model holds it exactly. It does not, and it cannot.
   */
  it('refuses to store a true sixteenth, so a displayed one is always a rounding', () => {
    expect(() => inches(5.3125)).toThrow();
    // The nearest storable value below it renders as the sixteenth it rounds to.
    expect(formatLength(um(134_937), { feetInches: true })).toBe('5 5/16"');
  });

  it('signs a negative with a minus, not a hyphen that reads as the feet dash', () => {
    expect(formatLength(inches(-18), { feetInches: true })).toBe(`−1'-6"`);
  });

  /** VERIFY wins over every format option. An unestablished value has no shape. */
  it('still refuses an unestablished value', () => {
    expect(formatLength(um(1000, 'UNKNOWN'), { feetInches: true })).toBe(VERIFY);
  });

  it('can still append the metric equivalent', () => {
    expect(formatLength(inches(132), { feetInches: true, metric: true })).toBe(
      `11'-0" (3352.8 mm)`,
    );
  });
});
