/**
 * The transactional outbox, against a REAL Postgres.
 *
 * The one guarantee worth proving directly: a message enqueued in a transaction
 * that ROLLS BACK is never dispatched, because it was never committed. That is
 * the whole reason the outbox exists, and it cannot be tested with a mock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantContext } from '@rms/db';
import {
  backoffFor,
  claimBatch,
  enqueue,
  markDispatched,
  markFailure,
} from '../index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '11111111-1111-4111-8111-dddddddddddd';
const ctx: TenantContext = { organizationId: ORG, actorType: 'staff' };

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM app.outbox_message LIMIT 1');
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
  console.warn('\n  SKIPPING outbox tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n');
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

const AT = (iso: string): Date => new Date(iso);
let n = 0;
const uuid = (): string => {
  n += 1;
  return `f0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
};

beforeAll(async () => {
  if (!available) return;
  await admin(`TRUNCATE app.outbox_message RESTART IDENTITY CASCADE`);
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'Outbox Org', true)
       ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('the core guarantee — a rolled-back transaction dispatches nothing', () => {
  maybe('an outbox row written in a rolled-back transaction never exists', async () => {
    const id = uuid();
    // Force a rollback AFTER enqueue by throwing inside withTenant.
    await expect(
      withTenant(ctx, async (tx) => {
        await enqueue(tx, {
          id,
          organizationId: ORG,
          topic: 'email.invitation',
          payload: { invitationId: 'x' },
          now: AT('2026-08-31T00:00:00Z'),
        });
        // The business change failed after we enqueued. Everything rolls back.
        throw new Error('business change failed');
      }),
    ).rejects.toThrow('business change failed');

    // The row was never committed, so a worker will never see it.
    const rows = await admin('SELECT id FROM app.outbox_message WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(0);
  });

  maybe('an outbox row written in a committed transaction is durably present', async () => {
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, {
        id,
        organizationId: ORG,
        topic: 'email.submission',
        payload: { submissionId: 's1' },
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );
    const rows = await admin('SELECT status FROM app.outbox_message WHERE id = $1', [id]);
    expect(rows.rows[0]?.['status']).toBe('pending');
  });
});

describe('claiming', () => {
  maybe('claims only pending, due messages', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const due = uuid();
    const future = uuid();

    await withTenant(ctx, async (tx) => {
      await enqueue(tx, {
        id: due,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T00:00:00Z'),
      });
      await enqueue(tx, {
        id: future,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T02:00:00Z'), // available_at in the future
      });
    });

    const claimed = await withTenant(ctx, (tx) =>
      claimBatch(tx, AT('2026-08-31T01:00:00Z')),
    );
    const ids = claimed.map((m) => m.id);
    expect(ids).toContain(due);
    expect(ids).not.toContain(future);
  });

  maybe('a dispatched message is not claimed again', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, { id, organizationId: ORG, topic: 't', payload: {}, now: AT('2026-08-31T00:00:00Z') }),
    );

    await withTenant(ctx, async (tx) => {
      const batch = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      expect(batch).toHaveLength(1);
      await markDispatched(tx, id, AT('2026-08-31T00:01:00Z'));
    });

    const again = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T00:02:00Z')));
    expect(again).toHaveLength(0);

    const row = await admin('SELECT status, attempts FROM app.outbox_message WHERE id = $1', [id]);
    expect(row.rows[0]?.['status']).toBe('dispatched');
    expect(row.rows[0]?.['attempts']).toBe(1);
  });
});

describe('retry and dead-lettering', () => {
  maybe('a failure returns the message to pending with a backed-off availability', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, { id, organizationId: ORG, topic: 't', payload: {}, now: AT('2026-08-31T00:00:00Z') }),
    );

    const outcome = await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      return markFailure(tx, msg!, 'smtp timeout', AT('2026-08-31T00:01:00Z'));
    });
    expect(outcome).toBe('pending');

    const row = await admin(
      'SELECT status, attempts, available_at, last_error FROM app.outbox_message WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.['status']).toBe('pending');
    expect(row.rows[0]?.['attempts']).toBe(1);
    expect(row.rows[0]?.['last_error']).toBe('smtp timeout');
    // available_at moved forward by ~1 minute (the first backoff).
    expect(new Date(row.rows[0]?.['available_at'] as string).getTime()).toBe(
      AT('2026-08-31T00:02:00Z').getTime(),
    );

    // And it is NOT claimable until then.
    const tooEarly = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T00:01:30Z')));
    expect(tooEarly.map((m) => m.id)).not.toContain(id);
  });

  maybe('dead-letters after exhausting attempts', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, {
        id,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T00:00:00Z'),
        maxAttempts: 2,
      }),
    );

    // First failure -> pending (attempt 1 of 2).
    await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      const r = await markFailure(tx, msg!, 'err1', AT('2026-08-31T00:01:00Z'));
      expect(r).toBe('pending');
    });

    // Second failure -> dead (attempt 2 reaches maxAttempts).
    const second = await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:05:00Z'));
      return markFailure(tx, msg!, 'err2', AT('2026-08-31T00:05:00Z'));
    });
    expect(second).toBe('dead');

    const row = await admin('SELECT status, attempts FROM app.outbox_message WHERE id = $1', [id]);
    expect(row.rows[0]?.['status']).toBe('dead');
    expect(row.rows[0]?.['attempts']).toBe(2);

    // A dead message is never claimed again.
    const never = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T09:00:00Z')));
    expect(never).toHaveLength(0);
  });
});

describe('backoffFor (pure)', () => {
  it('doubles from a one-minute base', () => {
    expect(backoffFor(1)).toBe(60_000);
    expect(backoffFor(2)).toBe(120_000);
    expect(backoffFor(3)).toBe(240_000);
  });

  it('caps at one hour', () => {
    expect(backoffFor(20)).toBe(60 * 60_000);
  });
});
