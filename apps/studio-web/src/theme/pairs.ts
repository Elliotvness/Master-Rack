import { AA_NON_TEXT, AA_TEXT } from './contrast.js';

/**
 * The foreground/background pairs that must meet a contrast minimum.
 *
 * `tokens.test.ts` parses the SHIPPED `tokens.css` and checks every pair below
 * in BOTH themes, so a colour edited in the stylesheet is judged against this
 * list and a pair naming a token the stylesheet lacks fails rather than skips.
 *
 * **What this does not cover, stated rather than implied.** It checks the token
 * VALUES. It cannot check that a component puts `--ink` on `--panel` rather
 * than `--ink-3` on `--sunk`; that is a composition fact and only a rendered
 * screen answers it. This makes a bad palette impossible and a bad application
 * of a good palette merely undetected — the half worth having early, because a
 * palette is edited once and applied everywhere.
 */
export interface ContrastPair {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly why: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  { foreground: '--ink', background: '--panel', minimum: AA_TEXT, why: 'body text on a panel' },
  { foreground: '--ink', background: '--paper', minimum: AA_TEXT, why: 'body text on the page' },
  { foreground: '--ink', background: '--sunk', minimum: AA_TEXT, why: 'body text on the stage' },
  {
    foreground: '--ink-2',
    background: '--panel',
    minimum: AA_TEXT,
    why: 'secondary text — field labels, at body size',
  },
  { foreground: '--ink-2', background: '--paper', minimum: AA_TEXT, why: 'secondary text on the page' },
  { foreground: '--navy', background: '--panel', minimum: AA_TEXT, why: 'links, active tab, accents' },
  { foreground: '--navy', background: '--paper', minimum: AA_TEXT, why: 'the same against the page' },
  {
    foreground: '--pass',
    background: '--pass-bg',
    minimum: AA_TEXT,
    why: 'a PASS status chip — status is never colour alone (ADR-019 rule 5)',
  },
  { foreground: '--block', background: '--block-bg', minimum: AA_TEXT, why: 'a BLOCKING status chip' },
  { foreground: '--warn', background: '--panel', minimum: AA_TEXT, why: 'warning text on a panel' },
  {
    foreground: '--sel',
    background: '--panel',
    minimum: AA_NON_TEXT,
    why: 'the selection ring — a keyboard user cannot use what they cannot see',
  },
]);

/**
 * Pairs measured BELOW AA and accepted, each with its ratio and its reason.
 *
 * These are not exceptions in the sense of "ignore" — they are pinned. The test
 * asserts each one is **still at the ratio recorded here**, so changing the
 * colour breaks the pin and forces the decision to be taken again rather than
 * inherited. An exemption nobody re-checks is a hole with a docstring, which is
 * this repository's own recurring defect.
 *
 * **Why they are accepted at all:** the palette is lifted verbatim from the
 * published artifact, which is the design of record. Silently altering a brand
 * colour to satisfy a gate is not a decision this file gets to take alone, and
 * neither is weakening the gate. Recording the measurement is the honest third
 * option, and it leaves the choice visible to whoever wants to make it.
 *
 * `--rule` is deliberately absent from BOTH lists: it separates regions and is
 * decorative. WCAG 1.4.11 governs components and meaningful graphics, not panel
 * dividers, and ruling a drawing surface into 3:1 boxes is worse rather than
 * more accessible. `--sel` above is the gated boundary.
 */
export interface AcceptedBelowAA {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  /** Measured to two decimals, per theme. The pin. */
  readonly measured: { readonly light: number; readonly dark: number };
  readonly why: string;
}

export const ACCEPTED_BELOW_AA: readonly AcceptedBelowAA[] = Object.freeze([
  {
    foreground: '--ink-3',
    background: '--panel',
    minimum: AA_TEXT,
    measured: { light: 3.76, dark: 4.1 },
    why:
      'The artifact uses --ink-3 for small uppercase labels — HUD chip keys at 9px, section ' +
      'headings, hints. It is below AA at any size and is carried verbatim from the design of ' +
      'record. Raising it is a palette change and belongs to whoever owns the palette.',
  },
  {
    foreground: '--ink-3',
    background: '--paper',
    minimum: AA_TEXT,
    measured: { light: 3.6, dark: 4.46 },
    why: 'The same token against the page rather than a panel.',
  },
  {
    foreground: '--na',
    background: '--na-bg',
    minimum: AA_TEXT,
    measured: { light: 2.8, dark: 4.39 },
    why:
      'The INFO / WAIVED status chip. At 2.80:1 in light this is the WORST pair in the palette ' +
      'and the one most worth revisiting — a grey-on-grey chip is hard to read for anyone, not ' +
      'only at AA. It is carried verbatim because the artifact is the design of record, and it ' +
      'is recorded here rather than quietly corrected so the choice stays visible.',
  },
  {
    foreground: '--warn',
    background: '--warn-bg',
    minimum: AA_TEXT,
    measured: { light: 4.02, dark: 7.2 },
    why:
      'The screening banner and the MISSING / ENGINEERING status chips. Light theme is 4.02:1 ' +
      'against a 4.5 minimum — close, and short. Dark clears it comfortably.',
  },
]);
