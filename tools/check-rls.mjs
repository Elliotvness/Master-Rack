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

// pg_policy.polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL
const CMD = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' };

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

    console.log(`check-rls: inspected ${tableCount} table(s) in schema "app".`);

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

await main();
