#!/usr/bin/env node
/**
 * check-boundaries — no kernel package may reach the outside world.
 *
 * A kernel package is pure: given the same inputs it returns the same outputs,
 * on any machine, at any time. That is what makes a submitted revision
 * regenerable byte-identically two years later. It holds only if the kernel
 * cannot read a clock, a file, a network socket or a random number.
 *
 * This is a source scan, not a type check, because the failure it catches is
 * someone adding `import fs from 'node:fs'` to a kernel file on a Friday. The
 * self-test in selftest-boundaries.mjs writes a real violation and asserts this
 * checker catches it, so a broken checker cannot pass silently.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_DIR = join(ROOT, 'packages');

/** Packages matching this prefix are held to the purity rules. */
const KERNEL_PREFIX = 'kernel-';

/** Additional pure packages that are not named kernel-*. */
const ALSO_PURE = ['display-list'];

const FORBIDDEN_IMPORTS = [
  { pattern: /^node:/, why: 'a Node builtin (I/O, clock or platform access)' },
  { pattern: /^(fs|path|os|crypto|http|https|net|child_process|worker_threads)$/, why: 'a Node builtin' },
  { pattern: /^(express|fastify|koa|next|react|react-dom|vue)$/, why: 'a framework' },
  { pattern: /^(pg|postgres|kysely|drizzle-orm|knex|sqlite3|better-sqlite3)$/, why: 'a database driver' },
  { pattern: /^@rms\/(db|contracts)$/, why: 'a persistence or transport package' },
  { pattern: /^\.\.\/\.\.\/(apps|tools)\//, why: 'an application or tooling package' },
];

const FORBIDDEN_GLOBALS = [
  { pattern: /\bDate\s*\.\s*now\s*\(/, why: 'Date.now() — derivation must be deterministic' },
  { pattern: /\bnew\s+Date\s*\(\s*\)/, why: 'new Date() with no argument — reads the clock' },
  { pattern: /\bMath\s*\.\s*random\s*\(/, why: 'Math.random() — derivation must be reproducible' },
  { pattern: /\bprocess\s*\.\s*env\b/, why: 'process.env — an implicit, unrecorded input' },
  { pattern: /\bfetch\s*\(/, why: 'fetch() — no network reads at calculation time' },
  { pattern: /\brequire\s*\(/, why: 'require() — dynamic loading defeats this scan' },
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(ts|mts|js|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.test\.(ts|mts|js|mjs)$/.test(entry)) {
      // Test files are excluded: purity is a property of SHIPPED kernel code.
      // A test legitimately reads a fixture from disk to check the real data.
      // The self-test proves the checker still catches a violation in non-test
      // source, so this exclusion cannot be used to smuggle I/O into the kernel.
      out.push(full);
    }
  }
  return out;
}

function purePackages() {
  let entries;
  try {
    entries = readdirSync(PACKAGES_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(KERNEL_PREFIX) || ALSO_PURE.includes(name))
    .filter((name) => statSync(join(PACKAGES_DIR, name)).isDirectory());
}

/** Strip comments and string literals so a mention in prose is not a violation. */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

export function checkBoundaries() {
  const violations = [];
  const packages = purePackages();
  const scanned = [];

  for (const pkg of packages) {
    const files = listFiles(join(PACKAGES_DIR, pkg, 'src'));
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join('/');
      scanned.push(rel);
      const raw = readFileSync(file, 'utf8');

      // Imports are read from the raw source: the specifier is a string
      // literal, so stripping strings would remove the thing being checked.
      for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(raw)) !== null) {
          const spec = m[1];
          for (const { pattern, why } of FORBIDDEN_IMPORTS) {
            if (pattern.test(spec)) {
              violations.push(`${rel}: imports '${spec}' — ${why}. Kernel packages are pure.`);
            }
          }
        }
      }

      const code = stripNonCode(raw);
      for (const { pattern, why } of FORBIDDEN_GLOBALS) {
        if (pattern.test(code)) {
          violations.push(`${rel}: uses ${why}.`);
        }
      }
    }
  }

  return { violations, scanned, packages };
}

function main() {
  const { violations, scanned, packages } = checkBoundaries();

  // Guard against a vacuous pass: a glob that matches nothing reports success
  // while checking nothing. Carried from rack-app/tests/test_architecture.py.
  if (packages.length === 0 || scanned.length === 0) {
    console.error(
      'check-boundaries: matched no kernel source files. Refusing to report a pass ' +
        'for a scan that checked nothing.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-boundaries: scanned ${scanned.length} file(s) across ${packages.length} pure package(s).`,
  );

  if (violations.length > 0) {
    console.error('\ncheck-boundaries: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }

  console.log('check-boundaries: PASS');
}

if (import.meta.url === `file://${process.argv[1]?.split(sep).join('/')}` ||
    process.argv[1]?.endsWith('check-boundaries.mjs')) {
  main();
}
