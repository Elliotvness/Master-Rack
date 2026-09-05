#!/usr/bin/env node
/**
 * check-front-end-budgets — the front-end budgets stated in blueprint §5.4 are
 * the ones the build enforces, and the numbers agree wherever they are written.
 *
 * **P-05 is why this exists.** Until 2026-09-04 every budget in §5.4 was server-
 * or kernel-side: the 120 ms preview budget covers the computation and nothing
 * covered the paint, in a product whose premise is that the preview interaction
 * *is* the product. P-05's own words: *a bundle ceiling agreed after the bundle
 * exists is a ceiling nobody meets.* The numbers were therefore agreed first —
 * and a number agreed in a document and enforced by nothing is the exact defect
 * this repository hunts, so this is the mechanism.
 *
 * WHAT IT CHECKS TODAY, and it is not the bundle.
 *
 * There is no client bundle yet — zero `.tsx` files, no `vite` or `react` in any
 * `package.json` — so there is nothing to weigh. What there *is* is a number
 * written in three places that must not drift apart: blueprint §5.4, this
 * checker's `BUDGETS`, and `PERF.md`. That is the same failure class as drift 18
 * and drift 44 (two copies of a figure, one gate, and the gate looking elsewhere),
 * and it is real today. So:
 *
 *   1. §5.4's front-end table is parsed out of the BUILT blueprint and compared,
 *      metric for metric, against `BUDGETS` below. A budget edited in the
 *      blueprint and not here — or here and not there — fails.
 *   2. `PERF.md` must state the same ceiling for initial JS.
 *   3. When a real SPA build EXISTS, its INITIAL JavaScript is weighed against
 *      the ceiling. Until then this arm reports `no SPA build` and says so out
 *      loud rather than passing quietly.
 *
 * WHAT COUNTS AS A BUNDLE, and why the discriminator is `index.html`. The first
 * version of this checker summed every `.js` under each app's `dist` — and passed,
 * reporting "client-web 16 KB gz", because `tsc --build` emits modules there.
 * Weighing compiler output and calling it "initial JavaScript" is this
 * repository's own recurring defect committed by the control written to prevent
 * it: the name was wider than the mechanism, and it would have read green
 * forever while measuring the wrong thing. A directory counts as an SPA build
 * only if it holds an `index.html`, and the initial payload is the scripts THAT
 * DOCUMENT references — the shell plus the first route — not every file in the
 * tree. Found by running the checker rather than by reading it.
 *
 * A VACUOUS PASS IS A FAILURE. If the §5.4 front-end rows cannot be found at
 * all, this exits 1 rather than reporting "nothing to check" — that is the one
 * way a parser-based checker refuses to rot, and it is the house rule
 * (`check-claims` states the same policy for its patterns).
 *
 * WHICH BUILDS ARE WEIGHED — discovered, not listed. Any `apps/<app>/dist`
 * holding an `index.html` is weighed, whoever added it. It was a frozen
 * two-entry array until a fourth app with a 301 KB gzipped bundle walked
 * through this checker and it printed "no SPA build ... PASS".
 *
 * THE BLIND SPOT, stated rather than implied: **this checker has still never
 * weighed a real framework build.** The self-test now plants a synthetic
 * `dist/index.html` over the ceiling and asserts this goes red, so the arm is
 * no longer unexercised — but a synthetic bundle is not Vite output, and the
 * discriminator, the ref extraction and the gzip accounting are only proven
 * against a real one. Running it against a genuine build is still **T-16's
 * obligation**, recorded here and in `tasks/todo.md` under P-05 so it is not
 * mistaken for done. Nor does any of this measure INP, LCP or CLS: those need
 * a browser and a screen, and P-05's second box is where they live.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The agreed budgets. Each `metric` must appear in §5.4's front-end table with
 * this exact `target` string, and the blueprint is the governing copy — if these
 * disagree, the blueprint is right and this file is wrong (CLAUDE.md's rule).
 */
export const BUDGETS = Object.freeze([
  Object.freeze({ metric: 'INP', target: '200 ms', kind: 'interaction' }),
  Object.freeze({ metric: 'LCP', target: '2.5 s', kind: 'load' }),
  Object.freeze({ metric: 'CLS', target: '0.1', kind: 'stability' }),
  Object.freeze({ metric: 'Initial JavaScript', target: '200 KB', kind: 'bundle' }),
]);

/** The initial-JS ceiling in bytes, gzipped. The one number the bundle arm uses. */
export const INITIAL_JS_CEILING_BYTES = 200 * 1024;

/**
 * Where SPA builds land, DISCOVERED rather than listed.
 *
 * This was a frozen two-entry array, and that is a control whose reach is
 * whatever somebody last typed. Planted before the change: a fourth app with a
 * **301 KB gzipped** initial bundle in `apps/probe-web/dist` — half again over
 * the ceiling — and this checker printed *"no SPA build ... PASS"*, because the
 * directory was not in the list. The bundle that is not weighed is exactly the
 * bundle nobody agreed a number for.
 *
 * A directory counts only if it holds an `index.html`; see the header on why
 * the discriminator is that and not "some .js under dist".
 *
 * ONE CEILING, APPLIED TO EVERY BUILD FOUND. §5.4 names two applications and
 * says the client bundle is the one the ceiling exists for. Weighing a third
 * against the same 200 KB is deliberate and it is the strict direction: a
 * bundle with no agreed number gets the agreed number rather than none. A
 * *different* ceiling for a different audience is a §5.4 amendment, and when
 * one is agreed this function is where the per-app lookup goes.
 */
export function discoverBundleDirs(root = ROOT) {
  let apps;
  try {
    apps = readdirSync(join(root, 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return apps
    .map((app) => `apps/${app}/dist`)
    .filter((rel) => existsSync(join(root, rel, 'index.html')));
}

/** Strip tags and collapse whitespace, so a target reads the same as it renders. */
function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&le;/g, '<=')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The front-end budget rows from the built blueprint: `[{metric, target}]`.
 *
 * Bounded to the table whose header cell reads "Front-end budget", so the five
 * server-side rows above it are never mistaken for these.
 */
export function frontEndBudgetRows(html) {
  const head = html.indexOf('Front-end budget');
  if (head === -1) return [];
  const start = html.indexOf('<tbody>', head);
  const end = html.indexOf('</tbody>', start);
  if (start === -1 || end === -1) return [];
  const rows = [];
  for (const m of html.slice(start, end).matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    if (cells.length >= 2) rows.push({ metric: cells[0], target: cells[1], how: cells[2] ?? '' });
  }
  return rows;
}

/**
 * The scripts an SPA's `index.html` pulls on first load: `<script src>` and
 * `<link rel="modulepreload" href>`. That set IS the initial payload the 200 KB
 * ceiling is about. Lazily-loaded route chunks are deliberately excluded — they
 * are the point of the code-splitting decision recorded in §5.4.
 */
export function initialScriptRefs(indexHtml) {
  const refs = new Set();
  for (const m of indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) refs.add(m[1]);
  for (const m of indexHtml.matchAll(
    /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/g,
  )) {
    refs.add(m[1]);
  }
  return [...refs].filter((r) => !/^https?:/.test(r));
}

/** Gzipped bytes of the initial payload `index.html` references. */
export function initialJsBytes(dir, indexHtml) {
  let total = 0;
  for (const ref of initialScriptRefs(indexHtml)) {
    const full = join(dir, ref.replace(/^\.?\//, '').split('?')[0]);
    if (!existsSync(full) || statSync(full).isDirectory()) continue;
    total += gzipSync(readFileSync(full)).length;
  }
  return total;
}

export function budgetViolations(html, perfMd) {
  const problems = [];
  const rows = frontEndBudgetRows(html);

  // A parse that matched nothing is a FAILURE, never "nothing to check".
  if (rows.length === 0) {
    problems.push(
      'blueprint §5.4 has no "Front-end budget" table, so this checker matched nothing at all. ' +
        'Either the section was reworded and this parser stopped seeing it — in which case the ' +
        'control silently stopped working — or the budgets were removed, which is a decision that ' +
        'belongs in the blueprint and not in a silent pass.',
    );
    return problems;
  }

  for (const budget of BUDGETS) {
    const row = rows.find((r) => r.metric.includes(budget.metric));
    if (row === undefined) {
      problems.push(
        `§5.4's front-end table does not carry ${budget.metric}, which this checker enforces. ` +
          'The blueprint governs: either restore the row, or remove the budget from BUDGETS ' +
          'deliberately.',
      );
      continue;
    }
    if (!row.target.includes(budget.target)) {
      problems.push(
        `${budget.metric}: §5.4 says "${row.target}", this checker enforces "${budget.target}". ` +
          'The blueprint is the governing copy — fix this file, never the blueprint, unless the ' +
          'budget itself is being amended.',
      );
    }
  }

  for (const row of rows) {
    if (!BUDGETS.some((b) => row.metric.includes(b.metric))) {
      problems.push(
        `§5.4 carries a front-end budget this checker does not enforce: "${row.metric}". A budget ` +
          'nothing measures is the shape P-05 exists to prevent.',
      );
    }
  }

  if (!perfMd.includes('200 KB')) {
    problems.push(
      'PERF.md does not state the 200 KB initial-JS ceiling. P-05 requires the number to be ' +
        'recorded where the performance record lives, not only in the blueprint.',
    );
  }

  return problems;
}

/**
 * The bundle arm. Returns null while no SPA build exists — the caller says so
 * out loud. A `dist/` full of `tsc` output is NOT an SPA build; see the header.
 */
export function weighBundles(root = ROOT) {
  const weighed = [];
  for (const rel of discoverBundleDirs(root)) {
    const dir = join(root, rel);
    const index = join(dir, 'index.html');
    if (!existsSync(index)) continue;
    weighed.push({ dir: rel, bytes: initialJsBytes(dir, readFileSync(index, 'utf8')) });
  }
  return weighed.length === 0 ? null : weighed;
}

/**
 * The ceiling comparison, separated from `check` so the self-test can plant an
 * over-ceiling bundle without a blueprint and a PERF.md beside it. An arm that
 * can only be exercised through a full repository is an arm that stays
 * unplanted, which is how it went three weeks without ever being run.
 */
export function bundleProblems(bundles) {
  const problems = [];
  for (const b of bundles ?? []) {
    if (b.bytes > INITIAL_JS_CEILING_BYTES) {
      problems.push(
        `${b.dir}: ${String(Math.round(b.bytes / 1024))} KB of gzipped JavaScript exceeds the ` +
          `${String(INITIAL_JS_CEILING_BYTES / 1024)} KB ceiling agreed in §5.4.`,
      );
    }
  }
  return problems;
}

export function check(root = ROOT) {
  const html = readFileSync(join(root, 'rack-master-studio-blueprint.html'), 'utf8');
  const perfMd = readFileSync(join(root, 'PERF.md'), 'utf8');
  const problems = budgetViolations(html, perfMd);
  const bundles = weighBundles(root);
  problems.push(...bundleProblems(bundles));

  return { problems, rows: frontEndBudgetRows(html).length, bundles };
}

function main() {
  const { problems, rows, bundles } = check();
  const bundleNote =
    bundles === null
      ? 'no SPA build (no dist/index.html) — the weigh-the-bundle arm is UNPROVEN, T-16\'s obligation'
      : bundles.map((b) => `${b.dir} ${String(Math.round(b.bytes / 1024))} KB gz`).join(', ');
  console.log(`check-front-end-budgets: ${String(rows)} §5.4 front-end row(s); ${bundleNote}.`);
  if (problems.length > 0) {
    console.error('\ncheck-front-end-budgets: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('check-front-end-budgets: PASS — §5.4, this checker and PERF.md state one ceiling.');
}

if (process.argv[1]?.endsWith(`tools${sep}check-front-end-budgets.mjs`)) main();
