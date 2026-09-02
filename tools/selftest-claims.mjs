#!/usr/bin/env node
/**
 * selftest-claims — prove the claim checker actually catches things.
 *
 * A checker that silently stopped working reports a clean pass forever, which is
 * worse than having no checker: the build stays green while the invariant rots.
 * That is F-08's shape, and it is the reason every checker here has one of these
 * and runs it first.
 *
 * T-28: the probe tree is built under `os.tmpdir()` and NOTHING is written
 * inside the repository. On a filesystem that refuses deletion an in-tree probe
 * survives the run and the next invocation fails against this self-test's own
 * leftover fixture — a false red, which trains people to re-run until it passes.
 *
 * The blind spot the temp tree opens — a checker that has lost its grip on the
 * real repository would still pass every probe below — is closed by
 * `assertRealTreeReachable`, read-only, exactly as in the other four self-tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLAIMS, claimViolations } from './check-claims.mjs';

const TREE = mkdtempSync(join(tmpdir(), 'rms-selftest-claims-'));

/** A fixed derivation set, so the cases test the CHECKER and not the filesystem. */
const DERIVATIONS = Object.freeze({ answer: () => 42 });

function writeDoc(body) {
  mkdirSync(join(TREE, 'tasks'), { recursive: true });
  writeFileSync(join(TREE, 'tasks', 'probe.md'), body, 'utf8');
}

const claim = (over = {}) => [
  {
    id: 'probe',
    file: 'tasks/probe.md',
    pattern: /^\| Answer \| \*\*(\d+)\*\*/m,
    derive: 'answer',
    ...over,
  },
];

const CASES = [
  {
    name: 'a stated count that disagrees with the code',
    doc: '| Answer | **41** |\n',
    claims: claim(),
    mustCatch: /states 41, the code says 42/,
  },
  {
    name: 'a pattern that matches NOTHING — the claim stopped being checked',
    doc: '| Answer is now written differently | 42 |\n',
    claims: claim(),
    mustCatch: /matched NOTHING/,
  },
  {
    name: 'a pattern that matches twice — which number is the claim?',
    doc: '| Answer | **42** |\n\n| Answer | **42** |\n',
    claims: claim(),
    mustCatch: /matched 2 times/,
  },
  {
    name: 'a claim naming a derivation that does not exist',
    doc: '| Answer | **42** |\n',
    claims: claim({ derive: 'nonesuch' }),
    mustCatch: /does not exist/,
  },
  {
    name: 'a claim whose file is missing',
    doc: '| Answer | **42** |\n',
    claims: claim({ file: 'tasks/absent.md' }),
    mustCatch: /could not be read/,
  },
];

const MUST_ALLOW = {
  name: 'a stated count that agrees with the code',
  doc: '| Answer | **42** |\n',
  claims: claim(),
};

/** Read-only. See the note at the top: this is the blind spot the temp tree opens. */
function assertRealTreeReachable() {
  const { violations, checked } = claimViolations();
  if (checked === 0) {
    console.error('selftest-claims: the checker matched no claim in the REAL repository. The');
    console.error('probes below would still pass against a temp tree while the real run checked');
    console.error('nothing.');
    return false;
  }
  // Violations in the real tree are not this self-test's business — `check-claims`
  // reports those itself, immediately after. Only reachability is asserted here.
  console.log(
    `  reachable   real tree: ${String(checked)} claim(s) checked, ${String(violations.length)} currently failing`,
  );
  return true;
}

function main() {
  if (!assertRealTreeReachable()) return 1;

  if (CLAIMS.length === 0) {
    console.error('selftest-claims: the CLAIMS table is empty, so the checker checks nothing.');
    return 1;
  }

  const missed = [];
  const falsePositives = [];

  for (const c of CASES) {
    writeDoc(c.doc);
    const { violations } = claimViolations(TREE, c.claims, DERIVATIONS);
    if (!violations.some((v) => c.mustCatch.test(v))) {
      missed.push(`${c.name} -> got ${JSON.stringify(violations)}`);
      console.error(`  NOT CAUGHT  ${c.name}`);
    } else {
      console.log(`  caught      ${c.name}`);
    }
  }

  writeDoc(MUST_ALLOW.doc);
  const { violations, checked } = claimViolations(TREE, MUST_ALLOW.claims, DERIVATIONS);
  if (violations.length > 0) {
    falsePositives.push(`${MUST_ALLOW.name} -> ${violations[0]}`);
  } else if (checked !== 1) {
    falsePositives.push(`${MUST_ALLOW.name} -> reported ${String(checked)} checked, expected 1`);
  } else {
    console.log(`  allowed     ${MUST_ALLOW.name}`);
  }

  if (missed.length > 0 || falsePositives.length > 0) {
    console.error('\nselftest-claims: FAIL');
    for (const m of missed) console.error(`  MISSED: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED correct input: ${f}`);
    return 1;
  }

  console.log(
    `selftest-claims: PASS — all ${String(CASES.length)} failure modes caught, the agreeing case allowed; ` +
      `${String(CLAIMS.length)} claim(s) declared in the real table.`,
  );
  return 0;
}

process.exitCode = main();
rmSync(TREE, { recursive: true, force: true });
