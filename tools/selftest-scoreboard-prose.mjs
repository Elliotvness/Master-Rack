#!/usr/bin/env node
/**
 * selftest-scoreboard-prose — plants every failure `check-scoreboard-prose`
 * claims to catch, and asserts it goes red on each.
 *
 * Runs BEFORE the checker in `verify` and in `ci.yml`, per the house rule: a
 * checker that silently stopped working reports a clean pass forever, and that
 * is the failure mode behind F-06, F-08 and F-41.
 *
 * The last two cases are the ones that matter. One is the vacuous pass: a phase
 * table reworded so the parser matches nothing must be a FAILURE, not "nothing
 * to check". The other CHARACTERISES the quotation exemption rather than
 * defending it — a stale figure inside quotation marks passes, deliberately,
 * because the drift table quotes what a copy used to say. That case exists so
 * the exemption's exact width is written down and cannot widen unnoticed.
 */

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  breakdownFrom,
  check,
  pct,
  proseViolations,
  totalsFrom,
  unquoted,
} from './check-scoreboard-prose.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A minimal scoreboard: a phase Total row, a remaining sentence, a breakdown. */
function doc({ total = 160, done = 66, remaining = 94, parts = '42 (44.7%) · Phase 3 36 (38.3%) · Phase 5 16 (17.0%)' } = {}) {
  return [
    '| Phase | Points | Done | % |',
    `| **Total** | **${String(total)}** | **${String(done)}** | **41.3%** |`,
    '',
    `**Remaining: ${String(remaining)} points, and Phase 2's residue is zero.**`,
    '',
    `**Where the remaining ${String(remaining)} points sit:** Phase 4 ${parts}.`,
  ].join('\n');
}

const CASES = [];
const cse = (name, pass) => CASES.push([name, pass]);

cse(
  'the honest case: table, sentence and breakdown all agreeing → no problems',
  proseViolations(doc(), 'probe').length === 0,
);

cse(
  'the remaining SENTENCE stale while the table moved → FAIL (drift 30, drift 35)',
  proseViolations(doc({ remaining: 98 }), 'probe').some((p) => p.includes('94 remain, not 98')),
);

cse(
  'the breakdown HEADING stale while the sentence is right → FAIL',
  proseViolations(
    doc().replace('Where the remaining 94 points sit', 'Where the remaining 98 points sit'),
    'probe',
  ).some((p) => p.includes('breakdown is headed')),
);

cse(
  'the breakdown COMPONENTS no longer summing to the remainder → FAIL',
  proseViolations(
    doc({ parts: '42 (44.7%) · Phase 3 40 (38.3%) · Phase 5 16 (17.0%)' }),
    'probe',
  ).some((p) => p.includes('sum to 98')),
);

cse(
  'a breakdown PERCENTAGE that is not its own component over the remainder → FAIL',
  proseViolations(
    doc({ parts: '42 (60.0%) · Phase 3 36 (38.3%) · Phase 5 16 (17.0%)' }),
    'probe',
  ).some((p) => p.includes('60%') && p.includes('44.7%')),
);

cse(
  'an "N of M points" pair disagreeing with the Total row → FAIL',
  proseViolations(`${doc()}\n\n62 of 160 points executed.`, 'probe').some((p) =>
    p.includes('disagrees with the Total row'),
  ),
);

cse(
  'a table reworded so the parser matches nothing → FAIL, not a quiet pass',
  proseViolations('Progress is vibes now. 94 points remain.', 'probe').some((p) =>
    p.includes('matched nothing'),
  ),
);

cse(
  'a Total row with NO remaining sentence anywhere → FAIL, not a quiet pass',
  proseViolations('| **Total** | **160** | **66** |', 'probe').some((p) =>
    p.includes('passing vacuously'),
  ),
);

// --- the quotation exemption, characterised rather than defended -------------
cse(
  'a stale figure INSIDE quotation marks passes — the drift table keeps its dates',
  proseViolations(`${doc()}\n\nThis page once said "100 points remain".`, 'probe').length === 0,
);

cse(
  'the SAME figure outside quotation marks does NOT pass — the exemption is no wider',
  proseViolations(`${doc()}\n\nThis page says 100 points remain.`, 'probe').some((p) =>
    p.includes('not 100'),
  ),
);

cse(
  'an unbalanced quote cannot swallow the file: 400-character bound holds',
  unquoted(`"${'x'.repeat(500)} 98 points remain`).includes('98 points remain'),
);

cse('the percentage helper rounds to one decimal, as the scoreboard writes them', pct(36, 94) === 38.3);

cse(
  'the HTML phase bars are read when there is no markdown Total row',
  totalsFrom('<div class="pct">66 / 160</div><div class="pct">0 / 42</div>')?.total === 160,
);

cse('a document with no breakdown paragraph is not invented one', breakdownFrom('nothing here') === null);

// ---- reachability: the REAL tree, read-only --------------------------------
function assertRealTreeReachable() {
  const { files } = check();
  const md = readFileSync(join(ROOT, 'tasks/progress.md'), 'utf8');
  const totals = totalsFrom(md);
  if (files !== 2 || totals === null || totals.total === 0) {
    console.error('selftest-scoreboard-prose: the checker read nothing from the REAL repository.');
    console.error('Every case above would still pass against strings while the real scan derived');
    console.error('nothing at all.');
    return false;
  }
  console.log(
    `  reachable   real tree: ${String(files)} file(s); Total row ${String(totals.done)} of ${String(totals.total)}`,
  );
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
    console.error(`selftest-scoreboard-prose: FAIL — ${String(failed)} of ${String(CASES.length)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`selftest-scoreboard-prose: PASS — ${String(CASES.length)} case(s).`);
}

if (process.argv[1]?.endsWith(`tools${sep}selftest-scoreboard-prose.mjs`)) main();
