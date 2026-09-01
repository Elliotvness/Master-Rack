#!/usr/bin/env node
/**
 * selftest-rls — prove the sensitivity-column assertion actually catches things.
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
 * No database. `sensitivityViolations` is pure, so the fixtures below are the
 * rows Postgres would have returned. Each case asserts the checker goes RED;
 * the last asserts it stays GREEN, because a checker that fails on everything
 * is no more use than one that fails on nothing.
 */

import { sensitivityViolations } from './check-rls.mjs';

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

let failures = 0;
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

if (failures > 0) {
  console.error(`\nselftest-rls: FAIL — ${failures} of ${CASES.length} case(s) not caught.`);
  process.exitCode = 1;
} else {
  console.log(`\nselftest-rls: PASS — ${CASES.length} cases.`);
}
