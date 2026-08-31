#!/usr/bin/env node
/**
 * check-app-boundaries — the client bundle may not import internal code.
 *
 * The blueprint's reason for two front ends, stated plainly: *"Two bundles is
 * the cheapest structural guarantee that internal DTO types cannot reach a
 * client screen."* That guarantee is worth exactly as much as its enforcement.
 *
 * Without this check the separation is a convention. `apps/client-web` could
 * `import { FORBIDDEN_CLIENT_FIELDS } from '@rms/api'` — which looks harmless,
 * and is how it starts — and from there the internal DTO types, the audit
 * chain, the BOM and the catalog approval gate are all one import away. The
 * bundle would ship with internal code in it even if no screen rendered it,
 * and a source map would hand an attacker the schema.
 *
 * `tools/check-boundaries.mjs` covers kernel purity and scans only `packages/`.
 * This is its counterpart for `apps/`, and the two are kept separate because
 * they enforce different rules for different reasons: purity is about
 * determinism, this is about leakage.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPS_DIR = join(ROOT, 'apps');

/**
 * What each app may NOT import.
 *
 * The client rule is the load-bearing one. The internal app is deliberately
 * unrestricted: it is allowed to see everything, which is the point of it.
 */
const RULES = [
  {
    app: 'client-web',
    forbidden: [
      { pattern: /^@rms\/api$/, why: 'the internal API package, which carries internal DTOs' },
      { pattern: /^@rms\/db$/, why: 'the database layer; a client bundle holds no connection' },
      { pattern: /^@rms\/kernel-bom$/, why: 'the BOM, which a client never sees at any depth' },
      { pattern: /^@rms\/internal/, why: 'an internal-only package' },
      { pattern: /^\.\.\/\.\.\/api\//, why: 'the internal API by relative path' },
      { pattern: /^\.\.\/\.\.\/internal/, why: 'an internal app by relative path' },
      { pattern: /^\.\.\/\.\.\/\.\.\/packages\/db\//, why: 'the database layer by relative path' },
    ],
  },
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

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
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      // Test files ARE scanned here, unlike the purity checker. A test that
      // imports internal code proves the import is reachable from this
      // package, which is exactly what must not be true.
      out.push(full);
    }
  }
  return out;
}

export function checkAppBoundaries() {
  const violations = [];
  const scanned = [];
  const appsChecked = [];

  for (const rule of RULES) {
    const appDir = join(APPS_DIR, rule.app, 'src');
    const files = listFiles(appDir);
    if (files.length === 0) continue;
    appsChecked.push(rule.app);

    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join('/');
      scanned.push(rel);
      const raw = readFileSync(file, 'utf8');

      for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(raw)) !== null) {
          const spec = m[1];
          for (const { pattern, why } of rule.forbidden) {
            if (pattern.test(spec)) {
              violations.push(
                `${rel}: imports '${spec}' — ${why}. The client bundle must not be able ` +
                  'to reach internal code, or the two-application separation is a convention ' +
                  'rather than a guarantee.',
              );
            }
          }
        }
      }
    }
  }

  return { violations, scanned, appsChecked };
}

function main() {
  const { violations, scanned, appsChecked } = checkAppBoundaries();

  // A scan that matches nothing reports success while enforcing nothing.
  if (appsChecked.length === 0 || scanned.length === 0) {
    console.error(
      'check-app-boundaries: matched no application source files. Refusing to report ' +
        'a pass for a scan that checked nothing.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-app-boundaries: scanned ${scanned.length} file(s) across ` +
      `${appsChecked.length} restricted app(s): ${appsChecked.join(', ')}.`,
  );

  if (violations.length > 0) {
    console.error('\ncheck-app-boundaries: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }

  console.log('check-app-boundaries: PASS');
}

if (process.argv[1]?.endsWith('check-app-boundaries.mjs')) {
  main();
}
