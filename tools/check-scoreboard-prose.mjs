#!/usr/bin/env node
/**
 * check-scoreboard-prose — one quantity, one figure, inside a single file.
 *
 * WHY THIS EXISTS. `check-scoreboard-sync` compares `tasks/progress.md` against
 * `tasks/progress.html` and says so in its own docstring: *"prose … the two files
 * can still describe the same numbers in different words and pass; only the
 * numbers are checked."* That is an honest statement of a real hole, and the
 * hole has been walked into repeatedly:
 *
 *   drift 30  the breakdown paragraph read "116 … Phase 2's residue 16" while
 *             the table three lines above it summed to 100
 *   drift 35  a heading and its closing sentence carried a percentage two
 *             editions old while the table beside them was current
 *   drift 49  the `main` row named a sha three merges stale
 *
 * Each is the same defect: **a document stating two different figures for one
 * quantity**, with every cross-file gate green because both copies were equally
 * wrong, or because only one copy carried the prose at all.
 *
 * WHAT IT DERIVES, and it derives everything. Nothing here is a hard-coded
 * figure. The phase table's own Total row is the source of truth inside each
 * file; `remaining` is `total - done`, computed, never read. Every prose
 * statement about the same quantity is then compared against that.
 *
 *   1. REMAINING TOTAL. "Remaining: N points", "N points remain", "the
 *      remaining N points" — every one must equal `total - done`.
 *   2. THE BREAKDOWN. "Where the remaining N points sit: Phase 4 42 (44.7%) ·
 *      Phase 3's residue 36 (38.3%) · Phase 5 16 (17.0%)" — the components must
 *      sum to `remaining`, and each stated percentage must equal its own
 *      component over `remaining`.
 *   3. THE DONE PAIR. Every "N of M points" / "N of M effort points" claim must
 *      equal the Total row's own two numbers.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied. It cannot check a figure
 * it cannot derive. A stale git sha (drift 49) is **not** caught here and this
 * checker must not be read as covering it: no command in `verify` reaches the
 * remote. Prose about counts this file can derive is what is gated; prose about
 * anything else is not.
 *
 * QUOTED FIGURES ARE EXEMPT, and this is the one deliberate blind spot. The
 * drift table quotes what a copy USED to say — *"100 points remain … Phase 3
 * (34)"* — and CLAUDE.md's editorial rule is explicit that **a dated observation
 * keeps its number and says its date**. Rewriting those quotations to today's
 * figures would destroy the evidence that the page was ever wrong. So anything
 * between quotation marks is removed before matching. The cost is stated rather
 * than hidden: **a live claim written inside quotation marks is not checked.**
 * The self-test asserts that exemption is exactly this wide and no wider.
 *
 * A VACUOUS PASS IS A FAILURE. A file with no phase total, or with no remaining
 * statement at all, exits 1 rather than reporting "nothing to check" — the same
 * house rule `check-claims` and `check-front-end-budgets` state. That is the one
 * way a parser-based checker refuses to rot.
 */

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The two copies of the scoreboard. Both are checked, each against itself. */
export const SCOREBOARD_FILES = Object.freeze(['tasks/progress.md', 'tasks/progress.html']);

/** Tags out, the handful of entities the scoreboard uses in, whitespace flattened. */
export function plain(source) {
  return source
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/&le;/g, '<=')
    .replace(/&times;/g, '×')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Quotations out. The drift table records what a copy USED to say, in quotes;
 * those figures are dated observations and must keep their numbers. Bounded to
 * 400 characters so an unbalanced quote cannot swallow the rest of the file.
 */
export function unquoted(flat) {
  return flat.replace(/"[^"]{0,400}"/g, ' ');
}

/**
 * The Total row's own two numbers, from whichever copy this is.
 *
 * Markdown: the `| **Total** | **160** | **66** |` row.
 * HTML: the phase bars' last `class="pct">done / points<`, which is the total bar.
 */
export function totalsFrom(source) {
  const md = source.match(/\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/);
  if (md !== null) return { total: Number(md[1]), done: Number(md[2]) };

  const bars = [...source.matchAll(/class="pct">\s*(\d+)\s*\/\s*(\d+)\s*</g)];
  if (bars.length === 0) return null;
  // The scoreboard's own convention: the widest denominator is the whole project.
  const widest = bars.reduce((a, b) => (Number(b[2]) > Number(a[2]) ? b : a));
  return { total: Number(widest[2]), done: Number(widest[1]) };
}

/** One decimal, the way every percentage in the scoreboard is written. */
export function pct(part, whole) {
  return Math.round((part / whole) * 1000) / 10;
}

/** Every prose statement of the remaining-points total, with the text that said it. */
export function remainingClaims(flat) {
  const claims = [];
  const patterns = [
    /Remaining:\s*(\d+)\s*points/gi,
    /(\d+)\s*points\s*remain/gi,
    /remaining\s*(\d+)\s*points/gi,
  ];
  for (const re of patterns) {
    for (const m of flat.matchAll(re)) claims.push({ value: Number(m[1]), text: m[0] });
  }
  return claims;
}

/**
 * The breakdown paragraph: the components and their stated percentages.
 * `Phase 4 42 (44.7%) · Phase 3's residue 36 (38.3%) · Phase 5 16 (17.0%)`
 */
export function breakdownFrom(flat) {
  // Bounded by a period followed by whitespace — `(42.9%)` has no space after its
  // dot, so a decimal cannot terminate the capture. `[^.]*` DID terminate there,
  // which silently reduced this arm to nothing; the self-test caught it.
  const head = flat.match(/Where the remaining (\d+) points sit:(.*?)(?:\.\s|$)/i);
  if (head === null) return null;
  const parts = [];
  for (const m of head[2].matchAll(/([A-Za-z][A-Za-z0-9' ]*?)\s(\d+)\s*\((\d+(?:\.\d+)?)%\)/g)) {
    parts.push({ label: m[1].trim(), points: Number(m[2]), stated: Number(m[3]) });
  }
  return { stated: Number(head[1]), parts };
}

/** Every "N of M points" pair the file states about the plan total. */
export function donePairs(flat) {
  const pairs = [];
  for (const m of flat.matchAll(/(\d+)\s*of\s*(\d+)\s*(?:effort\s*)?(?:pts|points)/gi)) {
    pairs.push({ done: Number(m[1]), total: Number(m[2]), text: m[0] });
  }
  return pairs;
}

export function proseViolations(source, label) {
  const problems = [];
  const flat = unquoted(plain(source));
  const totals = totalsFrom(source);

  if (totals === null) {
    problems.push(
      `${label}: no phase Total row found, so this checker derived nothing and matched nothing. ` +
        'Either the table was reworded and this parser stopped seeing it — in which case the ' +
        'control silently stopped working — or the table is gone, which is not something a ' +
        'silent pass should decide.',
    );
    return problems;
  }

  const remaining = totals.total - totals.done;
  const claims = remainingClaims(flat);

  if (claims.length === 0) {
    problems.push(
      `${label}: the Total row says ${String(totals.done)} of ${String(totals.total)}, but no ` +
        'sentence anywhere states how many points remain. This checker exists to compare that ' +
        'sentence against the table; with none to compare, it is passing vacuously.',
    );
  }

  for (const claim of claims) {
    if (claim.value !== remaining) {
      problems.push(
        `${label}: "${claim.text}" — the Total row says ${String(totals.done)} of ` +
          `${String(totals.total)}, so ${String(remaining)} remain, not ${String(claim.value)}. ` +
          'Two figures for one quantity in one file.',
      );
    }
  }

  const breakdown = breakdownFrom(flat);
  if (breakdown !== null) {
    if (breakdown.stated !== remaining) {
      problems.push(
        `${label}: the breakdown is headed "the remaining ${String(breakdown.stated)} points" ` +
          `while the Total row leaves ${String(remaining)}.`,
      );
    }
    const sum = breakdown.parts.reduce((a, p) => a + p.points, 0);
    if (breakdown.parts.length > 0 && sum !== remaining) {
      problems.push(
        `${label}: the breakdown's components sum to ${String(sum)} (` +
          breakdown.parts.map((p) => `${p.label} ${String(p.points)}`).join(' + ') +
          `) against ${String(remaining)} remaining. Drift 30 was this exact shape.`,
      );
    }
    for (const p of breakdown.parts) {
      const derived = pct(p.points, remaining);
      if (Math.abs(derived - p.stated) > 0.05) {
        problems.push(
          `${label}: the breakdown says ${p.label} is ${String(p.stated)}% of the remainder; ` +
            `${String(p.points)} of ${String(remaining)} is ${String(derived)}%.`,
        );
      }
    }
  }

  for (const pair of donePairs(flat)) {
    if (pair.total !== totals.total || pair.done !== totals.done) {
      problems.push(
        `${label}: "${pair.text}" disagrees with the Total row, which says ` +
          `${String(totals.done)} of ${String(totals.total)}.`,
      );
    }
  }

  return problems;
}

export function check(root = ROOT) {
  const problems = [];
  let files = 0;
  for (const rel of SCOREBOARD_FILES) {
    const source = readFileSync(join(root, rel), 'utf8');
    files += 1;
    problems.push(...proseViolations(source, rel));
  }
  return { problems, files };
}

function main() {
  const { problems, files } = check();
  console.log(`check-scoreboard-prose: ${String(files)} scoreboard file(s) read.`);
  if (problems.length > 0) {
    console.error('\ncheck-scoreboard-prose: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('check-scoreboard-prose: PASS — each file states one figure per quantity.');
}

if (process.argv[1]?.endsWith(`tools${sep}check-scoreboard-prose.mjs`)) main();
