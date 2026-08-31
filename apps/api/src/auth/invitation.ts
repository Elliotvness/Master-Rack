/**
 * Invitations.
 *
 * The access-control model IS the invitation model: there is no public signup.
 * An invitation carries the organization, the role and the invited email on the
 * server side; none of those are ever accepted from the client, because taking
 * them from the request body is textbook mass assignment.
 *
 * AC-01 is the criterion that governs this file: a token is redeemable exactly
 * once, and an expired, revoked, already-used or nonexistent token all produce
 * the SAME outcome. Anything that distinguishes them hands an attacker an
 * oracle — including, for a nonexistent invite to an address that already has an
 * account elsewhere, a way to probe our confidential client list.
 */

import type { TenantTransaction } from '@rms/db';

import { generateToken, hashToken } from './crypto.js';
import { INVITATION_TTL_MS } from './policy.js';

export type MemberRole =
  | 'CLIENT_USER'
  | 'CLIENT_ADMIN'
  | 'INTERNAL_SALES'
  | 'INTERNAL_ADMIN';

export interface IssuedInvitation {
  readonly id: string;
  /** Plaintext token, returned ONCE for the email link. Only its hash is stored. */
  readonly token: string;
}

/**
 * Every redemption returns one of these. The consumer maps a failure to a
 * single generic page; the reason is for the audit log, never for the client.
 */
export type RedemptionResult =
  | { readonly ok: true; readonly organizationId: string; readonly role: MemberRole; readonly email: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'used' | 'revoked' };

export async function issueInvitation(
  tx: TenantTransaction,
  params: {
    id: string;
    organizationId: string;
    invitedEmail: string;
    role: MemberRole;
    invitedBy: string;
    now: Date;
  },
): Promise<IssuedInvitation> {
  const token = generateToken();
  const expiresAt = new Date(params.now.getTime() + INVITATION_TTL_MS);

  await tx.query(
    `INSERT INTO app.invitation
       (id, organization_id, token_hash, invited_email, role, invited_by,
        expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.id,
      params.organizationId,
      hashToken(token),
      params.invitedEmail.toLowerCase(),
      params.role,
      params.invitedBy,
      expiresAt,
      params.now,
    ],
  );

  return { id: params.id, token };
}

interface InvitationRow {
  id: string;
  organization_id: string;
  invited_email: string;
  role: MemberRole;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Redeem a token, exactly once.
 *
 * The single-use guarantee is enforced by `UPDATE ... WHERE accepted_at IS NULL`
 * checking the affected-row count, in ONE statement — never read-then-write,
 * which lets two concurrent redemptions both succeed. Staff rows are not
 * exposed to a client anyway, but the check runs regardless.
 */
export async function redeemInvitation(
  tx: TenantTransaction,
  token: string,
  now: Date,
): Promise<RedemptionResult> {
  const found = await tx.query<InvitationRow>(
    `SELECT id, organization_id, invited_email, role, expires_at, accepted_at, revoked_at
       FROM app.invitation
      WHERE token_hash = $1`,
    [hashToken(token)],
  );

  const row = found.rows[0];
  // Nonexistent and revoked are reported to the audit log distinctly, but the
  // CALLER collapses every failure to one page. See the contract test.
  if (row === undefined) return { ok: false, reason: 'invalid' };
  if (row.revoked_at !== null) return { ok: false, reason: 'revoked' };
  if (row.accepted_at !== null) return { ok: false, reason: 'used' };
  if (now >= row.expires_at) return { ok: false, reason: 'expired' };

  // The atomic claim. If a concurrent redemption won, rowCount is 0 and this
  // one is treated as already-used.
  const claimed = await tx.query(
    `UPDATE app.invitation SET accepted_at = $1
      WHERE id = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $1`,
    [now, row.id],
  );
  if (claimed.rowCount === 0) {
    return { ok: false, reason: 'used' };
  }

  return {
    ok: true,
    organizationId: row.organization_id,
    role: row.role,
    email: row.invited_email,
  };
}

/** Revoke a pending invitation. Idempotent; never deletes. */
export async function revokeInvitation(
  tx: TenantTransaction,
  invitationId: string,
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE app.invitation SET revoked_at = $1
      WHERE id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [now, invitationId],
  );
}

/**
 * Map any redemption result to the single client-facing shape. Success carries
 * only what the acceptance page needs; every failure is byte-identical, so the
 * page, the status and the timing cannot tell them apart (AC-01).
 */
export function redemptionResponse(
  result: RedemptionResult,
): { status: 200 | 410; body: { state: 'ready' | 'unavailable' } } {
  if (result.ok) {
    return { status: 200, body: { state: 'ready' } };
  }
  // One status, one body, for invalid / expired / used / revoked alike.
  return { status: 410, body: { state: 'unavailable' } };
}
