/**
 * WCAG 2.2 relative luminance and contrast ratio.
 *
 * Here so that "both themes pass contrast" is a computed result rather than a
 * sentence in an acceptance criterion. The maths is small, exactly specified by
 * the standard, and has no dependency — which matters, because a contrast claim
 * checked by eye is a claim nobody re-checks after the next colour edit.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Thrown when a colour cannot be read. Never falls back to black. */
export class ColorError extends Error {
  override readonly name = 'ColorError';
}

/** `#rgb` or `#rrggbb`, case-insensitive, to 0-255 channels. */
export function parseHex(hex: string): readonly [number, number, number] {
  const raw = hex.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (m === null) {
    throw new ColorError(
      `not a hex colour: ${JSON.stringify(hex)}. ` +
        'Expected #rgb or #rrggbb — named colours and rgb() are deliberately not accepted, ' +
        'because a parser that guesses is a parser that reports a contrast ratio for a colour ' +
        'nobody chose.',
    );
  }
  const body = m[1] as string;
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ] as const;
}

/** One channel, 0-255, linearised per WCAG. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * Contrast ratio between two colours, 1:1 to 21:1.
 *
 * Symmetric by construction — lighter and darker are sorted rather than assumed
 * from the argument order, so a pair cannot report a different ratio depending
 * on which way round it is written.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 AA minimums. Large text (AA 3.0) is not used here — nothing relies on it. */
export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3.0;
