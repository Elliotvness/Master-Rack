#!/usr/bin/env node
/**
 * selftest-lockfile — prove the lockfile checker catches the thing it exists for.
 *
 * The mistake it was written after: a `workspace:*` dependency added to a
 * package.json and never recorded in pnpm-lock.yaml. CI caught it; nothing
 * local could, because pnpm is not available in every environment this
 * repository is worked in.
 *
 * Fixtures rather than the real files, so the cases include a lockfile that is
 * wrong — which the repository's own lockfile, being correct, cannot provide.
 */

import { lockfileViolations, parseImporters, readWorkspace } from './check-lockfile.mjs';

const LOCK_OK = `lockfileVersion: '9.0'

importers:

  .: {}

  apps/api:
    dependencies:
      '@rms/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts
      '@rms/db':
        specifier: workspace:*
        version: link:../../packages/db

  packages/contracts: {}

  packages/db:
    dependencies:
      pg:
        specifier: ^8.13.0
        version: 8.23.0

packages:

  pg@8.23.0: {}
`;

const LOCK_MISSING_DEP = LOCK_OK.replace(
  `      '@rms/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts
`,
  '',
);

const LOCK_MISSING_IMPORTER = LOCK_OK.replace('  packages/contracts: {}\n\n', '');

/** A workspace where apps/api depends on two workspace packages. */
function workspace() {
  const manifests = {
    'apps/api/package.json': {
      name: '@rms/api',
      dependencies: { '@rms/contracts': 'workspace:*', '@rms/db': 'workspace:*', pg: '^8.13.0' },
    },
    'packages/contracts/package.json': { name: '@rms/contracts' },
    'packages/db/package.json': { name: '@rms/db', dependencies: { pg: '^8.13.0' } },
  };
  const readJson = (p) => {
    const key = p.split(/[\\/]/).slice(-3).join('/');
    return manifests[key] ?? null;
  };
  const listDirs = (p) => (p.endsWith('apps') ? ['api'] : ['contracts', 'db']);
  return readWorkspace('', readJson, listDirs);
}

const CASES = [
  {
    name: 'the real mistake: a workspace dep in package.json, absent from the lockfile',
    meaning: 'CI fails on --frozen-lockfile and nothing local said so first',
    lock: LOCK_MISSING_DEP,
    expect: 'FAIL',
    contains: "declares '@rms/contracts'",
  },
  {
    name: 'a new workspace package that is no importer at all',
    meaning: 'a package added and never installed reads as fine',
    lock: LOCK_MISSING_IMPORTER,
    expect: 'FAIL',
    contains: 'appears as no importer',
  },
  {
    name: 'a lockfile that agrees with every manifest',
    meaning: 'a checker that fails on everything is no more use than one that fails on nothing',
    lock: LOCK_OK,
    expect: 'PASS',
  },
];

let failures = 0;
for (const c of CASES) {
  const violations = lockfileViolations(workspace(), parseImporters(c.lock));
  const got = violations.length > 0 ? 'FAIL' : 'PASS';
  const matched =
    c.contains === undefined || violations.some((v) => v.includes(c.contains));
  if (got === c.expect && matched) {
    console.log(`  ok    ${c.name} → ${got}`);
  } else {
    failures += 1;
    console.error(`  MISS  ${c.name}: expected ${c.expect}, got ${got}`);
    console.error(`        if this is wrong: ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
  }
}

// The parser must refuse a lockfile it cannot read, rather than returning an
// empty map — an empty map makes every case pass.
try {
  parseImporters('lockfileVersion: "9.0"\n\npackages:\n  pg@8.23.0: {}\n');
  failures += 1;
  console.error('  MISS  a lockfile with no importers block parsed as empty rather than throwing');
} catch {
  console.log('  ok    a lockfile with no importers block is refused, not read as empty');
}

if (failures > 0) {
  console.error(`\nselftest-lockfile: FAIL — ${failures} case(s) not caught.`);
  process.exitCode = 1;
} else {
  console.log(`\nselftest-lockfile: PASS — ${CASES.length + 1} cases.`);
}
