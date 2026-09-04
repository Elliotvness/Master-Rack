#!/usr/bin/env node
/**
 * check-server-owned — the request-body rule, fed real column names.
 *
 * T-13c decides what a client may put in a request body. Its first draft was
 * sixteen names written from memory, and review found three that matched no
 * column in `packages/db/migrations/` while `is_internal` — §7.2's tenant-root
 * privilege bit — was wide open. A list validated against itself is F-02's
 * shape: both exhaustive tests iterated the list under test, so deleting an
 * entry deleted it from both sides of the assertion.
 *
 * So this checker never asks a human which columns are the server's. It asks
 * the DDL, which already says so and cannot be argued with:
 *
 *   - `DEFAULT now()`             a clock. Pure code has none
 *   - `DEFAULT gen_random_uuid()` identity the database mints
 *   - `GENERATED`                 a value the database computes
 *   - a lifecycle or privilege enum type — a state machine's alphabet, and a
 *     body that names a state is a body that skips a transition
 *
 * Every column carrying one of those signals must be refused on a CLIENT
 * request body. The predicate is IMPORTED from the emitted module rather than
 * restated here, so there is no second copy of the rule to drift.
 *
 * The SECOND review of T-13c found this checker had become the very thing it
 * was built to prevent, in three ways, all now closed:
 *
 *   1. Its SQL parser was line-based, case-sensitive and blind to comments and
 *      string literals. Seven legal DDL shapes were skipped SILENTLY, and a
 *      skip is a pass. It now strips comments and string literals with a
 *      scanner, paren-matches table bodies, and splits columns on top-level
 *      commas — and `tools/selftest-server-owned.mjs` feeds it every one of
 *      those seven shapes.
 *   2. `STATEFUL_ENUMS` was a hand-written list cross-checked against nothing,
 *      so deleting three entries dropped `outcome` and `severity` out of the
 *      check with everything green. Every `CREATE TYPE … AS ENUM` in the
 *      migrations must now be classified here, stateful or not; a tenth enum
 *      added next month fails the checker until someone says which it is.
 *   3. It imported a BUILD ARTIFACT and checked only that the file existed. A
 *      stale `dist/` reported PASS for a rule the source no longer had. It now
 *      refuses to judge an artifact older than its source.
 *
 * WHAT IT DOES NOT COVER, so nobody reads a green run as more than it is:
 *   - It signals 15 of the schema's ~129 columns. A server-owned column with
 *     NO DDL signal — `content_hash`, `manifest_uri`, `payload`, `sequence` —
 *     is invisible here; those rest on the `_at`/`_by`/`_hash` suffix rule and
 *     on there being no route that writes them.
 *   - Postgres identifiers are lower snake_case, so this checker can only ever
 *     feed the rule snake_case names. That is why the rule normalises a
 *     declared key before applying itself, and why the camelCase case is
 *     pinned in `request.test.ts` instead — a checker cannot test the one
 *     namespace it has no access to.
 *   - It judges CLIENT bodies. The internal audience differs by exactly
 *     `organization_id` and `role`, recorded in `tasks/todo.md`.
 *   - It reads migrations, not the live database.
 *   - Zero signalled columns is a FAILURE, not a pass; so is a signalled set
 *     that has SHRUNK below the pinned expectation in the self-test.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every enum type the migrations declare, classified. `true` means its values
 * are a state machine's alphabet — lifecycle, privilege, verdict — and a body
 * that names one is skipping a transition. `false` means it is descriptive
 * vocabulary a body may legitimately carry.
 *
 * Exemptions-as-data: `enumClassificationGaps` fails on any declared enum
 * absent from this table, so the list cannot quietly fall behind the schema.
 */
export const ENUM_CLASSIFICATION = Object.freeze({
  'app.actor_type': true,
  'app.idempotency_outcome': true,
  'app.audience': true,
  'app.lifecycle_state': true,
  'app.member_role': true,
  'app.release_status': true,
  'app.request_status': true,
  'app.audit_outcome': true,
  'app.finding_severity': true,
  'app.outbox_status': true,
});

/** SQL with comments and string literals blanked out, newlines preserved. */
export function stripNoise(sql) {
  let out = '';
  let i = 0;
  const keep = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') out += keep(sql[i++]);
      continue;
    }
    if (two === '/*') {
      let depth = 1;
      out += '  ';
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '*/') { depth -= 1; out += '  '; i += 2; continue; }
        if (sql.slice(i, i + 2) === '/*') { depth += 1; out += '  '; i += 2; continue; }
        out += keep(sql[i++]);
      }
      continue;
    }
    if (sql[i] === "'") {
      out += ' ';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += '  '; i += 2; continue; }
        if (sql[i] === "'") { out += ' '; i += 1; break; }
        out += keep(sql[i++]);
      }
      continue;
    }
    if (sql[i] === '$' && /^\$[a-z_]*\$/i.test(sql.slice(i))) {
      const tag = /^\$[a-z_]*\$/i.exec(sql.slice(i))[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      for (; i < stop; i += 1) out += keep(sql[i]);
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/** The paren-matched body of every `CREATE TABLE …( … )`, case-insensitively. */
export function tableBodies(cleanSql) {
  const bodies = [];
  const opener = /create\s+table\s+(?:if\s+not\s+exists\s+)?[\w."]+\s*\(/gi;
  let m;
  while ((m = opener.exec(cleanSql)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < cleanSql.length && depth > 0) {
      if (cleanSql[i] === '(') depth += 1;
      else if (cleanSql[i] === ')') depth -= 1;
      i += 1;
    }
    if (depth === 0) bodies.push(cleanSql.slice(start, i - 1));
    opener.lastIndex = i;
  }
  return bodies;
}

/** A table body split on TOP-LEVEL commas, so `numeric(10,2)` stays one piece. */
export function splitColumns(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
}

const RESERVED = new Set([
  'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'EXCLUDE', 'LIKE', 'DEFERRABLE',
]);

/** `name rest` for one column definition, or null if it is a table constraint. */
export function columnOf(definition) {
  const m = /^(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+([\s\S]+)$/i.exec(definition);
  if (m === null) return null;
  const name = m[1] ?? m[2];
  if (RESERVED.has(name.toUpperCase())) return null;
  return { name, rest: m[3] };
}

/** Every enum type the SQL declares. */
export function declaredEnums(cleanSql) {
  return [...cleanSql.matchAll(/create\s+type\s+([\w.]+)\s+as\s+enum/gi)].map((m) => m[1].toLowerCase());
}

/** Declared enums this file does not classify. Any is a failure. */
export function enumClassificationGaps(cleanSql, classification = ENUM_CLASSIFICATION) {
  return declaredEnums(cleanSql).filter((name) => !Object.hasOwn(classification, name));
}

/**
 * Classified enums the migrations no longer declare. Also a failure: an entry
 * matching nothing is an entry that stopped checking anything, which is
 * `check-claims`' rule applied to this table.
 */
export function enumClassificationDead(cleanSql, classification = ENUM_CLASSIFICATION) {
  const declared = new Set(declaredEnums(cleanSql));
  return Object.keys(classification).filter((name) => !declared.has(name));
}

/**
 * Every column the DDL marks as the server's, as `Map<name, reasons[]>`.
 * Pure; the caller supplies the text and the enum classification.
 */
export function columnSignals(sql, classification = ENUM_CLASSIFICATION) {
  const clean = stripNoise(sql);
  const found = new Map();
  const note = (name, reason) => {
    const reasons = found.get(name) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    found.set(name, reasons);
  };
  const classify = (name, rest) => {
    if (/DEFAULT\s+now\(\)/i.test(rest)) note(name, 'DEFAULT now()');
    if (/DEFAULT\s+gen_random_uuid\(\)/i.test(rest)) note(name, 'DEFAULT gen_random_uuid()');
    if (/\bGENERATED\b/i.test(rest)) note(name, 'GENERATED');
    const enumType = /^(?:"?)([a-z_]+\.[a-z_]+)/i.exec(rest);
    if (enumType !== null && classification[enumType[1].toLowerCase()] === true) {
      note(name, `enum ${enumType[1].toLowerCase()}`);
    }
  };

  for (const body of tableBodies(clean)) {
    for (const definition of splitColumns(body)) {
      const column = columnOf(definition);
      if (column !== null) classify(column.name, column.rest);
    }
  }
  // ADD COLUMN / ALTER COLUMN, one statement at a time so a comma-separated
  // list of several does not collapse into the first.
  for (const m of clean.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+([^,;]+)/gi)) {
    classify(m[1] ?? m[2], m[3]);
  }
  for (const m of clean.matchAll(/alter\s+column\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s+set\s+default\s+([^,;]+)/gi)) {
    classify(m[1] ?? m[2], `DEFAULT ${m[3]}`);
  }
  return found;
}

/** Every signalled column the rule does not refuse. `isRefused` is injected. */
export function uncoveredColumns(signals, isRefused) {
  return [...signals]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([name]) => !isRefused(name))
    .map(([name, reasons]) => ({ name, reasons }));
}

export function readMigrations(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * The rule as a comparable string: its suffixes and its named columns, in
 * order. Read from either the TypeScript source or the emitted JavaScript —
 * both carry the same literals — so the checker can prove the artifact it
 * imported is the rule the source declares.
 *
 * An mtime comparison was the first attempt and was wrong in both directions:
 * `tsc --build` is incremental and skips emit when content has not changed, so
 * a touched source left the checker permanently red. Content is the question;
 * timestamps were a proxy for it.
 */
export function ruleFingerprint(text) {
  // Anchored on the assignment, not the first '[': the TypeScript source
  // carries `: readonly string[]` between the two, and reading that bracket
  // yields an empty list that matches nothing and hides the drift it exists
  // to find.
  const grab = (label) => {
    const m = new RegExp(`${label}[^=;]*=([^;]*);`).exec(text);
    if (m === null) return null;
    return [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]).join(',');
  };
  const suffixes = grab('SERVER_ASSIGNED_SUFFIXES');
  const names = grab('SERVER_ASSIGNED_NAMES');
  if (suffixes === null || names === null) return null;
  return `${suffixes}|${names}`;
}

async function main() {
  const dir = join(ROOT, 'packages/db/migrations');
  if (!existsSync(dir)) fail(`no migrations directory at ${dir}`);

  const source = join(ROOT, 'packages/contracts/src/request.ts');
  const emitted = join(ROOT, 'packages/contracts/dist/request.js');
  if (!existsSync(emitted)) fail('packages/contracts/dist/request.js is missing; run `pnpm typecheck` first');
  const sourceRule = ruleFingerprint(readFileSync(source, 'utf8'));
  const emittedRule = ruleFingerprint(readFileSync(emitted, 'utf8'));
  if (sourceRule === null || emittedRule === null) {
    fail('could not read SERVER_ASSIGNED_SUFFIXES / SERVER_ASSIGNED_NAMES out of the source or the artifact');
  }
  if (sourceRule !== emittedRule) {
    // Judging a stale artifact is judging a rule nobody has any more.
    fail(
      'packages/contracts/dist/request.js declares a different rule than its source; run `pnpm typecheck` first.\n' +
        `  source:   ${sourceRule}\n  artifact: ${emittedRule}`,
    );
  }
  const { isRefusedOnClientBody } = await import(emitted);
  if (typeof isRefusedOnClientBody !== 'function') fail('the emitted module exports no isRefusedOnClientBody');

  const sql = readMigrations(dir);
  const dead = enumClassificationDead(sql);
  if (dead.length > 0) {
    fail(`ENUM_CLASSIFICATION names enum type(s) the migrations do not declare: ${dead.join(', ')}`);
  }
  const gaps = enumClassificationGaps(sql);
  if (gaps.length > 0) {
    fail(
      `these enum types are declared in the migrations and not classified in ENUM_CLASSIFICATION: ${gaps.join(', ')}.\n` +
        '  Say whether each is a state machine (true) or descriptive vocabulary (false).',
    );
  }

  const signals = columnSignals(sql);
  if (signals.size === 0) fail('no column carried a server-assignment signal — the matcher has stopped matching');

  const misses = uncoveredColumns(signals, isRefusedOnClientBody);
  if (misses.length > 0) {
    console.error('check-server-owned: FAIL');
    for (const { name, reasons } of misses) {
      console.error(`  ${name} — the DDL says the server assigns it (${reasons.join(', ')}), the rule accepts it`);
    }
    console.error('  Add it to SERVER_ASSIGNED_NAMES in packages/contracts/src/request.ts, with its reason.');
    process.exit(1);
  }
  console.log(
    `check-server-owned: PASS — ${signals.size} server-assigned column(s), every one refused on a client body; ` +
      `${declaredEnums(stripNoise(sql)).length} enum type(s) classified.`,
  );
}

function fail(message) {
  console.error(`check-server-owned: FAIL\n  ${message}`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1].split(sep).join(sep));
if (invokedDirectly) await main();
