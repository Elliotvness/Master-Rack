#!/usr/bin/env node
/**
 * selftest-boundaries — prove the boundary checker actually catches things.
 *
 * A checker that silently stopped working reports a clean pass forever, which
 * is worse than having no checker: the build stays green while the invariant
 * rots. So this writes a real violation into a real kernel package, runs the
 * checker, asserts it went red, and removes the file again.
 *
 * Mutation testing, applied to one control. Ported in spirit from
 * rack-studio/tools/selftest-boundaries.mjs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkBoundaries } from './check-boundaries.mjs';

/**
 * T-28. The probe tree lives under `os.tmpdir()`, never inside the repository.
 *
 * It used to be planted at `packages/kernel-units/src/__boundary_probe__/`. On a
 * filesystem that refuses deletion the probe survived the run, and the NEXT
 * invocation of `check-boundaries` failed against the self-test's own leftover
 * fixture. That is a false RED, and a false red is as corrosive as a false
 * green: it trains people to re-run until it passes. It happened twice on
 * 2026-09-01, the second time after a mid-session permission reset, so
 * "remember to enable deletion" was never a control.
 *
 * The checker's rules are module constants rather than files, so a temp tree
 * exercises the REAL configuration and not a simplified copy of it.
 *
 * THE BLIND SPOT THIS INTRODUCES, stated beside the guarantee (house rule):
 * a temp-tree self-test can no longer notice that the checker has lost its grip
 * on the real repository — rename `packages/` and every probe below would still
 * be caught while the real scan quietly matched nothing. `assertRealTreeReachable`
 * closes that, read-only, and is the reason it exists.
 */
const TREE = mkdtempSync(join(tmpdir(), 'rms-selftest-boundaries-'));
const PROBE_DIR = join(TREE, 'packages', 'kernel-units', 'src');
const PROBE = join(PROBE_DIR, 'probe.ts');

/** Each case must be caught. The comment is what failure would mean. */
const CASES = [
  {
    name: 'Node builtin import',
    source: "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
  },
  {
    name: 'bare Node builtin import',
    source: "import fs from 'fs';\nexport const x = fs;\n",
  },
  {
    name: 'framework import',
    source: "import express from 'express';\nexport const x = express;\n",
  },
  {
    name: 'database driver import',
    source: "import { Pool } from 'pg';\nexport const x = Pool;\n",
  },
  {
    name: 'side-effect import of a builtin',
    source: "import 'node:crypto';\nexport const x = 1;\n",
  },
  {
    name: 'clock read via Date.now',
    source: 'export const x = (): number => Date.now();\n',
  },
  {
    name: 'clock read via new Date()',
    source: 'export const x = (): Date => new Date();\n',
  },
  {
    name: 'randomness',
    source: 'export const x = (): number => Math.random();\n',
  },
  {
    name: 'environment read',
    source: 'export const x = process.env.MODE;\n',
  },
  {
    name: 'network read',
    source: "export const x = (): Promise<Response> => fetch('https://example.invalid');\n",
  },
];

function cleanup() {
  rmSync(PROBE, { force: true });
}

/**
 * The probe tree needs at least one clean kernel file, or the baseline below
 * scans nothing and a checker that scans nothing passes everything.
 */
function buildTree() {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(join(PROBE_DIR, 'clean.ts'), 'export const clean = 1;\n', 'utf8');
}

/**
 * Read-only. Runs the checker against the REAL repository and asserts only that
 * it still finds something to scan — the vacuous-pass guard from the checker's
 * own `main()`, asserted here so that moving the probes off the working tree
 * cannot hide a checker that has stopped reaching it. Writes nothing.
 */
function assertRealTreeReachable() {
  const real = checkBoundaries();
  if (real.packages.length === 0 || real.scanned.length === 0) {
    console.error('selftest-boundaries: the checker matched no pure package or no file in the');
    console.error('REAL repository. The probes below would still pass against a temp tree while');
    console.error('the real scan checked nothing.');
    return false;
  }
  console.log(
    `  reachable   real tree: ${real.packages.length} pure package(s), ${real.scanned.length} file(s)`,
  );
  return true;
}

function run() {
  const failures = [];

  if (!assertRealTreeReachable()) return 1;

  // 1. The probe tree must be clean before we start, or the test proves nothing.
  buildTree();
  cleanup();
  const baseline = checkBoundaries(TREE);
  if (baseline.violations.length > 0) {
    console.error('selftest-boundaries: the tree already has violations, so the');
    console.error('self-test cannot distinguish its own probe from real breakage:');
    for (const v of baseline.violations) console.error(`  ${v}`);
    return 1;
  }
  if (baseline.scanned.length === 0) {
    console.error('selftest-boundaries: baseline scan matched no files. A checker that');
    console.error('scans nothing passes everything.');
    return 1;
  }

  // 2. Every probe must be caught.
  for (const testCase of CASES) {
    writeFileSync(PROBE, testCase.source, 'utf8');

    const { violations } = checkBoundaries(TREE);
    cleanup();

    if (violations.length === 0) {
      failures.push(testCase.name);
      console.error(`  NOT CAUGHT  ${testCase.name}`);
    } else {
      console.log(`  caught      ${testCase.name}`);
    }
  }

  // 3. And the probe tree must be clean again afterwards.
  const after = checkBoundaries(TREE);
  if (after.violations.length > 0) {
    console.error('selftest-boundaries: probe file was not removed cleanly.');
    return 1;
  }

  if (failures.length > 0) {
    console.error(
      `\nselftest-boundaries: FAIL — ${failures.length} violation type(s) went undetected.`,
    );
    return 1;
  }

  console.log(
    `selftest-boundaries: PASS — all ${CASES.length} violation types caught; ` +
      `${after.scanned.length} file(s) scanned clean.`,
  );
  return 0;
}

process.exitCode = run();

// The temp tree is removed on the way out. If the platform refuses, that is the
// operating system's problem and not the repository's — which is the whole point
// of it not being in the repository.
rmSync(TREE, { recursive: true, force: true });
