#!/usr/bin/env node
/**
 * selftest-aliases — proves check-aliases catches each disagreement it claims to.
 *
 * Every case builds a temp tree OUTSIDE the working copy and points the checker
 * at it, for the reason T-28 records: a probe file written inside the repository
 * can strand on a filesystem that refuses deletion, and the next run then fails
 * against the self-test's own leftover — a false red that trains people to
 * re-run until it passes.
 *
 * The false-positive halves are here on purpose too. A checker that goes red on
 * a legitimate tree gets silenced within a week, so "the real repository passes"
 * and "a package with an entry in both is fine" are cases, not assumptions.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkAliases } from './check-aliases.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function ok(name) {
  console.log(`  ok     ${name}`);
}
function bad(name, detail) {
  console.error(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
}

/**
 * Build a temp workspace.
 *
 * `paths` and `aliases` are specifier -> relative target maps; `packages` is
 * name -> directory. Writing all three independently is what lets a case make
 * exactly one of them disagree.
 */
function tree({ paths, aliases, packages, targetsExist = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'rms-aliases-'));

  writeFileSync(
    join(dir, 'tsconfig.base.json'),
    JSON.stringify({ compilerOptions: { paths: Object.fromEntries(
      Object.entries(paths).map(([k, v]) => [k, [v]]),
    ) } }, null, 2),
  );

  const body = Object.entries(aliases)
    .map(([k, v]) => `  '${k}': fileURLToPath(\n    new URL('./${v}', import.meta.url),\n  ),`)
    .join('\n');
  writeFileSync(join(dir, 'vitest.alias.ts'), `export const alias = {\n${body}\n};\n`);

  for (const [name, where] of Object.entries(packages)) {
    mkdirSync(join(dir, where), { recursive: true });
    writeFileSync(join(dir, where, 'package.json'), JSON.stringify({ name }));
  }

  if (targetsExist) {
    for (const target of new Set(Object.values(paths))) {
      const full = join(dir, target);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, '// target\n');
    }
  }

  return dir;
}

function run(name, spec, expectProblem) {
  const dir = tree(spec);
  try {
    const { problems } = checkAliases(dir);
    const hit = problems.some((p) => p.includes(expectProblem));
    if (expectProblem === null) {
      if (problems.length === 0) ok(name);
      else bad(name, `expected clean, got: ${problems.join('; ')}`);
    } else if (hit) {
      ok(name);
    } else {
      bad(name, `expected a problem containing ${JSON.stringify(expectProblem)}, got: ${problems.join('; ') || '(none)'}`);
    }
  } catch (error) {
    bad(name, `threw: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = {
  paths: { '@rms/one': 'packages/one/src/index.ts' },
  aliases: { '@rms/one': 'packages/one/src/index.ts' },
  packages: { '@rms/one': 'packages/one' },
};

console.log('selftest-aliases');

// --- the legitimate tree passes -------------------------------------------
run('a tree where all three agree is clean', GOOD, null);

// --- the disagreements ----------------------------------------------------
run(
  'a specifier in tsconfig but not in vitest.alias is caught',
  { ...GOOD, aliases: {} , packages: {} },
  'missing from vitest.alias.ts',
);

run(
  'a specifier in vitest.alias but not in tsconfig is caught',
  {
    paths: { '@rms/one': 'packages/one/src/index.ts' },
    aliases: {
      '@rms/one': 'packages/one/src/index.ts',
      '@rms/two': 'packages/two/src/index.ts',
    },
    packages: { '@rms/one': 'packages/one' },
  },
  'missing from tsconfig.base.json',
);

run(
  'the SAME specifier pointing at two different files is caught',
  {
    paths: { '@rms/one': 'packages/one/src/index.ts' },
    aliases: { '@rms/one': 'packages/one/src/other.ts' },
    packages: { '@rms/one': 'packages/one' },
  },
  'but vitest.alias ->',
);

run(
  'a path entry pointing at a file that does not exist is caught',
  { ...GOOD, targetsExist: false },
  'does not exist on disk',
);

run(
  'a workspace package with no entry at all is caught (the F-44 shape)',
  {
    paths: { '@rms/one': 'packages/one/src/index.ts' },
    aliases: { '@rms/one': 'packages/one/src/index.ts' },
    packages: { '@rms/one': 'packages/one', '@rms/unlisted': 'apps/unlisted' },
  },
  '@rms/unlisted: a workspace package with no tsconfig paths entry',
);

// --- vacuous passes are failures ------------------------------------------
run(
  'an empty tsconfig paths table fails rather than reporting no disagreements',
  { paths: {}, aliases: {}, packages: {} },
  'declares no compilerOptions.paths',
);

// --- the real repository --------------------------------------------------
try {
  const { problems, specifiers } = checkAliases(ROOT);
  if (problems.length === 0 && specifiers.length > 0) {
    ok(`the real repository agrees across all ${specifiers.length} specifiers`);
  } else {
    bad('the real repository', problems.join('; ') || 'no specifiers found');
  }
} catch (error) {
  bad('the real repository', `threw: ${error.message}`);
}

if (failures > 0) {
  console.error(`selftest-aliases FAIL — ${failures} case(s)`);
  process.exitCode = 1;
} else {
  console.log('selftest-aliases PASS — 8 case(s), including two that must NOT go red.');
}
