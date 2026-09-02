#!/usr/bin/env node
/**
 * check-types-only — every module excluded from coverage as "types only" still is.
 *
 * `vitest.config.ts` excludes the paths in `tools/types-only.mjs` from the
 * coverage report because they hold interfaces and nothing else (F-37). An
 * exclusion is a promise about a file, and files change. This checker re-reads
 * the promise on every run: for each listed source file, the JavaScript that
 * `tsc --build` emitted for it must contain no statement at all — comments and
 * the `export {};` marker TypeScript writes for an empty ES module, nothing
 * more. A runtime export added to one of those files turns this red, and the
 * remedy is to remove the path from the list so coverage measures it again.
 *
 * Reads the EMITTED file, not the source, deliberately: `export type` and
 * `export interface` are erased by the compiler, so "what survives emit" is the
 * exact question "is there anything here a test could execute" — answered by
 * the compiler, not by a regex over TypeScript syntax.
 *
 * WHAT IT DOES NOT COVER, so nobody reads a green run as more than it is:
 *   - It checks the paths in the list and nothing else. A types-only file that
 *     is NOT listed is simply measured by coverage, which is the safe direction.
 *   - It needs the build to have run. A missing emitted file is a FAILURE here,
 *     not a skip — a checker that inspected nothing must not pass.
 *   - Comment stripping is a small hand-rolled pass, not a parser. It is enough
 *     because the only legal residue is `export {};`; any string literal, any
 *     expression, anything a parser would call a statement leaves residue and
 *     fails, including the cases where the stripper is confused by it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TYPES_ONLY } from './types-only.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** `packages/x/src/y.ts` → `packages/x/dist/y.js`. Returns null for a path outside that shape. */
export function emittedPathFor(sourcePath) {
  const m = /^((?:packages|apps)\/[^/]+)\/src\/(.+)\.ts$/.exec(sourcePath);
  if (m === null) return null;
  return `${m[1]}/dist/${m[2]}.js`;
}

/**
 * What remains of an emitted module once comments, the source-map directive
 * and whitespace are gone. For a types-only module the answer is `export {};`
 * or nothing.
 */
export function residueOf(jsText) {
  return jsText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMPTY_MODULE = new Set(['', 'export {};', 'export { };']);

/**
 * Every listed file that is not what the list says it is. Readers are injected
 * so the self-test can feed fixtures; `readText` returns null for a missing file.
 */
export function typesOnlyViolations(files, readText) {
  const violations = [];
  if (files.length === 0) {
    violations.push('the types-only list is empty — a checker that checks nothing passes everything');
    return violations;
  }
  for (const source of files) {
    const emitted = emittedPathFor(source);
    if (emitted === null) {
      violations.push(`${source}: not a packages/*/src or apps/*/src TypeScript file; the exclusion cannot be checked`);
      continue;
    }
    if (readText(source) === null) {
      violations.push(`${source}: listed as types-only but the file does not exist — the exclusion outlived the file`);
      continue;
    }
    const js = readText(emitted);
    if (js === null) {
      violations.push(`${source}: nothing emitted at ${emitted} — run \`pnpm typecheck\` (tsc --build) first; refusing to pass a check that inspected nothing`);
      continue;
    }
    const residue = residueOf(js);
    if (!EMPTY_MODULE.has(residue)) {
      const first = residue.split(';')[0]?.trim() ?? residue;
      violations.push(
        `${source}: is no longer types-only — ${emitted} contains \`${first.slice(0, 80)}\`. ` +
          'Remove the path from tools/types-only.mjs so coverage measures it again.',
      );
    }
  }
  return violations;
}

function main() {
  const readText = (rel) => {
    const p = join(ROOT, ...rel.split('/'));
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const violations = typesOnlyViolations(TYPES_ONLY, readText);
  if (violations.length > 0) {
    console.error('check-types-only: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-types-only: PASS — ${String(TYPES_ONLY.length)} types-only module(s) still compile to an empty module.`,
  );
}

if (process.argv[1]?.split(sep).join('/').endsWith('check-types-only.mjs')) main();
