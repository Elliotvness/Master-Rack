import { AA_NON_TEXT, AA_TEXT } from './contrast.js';

/**
 * The foreground/background pairs that must meet a contrast minimum, and the
 * minimum each must meet.
 *
 * This list is the specification. `tokens.test.ts` parses the SHIPPED
 * `tokens.css` and checks every pair below in BOTH themes — so a colour edited
 * in the stylesheet is judged against the pair list, and a pair added here with
 * no colours behind it fails to resolve rather than passing quietly.
 *
 * **What this does not cover, stated rather than implied.** It checks the token
 * VALUES. It cannot check that a component actually puts `--ink` on `--bg`
 * rather than `--ink-muted` on `--chrome`; that is a composition fact, and only
 * a rendered screen can answer it. This gate makes a bad palette impossible and
 * a bad application of a good palette merely undetected — which is the half
 * worth having early, because a palette is edited once and applied everywhere.
 */
export interface ContrastPair {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly why: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  { foreground: '--ink', background: '--bg', minimum: AA_TEXT, why: 'body text on the page' },
  { foreground: '--ink', background: '--surface', minimum: AA_TEXT, why: 'body text on a panel' },
  {
    foreground: '--ink-muted',
    background: '--bg',
    minimum: AA_TEXT,
    why: 'secondary text — held to AA_TEXT, not to the large-text 3.0, because it is used at body size',
  },
  {
    foreground: '--ink-muted',
    background: '--surface',
    minimum: AA_TEXT,
    why: 'secondary text on a panel',
  },
  {
    foreground: '--chrome-ink',
    background: '--chrome',
    minimum: AA_TEXT,
    why: 'the header bar, which carries the job tag and the tab labels',
  },
  {
    foreground: '--chrome-ink-muted',
    background: '--chrome',
    minimum: AA_TEXT,
    why: 'an inactive tab label — inactive is not an excuse to be unreadable',
  },
  { foreground: '--accent', background: '--bg', minimum: AA_TEXT, why: 'links and active state' },
  {
    foreground: '--status-ok',
    background: '--surface',
    minimum: AA_TEXT,
    why: 'a Pass finding, as TEXT — status is never colour alone (ADR-019 rule 5)',
  },
  {
    foreground: '--status-warning',
    background: '--surface',
    minimum: AA_TEXT,
    why: 'a Warning finding as text; amber is where a light theme usually fails',
  },
  {
    foreground: '--status-danger',
    background: '--surface',
    minimum: AA_TEXT,
    why: 'a Blocking finding as text',
  },
  {
    foreground: '--status-review',
    background: '--surface',
    minimum: AA_TEXT,
    why: 'an Engineering Review Required finding as text',
  },
  {
    foreground: '--focus',
    background: '--bg',
    minimum: AA_NON_TEXT,
    why: 'the focus ring against the page — a keyboard user cannot use what they cannot see',
  },
  {
    foreground: '--focus',
    background: '--surface',
    minimum: AA_NON_TEXT,
    why: 'the focus ring against a panel',
  },
  {
    foreground: '--border-control',
    background: '--surface',
    minimum: AA_NON_TEXT,
    why: 'the edge of an input or button on a panel — WCAG 1.4.11, a control whose boundary is invisible is a control nobody can find',
  },
  {
    foreground: '--border-control',
    background: '--bg',
    minimum: AA_NON_TEXT,
    why: 'the same control edge against the page',
  },
]);

/**
 * `--border` is deliberately NOT in the list above, and the reason is recorded
 * because "we removed the failing pair" is exactly how a gate gets silenced.
 *
 * The first run of this suite failed three ways — `--border` on `--surface` at
 * **1.42:1** in light and **1.49:1** in dark, against a 3:1 minimum. The wrong
 * fixes were to lower the threshold, or to darken one token until the number
 * went green. Both would have been answering an assertion rather than a
 * question.
 *
 * The question is what the token is FOR. WCAG 1.4.11 governs user-interface
 * components and graphics needed to understand content. It does not govern a
 * decorative separator, and darkening every panel divider to 3:1 produces a
 * screen ruled into boxes — which is a worse drawing surface, not a more
 * accessible one. So the token was SPLIT: `--border` separates regions and is
 * ungated; `--border-control` bounds anything a user can operate and is gated
 * in both themes, against both backgrounds.
 *
 * The consequence, stated rather than left implicit: nothing checks that a
 * component picks the right one. An input drawn with `--border` passes this
 * suite and is wrong. That is a composition fact — the same limit `pairs.ts`
 * already declares — and S4, which is where the first real input lands, is
 * where it needs a mechanism.
 */
