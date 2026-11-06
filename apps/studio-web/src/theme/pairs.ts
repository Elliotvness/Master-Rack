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
    foreground: '--warn',
    background: '--warn-bg',
    minimum: AA_TEXT,
    why: 'the MISSING / ENGINEERING status chip — accepted at 4.02:1 until ADR-020 fixed it',
  },
  {
    foreground: '--na',
    background: '--na-bg',
    minimum: AA_TEXT,
    why: 'the INFO / WAIVED status chip — accepted at 2.80:1 until ADR-020 fixed it',
  },
  {
    foreground: '--paper',
    background: '--navy',
    minimum: AA_TEXT,
    why: 'the label on a primary button and the active job step',
  },
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
 * **Why one is accepted at all:** ADR-020 replaced the artifact's palette with
 * the blueprint system and fixed the two status chips that were below AA; the
 * one pair left is a placeholder tint whose job is to look lighter than text.
 * Recording the measurement keeps that choice visible rather than inherited.
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
    measured: { light: 4.03, dark: 5.28 },
    why:
      'Placeholder text and disabled hints only — never a label, a value or a status. ADR-020 ' +
      'kept it one step lighter than --ink-2 so an empty field reads as empty; it passes in dark ' +
      'and is 0.47 short in light. Anything a user must read uses --ink-2 (6.18:1).',
  },
  {
    foreground: '--ink-3',
    background: '--paper',
    minimum: AA_TEXT,
    measured: { light: 3.82, dark: 5.75 },
    why: 'The same token against the page rather than a panel.',
  },
]);
