#!/usr/bin/env node
/**
 * selftest-front-end-budgets — plants every failure `check-front-end-budgets`
 * claims to catch, and asserts it goes red on each.
 *
 * Runs BEFORE the checker in `verify` and in `ci.yml`, per the house rule: a
 * checker that silently stopped working reports a clean pass forever, and that
 * is the failure mode behind F-06, F-08 and F-41.
 *
 * The last case is the one that matters most and is the reason the checker
 * refuses a vacuous pass: a §5.4 reworded so the parser matches nothing must be
 * a FAILURE, not "nothing to check".
 */

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUDGETS,
  budgetViolations,
  check,
  frontEndBudgetRows,
} from './check-front-end-budgets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PERF_OK = 'initial JS ceiling is 200 KB gzipped';

/** A minimal §5.4 front-end table carrying the four agreed budgets. */
function html(rows) {
  const body = rows
    .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>measured somehow</td></tr>`)
    .join('');
  return `<h3>5.4 Performance</h3><table><thead><tr><th>Budget</th></tr></thead><tbody>
    <tr><td>Parameter change</td><td>p95 &lt; 120 ms</td><td>bench</td></tr>
    </tbody></table>
    <table><thead><tr><th>Front-end budget</th><th>Target</th><th>Measured how</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

const GOOD = [
  ['<strong>INP</strong> — Interaction to Next Paint', '<strong>&le; 200 ms</strong>'],
  ['LCP — Largest Contentful Paint', '&le; 2.5 s'],
  ['CLS — Cumulative Layout Shift', '&le; 0.1'],
  ['Initial JavaScript, gzipped', '&le; 200 KB'],
];

const CASES = [];
const cse = (name, pass) => CASES.push([name, pass]);

cse(
  'the honest case: four agreed budgets, PERF.md agreeing → no problems',
  budgetViolations(html(GOOD), PERF_OK).length === 0,
);

cse(
  'a budget REMOVED from §5.4 → FAIL',
  budgetViolations(html(GOOD.filter((r) => !r[0].includes('CLS'))), PERF_OK).some((p) =>
    p.includes('CLS'),
  ),
);

cse(
  'a budget LOOSENED in §5.4 without this checker following → FAIL',
  budgetViolations(
    html(GOOD.map((r) => (r[0].includes('INP') ? [r[0], '&le; 900 ms'] : r))),
    PERF_OK,
  ).some((p) => p.includes('INP') && p.includes('900 ms')),
);

cse(
  'a budget ADDED to §5.4 that nothing enforces → FAIL',
  budgetViolations(html([...GOOD, ['TTFB', '&le; 400 ms']]), PERF_OK).some((p) =>
    p.includes('TTFB'),
  ),
);

cse(
  'PERF.md no longer stating the ceiling → FAIL',
  budgetViolations(html(GOOD), 'no numbers here').some((p) => p.includes('PERF.md')),
);

cse(
  'the §5.4 table REWORDED so the parser matches nothing → FAIL, not a quiet pass',
  budgetViolations('<h3>5.4 Performance</h3><p>budgets are vibes now</p>', PERF_OK).some((p) =>
    p.includes('matched nothing at all'),
  ),
);

cse(
  'the server-side table above is never mistaken for the front-end one',
  frontEndBudgetRows(html(GOOD)).every((r) => !r.metric.includes('Parameter change')),
);

cse(
  'every budget in BUDGETS is distinct — a duplicated metric would mask a drift',
  new Set(BUDGETS.map((b) => b.metric)).size === BUDGETS.length,
);

// ---- reachability: the REAL tree, read-only --------------------------------
function assertRealTreeReachable() {
  const { rows } = check();
  const perf = readFileSync(join(ROOT, 'PERF.md'), 'utf8');
  if (rows === 0 || perf.length === 0) {
    console.error('selftest-front-end-budgets: the checker read nothing from the REAL repository.');
    console.error('Every case above would still pass against strings while the real scan matched');
    console.error('nothing at all.');
    return false;
  }
  console.log(`  reachable   real tree: §5.4 carries ${String(rows)} front-end budget row(s)`);
  return true;
}

function main() {
  if (!assertRealTreeReachable()) {
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  for (const [name, pass] of CASES) {
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}`);
    if (!pass) failed += 1;
  }
  if (failed > 0) {
    console.error(
      `selftest-front-end-budgets: FAIL — ${String(failed)} of ${String(CASES.length)}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`selftest-front-end-budgets: PASS — ${String(CASES.length)} case(s).`);
}

if (process.argv[1]?.endsWith(`tools${sep}selftest-front-end-budgets.mjs`)) main();
