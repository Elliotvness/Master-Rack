#!/usr/bin/env node
/**
 * check-aliases — the `@rms/*` path table agrees across every consumer.
 *
 * **F-49 is why this file exists.** `vitest.alias.ts` has said, since it was
 * written, that *"it must agree with `paths` in tsconfig.base.json and with the
 * bundler config when apps exist, and tools/check-aliases.mjs asserts that
 * three-way agreement."* `tools/check-aliases.mjs` did not exist. The sentence
 * named a mechanism, the mechanism was never built, and the docstring read as
 * evidence for four sessions — the repository's own recurring defect, committed
 * in the file that describes the invariant.
 *
 * It matters now rather than in the abstract, because S1 adds `@rms/studio-web`
 * and, with `apps/studio-web/vite.config.ts`, creates the bundler leg for the
 * first time. Until this slice the "three-way agreement" had two legs.
 *
 * WHAT IS CHECKED
 *
 *   1. `tsconfig.base.json` `compilerOptions.paths` and `vitest.alias.ts` name
 *      the SAME set of specifiers — neither may hold one the other lacks.
 *   2. Each specifier resolves to the same file on disk from both.
 *   3. Every target file EXISTS. A path entry pointing at a deleted package
 *      resolves to nothing and fails only at the moment someone imports it.
 *   4. Every workspace package under `packages/*` and `apps/*` that publishes an
 *      `@rms/` name HAS an entry in both. This is the arm that catches the
 *      omission rather than the disagreement, and it is the one F-44 taught:
 *      a thing with no rule is scanned by nothing.
 *
 * The bundler leg needs no assertion and deliberately has none:
 * `vite.config.ts` IMPORTS the table from `vitest.alias.ts` rather than
 * restating it, so it cannot drift. A checker that re-verified a value it knows
 * is the same object would be theatre. If a future bundler config restates the
 * table instead of importing it, this checker must gain a third arm — that is
 * recorded here so the omission is a decision rather than a gap.
 *
 * A VACUOUS PASS IS A FAILURE: if either table cannot be parsed, or parses to
 * nothing, this exits 1 rather than reporting that it found no disagreements.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Strip `//` and block comments so JSON.parse can read a tsconfig. */
function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `paths` from tsconfig.base.json, as specifier -> absolute target. */
export function tsconfigPaths(root) {
  const file = join(root, 'tsconfig.base.json');
  const parsed = JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
  const paths = parsed?.compilerOptions?.paths ?? {};
  const out = new Map();
  for (const [specifier, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    out.set(specifier, resolve(root, String(targets[0])));
  }
  return out;
}

/**
 * The table from `vitest.alias.ts`, as specifier -> absolute target.
 *
 * Read as TEXT rather than imported. Importing it would need a TypeScript
 * loader in a checker that must run under plain node — and, more to the point,
 * this checker's job is to compare two hand-written tables, so reading both the
 * same way keeps the comparison honest.
 */
export function vitestAliases(root) {
  const source = readFileSync(join(root, 'vitest.alias.ts'), 'utf8');
  const out = new Map();
  const re = /'(@rms\/[^']+)':\s*fileURLToPath\(\s*\n?\s*new URL\('\.\/([^']+)'/g;
  for (const m of source.matchAll(re)) {
    out.set(m[1], resolve(root, m[2]));
  }
  return out;
}

/** Every workspace directory that declares an `@rms/` package name. */
export function workspacePackages(root) {
  const out = new Map();
  for (const area of ['packages', 'apps']) {
    const dir = join(root, area);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const manifest = join(dir, entry, 'package.json');
      if (!existsSync(manifest) || !statSync(join(dir, entry)).isDirectory()) continue;
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof name === 'string' && name.startsWith('@rms/')) {
        out.set(name, join(dir, entry));
      }
    }
  }
  return out;
}

export function checkAliases(root = ROOT) {
  const problems = [];
  const ts = tsconfigPaths(root);
  const vi = vitestAliases(root);
  const pkgs = workspacePackages(root);

  if (ts.size === 0) problems.push('tsconfig.base.json declares no compilerOptions.paths');
  if (vi.size === 0) problems.push('vitest.alias.ts declares no @rms/* aliases');
  if (pkgs.size === 0) problems.push('no @rms/* workspace package was found');

  const rel = (p) => relative(root, p).split(sep).join('/');

  for (const [specifier, target] of ts) {
    if (!vi.has(specifier)) {
      problems.push(`${specifier}: in tsconfig.base.json paths, missing from vitest.alias.ts`);
    } else if (vi.get(specifier) !== target) {
      problems.push(
        `${specifier}: tsconfig -> ${rel(target)} but vitest.alias -> ${rel(vi.get(specifier))}`,
      );
    }
    if (!existsSync(target)) {
      problems.push(`${specifier}: tsconfig target does not exist on disk (${rel(target)})`);
    }
  }

  for (const specifier of vi.keys()) {
    if (!ts.has(specifier)) {
      problems.push(`${specifier}: in vitest.alias.ts, missing from tsconfig.base.json paths`);
    }
  }

  for (const name of pkgs.keys()) {
    if (!ts.has(name)) problems.push(`${name}: a workspace package with no tsconfig paths entry`);
    if (!vi.has(name)) problems.push(`${name}: a workspace package with no vitest.alias entry`);
  }

  return { problems, specifiers: [...ts.keys()].sort(), packages: [...pkgs.keys()].sort() };
}

function main() {
  let result;
  try {
    result = checkAliases();
  } catch (error) {
    console.error(`check-aliases: FAIL — could not read a table: ${error.message}`);
    process.exit(1);
  }

  const { problems, specifiers, packages } = result;
  if (problems.length > 0) {
    console.error('check-aliases: FAIL');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `check-aliases: PASS — ${specifiers.length} specifier(s) agree across tsconfig.base.json ` +
      `and vitest.alias.ts; ${packages.length} workspace package(s) all present in both. ` +
      'The bundler leg imports the table rather than restating it.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
