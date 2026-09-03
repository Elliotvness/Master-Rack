/**
 * The idempotency key store (task **T-13d**, decision **AD-3**).
 *
 * §8.3 requires idempotency keys on `submit`, `derive`, `clone` and `invite`.
 * AD-3's first sentence is the one that shapes this file: "Accepting the header
 * and handling it carelessly is worse than not offering it, because the client
 * then believes retrying is safe."
 *
 * ## The claim is the database's, not this module's
 *
 * `INSERT … ON CONFLICT (organization_id, key) DO NOTHING`. A `SELECT` then
 * `INSERT` is a race, and under a retry storm the race is exactly when it
 * fires. Everything else here is interpretation of what the database returned.
 *
 * ## Why the claim commits before the effect
 *
 * `claimIdempotencyKey` opens and COMMITS its own transaction; the effect then
 * runs in a different one. Sharing a transaction would be tidier and would
 * destroy the guarantee: the intent row would roll back with the effect, and a
 * crash between the call and the response would leave nothing — the next retry
 * would look like a first attempt and duplicate the work. AD-3 calls this
 * "three outcomes, not two", and the third outcome is the `in_flight` row a
 * dead process leaves behind.
 *
 * The cost is stated rather than hidden: a process that dies mid-effect strands
 * an `in_flight` row, and every retry of that key gets `409` until a human or a
 * sweeper settles it. That is the trade AD-3 chose over letting the second
 * caller through "because the first seems stuck" — which is precisely when
 * duplication costs most.
 *
 * ## What this module does NOT do
 *
 * It does not read a header, return a status code, or write an audit event. It
 * answers one question — may this intent proceed, and if not, why — and the
 * route layer (T-14) maps the answer onto `IDEMPOTENCY_IN_FLIGHT` (409) and
 * `IDEMPOTENCY_KEY_REUSED` (422). It also does not decide the client's key: a
 * key derived from a per-attempt UUID satisfies every constraint here and
 * defeats the whole mechanism, and no server-side check can tell the
 * difference.
 */

import { canonicaliseAll, sha256 } from '@rms/kernel-model';
import { withTenant, type TenantContext, type TenantTransaction } from '@rms/db';

/**
 * The three states AD-3 names, and no more.
 *
 * F-38 was a six-state status vocabulary invented for a table that needed
 * three. This alphabet is the decision record's own.
 */
export type IdempotencyOutcome = 'in_flight' | 'succeeded' | 'failed';

/** §8.3's four operations. A closed set: a fifth is a blueprint change. */
export const IDEMPOTENT_INTENTS = Object.freeze([
  'submit',
  'derive',
  'clone',
  'invite',
] as const);

export type IdempotentIntent = (typeof IDEMPOTENT_INTENTS)[number];

/**
 * What a claim attempt resolved to.
 *
 * Four, where AD-3 spells out three. The fourth — `settled` — is not an
 * addition to the decision but the thing it presupposes: AD-3 says "never
 * replay the first response to a *different* request", and a rule about
 * different requests only means something if the same request replays. Without
 * it §8.3's "a double-click must not produce two submissions" has no answer for
 * the second click after the first has succeeded: `409` is untrue (nothing is
 * in flight) and `422` is untrue (the payload matches).
 *
 * Recorded as a deviation for EL in `tasks/todo.md` rather than assumed.
 */
export type ClaimResult =
  /** Fresh claim. The caller runs the effect and must then settle this id. */
  | { readonly status: 'claimed'; readonly id: string }
  /** A duplicate is still running, or a process died holding it. Route: 409. */
  | { readonly status: 'in_flight'; readonly id: string }
  /** Same key, different request. Route: 422. Never replay. */
  | { readonly status: 'mismatch'; readonly id: string }
  /**
   * This key already ran to a terminal state with this exact request. The
   * caller must NOT re-run the effect. `outcome` is 'succeeded' or 'failed';
   * a failure is re-claimable and never reaches here — see `claimOn`.
   */
  | {
      readonly status: 'settled';
      readonly id: string;
      readonly outcome: 'succeeded';
      readonly resultRef: string | null;
    };

/**
 * The request hash AD-3 stores.
 *
 * `canonicaliseAll`, not `canonicalise`: the latter drops eight field names at
 * every depth — `note` and `author` among them — and
 * `POST /api/internal/v1/revisions/:id/notes` carries `note` as its only
 * meaningful field. Hashed with `canonicalise`, two different notes collide and
 * the payload guard cannot fire for the route that needs it most.
 */
export function requestHash(body: unknown): string {
  return sha256(canonicaliseAll(body));
}

/** 30 days, per AD-3 — and `idempotency.test.ts` proves it outlives the outbox. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ClaimParams {
  /** Caller-supplied row id, like every other id in this schema. */
  readonly id: string;
  readonly organizationId: string;
  readonly key: string;
  readonly intent: IdempotentIntent;
  /** The request body. Hashed here so no caller can hash it a second way. */
  readonly body: unknown;
  /** Supplied, never read from a clock — retries stay deterministic in a test. */
  readonly now: Date;
}

/**
 * Claim a key inside the caller's transaction.
 *
 * Exported for the tests that need to hold the transaction open and race it.
 * Production callers want `claimIdempotencyKey`, which owns its transaction and
 * therefore commits the intent before the effect starts.
 */
export async function claimOn(tx: TenantTransaction, params: ClaimParams): Promise<ClaimResult> {
  const hash = requestHash(params.body);
  const expiresAt = new Date(params.now.getTime() + RETENTION_MS);

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO app.idempotency_key
       (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_flight', $6, $7)
     ON CONFLICT (organization_id, key) DO NOTHING
     RETURNING id`,
    [params.id, params.organizationId, params.key, params.intent, hash, params.now, expiresAt],
  );
  if (inserted.rows.length === 1) {
    return { status: 'claimed', id: params.id };
  }

  const existing = await tx.query<{
    id: string;
    intent: string;
    request_hash: string;
    claim_outcome: IdempotencyOutcome;
    result_ref: string | null;
  }>(
    `SELECT id, intent, request_hash, claim_outcome, result_ref
       FROM app.idempotency_key
      WHERE organization_id = $1 AND key = $2`,
    [params.organizationId, params.key],
  );

  const row = existing.rows[0];
  if (row === undefined) {
    // Conflicted on insert, invisible on select. DEFENSIVE, and measured
    // rather than assumed: the obvious way to reach this — a concurrent
    // UNCOMMITTED insert of the same key — does not reach it, because
    // Postgres BLOCKS the speculative insertion until the holder commits or
    // aborts. `idempotency.db.test.ts` pins both halves of that: the claim
    // waits, and then reports `in_flight` if the holder committed and
    // `claimed` if it rolled back. An earlier draft of this file asserted the
    // opposite in a comment, and the test is what corrected it.
    //
    // What is left is a row that existed for the unique index and was gone by
    // the next statement — the retention sweep deleting an expired key between
    // the two. Refusing is the safe answer: the alternative is a second effect
    // for an intent whose evidence just vanished. Covered by a stub
    // transaction in `idempotency.test.ts`, because a branch nothing exercises
    // is a branch nobody has read.
    return { status: 'in_flight', id: params.id };
  }

  // The payload guard first, and before the state: a reused key with a
  // different body is a client error whatever the first attempt is doing.
  // `intent` joins the comparison because two operations that happen to hash
  // identically are still two intents.
  if (row.request_hash !== hash || row.intent !== params.intent) {
    return { status: 'mismatch', id: row.id };
  }

  if (row.claim_outcome === 'succeeded') {
    return { status: 'settled', id: row.id, outcome: 'succeeded', resultRef: row.result_ref };
  }

  if (row.claim_outcome === 'failed') {
    // A failed effect rolled back, so the intent never happened and may be
    // attempted again. Re-claiming is itself conditional on the row still being
    // 'failed', so two retries racing on a failed key cannot both win.
    const reclaimed = await tx.query<{ id: string }>(
      `UPDATE app.idempotency_key
          SET claim_outcome = 'in_flight', claimed_at = $2, settled_at = NULL, result_ref = NULL
        WHERE id = $1 AND claim_outcome = 'failed'
        RETURNING id`,
      [row.id, params.now],
    );
    return reclaimed.rows.length === 1
      ? { status: 'claimed', id: row.id }
      : { status: 'in_flight', id: row.id };
  }

  return { status: 'in_flight', id: row.id };
}

/**
 * Claim a key in a transaction of its own, committed before the caller's effect
 * begins. This is the production entry point; see the module note on why the
 * transaction is not shared.
 */
export async function claimIdempotencyKey(
  tenant: TenantContext,
  params: ClaimParams,
): Promise<ClaimResult> {
  return withTenant(tenant, (tx) => claimOn(tx, params));
}

/**
 * Record how the effect ended.
 *
 * Deliberately NOT run inside the effect's transaction. Settling with the
 * effect would make a success un-recordable when the commit itself is what
 * fails, and would put this row back under the effect's rollback — the state
 * the module note explains at length.
 *
 * The guard is `claim_outcome = 'in_flight'`: settling a row twice, or settling
 * one another caller has since re-claimed, writes nothing and reports it.
 */
export async function settleOn(
  tx: TenantTransaction,
  params: {
    readonly id: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly resultRef?: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  const resultRef = params.outcome === 'succeeded' ? (params.resultRef ?? null) : null;
  const settled = await tx.query(
    `UPDATE app.idempotency_key
        SET claim_outcome = $2, settled_at = $3, result_ref = $4
      WHERE id = $1 AND claim_outcome = 'in_flight'
      RETURNING id`,
    [params.id, params.outcome, params.now, resultRef],
  );
  return settled.rowCount === 1;
}

export async function settleIdempotencyKey(
  tenant: TenantContext,
  params: {
    readonly id: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly resultRef?: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  return withTenant(tenant, (tx) => settleOn(tx, params));
}

/**
 * Delete expired rows. AD-3's retention is a window, and a window nothing
 * sweeps is a table that grows forever.
 *
 * Runs under a staff or service context so one sweep covers every organization;
 * under a client context RLS narrows it to that client's own rows, which is
 * correct rather than broken, and returns a smaller count.
 */
export async function purgeExpiredOn(tx: TenantTransaction, now: Date): Promise<number> {
  const purged = await tx.query(`DELETE FROM app.idempotency_key WHERE expires_at <= $1`, [now]);
  return purged.rowCount ?? 0;
}
