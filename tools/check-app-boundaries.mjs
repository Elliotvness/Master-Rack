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
    /**
     * Symbols the client bundle may neither export nor import by name.
     *
     * T-07 moved the submit transaction into `@rms/workflow` because, in the
     * repository's own words, `apps/client-web` is "the bundle a client
     * downloads". Moving it is worth exactly as much as keeping it moved. The
     * import list above cannot express this: `@rms/workflow` is a *legal*
     * dependency of this bundle — the step vocabulary and the refusal type
     * belong on a screen, so it can name which step refused and list every
     * reason (AC-10). What must not cross is the ability to DRIVE the
     * sequence, and that is a symbol-level fact, not a module-level one.
     *
     * `derive` and `strip` are prefixes, and deliberately: `deriveBom`,
     * `deriveInternalRevision` and `stripInternalRevisions` are all server
     * authorities, and a client that can call any of them decides for itself
     * what it is allowed to see.
     */
    forbiddenSymbols: [
      { pattern: /^submit$/, why: 'the submit transaction; the server owns the sequence (D-01, AD-1)' },
      { pattern: /^freeze/, why: 'freezing a revision is a server authority' },
      { pattern: /^derive/, why: 'derivation is a server authority — a client must not re-derive its own answer' },
      { pattern: /^strip/, why: 'deciding what a client may see is a server authority, never the client\'s' },
    ],
  },
];

/** `export { a, b as c }` and `export { a } from '...'`. Captures the clause. */
const EXPORT_CLAUSE_RE = /(?:^|\n)\s*export\s*\{([^}]*)\}/g;
/** `import { a, b as c } from '...'`. Captures the clause. */
const IMPORT_CLAUSE_RE = /(?:^|\n)\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from/g;
/** `export function f`, `export const c`, `export class C`, `export type T`. */
const EXPORT_DECL_RE =
  /(?:^|\n)\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
/**
 * `import * as ns from '...'` — a namespace import.
 *
 * Forbidden outright in a restricted app, and this is the finding that put it
 * here: an adversarial review wrote two lines —
 * `import * as wf from '@rms/workflow'; export const drive = wf.submit;` — and
 * both this checker and `tsc` passed while the client bundle re-exported the
 * submit transaction. A namespace import binds every symbol a module has under
 * one name, so no symbol-level rule can see through it. Name the imports.
 */
const NAMESPACE_IMPORT_RE = /(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;

/** CommonJS, which none of the ES-module regexes above can see. */
const COMMONJS_RE = /(?:^|\n)\s*(?:module\s*\.\s*exports|exports\s*\.[A-Za-z_$])/g;

/**
 * A top-level binding of a forbidden name, exported or not.
 *
 * `const submit = wf.submit; export default submit;` carries no forbidden name
 * across any export clause, and `export default` names no symbol the scan can
 * check. The declaration is the thing that can be seen, so it is the thing
 * that is checked.
 */
const TOP_LEVEL_DECL_RE =
  /(?:^|\n)(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;

/** `export * from '...'` — re-exports names this scan cannot see. */
const EXPORT_STAR_RE = /(?:^|\n)\s*export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*['"]([^'"]+)['"]/g;

/**
 * Every identifier a `{ ... }` clause binds, on both sides of `as`.
 *
 * Both sides, because `export { submit as send }` and `export { send as submit }`
 * are the same leak wearing different names — one ships the function, the other
 * ships the name a caller looks for.
 */
function clauseNames(clause) {
  const names = [];
  for (const part of clause.split(',')) {
    const trimmed = part.trim().replace(/^type\s+/, '');
    if (trimmed === '') continue;
    for (const side of trimmed.split(/\s+as\s+/)) {
      const name = side.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

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
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      // Test files ARE scanned here, unlike the purity checker. A test that
      // imports internal code proves the import is reachable from this
      // package, which is exactly what must not be true.
      out.push(full);
    }
  }
  return out;
}


/**
 * T-28. Every scan is rooted at `root`, which defaults to the repository. The
 * self-test passes a temp tree instead, so it never writes a probe file inside
 * the working copy — on a filesystem that refuses deletion a stranded probe
 * makes the NEXT run fail against the self-test's own leftover fixture, and a
 * false red trains people to re-run until it passes.
 *
 * The rules themselves are module constants, not files, so a temp tree exercises
 * the REAL configuration rather than a simplified copy of it.
 */
export function checkAppBoundaries(root = ROOT) {
  const violations = [];
  const scanned = [];
  const appsChecked = [];

  for (const rule of RULES) {
    const appDir = join(root, 'apps', rule.app, 'src');
    const files = listFiles(appDir);
    if (files.length === 0) continue;
    appsChecked.push(rule.app);

    for (const file of files) {
      const rel = relative(root, file).split(sep).join('/');
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

      for (const { re, verb } of [
        { re: EXPORT_CLAUSE_RE, verb: 'exports' },
        { re: IMPORT_CLAUSE_RE, verb: 'imports' },
      ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(raw)) !== null) {
          for (const name of clauseNames(m[1])) {
            for (const { pattern, why } of rule.forbiddenSymbols ?? []) {
              if (pattern.test(name)) {
                violations.push(
                  `${rel}: ${verb} '${name}' — ${why}. Moving a server authority out of ` +
                    'the client bundle is worth exactly as much as keeping it moved.',
                );
              }
            }
          }
        }
      }

      for (const re of [EXPORT_DECL_RE, TOP_LEVEL_DECL_RE]) {
        re.lastIndex = 0;
        let d;
        while ((d = re.exec(raw)) !== null) {
          for (const { pattern, why } of rule.forbiddenSymbols ?? []) {
            if (pattern.test(d[1])) {
              violations.push(
                `${rel}: binds '${d[1]}' at the top level — ${why}. Moving a server authority ` +
                  'out of the client bundle is worth exactly as much as keeping it moved.',
              );
            }
          }
        }
      }

      NAMESPACE_IMPORT_RE.lastIndex = 0;
      let ns;
      while ((ns = NAMESPACE_IMPORT_RE.exec(raw)) !== null) {
        if ((rule.forbiddenSymbols ?? []).length === 0) break;
        violations.push(
          `${rel}: imports '${ns[2]}' as the namespace '${ns[1]}' — a namespace import binds ` +
            'every symbol a module has under one name, so no symbol-level rule can see through ' +
            'it. Name the imports.',
        );
      }

      COMMONJS_RE.lastIndex = 0;
      if ((rule.forbiddenSymbols ?? []).length > 0 && COMMONJS_RE.exec(raw) !== null) {
        violations.push(
          `${rel}: uses CommonJS 'module.exports' — the export scan reads ES module syntax, so ` +
            'a CommonJS export surface is one it cannot see. Use ES exports.',
        );
      }

      EXPORT_STAR_RE.lastIndex = 0;
      let star;
      while ((star = EXPORT_STAR_RE.exec(raw)) !== null) {
        violations.push(
          `${rel}: re-exports everything from '${star[1]}' with 'export *' — this scan cannot ` +
            'see which names cross, so it cannot tell whether a server authority just did. ' +
            'Name the exports.',
        );
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
