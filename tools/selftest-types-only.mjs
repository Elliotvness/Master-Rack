#!/usr/bin/env node
/**
 * selftest-types-only — prove the types-only checker catches the thing it exists for.
 *
 * The thing: a file excluded from coverage as "types only" (F-37) quietly
 * growing a runtime export, and hiding behind the exclusion forever. Fixtures
 * rather than the real files, so the cases include emitted JavaScript that is
 * NOT empty — which the repository's own build, being correct, cannot provide.
 *
 * Runs first, before the checker, like every self-test here: a checker that
 * silently stopped working would otherwise report a clean pass forever.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emittedPathFor, residueOf, typesOnlyViolations } from './check-types-only.mjs';
import { TYPES_ONLY } from './types-only.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const EMPTY = `/**
 * Types only: no runtime, no I/O, no clock, no RNG.
 */
export {};
//# sourceMappingURL=thing.js.map
`;

/** Comments that LOOK like code must not read as statements. */
const EMPTY_WITH_CODE_IN_COMMENTS = `// export const planted = 1;
/* export function derive() { return 1; } */
export {};
//# sourceMappingURL=thing.js.map
`;

const RUNTIME_EXPORT = `/** was types only */
export const planted = 1;
//# sourceMappingURL=thing.js.map
`;

const BARE_STATEMENT = `export {};
console.log('side effect');
`;

function fixture(files) {
  return (rel) => (Object.hasOwn(files, rel) ? files[rel] : null);
}

const SRC = 'packages/thing/src/thing.ts';
const OUT = 'packages/thing/dist/thing.js';

const CASES = [
  {
    name: 'the real mistake: a runtime export added to a file excluded as types-only',
    meaning: 'the file hides behind the exclusion and coverage never measures it',
    files: { [SRC]: 'export const planted = 1;\n', [OUT]: RUNTIME_EXPORT },
    expect: 'FAIL',
    contains: 'no longer types-only',
  },
  {
    name: 'a bare statement with no export',
    meaning: 'a side effect is runtime too, export or not',
    files: { [SRC]: "console.log('x');\n", [OUT]: BARE_STATEMENT },
    expect: 'FAIL',
    contains: 'no longer types-only',
  },
  {
    name: 'a listed source file that no longer exists',
    meaning: 'the exclusion outlives the file and nobody notices the list is stale',
    files: { [OUT]: EMPTY },
    expect: 'FAIL',
    contains: 'does not exist',
  },
  {
    name: 'a listed file that has not been built',
    meaning: 'a checker that inspected nothing must not pass',
    files: { [SRC]: 'export interface A { a: 1 }\n' },
    expect: 'FAIL',
    contains: 'nothing emitted',
  },
  {
    name: 'a path outside packages/*/src or apps/*/src',
    meaning: 'a list entry the checker cannot map to an emitted file must be refused, not skipped',
    list: ['tools/types-only.mjs'],
    files: {},
    expect: 'FAIL',
    contains: 'cannot be checked',
  },
  {
    name: 'an empty list',
    meaning: 'zero files checked reads as zero violations',
    list: [],
    files: {},
    expect: 'FAIL',
    contains: 'list is empty',
  },
  {
    name: 'a genuinely types-only module: comments and `export {};`',
    meaning: 'a checker that fails on everything is no more use than one that fails on nothing',
    files: { [SRC]: 'export interface A { a: 1 }\n', [OUT]: EMPTY },
    expect: 'PASS',
  },
  {
    name: 'code-shaped text inside comments',
    meaning: 'a docstring that mentions `export const` must not read as a statement',
    files: { [SRC]: 'export interface A { a: 1 }\n', [OUT]: EMPTY_WITH_CODE_IN_COMMENTS },
    expect: 'PASS',
  },
];

let failures = 0;
for (const c of CASES) {
  const violations = typesOnlyViolations(c.list ?? [SRC], fixture(c.files));
  const got = violations.length > 0 ? 'FAIL' : 'PASS';
  const matched = c.contains === undefined || violations.some((v) => v.includes(c.contains));
  if (got === c.expect && matched) {
    console.log(`  ok    ${c.name} → ${got}`);
  } else {
    failures += 1;
    console.error(`  MISS  ${c.name}: expected ${c.expect}, got ${got}`);
    console.error(`        if this is wrong: ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
  }
}

// The path mapping is the one piece of arithmetic here; pin it.
if (emittedPathFor('apps/api/src/authz/routes.ts') !== 'apps/api/dist/authz/routes.js') {
  failures += 1;
  console.error('  MISS  emittedPathFor does not map a nested src path to its dist path');
} else {
  console.log('  ok    src → dist mapping holds for a nested path');
}
if (residueOf(EMPTY) !== 'export {};') {
  failures += 1;
  console.error(`  MISS  residueOf(EMPTY) is ${JSON.stringify(residueOf(EMPTY))}, expected 'export {};'`);
} else {
  console.log('  ok    an empty module reduces to exactly `export {};`');
}

// Read-only, against the REAL tree (T-28's blind spot): the fixtures above
// would all pass while the real list pointed at files that do not exist, or
// at a build that never ran. The real list must be non-empty, every entry must
// exist, and the checker must be able to read something for each.
let reachable = TYPES_ONLY.length > 0;
for (const rel of TYPES_ONLY) {
  const src = join(ROOT, ...rel.split('/'));
  if (!existsSync(src)) {
    console.error(`  MISS  real list names ${rel}, which does not exist in this tree`);
    reachable = false;
  }
}
if (reachable) {
  const readText = (rel) => {
    const p = join(ROOT, ...rel.split('/'));
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const real = typesOnlyViolations(TYPES_ONLY, readText);
  const unbuilt = real.filter((v) => v.includes('nothing emitted'));
  console.log(
    `  reachable   real tree: ${String(TYPES_ONLY.length)} listed file(s) exist` +
      (unbuilt.length > 0 ? ` (${String(unbuilt.length)} not yet built — the checker will say so)` : ''),
  );
} else {
  failures += 1;
}

if (failures > 0) {
  console.error(`\nselftest-types-only: FAIL — ${String(failures)} case(s) not caught.`);
  process.exitCode = 1;
} else {
  console.log(`\nselftest-types-only: PASS — ${String(CASES.length + 2)} cases, real list reachable.`);
}
