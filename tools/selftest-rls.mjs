#!/usr/bin/env node
/**
 * selftest-rls — prove the three assertions in check-rls actually catch things:
 * the sensitivity-column one (D-02), the privilege one (F-31) and the
 * definer-authority one (§14.2 item 7).
 *
 * `check-rls` gained a real control in 0005: if a table carries a column that
 * is a SENSITIVITY axis rather than a tenancy one, some policy on that table
 * must name it. That control found a second live defect (0006) on its first
 * run, and then shipped with no self-test, in a repository where every other
 * checker has one and `pnpm verify` runs the self-test FIRST.
 *
 * The reason that ordering exists is the one selftest-boundaries states: a
 * checker that silently stopped working reports a clean pass forever, which is
 * worse than having no checker, because the build stays green while the
 * invariant rots.
 *
 * No database. `sensitivityViolations` and `grantViolations` are pure, so the
 * fixtures below are the rows Postgres would have returned. Each case asserts the checker goes RED;
 * the last asserts it stays GREEN, because a checker that fails on everything
 * is no more use than one that fails on nothing.
 */

import {
  grantViolations,
  securityDefinerViolations,
  sensitivityViolations,
} from './check-rls.mjs';

/** The shape `information_schema.columns` returns. */
const COL = (table_name, column_name) => ({ table_name, column_name });
/** The shape the pg_get_expr query returns. */
const POL = (table_name, using_expr, check_expr = '') => ({ table_name, using_expr, check_expr });

const TENANT_ONLY = '(organization_id = app.current_org() OR app.is_staff())';
const AUDIENCE_AWARE =
  "(((organization_id = app.current_org()) AND (audience = 'client'::app.audience)) OR app.is_staff())";

const CASES = [
  {
    name: 'D-02 itself: audience column, tenant-only policy',
    meaning: 'the original leak would ship again unnoticed',
    columns: [COL('revision', 'audience')],
    policies: [POL('revision', TENANT_ONLY, TENANT_ONLY)],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'D-06: actor_type column, tenant-only policy',
    meaning: 'the audit-event leak would ship again unnoticed',
    columns: [COL('audit_event', 'actor_type')],
    policies: [POL('audit_event', '(subject_organization_id = app.current_org())')],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'a sensitivity column on a table with no policies at all',
    meaning: 'an unprotected new table reads as compliant',
    columns: [COL('draft_note', 'audience')],
    policies: [],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the column appears only in the WITH CHECK clause',
    meaning: 'write-guarded but readable is still a read leak — but it IS named, so this passes',
    columns: [COL('revision', 'audience')],
    policies: [POL('revision', TENANT_ONLY, AUDIENCE_AWARE)],
    exemptions: {},
    expect: 'PASS',
  },
  {
    name: 'a stale exemption for a column that no longer exists',
    meaning: 'a justification outlives the thing it justified, silently',
    columns: [COL('revision', 'audience')],
    policies: [POL('revision', AUDIENCE_AWARE, AUDIENCE_AWARE)],
    exemptions: { session: { actor_type: 'dropped in a later migration' } },
    expect: 'FAIL',
  },
  {
    name: 'a substring must not count as a mention',
    meaning: 'the word-boundary regex is what stops audience_id passing for audience',
    columns: [COL('revision', 'audience')],
    policies: [POL('revision', '(audience_id = app.current_org())')],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the schema as 0005 and 0006 leave it',
    meaning: 'a checker that fails on everything is no more use than one that fails on nothing',
    columns: [
      COL('revision', 'audience'),
      COL('audit_event', 'actor_type'),
      COL('app_user', 'actor_type'),
      COL('session', 'actor_type'),
    ],
    policies: [
      POL('revision', AUDIENCE_AWARE, AUDIENCE_AWARE),
      POL('audit_event', "((actor_organization_id = app.current_org()) AND (actor_type = 'client'::app.actor_type))"),
      POL('app_user', TENANT_ONLY, TENANT_ONLY),
      POL('session', TENANT_ONLY, TENANT_ONLY),
    ],
    exemptions: {
      app_user: { actor_type: 'staff live in the staff organization' },
      session: { actor_type: 'same reasoning as app_user' },
    },
    expect: 'PASS',
  },
];

/**
 * The privilege axis (F-31). `grantViolations` is pure for the same reason
 * `sensitivityViolations` is: the fixtures below are the rows Postgres would
 * have returned, so this runs with no database — and F-31 is precisely a
 * defect that a policy-shaped check reported PASS on.
 */
const TBL = (table_name) => ({ table_name });
const GRANT = (table_name, privilege_type) => ({ table_name, privilege_type });
const ALL = (table_name) =>
  ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((p) => GRANT(table_name, p));

const GRANT_CASES = [
  {
    name: 'F-31 itself: a table with policies and no grant at all',
    meaning: 'migration 0010 ships again, check-rls says PASS, the app says permission denied',
    tables: [TBL('part'), TBL('organization')],
    grants: [...ALL('organization')],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'a table granted SELECT but not INSERT',
    meaning: 'a partial GRANT reads as a grant, and fails only on the write path in production',
    tables: [TBL('part')],
    grants: [GRANT('part', 'SELECT'), GRANT('part', 'UPDATE'), GRANT('part', 'DELETE')],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the audit table with UPDATE granted back',
    meaning: 'the revoke that makes audit events immutable is undone and the policy side still reads correct',
    tables: [TBL('audit_event')],
    grants: [GRANT('audit_event', 'SELECT'), GRANT('audit_event', 'INSERT'), GRANT('audit_event', 'UPDATE')],
    exemptions: { audit_event: ['UPDATE', 'DELETE'] },
    expect: 'FAIL',
  },
  {
    name: 'a stale exemption for a table that no longer exists',
    meaning: 'a justification outlives the thing it justified, silently',
    tables: [TBL('part')],
    grants: [...ALL('part')],
    exemptions: { draft_note: ['DELETE'] },
    expect: 'FAIL',
  },
  {
    name: 'privileges granted on something that is not a table in the schema',
    meaning: 'the two queries disagree about what exists and nothing says so',
    tables: [TBL('part')],
    grants: [...ALL('part'), GRANT('legacy_part', 'SELECT')],
    exemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the schema as 0010 leaves it, audit exemption honoured',
    meaning: 'a checker that fails on everything is no more use than one that fails on nothing',
    tables: [TBL('part'), TBL('part_revision'), TBL('audit_event')],
    grants: [
      ...ALL('part'),
      ...ALL('part_revision'),
      GRANT('audit_event', 'SELECT'),
      GRANT('audit_event', 'INSERT'),
    ],
    exemptions: { audit_event: ['UPDATE', 'DELETE'] },
    expect: 'PASS',
  },
];

/**
 * The definer-authority axis (§14.2 item 7). Same posture again: the fixtures
 * are the rows `pg_proc` and `pg_class` would have returned, so this runs with
 * no database.
 *
 * The case that matters most is the FIRST one. A `SECURITY DEFINER` function is
 * the one object that makes every other assertion in this checker decorative,
 * and until this axis existed nothing in the repository looked for one —
 * §14.2's checklist said "audit every SECURITY DEFINER function and view" and
 * that sentence was the whole control.
 */
const FN = (identity, security_type, config = null, owner = 'rms_migrator') => ({
  identity,
  security_type,
  config,
  owner,
});
const VIEW = (view_name, security_invoker) => ({ view_name, security_invoker });

/**
 * The SIX functions migrations 0001-0013 leave in schema `app`, as
 * `oid::regprocedure` renders them. All SECURITY INVOKER, and must stay a pass.
 *
 * The first draft of this fixture listed the three 0002 helpers and called
 * itself "the schema", which was false: the three `refuse_*` trigger functions
 * from 0001 were missing, and `check-rls` prints "6 function(s)" against the
 * migrated database. The outcome was unaffected, which is exactly why it would
 * have rotted unnoticed — a fixture whose whole job is to be the real shape.
 */
const SCHEMA_FUNCTIONS = [
  FN('app.current_actor_type()', 'INVOKER'),
  FN('app.current_org()', 'INVOKER'),
  FN('app.is_staff()', 'INVOKER'),
  FN('app.refuse_audit_mutation()', 'INVOKER'),
  FN('app.refuse_derived_change_when_frozen()', 'INVOKER'),
  FN('app.refuse_frozen_revision_change()', 'INVOKER'),
];

const DEFINER_CASES = [
  {
    name: '§14.2 item 7 itself: an unexempted SECURITY DEFINER function',
    meaning: 'one function reads and writes every tenant and every policy above it is decorative',
    functions: [...SCHEMA_FUNCTIONS, FN('app.resolve_invitation_org(text)', 'DEFINER', ['search_path=app'])],
    views: [],
    functionExemptions: {},
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'an EXEMPTED definer function with no pinned search_path',
    meaning: 'the standard escalation: a caller shadows a name and runs their code as the owner',
    functions: [...SCHEMA_FUNCTIONS, FN('app.resolve_invitation_org(text)', 'DEFINER', null)],
    views: [],
    functionExemptions: { 'app.resolve_invitation_org(text)': 'resolves an anonymous bearer to its tenant' },
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'search_path set on something else is not search_path set',
    meaning: 'a config entry that merely contains the words would pass a looser test',
    functions: [
      ...SCHEMA_FUNCTIONS,
      FN('app.resolve_invitation_org(text)', 'DEFINER', ['role=app_owner', 'statement_timeout=5s']),
    ],
    views: [],
    functionExemptions: { 'app.resolve_invitation_org(text)': 'resolves an anonymous bearer to its tenant' },
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'an exempted definer function WITH a pinned search_path',
    meaning: 'the audited, deliberate case must be allowed or the exemption list means nothing',
    functions: [
      ...SCHEMA_FUNCTIONS,
      FN('app.resolve_invitation_org(text)', 'DEFINER', ['search_path=app, pg_catalog']),
    ],
    views: [],
    functionExemptions: { 'app.resolve_invitation_org(text)': 'resolves an anonymous bearer to its tenant' },
    viewExemptions: {},
    expect: 'PASS',
  },
  {
    name: 'a stale exemption for a function that is gone',
    meaning: 'a justification outlives the thing it justified, silently',
    functions: [...SCHEMA_FUNCTIONS],
    views: [],
    functionExemptions: { 'app.resolve_invitation_org(text)': 'dropped in a later migration' },
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'an exemption for a function that has since been made SECURITY INVOKER',
    meaning: 'the exemption would go on excusing a definer function if one were ever restored under that name',
    functions: [...SCHEMA_FUNCTIONS, FN('app.resolve_invitation_org(text)', 'INVOKER')],
    views: [],
    functionExemptions: { 'app.resolve_invitation_org(text)': 'resolves an anonymous bearer to its tenant' },
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'a view without security_invoker over a tenant table',
    meaning: 'the same hole in different clothes — the view reads every tenant as its owner',
    functions: [...SCHEMA_FUNCTIONS],
    views: [VIEW('all_invitations', false)],
    functionExemptions: {},
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the same view with security_invoker = true',
    meaning: 'a view that evaluates RLS as the caller is not the hazard and must not be flagged',
    functions: [...SCHEMA_FUNCTIONS],
    views: [VIEW('all_invitations', true)],
    functionExemptions: {},
    viewExemptions: {},
    expect: 'PASS',
  },
  {
    name: 'a stale view exemption',
    meaning: 'a justification outlives the thing it justified, silently',
    functions: [...SCHEMA_FUNCTIONS],
    views: [VIEW('all_invitations', true)],
    functionExemptions: {},
    viewExemptions: { all_invitations: 'the view was given security_invoker in a later migration' },
    expect: 'FAIL',
  },
  {
    name: 'an EXEMPTED definer-rights view',
    meaning: 'the honouring branch of the view arm had no case at all — disabling it left the suite green',
    functions: [...SCHEMA_FUNCTIONS],
    views: [VIEW('all_invitations', false)],
    functionExemptions: {},
    viewExemptions: { all_invitations: 'a materialized view, which cannot carry the option' },
    expect: 'PASS',
  },
  {
    name: 'an OVERLOAD of an exempted definer function',
    meaning: 'one justification would cover a second body under the same name — F-47 option A adds exactly that name',
    functions: [
      ...SCHEMA_FUNCTIONS,
      FN('app.resolve_invitation_org(text)', 'DEFINER', ['search_path=app, pg_catalog']),
      FN('app.resolve_invitation_org(uuid)', 'DEFINER', ['search_path=app, pg_catalog']),
    ],
    views: [],
    functionExemptions: {
      'app.resolve_invitation_org(text)': 'resolves an anonymous bearer to its tenant',
    },
    viewExemptions: {},
    expect: 'FAIL',
  },
  {
    name: 'the schema as migrations 0001-0013 leave it',
    meaning: 'a checker that fails on everything is no more use than one that fails on nothing',
    functions: [...SCHEMA_FUNCTIONS],
    views: [],
    functionExemptions: {},
    viewExemptions: {},
    expect: 'PASS',
  },
];

let failures = 0;
for (const c of DEFINER_CASES) {
  const violations = securityDefinerViolations(
    c.functions,
    c.views,
    c.functionExemptions,
    c.viewExemptions,
  );
  const got = violations.length > 0 ? 'FAIL' : 'PASS';
  if (got === c.expect) {
    console.log(`  ok    [definer] ${c.name} \u2192 ${got}`);
  } else {
    failures += 1;
    console.error(`  MISS  [definer] ${c.name}: expected ${c.expect}, got ${got}`);
    console.error(`        if this is wrong: ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
  }
}

for (const c of GRANT_CASES) {
  const violations = grantViolations(c.tables, c.grants, c.exemptions);
  const got = violations.length > 0 ? 'FAIL' : 'PASS';
  if (got === c.expect) {
    console.log(`  ok    [grants] ${c.name} → ${got}`);
  } else {
    failures += 1;
    console.error(`  MISS  [grants] ${c.name}: expected ${c.expect}, got ${got}`);
    console.error(`        if this is wrong: ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
  }
}

for (const c of CASES) {
  const violations = sensitivityViolations(c.columns, c.policies, c.exemptions);
  const got = violations.length > 0 ? 'FAIL' : 'PASS';
  if (got === c.expect) {
    console.log(`  ok    ${c.name} → ${got}`);
  } else {
    failures += 1;
    console.error(`  MISS  ${c.name}: expected ${c.expect}, got ${got}`);
    console.error(`        if this is wrong: ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
  }
}

const TOTAL = CASES.length + GRANT_CASES.length + DEFINER_CASES.length;

if (failures > 0) {
  console.error(`\nselftest-rls: FAIL — ${failures} of ${TOTAL} case(s) not caught.`);
  process.exitCode = 1;
} else {
  console.log(
    `\nselftest-rls: PASS — ${TOTAL} cases ` +
      `(${CASES.length} sensitivity, ${GRANT_CASES.length} privilege, ` +
      `${DEFINER_CASES.length} definer-authority).`,
  );
}
