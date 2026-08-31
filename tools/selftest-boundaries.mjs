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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBoundaries } from './check-boundaries.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE_DIR = join(ROOT, 'packages', 'kernel-units', 'src', '__boundary_probe__');
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
  rmSync(PROBE_DIR, { recursive: true, force: true });
}

function run() {
  const failures = [];

  // 1. The tree must be clean before we start, or the test proves nothing.
  cleanup();
  const baseline = checkBoundaries();
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
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(PROBE, testCase.source, 'utf8');

    const { violations } = checkBoundaries();
    cleanup();

    if (violations.length === 0) {
      failures.push(testCase.name);
      console.error(`  NOT CAUGHT  ${testCase.name}`);
    } else {
      console.log(`  caught      ${testCase.name}`);
    }
  }

  // 3. And the tree must be clean again afterwards.
  const after = checkBoundaries();
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
