#!/usr/bin/env node
/**
 * selftest-app-boundaries — prove the app boundary checker catches things.
 *
 * Same reasoning as the other two self-tests: a checker that silently stopped
 * working reports a clean pass forever, and the build stays green while the
 * invariant rots. A renamed app directory would do it, and nobody would notice.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkAppBoundaries } from './check-app-boundaries.mjs';

/**
 * T-28. The probe tree lives under `os.tmpdir()`, never inside the repository:
 * on a filesystem that refuses deletion the probe survived and the NEXT run of
 * the checker failed against this self-test's own leftover fixture. A false red
 * is as corrosive as a false green.
 *
 * The checker's rules are module constants, not files, so the temp tree exercises
 * the REAL configuration. The blind spot that introduces — a checker that has
 * lost its grip on the real repository would still pass every probe below — is
 * closed, read-only, by `assertRealTreeReachable`.
 */
const TREE = mkdtempSync(join(tmpdir(), 'rms-selftest-app-boundaries-'));
const PROBE_DIR = join(TREE, 'apps', 'client-web', 'src');
const PROBE = join(PROBE_DIR, 'probe.ts');
/** F-36 gave `internal-web` a symbol rule, so it needs its own probe. */
const INTERNAL_PROBE_DIR = join(TREE, 'apps', 'internal-web', 'src');
const INTERNAL_PROBE = join(INTERNAL_PROBE_DIR, 'probe.ts');

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

/**
 * F-36 — the same four authorities, in the OTHER front-end bundle.
 *
 * Checkpoint A asks that no orchestration remain in EITHER front-end package.
 * Until F-36 the mechanism covered one, and `apps/internal-web` was clean only
 * because T-08 had moved the three authorities out by hand.
 */
const MUST_CATCH_INTERNAL = [
  {
    name: 'deriveInternalRevision coming back to the app T-08 removed it from',
    source: 'export function deriveInternalRevision() { return undefined; }\n',
  },
  {
    name: 'importing stripInternalRevisions so the screen decides the audience',
    source: "import { stripInternalRevisions } from '@rms/workflow';\nexport const x = stripInternalRevisions;\n",
  },
  {
    name: 'submit, so a reviewer screen can drive the sequence',
    source: "export { submit } from '@rms/workflow';\n",
  },
  {
    name: 'a freeze* authority declared locally',
    source: 'const freezeRevision = () => undefined;\nvoid freezeRevision;\n',
  },
];

/**
 * Each must NOT be caught — and these are the point of the rule's shape.
 *
 * The internal app's import list is empty ON PURPOSE: a reviewer may see the
 * database layer, the BOM and the internal API. VISIBILITY and AUTHORITY are
 * different axes, and if a later edit "tidies" the internal rule by copying the
 * client's import list, these three go red and say so.
 */
const MUST_ALLOW_INTERNAL = [
  {
    name: 'the database layer, which an internal tool legitimately reaches',
    source: "import { whereUsed } from '@rms/db';\nexport const x = whereUsed;\n",
  },
  {
    name: 'the BOM, which an internal reviewer must see and a client never may',
    source: "import { bomFor } from '@rms/kernel-bom';\nexport const x = bomFor;\n",
  },
  {
    name: 'the internal API package and its internal DTOs',
    source: "import { InternalRevisionDto } from '@rms/api';\nexport const x = InternalRevisionDto;\n",
  },
  {
    name: 'submittedAt, a field name that merely starts with the forbidden word',
    source: 'export const submittedAt = new Date().toISOString();\n',
  },
];

function writeProbe(source) {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(PROBE, source, 'utf8');
}

function probeViolations() {
  return checkAppBoundaries(TREE).violations.filter((v) =>
    v.includes('client-web/src/probe.'),
  );
}

function writeInternalProbe(source) {
  mkdirSync(INTERNAL_PROBE_DIR, { recursive: true });
  writeFileSync(INTERNAL_PROBE, source, 'utf8');
}

function internalProbeViolations() {
  return checkAppBoundaries(TREE).violations.filter((v) =>
    v.includes('internal-web/src/probe.'),
  );
}

/** Read-only. See the note on TREE: this is the blind spot the temp tree opens. */
function assertRealTreeReachable() {
  const real = checkAppBoundaries();
  if (real.scanned.length === 0) {
    console.error('selftest-app-boundaries: the checker scanned nothing in the REAL repository.');
    console.error('The probes below would still pass against a temp tree while the real scan');
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

  writeProbe('export const x = 1;\n');
  const baseline = checkAppBoundaries(TREE);
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

    // F-36 — the second front-end bundle.
    writeProbe('export const x = 1;\n');
    writeInternalProbe('export const x = 1;\n');
    if (internalProbeViolations().length > 0) {
      missed.push('the internal-web baseline probe is not clean, so its cases prove nothing');
    }
    for (const { name, source } of MUST_CATCH_INTERNAL) {
      writeInternalProbe(source);
      if (internalProbeViolations().length === 0) missed.push(`[internal-web] ${name}`);
      else console.log(`  caught      [internal-web] ${name}`);
    }
    for (const { name, source } of MUST_ALLOW_INTERNAL) {
      writeInternalProbe(source);
      const hits = internalProbeViolations();
      if (hits.length > 0) falsePositives.push(`[internal-web] ${name} -> ${hits[0]}`);
      else console.log(`  allowed     [internal-web] ${name}`);
    }
  } finally {
    rmSync(TREE, { recursive: true, force: true });
  }

  if (missed.length > 0 || falsePositives.length > 0) {
    console.error('\nselftest-app-boundaries: FAIL');
    for (const m of missed) console.error(`  MISSED a real violation: ${m}`);
    for (const f of falsePositives) console.error(`  FLAGGED correct code: ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `selftest-app-boundaries: PASS — all ${MUST_CATCH.length + MUST_CATCH_INTERNAL.length} ` +
      `violation types caught (${MUST_CATCH_INTERNAL.length} of them internal-web), all ` +
      `${MUST_ALLOW.length + MUST_ALLOW_INTERNAL.length} legal forms allowed; ` +
      `${baseline.scanned.length} file(s) scanned clean.`,
  );
}

main();
