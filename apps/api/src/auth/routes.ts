/**
 * Authentication, second-factor enrollment, session lifecycle, invitations and
 * organizations (task **T-14b**).
 *
 * Implements the routes that move Blueprint §15.2 from 0 of 8 to 2 of 8:
 *   - Step 1 (organization + invitation half):
 *       `POST /api/internal/v1/organizations`
 *       `POST /api/internal/v1/invitations` (idempotent via T-13d)
 *       `POST /api/client/v1/invitations`   (idempotent via T-13d, own-org enforced)
 *   - Step 2 (invitation acceptance, MFA enrollment/verification, explicit sign-in):
 *       `POST /api/auth/invite/accept`
 *       `POST /api/client/v1/mfa/enroll`
 *       `POST /api/client/v1/mfa/verify`
 *       `POST /api/auth/session`
 *       `DELETE /api/auth/session`
 *
 * Every database access goes through `withTenant` (except anonymous token-to-org
 * resolution, which goes through `resolveInvitationTenant` in `./invitation.ts`),
 * every request body binds through `@rms/contracts`'s `parseBody`, and every
 * response is built through the per-audience DTO builders in `../dto/`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  clientRequestBody,
  errorEnvelope,
  internalRequestBody,
  parseBody,
  statusFor,
  string,
  type ErrorCode,
} from '@rms/contracts';
import { withTenant, type TenantContext } from '@rms/db';

import type { DenyRecorder, Principal } from '../app.js';
import { appendAuditEvent } from '../audit/chain.js';
import { authorize, type Action } from '../authz/authorize.js';
import {
  MFA_FACTOR_TYPES,
  toInvitationClientDTO,
  toMfaEnrollmentClientDTO,
  toMfaFactorClientDTO,
} from '../dto/client.js';
import {
  toInvitationInternalDTO,
  toOrganizationInternalDTO,
} from '../dto/internal.js';
import {
  claimIdempotencyKey,
  claimLeaseMs,
  errorCodeFor,
  settleIdempotencyKey,
} from '../idempotency/idempotency.js';
import {
  generateToken,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from './crypto.js';
import {
  issueInvitation,
  redeemInvitation,
  redemptionResponse,
  resolveInvitationTenant,
  type MemberRole,
} from './invitation.js';
import {
  INVITATION_TTL_MS,
  LOGIN_TOKEN_TTL_MS,
  ORG_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  formatClearCookie,
  formatSetCookie,
  parseCookies,
  sessionCookieOptions,
} from './policy.js';
import {
  createSession,
  resolveSession,
  revokeSession,
} from './session.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimum password length per §14.4 (NIST SP 800-63B). */
const MIN_PASSWORD_LENGTH = 12;

const INVITABLE_ROLES = [
  'CLIENT_USER',
  'CLIENT_ADMIN',
  'INTERNAL_SALES',
  'INTERNAL_ADMIN',
] as const;

export const InviteAcceptInput = clientRequestBody('InviteAcceptInput', {
  token: string(),
  name: string(),
  password: string(),
});

export const MfaEnrollInput = clientRequestBody('MfaEnrollInput', {
  factor_type: string({ enum: MFA_FACTOR_TYPES }),
});

export const MfaVerifyInput = clientRequestBody('MfaVerifyInput', {
  factor_type: string({ enum: MFA_FACTOR_TYPES }),
  code: string(),
});

export const SignInInput = clientRequestBody('SignInInput', {
  email: string(),
  password: string(),
  mfa_code: string(),
});

export const ClientInvitationInput = clientRequestBody('ClientInvitationInput', {
  email: string(),
});

export const InternalInvitationInput = internalRequestBody('InternalInvitationInput', {
  organization_id: string(),
  email: string(),
  role: string({ enum: INVITABLE_ROLES }),
});

export const CreateOrganizationInput = internalRequestBody('CreateOrganizationInput', {
  name: string(),
});

export interface IssuedInvitationNotice {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface AuthRoutesDeps {
  readonly now: () => Date;
  readonly newId: () => string;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly recordDeny?: DenyRecorder | undefined;
  /**
   * Optional hook invoked when a new invitation is committed so the caller (an
   * outbox relay or an integration test) receives the single-use plaintext
   * token without ever serialising it into an HTTP response body.
   */
  readonly onInvitationIssued?: ((notice: IssuedInvitationNotice) => void | Promise<void>) | undefined;
}

function sendError(reply: FastifyReply, code: ErrorCode, message: string): FastifyReply {
  return reply.code(statusFor(code)).send(errorEnvelope(code, message));
}

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the cookie pair (`__Host-rms_session` + `__Host-rms_org`) to a
 * verified `Principal`.
 *
 * The organization cookie is a hint that is VERIFIED rather than trusted:
 * opening `withTenant` with `actorType: 'client'` keeps `app.is_staff()` false
 * during resolution, so a forged `__Host-rms_org` naming another tenant matches
 * zero rows under RLS even if the session token belongs to staff. When the
 * organization matches the session's real tenant, the row is visible and the
 * authentic `actor_type`, `role` and `purpose` are read from the database.
 */
export async function resolveCookiePrincipal(
  cookieHeader: string | undefined,
  at: Date,
): Promise<Principal | undefined> {
  if (!cookieHeader) return undefined;
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  const orgId = cookies[ORG_COOKIE_NAME];
  if (!token || !orgId || !UUID_RE.test(orgId)) return undefined;

  return withTenant({ organizationId: orgId, actorType: 'client' }, async (tx) => {
    const session = await resolveSession(tx, token, at);
    if (session === null) return undefined;

    const userRes = await tx.query<{
      user_id: string;
      organization_id: string;
      actor_type: 'client' | 'staff' | 'service';
      status: string;
      role: Principal['role'];
    }>(
      `SELECT u.id AS user_id, u.organization_id, u.actor_type, u.status, m.role
         FROM app.app_user u
         JOIN app.membership m
           ON m.user_id = u.id AND m.organization_id = u.organization_id
        WHERE u.id = $1 AND u.organization_id = $2`,
      [session.userId, session.organizationId],
    );
    const row = userRes.rows[0];
    if (row === undefined || row.status !== 'active') return undefined;

    return {
      userId: row.user_id,
      organizationId: row.organization_id,
      actorType: row.actor_type,
      role: row.role,
      purpose: session.purpose,
    };
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { now, newId, env, recordDeny, onInvitationIssued } = deps;

  async function recordObjectDeny(
    actor: Principal,
    action: Action,
    resourceId: string | null,
    reason: string,
  ): Promise<void> {
    await recordDeny!({
      actor,
      action,
      resourceId,
      reason,
      occurredAt: now().toISOString(),
      eventId: newId(),
    });
  }

  // -------------------------------------------------------------------------
  // 1. POST /api/auth/invite/accept (public)
  // -------------------------------------------------------------------------
  app.post('/api/auth/invite/accept', async (request, reply) => {
    const parsed = parseBody(InviteAcceptInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const token = parsed.body['token'] as string;
    const name = parsed.body['name'] as string;
    const password = parsed.body['password'] as string;
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || password.length < MIN_PASSWORD_LENGTH) {
      return sendError(
        reply,
        'VALIDATION_ERROR',
        `name must be non-empty and password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
      );
    }

    const orgId = await resolveInvitationTenant(token);
    if (orgId === null) {
      const collapsed = redemptionResponse({ ok: false, reason: 'invalid' });
      return reply.code(collapsed.status).send(collapsed.body);
    }

    const at = now();
    const outcome = await withTenant(
      { organizationId: orgId, actorType: 'client' },
      async (tx) => {
        const redeemed = await redeemInvitation(tx, token, at);
        if (!redeemed.ok) {
          await appendAuditEvent(tx, {
            eventId: newId(),
            recordedAt: at.toISOString(),
            content: {
              occurredAt: at.toISOString(),
              actorUserId: null,
              actorType: 'client',
              actorOrganizationId: orgId,
              impersonatedBy: null,
              subjectOrganizationId: orgId,
              action: 'invitation.accept',
              resourceType: 'invitation',
              resourceId: null,
              outcome: 'denied',
              reasons: [redeemed.reason],
            },
          });
          return { ok: false as const, response: redemptionResponse(redeemed) };
        }

        const actorType = 'client' as const;
        const candidateUserId = newId();
        const userRows = await tx.query<{ id: string }>(
          `INSERT INTO app.app_user (id, organization_id, email, name, actor_type, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'active', $6)
           ON CONFLICT (organization_id, email)
           DO UPDATE SET name = EXCLUDED.name, status = 'active'
           RETURNING id`,
          [candidateUserId, orgId, redeemed.email, trimmedName, actorType, at],
        );
        const userId = userRows.rows[0]!.id;

        await tx.query(
          `INSERT INTO app.membership (id, organization_id, user_id, role, granted_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (organization_id, user_id)
           DO UPDATE SET role = EXCLUDED.role`,
          [newId(), orgId, userId, redeemed.role, at],
        );

        const passwordHash = await hashPassword(password);
        await tx.query(
          `INSERT INTO app.credential
             (user_id, organization_id, password_hash, mfa_type, mfa_secret_hash, password_updated_at, created_at)
           VALUES ($1, $2, $3, 'none', NULL, $4, $4)
           ON CONFLICT (user_id)
           DO UPDATE SET password_hash = EXCLUDED.password_hash,
                         mfa_type = 'none',
                         mfa_secret_hash = NULL,
                         password_updated_at = EXCLUDED.password_updated_at`,
          [userId, orgId, passwordHash, at],
        );

        // §14.3: Acceptance issues a short-lived ACCEPTANCE session — never a
        // full login session — so the invited user can enroll a second factor
        // before signing in at POST /api/auth/session.
        const created = await createSession(tx, {
          id: newId(),
          organizationId: orgId,
          userId,
          actorType,
          purpose: 'acceptance',
          now: at,
        });

        await appendAuditEvent(tx, {
          eventId: newId(),
          recordedAt: at.toISOString(),
          content: {
            occurredAt: at.toISOString(),
            actorUserId: userId,
            actorType,
            actorOrganizationId: orgId,
            impersonatedBy: null,
            subjectOrganizationId: orgId,
            action: 'invitation.accept',
            resourceType: 'invitation',
            resourceId: userId,
            outcome: 'success',
            reasons: [],
          },
        });

        return {
          ok: true as const,
          actorType,
          sessionToken: created.token,
          response: redemptionResponse(redeemed),
        };
      },
    );

    if (!outcome.ok) {
      return reply.code(outcome.response.status).send(outcome.response.body);
    }

    const cookieOpts = sessionCookieOptions(outcome.actorType, 'acceptance');
    reply.header('set-cookie', [
      formatSetCookie(SESSION_COOKIE_NAME, outcome.sessionToken, cookieOpts),
      formatSetCookie(ORG_COOKIE_NAME, orgId, cookieOpts),
    ]);
    return reply.code(outcome.response.status).send(outcome.response.body);
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/client/v1/mfa/enroll (client, acceptance-reachable)
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/mfa/enroll', async (request, reply) => {
    const principal = request.principal!;
    const parsed = parseBody(MfaEnrollInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const factorType = parsed.body['factor_type'] as (typeof MFA_FACTOR_TYPES)[number];
    const secret = generateToken();
    const secretHash = hashToken(secret);
    const at = now();

    await withTenant(
      { organizationId: principal.organizationId, actorType: 'client' },
      async (tx) => {
        await tx.query(
          `UPDATE app.credential
              SET mfa_secret_hash = $1
            WHERE user_id = $2 AND organization_id = $3`,
          [secretHash, principal.userId, principal.organizationId],
        );

        await appendAuditEvent(tx, {
          eventId: newId(),
          recordedAt: at.toISOString(),
          content: {
            occurredAt: at.toISOString(),
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: principal.organizationId,
            action: 'credential.enroll_factor',
            resourceType: 'credential',
            resourceId: principal.userId,
            outcome: 'success',
            reasons: [factorType],
          },
        });
      },
    );

    const expiresAt = new Date(at.getTime() + LOGIN_TOKEN_TTL_MS).toISOString();
    const isTotp = factorType === 'totp';
    const dto = toMfaEnrollmentClientDTO({
      factor_type: factorType,
      provisioning_uri: isTotp
        ? `otpauth://totp/RackMasterStudio:${encodeURIComponent(principal.userId)}?secret=${secret}&issuer=RackMasterStudio`
        : null,
      challenge: isTotp ? null : secret,
      expires_at: expiresAt,
    });
    return reply.code(200).send(dto);
  });

  // -------------------------------------------------------------------------
  // 3. POST /api/client/v1/mfa/verify (client, acceptance-reachable)
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/mfa/verify', async (request, reply) => {
    const principal = request.principal!;
    const parsed = parseBody(MfaVerifyInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const factorType = parsed.body['factor_type'] as (typeof MFA_FACTOR_TYPES)[number];
    const code = parsed.body['code'] as string;
    const at = now();

    const verified = await withTenant(
      { organizationId: principal.organizationId, actorType: 'client' },
      async (tx) => {
        const cred = await tx.query<{ mfa_secret_hash: string | null }>(
          `SELECT mfa_secret_hash
             FROM app.credential
            WHERE user_id = $1 AND organization_id = $2`,
          [principal.userId, principal.organizationId],
        );
        const secretHash = cred.rows[0]!.mfa_secret_hash;
        if (
          secretHash === null ||
          code.length === 0 ||
          !safeEqual(hashToken(code), secretHash)
        ) {
          await appendAuditEvent(tx, {
            eventId: newId(),
            recordedAt: at.toISOString(),
            content: {
              occurredAt: at.toISOString(),
              actorUserId: principal.userId,
              actorType: principal.actorType,
              actorOrganizationId: principal.organizationId,
              impersonatedBy: null,
              subjectOrganizationId: principal.organizationId,
              action: 'credential.verify_factor',
              resourceType: 'credential',
              resourceId: principal.userId,
              outcome: 'denied',
              reasons: ['invalid_mfa_code'],
            },
          });
          return false;
        }

        await tx.query(
          `UPDATE app.credential
              SET mfa_type = $1
            WHERE user_id = $2 AND organization_id = $3`,
          [factorType, principal.userId, principal.organizationId],
        );

        await appendAuditEvent(tx, {
          eventId: newId(),
          recordedAt: at.toISOString(),
          content: {
            occurredAt: at.toISOString(),
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: principal.organizationId,
            action: 'credential.verify_factor',
            resourceType: 'credential',
            resourceId: principal.userId,
            outcome: 'success',
            reasons: [factorType],
          },
        });
        return true;
      },
    );

    if (!verified) {
      return sendError(reply, 'UNAUTHENTICATED', 'invalid verification code');
    }

    const dto = toMfaFactorClientDTO({
      factor_type: factorType,
      enrolled_at: at.toISOString(),
    });
    return reply.code(200).send(dto);
  });

  // -------------------------------------------------------------------------
  // 4. POST /api/auth/session (public — explicit sign-in with password + MFA)
  // -------------------------------------------------------------------------
  app.post('/api/auth/session', async (request, reply) => {
    const parsed = parseBody(SignInInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const cookies = parseCookies(request.headers.cookie);
    const orgId = cookies[ORG_COOKIE_NAME];
    const priorToken = cookies[SESSION_COOKIE_NAME];
    if (!orgId || !UUID_RE.test(orgId)) {
      return sendError(reply, 'UNAUTHENTICATED', 'invalid credentials');
    }

    const email = (parsed.body['email'] as string).trim().toLowerCase();
    const password = parsed.body['password'] as string;
    const mfaCode = parsed.body['mfa_code'] as string;
    const at = now();

    const result = await withTenant(
      { organizationId: orgId, actorType: 'client' },
      async (tx) => {
        const res = await tx.query<{
          user_id: string;
          actor_type: 'client' | 'staff' | 'service';
          status: string;
          password_hash: string;
          mfa_type: string;
          mfa_secret_hash: string | null;
        }>(
          `SELECT u.id AS user_id, u.actor_type, u.status,
                  c.password_hash, c.mfa_type, c.mfa_secret_hash
             FROM app.app_user u
             JOIN app.credential c
               ON c.user_id = u.id AND c.organization_id = u.organization_id
            WHERE u.organization_id = $1 AND u.email = $2`,
          [orgId, email],
        );
        const row = res.rows[0];
        const passwordValid =
          row !== undefined ? await verifyPassword(password, row.password_hash) : false;
        const mfaValid =
          row !== undefined &&
          row.mfa_type !== 'none' &&
          row.mfa_secret_hash !== null &&
          mfaCode.length > 0 &&
          safeEqual(hashToken(mfaCode), row.mfa_secret_hash);

        if (row === undefined || row.status !== 'active' || !passwordValid || !mfaValid) {
          await appendAuditEvent(tx, {
            eventId: newId(),
            recordedAt: at.toISOString(),
            content: {
              occurredAt: at.toISOString(),
              actorUserId: row?.user_id ?? null,
              actorType: 'client',
              actorOrganizationId: orgId,
              impersonatedBy: null,
              subjectOrganizationId: orgId,
              action: 'session.create',
              resourceType: 'session',
              resourceId: null,
              outcome: 'denied',
              reasons: ['invalid_credentials'],
            },
          });
          return { ok: false as const };
        }

        // NFR-SEC-04 & migration 0015: session purpose is immutable, and
        // authentication must mint a fresh session identifier rather than
        // promoting an acceptance session in place. Revoke any prior session in
        // this tenant before issuing the full session.
        if (priorToken) {
          const prior = await resolveSession(tx, priorToken, at);
          if (prior !== null) {
            await revokeSession(tx, prior.id, 'authenticated', at);
          }
        }

        const created = await createSession(tx, {
          id: newId(),
          organizationId: orgId,
          userId: row.user_id,
          actorType: row.actor_type,
          purpose: 'full',
          now: at,
        });

        await appendAuditEvent(tx, {
          eventId: newId(),
          recordedAt: at.toISOString(),
          content: {
            occurredAt: at.toISOString(),
            actorUserId: row.user_id,
            actorType: row.actor_type,
            actorOrganizationId: orgId,
            impersonatedBy: null,
            subjectOrganizationId: orgId,
            action: 'session.create',
            resourceType: 'session',
            resourceId: created.session.id,
            outcome: 'success',
            reasons: [],
          },
        });

        return {
          ok: true as const,
          actorType: row.actor_type,
          sessionToken: created.token,
        };
      },
    );

    if (!result.ok) {
      return sendError(reply, 'UNAUTHENTICATED', 'invalid credentials');
    }

    const cookieOpts = sessionCookieOptions(result.actorType, 'full');
    reply.header('set-cookie', [
      formatSetCookie(SESSION_COOKIE_NAME, result.sessionToken, cookieOpts),
      formatSetCookie(ORG_COOKIE_NAME, orgId, cookieOpts),
    ]);
    return reply.code(200).send({ state: 'authenticated' });
  });

  // -------------------------------------------------------------------------
  // 5. DELETE /api/auth/session (public — sign-out)
  // -------------------------------------------------------------------------
  app.delete('/api/auth/session', async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    const orgId = cookies[ORG_COOKIE_NAME];

    if (token && orgId && UUID_RE.test(orgId)) {
      const at = now();
      await withTenant({ organizationId: orgId, actorType: 'client' }, async (tx) => {
        const existing = await resolveSession(tx, token, at);
        if (existing !== null) {
          await revokeSession(tx, existing.id, 'logout', at);
        }
      });
    }

    reply.header('set-cookie', [
      formatClearCookie(SESSION_COOKIE_NAME),
      formatClearCookie(ORG_COOKIE_NAME),
    ]);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // 6. POST /api/client/v1/invitations (client_admin only, idempotent)
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/invitations', async (request, reply) => {
    const principal = request.principal!;

    // If the caller attempted to target another organization in the raw body,
    // evaluate the object-level authorization rule (`clientOwnOrg`), which
    // denies cross-tenant access as 404 with an audit event.
    const rawBody = request.body as Record<string, unknown> | null | undefined;
    const rawOrg = rawBody?.['organization_id'];
    if (typeof rawOrg === 'string' && rawOrg !== principal.organizationId) {
      const decision = authorize(principal, 'invitation.create', { organizationId: rawOrg });
      await recordObjectDeny(
        principal,
        'invitation.create',
        rawOrg,
        (decision as { reason: string }).reason,
      );
      return sendError(reply, 'NOT_FOUND', 'not found');
    }

    const parsed = parseBody(ClientInvitationInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const email = parsed.body['email'] as string;

    const key = readIdempotencyKey(request);
    if (key === null) {
      return sendError(reply, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
    }

    const tenant: TenantContext = {
      organizationId: principal.organizationId,
      actorType: 'client',
    };
    const at = now();
    const claim = await claimIdempotencyKey(tenant, {
      id: newId(),
      organizationId: principal.organizationId,
      key,
      intent: 'invite',
      body: parsed.body,
      now: at,
      leaseMs: claimLeaseMs(env),
    });

    if (claim.status === 'settled') {
      const existing = await withTenant(tenant, (tx) =>
        tx.query<{
          id: string;
          invited_email: string;
          role: string;
          expires_at: Date;
        }>(
          `SELECT id, invited_email, role, expires_at
             FROM app.invitation
            WHERE id = $1 AND organization_id = $2`,
          [claim.resultRef, principal.organizationId],
        ),
      );
      const row = existing.rows[0]!;
      return reply.code(201).send(
        toInvitationClientDTO({
          id: row.id,
          email: row.invited_email,
          role: row.role,
          expires_at: row.expires_at.toISOString(),
        }),
      );
    }

    if (claim.status !== 'claimed') {
      return sendError(
        reply,
        errorCodeFor(claim.status)!,
        `idempotency key ${claim.status}`,
      );
    }

    const invitationId = newId();
    const expiresAt = new Date(at.getTime() + INVITATION_TTL_MS);
    const issued = await withTenant(tenant, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: invitationId,
        organizationId: principal.organizationId,
        invitedEmail: email,
        role: 'CLIENT_USER',
        invitedBy: principal.userId,
        now: at,
      });
      await appendAuditEvent(tx, {
        eventId: newId(),
        recordedAt: at.toISOString(),
        content: {
          occurredAt: at.toISOString(),
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: principal.organizationId,
          action: 'invitation.create',
          resourceType: 'invitation',
          resourceId: inv.id,
          outcome: 'success',
          reasons: [],
        },
      });
      return inv;
    });

    await settleIdempotencyKey(tenant, {
      id: claim.id,
      epoch: claim.epoch,
      outcome: 'succeeded',
      resultRef: issued.id,
      now: at,
    });

    if (onInvitationIssued !== undefined) {
      await onInvitationIssued({
        id: issued.id,
        organizationId: principal.organizationId,
        email: email.trim().toLowerCase(),
        role: 'CLIENT_USER',
        token: issued.token,
        expiresAt,
      });
    }

    return reply.code(201).send(
      toInvitationClientDTO({
        id: issued.id,
        email: email.trim().toLowerCase(),
        role: 'CLIENT_USER',
        expires_at: expiresAt.toISOString(),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 7. POST /api/internal/v1/organizations (staff)
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/organizations', async (request, reply) => {
    const principal = request.principal!;
    const parsed = parseBody(CreateOrganizationInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const trimmedName = (parsed.body['name'] as string).trim();
    if (trimmedName.length === 0) {
      return sendError(reply, 'VALIDATION_ERROR', 'organization name must be non-empty');
    }

    const orgId = newId();
    const at = now();
    const tenant: TenantContext = {
      organizationId: principal.organizationId,
      actorType: 'staff',
    };

    const row = await withTenant(tenant, async (tx) => {
      const inserted = await tx.query<{
        id: string;
        name: string;
        is_internal: boolean;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO app.organization (id, name, is_internal, status, created_at)
         VALUES ($1, $2, false, 'active', $3)
         RETURNING id, name, is_internal, status, created_at`,
        [orgId, trimmedName, at],
      );
      await appendAuditEvent(tx, {
        eventId: newId(),
        recordedAt: at.toISOString(),
        content: {
          occurredAt: at.toISOString(),
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: orgId,
          action: 'organization.create',
          resourceType: 'organization',
          resourceId: orgId,
          outcome: 'success',
          reasons: [],
        },
      });
      return inserted.rows[0]!;
    });

    return reply.code(201).send(
      toOrganizationInternalDTO({
        id: row.id,
        name: row.name,
        is_internal: row.is_internal,
        status: row.status,
        created_at: row.created_at.toISOString(),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 8. POST /api/internal/v1/invitations (staff, idempotent)
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/invitations', async (request, reply) => {
    const principal = request.principal!;
    const parsed = parseBody(InternalInvitationInput, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }
    const targetOrgId = parsed.body['organization_id'] as string;
    const email = parsed.body['email'] as string;
    const role = parsed.body['role'] as MemberRole;
    if (!UUID_RE.test(targetOrgId)) {
      return sendError(reply, 'VALIDATION_ERROR', 'organization_id must be a valid UUID');
    }

    const key = readIdempotencyKey(request);
    if (key === null) {
      return sendError(reply, 'VALIDATION_ERROR', 'Idempotency-Key header is required');
    }

    const tenant: TenantContext = {
      organizationId: targetOrgId,
      actorType: 'staff',
    };
    const at = now();
    const claim = await claimIdempotencyKey(tenant, {
      id: newId(),
      organizationId: targetOrgId,
      key,
      intent: 'invite',
      body: parsed.body,
      now: at,
      leaseMs: claimLeaseMs(env),
    });

    if (claim.status === 'settled') {
      const existing = await withTenant(tenant, (tx) =>
        tx.query<{
          id: string;
          organization_id: string;
          invited_email: string;
          role: string;
          expires_at: Date;
          invited_by: string;
        }>(
          `SELECT id, organization_id, invited_email, role, expires_at, invited_by
             FROM app.invitation
            WHERE id = $1 AND organization_id = $2`,
          [claim.resultRef, targetOrgId],
        ),
      );
      const row = existing.rows[0]!;
      return reply.code(201).send(
        toInvitationInternalDTO({
          id: row.id,
          organization_id: row.organization_id,
          email: row.invited_email,
          role: row.role,
          expires_at: row.expires_at.toISOString(),
          issued_by: row.invited_by,
        }),
      );
    }

    if (claim.status !== 'claimed') {
      return sendError(
        reply,
        errorCodeFor(claim.status)!,
        `idempotency key ${claim.status}`,
      );
    }

    const invitationId = newId();
    const expiresAt = new Date(at.getTime() + INVITATION_TTL_MS);
    const issued = await withTenant(tenant, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: invitationId,
        organizationId: targetOrgId,
        invitedEmail: email,
        role,
        invitedBy: principal.userId,
        now: at,
      });
      await appendAuditEvent(tx, {
        eventId: newId(),
        recordedAt: at.toISOString(),
        content: {
          occurredAt: at.toISOString(),
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: targetOrgId,
          action: 'invitation.create',
          resourceType: 'invitation',
          resourceId: inv.id,
          outcome: 'success',
          reasons: [],
        },
      });
      return inv;
    });

    await settleIdempotencyKey(tenant, {
      id: claim.id,
      epoch: claim.epoch,
      outcome: 'succeeded',
      resultRef: issued.id,
      now: at,
    });

    if (onInvitationIssued !== undefined) {
      await onInvitationIssued({
        id: issued.id,
        organizationId: targetOrgId,
        email: email.trim().toLowerCase(),
        role,
        token: issued.token,
        expiresAt,
      });
    }

    return reply.code(201).send(
      toInvitationInternalDTO({
        id: issued.id,
        organization_id: targetOrgId,
        email: email.trim().toLowerCase(),
        role,
        expires_at: expiresAt.toISOString(),
        issued_by: principal.userId,
      }),
    );
  });
}
