/**
 * The §11.6 assumption record, against a REAL Postgres.
 *
 * Migration 0009 moved two claims out of prose and into the schema, and this
 * proves the schema actually refuses. Both are the same defect shape audit D-04
 * found in the orchestration: a control that states its own method and has no
 * mechanism behind it.
 *
 *   - An assumption with no `scope` cannot be stored. §11.6's record has six
 *     fields; five of them plus a shrug is not the record.
 *   - An assumption marked acknowledged with no audit event behind it cannot be
 *     stored. §11.6 makes the acknowledgement an audit event, and AC-15 puts
 *     the event in the same transaction as the change. A row asserting that a
 *     named client accepted something, with nothing in `app.audit_event` to
 *     corroborate it, is a recollection wearing a timestamp.
 *
 * These run against the database rather than a stub deliberately. Application
 * code can be routed around by the next caller; a CHECK constraint cannot.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';

const ORG = '22222222-2222-4222-8222-dddddddddddd';
const USER = '22222222-2222-4222-8222-dddddddddde1';
const PROJECT = '22222222-2222-4222-8222-dddddddddde2';
const CATALOG = '22222222-2222-4222-8222-dddddddddde3';
const RULES = '22222222-2222-4222-8222-dddddddddde4';
const REVISION = '22222222-2222-4222-8222-dddddddddde5';
const EVENT = '22222222-2222-4222-8222-dddddddddde6';

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT scope FROM app.assumption LIMIT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

const available = await probe();
if (!available) {
  console.warn(
    '\n  SKIPPING assumption record tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n',
  );
}
const maybe = available ? it : it.skip;

/** One assumption row, with every column the caller did not override. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    organization_id: ORG,
    revision_id: REVISION,
    audience: 'client',
    key: 'pallet.overhang.front',
    assumed_value_um: 101_600,
    assumed_unit: 'um',
    why: 'No pallet overhang was supplied; the planning default was used.',
    scope: 'every position in unit U-1',
    acknowledged_by: null,
    acknowledged_at: null,
    acknowledgement_audit_event_id: null,
    ...over,
  };
}

async function insert(over: Record<string, unknown> = {}): Promise<void> {
  const r = row(over);
  const cols = Object.keys(r);
  const params = cols.map((_, i) => `$${String(i + 1)}`).join(', ');
  await admin(
    `INSERT INTO app.assumption (${cols.join(', ')}) VALUES (${params})`,
    Object.values(r),
  );
}

beforeAll(async () => {
  if (!available) return;
  await admin(`
    TRUNCATE app.bom_line, app.finding_internal_detail, app.finding, app.assumption,
             app.uncatalogued_part, app.internal_note, app.submission, app.revision,
             app.project, app.invitation, app.membership, app.app_user,
             app.catalog_release, app.rule_pack_release, app.organization,
             app.audit_event
      RESTART IDENTITY CASCADE
  `);
  await admin(`INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'Harbor', false)`, [
    ORG,
  ]);
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
     VALUES ($1, $2, 'ops@harbor.invalid', 'A User', 'client')`,
    [USER, ORG],
  );
  await admin(
    `INSERT INTO app.catalog_release
       (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
        approved_by, approved_at, verification_path, content_sha256)
     VALUES ($1, 'Interlake', '2026-08', 'APPROVED', 'published chart', 'machine-extract',
             now(), 'a named human', now(), 'full cross-check', 'abc')`,
    [CATALOG],
  );
  await admin(
    `INSERT INTO app.rule_pack_release (id, name, rev, status, content_sha256)
     VALUES ($1, 'base', '2026-08', 'APPROVED', 'def')`,
    [RULES],
  );
  await admin(
    `INSERT INTO app.project (id, organization_id, number, name) VALUES ($1, $2, '26-0142', 'Units')`,
    [PROJECT, ORG],
  );
  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, catalog_release_id,
        rule_pack_release_id, created_by, content)
     VALUES ($1, $2, $3, 'P01', $4, $5, $6, '{"levels":4}')`,
    [REVISION, ORG, PROJECT, CATALOG, RULES, USER],
  );
  await admin(
    `INSERT INTO app.audit_event
       (event_id, occurred_at, actor_user_id, actor_type, actor_organization_id,
        subject_organization_id, action, resource_type, resource_id, outcome, reasons,
        prev_hash, hash)
     VALUES ($1, now(), $2, 'client', $3, $3, 'assumption.acknowledged', 'revision', $4,
             'success', '{}', 'genesis', 'h1')`,
    [EVENT, USER, ORG, REVISION],
  );
});

afterAll(async () => {
  if (available) await admin(`DELETE FROM app.assumption WHERE organization_id = $1`, [ORG]);
});

describe('§11.6 — the assumption record cannot be stored incomplete', () => {
  maybe('accepts a complete, unacknowledged assumption', async () => {
    await expect(insert()).resolves.toBeUndefined();
  });

  maybe('refuses an assumption with no scope', async () => {
    // The control that must be able to go red: before 0009 there was no column
    // at all, so this insert succeeded and the record was five-sixths of §11.6.
    await expect(insert({ scope: null })).rejects.toThrow(/scope/);
  });

  maybe('refuses a blank scope — absent by schema, not blank by convention', async () => {
    await expect(insert({ scope: '   ' })).rejects.toThrow(/assumption_scope_not_blank/);
  });

  maybe('refuses an acknowledgement with no audit event behind it (AC-15)', async () => {
    await expect(
      insert({ acknowledged_by: USER, acknowledged_at: new Date().toISOString() }),
    ).rejects.toThrow(/assumption_acknowledged_all_or_nothing/);
  });

  maybe('refuses an audit event with no acknowledger', async () => {
    await expect(insert({ acknowledgement_audit_event_id: EVENT })).rejects.toThrow(
      /assumption_acknowledged_all_or_nothing/,
    );
  });

  maybe('refuses an audit event id that points at no event', async () => {
    await expect(
      insert({
        acknowledged_by: USER,
        acknowledged_at: new Date().toISOString(),
        acknowledgement_audit_event_id: '22222222-2222-4222-8222-ffffffffffff',
      }),
    ).rejects.toThrow(/foreign key|audit_event/);
  });

  maybe('accepts the complete acknowledgement: who, when, and the event', async () => {
    await expect(
      insert({
        acknowledged_by: USER,
        acknowledged_at: new Date().toISOString(),
        acknowledgement_audit_event_id: EVENT,
      }),
    ).resolves.toBeUndefined();
  });
});
