#!/usr/bin/env node
/**
 * selftest-provenance — prove the provenance lint actually catches things.
 *
 * A linter that silently stopped working reports a clean pass forever, which is
 * worse than having no linter: the build stays green while the invariant rots.
 * A renamed directory, a changed formatter name, or a regex that no longer
 * matches would all fail this way, and none of them would be noticed.
 *
 * So this writes each violation into a real package, runs the linter, asserts
 * it went red, and removes the file. It also asserts the NEGATIVE cases: legal
 * code must not be flagged, or the linter becomes noise that people learn to
 * ignore, which is the same failure by a slower route.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lintProvenance } from './lint-provenance.mjs';

/**
 * T-28. The probe tree lives under `os.tmpdir()`, never inside the repository:
 * on a filesystem that refuses deletion the probe survived and the NEXT run of
 * the linter failed against this self-test's own leftover fixture. A false red
 * is as corrosive as a false green.
 *
 * The linter's rules are module constants, not files, so the temp tree exercises
 * the REAL configuration. The blind spot that introduces — a linter that has
 * lost its grip on the real repository would still pass every probe below — is
 * closed, read-only, by `assertRealTreeReachable`.
 */
const TREE = mkdtempSync(join(tmpdir(), 'rms-selftest-provenance-'));
const PROBE_DIR = join(TREE, 'packages', 'display-list', 'src');
const PROBE = join(PROBE_DIR, 'probe.ts');

const HEADER = "import { formatLength, displayText } from '@rms/kernel-units';\n";

/** Each must be caught. The name is what a failure here would mean. */
const MUST_CATCH = [
  {
    name: 'numeric literal passed to a formatter',
    source: `${HEADER}export const x = formatLength(96);\n`,
  },
  {
    name: 'negative numeric literal',
    source: `${HEADER}export const x = formatLength(-4.5);\n`,
  },
  {
    name: 'arithmetic on raw numbers',
    source: `${HEADER}export const x = (a: number) => formatLength(a * 25400);\n`,
  },
  {
    name: 'reaching past the Quantity to its raw .value',
    source: `${HEADER}export const x = (q: { value: number }) => formatLength(q.value);\n`,
  },
  {
    name: 'numeric coercion',
    source: `${HEADER}export const x = (s: string) => formatLength(Number(s));\n`,
  },
  {
    name: 'a cast laundering a raw value into a Quantity',
    source: `${HEADER}export const x = (n: number) => formatLength(n as unknown as Quantity);\n`,
  },
  {
    name: 'as never, the cast that silences everything',
    source: `${HEADER}export const x = (n: number) => displayText(n as never);\n`,
  },
  {
    name: 'displayText applied to a literal',
    source: `${HEADER}export const x = displayText(144);\n`,
  },
];

/**
 * Each must NOT be caught. A linter that flags correct code trains people to
 * ignore it, and an ignored gate is an absent gate.
 */
const MUST_ALLOW = [
  {
    name: 'a bound Quantity passed normally',
    source: `${HEADER}import { inches } from '@rms/kernel-units';\nexport const x = formatLength(inches(96));\n`,
  },
  {
    name: 'a variable holding a Quantity',
    source: `${HEADER}import type { Quantity } from '@rms/kernel-units';\nexport const x = (q: Quantity) => formatLength(q);\n`,
  },
  {
    name: 'a property access that is not .value',
    source: `${HEADER}import type { Quantity } from '@rms/kernel-units';\nexport const x = (o: { span: Quantity }) => formatLength(o.span);\n`,
  },
  {
    name: 'a formatter name mentioned in a comment',
    source: `${HEADER}// formatLength(96) would be wrong here\nexport const x = 1;\n`,
  },
  {
    name: 'a formatter name inside a string literal',
    source: `${HEADER}export const x = 'call formatLength(96) carefully';\n`,
  },
  {
    name: 'a nested call whose first argument is a Quantity',
    source: `${HEADER}import { add, inches } from '@rms/kernel-units';\nexport const x = formatLength(add(inches(1), inches(2)));\n`,
  },
];

function writeProbe(source) {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(PROBE, source, 'utf8');
}

/** Removes the whole temp tree, not a probe. Called once, from the `finally`. */
function removeTree() {
  rmSync(TREE, { recursive: true, force: true });
}

function probeViolations() {
  return lintProvenance(TREE).violations.filter((v) => v.includes('display-list/src/probe.ts'));
}

/** Read-only. See the note on TREE: this is the blind spot the temp tree opens. */
function assertRealTreeReachable() {
  const real = lintProvenance();
  if (real.scanned.length === 0) {
    console.error('selftest-provenance: the linter scanned nothing in the REAL repository. The');
    console.error('probes below would still pass against a temp tree while the real scan');
    console.error('matched nothing.');
    return false;
  }
  console.log(`  reachable   real tree: ${real.scanned.length} file(s)`);
  return true;
}

function main() {
  if (!assertRealTreeReachable()) {
    process.exitCode = 1;
    return;
  }

  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(join(PROBE_DIR, 'clean.ts'), 'export const clean = 1;\n', 'utf8');

  const baseline = lintProvenance(TREE);
  if (baseline.violations.length > 0) {
    console.error(
      'selftest-provenance: the tree already has violations, so the self-test\n' +
        'cannot distinguish its own probe from real breakage:',
    );
    for (const v of baseline.violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  if (baseline.scanned.length === 0) {
    console.error('selftest-provenance: the linter scanned nothing. It cannot be trusted.');
    process.exitCode = 1;
    return;
  }

  const missed = [];
  const falsePositives = [];

  try {
    for (const { name, source } of MUST_CATCH) {
      writeProbe(source);
      if (probeViolations().length === 0) missed.push(name);
      else console.log(`  caught      ${name}`);
    }
    for (const { name, source } of MUST_ALLOW) {
      writeProbe(source);
      const hits = probeViolations();
      if (hits.length > 0) falsePositives.push(`${name} -> ${hits[0]}`);
      else console.log(`  allowed     ${name}`);
    }
  } finally {
    removeTree();
  }

  if (missed.length > 0 || falsePositives.length > 0) {
    console.error('\nselftest-provenance: FAIL');
    for (const m of missed) console.error(`  MISSED a real violation: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED correct code: ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `selftest-provenance: PASS — all ${MUST_CATCH.length} violation types caught, ` +
      `all ${MUST_ALLOW.length} legal forms allowed; ${baseline.scanned.length} file(s) scanned clean.`,
  );
}

main();
