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
 * A process that dies mid-effect strands an `in_flight` row. That used to mean
 * `409` for every retry of that key for thirty days; since EL's decision of
 * 2026-09-03 it means `409` until the lease runs out or an operator releases
 * it, and `lease_epoch` (migration 0013) stops the overtaken holder settling
 * the claim it lost.
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

import { CanonicalError, canonicaliseAll, sha256 } from '@rms/kernel-model';

import { appendAuditEvent } from '../audit/chain.js';
import { withTenant, type TenantContext, type TenantTransaction } from '@rms/db';
import type { ErrorCode } from '@rms/contracts';

/**
 * The four states this table holds.
 *
 * Three came from AD-3; `abandoned` is EL's operator release (2026-09-03) and
 * is deliberately distinct from `failed` — an audit reader needs to know
 * whether the effect reported its own rollback or a human overrode it. F-38
 * was a six-state vocabulary invented for a table that needed three; every one
 * of these four is named by a decision on the record.
 */
export type IdempotencyOutcome = 'in_flight' | 'succeeded' | 'failed' | 'abandoned';

/**
 * Terminal states a key may be claimed again from.
 *
 * `failed` is the effect reporting its own rollback; `abandoned` is an operator
 * overriding a claim that reported nothing at all. Both mean the intent did not
 * happen, so both are re-claimable — and they stay distinct because an audit
 * reader needs to know which one ended it.
 */
const RECLAIMABLE: ReadonlySet<IdempotencyOutcome> = new Set(['failed', 'abandoned']);

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
  /**
   * Fresh claim, or a re-claim. The caller runs the effect and must settle
   * with BOTH the id and the `epoch` — the fence token this claim was granted
   * under. A holder whose lease is later taken over carries a stale epoch and
   * can no longer settle, which is what stops two effects from settling one
   * key. Review found the absence of this the hard way; see migration 0013.
   */
  | { readonly status: 'claimed'; readonly id: string; readonly epoch: number }
  /** A duplicate is still running, or a process died holding it. Route: 409. */
  | { readonly status: 'in_flight'; readonly id: string }
  /** Same key, different request. Route: 422. Never replay. */
  | { readonly status: 'mismatch'; readonly id: string }
  /**
   * The body cannot be canonicalised, so it cannot be hashed, so no guard can
   * be applied to it. Route: 400.
   *
   * Found by review: `requestHash` was the first statement in `claimOn` and it
   * was unguarded, so `{"qty":-0}` — which survives JSON.parse and a numeric
   * DTO — turned any idempotent route into a 500. AD-3's opening line is that
   * careless handling is worse than not offering the header at all, and an
   * unhandled throw out of the guard is the careless case.
   */
  | { readonly status: 'unhashable'; readonly id: string; readonly reason: string }
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

/**
 * `requestHash`, total. Returns the reason instead of throwing, so a body the
 * canonicaliser refuses becomes a modelled refusal rather than a 500.
 *
 * Only `CanonicalError` is caught. Anything else is a defect in this process,
 * not a property of the request, and swallowing it would hide it.
 */
export function tryRequestHash(body: unknown): { hash: string } | { reason: string } {
  try {
    return { hash: requestHash(body) };
  } catch (error) {
    if (error instanceof CanonicalError) return { reason: error.message };
    throw error;
  }
}

/**
 * The status code each outcome carries, as a table rather than as a convention
 * a route layer is trusted to remember.
 *
 * Review's point, and it was right: the acceptance criteria say the guard
 * RETURNS 422 and 409, and a module that returns `'mismatch'` and stops has
 * met half of that. Nothing would have gone red if T-14 mapped `mismatch` onto
 * 409. `null` means the caller proceeds or replays — not an error at all.
 */
export function errorCodeFor(status: ClaimResult['status']): ErrorCode | null {
  switch (status) {
    case 'mismatch':
      return 'IDEMPOTENCY_KEY_REUSED';
    case 'in_flight':
      return 'IDEMPOTENCY_IN_FLIGHT';
    case 'unhashable':
      return 'MALFORMED_REQUEST';
    case 'claimed':
    case 'settled':
      return null;
  }
}

/** 30 days, per AD-3 — and `idempotency.test.ts` proves it outlives the outbox. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The default lease, in minutes. EL's decision, 2026-09-03. */
export const DEFAULT_CLAIM_LEASE_MINUTES = 10;

/**
 * How long a claim may be held before another caller may take it.
 *
 * Configurable through `CLAIM_LEASE_MINUTES` so the window can be raised the
 * moment a legitimate effect is seen to outrun it, without a code deploy.
 *
 * **A malformed value THROWS** rather than falling back to the default: a
 * setting that silently ignores what it was given is a control that says it is
 * configurable and is not — this repository's recurring defect, in an
 * environment variable.
 *
 * **Where it throws is the honest part.** This function is called lazily, from
 * one branch of `claimOn`, so today a typo'd `CLAIM_LEASE_MINUTES` lets the
 * process start, serves every first-attempt request, and throws at the first
 * DUPLICATE claim — the exact path the lease exists to protect. Review caught
 * an earlier draft of this docstring claiming it "stops the process at
 * startup" when there is no startup to stop: `apps/api` has no server, and
 * `assertRouteCoverage` has no caller either. `assertConfiguration()` below is
 * the function that makes it early, and T-14a's acceptance criteria now
 * require `createApp()` to call it.
 *
 * The environment is passed in rather than read from module scope, so this is
 * testable without mutating global state — the same reason
 * `configureDatabase` takes a connection string.
 */
export function claimLeaseMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env['CLAIM_LEASE_MINUTES'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CLAIM_LEASE_MINUTES * 60_000;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes <= 0) {
    throw new RangeError(
      `CLAIM_LEASE_MINUTES must be a positive whole number of minutes; got '${raw}'. ` +
        'Refusing to fall back to the default: a lease nobody chose is worse than no lease.',
    );
  }
  return minutes * 60_000;
}

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
  /**
   * How long a claim may be held before this call may take it over. Defaults
   * to `claimLeaseMs()`; supplied explicitly by tests so a lease case does not
   * depend on the clock or on the environment.
   */
  readonly leaseMs?: number;
}

/**
 * Claim a key inside the caller's transaction.
 *
 * Exported for the tests that need to hold the transaction open and race it.
 * Production callers want `claimIdempotencyKey`, which owns its transaction and
 * therefore commits the intent before the effect starts.
 */
export async function claimOn(tx: TenantTransaction, params: ClaimParams): Promise<ClaimResult> {
  const hashed = tryRequestHash(params.body);
  if (!('hash' in hashed)) {
    return { status: 'unhashable', id: params.id, reason: hashed.reason };
  }
  const hash = hashed.hash;
  const expiresAt = new Date(params.now.getTime() + RETENTION_MS);

  const inserted = await tx.query<{ id: string; lease_epoch: number }>(
    `INSERT INTO app.idempotency_key
       (id, organization_id, key, intent, request_hash, claim_outcome, claimed_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_flight', $6, $7)
     ON CONFLICT (organization_id, key) DO NOTHING
     RETURNING id, lease_epoch`,
    [params.id, params.organizationId, params.key, params.intent, hash, params.now, expiresAt],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow !== undefined) {
    return { status: 'claimed', id: params.id, epoch: insertedRow.lease_epoch };
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

  if (RECLAIMABLE.has(row.claim_outcome)) {
    // A failed effect rolled back, so the intent never happened and may be
    // attempted again. Re-claiming is itself conditional on the row still being
    // 'failed', so two retries racing on a failed key cannot both win.
    // `expires_at` moves with `claimed_at`. Review found the omission: the
    // schema carries CHECK (expires_at > claimed_at), so a legitimate retry of
    // a failed key more than 30 days later raised a raw constraint violation
    // out of this function instead of returning a ClaimResult. A re-claim is a
    // fresh claim and gets a fresh window.
    //
    // The UPDATE is conditional on the state it read, so two retries racing on
    // one re-claimable key cannot both win — the loser reads zero rows and is
    // told the key is in flight, which by then it is.
    const reclaimed = await tx.query<{ id: string; lease_epoch: number }>(
      `UPDATE app.idempotency_key
          SET claim_outcome = 'in_flight', claimed_at = $2, expires_at = $3,
              settled_at = NULL, result_ref = NULL, lease_epoch = lease_epoch + 1
        WHERE id = $1 AND claim_outcome = ANY($4::app.idempotency_outcome[])
        RETURNING id, lease_epoch`,
      [row.id, params.now, expiresAt, [...RECLAIMABLE]],
    );
    const reclaimedRow = reclaimed.rows[0];
    return reclaimedRow !== undefined
      ? { status: 'claimed', id: row.id, epoch: reclaimedRow.lease_epoch }
      : { status: 'in_flight', id: row.id };
  }

  // Still `in_flight`. Has the lease run out?
  //
  // This is the half of EL's decision that needs no human. The UPDATE carries
  // the cutoff in its own WHERE clause rather than comparing in TypeScript
  // first: a read-then-write here is the same race AD-3 rejected for the claim
  // itself, and under a retry storm it is exactly when it fires.
  const lease = params.leaseMs ?? claimLeaseMs();
  const cutoff = new Date(params.now.getTime() - lease);
  const seized = await tx.query<{ id: string; lease_epoch: number }>(
    `UPDATE app.idempotency_key
        SET claimed_at = $2, expires_at = $3, lease_epoch = lease_epoch + 1
      WHERE id = $1 AND claim_outcome = 'in_flight' AND claimed_at <= $4
      RETURNING id, lease_epoch`,
    [row.id, params.now, expiresAt, cutoff],
  );
  const seizedRow = seized.rows[0];
  if (seizedRow !== undefined) {
    return { status: 'claimed', id: row.id, epoch: seizedRow.lease_epoch };
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
    /**
     * The fence token this caller was claimed under. Required, and the reason
     * the signature changed: without it an overtaken holder settles a claim it
     * no longer holds, and the client is handed that holder's result for an
     * effect that ran twice.
     */
    readonly epoch: number;
    readonly outcome: 'succeeded' | 'failed';
    readonly resultRef?: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  const resultRef = params.outcome === 'succeeded' ? (params.resultRef ?? null) : null;
  const settled = await tx.query(
    `UPDATE app.idempotency_key
        SET claim_outcome = $2, settled_at = $3, result_ref = $4
      WHERE id = $1 AND claim_outcome = 'in_flight' AND lease_epoch = $5
      RETURNING id`,
    [params.id, params.outcome, params.now, resultRef, params.epoch],
  );
  return settled.rowCount === 1;
}

export async function settleIdempotencyKey(
  tenant: TenantContext,
  params: {
    readonly id: string;
    readonly epoch: number;
    readonly outcome: 'succeeded' | 'failed';
    readonly resultRef?: string | null;
    readonly now: Date;
  },
): Promise<boolean> {
  return withTenant(tenant, (tx) => settleOn(tx, params));
}

/**
 * An operator releases a stranded claim (EL's decision, 2026-09-03).
 *
 * The 1% the lease does not cover: the lease is wrong for this effect, or the
 * process was doing something genuinely long and has since died anyway. The
 * row goes to `abandoned` — terminal, and re-claimable — so the next retry of
 * that key proceeds instead of collecting a `409` for thirty days.
 *
 * **The audit event is written in the SAME transaction as the release**, so a
 * release without a record is not a state this can reach. That is the whole
 * reason this function owns a transaction rather than taking one: an operator
 * override of a safety control that leaves no trace is worse than the stranded
 * claim it fixes.
 *
 * Authorization is NOT decided here. The route layer (T-14e) refuses anyone
 * but an `INTERNAL_ADMIN` through the `idempotency.release` action, and this
 * function records who it was told did it. A module that both authorizes and
 * acts is one where the check can be forgotten by the next caller.
 *
 * Returns false when there was nothing to release — no such key, another
 * organization's key, or a claim that had already settled on its own. False is
 * an honest "nothing happened", and no audit event is written for it.
 */
export async function releaseClaim(
  tenant: TenantContext,
  params: {
    readonly organizationId: string;
    readonly key: string;
    /** The operator. Recorded in the audit event; never inferred here. */
    readonly releasedBy: string;
    /** Caller-supplied id for the audit row, like every other id here. */
    readonly auditEventId: string;
    readonly now: Date;
    readonly reason?: string;
  },
): Promise<boolean> {
  if (tenant.actorType !== 'staff') {
    // Review found this fabricating its actor: `actorType` was hardcoded
    // 'staff' and a client tenant could release its own claim, producing an
    // audit event asserting a staff actor inside a client organization. A
    // function whose stated justification is that an override must leave a
    // trace must not be able to leave a FALSE one.
    throw new Error(
      `releaseClaim requires a staff context; got '${tenant.actorType}'. ` +
        'Releasing a stranded claim overrides a safety control and is an INTERNAL_ADMIN action.',
    );
  }
  return withTenant(tenant, async (tx) => {
    const released = await tx.query<{ id: string }>(
      `UPDATE app.idempotency_key
          SET claim_outcome = 'abandoned', settled_at = $3, result_ref = NULL,
              lease_epoch = lease_epoch + 1
        WHERE organization_id = $1 AND key = $2 AND claim_outcome = 'in_flight'
        RETURNING id`,
      [params.organizationId, params.key, params.now],
    );
    const row = released.rows[0];
    if (row === undefined) return false;

    const at = params.now.toISOString();
    await appendAuditEvent(tx, {
      eventId: params.auditEventId,
      recordedAt: at,
      content: {
        occurredAt: at,
        actorUserId: params.releasedBy,
        actorType: tenant.actorType,
        actorOrganizationId: tenant.organizationId,
        impersonatedBy: null,
        subjectOrganizationId: params.organizationId,
        action: 'idempotency.release',
        resourceType: 'idempotency_key',
        resourceId: row.id,
        outcome: 'success',
        reasons: [params.reason ?? 'operator released a stranded claim'],
      },
    });
    return true;
  });
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
  // SETTLED rows only. Review found this deleting `in_flight` rows, which frees
  // a key an effect may still hold — retention bookkeeping quietly undoing the
  // guard. An `in_flight` row older than the retention window is a bug, and
  // leaving it visible is the point: the lease and the operator release exist
  // to end one, not a DELETE that hides it.
  const purged = await tx.query(
    `DELETE FROM app.idempotency_key WHERE expires_at <= $1 AND claim_outcome <> 'in_flight'`,
    [now],
  );
  return purged.rowCount ?? 0;
}

/**
 * Validate everything this module reads from the environment, once, loudly.
 *
 * **This is not called at boot yet, and saying otherwise would be the defect
 * this repository hunts.** There is no boot: `apps/api` has no server, and
 * `assertRouteCoverage` has no caller either. Review caught the earlier
 * wording — the commit and three documents all said `CLAIM_LEASE_MINUTES`
 * "throws at startup" when in fact it is read lazily inside one branch of
 * `claimOn`, so a typo'd deploy came up healthy and threw a 500 at the first
 * duplicate claim, on the exact path the lease exists to protect.
 *
 * So: the function exists, it is exported, and **T-14a's acceptance criteria
 * now require `createApp()` to call it** alongside the route-coverage
 * assertion. Until that lands, a bad value still surfaces late, and that is
 * stated rather than papered over.
 */
export function assertConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  claimLeaseMs(env);
}
