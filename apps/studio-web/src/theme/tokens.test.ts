import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AA_TEXT, ColorError, contrastRatio, parseHex, relativeLuminance } from './contrast.js';
import { ACCEPTED_BELOW_AA, CONTRAST_PAIRS } from './pairs.js';

const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/**
 * Read one theme's token block out of the SHIPPED stylesheet.
 *
 * Parsing the real file rather than importing a TypeScript copy is the whole
 * point: a second copy of the palette would be the thing under test, and the
 * stylesheet — the thing that actually paints — could drift from it without a
 * single test going red.
 */
function tokensOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1] as string] = (m[2] as string).trim();
  }
  return out;
}

const THEMES = {
  light: tokensOf(':root {'),
  dark: tokensOf(":root[data-theme='dark']"),
  'dark (system default)': tokensOf(":root:not([data-theme='light'])"),
};

describe('the parser found something, so a pass is not vacuous', () => {
  it.each(Object.entries(THEMES))('%s defines tokens', (_name, tokens) => {
    expect(Object.keys(tokens).length).toBeGreaterThan(20);
  });

  it('declares pairs to check', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(0);
  });
});

describe('every declared pair meets its minimum, in every theme', () => {
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    for (const pair of CONTRAST_PAIRS) {
      it(`${themeName}: ${pair.foreground} on ${pair.background} ≥ ${pair.minimum}:1 (${pair.why})`, () => {
        const fg = tokens[pair.foreground];
        const bg = tokens[pair.background];

        // A pair naming a token the stylesheet does not define is a FAILURE,
        // not a skip. A contrast suite that ignores what it cannot find passes
        // hardest on the theme missing the most.
        expect(fg, `${pair.foreground} is not defined in ${themeName}`).toBeDefined();
        expect(bg, `${pair.background} is not defined in ${themeName}`).toBeDefined();

        const ratio = contrastRatio(fg as string, bg as string);
        expect(
          Number(ratio.toFixed(2)),
          `${pair.foreground} (${fg}) on ${pair.background} (${bg}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(pair.minimum);
      });
    }
  }
});

/**
 * **The exemptions are pinned, which is what makes them exemptions rather than
 * holes.**
 *
 * The first draft of `ACCEPTED_BELOW_AA` said it pinned these ratios and
 * nothing referenced the list — the mechanism was a docstring. That is this
 * repository's recurring defect, committed inside the file that exists to
 * prevent it, so the assertions below are the mechanism the prose claimed.
 *
 * Each accepted pair must still measure EXACTLY what was recorded. Change the
 * colour and the pin breaks, which forces the decision to be taken again by
 * whoever changed it rather than inherited silently.
 */
describe('accepted sub-AA pairs are pinned to their measured ratio', () => {
  it('there is at least one, or the list should be deleted rather than kept empty', () => {
    expect(ACCEPTED_BELOW_AA.length).toBeGreaterThan(0);
  });

  for (const accepted of ACCEPTED_BELOW_AA) {
    for (const [themeKey, themeName] of [
      ['light', 'light'],
      ['dark', 'dark'],
    ] as const) {
      it(`${themeName}: ${accepted.foreground} on ${accepted.background} is still ${accepted.measured[themeKey]}:1`, () => {
        const tokens = THEMES[themeName];
        const fg = tokens[accepted.foreground];
        const bg = tokens[accepted.background];
        expect(fg, `${accepted.foreground} missing in ${themeName}`).toBeDefined();
        expect(bg, `${accepted.background} missing in ${themeName}`).toBeDefined();

        const ratio = Number(contrastRatio(fg as string, bg as string).toFixed(2));
        expect(
          ratio,
          `${accepted.foreground} on ${accepted.background} now measures ${ratio}:1, not the ` +
            `${accepted.measured[themeKey]}:1 recorded when it was accepted. The exemption is ` +
            'pinned deliberately — re-measure, re-decide, and update the record.',
        ).toBe(accepted.measured[themeKey]);
      });
    }

    it(`${accepted.foreground} on ${accepted.background} is not ALSO in the enforced list`, () => {
      const clash = CONTRAST_PAIRS.some(
        (p) => p.foreground === accepted.foreground && p.background === accepted.background,
      );
      expect(
        clash,
        'a pair cannot be both enforced and excused — one of the two lists is wrong',
      ).toBe(false);
    });

    it(`${accepted.foreground} on ${accepted.background} records why it was accepted`, () => {
      expect(accepted.why.length).toBeGreaterThan(40);
    });
  }

  /**
   * The exemption list must not quietly grow into the palette. If most pairs
   * are excused, the gate is decoration and somebody should say so out loud.
   */
  it('excuses fewer pairs than it enforces', () => {
    expect(ACCEPTED_BELOW_AA.length).toBeLessThan(CONTRAST_PAIRS.length);
  });
});

describe('the two dark blocks are the same palette, not two palettes', () => {
  it('token for token, identical', () => {
    expect(THEMES.dark).toEqual(THEMES['dark (system default)']);
  });
});

describe('the drawing pens are defined in both themes', () => {
  /**
   * `use-pens.ts` reads these at runtime with a fallback. A missing token
   * therefore paints the fallback and nothing goes red — so the check is here,
   * where a missing pen is a failure rather than a slightly wrong colour.
   */
  const PENS = [
    '--pen-upright',
    '--pen-beam',
    '--pen-pallet',
    '--pen-anno',
    '--pen-dim',
    '--pen-grid',
    '--pen-flue',
    '--pen-bldg',
    '--pen-lock',
  ];

  for (const [themeName, tokens] of Object.entries(THEMES)) {
    it.each(PENS)(`${themeName} defines %s`, (pen) => {
      expect(tokens[pen]).toBeDefined();
    });
  }
});

describe('contrastRatio — the arithmetic itself', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('a colour against itself is 1:1', () => {
    expect(contrastRatio('#1f3864', '#1f3864')).toBeCloseTo(1, 10);
  });

  it('is symmetric — a pair cannot depend on which way round it is written', () => {
    expect(contrastRatio('#1f3864', '#fbfaf8')).toBeCloseTo(
      contrastRatio('#fbfaf8', '#1f3864'),
      10,
    );
  });

  it('agrees with the standard on a known mid value', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.55);
  });

  it('white has luminance 1 and black 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
  });
});

describe('parseHex refuses rather than guesses', () => {
  it('expands #rgb', () => {
    expect(parseHex('#1a2')).toEqual([0x11, 0xaa, 0x22]);
  });

  it('accepts #rrggbb in either case', () => {
    expect(parseHex('#1F3864')).toEqual(parseHex('#1f3864'));
  });

  it.each(['red', 'rgb(0,0,0)', '#12', '#1234567', 'var(--ink)', ''])(
    'throws ColorError for %o',
    (bad) => {
      expect(() => parseHex(bad)).toThrow(ColorError);
    },
  );
});
