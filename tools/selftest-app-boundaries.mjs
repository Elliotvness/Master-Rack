#!/usr/bin/env node
/**
 * selftest-app-boundaries — prove the app boundary checker catches things.
 *
 * Same reasoning as the other two self-tests: a checker that silently stopped
 * working reports a clean pass forever, and the build stays green while the
 * invariant rots. A renamed app directory would do it, and nobody would notice.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkAppBoundaries } from './check-app-boundaries.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROBE_DIR = join(ROOT, 'apps', 'client-web', 'src', '__app_probe__');
const PROBE = join(PROBE_DIR, 'probe.ts');

/** Each must be caught. The name is what a miss would mean in production. */
const MUST_CATCH = [
  {
    name: 'the internal API package',
    source: "import { FORBIDDEN_CLIENT_FIELDS } from '@rms/api';\nexport const x = FORBIDDEN_CLIENT_FIELDS;\n",
  },
  {
    name: 'the database layer',
    source: "import { withTenant } from '@rms/db';\nexport const x = withTenant;\n",
  },
  {
    name: 'the BOM package',
    source: "import { deriveBom } from '@rms/kernel-bom';\nexport const x = deriveBom;\n",
  },
  {
    name: 'a side-effect import of the internal API',
    source: "import '@rms/api';\nexport const x = 1;\n",
  },
  {
    name: 'a DYNAMIC import, which a static type check would miss entirely',
    source: "export async function x() { return import('@rms/api'); }\n",
  },
  {
    name: 'the internal API by relative path',
    source: "import { authorize } from '../../api/src/index.js';\nexport const x = authorize;\n",
  },
];

/** Each must NOT be caught, or the checker becomes noise people route around. */
const MUST_ALLOW = [
  {
    name: 'a pure kernel package',
    source: "import { inches } from '@rms/kernel-units';\nexport const x = inches(1);\n",
  },
  {
    name: 'the display list',
    source: "import { buildPlan } from '@rms/display-list';\nexport const x = buildPlan;\n",
  },
  {
    name: 'the catalog, which a client legitimately reads to offer choices',
    source: "import { BeamCatalog } from '@rms/kernel-catalog';\nexport const x = BeamCatalog;\n",
  },
  {
    name: 'a sibling module inside the client app',
    source: "import { CLIENT_NAMESPACE } from '../lib/api.js';\nexport const x = CLIENT_NAMESPACE;\n",
  },
  {
    name: 'the word api appearing in a comment',
    source: "// do not import @rms/api here\nexport const x = 1;\n",
  },
];

function writeProbe(source) {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(PROBE, source, 'utf8');
}

function probeViolations() {
  return checkAppBoundaries().violations.filter((v) => v.includes('__app_probe__'));
}

function main() {
  const baseline = checkAppBoundaries();
  if (baseline.violations.length > 0) {
    console.error(
      'selftest-app-boundaries: the tree already has violations, so the self-test\n' +
        'cannot distinguish its own probe from real breakage:',
    );
    for (const v of baseline.violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  if (baseline.scanned.length === 0) {
    console.error('selftest-app-boundaries: the checker scanned nothing. It cannot be trusted.');
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
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }

  if (missed.length > 0 || falsePositives.length > 0) {
    console.error('\nselftest-app-boundaries: FAIL');
    for (const m of missed) console.error(`  MISSED a real violation: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED correct code: ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `selftest-app-boundaries: PASS — all ${MUST_CATCH.length} violation types caught, ` +
      `all ${MUST_ALLOW.length} legal imports allowed; ${baseline.scanned.length} file(s) scanned clean.`,
  );
}

main();
