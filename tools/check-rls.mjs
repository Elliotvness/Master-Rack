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
 *
 * The same table governs GRANTs (F-31). A command a table deliberately does not
 * allow should be absent from BOTH axes, and one exemption saying so is truer
 * than two lists that can disagree: an exemption honoured for policies but not
 * for privileges is an exemption that stopped meaning what it says.
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

/**
 * `SECURITY DEFINER` functions permitted to exist, each with the reason.
 *
 * **Empty, and that is the healthy state** — there are none in the schema
 * today. Same posture as every other exemption list here: an exemption is data
 * with a justification, never a silent skip.
 *
 * §14.2's RLS correctness checklist, item 7: *"Audit every SECURITY DEFINER
 * function and view. They run as their owner and silently re-open everything."*
 * That sentence had no mechanism behind it until this axis existed — which is
 * this repository's recurring defect shape (F-01, F-02, F-08, F-11), and the
 * one it keeps finding by building the control rather than by reading code.
 *
 * The axis matters more from here than it did: resolving an anonymous bearer
 * (an invitation token, a session cookie) to the tenant that owns it is a
 * lookup that cannot know its own tenant, and a narrowly-scoped
 * `SECURITY DEFINER` resolver is the leading candidate (F-47). If one lands,
 * it lands with an entry here, and this checker is what stops a SECOND one
 * arriving unremarked.
 *
 * A key is the function's FULL SIGNATURE as `oid::regprocedure` renders it —
 * `app.f(text)`, never `f` — because an exemption is a justification about a
 * function BODY and a bare name does not identify one. Review demonstrated the
 * hole this closes: keyed on the name, auditing `resolve_invitation_tenant(text)`
 * would have waved through an overload taking a uuid and doing anything at all.
 * The value must say what it is for and why its authority cannot be narrowed
 * further.
 */
const SECURITY_DEFINER_EXEMPTIONS = {
  'app.resolve_invitation_tenant(text)':
    'F-47, migration 0014. Resolves an invitation token hash to the organization that owns ' +
    'it — ONE uuid, nothing else — so `POST /api/auth/invite/accept` can open a tenant ' +
    'context at all. §14.3 forbids the organization travelling in the token or the URL and ' +
    '`withTenant` requires one before any statement runs, so an anonymous acceptance request ' +
    'has no other way in. Its authority cannot be narrowed further: RLS applies to every role ' +
    'except the table owner, so a lower-privileged owner would read nothing, and the ' +
    'alternatives are a permanent permissive policy on app.invitation or BYPASSRLS. It is ' +
    'bounded instead by its BODY — one fully-qualified SELECT of one column, with ' +
    "search_path = '' so nothing in it can be shadowed — which cannot change without another " +
    'migration, and this checker sees that migration.',
};

/**
 * Views permitted to run with the definer's rights, each with the reason.
 *
 * A Postgres view evaluates the underlying tables — and their RLS policies — as
 * the VIEW'S OWNER unless it is created with `security_invoker = true`. So a
 * view over a tenant table is a `SECURITY DEFINER` function wearing different
 * clothes, and reads every tenant's rows. Empty, and there are no views in the
 * schema today.
 */
const VIEW_INVOKER_EXEMPTIONS = {};

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

/**
 * Every table whose privileges for the application role disagree with the
 * commands it is supposed to allow.
 *
 * This exists because of F-31, which is the same defect shape as D-02 one axis
 * over. Migration 0010 shipped `app.part` with RLS enabled, forced, and a
 * policy for every operation; `check-rls` reported PASS; the application role
 * got `permission denied for table part`. The GRANT was missing, and nothing
 * looked at the privilege half at all.
 *
 * Policies and privileges are orthogonal in exactly the way section 2 describes
 * for tenancy and audience. A policy decides WHICH ROWS a role may touch; a
 * GRANT decides WHETHER IT MAY TOUCH THE TABLE. A table with perfect policies
 * and no grant is not half-secured, it is broken — and 0003_auth.sql already
 * writes down why this recurs: `GRANT ... ON ALL TABLES` in 0002 applies to the
 * tables that existed when it ran, so every table added later needs its own.
 *
 * Both directions are asserted. A missing privilege is F-31. A privilege that
 * IS granted where an exemption says the command is disallowed is the audit
 * table becoming mutable — the revoke undone by a later migration, with the
 * policy side still reading as correct.
 *
 * Exported and PURE, for the reason `sensitivityViolations` states above.
 *
 * @param {{table_name: string}[]} tables
 * @param {{table_name: string, privilege_type: string}[]} grants
 * @param {Record<string, string[]>} exemptions
 * @returns {string[]}
 */
export function grantViolations(tables, grants, exemptions) {
  const violations = [];

  const granted = new Map();
  for (const { table_name, privilege_type } of grants) {
    if (!granted.has(table_name)) granted.set(table_name, new Set());
    granted.get(table_name).add(privilege_type);
  }

  const present = new Set(tables.map((t) => t.table_name));

  for (const { table_name } of tables) {
    const have = granted.get(table_name) ?? new Set();
    const exempt = exemptions[table_name] ?? [];

    for (const command of REQUIRED_COMMANDS) {
      if (exempt.includes(command)) {
        if (have.has(command)) {
          violations.push(
            `app.${table_name}: ${command} is GRANTed to app_user, but EXEMPTIONS says this ` +
              'table deliberately does not allow it. The privilege was revoked for a reason ' +
              'and has been granted back — the policy side still reads as correct.',
          );
        }
        continue;
      }
      if (!have.has(command)) {
        violations.push(
          `app.${table_name}: no ${command} privilege for app_user. Row-level security can ` +
            'only narrow what a GRANT allows; with no grant the table is unreachable and ' +
            'every policy on it is decorative (F-31).',
        );
      }
    }
  }

  // A grant recorded against a table that is not in the schema means the two
  // queries disagree about what exists. Silence there would hide a typo'd
  // exemption or a dropped table whose privileges outlived it.
  for (const table of granted.keys()) {
    if (!present.has(table)) {
      violations.push(
        `privileges are granted on app.${table}, which is not a table in the schema.`,
      );
    }
  }

  for (const table of Object.keys(exemptions)) {
    if (!present.has(table)) {
      violations.push(
        `EXEMPTIONS names app.${table}, which no longer exists. Remove the exemption — a ` +
          'justification for a table that is gone is not evidence about the schema as it stands.',
      );
    }
  }

  return violations;
}

/**
 * Every `SECURITY DEFINER` function and every definer-rights view that no
 * exemption accounts for, plus every exemption that no longer names a real
 * object, plus every exempted function whose `search_path` is not pinned.
 *
 * §14.2 item 7 is the criterion. A `SECURITY DEFINER` function runs as its
 * owner, and the owner of everything in this schema is the migrator — which
 * owns the tables and is therefore exempt from nothing. One such function is a
 * hole straight through every policy `sensitivityViolations` and the loop in
 * `main` spend their time asserting, and NOTHING in this repository looked for
 * one until now.
 *
 * The `search_path` half is not a nicety. A definer function with an unpinned
 * `search_path` resolves its own identifiers against the CALLER's path, so a
 * caller who can create objects can shadow a table the function names and have
 * it run their code as the owner. It is the standard escalation, and an
 * exemption that does not check for it is a justification for something other
 * than what is deployed.
 *
 * TWO LIMITS, stated beside the guarantee rather than implied away:
 *
 *   - It asserts a `SET search_path` clause is PRESENT, not that its value is
 *     safe. `SET search_path = "$user", public` is pinned and still ends in a
 *     schema a caller may be able to create in. Narrowing the value is a
 *     judgement about deployment, and this checker does not make it.
 *   - It audits schema `app` only, while §14.2 item 7 says "every". Defensible
 *     today — `app_user` holds `CREATE` on no schema and there is no definer
 *     function anywhere in the cluster — but a migrator-created definer
 *     function in `public` is outside what this sees, and that is a real gap
 *     rather than one this control has closed.
 *
 * A THIRD, on the view half: the function axis has a vacuity guard because the
 * schema's three helpers give it a known-nonzero baseline. The view query has
 * no such baseline — zero views is both the right answer and what a broken
 * query returns — so pointing it at the wrong `relkind` would disable the arm
 * silently. Nothing here catches that; the self-test covers the pure function,
 * not the SQL that feeds it.
 *
 * Exported and PURE, for the reason `sensitivityViolations` states above: the
 * fixtures are the rows Postgres would have returned, so the self-test needs no
 * database.
 *
 * KEYED ON THE SIGNATURE, NOT THE NAME, and the difference is the whole
 * exemption. `pg_proc` returns one row per OVERLOAD, and an exemption is a
 * justification written about a function BODY — "what it is for and why its
 * authority cannot be narrowed further". Keyed on the bare name, one
 * justification silently covered every overload of it, so
 * `resolve_invitation_org(text)` being audited would have waved
 * `resolve_invitation_org(uuid)` — a different body doing anything at all —
 * straight through. Review demonstrated exactly that, and it is not
 * hypothetical: F-47's recommended option adds a function under that very name.
 * `oid::regprocedure` renders `resolve_invitation_org(text)`, so the key names
 * the body and two overloads report as two violations rather than as one
 * message printed twice.
 *
 * @param {{identity: string, security_type: string, config: string[] | null, owner: string}[]} functions
 * @param {{view_name: string, security_invoker: boolean}[]} views
 * @param {Record<string, string>} functionExemptions
 * @param {Record<string, string>} viewExemptions
 * @returns {string[]}
 */
export function securityDefinerViolations(
  functions,
  views,
  functionExemptions,
  viewExemptions,
) {
  const violations = [];

  const definers = functions.filter((f) => f.security_type === 'DEFINER');
  for (const fn of definers) {
    const reason = functionExemptions[fn.identity];
    if (reason === undefined) {
      violations.push(
        `${fn.identity} is SECURITY DEFINER and no exemption accounts for it. It ` +
          `runs as ${fn.owner}, which owns the tables and is exempt from no policy, so it ` +
          'reads and writes every tenant. If it is deliberate, name it in ' +
          'SECURITY_DEFINER_EXEMPTIONS — keyed on the full signature — with what it is for ' +
          '(§14.2 item 7).',
      );
      continue;
    }
    const pinned = (fn.config ?? []).some((c) => c.startsWith('search_path='));
    if (!pinned) {
      violations.push(
        `${fn.identity} is an EXEMPTED SECURITY DEFINER function with no pinned ` +
          'search_path. It resolves its identifiers against the caller\'s path, so a caller ' +
          'who can create objects can shadow what it names and run that as its owner. Add ' +
          'SET search_path to the function, or the exemption describes something safer than ' +
          'what is deployed.',
      );
    }
  }

  const presentFunctions = new Set(definers.map((f) => f.identity));
  for (const name of Object.keys(functionExemptions)) {
    if (!presentFunctions.has(name)) {
      violations.push(
        `SECURITY_DEFINER_EXEMPTIONS names ${name}, which is not a SECURITY DEFINER ` +
          'function in the schema. Remove the exemption — a justification for something that ' +
          'is gone is not evidence about the schema as it now stands. (The key is the full ' +
          'signature, as pg_proc renders it: resolve_invitation_org(text), not the bare name.)',
      );
    }
  }

  for (const view of views) {
    if (view.security_invoker) continue;
    const reason = viewExemptions[view.view_name];
    if (reason === undefined) {
      violations.push(
        `app.${view.view_name} is a view without security_invoker = true, so it reads its ` +
          "underlying tables — and evaluates their RLS policies — as the VIEW'S OWNER rather " +
          'than as the caller. That is a SECURITY DEFINER function in different clothes ' +
          '(§14.2 item 7). Set the option, or — if it is a MATERIALIZED view, which cannot ' +
          'carry the option at all — name it in VIEW_INVOKER_EXEMPTIONS.',
      );
    }
  }

  const definerViews = new Set(views.filter((v) => !v.security_invoker).map((v) => v.view_name));
  for (const name of Object.keys(viewExemptions)) {
    if (!definerViews.has(name)) {
      violations.push(
        `VIEW_INVOKER_EXEMPTIONS names app.${name}, which is not a definer-rights view in the ` +
          'schema. Remove the exemption.',
      );
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

    // The privilege half. information_schema.role_table_grants only reports
    // grants the current role can see, and it reports them per grantee, so this
    // is scoped to app_user explicitly rather than aggregated.
    const { rows: grants } = await client.query(`
      SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema = 'app' AND grantee = 'app_user'
         AND privilege_type = ANY(ARRAY['SELECT','INSERT','UPDATE','DELETE'])
    `);

    // §14.2 item 7. Every function in the schema, with the flag that decides
    // whose authority it runs under and the config that decides how it resolves
    // names. `proconfig` is where `SET search_path` lands.
    const { rows: functions } = await client.query(`
      SELECT p.oid::regprocedure::text AS identity,
             CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
             p.proconfig AS config,
             pg_get_userbyid(p.proowner) AS owner
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app'
       ORDER BY p.proname
    `);

    // A view is the same hazard wearing different clothes: without
    // `security_invoker = true` it reads its tables, and evaluates their RLS,
    // as the view's owner. A materialized view cannot carry the option at all,
    // so it reports false and is judged accordingly — and must be exempted
    // rather than fixed, which is why its message says so.
    //
    // `::boolean`, not `= 'true'`. `reloptions` stores the value VERBATIM as
    // the DDL wrote it, uncanonicalised: `WITH (security_invoker = on)` and
    // `= 1` are ordinary Postgres boolean spellings, both fully functional and
    // both stored as written. Comparing against the string `'true'` called two
    // correctly-secured views insecure, and the only way out would have been a
    // false exemption permanently mis-describing the schema. Found by review
    // planting all four spellings against the live database.
    const { rows: views } = await client.query(`
      SELECT c.relname AS view_name,
             COALESCE(
               (SELECT o.option_value::boolean
                  FROM pg_options_to_table(c.reloptions) o
                 WHERE o.option_name = 'security_invoker'),
               false
             ) AS security_invoker
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND c.relkind IN ('v', 'm')
       ORDER BY c.relname
    `);

    violations.push(
      ...sensitivityViolations(sensitiveColumns, policyExprs, SENSITIVITY_EXEMPTIONS),
    );
    violations.push(...grantViolations(tables, grants, EXEMPTIONS));
    violations.push(
      ...securityDefinerViolations(
        functions,
        views,
        SECURITY_DEFINER_EXEMPTIONS,
        VIEW_INVOKER_EXEMPTIONS,
      ),
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

    // A query that matched nothing must not report a pass. The function axis
    // gets its own guard rather than sheltering under the table one: zero
    // SECURITY DEFINER functions is the CORRECT answer today, so "found none"
    // and "the query is broken" are indistinguishable from the outcome alone.
    // The schema has had `current_org`, `current_actor_type` and `is_staff`
    // since 0002, so zero functions means the query, not the schema.
    if (functions.length === 0) {
      // Pushed rather than returned. An early return here printed this one
      // message and swallowed every violation already collected, plus the
      // table-count guard and the app_user role check below it — so a run with
      // a broken function query AND a real RLS hole reported only the query.
      violations.push(
        'found no functions at all in schema "app". Refusing to report that none of them is ' +
          'SECURITY DEFINER — the schema has carried app.current_org(), ' +
          'app.current_actor_type() and app.is_staff() since 0002, so this is the query ' +
          'failing, not the schema being clean.',
      );
    }

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
        `${sensitiveColumns.length} sensitivity column(s), ` +
        `${grants.length} privilege grant(s) to app_user, ` +
        `${functions.length} function(s) of which ` +
        `${functions.filter((f) => f.security_type === 'DEFINER').length} SECURITY DEFINER, ` +
        `${views.length} view(s).`,
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
