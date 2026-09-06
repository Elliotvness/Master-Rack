#!/usr/bin/env node
/**
 * check-coverage-config — every workspace package is held to a coverage floor.
 *
 * **F-50's open half.** `check-boundaries` now refuses a package classified
 * neither pure nor impure, and `check-aliases` refuses one missing from the path
 * tables. The third list that a new package walked past — the coverage
 * `thresholds` map in `vitest.config.ts` — was left hand-maintained and silent,
 * and the finding said so in as many words: *"nothing forces the next package to
 * have one."* `packages/studio-model` proved the gap was real the moment it got
 * an entry, failing immediately at 97.6% lines and 86.31% branches.
 *
 * A package with no threshold is not unmeasured — it is counted in the global
 * "All files" figure — which is worse than being missing, because the number
 * looks like coverage and is a floor nobody has to clear. `packages/*` is a
 * source directory; if something there is worth shipping it is worth a stated
 * minimum.
 *
 * SCOPE, and why it stops at `packages/`. `apps/` carries floor thresholds by
 * subdirectory rather than one per app — `apps/api/src/auth/**` and the rest —
 * because vitest.config.ts's own comment records why: application code has
 * branches reachable only from a dropped connection or a corrupted row, and
 * chasing those to 100% produces mocks that assert the mock. Requiring one
 * entry per app would flatten that deliberate structure into a rule that does
 * not fit it. This checker therefore asserts what is uniformly true and does
 * not pretend to cover what is not.
 *
 * A VACUOUS PASS IS A FAILURE: finding no packages, or no thresholds, exits 1.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG = 'vitest.config.ts';

/** Package directories under `packages/` that carry a manifest. */
export function packageDirs(root) {
  const dir = join(root, 'packages');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => {
    try {
      return (
        statSync(join(dir, name)).isDirectory() && statSync(join(dir, name, 'package.json')).isFile()
      );
    } catch {
      return false;
    }
  });
}

/**
 * The `packages/<name>/src/**` keys present in the thresholds map.
 *
 * Read as text rather than by importing the config: the config imports
 * TypeScript, and a checker that has to build the project before it can judge it
 * is a checker that stops running the first time the build breaks.
 */
export function thresholdedPackages(root) {
  const source = readFileSync(join(root, CONFIG), 'utf8');
  const out = new Set();
  for (const m of source.matchAll(/'packages\/([^/']+)\/src\/\*\*'\s*:/g)) out.add(m[1]);
  return out;
}

export function checkCoverageConfig(root = ROOT) {
  const problems = [];
  const dirs = packageDirs(root);
  const thresholded = thresholdedPackages(root);

  if (dirs.length === 0) problems.push('no package found under packages/');
  if (thresholded.size === 0) {
    problems.push(`${CONFIG} declares no per-package coverage thresholds`);
  }

  for (const name of dirs) {
    if (!thresholded.has(name)) {
      problems.push(
        `packages/${name} has no coverage threshold in ${CONFIG}. It is still counted in the ` +
          'global figure, so it looks measured while being held to no floor. Add ' +
          `'packages/${name}/src/**' with the minimum it must clear.`,
      );
    }
  }

  for (const name of thresholded) {
    if (!dirs.includes(name)) {
      problems.push(
        `${CONFIG} sets a threshold for packages/${name}, which does not exist. A threshold on ` +
          'nothing passes forever.',
      );
    }
  }

  return { problems, packages: dirs.length, thresholded: thresholded.size };
}

function main() {
  let result;
  try {
    result = checkCoverageConfig();
  } catch (error) {
    console.error(`check-coverage-config: FAIL — ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.problems.length > 0) {
    console.error('check-coverage-config: FAIL');
    for (const p of result.problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-coverage-config: PASS — all ${result.packages} package(s) under packages/ carry a ` +
      'coverage threshold, and every threshold names a package that exists.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
