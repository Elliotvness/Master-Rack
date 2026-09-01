#!/usr/bin/env node
/**
 * check-lockfile — every workspace dependency is recorded in the lockfile.
 *
 * Written after adding `@rms/contracts` to `apps/api`'s dependencies and not
 * regenerating `pnpm-lock.yaml`. CI runs `pnpm install --frozen-lockfile`, so
 * the stale lockfile failed the build — correctly, and one round-trip later
 * than it needed to.
 *
 * The gap was not detection. It was that `pnpm` is not available in every
 * environment this repository is worked in, so the mistake could not be seen
 * locally at all: the first signal was a red CI run. This checker is pure
 * Node and reads both files as text, so it runs anywhere `node` does.
 *
 * It is deliberately NARROW. It does not validate the lockfile, resolve
 * versions, or duplicate what pnpm does — `--frozen-lockfile` remains the
 * authority. It answers one question that is cheap to answer and expensive to
 * get wrong: does every `workspace:*` dependency declared in a package.json
 * have a matching entry under that importer in the lockfile, and does every
 * workspace package appear as an importer at all?
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKSPACE_DIRS = ['packages', 'apps'];

/** Every workspace package: its importer path and its workspace dependencies. */
export function readWorkspace(root, readJson, listDirs) {
  const packages = [];
  for (const group of WORKSPACE_DIRS) {
    for (const name of listDirs(join(root, group))) {
      const manifestPath = join(root, group, name, 'package.json');
      const manifest = readJson(manifestPath);
      if (manifest === null) continue;
      const deps = { ...manifest.dependencies, ...manifest.devDependencies };
      packages.push({
        importer: `${group}/${name}`,
        name: manifest.name ?? `${group}/${name}`,
        workspaceDeps: Object.entries(deps)
          .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
          .map(([dep]) => dep)
          .sort(),
      });
    }
  }
  return packages.sort((a, b) => a.importer.localeCompare(b.importer));
}

/**
 * The importers block of a pnpm lockfile, as a map of importer -> declared deps.
 *
 * Parsed by indentation rather than with a YAML library: the shape is fixed and
 * shallow, and adding a dependency to run one checker is the kind of trade this
 * repository does not make. A parse that cannot find the block says so instead
 * of returning an empty map — a checker that silently sees nothing passes
 * forever.
 */
export function parseImporters(lockfileText) {
  const lines = lockfileText.split('\n');
  const start = lines.findIndex((l) => l === 'importers:');
  if (start === -1) throw new Error("no 'importers:' block found in the lockfile");

  const importers = new Map();
  let current = null;
  let inDeps = false;

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    // A top-level key ends the block.
    if (/^\S/.test(line)) break;

    const importerMatch = /^ {2}(\S.*?):\s*(\{\})?\s*$/.exec(line);
    if (importerMatch?.[1] !== undefined) {
      current = importerMatch[1];
      importers.set(current, new Set());
      inDeps = false;
      continue;
    }
    if (current === null) continue;

    if (/^ {4}(dependencies|devDependencies):\s*$/.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      inDeps = false;
      continue;
    }
    const depMatch = /^ {6}'?([^':]+)'?:\s*$/.exec(line);
    if (inDeps && depMatch?.[1] !== undefined) importers.get(current)?.add(depMatch[1]);
  }
  return importers;
}

/** Every disagreement between the manifests and the lockfile. Empty means none. */
export function lockfileViolations(packages, importers) {
  const violations = [];
  for (const pkg of packages) {
    const recorded = importers.get(pkg.importer);
    if (recorded === undefined) {
      violations.push(
        `${pkg.importer} is a workspace package and appears as no importer in pnpm-lock.yaml. ` +
          'Run `pnpm install` and commit the lockfile.',
      );
      continue;
    }
    for (const dep of pkg.workspaceDeps) {
      if (!recorded.has(dep)) {
        violations.push(
          `${pkg.importer} declares '${dep}' as a workspace dependency and the lockfile does not ` +
            'record it. CI runs `pnpm install --frozen-lockfile` and will fail. Run `pnpm install` ' +
            'and commit the lockfile.',
        );
      }
    }
  }
  return violations;
}

function main() {
  const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  const listDirs = (p) =>
    existsSync(p)
      ? readdirSync(p, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];

  const packages = readWorkspace(ROOT, readJson, listDirs);
  const importers = parseImporters(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8'));
  const violations = lockfileViolations(packages, importers);

  const declared = packages.reduce((n, p) => n + p.workspaceDeps.length, 0);
  console.log(
    `check-lockfile: ${packages.length} workspace package(s), ${declared} workspace dependency ` +
      `declaration(s), ${importers.size} importer(s) in the lockfile.`,
  );

  if (violations.length > 0) {
    console.error('\ncheck-lockfile: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  console.log('check-lockfile: PASS');
}

if (
  import.meta.url === `file://${process.argv[1]?.split(sep).join('/')}` ||
  process.argv[1]?.endsWith('check-lockfile.mjs')
) {
  main();
}
