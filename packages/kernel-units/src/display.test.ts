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
