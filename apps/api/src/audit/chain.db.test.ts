/**
 * The audit hash chain, against a REAL Postgres.
 *
 * AC-15: every state change writes an audit event in the same transaction, and
 * the hash chain verifies from genesis. The tamper-detection tests deliberately
 * corrupt a row and prove verification catches it — a chain that cannot detect
 * tampering is not evidence of anything.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantContext } from '@rms/db';
import {
  GENESIS_PREV_HASH,
  appendAuditEvent,
  chainHash,
  verifyAuditChain,
  type AuditEventContent,
} from '../index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '11111111-1111-4111-8111-cccccccccccc';
const ctx: TenantContext = { organizationId: ORG, actorType: 'staff' };

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM app.audit_event LIMIT 1');
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
  console.warn('\n  SKIPPING audit tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n');
}
const maybe = available ? it : it.skip;

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

let seq = 0;
function content(action: string, outcome: 'success' | 'denied' = 'success'): AuditEventContent {
  seq += 1;
  return {
    occurredAt: new Date(Date.UTC(2026, 7, 31, 0, 0, seq)).toISOString(),
    actorUserId: null,
    actorType: 'staff',
    actorOrganizationId: ORG,
    impersonatedBy: null,
    subjectOrganizationId: ORG,
    action,
    resourceType: 'revision',
    resourceId: `rev-${seq}`,
    outcome,
    reasons: outcome === 'denied' ? ['a blocker is open', 'a second blocker is open'] : [],
  };
}

async function append(action: string, outcome: 'success' | 'denied' = 'success'): Promise<void> {
  const c = content(action, outcome);
  await withTenant(ctx, (tx) =>
    appendAuditEvent(tx, {
      eventId: crypto.randomUUID(),
      content: c,
      recordedAt: new Date().toISOString(),
    }),
  );
}

beforeAll(async () => {
  if (!available) return;
  await admin(`TRUNCATE app.audit_event RESTART IDENTITY CASCADE`);
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'Auditor', true)
       ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('chainHash (pure)', () => {
  it('is deterministic', () => {
    const c = content('revision.frozen');
    expect(chainHash('prev', c)).toBe(chainHash('prev', c));
  });

  it('changes when the previous hash changes', () => {
    const c = content('revision.frozen');
    expect(chainHash('a', c)).not.toBe(chainHash('b', c));
  });

  it('changes when any content field changes', () => {
    const base = content('revision.frozen');
    const changed = { ...base, action: 'revision.superseded' };
    expect(chainHash('p', base)).not.toBe(chainHash('p', changed));
  });

  it('returns 64 hex chars', () => {
    expect(chainHash(GENESIS_PREV_HASH, content('x'))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AC-15 — the chain verifies from genesis', () => {
  maybe('a single event chains onto the empty genesis hash', async () => {
    await append('revision.submitted');
    const result = await withTenant(ctx, (tx) => verifyAuditChain(tx));
    expect(result).toEqual({ ok: true, length: 1 });

    const row = await admin('SELECT prev_hash FROM app.audit_event ORDER BY sequence ASC LIMIT 1');
    expect(row.rows[0]?.['prev_hash']).toBe(GENESIS_PREV_HASH);
  });

  maybe('a run of events all verify', async () => {
    await append('revision.edited');
    await append('revision.frozen');
    await append('bom.viewed');
    await append('revision.derived');

    const result = await withTenant(ctx, (tx) => verifyAuditChain(tx));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.length).toBeGreaterThanOrEqual(5);
  });

  maybe('each event links to the actual predecessor', async () => {
    const rows = await admin(
      'SELECT prev_hash, hash FROM app.audit_event ORDER BY sequence ASC',
    );
    for (let i = 1; i < rows.rows.length; i += 1) {
      expect(rows.rows[i]?.['prev_hash']).toBe(rows.rows[i - 1]?.['hash']);
    }
  });
});

describe('tamper detection — a chain that cannot detect tampering is not evidence', () => {
  maybe('catches an altered event, naming the sequence', async () => {
    // The trigger blocks UPDATE, so simulate an insider with direct access by
    // temporarily disabling it, corrupting a row, then restoring it. This is
    // exactly the threat the chain exists to detect: someone who CAN write.
    await admin('ALTER TABLE app.audit_event DISABLE TRIGGER audit_event_no_update');
    try {
      await admin(
        `UPDATE app.audit_event SET action = 'tampered'
          WHERE sequence = (SELECT min(sequence) FROM app.audit_event)`,
      );
    } finally {
      await admin('ALTER TABLE app.audit_event ENABLE TRIGGER audit_event_no_update');
    }

    const result = await withTenant(ctx, (tx) => verifyAuditChain(tx));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/recomputed hash does not match/);
    }
  });

  maybe('catches a deleted interior event', async () => {
    // Fresh chain for this case.
    await admin('ALTER TABLE app.audit_event DISABLE TRIGGER audit_event_no_update');
    await admin('ALTER TABLE app.audit_event DISABLE TRIGGER audit_event_no_delete');
    // CASCADE since migration 0009: `app.assumption.acknowledgement_audit_event_id`
    // references this table, and a bare TRUNCATE is refused while it does. The
    // foreign key is the point — an acknowledgement cannot outlive its event.
    await admin('TRUNCATE app.audit_event RESTART IDENTITY CASCADE');
    await admin('ALTER TABLE app.audit_event ENABLE TRIGGER audit_event_no_update');
    await admin('ALTER TABLE app.audit_event ENABLE TRIGGER audit_event_no_delete');

    await append('a');
    await append('b');
    await append('c');

    await admin('ALTER TABLE app.audit_event DISABLE TRIGGER audit_event_no_delete');
    try {
      await admin(
        `DELETE FROM app.audit_event
          WHERE sequence = (SELECT min(sequence) + 1 FROM app.audit_event)`,
      );
    } finally {
      await admin('ALTER TABLE app.audit_event ENABLE TRIGGER audit_event_no_delete');
    }

    const result = await withTenant(ctx, (tx) => verifyAuditChain(tx));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/prev_hash does not match/);
    }
  });
});

describe('I-3 — audit events cannot be altered or removed, at two layers', () => {
  maybe('the application role is denied UPDATE by revoked privilege', async () => {
    // CASCADE since migration 0009: `app.assumption.acknowledgement_audit_event_id`
    // references this table, and a bare TRUNCATE is refused while it does. The
    // foreign key is the point — an acknowledgement cannot outlive its event.
    await admin('TRUNCATE app.audit_event RESTART IDENTITY CASCADE');
    await append('revision.submitted');
    // The app role never had UPDATE on this table: privilege is the first
    // layer, revoked in the migration.
    await expect(
      withTenant(ctx, (tx) => tx.query(`UPDATE app.audit_event SET action = 'x'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  maybe('the application role is denied DELETE by revoked privilege', async () => {
    await expect(
      withTenant(ctx, (tx) => tx.query('DELETE FROM app.audit_event')),
    ).rejects.toThrow(/permission denied/i);
  });

  maybe('the trigger is the backstop for a privileged role', async () => {
    // A role WITH the privilege — a superuser, or a future misconfiguration —
    // is still stopped by the trigger. This is the layer that survives someone
    // granting the privilege back.
    await expect(admin(`UPDATE app.audit_event SET action = 'x'`)).rejects.toThrow(
      /append-only/i,
    );
    await expect(admin('DELETE FROM app.audit_event')).rejects.toThrow(/append-only/i);
  });
});
