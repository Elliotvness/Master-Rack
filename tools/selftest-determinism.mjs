#!/usr/bin/env node
/**
 * selftest-determinism — prove the determinism checker catches things.
 *
 * Same reasoning as the other three self-tests, and it matters more here than
 * anywhere else. The other checkers scan source and fail loudly when they break.
 * This one compares hashes, and the failure mode of a broken hash comparison is
 * a permanent, confident green. A checker that compared nothing, or that
 * silently found zero cases, would report "PASS - byte-identical" forever while
 * the guarantee it names rotted underneath it.
 *
 * The comparison logic is exercised directly with synthetic digest maps rather
 * than by mutating the engine: the thing under test is `compareRuns`, and
 * feeding it the exact divergence shapes is both faster and more precise than
 * hoping a source edit produces one. The end-to-end direction is covered by the
 * gate-proof run recorded in docs/CURRENT_STATE.md, where a real `Date.now()`
 * was introduced into a derivation path and turned this checker red.
 */

import { assertEnvironmentsDiffer, compareRuns } from './check-determinism.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const machine = (name, entries) => ({ name, digests: new Map(entries) });

/** Each must be caught. The name is what a miss would mean in production. */
const MUST_CATCH = [
  {
    name: 'a case that derives a DIFFERENT value on the second machine',
    runs: [machine('A', [['bom', A]]), machine('B', [['bom', B]])],
    pin: new Map([['bom', A]]),
  },
  {
    name: 'a case that changed against its pin (an unintended engine change)',
    runs: [machine('A', [['bom', B]]), machine('B', [['bom', B]])],
    pin: new Map([['bom', A]]),
  },
  {
    name: 'a case that silently stopped running (a dropped case is not a pass)',
    runs: [machine('A', []), machine('B', [])],
    pin: new Map([['bom', A]]),
  },
  {
    name: 'a brand-new case with no pin at all',
    runs: [machine('A', [['bom', A]]), machine('B', [['bom', A]])],
    pin: new Map(),
  },
  {
    name: 'a case that ran on one machine but not the other',
    runs: [machine('A', [['bom', A]]), machine('B', [])],
    pin: new Map([['bom', A]]),
  },
  {
    name: 'a case that appeared only on the SECOND machine',
    runs: [machine('A', []), machine('B', [['bom', A]])],
    pin: new Map(),
  },
];

/** Each must NOT be caught, or the checker becomes noise people route around. */
const MUST_ALLOW = [
  {
    name: 'identical digests across machines, matching the pin',
    runs: [
      machine('A', [
        ['bom', A],
        ['units', B],
      ]),
      machine('B', [
        ['bom', A],
        ['units', B],
      ]),
    ],
    pin: new Map([
      ['bom', A],
      ['units', B],
    ]),
  },
  {
    name: 'cases reported in a different order (order is not meaning)',
    runs: [
      machine('A', [
        ['bom', A],
        ['units', B],
      ]),
      machine('B', [
        ['units', B],
        ['bom', A],
      ]),
    ],
    pin: new Map([
      ['units', B],
      ['bom', A],
    ]),
  },
];

function main() {
  const missed = [];
  const falsePositives = [];

  // The environment guard is the one that keeps the whole check honest: if the
  // children never actually differ, every digest agrees trivially and the
  // checker certifies nothing while reporting a confident green.
  const sameEnv = [
    { name: 'A', observed: 'timezone=UTC locale=en-US' },
    { name: 'B', observed: 'timezone=UTC locale=en-US' },
  ];
  if (assertEnvironmentsDiffer(sameEnv) === null) {
    missed.push('two children that ran in the SAME environment');
  } else {
    console.log('  caught      two children that ran in the SAME environment');
  }

  const differentEnv = [
    { name: 'A', observed: 'timezone=Pacific/Kiritimati locale=en-US' },
    { name: 'B', observed: 'timezone=Pacific/Midway locale=en-US' },
  ];
  if (assertEnvironmentsDiffer(differentEnv) !== null) {
    falsePositives.push('two children that genuinely ran in different environments');
  } else {
    console.log('  allowed     two children that genuinely ran in different environments');
  }

  for (const { name, runs, pin } of MUST_CATCH) {
    const problems = compareRuns(runs, pin);
    if (problems.length === 0) missed.push(name);
    else console.log(`  caught      ${name}`);
  }

  for (const { name, runs, pin } of MUST_ALLOW) {
    const problems = compareRuns(runs, pin);
    if (problems.length > 0) falsePositives.push(`${name} -> ${problems[0]}`);
    else console.log(`  allowed     ${name}`);
  }

  if (missed.length > 0 || falsePositives.length > 0) {
    console.error('\nselftest-determinism: FAIL');
    for (const m of missed) console.error(`  MISSED a real divergence: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED correct output: ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `selftest-determinism: PASS — all ${MUST_CATCH.length + 1} divergence types caught, ` +
      `all ${MUST_ALLOW.length + 1} legitimate outputs allowed.`,
  );
}

main();
