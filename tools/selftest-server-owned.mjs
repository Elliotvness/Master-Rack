#!/usr/bin/env node
/**
 * selftest-server-owned — prove the checker catches the thing it exists for.
 *
 * The thing: a column the database itself assigns becoming declarable on a
 * client request body, because the hand-written rule in `request.ts` was never
 * fed a real column name.
 *
 * The SECOND review of T-13c aimed itself here and was right to. The first
 * version of this file asserted only floors — `real.size > 0`, "at least one
 * clock", "at least one enum" — so a parser regression that lost half the
 * migrations passed the self-test AND the checker, and `outcome`, `severity`
 * and `request_status` became bindable with everything green. A count that is
 * printed and never asserted is not a control. So:
 *
 *   - the real tree's signalled set is PINNED, name by name, with the reason
 *     the DDL gave. Adding a signalled column is a deliberate edit here
 *   - every DDL shape the parser was silently blind to is a fixture below,
 *     each asserted to signal, not merely to parse
 *
 * Runs first, before the checker, like every self-test here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENUM_CLASSIFICATION,
  columnOf,
  columnSignals,
  declaredEnums,
  ruleFingerprint,
  enumClassificationDead,
  enumClassificationGaps,
  readMigrations,
  splitColumns,
  stripNoise,
  tableBodies,
  uncoveredColumns,
} from './check-server-owned.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CASES = [];
const ok = (name, cond) => CASES.push([name, cond]);

// ---- the signals ------------------------------------------------------------

const DDL = `
CREATE TABLE app.thing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  lifecycle_state app.lifecycle_state NOT NULL DEFAULT 'DRAFT',
  label           text NOT NULL,
  qty             numeric(10,2) NOT NULL DEFAULT 0,
  kind            app.mfa_type NOT NULL,
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (id),
  CHECK (qty >= 0)
);
ALTER TABLE app.thing ADD COLUMN audience app.audience NOT NULL DEFAULT 'client';
`;
const signals = columnSignals(DDL, { ...ENUM_CLASSIFICATION, 'app.mfa_type': false });

ok('a gen_random_uuid() default is a signal', signals.get('id')?.includes('DEFAULT gen_random_uuid()') === true);
ok('a now() default is a signal', signals.get('created_at')?.includes('DEFAULT now()') === true);
ok('a stateful enum is a signal', signals.get('lifecycle_state')?.[0] === 'enum app.lifecycle_state');
ok('GENERATED is a signal', signals.get('seq')?.includes('GENERATED') === true);
ok('ADD COLUMN is read too', signals.get('audience')?.[0] === 'enum app.audience');
ok('an ordinary column is not signalled', !signals.has('label'));
ok('a plain default is not a signal', !signals.has('qty'));
ok('an enum classified as descriptive is not a signal', !signals.has('kind'));
ok('a comma inside numeric(10,2) does not split a column', !signals.has('2'));
ok('table constraints are not columns', !signals.has('PRIMARY') && !signals.has('CHECK'));

// ---- the seven shapes the first parser was silently blind to ----------------

const shape = (name, sql, column) => ok(`reads ${name}`, columnSignals(sql).has(column));

shape('lowercase DDL', `create table app.t (\n  created_at timestamptz default now()\n);`, 'created_at');
shape('lowercase add column', `alter table app.t add column audience app.audience not null;`, 'audience');
shape(
  'a column definition wrapped across lines',
  `CREATE TABLE app.t (\n  created_at timestamptz NOT NULL\n    DEFAULT now()\n);`,
  'created_at',
);
shape(
  'a type name on the line after the column name',
  `CREATE TABLE app.t (\n  lifecycle_state\n    app.lifecycle_state NOT NULL\n);`,
  'lifecycle_state',
);
shape('a table that does not end with a newline before the paren', `CREATE TABLE app.t (a int, created_at timestamptz DEFAULT now());`, 'created_at');
shape('a table with a trailing WITH clause', `CREATE TABLE app.t (\n  created_at timestamptz DEFAULT now()\n) WITH (fillfactor=70);`, 'created_at');
shape('a quoted identifier', `CREATE TABLE app.t (\n  "createdAt" timestamptz DEFAULT now()\n);`, 'createdAt');
shape('ALTER COLUMN … SET DEFAULT', `ALTER TABLE app.t ALTER COLUMN created_at SET DEFAULT now();`, 'created_at');

const multi = columnSignals(`ALTER TABLE app.t ADD COLUMN a text, ADD COLUMN b app.audience NOT NULL;`);
ok('reads the second ADD COLUMN in one statement', multi.has('b'));

// ---- noise must not become signal ------------------------------------------

const commented = columnSignals(`CREATE TABLE app.t (\n  label text -- was DEFAULT now() before 0003\n);`);
ok('a trailing comment does not signal the column it follows', !commented.has('label'));

const blockCommented = columnSignals(`/*\nCREATE TABLE app.old (\n  created_at timestamptz DEFAULT now()\n);\n*/\nCREATE TABLE app.t (\n  label text\n);`);
ok('a commented-out table signals nothing', blockCommented.size === 0);

const literal = columnSignals(`CREATE TABLE app.t (\n  banner text NOT NULL DEFAULT 'DEFAULT now() is not used here'\n);`);
ok('a string literal that looks like a default does not signal', !literal.has('banner'));

ok('a badly terminated table does not swallow the next one', tableBodies(stripNoise(`CREATE TABLE app.a (x int);\nCREATE TABLE app.b (\n  created_at timestamptz DEFAULT now()\n);`)).length === 2);
ok('splitColumns keeps a parenthesised comma together', splitColumns('a numeric(10,2), b int').length === 2);
ok('columnOf rejects a table constraint', columnOf('PRIMARY KEY (id)') === null);
ok('columnOf reads a quoted name', columnOf('"createdAt" timestamptz')?.name === 'createdAt');
ok('stripNoise preserves line count', stripNoise('a\n--x\nb').split('\n').length === 3);

// ---- the assertion ----------------------------------------------------------

const refuseAll = () => true;
const holed = (key) => key !== 'lifecycle_state';

ok('a rule that refuses everything leaves nothing uncovered', uncoveredColumns(signals, refuseAll).length === 0);
const misses = uncoveredColumns(signals, holed);
ok('a rule with a hole in it is caught', misses.length === 1 && misses[0].name === 'lifecycle_state');
ok('the miss carries the reason the DDL gave', misses[0]?.reasons?.[0] === 'enum app.lifecycle_state');
ok('a rule that refuses nothing reports every signalled column', uncoveredColumns(signals, () => false).length === signals.size);

// ---- enum classification, both directions ----------------------------------

const withNewEnum = `CREATE TYPE app.brand_new AS ENUM ('a','b');`;
ok('an unclassified enum is a gap', enumClassificationGaps(withNewEnum).includes('app.brand_new'));
ok('a classified enum is not a gap', enumClassificationGaps(`CREATE TYPE app.audience AS ENUM ('client');`).length === 0);
ok(
  'a classification entry the schema no longer declares is dead',
  enumClassificationDead(`CREATE TYPE app.audience AS ENUM ('client');`, { 'app.audience': true, 'app.gone': true }).join() === 'app.gone',
);

// ---- staleness --------------------------------------------------------------

const TS_SRC = `const SERVER_ASSIGNED_SUFFIXES = Object.freeze(['_at', '_by']);
const SERVER_ASSIGNED_NAMES = new Set(['id', 'audience']);`;
const JS_SAME = `const SERVER_ASSIGNED_SUFFIXES = Object.freeze(['_at', '_by']);\nconst SERVER_ASSIGNED_NAMES = new Set(['id', 'audience']);`;
const JS_STALE = `const SERVER_ASSIGNED_SUFFIXES = Object.freeze(['_at', '_by']);\nconst SERVER_ASSIGNED_NAMES = new Set(['id']);`;

ok('source and a matching artifact fingerprint the same', ruleFingerprint(TS_SRC) === ruleFingerprint(JS_SAME));
ok('an artifact missing a name fingerprints differently', ruleFingerprint(TS_SRC) !== ruleFingerprint(JS_STALE));
ok('a text with neither declaration fingerprints null', ruleFingerprint('nothing here') === null);
ok(
  'the real source and the real artifact agree',
  ruleFingerprint(readFileSync(join(ROOT, 'packages/contracts/src/request.ts'), 'utf8')) ===
    ruleFingerprint(readFileSync(join(ROOT, 'packages/contracts/dist/request.js'), 'utf8')),
);

// ---- reachability: the real tree, PINNED -----------------------------------

/**
 * The signalled set as it stands. Pinned rather than counted-from-a-floor: a
 * parser regression that loses columns must fail here, not print a smaller
 * number and pass. Adding a migration that signals a new column is a
 * deliberate edit to this list.
 */
const EXPECTED = Object.freeze({
  actor_type: 'enum app.actor_type',
  audience: 'enum app.audience',
  available_at: 'DEFAULT now()',
  created_at: 'DEFAULT now()',
  granted_at: 'DEFAULT now()',
  last_seen_at: 'DEFAULT now()',
  lifecycle_state: 'enum app.lifecycle_state',
  outcome: 'enum app.audit_outcome',
  password_updated_at: 'DEFAULT now()',
  recorded_at: 'DEFAULT now()',
  request_status: 'enum app.request_status',
  role: 'enum app.member_role',
  severity: 'enum app.finding_severity',
  status: 'enum app.release_status',
  submitted_at: 'DEFAULT now()',
});

const real = columnSignals(readMigrations(join(ROOT, 'packages/db/migrations')));
const expectedNames = Object.keys(EXPECTED).sort();
const realNames = [...real.keys()].sort();
ok(`the real tree signals exactly the ${expectedNames.length} pinned columns`, realNames.join() === expectedNames.join());
ok(
  'each pinned column carries the reason the DDL gave',
  expectedNames.every((n) => real.get(n)?.includes(EXPECTED[n])),
);
ok('the real tree declares at least one enum and all are classified', declaredEnums(stripNoise(readMigrations(join(ROOT, 'packages/db/migrations')))).length > 0);
ok('the real tree has no classification gap and no dead entry',
   enumClassificationGaps(readMigrations(join(ROOT, 'packages/db/migrations'))).length === 0 &&
   enumClassificationDead(readMigrations(join(ROOT, 'packages/db/migrations'))).length === 0);
ok('empty SQL signals nothing, so a broken read is distinguishable from a clean one', columnSignals('').size === 0);

let failed = 0;
for (const [name, pass] of CASES) {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}`);
  if (!pass) failed += 1;
}
if (failed > 0) {
  console.error(`selftest-server-owned FAIL — ${failed} of ${CASES.length}`);
  process.exit(1);
}
console.log(`selftest-server-owned PASS — ${CASES.length} case(s); real tree pinned at ${realNames.length} signalled column(s).`);
