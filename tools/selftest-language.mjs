#!/usr/bin/env node
/**
 * selftest-language — prove the language checker catches things.
 *
 * Same reasoning as the other self-tests, with one addition specific to this
 * checker: it deliberately IGNORES comments, so a bug that made it ignore
 * everything would look identical to a clean pass. The literal-extraction cases
 * below are what distinguish "found nothing" from "looked nowhere".
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkLanguage, stringLiterals } from './check-language.mjs';

/**
 * T-28. Both probe trees live under `os.tmpdir()`, never inside the repository:
 * on a filesystem that refuses deletion the probe survived and the NEXT run of
 * the checker failed against this self-test's own leftover fixture. A false red
 * is as corrosive as a false green.
 *
 * This self-test needs no separate reachability assertion, unlike the other
 * three: its `baseline` below is already run against the REAL repository, both
 * to prove the tree is clean and to prove `status.ts` is being listed at all.
 * Only the probes moved.
 *
 * `DENYLIST_FILES` is keyed on a repository-relative path, so the exemption is
 * reproduced exactly in the temp tree — the lib probe below is checked against
 * the REAL rule, not a simplified copy of it.
 */
const TREE = mkdtempSync(join(tmpdir(), 'rms-selftest-language-'));
const PROBE_DIR = join(TREE, 'packages', 'kernel-units', 'src');
const PROBE = join(PROBE_DIR, 'probe.ts');

/**
 * A SECOND probe, deliberately inside a `lib/` directory beside the one exempt
 * file.
 *
 * The first version of this self-test only probed outside `lib/`, and a gate
 * proof caught the consequence: widening the exemption from one exact path to
 * `rel.includes('/lib/')` silenced the checker across the whole client library
 * and every test still passed. An exemption is a hole, and a hole is only safe
 * if its exact width is asserted — so the probe now sits where a widened
 * exemption would swallow it.
 */
const LIB_PROBE_DIR = join(TREE, 'apps', 'client-web', 'src', 'lib');
const LIB_PROBE = join(LIB_PROBE_DIR, 'probe.ts');

/** Each must be caught. The name is what a miss would mean in front of a client. */
const MUST_CATCH = [
  {
    name: 'the word tamper-proof in a UI string',
    source: "export const label = 'Your submission is tamper-proof.';\n",
  },
  {
    name: 'tamper proof without the hyphen',
    source: "export const label = 'A tamper proof audit record.';\n",
  },
  {
    name: 'TamperProof in different case',
    source: "export const label = 'TamperProof storage';\n",
  },
  {
    name: 'the claim inside a template literal',
    source: 'export const label = `This record is tamper-proof, always`;\n',
  },
  {
    name: 'unhackable',
    source: "export const label = 'Our unhackable vault';\n",
  },
  {
    name: '100% secure',
    source: "export const label = 'Data is 100% secure here';\n",
  },
  {
    name: 'stamped engineering review, outside the scope fence',
    source: "export const label = 'Your stamped engineering review is ready';\n",
  },
  {
    name: 'certified drawing, which OD-16 forbids',
    source: "export const label = 'Download your certified drawing';\n",
  },
];

/** Each must NOT be caught, or the checker becomes noise people route around. */
const MUST_ALLOW = [
  {
    name: 'the correct phrasing',
    source:
      "export const label = 'Tamper-evident, externally timestamped and independently re-verifiable.';\n",
  },
  {
    name: 'the forbidden phrase in a line comment explaining the rule',
    source: "// never say tamper-proof here\nexport const label = 'Tamper-evident record';\n",
  },
  {
    name: 'the forbidden phrase in a block comment',
    source: "/* tamper-proof is the claim we do not make */\nexport const label = 'Verified';\n",
  },
  {
    name: 'an identifier that contains the words',
    source: 'export const tamperProofClaimIsForbidden = true;\n',
  },
  {
    name: 'ordinary product copy',
    source: "export const label = 'Preliminary layout, not for construction.';\n",
  },
];

function writeProbe(source) {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(PROBE, source, 'utf8');
}

function probeViolations() {
  return checkLanguage(TREE).violations.filter((v) =>
    v.includes('kernel-units/src/probe.ts'),
  );
}

/**
 * The extractor must actually find literals. Without this, a checker that
 * returned [] for every file would pass every MUST_ALLOW case and report a
 * confident, permanent green.
 */
function extractorWorks() {
  const problems = [];

  const found = stringLiterals("const a = 'hello'; const b = `world`;");
  if (!found.some((f) => f.value === 'hello') || !found.some((f) => f.value === 'world')) {
    problems.push('stringLiterals did not find plain string and template contents');
  }

  const commented = stringLiterals("// 'in a comment'\nconst a = 'real';");
  if (commented.some((f) => f.value === 'in a comment')) {
    problems.push('stringLiterals returned the contents of a line comment');
  }
  if (!commented.some((f) => f.value === 'real')) {
    problems.push('stringLiterals missed a literal that followed a comment');
  }

  const escaped = stringLiterals("const a = 'it\\'s fine';");
  if (!escaped.some((f) => f.value.includes("it's fine"))) {
    problems.push('stringLiterals mishandled an escaped quote');
  }

  const lines = stringLiterals("\n\nconst a = 'third line';");
  if (lines[0]?.line !== 3) {
    problems.push(`stringLiterals reported line ${lines[0]?.line}, expected 3`);
  }

  return problems;
}

function main() {
  const extractorProblems = extractorWorks();
  for (const p of extractorProblems) console.error(`  EXTRACTOR: ${p}`);
  if (extractorProblems.length === 0) {
    console.log('  verified    the literal extractor finds strings and skips comments');
  }

  const baseline = checkLanguage();
  if (baseline.violations.length > 0) {
    console.error('selftest-language: the tree already has violations:');
    for (const v of baseline.violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  if (baseline.scanned.length === 0) {
    console.error('selftest-language: the checker scanned nothing. It cannot be trusted.');
    process.exitCode = 1;
    return;
  }

  /**
   * The denylist exemption is a hole by construction. Prove it is exactly as
   * wide as intended: status.ts stays exempt, but the file next to it does not.
   * Without this, someone could park an overclaiming string in an exempt file
   * forever and the checker would keep reporting a clean pass.
   */
  const exemptionProblems = [];
  const scannedSet = new Set(baseline.scanned);
  if (!scannedSet.has('apps/client-web/src/lib/status.ts')) {
    exemptionProblems.push('status.ts is not even being listed, so the exemption is untested');
  }
  try {
    // A file that is NOT exempt, elsewhere in the tree, must still be caught.
    writeProbe("export const label = 'This record is tamper-proof.';\n");
    if (probeViolations().length === 0) {
      exemptionProblems.push('a violation outside the exempt file was not caught');
    } else {
      console.log('  verified    the exemption does not leak to other packages');
    }

    // Removed before the next case. The two filters are now distinct paths
    // rather than a shared directory name, so this is belt and braces — but the
    // mistake it guards against was made here first (a filter meant for one
    // probe satisfied by the other, reporting a pass the lib probe never
    // earned), and a gate proof caught it. Keeping the order costs nothing.
    rmSync(PROBE, { force: true });

    // And a file INSIDE the exempt file's own directory must still be caught.
    // This is the case that matters: the exemption is one exact path, and
    // anything looser silences a whole directory.
    mkdirSync(LIB_PROBE_DIR, { recursive: true });
    writeFileSync(LIB_PROBE, "export const label = 'A tamper-proof audit trail.';\n", 'utf8');
    const libHits = checkLanguage(TREE).violations.filter((v) =>
      v.includes('client-web/src/lib/probe.ts'),
    );
    if (libHits.length === 0) {
      exemptionProblems.push(
        'a violation INSIDE lib/, beside the exempt file, was not caught — the ' +
          'exemption is wider than one path',
      );
    } else {
      console.log('  verified    the exemption is one exact path, not the whole lib directory');
    }
  } finally {
    rmSync(PROBE, { force: true });
    rmSync(LIB_PROBE, { force: true });
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
    rmSync(TREE, { recursive: true, force: true });
  }

  if (
    missed.length > 0 ||
    falsePositives.length > 0 ||
    extractorProblems.length > 0 ||
    exemptionProblems.length > 0
  ) {
    console.error('\nselftest-language: FAIL');
    for (const m of missed) console.error(`  MISSED an overclaiming string: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED honest copy: ${f}`);
    for (const e of exemptionProblems) console.error(`  EXEMPTION: ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `selftest-language: PASS — all ${MUST_CATCH.length} overclaims caught, ` +
      `all ${MUST_ALLOW.length} honest forms allowed; ${baseline.scanned.length} file(s) clean.`,
  );
}

main();
