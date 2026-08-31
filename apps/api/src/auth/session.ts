/**
 * Sessions.
 *
 * Opaque, server-side, revocable. The plaintext token exists only in the
 * client's cookie; the database holds its SHA-256. Every function here takes a
 * TenantTransaction rather than opening its own connection, so the tenant
 * context is always the caller's and the logic is testable in isolation.
 *
 * The invariants that matter:
 *   - a session is validated by hash lookup AND expiry AND not-revoked;
 *   - authenticating or changing privilege REGENERATES the token, so a fixated
 *     token from before the change is worthless;
 *   - deactivating a user revokes every session at once (AC-17).
 */

import type { TenantTransaction, ActorType } from '@rms/db';

import { generateToken, hashToken } from './crypto.js';
import { lifetimeFor } from './policy.js';

export interface Session {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly actorType: ActorType;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
}

export interface NewSession {
  readonly session: Session;
  /** The plaintext token. Returned ONCE, to be set in the cookie. Never stored. */
  readonly token: string;
}

interface SessionRow {
  id: string;
  organization_id: string;
  user_id: string;
  actor_type: ActorType;
  absolute_expires_at: Date;
  idle_expires_at: Date;
  revoked_at: Date | null;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    actorType: row.actor_type,
    absoluteExpiresAt: row.absolute_expires_at,
    idleExpiresAt: row.idle_expires_at,
  };
}

/**
 * Create a session. `now` is passed in rather than read from a clock, so the
 * whole flow is deterministic and testable — the same rule the kernel follows.
 */
export async function createSession(
  tx: TenantTransaction,
  params: {
    id: string;
    organizationId: string;
    userId: string;
    actorType: ActorType;
    now: Date;
  },
): Promise<NewSession> {
  const token = generateToken();
  const lifetime = lifetimeFor(params.actorType);
  const absolute = new Date(params.now.getTime() + lifetime.absoluteMs);
  const idle = new Date(params.now.getTime() + lifetime.idleMs);

  await tx.query(
    `INSERT INTO app.session
       (id, organization_id, user_id, actor_type, token_hash,
        created_at, absolute_expires_at, idle_expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6)`,
    [
      params.id,
      params.organizationId,
      params.userId,
      params.actorType,
      hashToken(token),
      params.now,
      absolute,
      idle,
    ],
  );

  return {
    token,
    session: {
      id: params.id,
      organizationId: params.organizationId,
      userId: params.userId,
      actorType: params.actorType,
      absoluteExpiresAt: absolute,
      idleExpiresAt: idle,
    },
  };
}

/**
 * Resolve a cookie token to a live session, or null.
 *
 * Null covers every failure identically — unknown, expired, idle-timed-out,
 * revoked — because distinguishing them for the caller only helps an attacker.
 * A live session has its idle window slid forward on each use.
 */
export async function resolveSession(
  tx: TenantTransaction,
  token: string,
  now: Date,
): Promise<Session | null> {
  const result = await tx.query<SessionRow>(
    `SELECT id, organization_id, user_id, actor_type,
            absolute_expires_at, idle_expires_at, revoked_at
       FROM app.session
      WHERE token_hash = $1`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (row === undefined) return null;
  if (row.revoked_at !== null) return null;
  if (now >= row.absolute_expires_at) return null;
  if (now >= row.idle_expires_at) return null;

  const nextIdle = new Date(now.getTime() + lifetimeFor(row.actor_type).idleMs);
  // Never let the idle window push past the absolute cap.
  const cappedIdle = nextIdle > row.absolute_expires_at ? row.absolute_expires_at : nextIdle;
  await tx.query(
    'UPDATE app.session SET last_seen_at = $1, idle_expires_at = $2 WHERE id = $3',
    [now, cappedIdle, row.id],
  );

  return toSession({ ...row, idle_expires_at: cappedIdle });
}

/** End one session. Kept, not deleted, so its end stays auditable. */
export async function revokeSession(
  tx: TenantTransaction,
  sessionId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE app.session SET revoked_at = $1, revoked_reason = $2
      WHERE id = $3 AND revoked_at IS NULL`,
    [now, reason, sessionId],
  );
}

/**
 * Regenerate a session's token on authentication or privilege change.
 * The old token stops working the instant this commits.
 */
export async function regenerateToken(
  tx: TenantTransaction,
  sessionId: string,
): Promise<string> {
  const token = generateToken();
  const result = await tx.query(
    'UPDATE app.session SET token_hash = $1 WHERE id = $2 AND revoked_at IS NULL',
    [hashToken(token), sessionId],
  );
  if (result.rowCount === 0) {
    throw new Error(`Cannot regenerate token for session ${sessionId}: not found or revoked.`);
  }
  return token;
}

/**
 * Deactivate a user: revoke every session and every pending invitation, in one
 * transaction. This is AC-17, and it is the reason sessions are server-side —
 * a stateless token could not be revoked at all.
 */
export async function deactivateUser(
  tx: TenantTransaction,
  userId: string,
  now: Date,
): Promise<{ sessionsRevoked: number; invitationsRevoked: number }> {
  await tx.query(`UPDATE app.app_user SET status = 'inactive' WHERE id = $1`, [userId]);

  const sessions = await tx.query(
    `UPDATE app.session SET revoked_at = $1, revoked_reason = 'user deactivated'
      WHERE user_id = $2 AND revoked_at IS NULL`,
    [now, userId],
  );

  const invitations = await tx.query(
    `UPDATE app.invitation SET revoked_at = $1
      WHERE invited_by = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [now, userId],
  );

  return {
    sessionsRevoked: sessions.rowCount ?? 0,
    invitationsRevoked: invitations.rowCount ?? 0,
  };
}
