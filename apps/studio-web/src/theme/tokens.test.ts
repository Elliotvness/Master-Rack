import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AA_TEXT, ColorError, contrastRatio, parseHex, relativeLuminance } from './contrast.js';
import { CONTRAST_PAIRS } from './pairs.js';

const CSS = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/**
 * Read one theme's token block out of the SHIPPED stylesheet.
 *
 * Parsing the real file rather than importing a TypeScript copy of the palette
 * is the whole point: a second copy of the colours would be the thing under
 * test, and the stylesheet — the thing that actually paints — could drift away
 * from it without a single test going red.
 */
function tokensOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
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
    expect(Object.keys(tokens).length).toBeGreaterThan(10);
  });

  it('declares at least one pair to check', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(0);
  });
});

describe('every declared pair meets its minimum, in every theme', () => {
  for (const [themeName, tokens] of Object.entries(THEMES)) {
    for (const pair of CONTRAST_PAIRS) {
      it(`${themeName}: ${pair.foreground} on ${pair.background} ≥ ${pair.minimum}:1 (${pair.why})`, () => {
        const fg = tokens[pair.foreground];
        const bg = tokens[pair.background];

        // A pair naming a token the stylesheet does not define is a FAILURE, not
        // a skip. A contrast suite that silently ignores what it cannot find
        // passes hardest on the theme that is missing the most.
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

describe('the two dark blocks are the same palette, not two palettes', () => {
  /**
   * `[data-theme='dark']` and the `prefers-color-scheme` block are separate
   * rules because the toggle must beat the system preference in both
   * directions. Two hand-maintained copies of one palette is a drift waiting to
   * happen, and this is the gate that catches it.
   */
  it('token for token, identical', () => {
    expect(THEMES.dark).toEqual(THEMES['dark (system default)']);
  });
});

describe('contrastRatio — the arithmetic itself', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('a colour against itself is 1:1', () => {
    expect(contrastRatio('#1f3864', '#1f3864')).toBeCloseTo(1, 10);
  });

  it('is symmetric — a pair cannot depend on which way round it is written', () => {
    expect(contrastRatio('#1f3864', '#f7f8fa')).toBeCloseTo(
      contrastRatio('#f7f8fa', '#1f3864'),
      10,
    );
  });

  it('agrees with the standard on a known mid value', () => {
    // #767676 on white is the canonical 4.54:1 that just clears AA.
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
