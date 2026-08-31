/**
 * Display formatting. One-way, always.
 *
 * A formatted string is for a human to read. It is never parsed back into a
 * value, because a display value has been rounded and re-parsing it would
 * reintroduce exactly the precision loss the micrometre base exists to avoid.
 *
 * Two rules enforced here:
 *   1. An unestablished value never renders as a numeral. It renders as VERIFY.
 *      A number on a screen is a claim; if the model does not know it, the
 *      screen must not print it (blueprint AC-07).
 *   2. US Customary is primary, metric in parentheses, derived one way.
 */

import { isEstablishedOrigin } from './provenance.js';
import { convert, type Quantity } from './quantity.js';
import { dimensionOf } from './units.js';

/** What is printed in place of a number the model cannot establish. */
export const VERIFY = 'VERIFY';

/**
 * Decimal places for a beam face height on screen (P0-009).
 *
 * The catalog STORES the exact published fraction — 5 15/16 is 5.9375, not
 * 5.93 — because face height enters an elevation stack once per level and any
 * rounding errs the same direction every time, so it accumulates instead of
 * cancelling. A one-decimal stored value drifts about 1.25" over a 20-level
 * 65E stack, past the ~1/4" a pallet opening is specified to, and drifts
 * towards reporting MORE clear height than exists.
 *
 * One decimal is therefore a display convention and nothing more: round late,
 * on the way to the screen, never in the data.
 *
 * Note what this constant is NOT. A face height is a catalog scalar, not a
 * `Quantity`: 5.9375" is 150,812.5 µm, and this package deliberately refuses a
 * value that is not a whole micrometre rather than rounding it silently. So a
 * face height cannot be passed through `formatLength` today, and this constant
 * is the agreed precision for whoever renders it — currently the catalog view
 * only. If face height is ever used dimensionally, the conversion into the
 * fixed-point domain must be a deliberate, stated rounding at that call site,
 * not an implicit one here.
 */
export const FACE_HEIGHT_PRECISION = 1;

export interface FormatOptions {
  /** Decimal places for the primary (US Customary) figure. */
  readonly precision?: number;
  /** Append the metric equivalent in parentheses. */
  readonly metric?: boolean;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Format a length. Primary in inches, optional millimetres in parentheses.
 * Returns VERIFY for an unestablished value rather than a numeral.
 */
export function formatLength(q: Quantity, options: FormatOptions = {}): string {
  if (dimensionOf(q.unit) !== 'length') {
    throw new TypeError(`formatLength was given a ${dimensionOf(q.unit)} quantity.`);
  }
  if (!isEstablishedOrigin(q.origin)) return VERIFY;

  const precision = options.precision ?? 3;
  const primary = `${trimZeros(convert(q, 'in').toFixed(precision))}"`;
  if (options.metric !== true) return primary;

  const mm = trimZeros(convert(q, 'mm').toFixed(1));
  return `${primary} (${mm} mm)`;
}

/**
 * Format a load. Primary in pounds. A basis-bound unit keeps its basis in the
 * string and is never shown as plain pounds, because the basis is part of the
 * claim rather than a note about it.
 */
export function formatLoad(q: Quantity, options: FormatOptions = {}): string {
  if (dimensionOf(q.unit) !== 'load') {
    throw new TypeError(`formatLoad was given a ${dimensionOf(q.unit)} quantity.`);
  }
  if (!isEstablishedOrigin(q.origin)) return VERIFY;

  const precision = options.precision ?? 0;

  if (q.unit === 'lb/pr') {
    const perPair = trimZeros((q.value / 1000).toFixed(precision));
    return `${perPair} lb/pr`;
  }

  const lb = trimZeros(convert(q, 'lb').toFixed(precision));
  if (options.metric !== true) return `${lb} lb`;

  // kg is display-only and derived one way; it is never stored or re-parsed.
  const kg = trimZeros((convert(q, 'lb') / 2.204_622_622).toFixed(1));
  return `${lb} lb (${kg} kg)`;
}

/** Format a count. */
export function formatCount(q: Quantity): string {
  if (dimensionOf(q.unit) !== 'count') {
    throw new TypeError(`formatCount was given a ${dimensionOf(q.unit)} quantity.`);
  }
  if (!isEstablishedOrigin(q.origin)) return VERIFY;
  return String(q.value);
}

/** Dispatch on dimension. */
export function format(q: Quantity, options: FormatOptions = {}): string {
  switch (dimensionOf(q.unit)) {
    case 'length':
      return formatLength(q, options);
    case 'load':
      return formatLoad(q, options);
    case 'count':
      return formatCount(q);
  }
}

/**
 * A display entry carries whether its text is an established value, so a
 * renderer never has to infer it from the string. Display lists use this shape
 * rather than a bare string (blueprint C-06).
 */
export interface DisplayText {
  readonly text: string;
  readonly established: boolean;
}

export function displayText(q: Quantity, options: FormatOptions = {}): DisplayText {
  const established = isEstablishedOrigin(q.origin);
  return Object.freeze({ text: format(q, options), established });
}
