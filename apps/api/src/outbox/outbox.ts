/**
 * The transactional outbox.
 *
 * Blueprint §6.2. Side effects — emails, notifications, WORM uploads — must not
 * fire for a transaction that rolled back, and must not be lost if the process
 * dies after committing. Both failures are avoided by writing an outbox row IN
 * the business transaction and dispatching it later from a worker:
 *
 *   - roll back the business transaction, and the outbox row rolls back with
 *     it: nothing is dispatched for work that did not happen.
 *   - commit, and the row is durably present: a worker will pick it up even if
 *     the original process dies the instant after commit.
 *
 * enqueue() takes the caller's transaction, so it shares its fate. The worker
 * functions manage their own claim/dispatch cycle. `now` is always supplied,
 * never read from a clock, so retries and backoff are deterministic in a test.
 */

import type { TenantTransaction } from '@rms/db';

export type OutboxStatus = 'pending' | 'dispatched' | 'failed' | 'dead';

export interface OutboxMessage {
  readonly id: string;
  readonly organizationId: string | null;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/**
 * Enqueue a side effect IN the caller's transaction. If the caller rolls back,
 * this row never existed.
 *
 * The payload must carry no secret: it references ids the worker resolves under
 * its own authority, so a leaked outbox row leaks a reference, not a credential.
 */
export async function enqueue(
  tx: TenantTransaction,
  params: {
    id: string;
    organizationId: string | null;
    topic: string;
    payload: Record<string, unknown>;
    now: Date;
    maxAttempts?: number;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO app.outbox_message
       (id, organization_id, topic, payload, status, attempts, max_attempts,
        available_at, created_at)
     VALUES ($1, $2, $3, $4, 'pending', 0, $5, $6, $6)`,
    [
      params.id,
      params.organizationId,
      params.topic,
      JSON.stringify(params.payload),
      params.maxAttempts ?? 5,
      params.now,
    ],
  );
}

interface ClaimRow {
  id: string;
  organization_id: string | null;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Claim up to `limit` pending, due messages for dispatch.
 *
 * FOR UPDATE SKIP LOCKED is the point: many workers can claim from the same
 * table at once, each skipping rows another worker already holds, so the queue
 * drains in parallel without two workers grabbing the same message. The claim
 * marks rows so a crashed worker's messages become due again rather than being
 * lost — here, by moving them out of 'pending' only on a definite outcome, and
 * relying on `available_at` plus the lock for in-flight safety.
 *
 * Runs inside the caller's transaction; the rows stay locked until it commits.
 */
export async function claimBatch(
  tx: TenantTransaction,
  now: Date,
  limit = 20,
): Promise<readonly OutboxMessage[]> {
  const result = await tx.query<ClaimRow>(
    `SELECT id, organization_id, topic, payload, attempts, max_attempts
       FROM app.outbox_message
      WHERE status = 'pending' AND available_at <= $1
      ORDER BY available_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [now, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    topic: row.topic,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  }));
}

/** Mark a message dispatched. Terminal success. */
export async function markDispatched(
  tx: TenantTransaction,
  id: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE app.outbox_message
        SET status = 'dispatched', dispatched_at = $2, attempts = attempts + 1
      WHERE id = $1`,
    [id, now],
  );
}

/**
 * Record a failed attempt. If attempts are exhausted, the message is
 * dead-lettered (status 'dead') rather than retried forever; otherwise it is
 * returned to 'pending' with an exponentially backed-off `available_at`.
 *
 * Backoff doubles from a one-minute base, so attempt 1 waits ~1 min, attempt 2
 * ~2 min, and so on — a slow enough climb that a transient outage is ridden out
 * without a thundering retry, capped so it never waits absurdly long.
 */
export async function markFailure(
  tx: TenantTransaction,
  message: Pick<OutboxMessage, 'id' | 'attempts' | 'maxAttempts'>,
  error: string,
  now: Date,
): Promise<OutboxStatus> {
  const nextAttempts = message.attempts + 1;

  if (nextAttempts >= message.maxAttempts) {
    await tx.query(
      `UPDATE app.outbox_message
          SET status = 'dead', attempts = $2, last_error = $3
        WHERE id = $1`,
      [message.id, nextAttempts, error],
    );
    return 'dead';
  }

  const backoffMs = backoffFor(nextAttempts);
  const availableAt = new Date(now.getTime() + backoffMs);
  await tx.query(
    `UPDATE app.outbox_message
        SET status = 'pending', attempts = $2, last_error = $3, available_at = $4
      WHERE id = $1`,
    [message.id, nextAttempts, error, availableAt],
  );
  return 'pending';
}

const ONE_MINUTE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * ONE_MINUTE_MS;

/** Exponential backoff, one-minute base, capped at an hour. Pure and testable. */
export function backoffFor(attempt: number): number {
  const raw = ONE_MINUTE_MS * 2 ** (attempt - 1);
  return Math.min(raw, MAX_BACKOFF_MS);
}
