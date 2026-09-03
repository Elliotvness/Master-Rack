/**
 * AD-3 against a REAL Postgres (task **T-13d**).
 *
 * The claim is a unique constraint, and a unique constraint is precisely the
 * thing a mock cannot stand in for: a fake that returns "already claimed" when
 * the test asks it to proves the test's own expectation, not the database's
 * arbitration. The concurrency case in particular has no meaning without two
 * real connections — that is the whole content of "a SELECT then INSERT is a
 * race, not a guard".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantContext } from '@rms/db';

import {
  RETENTION_MS,
  claimIdempotencyKey,
  claimOn,
  purgeExpiredOn,
  requestHash,
  settleIdempotencyKey,
  settleOn,
  type ClaimResult,
} from './idempotency.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '55555555-5555-4555-8555-b00000000001';
const OTHER_ORG = '55555555-5555-4555-8555-b00000000002';
const INTERNAL_ORG = '55555555-5555-4555-8555-b00000000003';

const NOW = new Date('2026-09-03T00:00:00.000Z');

const tenant: TenantContext = { organizationId: ORG, actorType: 'client' };
const otherTenant: TenantContext = { organizationId: OTHER_ORG, actorType: 'client' };
const staffTenant: TenantContext = { organizationId: INTERNAL_ORG, actorType: 'staff' };

let seq = 0;
/** Deterministic ids: a random one makes a failure unreproducible. */
function nextId(): string {
  seq += 1;
  return `55555555-5555-4555-8555-c${String(seq).padStart(11, '0')}`;
}

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

/** Probed at MODULE LOAD — see the note in tenancy.test.ts on why not beforeAll. */
async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('SELECT id FROM app.idempotency_key LIMIT 1');
    return true;
  } catch (error) {
    // F-29's shape, narrowed. "No database" is a legitimate skip — a developer
    // without Postgres. "Database, but no app.idempotency_key" is migration
    // 0011 having failed to apply, and skipping there would delete AD-3's
    // entire DB-backed verification while CI stayed green. Review reproduced
    // exactly that by renaming the table: 18 tests skipped, exit 0.
    if (connected) {
      throw new Error(
        'app.idempotency_key is missing from a database that is otherwise reachable. ' +
          'Migration 0011 has not applied. Refusing to skip: T-13d verifies against a real ' +
          `database or not at all. Underlying error: ${String(error)}`,
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
  console.warn(
    '\n  SKIPPING idempotency tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n',
  );
}
const maybe = available ? it : it.skip;

let keyCounter = 0;
/** A fresh key per case, so one case cannot decide another's outcome. */
function freshKey(label: string): string {
  keyCounter += 1;
  return `${label}-${keyCounter}`;
}

async function claim(
  key: string,
  body: unknown,
  ctx: TenantContext = tenant,
  intent: 'submit' | 'derive' | 'clone' | 'invite' = 'submit',
): Promise<ClaimResult> {
  return claimIdempotencyKey(ctx, {
    id: nextId(),
    organizationId: ctx.organizationId,
    key,
    intent,
    body,
    now: NOW,
  });
}

/** Open a transaction that inserts `key` and does not commit. Caller ends it. */
async function openHolder(key: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: APP_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', ORG]);
  await client.query('SELECT set_config($1, $2, true)', ['app.actor_type', 'client']);
  await client.query(
    `INSERT INTO app.idempotency_key
       (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
     VALUES ($1,$2,$3,'submit',$4,'in_flight',$5,$6)`,
    [nextId(), ORG, key, requestHash({ revisionId: 'r1' }), NOW, new Date(NOW.getTime() + RETENTION_MS)],
  );
  return client;
}

/** True if `promise` has resolved within a beat. Used to assert BLOCKED. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  const raced = await Promise.race([
    promise.then(() => true).catch(() => true),
    new Promise((resolve) => setTimeout(() => resolve(pending), 250)),
  ]);
  return raced !== pending;
}

beforeAll(async () => {
  if (!available) return;
  await admin(`DELETE FROM app.idempotency_key`);
  await admin(
    `INSERT INTO app.organization (id, name, is_internal)
     VALUES ($1,'Harbor Idem',false), ($2,'Rival Idem',false), ($3,'Internal Idem',true)
     ON CONFLICT (id) DO NOTHING`,
    [ORG, OTHER_ORG, INTERNAL_ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('AD-3 — the atomic claim', () => {
  maybe('a first claim wins and a retry of the same intent does not re-run it', async () => {
    const key = freshKey('submit');
    const first = await claim(key, { revisionId: 'r1' });
    expect(first.status).toBe('claimed');

    // Still in flight: the effect has not settled.
    const duplicate = await claim(key, { revisionId: 'r1' });
    expect(duplicate.status).toBe('in_flight');

    expect(await settleIdempotencyKey(tenant, { id: first.id, outcome: 'succeeded', resultRef: ORG, now: NOW })).toBe(true);

    const afterSuccess = await claim(key, { revisionId: 'r1' });
    expect(afterSuccess).toMatchObject({ status: 'settled', outcome: 'succeeded', resultRef: ORG });
  });

  maybe('the same key with a different body is refused, not replayed', async () => {
    const key = freshKey('mismatch');
    const first = await claim(key, { revisionId: 'r1' });
    expect(first.status).toBe('claimed');

    const different = await claim(key, { revisionId: 'r2' });
    expect(different.status).toBe('mismatch');

    // And it stays refused after the first has succeeded — a settled key must
    // never hand its result to a request that did not ask for it.
    await settleIdempotencyKey(tenant, { id: first.id, outcome: 'succeeded', now: NOW });
    expect((await claim(key, { revisionId: 'r2' })).status).toBe('mismatch');
  });

  maybe('a body differing only in a field the CONTENT hash drops is still a different body', async () => {
    const key = freshKey('note');
    expect((await claim(key, { note: 'first' })).status).toBe('claimed');
    // canonicalise() cannot tell these apart. The guard must.
    expect((await claim(key, { note: 'second' })).status).toBe('mismatch');
  });

  maybe('one key reused for a different operation is a reuse, not a retry', async () => {
    const key = freshKey('intent');
    expect((await claim(key, {}, tenant, 'submit')).status).toBe('claimed');
    expect((await claim(key, {}, tenant, 'derive')).status).toBe('mismatch');
  });

  maybe('a failed effect leaves the intent claimable again', async () => {
    const key = freshKey('failed');
    const first = await claim(key, { revisionId: 'r1' });
    expect(first.status).toBe('claimed');
    expect(await settleIdempotencyKey(tenant, { id: first.id, outcome: 'failed', now: NOW })).toBe(true);

    const retry = await claim(key, { revisionId: 'r1' });
    expect(retry.status).toBe('claimed');
    // Re-claimed rather than duplicated: still one row for this key.
    const rows = await admin(
      `SELECT claim_outcome, settled_at, result_ref FROM app.idempotency_key
        WHERE organization_id = $1 AND key = $2`,
      [ORG, key],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ claim_outcome: 'in_flight', settled_at: null, result_ref: null });
  });

  maybe('a failed key retried long after its window returns a result, not a constraint error', async () => {
    // CHECK (expires_at > claimed_at) turned a legitimate late retry into a raw
    // Postgres error out of claimOn, because the re-claim moved claimed_at and
    // left expires_at behind. Found by review; this is the case that pins it.
    const key = freshKey('late-retry');
    const first = await claim(key, { revisionId: 'r1' });
    await settleIdempotencyKey(tenant, { id: first.id, outcome: 'failed', now: NOW });

    const muchLater = new Date(NOW.getTime() + RETENTION_MS + 24 * 60 * 60 * 1000);
    const retry = await claimIdempotencyKey(tenant, {
      id: nextId(),
      organizationId: ORG,
      key,
      intent: 'submit',
      body: { revisionId: 'r1' },
      now: muchLater,
    });
    expect(retry.status).toBe('claimed');

    const rows = await admin(`SELECT claimed_at, expires_at FROM app.idempotency_key WHERE id = $1`, [
      first.id,
    ]);
    const row = rows.rows[0] as { claimed_at: Date; expires_at: Date };
    expect(row.expires_at.getTime()).toBe(row.claimed_at.getTime() + RETENTION_MS);
  });

  maybe('the schema refuses an intent outside §8.3’s four', async () => {
    await expect(
      admin(
        `INSERT INTO app.idempotency_key
           (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
         VALUES ($1,$2,$3,'approve',$4,'in_flight',$5,$6)`,
        [nextId(), ORG, freshKey('bad-intent'), 'd'.repeat(64), NOW, new Date(NOW.getTime() + 1000)],
      ),
    ).rejects.toThrow(/idempotency_intent_known/);
  });

  maybe('the same key in another organization is a different key', async () => {
    const key = freshKey('tenant');
    expect((await claim(key, { revisionId: 'r1' })).status).toBe('claimed');
    expect((await claim(key, { revisionId: 'r1' }, otherTenant)).status).toBe('claimed');
  });
});

describe('AC — exactly one of two simultaneous claims wins', () => {
  maybe('two claims fired at once produce one winner and one 409', async () => {
    const key = freshKey('race');
    const body = { revisionId: 'raced' };

    // Genuinely concurrent: both promises are in flight before either is
    // awaited, and withTenant takes a separate pooled connection for each.
    const [a, b] = await Promise.all([claim(key, body), claim(key, body)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['claimed', 'in_flight']);

    const rows = await admin(
      `SELECT count(*)::int AS n FROM app.idempotency_key WHERE organization_id = $1 AND key = $2`,
      [ORG, key],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  maybe('ten simultaneous claims produce exactly one winner', async () => {
    const key = freshKey('storm');
    const body = { revisionId: 'stormed' };
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(key, body)));
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'in_flight')).toHaveLength(9);
  });

  maybe('a claim racing an UNCOMMITTED holder waits, then reports in flight once it commits', async () => {
    // The subtlety, measured rather than assumed. `ON CONFLICT DO NOTHING`
    // does NOT return immediately over an in-progress duplicate: the
    // speculative insertion blocks until the holder commits or aborts. So the
    // second caller cannot observe a half-state — it observes the outcome.
    const key = freshKey('uncommitted-commit');
    const holder = await openHolder(key);
    try {
      const contender = claim(key, { revisionId: 'r1' });
      expect(await settled(contender)).toBe(false); // genuinely blocked
      await holder.query('COMMIT');
      expect((await contender).status).toBe('in_flight');
    } finally {
      await holder.end();
    }
  });

  maybe('the same claim WINS if the holder rolls back, so a blocked caller is not a refused one', async () => {
    const key = freshKey('uncommitted-rollback');
    const holder = await openHolder(key);
    try {
      const contender = claim(key, { revisionId: 'r1' });
      expect(await settled(contender)).toBe(false);
      await holder.query('ROLLBACK');
      expect((await contender).status).toBe('claimed');
    } finally {
      await holder.end();
    }
  });
});

describe('AD-3 — the intent row outlives the effect that failed', () => {
  maybe('an effect that rolls back leaves the claim standing, which is the third outcome', async () => {
    // The guarantee "the intent row is written BEFORE the effect" is only worth
    // stating if something goes red when it stops being true. Review's finding:
    // nothing did. This is that test — the claim owns its transaction, the
    // effect owns a different one, and the effect's rollback must not take the
    // evidence with it.
    const key = freshKey('survives-rollback');
    const claimed = await claim(key, { revisionId: 'r1' });
    expect(claimed.status).toBe('claimed');

    await expect(
      withTenant(tenant, async (tx) => {
        await tx.query(`SELECT 1`);
        throw new Error('the effect failed');
      }),
    ).rejects.toThrow('the effect failed');

    const rows = await admin(
      `SELECT claim_outcome FROM app.idempotency_key WHERE organization_id = $1 AND key = $2`,
      [ORG, key],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.claim_outcome).toBe('in_flight');

    // And the retry is refused rather than duplicating the effect.
    expect((await claim(key, { revisionId: 'r1' })).status).toBe('in_flight');
  });
});

describe('settling', () => {
  maybe('settling twice writes once, and reports the second as a no-op', async () => {
    const key = freshKey('settle-twice');
    const first = await claim(key, {});
    expect(await settleIdempotencyKey(tenant, { id: first.id, outcome: 'succeeded', now: NOW })).toBe(true);
    expect(await settleIdempotencyKey(tenant, { id: first.id, outcome: 'failed', now: NOW })).toBe(false);
    const rows = await admin(`SELECT claim_outcome FROM app.idempotency_key WHERE id = $1`, [first.id]);
    expect(rows.rows[0]?.claim_outcome).toBe('succeeded');
  });

  maybe('settling an id that was never claimed writes nothing', async () => {
    expect(await settleIdempotencyKey(tenant, { id: nextId(), outcome: 'succeeded', now: NOW })).toBe(false);
  });

  maybe('a failure never carries a result reference, even when one is offered', async () => {
    const key = freshKey('failed-ref');
    const first = await claim(key, {});
    await settleIdempotencyKey(tenant, { id: first.id, outcome: 'failed', resultRef: ORG, now: NOW });
    const rows = await admin(`SELECT result_ref FROM app.idempotency_key WHERE id = $1`, [first.id]);
    expect(rows.rows[0]?.result_ref).toBeNull();
  });
});

describe('the schema refuses what the application must not be trusted to remember', () => {
  maybe('an empty key, a short hash and a backwards expiry are all refused by CHECKs', async () => {
    const base = [nextId(), ORG, 'k', 'submit', 'a'.repeat(64), NOW, new Date(NOW.getTime() + 1000)];
    const insert = `INSERT INTO app.idempotency_key
        (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,'in_flight',$6,$7)`;

    await expect(admin(insert, [base[0], ORG, '   ', 'submit', base[4], NOW, base[6]])).rejects.toThrow(
      /idempotency_key_nonempty/,
    );
    await expect(admin(insert, [base[0], ORG, 'k1', 'submit', 'abc', NOW, base[6]])).rejects.toThrow(
      /idempotency_request_hash_shape/,
    );
    await expect(
      admin(insert, [base[0], ORG, 'k2', 'submit', base[4], NOW, new Date(NOW.getTime() - 1000)]),
    ).rejects.toThrow(/idempotency_expiry_after_claim/);
    // A blank intent is outside §8.3's four, so the closed set catches it.
    await expect(admin(insert, [base[0], ORG, 'k3', '  ', base[4], NOW, base[6]])).rejects.toThrow(
      /idempotency_intent_known/,
    );
  });

  maybe('a settled row without a settling time is refused, and so is a failure with a result', async () => {
    const id = nextId();
    await admin(
      `INSERT INTO app.idempotency_key
         (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
       VALUES ($1,$2,$3,'submit',$4,'in_flight',$5,$6)`,
      [id, ORG, freshKey('checks'), 'b'.repeat(64), NOW, new Date(NOW.getTime() + 1000)],
    );
    await expect(
      admin(`UPDATE app.idempotency_key SET claim_outcome = 'succeeded' WHERE id = $1`, [id]),
    ).rejects.toThrow(/idempotency_settled_consistency/);
    await expect(
      admin(
        `UPDATE app.idempotency_key SET claim_outcome = 'failed', settled_at = $2, result_ref = $3 WHERE id = $1`,
        [id, NOW, ORG],
      ),
    ).rejects.toThrow(/idempotency_result_only_on_success/);
  });
});

describe('tenancy and retention', () => {
  maybe('a client cannot see another organization’s key, and RLS returns empty not an error', async () => {
    const key = freshKey('isolation');
    await claim(key, { revisionId: 'r1' });
    const seen = await withTenant(otherTenant, async (tx) =>
      tx.query(`SELECT id FROM app.idempotency_key WHERE key = $1`, [key]),
    );
    expect(seen.rowCount).toBe(0);
  });

  maybe('the sweep deletes expired rows and leaves live ones', async () => {
    const expired = freshKey('expired');
    const live = freshKey('live');
    const long = new Date(NOW.getTime() - RETENTION_MS - 1000);
    await claim(expired, {}, tenant);
    await admin(`UPDATE app.idempotency_key SET claimed_at = $2, expires_at = $3 WHERE key = $1`, [
      expired,
      long,
      new Date(NOW.getTime() - 1000),
    ]);
    await claim(live, {}, tenant);

    const purged = await withTenant(staffTenant, (tx) => purgeExpiredOn(tx, NOW));
    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await admin(`SELECT key FROM app.idempotency_key WHERE key IN ($1,$2)`, [
      expired,
      live,
    ]);
    expect(remaining.rows.map((r) => r['key'])).toEqual([live]);
  });

  maybe('claimOn inside a caller’s transaction behaves the same as the owning entry point', async () => {
    const key = freshKey('claim-on');
    const first = await withTenant(tenant, (tx) =>
      claimOn(tx, { id: nextId(), organizationId: ORG, key, intent: 'invite', body: {}, now: NOW }),
    );
    expect(first.status).toBe('claimed');
    const settled = await withTenant(tenant, (tx) =>
      settleOn(tx, { id: first.id, outcome: 'succeeded', now: NOW }),
    );
    expect(settled).toBe(true);
  });
});
