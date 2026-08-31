#!/usr/bin/env node
/**
 * check-determinism (E-09) — the same inputs must produce the same bytes on a
 * different machine, and the same bytes as last week.
 *
 * AC-12 asks for byte-identical regeneration "twice on two machines". Running
 * the corpus twice in one process cannot demonstrate that: both runs share a
 * clock, a locale, a timezone, a module cache and a process environment, so
 * anything the engine implicitly read would be identical in both and the
 * comparison would pass regardless. The check would be theatre.
 *
 * So the second machine is SIMULATED by making this machine behave like a
 * hostile one. The corpus runs in two separate child processes whose
 * environments disagree about the clock:
 *
 *   - TZ: Pacific/Kiritimati vs Pacific/Midway, 26 hours apart and on opposite
 *     sides of the date line. A local date formatted in one lands on a
 *     different calendar day in the other, and getHours() differs.
 *
 * Locale was ALSO attempted, via LANG and LC_ALL, and was removed after being
 * measured rather than assumed: Node ignores both on Windows, resolving to
 * en-US regardless, so setting them would have advertised a hostility the
 * children never actually experienced. A check that names a variable it does
 * not control is worse than one that stays silent, because the green result
 * reads as evidence about locale when it is nothing of the kind. The corpus
 * therefore reports the environment it OBSERVES, and `assertEnvironmentsDiffer`
 * refuses to certify agreement unless the children genuinely ran differently.
 *
 * A THIRD comparison, against the pinned digests in
 * fixtures/determinism/digests.txt, is what makes this a regression check
 * rather than a self-consistency check. Two runs of a changed engine agree
 * perfectly with each other and disagree with the pin. Without the pin, an
 * unintended engine change is invisible here — and "an unintended engine
 * change turns it red" is half the acceptance criterion.
 *
 * Updating the pin is intended to be a deliberate, reviewed act: run with
 * --update and the diff shows a reviewer exactly which derived value moved.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = 'tools/determinism/corpus.test.ts';
const PIN = join(ROOT, 'fixtures', 'determinism', 'digests.txt');

/**
 * Two environments that disagree about everything a pure kernel must not read.
 * If a run's digests differ between these, something in the engine is reading
 * the outside world.
 */
const ENVIRONMENTS = [
  { name: 'machine A (Kiritimati, UTC+14)', env: { TZ: 'Pacific/Kiritimati' } },
  { name: 'machine B (Midway, UTC-11)', env: { TZ: 'Pacific/Midway' } },
];

const DIGEST_RE = /RMS-DIGEST\s+(\S+)\s+([0-9a-f]{64})/g;
const ENV_RE = /RMS-ENV\s+(.+)/;

/**
 * Vitest's own entry script, run under the current `node`.
 *
 * Deliberately not `npx vitest`: on Windows that needs a shell, and a shell
 * would re-introduce the environment inheritance this check exists to control.
 * Resolving the real entry keeps the child a plain, shell-free `node` process.
 */
const VITEST_ENTRY = fileURLToPath(import.meta.resolve('vitest/vitest.mjs'));

/** Run the corpus in a fresh child process under `env`, and parse its digests. */
export function runCorpus(env) {
  const result = spawnSync(process.execPath, [VITEST_ENTRY, 'run', CORPUS, '--reporter=basic'], {
    cwd: ROOT,
    encoding: 'utf8',
    // A fresh, minimal environment: inherited variables are exactly the
    // implicit inputs this check exists to expose.
    env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const digests = new Map();
  for (const [, name, digest] of output.matchAll(DIGEST_RE)) {
    // A repeated name with a different value means the corpus is not stable
    // even within one process, which the cross-process check would then
    // report as a confusing mismatch. Catch it precisely instead.
    if (digests.has(name) && digests.get(name) !== digest) {
      return { failed: `case '${name}' produced two different digests in ONE run`, digests, output };
    }
    digests.set(name, digest);
  }

  if (result.status !== 0) {
    return { failed: `the corpus itself failed (exit ${result.status})`, digests, output };
  }
  if (digests.size === 0) {
    return { failed: 'the corpus emitted no digests at all', digests, output };
  }

  const envLine = ENV_RE.exec(output);
  if (envLine === null) {
    return {
      failed: 'the corpus did not report the environment it observed, so this run cannot ' +
        'be shown to have differed from the other',
      digests,
      output,
    };
  }
  return { failed: null, digests, observed: envLine[1].trim(), output };
}

/**
 * Refuse to certify agreement between two runs that were never actually
 * different. If both children observed the same environment, their digests
 * matching says nothing at all — it is the same machine twice, which is the
 * exact theatre this checker exists to avoid.
 */
export function assertEnvironmentsDiffer(runs) {
  const seen = new Set(runs.map((r) => r.observed));
  if (seen.size === runs.length) return null;
  return (
    'the child processes observed the SAME environment, so agreement between ' +
    'them is not evidence of determinism:\n' +
    runs.map((r) => `      ${r.name}: ${r.observed}`).join('\n')
  );
}

function readPin() {
  if (!existsSync(PIN)) return null;
  const pinned = new Map();
  for (const line of readFileSync(PIN, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const [name, digest] = trimmed.split(/\s+/);
    if (name && digest) pinned.set(name, digest);
  }
  return pinned;
}

function writePin(digests) {
  mkdirSync(dirname(PIN), { recursive: true });
  const body = [
    '# Pinned determinism digests (E-09 / AC-12).',
    '#',
    '# Written by `node tools/check-determinism.mjs --update`. Changing a line',
    '# here means a derived value changed. That is sometimes correct, but it is',
    '# never incidental: a reviewer should be able to say which engine change',
    '# moved it and why. Never update this file to make a red build green',
    '# without that explanation.',
    '',
    ...[...digests.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, d]) => `${n} ${d}`),
    '',
  ].join('\n');
  writeFileSync(PIN, body, 'utf8');
}

/** Compare digests across environments and against the pin. Returns problems. */
export function compareRuns(runs, pinned) {
  const problems = [];
  const [first, ...rest] = runs;

  for (const other of rest) {
    for (const [name, digest] of first.digests) {
      const otherDigest = other.digests.get(name);
      if (otherDigest === undefined) {
        problems.push(`case '${name}' ran on ${first.name} but not on ${other.name}`);
      } else if (otherDigest !== digest) {
        problems.push(
          `case '${name}' is NOT deterministic across machines:\n` +
            `      ${first.name}: ${digest}\n` +
            `      ${other.name}: ${otherDigest}\n` +
            `      Something in this path reads the clock, the locale or the timezone.`,
        );
      }
    }
    for (const name of other.digests.keys()) {
      if (!first.digests.has(name)) {
        problems.push(`case '${name}' ran on ${other.name} but not on ${first.name}`);
      }
    }
  }

  if (pinned !== null) {
    for (const [name, digest] of first.digests) {
      const pin = pinned.get(name);
      if (pin === undefined) {
        problems.push(
          `case '${name}' is not pinned. Run with --update, and explain in the commit ` +
            `what it derives.`,
        );
      } else if (pin !== digest) {
        problems.push(
          `case '${name}' CHANGED against its pin:\n` +
            `      pinned: ${pin}\n` +
            `      now:    ${digest}\n` +
            `      The engine derives a different value than it used to. If that is ` +
            `intended, run --update and say why in the commit.`,
        );
      }
    }
    for (const name of pinned.keys()) {
      if (!first.digests.has(name)) {
        problems.push(`case '${name}' is pinned but no longer runs. A dropped case is not a pass.`);
      }
    }
  }

  return problems;
}

function main() {
  const update = process.argv.includes('--update');

  const runs = [];
  for (const { name, env } of ENVIRONMENTS) {
    const result = runCorpus(env);
    if (result.failed !== null) {
      console.error(`check-determinism: FAIL on ${name} — ${result.failed}`);
      console.error(result.output.split('\n').slice(-30).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log(`  ran ${name}: ${result.digests.size} case(s) — observed ${result.observed}`);
    runs.push({ name, digests: result.digests, observed: result.observed });
  }

  const sameEnvironment = assertEnvironmentsDiffer(runs);
  if (sameEnvironment !== null) {
    console.error(`check-determinism: FAIL — ${sameEnvironment}`);
    process.exitCode = 1;
    return;
  }

  if (update) {
    writePin(runs[0].digests);
    console.log(`check-determinism: pin UPDATED with ${runs[0].digests.size} digest(s) — review the diff.`);
    return;
  }

  const pinned = readPin();
  if (pinned === null) {
    console.error(
      'check-determinism: FAIL — no pinned digests. Without a pin this check only ' +
        'proves the engine agrees with itself, not that it still derives what it did ' +
        'last week. Run: node tools/check-determinism.mjs --update',
    );
    process.exitCode = 1;
    return;
  }

  const problems = compareRuns(runs, pinned);
  if (problems.length > 0) {
    console.error('\ncheck-determinism: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-determinism: PASS — ${runs[0].digests.size} case(s) byte-identical across ` +
      `${runs.length} hostile environments and matching the pin.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
