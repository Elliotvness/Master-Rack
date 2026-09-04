/**
 * The deny recorder, against a REAL Postgres (task **T-14a**).
 *
 * `app.test.ts` proves the gate denies and that it calls a recorder. That is
 * the model half. §8.3's requirement is that **every deny is an audit event,
 * not just a log line**, and an injected recorder proves only that the gate
 * called something — F-02's shape, where the exhaustive check runs over the
 * fake under test. This file runs the real one: the row has to land in
 * `app.audit_event`, under the denied actor's own tenant, chained, and readable
 * back.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant } from '@rms/db';

import { createApp, databaseDenyRecorder, type Principal } from './app.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '88888888-8888-4888-8888-a00000000001';
const USER = '88888888-8888-4888-8888-a00000000002';
const RIVAL_ORG = '88888888-8888-4888-8888-a00000000003';

const CLIENT: Principal = {
  userId: USER,
  organizationId: ORG,
  actorType: 'client',
  role: 'CLIENT_USER',
};

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

/** Probed at MODULE LOAD — same reasoning as the other DB suites. */
async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('SELECT event_id FROM app.audit_event LIMIT 1');
    return true;
  } catch (error) {
    if (connected) {
      throw new Error(
        'app.audit_event is missing from a reachable database — migrations have not applied. ' +
          `Refusing to skip: "every deny is an audit event" verifies against a real table or ` +
          `not at all. Underlying error: ${String(error)}`,
      );
    }
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
  console.warn('\n  SKIPPING app deny-audit tests: no migrated database.\n');
}
const maybe = available ? it : it.skip;

beforeAll(async () => {
  if (!available) return;
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1,'Harbor Gate',false)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1,'Rival Gate',false)
     ON CONFLICT (id) DO NOTHING`,
    [RIVAL_ORG],
  );
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
     VALUES ($1,$2,'gate@example.test','Gate','client') ON CONFLICT (id) DO NOTHING`,
    [USER, ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('§8.3 — every deny is an audit event, written to the real table', () => {
  maybe('a client denied an internal route leaves a chained audit row in its OWN tenant', async () => {
    // A known event id, so every assertion below is about THE row this request
    // wrote and not about any row left by an earlier run. `rowCount > 0` over
    // an accumulating append-only table is a vacuous assertion, and it was:
    // pointing the recorder at another organization left it green.
    const eventId = crypto.randomUUID();
    const app = createApp({
      env: { CLAIM_LEASE_MINUTES: '10' },
      recordDeny: databaseDenyRecorder(),
      now: () => new Date('2026-09-03T12:00:00.000Z'),
      newId: () => eventId,
    });
    app.addHook('onRequest', async (request) => {
      request.principal = CLIENT;
    });

    const before = await admin(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE actor_user_id = $1`,
      [USER],
    );
    const res = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    expect(res.statusCode).toBe(404);
    await app.close();

    const rows = await admin(
      `SELECT action, outcome, actor_type, actor_organization_id, subject_organization_id,
              resource_type, reasons, prev_hash, hash
         FROM app.audit_event WHERE event_id = $1`,
      [eventId],
    );
    expect(rows.rowCount).toBe(1);
    const after = await admin(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE actor_user_id = $1`,
      [USER],
    );
    expect(after.rows[0]?.n).toBe((before.rows[0]?.n as number) + 1);
    expect(rows.rows[0]).toMatchObject({
      action: 'submission.read',
      outcome: 'denied',
      actor_type: 'client',
      actor_organization_id: ORG,
      subject_organization_id: ORG,
      resource_type: 'route',
    });
    // Chained, not merely inserted: a row with no hash is not an audit event.
    expect(rows.rows[0]?.hash).toMatch(/^[0-9a-f]{64}$/);

    // THE GUARANTEE THAT ACTUALLY EXISTS, tested in both directions.
    //
    // `audit_event_insert` is WITH CHECK (true) and `audit_event_select` keys
    // on the ROW's actor_organization_id, not on the transaction's GUC — so
    // the recorder's tenant context does not scope this write, and asserting
    // that it did stayed green through three plants. What is real: the row
    // names the denied actor's organization, and RLS then shows it to that
    // organization's clients and to nobody else's.
    const own = await withTenant({ organizationId: ORG, actorType: 'client' }, (tx) =>
      tx.query(`SELECT event_id FROM app.audit_event WHERE event_id = $1`, [eventId]),
    );
    expect(own.rowCount).toBe(1);

    const rival = await withTenant({ organizationId: RIVAL_ORG, actorType: 'client' }, (tx) =>
      tx.query(`SELECT event_id FROM app.audit_event WHERE event_id = $1`, [eventId]),
    );
    expect(rival.rowCount).toBe(0);
  });

  maybe('the denied request still answers 404 and reveals nothing about the audit write', async () => {
    const app = createApp({
      env: {},
      recordDeny: databaseDenyRecorder(),
      now: () => new Date('2026-09-03T12:05:00.000Z'),
    });
    app.addHook('onRequest', async (request) => {
      request.principal = CLIENT;
    });
    const res = await app.inject({ method: 'POST', url: '/api/internal/v1/organizations' });
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'not found' } });
    await app.close();
  });
});
