#!/usr/bin/env node
/**
 * check-rls - AC-05: every application-schema table has row-level security
 * enabled and forced, with at least one policy per operation. Adding a table
 * without one fails CI.
 *
 * The criterion ID is named here deliberately. A traceability audit scans for
 * it, and a control that enforces a criterion without citing it reads as an
 * unenforced criterion - which is how a real gap and a labelling gap become
 * indistinguishable to anyone auditing this later.
 *
 * check-rls — every table in the application schema has row-level security
 * enabled, forced, and a policy for every operation.
 *
 * The realistic failure is not a wrong policy. It is a table someone added on
 * a Tuesday with no ALTER TABLE ... ENABLE ROW LEVEL SECURITY behind it, which
 * is wide open and looks exactly like every other table in the migration file.
 * This asserts the property rather than trusting that it was remembered.
 *
 * Two subtleties worth stating:
 *   - ENABLE alone exempts the table owner; FORCE closes that. Both are checked.
 *   - A USING-only policy lets a caller WRITE a row into a tenant it cannot
 *     read, so INSERT (WITH CHECK) is checked separately from SELECT.
 */

import { sep } from 'node:path';

import pg from 'pg';

const CONNECTION =
  process.env.DATABASE_ADMIN_URL ??
  'postgresql://postgres:postgres@localhost:55432/rms';

/**
 * Tables permitted to lack a policy for a given command, each with the reason.
 * An exemption is data with a justification, never a silent skip.
 */
const EXEMPTIONS = {
  // With RLS enabled, an absent policy means DENIED. The audit table has no
  // UPDATE or DELETE policy on purpose: nobody may change an audit event, and
  // the privileges are revoked and a trigger raises as well.
  audit_event: ['UPDATE', 'DELETE'],
};

const REQUIRED_COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/**
 * Columns that carry a SENSITIVITY axis rather than a tenancy one, and must
 * therefore appear in a policy expression.
 *
 * This exists because of audit finding D-02. `app.revision` carried an
 * `audience` column, NOT NULL, indexed, correctly commented -- and named in no
 * policy at all, because the table was swept into the generic tenant loop. The
 * tenant predicate passed internal revisions straight through to the client
 * who owned them, and the only thing stopping the leak was an Array.filter()
 * in a front-end package.
 *
 * Organization isolation and audience are orthogonal (section 2): one decides
 * WHICH ROWS, the other decides WHICH AUDIENCE. A table with both columns and
 * only one of them in its policy is not half-protected, it is unprotected on
 * the axis that was forgotten -- and nothing about the schema looks wrong.
 *
 * So: if the column exists, a policy must mention it. This is deliberately a
 * blunt check. It cannot tell a correct predicate from a wrong one, and it does
 * not try; it catches the realistic failure, which is a column nobody wired up.
 */
const SENSITIVITY_COLUMNS = ['audience', 'actor_type'];

/**
 * Sensitivity columns that legitimately need no predicate, each with its reason.
 *
 * Same posture as EXEMPTIONS above: an exemption is data with a justification,
 * never a silent skip. Both entries here rest on the same structural fact --
 * McMurray Stern is itself an organization with is_internal = true (section
 * 7.2), so staff rows live in the STAFF organization. A client organization
 * contains only client principals, and an organization predicate already
 * separates them. There is no audience to cross.
 *
 * If that ever stops being true -- if a staff user is ever given a membership
 * in a client organization -- both of these become real and must be removed.
 */
const SENSITIVITY_EXEMPTIONS = {
  app_user: {
    actor_type:
      'org-scoped, and staff users belong to the staff organization. A client org ' +
      'contains only client users, so the organization predicate already separates them.',
  },
  session: {
    actor_type:
      'org-scoped, same reasoning as app_user. Every session reachable inside a client ' +
      'organization belongs to a client principal.',
  },
};

// pg_policy.polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL
const CMD = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' };

/**
 * Every sensitivity column that no policy on its table mentions, plus every
 * exemption that no longer names a real column.
 *
 * Exported and PURE so `selftest-rls.mjs` can prove it still catches things
 * without a database. Every other checker here is shaped this way, and the
 * reason is the one selftest-boundaries states: a checker that silently stopped
 * working reports a clean pass forever, which is worse than no checker at all.
 *
 * @param {{table_name: string, column_name: string}[]} sensitiveColumns
 * @param {{table_name: string, using_expr: string, check_expr: string}[]} policyExprs
 * @param {Record<string, Record<string, string>>} exemptions
 * @returns {string[]}
 */
export function sensitivityViolations(sensitiveColumns, policyExprs, exemptions) {
  const violations = [];

  const exprsByTable = new Map();
  for (const row of policyExprs) {
    if (!exprsByTable.has(row.table_name)) exprsByTable.set(row.table_name, []);
    exprsByTable.get(row.table_name).push(`${row.using_expr} ${row.check_expr}`);
  }

  for (const { table_name, column_name } of sensitiveColumns) {
    if (exemptions[table_name]?.[column_name] !== undefined) continue;
    const exprs = exprsByTable.get(table_name) ?? [];
    const mentioned = exprs.some((e) => new RegExp(`\\b${column_name}\\b`).test(e));
    if (!mentioned) {
      violations.push(
        `app.${table_name}: column '${column_name}' is a sensitivity axis and is named in no ` +
          'policy. Tenancy and audience are orthogonal — an organization predicate alone ' +
          'returns rows of the wrong audience to the tenant that owns them (D-02).',
      );
    }
  }

  // An exemption for a column that no longer exists is a justification for
  // nothing, still being honoured. It outlives its reason silently, which is
  // the same failure mode the exemption list was written to avoid.
  const present = new Set(sensitiveColumns.map((c) => `${c.table_name}.${c.column_name}`));
  for (const [table, columns] of Object.entries(exemptions)) {
    for (const column of Object.keys(columns)) {
      if (!present.has(`${table}.${column}`)) {
        violations.push(
          `SENSITIVITY_EXEMPTIONS names app.${table}.${column}, which no longer exists. ` +
            'Remove the exemption — a justification for a column that is gone is not evidence ' +
            'about the schema as it now stands.',
        );
      }
    }
  }

  return violations;
}

async function main() {
  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();

  const violations = [];
  let tableCount = 0;

  try {
    const { rows: tables } = await client.query(`
      SELECT c.relname            AS table_name,
             c.relrowsecurity     AS enabled,
             c.relforcerowsecurity AS forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND c.relkind = 'r'
       ORDER BY c.relname
    `);

    const { rows: policies } = await client.query(`
      SELECT c.relname AS table_name, p.polcmd AS cmd, p.polname AS policy_name
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app'
    `);

    // Which sensitivity columns each table actually has.
    const { rows: sensitiveColumns } = await client.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'app' AND column_name = ANY($1)`,
      [SENSITIVITY_COLUMNS],
    );

    // The full policy expressions, so we can look for the column by name.
    // pg_get_expr renders USING and WITH CHECK back into readable SQL.
    const { rows: policyExprs } = await client.query(`
      SELECT c.relname AS table_name,
             p.polname AS policy_name,
             COALESCE(pg_get_expr(p.polqual, p.polrelid), '') AS using_expr,
             COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS check_expr
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app'
    `);

    violations.push(
      ...sensitivityViolations(sensitiveColumns, policyExprs, SENSITIVITY_EXEMPTIONS),
    );

    const byTable = new Map();
    for (const row of policies) {
      if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
      const commands = row.cmd === '*' ? REQUIRED_COMMANDS : [CMD[row.cmd]];
      for (const command of commands) byTable.get(row.table_name).add(command);
    }

    for (const table of tables) {
      tableCount += 1;

      if (!table.enabled) {
        violations.push(
          `app.${table.table_name}: row-level security is NOT ENABLED. The table is ` +
            'readable by any role that can reach it.',
        );
      }
      if (!table.forced) {
        violations.push(
          `app.${table.table_name}: row-level security is not FORCED, so the table ` +
            'owner is exempt from its own policies.',
        );
      }

      const covered = byTable.get(table.table_name) ?? new Set();
      const exempt = EXEMPTIONS[table.table_name] ?? [];

      for (const command of REQUIRED_COMMANDS) {
        if (covered.has(command)) continue;
        if (exempt.includes(command)) continue;
        violations.push(
          `app.${table.table_name}: no policy covers ${command}.` +
            (command === 'INSERT'
              ? ' Without a WITH CHECK policy a caller can write into a tenant it cannot read.'
              : ''),
        );
      }
    }

    // A query that matched nothing must not report a pass.
    if (tableCount === 0) {
      console.error(
        'check-rls: found no tables in schema "app". Refusing to report a pass for a ' +
          'check that inspected nothing — has the migration been applied?',
      );
      process.exitCode = 1;
      return;
    }

    // The application role must not be able to bypass any of it.
    const { rows: roles } = await client.query(`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'
    `);
    if (roles.length === 0) {
      violations.push('role app_user does not exist; the migration did not create it.');
    } else if (roles[0].rolsuper || roles[0].rolbypassrls) {
      violations.push(
        'role app_user has SUPERUSER or BYPASSRLS. Either one makes every policy ' +
          'above decorative.',
      );
    }

    console.log(
      `check-rls: inspected ${tableCount} table(s) in schema "app", ` +
        `${sensitiveColumns.length} sensitivity column(s).`,
    );

    if (violations.length > 0) {
      console.error('\ncheck-rls: FAIL');
      for (const v of violations) console.error(`  ${v}`);
      process.exitCode = 1;
      return;
    }

    console.log('check-rls: PASS');
  } finally {
    await client.end();
  }
}

// Same guard as check-boundaries.mjs: importing this module for its pure
// helpers must not open a database connection. Without it, selftest-rls cannot
// run without a Postgres, and a self-test that needs the thing it is testing
// against is not much of a self-test.
if (
  import.meta.url === `file://${process.argv[1]?.split(sep).join('/')}` ||
  process.argv[1]?.endsWith('check-rls.mjs')
) {
  await main();
}
