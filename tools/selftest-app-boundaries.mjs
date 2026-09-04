#!/usr/bin/env node
/**
 * selftest-app-boundaries — prove the app boundary checker catches things.
 *
 * Same reasoning as the other two self-tests: a checker that silently stopped
 * working reports a clean pass forever, and the build stays green while the
 * invariant rots. A renamed app directory would do it, and nobody would notice.
 */

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * `apps/api` (F-39). Two probes, because the api rule is the first one with an
 * EXEMPTION and an exemption is exactly the kind of thing that quietly widens:
 * one probe outside the owning directory that must be caught, one inside it
 * that must be allowed, and one that proves the exemption is a path rule and
 * not a whole-app opt-out.
 */
const API_PROBE_DIR = join(TREE, 'apps', 'api', 'src', 'routes');
const API_PROBE = join(API_PROBE_DIR, 'probe.ts');
const API_OWNED_DIR = join(TREE, 'apps', 'api', 'src', 'idempotency');
const API_OWNED_PROBE = join(API_OWNED_DIR, 'probe.ts');

function writeApiProbe(source) {
  mkdirSync(API_PROBE_DIR, { recursive: true });
  writeFileSync(API_PROBE, source, 'utf8');
}

function apiProbeViolations() {
  return checkAppBoundaries(TREE).violations.filter((v) => v.includes('api/src/routes/probe.'));
}

function writeApiOwnedProbe(source) {
  mkdirSync(API_OWNED_DIR, { recursive: true });
  writeFileSync(API_OWNED_PROBE, source, 'utf8');
}

function apiOwnedProbeViolations() {
  return checkAppBoundaries(TREE).violations.filter((v) => v.includes('api/src/idempotency/probe.'));
}

const MUST_CATCH_API = [
  {
    name: 'a route module importing claimOn by relative path (the T-14 shape review demonstrated)',
    source: "import { claimOn } from '../idempotency/idempotency.js';\nexport const x = claimOn;\n",
  },
  {
    name: 'a route module importing settleOn',
    source: "import { settleOn } from '../idempotency/idempotency.js';\nexport const y = settleOn;\n",
  },
  {
    name: 're-exporting claimOn, which is how it reaches a handler without an import line',
    source: "export { claimOn } from '../idempotency/idempotency.js';\n",
  },
];

const MUST_ALLOW_API = [
  {
    name: 'the transaction-owning entry point, which is the whole point of the rule',
    source:
      "import { claimIdempotencyKey } from '../idempotency/idempotency.js';\nexport const x = claimIdempotencyKey;\n",
  },
  {
    name: 'a name that merely contains the forbidden one',
    source: 'export function reclaimOnce() { return 1; }\n',
  },
];

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

  // Every rule must match something, and every exemption must match something,
  // or the checker now fails — so the baseline tree carries all three apps and
  // the exempt directory. That is the point of those two rules, not an
  // inconvenience around them.
  writeProbe('export const x = 1;\n');
  writeInternalProbe('export const x = 1;\n');
  writeApiProbe('export const x = 1;\n');
  writeApiOwnedProbe('export const x = 1;\n');
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

    // F-39 — the api authority rule and its exemption.
    writeInternalProbe('export const x = 1;\n');
    writeApiProbe('export const x = 1;\n');
    if (apiProbeViolations().length > 0) {
      missed.push('the api baseline probe is not clean, so its cases prove nothing');
    }
    for (const { name, source } of MUST_CATCH_API) {
      writeApiProbe(source);
      if (apiProbeViolations().length === 0) missed.push(`[api] ${name}`);
      else console.log(`  caught      [api] ${name}`);
    }
    for (const { name, source } of MUST_ALLOW_API) {
      writeApiProbe(source);
      const hits = apiProbeViolations();
      if (hits.length > 0) falsePositives.push(`[api] ${name} -> ${hits[0]}`);
      else console.log(`  allowed     [api] ${name}`);
    }
    writeApiProbe('export const x = 1;\n');

    // The exemption is a PATH rule: the same source that is caught above must
    // be allowed inside the directory that owns these functions, and nowhere
    // else. An exemption that turned out to cover the whole app would pass
    // every case above and be worthless.
    writeApiOwnedProbe("export { claimOn, settleOn } from './idempotency.js';\n");
    if (apiOwnedProbeViolations().length > 0) {
      falsePositives.push('[api] the owning module may name claimOn/settleOn');
    } else {
      console.log('  allowed     [api] the owning directory, which defines them');
    }
    writeApiProbe("export { claimOn } from '../idempotency/idempotency.js';\n");
    if (apiProbeViolations().length === 0) {
      missed.push('[api] the exemption covers the whole app, not just the owning directory');
    } else {
      console.log('  caught      [api] a sibling directory is still refused while the owner is exempt');
    }
    writeApiProbe('export const x = 1;\n');

    // A RULE THAT MATCHES NOTHING. Renaming an app's src directory used to
    // leave the other rules checked, a non-zero app count, and a green build
    // over a rule that had silently stopped applying.
    {
      const moved = join(TREE, 'apps', 'api', 'src-renamed');
      renameSync(join(TREE, 'apps', 'api', 'src'), moved);
      // Matched on the MESSAGE, not on the app prefix. `api:` also prefixes
      // the stale-exemption violation, and a vanished src directory produces
      // both — so a prefix match went green through the neighbouring control
      // while this one was neutered. Found by neutering it, which is the whole
      // point of doing that.
      const hits = checkAppBoundaries(TREE).violations.filter((v) =>
        v.includes('no application source files'),
      );
      renameSync(moved, join(TREE, 'apps', 'api', 'src'));
      if (hits.length === 0) missed.push('[api] a rule whose app directory has vanished');
      else console.log('  caught      [api] a rule whose app directory has vanished');
    }

    // A STALE EXEMPTION. The exempt path is data with a justification; when the
    // thing it names is gone, the justification is honouring nothing.
    {
      const owned = join(TREE, 'apps', 'api', 'src', 'idempotency');
      const stashed = join(TREE, 'apps', 'api', 'src-idempotency-stashed');
      renameSync(owned, stashed);
      const hits = checkAppBoundaries(TREE).violations.filter((v) => v.includes('matched no scanned file'));
      renameSync(stashed, owned);
      if (hits.length === 0) missed.push('[api] an exemption naming a path that no longer exists');
      else console.log('  caught      [api] an exemption naming a path that no longer exists');
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
    `selftest-app-boundaries: PASS — all ${MUST_CATCH.length + MUST_CATCH_INTERNAL.length + MUST_CATCH_API.length} ` +
      `violation types caught (${MUST_CATCH_INTERNAL.length} internal-web, ${MUST_CATCH_API.length} api), all ` +
      `${MUST_ALLOW.length + MUST_ALLOW_INTERNAL.length + MUST_ALLOW_API.length} legal forms allowed; ` +
      `${baseline.scanned.length} file(s) scanned clean.`,
  );
}

main();
