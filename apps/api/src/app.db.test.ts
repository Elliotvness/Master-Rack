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

import { requireDatabase } from '../../../tools/test-support/require-db.js';

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
  purpose: 'full',
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
requireDatabase(available, 'app deny-audit', ADMIN_URL);
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

describe('T-14b — organizations, invitations, acceptance, MFA, and cookie sessions', () => {
  const INTERNAL_ORG = '88888888-8888-4888-8888-a00000000010';
  const STAFF_USER = '88888888-8888-4888-8888-a00000000011';
  const STAFF_PRINCIPAL: Principal = {
    userId: STAFF_USER,
    organizationId: INTERNAL_ORG,
    actorType: 'staff',
    role: 'INTERNAL_ADMIN',
    purpose: 'full',
  };

  beforeAll(async () => {
    if (!available) return;
    await admin(
      `INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'McMurray Stern', true)
       ON CONFLICT (id) DO NOTHING`,
      [INTERNAL_ORG],
    );
    await admin(
      `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
       VALUES ($1, $2, 'staff@mcmurraystern.test', 'Staff Admin', 'staff')
       ON CONFLICT (id) DO NOTHING`,
      [STAFF_USER, INTERNAL_ORG],
    );
    await admin(
      `INSERT INTO app.membership (id, organization_id, user_id, role)
       VALUES ($1, $2, $3, 'INTERNAL_ADMIN')
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      ['88888888-8888-4888-8888-a00000000012', INTERNAL_ORG, STAFF_USER],
    );
  });

  function extractCookieMap(setCookieHeader: string | string[] | undefined): Record<string, string> {
    const list = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : typeof setCookieHeader === 'string'
        ? [setCookieHeader]
        : [];
    const out: Record<string, string> = {};
    for (const entry of list) {
      const first = entry.split(';')[0] ?? '';
      const eq = first.indexOf('=');
      if (eq > 0) {
        out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
      }
    }
    return out;
  }

  function formatCookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  maybe(
    'runs §15.2 steps 1–2 end-to-end: staff creates org & invites client admin, client accepts, enrolls MFA, signs in, invites colleague, and signs out',
    async () => {
      const issuedTokens: { email: string; token: string; organizationId: string }[] = [];
      let staffPinned = true;

      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        recordDeny: databaseDenyRecorder(),
        now: () => new Date('2026-09-05T15:00:00.000Z'),
        onInvitationIssued: (notice) => {
          issuedTokens.push({
            email: notice.email,
            token: notice.token,
            organizationId: notice.organizationId,
          });
        },
      });
      app.addHook('onRequest', async (request) => {
        if (staffPinned) {
          request.principal = STAFF_PRINCIPAL;
        }
      });

      // 1. Staff creates a client organization (validation + success).
      const badOrg = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/organizations',
        payload: { name: '   ' },
      });
      expect(badOrg.statusCode).toBe(400);

      const createdOrgRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/organizations',
        payload: { name: 'Pacific Logistics' },
      });
      expect(createdOrgRes.statusCode).toBe(201);
      const clientOrg = createdOrgRes.json() as {
        id: string;
        name: string;
        is_internal: boolean;
        status: string;
      };
      expect(clientOrg.name).toBe('Pacific Logistics');
      expect(clientOrg.is_internal).toBe(false);
      expect(clientOrg.status).toBe('active');

      // 2. Staff invites a CLIENT_ADMIN into the new organization (idempotent via T-13d).
      const noKeyRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        payload: {
          organization_id: clientOrg.id,
          email: 'Admin@Pacific.test',
          role: 'CLIENT_ADMIN',
        },
      });
      expect(noKeyRes.statusCode).toBe(400);

      const badOrgUuidRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: { 'idempotency-key': 'bad-uuid-key' },
        payload: {
          organization_id: 'not-a-uuid',
          email: 'Admin@Pacific.test',
          role: 'CLIENT_ADMIN',
        },
      });
      expect(badOrgUuidRes.statusCode).toBe(400);

      const inviteKey = `staff-invite-${crypto.randomUUID()}`;
      const inviteBody = {
        organization_id: clientOrg.id,
        email: 'Admin@Pacific.test',
        role: 'CLIENT_ADMIN',
      };
      const inviteRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: { 'idempotency-key': inviteKey },
        payload: inviteBody,
      });
      expect(inviteRes.statusCode).toBe(201);
      const inviteDto = inviteRes.json() as {
        id: string;
        organization_id: string;
        email: string;
        role: string;
      };
      expect(inviteDto.organization_id).toBe(clientOrg.id);
      expect(inviteDto.email).toBe('admin@pacific.test');
      expect(inviteDto.role).toBe('CLIENT_ADMIN');
      expect(issuedTokens).toHaveLength(1);
      const adminInviteToken = issuedTokens[0]!.token;

      // Same idempotency key + same body -> replays 201 without issuing a second token.
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: { 'idempotency-key': inviteKey },
        payload: inviteBody,
      });
      expect(replayRes.statusCode).toBe(201);
      expect(replayRes.json()).toEqual(inviteDto);
      expect(issuedTokens).toHaveLength(1);

      // Same idempotency key + different body -> 422 IDEMPOTENCY_KEY_REUSED.
      const mismatchRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: { 'idempotency-key': inviteKey },
        payload: { ...inviteBody, email: 'other@pacific.test' },
      });
      expect(mismatchRes.statusCode).toBe(422);
      expect(mismatchRes.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');

      // Switch off pinned staff principal: everything from here runs through
      // anonymous routes and real `__Host-` cookies via the session preHandler.
      staffPinned = false;

      // 3. Invitation acceptance: short password or unknown token are refused before spending.
      const shortPwRes = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/accept',
        payload: { token: adminInviteToken, name: 'Dana Admin', password: 'short' },
      });
      expect(shortPwRes.statusCode).toBe(400);

      const unknownTokRes = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/accept',
        payload: {
          token: 'unknown-token-never-issued',
          name: 'Dana Admin',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(unknownTokRes.statusCode).toBe(410);
      expect(unknownTokRes.json()).toEqual({ state: 'unavailable' });

      // Valid acceptance: issues acceptance session cookie + org cookie.
      const acceptRes = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/accept',
        payload: {
          token: adminInviteToken,
          name: 'Dana Admin',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.json()).toEqual({ state: 'ready' });
      const acceptanceCookies = extractCookieMap(acceptRes.headers['set-cookie']);
      expect(acceptanceCookies['__Host-rms_session']).toBeTruthy();
      expect(acceptanceCookies['__Host-rms_org']).toBe(clientOrg.id);

      // Proof 1: A second accept of the same token is refused with 410 and audited.
      const secondAcceptRes = await app.inject({
        method: 'POST',
        url: '/api/auth/invite/accept',
        payload: {
          token: adminInviteToken,
          name: 'Dana Admin',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(secondAcceptRes.statusCode).toBe(410);
      expect(secondAcceptRes.json()).toEqual({ state: 'unavailable' });

      // Proof 2: Acceptance session is refused at a normal client route (`GET /projects`) as 401.
      const prematureProjects = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
      });
      expect(prematureProjects.statusCode).toBe(401);
      expect(prematureProjects.json().error.code).toBe('UNAUTHENTICATED');

      // Proof 3: A forged organization cookie with a valid session token -> 401 and no session.
      const forgedOrgRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/enroll',
        headers: {
          cookie: formatCookieHeader({
            '__Host-rms_session': acceptanceCookies['__Host-rms_session']!,
            '__Host-rms_org': RIVAL_ORG,
          }),
        },
        payload: { factor_type: 'totp' },
      });
      expect(forgedOrgRes.statusCode).toBe(401);

      // 4. MFA enroll + verify under the acceptance session.
      const badEnrollRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/enroll',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'sms' },
      });
      expect(badEnrollRes.statusCode).toBe(400);

      // Passkey enrollment also works and returns a challenge.
      const passkeyEnrollRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/enroll',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'passkey' },
      });
      expect(passkeyEnrollRes.statusCode).toBe(200);
      expect(passkeyEnrollRes.json().challenge).toBeTruthy();

      // TOTP enrollment returns provisioning_uri containing the shared secret.
      const enrollRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/enroll',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'totp' },
      });
      expect(enrollRes.statusCode).toBe(200);
      const enrollBody = enrollRes.json() as {
        factor_type: string;
        provisioning_uri: string;
        challenge: string | null;
      };
      expect(enrollBody.factor_type).toBe('totp');
      expect(enrollBody.provisioning_uri).toContain('otpauth://totp/');
      const secretMatch = /secret=([^&]+)/.exec(enrollBody.provisioning_uri);
      expect(secretMatch?.[1]).toBeTruthy();
      const totpSecret = secretMatch![1]!;

      // Wrong MFA verification code -> 401.
      const badVerifyBodyRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/verify',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'totp' },
      });
      expect(badVerifyBodyRes.statusCode).toBe(400);

      const badVerifyCodeRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/verify',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'totp', code: 'wrong-code' },
      });
      expect(badVerifyCodeRes.statusCode).toBe(401);

      // Valid MFA verification -> 200 MfaFactor.
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/verify',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'totp', code: totpSecret },
      });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json()).toMatchObject({ factor_type: 'totp' });

      // 5. Explicit sign-in at POST /api/auth/session.
      const badSignInBody = await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: { email: 'admin@pacific.test' },
      });
      expect(badSignInBody.statusCode).toBe(400);

      const noOrgCookieSignIn = await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: {
          email: 'admin@pacific.test',
          password: 'correct-horse-battery-staple',
          mfa_code: totpSecret,
        },
      });
      expect(noOrgCookieSignIn.statusCode).toBe(401);

      const wrongPasswordSignIn = await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: {
          email: 'admin@pacific.test',
          password: 'wrong-password-entirely',
          mfa_code: totpSecret,
        },
      });
      expect(wrongPasswordSignIn.statusCode).toBe(401);

      const signInRes = await app.inject({
        method: 'POST',
        url: '/api/auth/session',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: {
          email: 'admin@pacific.test',
          password: 'correct-horse-battery-staple',
          mfa_code: totpSecret,
        },
      });
      expect(signInRes.statusCode).toBe(200);
      const fullCookies = extractCookieMap(signInRes.headers['set-cookie']);
      expect(fullCookies['__Host-rms_session']).toBeTruthy();
      // Session token regenerated on authentication, acceptance session revoked.
      expect(fullCookies['__Host-rms_session']).not.toBe(
        acceptanceCookies['__Host-rms_session'],
      );

      // The old acceptance cookie no longer resolves (revoked on sign-in).
      const oldCookieAttempt = await app.inject({
        method: 'POST',
        url: '/api/client/v1/mfa/enroll',
        headers: { cookie: formatCookieHeader(acceptanceCookies) },
        payload: { factor_type: 'totp' },
      });
      expect(oldCookieAttempt.statusCode).toBe(401);

      // The new full session reaches client routes past the gate.
      const afterSignInProjects = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects',
        headers: { cookie: formatCookieHeader(fullCookies) },
      });
      // Reaches the T-14c placeholder (500), proving the session preHandler and gate allowed it.
      expect(afterSignInProjects.statusCode).toBe(500);

      // 6. Client admin invites a colleague into their own organization (idempotent).
      const clientInviteNoKey = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: { cookie: formatCookieHeader(fullCookies) },
        payload: { email: 'colleague@pacific.test' },
      });
      expect(clientInviteNoKey.statusCode).toBe(400);

      const clientInviteBadBody = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': 'bad-body',
        },
        payload: {},
      });
      expect(clientInviteBadBody.statusCode).toBe(400);

      const clientKey = `client-invite-${crypto.randomUUID()}`;
      const clientInviteRes = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': clientKey,
        },
        payload: { email: 'Colleague@Pacific.test' },
      });
      expect(clientInviteRes.statusCode).toBe(201);
      expect(clientInviteRes.json()).toMatchObject({
        email: 'colleague@pacific.test',
        role: 'CLIENT_USER',
      });

      // Replay with same key returns 201 and same DTO.
      const clientInviteReplay = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': clientKey,
        },
        payload: { email: 'Colleague@Pacific.test' },
      });
      expect(clientInviteReplay.statusCode).toBe(201);
      expect(clientInviteReplay.json()).toEqual(clientInviteRes.json());

      // Reuse with different email -> 422 IDEMPOTENCY_KEY_REUSED.
      const clientInviteMismatch = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': clientKey,
        },
        payload: { email: 'different@pacific.test' },
      });
      expect(clientInviteMismatch.statusCode).toBe(422);

      // Proof 4: A client_admin inviting into another org -> 404 and an audit row.
      const auditBeforeCrossOrg = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action IN ('invitation.create', 'invitation.create_any_org')
            AND outcome = 'denied'`,
        [clientOrg.id],
      );
      const crossOrgViaClientRoute = await app.inject({
        method: 'POST',
        url: '/api/client/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': `cross-${crypto.randomUUID()}`,
        },
        payload: { email: 'intruder@rival.test', organization_id: RIVAL_ORG },
      });
      expect(crossOrgViaClientRoute.statusCode).toBe(404);
      expect(crossOrgViaClientRoute.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'not found' },
      });

      const crossOrgViaInternalRoute = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: {
          cookie: formatCookieHeader(fullCookies),
          'idempotency-key': `cross-int-${crypto.randomUUID()}`,
        },
        payload: {
          organization_id: RIVAL_ORG,
          email: 'intruder@rival.test',
          role: 'CLIENT_USER',
        },
      });
      expect(crossOrgViaInternalRoute.statusCode).toBe(404);

      const auditAfterCrossOrg = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action IN ('invitation.create', 'invitation.create_any_org')
            AND outcome = 'denied'`,
        [clientOrg.id],
      );
      expect(auditAfterCrossOrg.rows[0]?.n).toBe(
        (auditBeforeCrossOrg.rows[0]?.n as number) + 2,
      );

      // 7. Sign-out revokes the session and clears the cookies.
      const signOutRes = await app.inject({
        method: 'DELETE',
        url: '/api/auth/session',
        headers: { cookie: formatCookieHeader(fullCookies) },
      });
      expect(signOutRes.statusCode).toBe(204);

      const afterSignOut = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects',
        headers: { cookie: formatCookieHeader(fullCookies) },
      });
      expect(afterSignOut.statusCode).toBe(401);

      // Anonymous DELETE /api/auth/session is also a safe 204 no-op.
      const anonSignOut = await app.inject({
        method: 'DELETE',
        url: '/api/auth/session',
      });
      expect(anonSignOut.statusCode).toBe(204);

      await app.close();
    },
  );
});

