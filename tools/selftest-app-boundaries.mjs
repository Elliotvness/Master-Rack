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

/**
 * Extensions the scan must not skip.
 *
 * `.jsx`, `.cts` and `.cjs` were absent from the file filter, so the same
 * forbidden source in one of them was never read. A rule that depends on a
 * filename is a rule with an escape hatch.
 */
const MUST_SCAN_EXTENSIONS = ['tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

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
  {
    name: 'RE-EXPORTING submit — T-07 moved it; this is moving it back',
    source: "export { submit } from '@rms/workflow';\n",
  },
  {
    name: 'submit re-exported under another name, which is the same leak renamed',
    source: "export { submit as send } from '@rms/workflow';\n",
  },
  {
    name: 'a local name aliased TO submit, which is what a caller looks for',
    source: "const send = 1;\nexport { send as submit };\n",
  },
  {
    name: 'IMPORTING submit, so the bundle can drive the sequence itself',
    source: "import { submit } from '@rms/workflow';\nexport const x = () => submit;\n",
  },
  {
    name: 'declaring a deriveBom of its own — a client re-deriving its own answer',
    source: "export function deriveBom() { return []; }\n",
  },
  {
    name: 'a stripInternalRevisions the client decides for itself',
    source: "export const stripInternalRevisions = (r) => r;\n",
  },
  {
    name: 'freezeRevision, a server authority',
    source: "export async function freezeRevision() { return undefined; }\n",
  },
  {
    name: 'export * — the scan cannot see which names cross',
    source: "export * from '@rms/workflow';\n",
  },
  // Every case below walked past the first version of this rule. An adversarial
  // review wrote them, ran them, and reported PASS on all six.
  {
    name: 'a NAMESPACE import, then re-exporting the member — two lines, both gates green',
    source: "import * as wf from '@rms/workflow';\nexport const drive = wf.submit;\n",
  },
  {
    name: 'a namespace import with the member reached by string index',
    source: "import * as wf from '@rms/workflow';\nexport const go = wf['submit'];\n",
  },
  {
    name: 'a namespace import destructured, so no clause ever names the symbol',
    source: "import * as wf from '@rms/workflow';\nconst { submit: go } = wf;\nexport const drive = go;\n",
  },
  {
    name: 'a local binding named submit, exported as default so no clause names it',
    source: "const submit = () => undefined;\nexport default submit;\n",
  },
  {
    name: 'CommonJS, which none of the ES-module regexes can see',
    source: "module.exports = { submit: 1 };\n",
  },
  {
    name: 'a top-level deriveBom binding that is never exported at all',
    source: "const deriveBom = () => [];\nexport const x = 1;\nvoid deriveBom;\n",
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
  {
    name: 'the step vocabulary and refusal type, which a screen legitimately needs',
    source: "export { SUBMIT_STEPS, SubmitError, stepsInOrder, type SubmitStep } from '@rms/workflow';\n",
  },
  {
    name: 'submitRefusals — a prefix match here would ban the reasons list itself',
    source: "export { submitRefusals } from '@rms/workflow';\n",
  },
  {
    name: 'readyToSubmit and canSubmit, which contain the word and are not it',
    source: "export const readyToSubmit = () => true;\nexport const canSubmit = () => true;\n",
  },
  {
    name: 'the Derivation TYPE, which starts with Deriv and is not derive*',
    source: "export type { Derivation } from '@rms/workflow';\n",
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
    for (const ext of MUST_SCAN_EXTENSIONS) {
      const path = join(PROBE_DIR, `probe.${ext}`);
      mkdirSync(PROBE_DIR, { recursive: true });
      writeFileSync(path, "export { submit } from '@rms/workflow';\n", 'utf8');
      const seen = probeViolations().length > 0;
      rmSync(path, { force: true });
      if (!seen) missed.push(`a forbidden export in a .${ext} file`);
      else console.log(`  scanned     .${ext}`);
    }
    writeProbe('export const x = 1;\n');

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
