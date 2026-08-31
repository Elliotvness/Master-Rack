/**
 * The audit hash chain, and the transactional write helper.
 *
 * Blueprint §13.6, NFR-AUD-01..04. An audit log is not an application log: it is
 * accountability and evidence, fixed-schema, append-only, and written in the
 * SAME transaction as the change it describes. A change without its audit record
 * must be impossible, not merely unlikely.
 *
 * Tamper evidence comes from a hash chain: each event's hash covers the previous
 * event's hash plus the event's own canonical content, so altering or deleting
 * an interior record breaks every hash after it. This is EVIDENCE, not
 * proofing: it detects modification to anyone holding a later head hash; it does
 * not stop a database superuser, which is why the head is externally anchored
 * (a later task) and why we never say "tamper-proof".
 *
 * Canonical serialisation and SHA-256 are reused from @rms/kernel-model, so the
 * chain hashes exactly the way a revision does — one implementation, one set of
 * rules about key order and number formatting.
 */

import { canonicalise, sha256 } from '@rms/kernel-model';
import type { TenantTransaction } from '@rms/db';

export type AuditOutcome = 'success' | 'denied' | 'error';
export type ActorType = 'client' | 'staff' | 'service';

/**
 * The content of an audit event — everything that is hashed. Ordering metadata
 * (sequence, recorded_at) is assigned by the database and is deliberately NOT
 * part of the hashed content, the same way a revision hash excludes lineage.
 */
export interface AuditEventContent {
  readonly occurredAt: string;
  readonly actorUserId: string | null;
  readonly actorType: ActorType;
  readonly actorOrganizationId: string | null;
  readonly impersonatedBy: string | null;
  readonly subjectOrganizationId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly reasons: readonly string[];
}

/**
 * The hash of one event given the previous hash. Genesis uses the empty string
 * as the previous hash, so a chain of length one still has a well-defined head.
 *
 * hash_n = SHA-256( prev_hash ‖ canonical(content) )
 */
export function chainHash(prevHash: string, content: AuditEventContent): string {
  return sha256(prevHash + '\u0000' + canonicalise(content));
}

export const GENESIS_PREV_HASH = '';

/** Arbitrary constant key for the transaction-scoped advisory lock on the chain. */
const AUDIT_CHAIN_LOCK_KEY = 0x52_4d_53_41; // "RMSA"

interface HeadRow {
  hash: string;
}

/**
 * Append an audit event, hash-chained onto the current head, IN the caller's
 * transaction. Because it shares the transaction, the event commits with the
 * business change or not at all.
 *
 * The head is read `FOR UPDATE` so two concurrent writers cannot both chain
 * onto the same predecessor and fork the chain. `now` is supplied, never read
 * from a clock, so a test is deterministic.
 */
export async function appendAuditEvent(
  tx: TenantTransaction,
  params: {
    eventId: string;
    content: AuditEventContent;
    recordedAt: string;
    requestId?: string | null;
    sessionIdHash?: string | null;
    sourceIp?: string | null;
    userAgent?: string | null;
  },
): Promise<{ hash: string; prevHash: string }> {
  // Serialize appends with a transaction-scoped advisory lock, so two writers
  // cannot chain onto the same predecessor and fork the chain. An advisory lock
  // needs no table privilege — a `SELECT ... FOR UPDATE` would require UPDATE on
  // app.audit_event, which the append-only application role deliberately lacks.
  // The key is an arbitrary constant identifying the audit chain.
  await tx.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK_KEY]);

  const headResult = await tx.query<HeadRow>(
    `SELECT hash FROM app.audit_event ORDER BY sequence DESC LIMIT 1`,
  );
  const prevHash = headResult.rows[0]?.hash ?? GENESIS_PREV_HASH;

  const hash = chainHash(prevHash, params.content);
  const c = params.content;

  await tx.query(
    `INSERT INTO app.audit_event
       (event_id, occurred_at, recorded_at, actor_user_id, actor_type,
        actor_organization_id, impersonated_by, subject_organization_id,
        action, resource_type, resource_id, outcome, reasons,
        request_id, session_id_hash, source_ip, user_agent, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      params.eventId,
      c.occurredAt,
      params.recordedAt,
      c.actorUserId,
      c.actorType,
      c.actorOrganizationId,
      c.impersonatedBy,
      c.subjectOrganizationId,
      c.action,
      c.resourceType,
      c.resourceId,
      c.outcome,
      c.reasons,
      params.requestId ?? null,
      params.sessionIdHash ?? null,
      params.sourceIp ?? null,
      params.userAgent ?? null,
      prevHash,
      hash,
    ],
  );

  return { hash, prevHash };
}

interface ChainRow {
  sequence: string;
  event_id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_type: ActorType;
  actor_organization_id: string | null;
  impersonated_by: string | null;
  subject_organization_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: AuditOutcome;
  reasons: string[];
  prev_hash: string;
  hash: string;
}

export type ChainVerification =
  | { readonly ok: true; readonly length: number }
  | {
      readonly ok: false;
      readonly length: number;
      readonly failedAtSequence: string;
      readonly reason: string;
    };

/**
 * Re-derive the chain from genesis and check every link.
 *
 * Two independent failures are detected: a recomputed hash that does not match
 * the stored one (content was altered), and a `prev_hash` that does not match
 * the actual predecessor's hash (a row was deleted or reordered). Either is a
 * control failure, and the sequence is the ordering authority — never the
 * timestamp.
 */
export async function verifyAuditChain(tx: TenantTransaction): Promise<ChainVerification> {
  const result = await tx.query<ChainRow>(
    `SELECT sequence, event_id, occurred_at, actor_user_id, actor_type,
            actor_organization_id, impersonated_by, subject_organization_id,
            action, resource_type, resource_id, outcome, reasons, prev_hash, hash
       FROM app.audit_event
      ORDER BY sequence ASC`,
  );

  let expectedPrev = GENESIS_PREV_HASH;
  for (const row of result.rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        ok: false,
        length: result.rows.length,
        failedAtSequence: row.sequence,
        reason:
          `prev_hash does not match the actual predecessor at sequence ${row.sequence}. ` +
          'A row was deleted, inserted out of order, or reordered.',
      };
    }

    const content: AuditEventContent = {
      occurredAt: row.occurred_at.toISOString(),
      actorUserId: row.actor_user_id,
      actorType: row.actor_type,
      actorOrganizationId: row.actor_organization_id,
      impersonatedBy: row.impersonated_by,
      subjectOrganizationId: row.subject_organization_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      reasons: row.reasons,
    };
    const recomputed = chainHash(row.prev_hash, content);
    if (recomputed !== row.hash) {
      return {
        ok: false,
        length: result.rows.length,
        failedAtSequence: row.sequence,
        reason:
          `recomputed hash does not match the stored hash at sequence ${row.sequence}. ` +
          'The event content was altered after it was written.',
      };
    }

    expectedPrev = row.hash;
  }

  return { ok: true, length: result.rows.length };
}
