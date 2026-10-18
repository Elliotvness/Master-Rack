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

import { findForbiddenFields } from '@rms/contracts';
import { closeDatabase, configureDatabase, withTenant } from '@rms/db';
import { drawSpotCheckSample } from '@rms/kernel-catalog';

import { createApp, databaseDenyRecorder, routeKey, type Principal } from './app.js';
import { issueInvitation } from './auth/invitation.js';
import { createSession } from './auth/session.js';
import { ROUTES } from './authz/routes.js';
import { claimIdempotencyKey } from './idempotency/idempotency.js';
import { enqueue } from './outbox/outbox.js';
import { preliminaryPdfKey, type PdfJobSample } from './outbox/pdf-job.js';
import {
  processPdfOutboxBatch,
  queryInternalQueuePage,
  verifySignedDocumentUrl,
} from './revisions/routes.js';
import { InMemoryWormStore } from './worm/memory-store.js';
import { manifestKey } from './worm/store.js';

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
      // Reaches the T-14c GET /api/client/v1/projects handler (200), proving the session preHandler and gate allowed it.
      expect(afterSignInProjects.statusCode).toBe(200);
      expect(afterSignInProjects.json()).toEqual({
        data: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
      });

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

describe('T-14c — client reads, drafting, and internal project/revision creation against live Postgres', () => {
  const INTERNAL_ORG = '88888888-8888-4888-8888-c14c00000001';
  const STAFF_ADMIN = '88888888-8888-4888-8888-c14c00000002';
  const CAT_APPROVED = '88888888-8888-4888-8888-c14c00000007';
  const CAT_DRAFT = '88888888-8888-4888-8888-c14c00000008';
  const RULE_APPROVED = '88888888-8888-4888-8888-c14c00000009';
  const RULE_DRAFT = '88888888-8888-4888-8888-c14c0000000a';

  const STAFF_PRINCIPAL: Principal = {
    userId: STAFF_ADMIN,
    organizationId: INTERNAL_ORG,
    actorType: 'staff',
    role: 'INTERNAL_ADMIN',
    purpose: 'full',
  };

  maybe(
    'walks §15.2 steps 3–5 (project creation, P01 creation, facility/units/options drafting, preview & comparison) and proves audience isolation, frozen immutability, and cross-tenant 404+audit',
    async () => {
      const TENANT_A_ORG = crypto.randomUUID();
      const TENANT_A_USER = crypto.randomUUID();
      const TENANT_B_ORG = crypto.randomUUID();
      const TENANT_B_USER = crypto.randomUUID();

      const TENANT_A_PRINCIPAL: Principal = {
        userId: TENANT_A_USER,
        organizationId: TENANT_A_ORG,
        actorType: 'client',
        role: 'CLIENT_USER',
        purpose: 'full',
      };

      const TENANT_B_PRINCIPAL: Principal = {
        userId: TENANT_B_USER,
        organizationId: TENANT_B_ORG,
        actorType: 'client',
        role: 'CLIENT_USER',
        purpose: 'full',
      };

      await admin(
        `INSERT INTO app.organization (id, name, is_internal) VALUES
           ($1, 'Rack Master Staff T14c', true),
           ($2, 'Cascade Cold Storage', false),
           ($3, 'Rival Logistics', false)
         ON CONFLICT (id) DO NOTHING`,
        [INTERNAL_ORG, TENANT_A_ORG, TENANT_B_ORG],
      );
      await admin(
        `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
           ($1, $2, 'staff-t14c@rackmaster.test', 'Staff Admin', 'staff'),
           ($3, $4, 'planner@cascade.test', 'Cascade Planner', 'client'),
           ($5, $6, 'planner@rival.test', 'Rival Planner', 'client')
         ON CONFLICT (id) DO NOTHING`,
        [STAFF_ADMIN, INTERNAL_ORG, TENANT_A_USER, TENANT_A_ORG, TENANT_B_USER, TENANT_B_ORG],
      );

      await admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, verification_path, content_sha256)
         VALUES
           ($1, 'Interlake Mecalux', 'cat-2026.09-t14c', 'APPROVED', 'IM-2026.pdf', 'digitiser-1', now(),
            'approver-2', now(), 'reconciled against Kent reference BOM', $3),
           ($2, 'Interlake Mecalux', 'cat-draft-t14c', 'DRAFT', 'IM-draft.pdf', 'digitiser-1', now(),
            NULL, NULL, NULL, $4)
         ON CONFLICT (id) DO NOTHING`,
        [CAT_APPROVED, CAT_DRAFT, 'a'.repeat(64), 'b'.repeat(64)],
      );
      await admin(
        `INSERT INTO app.rule_pack_release
           (id, name, rev, status, approved_by, approved_at, content_sha256)
         VALUES
           ($1, 'rmi-selective', 'rules-2026.09-t14c', 'APPROVED', 'approver-2', now(), $3),
           ($2, 'rmi-selective', 'rules-draft-t14c', 'DRAFT', NULL, NULL, $4)
         ON CONFLICT (id) DO NOTHING`,
        [RULE_APPROVED, RULE_DRAFT, 'c'.repeat(64), 'd'.repeat(64)],
      );

      let activePrincipal: Principal = STAFF_PRINCIPAL;
      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        recordDeny: databaseDenyRecorder(),
        now: () => new Date('2026-09-05T15:00:00.000Z'),
      });
      app.addHook('onRequest', async (request) => {
        request.principal = activePrincipal;
      });

      // --- Step 3a: Staff creates a project in Tenant A ---
      const missingOrgProject = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: '88888888-8888-4888-8888-c14c99999999',
          number: 'PRJ-MISSING',
          name: 'Missing Org Project',
        },
      });
      expect(missingOrgProject.statusCode).toBe(404);

      const internalOrgProject = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: INTERNAL_ORG,
          number: 'PRJ-INT',
          name: 'Internal Org Project',
        },
      });
      expect(internalOrgProject.statusCode).toBe(422);

      const createProjectRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: TENANT_A_ORG,
          number: 'PRJ-101',
          name: ' Kent Cold Storage Expansion ',
        },
      });
      expect(createProjectRes.statusCode).toBe(201);
      const createdProject = createProjectRes.json() as {
        id: string;
        organization_id: string;
        number: string;
        name: string;
        status: string;
      };
      expect(createdProject).toMatchObject({
        organization_id: TENANT_A_ORG,
        number: 'PRJ-101',
        name: 'Kent Cold Storage Expansion',
        status: 'active',
      });

      // Duplicate project number in the same org -> 422
      const dupProjectRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: TENANT_A_ORG,
          number: 'PRJ-101',
          name: 'Duplicate Number',
        },
      });
      expect(dupProjectRes.statusCode).toBe(422);

      // Staff also creates a project in Tenant B to test cross-tenant isolation
      const createProjectBRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: TENANT_B_ORG,
          number: 'PRJ-B01',
          name: 'Rival Warehouse',
        },
      });
      expect(createProjectBRes.statusCode).toBe(201);
      const projectB = createProjectBRes.json() as { id: string };

      // --- Step 3b: Staff creates initial revision P01 on Tenant A's project ---
      const missingProjRev = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects/88888888-8888-4888-8888-c14c99999999/revisions',
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
        },
      });
      expect(missingProjRev.statusCode).toBe(404);

      const draftCatRev = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${createdProject.id}/revisions`,
        payload: {
          catalog_release_id: CAT_DRAFT,
          rule_pack_release_id: RULE_APPROVED,
        },
      });
      expect(draftCatRev.statusCode).toBe(422);

      const draftRuleRev = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${createdProject.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_DRAFT,
        },
      });
      expect(draftRuleRev.statusCode).toBe(422);

      const createRevRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${createdProject.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
          organization_id: TENANT_A_ORG,
        },
      });
      expect(createRevRes.statusCode).toBe(201);
      const p01 = createRevRes.json() as {
        id: string;
        organization_id: string;
        project_id: string;
        code: string;
        iteration: number;
        audience: string;
        lifecycle_state: string;
      };
      expect(p01).toMatchObject({
        organization_id: TENANT_A_ORG,
        project_id: createdProject.id,
        code: 'P01',
        iteration: 1,
        audience: 'client',
        lifecycle_state: 'DRAFT',
      });

      // Second initial revision on the same project is refused (422)
      const dupInitialRev = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${createdProject.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
        },
      });
      expect(dupInitialRev.statusCode).toBe(422);

      // Staff also creates initial revision on Tenant B's project
      const createRevBRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${projectB.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
        },
      });
      expect(createRevBRes.statusCode).toBe(201);
      const revB = createRevBRes.json() as { id: string };

      // --- Switch to Tenant A client user ---
      activePrincipal = TENANT_A_PRINCIPAL;

      // Client lists projects: sees only Tenant A's project, never Tenant B's
      const listProjectsRes = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects?page=1&pageSize=10',
      });
      expect(listProjectsRes.statusCode).toBe(200);
      expect(listProjectsRes.json()).toEqual({
        data: [
          {
            id: createdProject.id,
            number: 'PRJ-101',
            name: 'Kent Cold Storage Expansion',
            status: 'active',
          },
        ],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      });

      // --- Proof 1: Plant an internal derived revision C01 in Tenant A's project ---
      const internalRevId = crypto.randomUUID();
      await admin(
        `INSERT INTO app.revision
           (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
            audience, catalog_release_id, rule_pack_release_id, derived_from_revision_id,
            content, content_hash, created_by)
         VALUES ($1, $2, $3, 'C01', 1, 'DRAFT', 'internal', $4, $5, $6,
                 '{"schema_version":1}'::jsonb, NULL, $7)`,
        [
          internalRevId,
          TENANT_A_ORG,
          createdProject.id,
          CAT_APPROVED,
          RULE_APPROVED,
          p01.id,
          STAFF_ADMIN,
        ],
      );

      // Client lists revisions on its project: C01 is completely absent!
      const listRevisionsRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/projects/${createdProject.id}/revisions`,
      });
      expect(listRevisionsRes.statusCode).toBe(200);
      const revisionsPage = listRevisionsRes.json() as {
        data: Array<{ id: string; code: string; frozen: boolean }>;
        pagination: { totalItems: number };
      };
      expect(revisionsPage.pagination.totalItems).toBe(1);
      expect(revisionsPage.data).toEqual([
        {
          id: p01.id,
          code: 'P01',
          iteration: 1,
          frozen: false,
          content_hash: null,
          derived_from_revision_id: null,
        },
      ]);
      expect(JSON.stringify(revisionsPage)).not.toContain('C01');
      expect(JSON.stringify(revisionsPage)).not.toContain(internalRevId);

      // Direct client access to the internal revision C01 returns 404 + deny audit
      const previewInternalRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${internalRevId}/preview`,
      });
      expect(previewInternalRes.statusCode).toBe(404);

      const editInternalRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${internalRevId}/facility`,
        payload: {
          width_um: 24_384_000,
          depth_um: 12_192_000,
          clear_height_um: 9_144_000,
        },
      });
      expect(editInternalRes.statusCode).toBe(404);

      // --- Step 4: Client drafts facility, units, and two options on P01 ---
      const draftFacilityRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 36_576_000,
          depth_um: 24_384_000,
          clear_height_um: 9_753_600,
          column_grid: {
            pitch_x_um: 12_192_000,
            pitch_y_um: 12_192_000,
          },
          forklift: {
            model_stated: false,
          },
          dock_count: 2,
        },
      });
      expect(draftFacilityRes.statusCode).toBe(200);
      expect(draftFacilityRes.json()).toMatchObject({
        id: p01.id,
        code: 'P01',
        frozen: false,
      });

      const draftUnitsRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/units`,
        payload: {
          units: [
            {
              unit_id: 'gma-48x40',
              width_um: 1_219_200,
              depth_um: 1_016_000,
              height_um: 1_371_600,
              weight_lb: 2200,
              overhang_um: null,
            },
          ],
        },
      });
      expect(draftUnitsRes.statusCode).toBe(200);

      // Preview with only facility & units (before options) works and returns 0 counts
      const previewBeforeOptions = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/preview`,
      });
      expect(previewBeforeOptions.statusCode).toBe(200);
      // Compare with < 2 options returns 422 UNPROCESSABLE
      const compareBeforeOptions = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/compare`,
      });
      expect(compareBeforeOptions.statusCode).toBe(422);

      // Draft two options: Option A (on column grid) and Option B (off column grid)
      const draftOptionsRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-a',
              label: 'Option A — Selective On-Grid',
              aisle_width_um: 3_048_000,
              runs: [
                {
                  run_id: 'run-a1',
                  unit_id: 'gma-48x40',
                  x_um: 12_192_000,
                  y_um: 12_192_000,
                  bays: [
                    { bay_id: 'bay-1', length_um: 2_438_400, levels: 4 },
                    { bay_id: 'bay-2', length_um: 2_438_400, levels: 4 },
                  ],
                },
              ],
            },
            {
              option_id: 'opt-b',
              label: 'Option B — Narrow Aisle Off-Grid',
              aisle_width_um: 2_743_200,
              runs: [
                {
                  run_id: 'run-b1',
                  unit_id: 'gma-48x40',
                  x_um: 5_000_000, // off 12,192,000 grid -> COLUMN_IN_AISLE REVIEW + bay position loss
                  y_um: 12_192_000,
                  bays: [
                    { bay_id: 'bay-1', length_um: 2_438_400, levels: 4 },
                    { bay_id: 'bay-2', length_um: 2_438_400, levels: 4 },
                  ],
                },
              ],
            },
          ],
          active_option_id: 'opt-a',
        },
      });
      expect(draftOptionsRes.statusCode).toBe(200);

      // --- Step 5a: Client fetches Preview for P01 ---
      const previewRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/preview`,
      });
      expect(previewRes.statusCode).toBe(200);
      const preview = previewRes.json() as {
        revision_id: string;
        counts: { gross_positions: number; lost_positions: number; net_positions: number };
        dimensions: {
          aisle_clear_width: { value_um: number; established: boolean };
          bay_pitch: { value_um: number; established: boolean };
          run_length: { value_um: number; established: boolean };
        };
        assumptions: Array<{ key: string }>;
        findings: Array<{ code: string; severity: string }>;
        views: Array<{
          view: string;
          watermarked: boolean;
          items: Array<{ kind: string }>;
        }>;
      };
      expect(preview.revision_id).toBe(p01.id);
      // 2 bays * (2,438,400 / 1,219,200 = 2 positions/level) * 4 levels = 16 gross, 2 dock losses = 14 net
      expect(preview.counts).toEqual({
        gross_positions: 16,
        lost_positions: 2,
        net_positions: 14,
      });
      expect(preview.dimensions.aisle_clear_width).toEqual({ value_um: 3_048_000, established: true });
      expect(preview.dimensions.bay_pitch).toEqual({ value_um: 2_438_400, established: true });
      expect(preview.dimensions.run_length).toEqual({ value_um: 4_876_800, established: true });
      expect(preview.assumptions.map((a) => a.key)).toEqual([
        'forklift.aisle_clearance',
        'pallet.overhang.front',
      ]);
      expect(preview.findings.map((f) => f.code)).toContain('AISLE_CLEAR_OK');
      expect(preview.views[0]?.watermarked).toBe(true);
      expect(preview.views[0]?.items.length).toBeGreaterThan(0);

      // --- Step 5b: Client fetches Comparison across Option A and Option B ---
      const compareRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/compare?options=opt-a,opt-b`,
      });
      expect(compareRes.statusCode).toBe(200);
      const comparison = compareRes.json() as {
        revision_id: string;
        options: Array<{ option_id: string; label: string }>;
        rows: Array<{ metric: string; values: Array<number | null> }>;
      };
      expect(comparison.revision_id).toBe(p01.id);
      expect(comparison.options).toEqual([
        { option_id: 'opt-a', label: 'Option A — Selective On-Grid' },
        { option_id: 'opt-b', label: 'Option B — Narrow Aisle Off-Grid' },
      ]);
      const rowByMetric = new Map(comparison.rows.map((r) => [r.metric, r.values]));
      // Option A loses 2 (dock) -> 14 net; Option B loses 2 (dock) + 2 (off-grid bays) = 4 -> 12 net
      expect(rowByMetric.get('net_positions')).toEqual([14, 12]);
      expect(rowByMetric.get('aisle_clear_width_in')).toEqual([120, 108]);
      expect(rowByMetric.get('storage_levels')).toEqual([4, 4]);

      // Unknown option id in compare query -> 422 UNPROCESSABLE
      const compareUnknownOpt = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/compare?options=opt-a,opt-unknown`,
      });
      expect(compareUnknownOpt.statusCode).toBe(422);

      // Duplicate option id in compare query -> 422 UNPROCESSABLE
      const compareDupOpt = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/compare?options=opt-a,opt-a`,
      });
      expect(compareDupOpt.statusCode).toBe(422);

      // --- Proof 2: A POST to a FROZEN revision is refused with 422 error envelope + deny audit ---
      const frozenRevId = crypto.randomUUID();
      await admin(
        `INSERT INTO app.revision
           (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
            audience, catalog_release_id, rule_pack_release_id, content, content_hash,
            created_by, frozen_at)
         VALUES ($1, $2, $3, 'P02', 2, 'FROZEN', 'client', $4, $5,
                 '{"schema_version":1}'::jsonb, $6, $7, now())`,
        [
          frozenRevId,
          TENANT_A_ORG,
          createdProject.id,
          CAT_APPROVED,
          RULE_APPROVED,
          'e'.repeat(64),
          TENANT_A_USER,
        ],
      );

      const frozenAuditBefore = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action = 'revision.edit'
            AND resource_id = $2
            AND outcome = 'denied'`,
        [TENANT_A_ORG, frozenRevId],
      );

      const frozenFacilityRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${frozenRevId}/facility`,
        payload: {
          width_um: 20_000_000,
          depth_um: 20_000_000,
          clear_height_um: 8_000_000,
        },
      });
      expect(frozenFacilityRes.statusCode).toBe(422);
      expect(frozenFacilityRes.json()).toMatchObject({
        error: {
          code: 'UNPROCESSABLE',
        },
      });

      const frozenUnitsRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${frozenRevId}/units`,
        payload: {
          units: [
            {
              unit_id: 'u1',
              width_um: 1_000_000,
              depth_um: 1_000_000,
              height_um: 1_000_000,
              weight_lb: 1000,
            },
          ],
        },
      });
      expect(frozenUnitsRes.statusCode).toBe(422);

      const frozenOptionsRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${frozenRevId}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-1',
              label: 'Option 1',
              aisle_width_um: 3_048_000,
              runs: [
                {
                  run_id: 'r1',
                  unit_id: 'u1',
                  x_um: 0,
                  y_um: 0,
                  bays: [{ bay_id: 'b1', length_um: 2_438_400, levels: 2 }],
                },
              ],
            },
          ],
        },
      });
      expect(frozenOptionsRes.statusCode).toBe(422);

      const frozenAuditAfter = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action = 'revision.edit'
            AND resource_id = $2
            AND outcome = 'denied'`,
        [TENANT_A_ORG, frozenRevId],
      );
      expect(frozenAuditAfter.rows[0]?.n).toBe((frozenAuditBefore.rows[0]?.n as number) + 3);

      // --- Proof 3: Cross-tenant object access returns 404 + deny audit event ---
      activePrincipal = TENANT_B_PRINCIPAL;

      const crossAuditBefore = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [TENANT_B_ORG],
      );

      const crossRevs = await app.inject({
        method: 'GET',
        url: `/api/client/v1/projects/${createdProject.id}/revisions`,
      });
      expect(crossRevs.statusCode).toBe(404);

      const crossFacility = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 20_000_000,
          depth_um: 20_000_000,
          clear_height_um: 8_000_000,
        },
      });
      expect(crossFacility.statusCode).toBe(404);

      const crossUnits = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/units`,
        payload: {
          units: [
            {
              unit_id: 'u1',
              width_um: 1_000_000,
              depth_um: 1_000_000,
              height_um: 1_000_000,
              weight_lb: 1000,
            },
          ],
        },
      });
      expect(crossUnits.statusCode).toBe(404);

      const crossOptions = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-1',
              label: 'Option 1',
              aisle_width_um: 3_048_000,
              runs: [
                {
                  run_id: 'r1',
                  unit_id: 'u1',
                  x_um: 0,
                  y_um: 0,
                  bays: [{ bay_id: 'b1', length_um: 2_438_400, levels: 2 }],
                },
              ],
            },
          ],
        },
      });
      expect(crossOptions.statusCode).toBe(404);

      const crossPreview = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/preview`,
      });
      expect(crossPreview.statusCode).toBe(404);

      const crossCompare = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/compare`,
      });
      expect(crossCompare.statusCode).toBe(404);

      const crossAuditAfter = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [TENANT_B_ORG],
      );
      expect(crossAuditAfter.rows[0]?.n).toBe((crossAuditBefore.rows[0]?.n as number) + 6);

      // And Tenant B's own revision is untouched
      const revBPreview = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${revB.id}/preview`,
      });
      expect(revBPreview.statusCode).toBe(200);

      await app.close();
    },
  );
});

describe('T-14d submit, clone, status, and documents routes (live DB)', () => {
  maybe(
    'enforces multi-reason blocker refusal, idempotent atomic submit + WORM manifest, coarse 3-state status, signed document URL + expiry + audit, frozen edit refusal + clone to P02, and cross-tenant 404 + deny audit (§15.2 steps 6–7)',
    async () => {
      const INTERNAL_ORG = '88888888-8888-4888-8888-d14d00000001';
      const STAFF_ADMIN = '88888888-8888-4888-8888-d14d00000002';
      const TENANT_A_ORG = crypto.randomUUID();
      const TENANT_A_USER = crypto.randomUUID();
      const TENANT_B_ORG = crypto.randomUUID();
      const TENANT_B_USER = crypto.randomUUID();

      const CAT_APPROVED = '88888888-8888-4888-8888-d14d00000011';
      const RULE_APPROVED = '88888888-8888-4888-8888-d14d00000012';

      const ADMIN_PRINCIPAL: Principal = {
        userId: STAFF_ADMIN,
        organizationId: INTERNAL_ORG,
        actorType: 'staff',
        role: 'INTERNAL_ADMIN',
        purpose: 'full',
      };

      const TENANT_A_PRINCIPAL: Principal = {
        userId: TENANT_A_USER,
        organizationId: TENANT_A_ORG,
        actorType: 'client',
        role: 'CLIENT_USER',
        purpose: 'full',
      };

      const TENANT_B_PRINCIPAL: Principal = {
        userId: TENANT_B_USER,
        organizationId: TENANT_B_ORG,
        actorType: 'client',
        role: 'CLIENT_USER',
        purpose: 'full',
      };

      await admin(
        `INSERT INTO app.organization (id, name, is_internal) VALUES
           ($1, 'Rack Master Submit Staff', true),
           ($2, 'Cascade Cold Storage T14d', false),
           ($3, 'Rival Logistics T14d', false)
         ON CONFLICT (id) DO NOTHING`,
        [INTERNAL_ORG, TENANT_A_ORG, TENANT_B_ORG],
      );

      await admin(
        `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
           ($1, $2, 'staff-submit@rackmaster.test', 'Staff Submit Admin', 'staff'),
           ($3, $4, 'cascade-t14d@client.test', 'Cascade Client', 'client'),
           ($5, $6, 'rival-submit@client.test', 'Rival Submit Client', 'client')
         ON CONFLICT (id) DO NOTHING`,
        [STAFF_ADMIN, INTERNAL_ORG, TENANT_A_USER, TENANT_A_ORG, TENANT_B_USER, TENANT_B_ORG],
      );

      await admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, verification_path, content_sha256)
         VALUES
           ($1, 'Interlake Mecalux', 'cat-2026.09-t14d', 'APPROVED', 'IM-2026.pdf', 'digitiser-1', now(),
            'approver-2', now(), 'reconciled against Kent reference BOM', $2)
         ON CONFLICT (id) DO NOTHING`,
        [CAT_APPROVED, 'a'.repeat(64)],
      );

      await admin(
        `INSERT INTO app.rule_pack_release
           (id, name, rev, status, approved_by, approved_at, content_sha256)
         VALUES
           ($1, 'rmi-selective', 'rules-2026.09-t14d', 'APPROVED', 'approver-2', now(), $2)
         ON CONFLICT (id) DO NOTHING`,
        [RULE_APPROVED, 'b'.repeat(64)],
      );

      let currentMs = Date.parse('2026-07-01T15:00:00.000Z');
      let activePrincipal: Principal = ADMIN_PRINCIPAL;
      const wormStore = new InMemoryWormStore(() => new Date(currentMs).toISOString());

      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        recordDeny: databaseDenyRecorder(),
        wormStore,
        now: () => new Date(currentMs),
      });
      app.addHook('onRequest', async (request) => {
        request.principal = activePrincipal;
      });

      // 1. Staff creates project and initial P01 revision for Tenant A
      const createProjRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: TENANT_A_ORG,
          number: 'PRJ-201',
          name: 'Cascade Distribution Center',
        },
      });
      expect(createProjRes.statusCode).toBe(201);
      const project = createProjRes.json() as { id: string };

      const createRevRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${project.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
          organization_id: TENANT_A_ORG,
        },
      });
      expect(createRevRes.statusCode).toBe(201);
      const p01 = createRevRes.json() as { id: string; code: string };
      expect(p01.code).toBe('P01');

      // Switch to Tenant A client user
      activePrincipal = TENANT_A_PRINCIPAL;

      // 2. Client drafts a configuration with TWO open blockers:
      //    - AISLE_CLEAR_SHORTFALL (aisle 2,438,400 um < 2,743,200 um minimum)
      //    - CLEAR_HEIGHT_EXCEEDED (4 levels * (1,524,000 + 101,600) um = 6,502,400 um > 6,096,000 um clear height)
      const draftBlockedFacility = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 36_576_000,
          depth_um: 24_384_000,
          clear_height_um: 6_096_000,
          column_grid: { pitch_x_um: 12_192_000, pitch_y_um: 12_192_000 },
          forklift: { model_stated: false },
          dock_count: 2,
        },
      });
      expect(draftBlockedFacility.statusCode).toBe(200);

      const draftUnits = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/units`,
        payload: {
          units: [
            {
              unit_id: 'gma-48x40',
              width_um: 1_219_200,
              depth_um: 1_016_000,
              height_um: 1_524_000,
              weight_lb: 2200,
              overhang_um: null,
            },
          ],
        },
      });
      expect(draftUnits.statusCode).toBe(200);

      const draftBlockedOptions = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-blocked',
              label: 'Option Blocked',
              aisle_width_um: 2_438_400, // < 2,743,200 -> AISLE_CLEAR_SHORTFALL BLOCKER
              runs: [
                {
                  run_id: 'run-1',
                  unit_id: 'gma-48x40',
                  x_um: 12_192_000,
                  y_um: 12_192_000,
                  bays: [{ bay_id: 'bay-1', length_um: 2_438_400, levels: 4 }],
                },
              ],
            },
          ],
          active_option_id: 'opt-blocked',
        },
      });
      expect(draftBlockedOptions.statusCode).toBe(200);

      // 3. Submit with two open blockers, unacknowledged assumptions, and empty disclaimer
      //    AC-10: Refusal MUST list every reason, not just the first!
      const refusedSubmitRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/submit`,
        headers: { 'idempotency-key': 'idem-blocked-attempt-0001' },
        payload: {
          assumptions_acknowledged: false,
          disclaimer_version_id: '   ',
        },
      });
      expect(refusedSubmitRes.statusCode).toBe(422);
      const refusedBody = refusedSubmitRes.json() as {
        error: {
          code: string;
          message: string;
          details?: {
            step?: string;
            reasons?: readonly string[];
          };
        };
      };
      expect(refusedBody.error.code).toBe('UNPROCESSABLE');
      expect(refusedBody.error.details?.step).toBe('refuse_on_blockers');
      expect(refusedBody.error.details?.reasons).toEqual([
        'Widen the aisle to meet the stated equipment clearance.',
        'Reduce the number of storage levels or unit height to fit beneath the clear height.',
        'Acknowledge the assumptions this configuration relies on before submitting.',
        'The submission must record which version of the disclaimer was shown.',
      ]);

      // Revision remains DRAFT after refused submit
      const revCheckAfterRefusal = await admin(
        `SELECT lifecycle_state, content_hash FROM app.revision WHERE id = $1`,
        [p01.id],
      );
      expect(revCheckAfterRefusal.rows[0]).toEqual({
        lifecycle_state: 'DRAFT',
        content_hash: null,
      });

      // 4. Resolve blockers by updating facility clear height and option aisle width
      const fixFacility = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 36_576_000,
          depth_um: 24_384_000,
          clear_height_um: 9_753_600,
          column_grid: { pitch_x_um: 12_192_000, pitch_y_um: 12_192_000 },
          forklift: { model_stated: false },
          dock_count: 2,
        },
      });
      expect(fixFacility.statusCode).toBe(200);

      const fixOptions = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-a',
              label: 'Option A — Selective On-Grid',
              aisle_width_um: 3_048_000,
              runs: [
                {
                  run_id: 'run-a1',
                  unit_id: 'gma-48x40',
                  x_um: 12_192_000,
                  y_um: 12_192_000,
                  bays: [
                    { bay_id: 'bay-1', length_um: 2_438_400, levels: 4 },
                    { bay_id: 'bay-2', length_um: 2_438_400, levels: 4 },
                  ],
                },
              ],
            },
          ],
          active_option_id: 'opt-a',
        },
      });
      expect(fixOptions.statusCode).toBe(200);

      // 5. Submit P01 with Idempotency-Key -> 201 Created
      const submitPayload = {
        assumptions_acknowledged: true,
        disclaimer_version_id: 'disclaimer-v2026.07',
      };
      const firstSubmitRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/submit`,
        headers: { 'idempotency-key': 'idem-p01-submit-key-0001' },
        payload: submitPayload,
      });
      expect(firstSubmitRes.statusCode).toBe(201);
      const firstSubmission = firstSubmitRes.json() as {
        id: string;
        revision_id: string;
        status: string;
        submitted_at: string;
        submission_hash: string;
      };
      expect(firstSubmission.revision_id).toBe(p01.id);
      expect(firstSubmission.status).toBe('received');
      expect(firstSubmission.submitted_at).toBe('2026-07-01T15:00:00.000Z');
      expect(firstSubmission.submission_hash).toMatch(/^[0-9a-f]{64}$/);
      expect((firstSubmission as Record<string, unknown>)['organization_id']).toBeUndefined();

      // WORM manifest was stored under manifests/<submissionId>/<manifestHash>.json
      const subManifestRow = await admin(
        `SELECT manifest_hash, manifest_uri FROM app.submission WHERE id = $1`,
        [firstSubmission.id],
      );
      const manifestHash = subManifestRow.rows[0]?.manifest_hash as string;
      const expectedWormKey = manifestKey(firstSubmission.id, manifestHash);
      expect(subManifestRow.rows[0]?.manifest_uri).toBe(expectedWormKey);
      const wormObj = await wormStore.get(expectedWormKey);
      expect(wormObj).not.toBeNull();
      expect(wormObj?.sha256).toBe(manifestHash);
      expect(wormObj?.mode).toBe('COMPLIANCE');

      // 6. Second submit with the SAME Idempotency-Key and SAME payload -> 201 replay, still 1 DB row
      currentMs += 5_000;
      const replaySubmitRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/submit`,
        headers: { 'idempotency-key': 'idem-p01-submit-key-0001' },
        payload: submitPayload,
      });
      expect(replaySubmitRes.statusCode).toBe(201);
      expect(replaySubmitRes.json()).toEqual(firstSubmission);

      const subCount = await admin(
        `SELECT count(*)::int AS n FROM app.submission WHERE revision_id = $1`,
        [p01.id],
      );
      expect(subCount.rows[0]?.n).toBe(1);

      // 7. Submit with the SAME Idempotency-Key and DIFFERENT payload -> 422 IDEMPOTENCY_KEY_REUSED
      const mismatchSubmitRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/submit`,
        headers: { 'idempotency-key': 'idem-p01-submit-key-0001' },
        payload: {
          assumptions_acknowledged: true,
          disclaimer_version_id: 'disclaimer-v2099.99-mutated',
        },
      });
      expect(mismatchSubmitRes.statusCode).toBe(422);
      expect(mismatchSubmitRes.json()).toMatchObject({
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
        },
      });

      // 8. Check P01 is FROZEN and record its content_hash
      const p01FrozenRow = await admin(
        `SELECT lifecycle_state, content_hash FROM app.revision WHERE id = $1`,
        [p01.id],
      );
      const p01ContentHash = p01FrozenRow.rows[0]?.content_hash as string;
      expect(p01FrozenRow.rows[0]?.lifecycle_state).toBe('FROZEN');
      expect(p01ContentHash).toMatch(/^[0-9a-f]{64}$/);

      // 9. GET /api/client/v1/submissions/:id returns coarse 3-state status (OD-12)
      const statusReceivedRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/submissions/${firstSubmission.id}`,
      });
      expect(statusReceivedRes.statusCode).toBe(200);
      expect(statusReceivedRes.json()).toEqual({
        id: firstSubmission.id,
        revision_id: p01.id,
        status: 'received',
        submitted_at: '2026-07-01T15:00:00.000Z',
        submission_hash: firstSubmission.submission_hash,
      });

      // Advance submission request_status to IN_PROGRESS -> client sees 'in_progress'
      await admin(
        `UPDATE app.submission SET request_status = 'IN_PROGRESS' WHERE id = $1`,
        [firstSubmission.id],
      );
      const statusInProgressRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/submissions/${firstSubmission.id}`,
      });
      expect(statusInProgressRes.statusCode).toBe(200);
      expect((statusInProgressRes.json() as { status: string }).status).toBe('in_progress');

      // Advance submission request_status to QUOTED -> client sees 'complete'
      await admin(
        `UPDATE app.submission SET request_status = 'QUOTED' WHERE id = $1`,
        [firstSubmission.id],
      );
      const statusCompleteRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/submissions/${firstSubmission.id}`,
      });
      expect(statusCompleteRes.statusCode).toBe(200);
      expect((statusCompleteRes.json() as { status: string }).status).toBe('complete');

      // 10. P-03 + T-14d: GET /api/client/v1/documents/:id reports PENDING while queued in outbox,
      //     PRELIMINARY with a signed short-lived URL once the outbox worker dispatches, and
      //     FAILED if the outbox job fails (visible rather than silent).
      const docAuditBefore = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action = 'document.read'
            AND resource_id = $2
            AND outcome = 'success'`,
        [TENANT_A_ORG, firstSubmission.id],
      );

      // 10a. Before the outbox PDF worker runs, the job is pending -> client sees progress ('PENDING')
      const docPendingRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/documents/${firstSubmission.id}`,
      });
      expect(docPendingRes.statusCode).toBe(200);
      expect(docPendingRes.json()).toMatchObject({
        id: firstSubmission.id,
        number: 'PRJ-201-P01-PRELIM',
        revision_code: 'P01',
        status_code: 'PENDING',
        url: '',
      });

      // 10b. Drain the outbox PDF job queue and record the per-job duration metric
      const pdfMetrics: PdfJobSample[] = [];
      const batchResult = await processPdfOutboxBatch({
        organizationId: TENANT_A_ORG,
        now: () => new Date(currentMs),
        wormStore,
        metrics: pdfMetrics,
      });
      expect(batchResult.claimed).toBe(1);
      expect(batchResult.completed).toHaveLength(1);
      expect(batchResult.failed).toHaveLength(0);
      expect(pdfMetrics).toHaveLength(1);
      expect(pdfMetrics[0]?.submissionId).toBe(firstSubmission.id);
      expect(pdfMetrics[0]?.manifestHash).toBe(manifestHash);
      expect(pdfMetrics[0]?.durationMs).toBeGreaterThanOrEqual(0);
      expect(pdfMetrics[0]?.pageCount).toBe(2);
      expect(pdfMetrics[0]?.bayCount).toBe(2);

      const storedPdf = await wormStore.get(preliminaryPdfKey(firstSubmission.id, manifestHash));
      expect(storedPdf).not.toBeNull();
      expect(storedPdf?.mode).toBe('COMPLIANCE');
      const storedPdfText = storedPdf!.body;
      expect(storedPdfText.startsWith('%PDF-1.4\n')).toBe(true);
      expect(storedPdfText).toContain('PRELIMINARY - NOT FOR CONSTRUCTION');

      // 10c. After the outbox worker dispatches, GET /api/client/v1/documents/:id returns PRELIMINARY + signed URL
      const docRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/documents/${firstSubmission.id}`,
      });
      expect(docRes.statusCode).toBe(200);
      const docBody = docRes.json() as {
        id: string;
        number: string;
        revision_code: string;
        status_code: string;
        url: string;
        expires_at: string;
      };
      expect(docBody.id).toBe(firstSubmission.id);
      expect(docBody.number).toBe('PRJ-201-P01-PRELIM');
      expect(docBody.revision_code).toBe('P01');
      expect(docBody.status_code).toBe('PRELIMINARY');
      expect((docBody as Record<string, unknown>)['organization_id']).toBeUndefined();

      const docAuditAfter = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND action = 'document.read'
            AND resource_id = $2
            AND outcome = 'success'`,
        [TENANT_A_ORG, firstSubmission.id],
      );
      expect(docAuditAfter.rows[0]?.n).toBe((docAuditBefore.rows[0]?.n as number) + 2);

      // Signed URL is valid before expires_at and expires at/after expires_at
      expect(verifySignedDocumentUrl(docBody.url, new Date(currentMs + 60_000))).toBe(true);
      expect(
        verifySignedDocumentUrl(docBody.url, new Date(Date.parse(docBody.expires_at))),
      ).toBe(false);

      // 10d. A failed PDF outbox job is visible ('FAILED') to the client rather than silent
      currentMs += 1_000;
      await withTenant({ organizationId: TENANT_A_ORG, actorType: 'client' }, async (tx) => {
        await enqueue(tx, {
          id: crypto.randomUUID(),
          organizationId: TENANT_A_ORG,
          topic: 'pdf.generate',
          payload: { reference: manifestHash },
          now: new Date(currentMs),
          maxAttempts: 1,
        });
        await enqueue(tx, {
          id: crypto.randomUUID(),
          organizationId: TENANT_A_ORG,
          topic: 'pdf.generate',
          payload: {},
          now: new Date(currentMs),
          maxAttempts: 2,
        });
        await enqueue(tx, {
          id: crypto.randomUUID(),
          organizationId: TENANT_A_ORG,
          topic: 'pdf.generate',
          payload: { reference: 'f'.repeat(64) },
          now: new Date(currentMs),
          maxAttempts: 2,
        });
      });

      const failedBatch = await processPdfOutboxBatch({
        organizationId: TENANT_A_ORG,
        now: () => new Date(currentMs),
        wormStore,
        injectFaultForManifest: new Set([manifestHash]),
      });
      expect(failedBatch.claimed).toBe(3);
      expect(failedBatch.failed).toHaveLength(3);
      expect(failedBatch.failed[0]?.status).toBe('dead');

      const docFailedRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/documents/${firstSubmission.id}`,
      });
      expect(docFailedRes.statusCode).toBe(200);
      expect(docFailedRes.json()).toMatchObject({
        id: firstSubmission.id,
        status_code: 'FAILED',
        url: '',
      });

      // 11. §15.2 Step 7: Attempt to edit submitted P01 is refused (422); cloning P01 creates editable P02
      const editFrozenP01 = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 40_000_000,
          depth_um: 24_384_000,
          clear_height_um: 9_753_600,
        },
      });
      expect(editFrozenP01.statusCode).toBe(422);

      // Clone P01 -> P02 (with Idempotency-Key and replay check)
      const cloneRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/clone`,
        headers: { 'idempotency-key': 'idem-p01-clone-key-0001' },
        payload: {},
      });
      expect(cloneRes.statusCode).toBe(201);
      const p02 = cloneRes.json() as {
        id: string;
        code: string;
        iteration: number;
        frozen: boolean;
        content_hash: string | null;
        derived_from_revision_id: string | null;
      };
      expect(p02).toEqual({
        id: expect.any(String),
        code: 'P02',
        iteration: 1,
        frozen: false,
        content_hash: null,
        derived_from_revision_id: p01.id,
      });

      // Replaying the same clone request with the same Idempotency-Key returns the same P02
      const cloneReplayRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/clone`,
        headers: { 'idempotency-key': 'idem-p01-clone-key-0001' },
        payload: {},
      });
      expect(cloneReplayRes.statusCode).toBe(201);
      expect(cloneReplayRes.json()).toEqual(p02);

      // Cloning an unfrozen DRAFT (P02) is refused with 422
      const cloneDraftRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p02.id}/clone`,
        headers: { 'idempotency-key': 'idem-p02-clone-draft' },
        payload: {},
      });
      expect(cloneDraftRes.statusCode).toBe(422);

      // Edit P02 succeeds while P01's content_hash remains completely unchanged
      const editP02Res = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p02.id}/facility`,
        payload: {
          width_um: 48_768_000,
          depth_um: 30_480_000,
          clear_height_um: 10_668_000,
          column_grid: { pitch_x_um: 12_192_000, pitch_y_um: 12_192_000 },
          forklift: { model_stated: true, required_aisle_um: 3_048_000 },
          dock_count: 4,
        },
      });
      expect(editP02Res.statusCode).toBe(200);

      const p01AfterP02Edit = await admin(
        `SELECT lifecycle_state, content_hash FROM app.revision WHERE id = $1`,
        [p01.id],
      );
      expect(p01AfterP02Edit.rows[0]).toEqual({
        lifecycle_state: 'FROZEN',
        content_hash: p01ContentHash,
      });

      // 12. Cross-tenant access on all 4 T-14d routes returns 404 + deny audit event
      activePrincipal = TENANT_B_PRINCIPAL;
      const crossBefore = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [TENANT_B_ORG],
      );

      const crossSubmit = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p02.id}/submit`,
        headers: { 'idempotency-key': 'idem-cross-tenant-submit' },
        payload: submitPayload,
      });
      expect(crossSubmit.statusCode).toBe(404);

      const crossClone = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/clone`,
        headers: { 'idempotency-key': 'idem-cross-tenant-clone' },
        payload: {},
      });
      expect(crossClone.statusCode).toBe(404);

      const crossSubRead = await app.inject({
        method: 'GET',
        url: `/api/client/v1/submissions/${firstSubmission.id}`,
      });
      expect(crossSubRead.statusCode).toBe(404);

      const crossDocRead = await app.inject({
        method: 'GET',
        url: `/api/client/v1/documents/${firstSubmission.id}`,
      });
      expect(crossDocRead.statusCode).toBe(404);

      const crossAfter = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [TENANT_B_ORG],
      );
      expect(crossAfter.rows[0]?.n).toBe((crossBefore.rows[0]?.n as number) + 4);

      await app.close();
    },
  );
});

describe('T-14e — internal surface routes (live DB)', () => {
  function extractCookies(setCookieHeader: string | string[] | undefined): Record<string, string> {
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

  function cookieHeader(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  maybe(
    'walks §15.2 step 8 + internal admin operations: staff OIDC SSO, O(1) queue pagination, submission package, revision BOM, internal notes (E-05), derive C01 (AC-14), invitation revoke, idempotency release, catalog approval gate (T-04), and user deactivation (AC-17)',
    async () => {
      const INTERNAL_ORG = '88888888-8888-4888-8888-e14e00000001';
      const STAFF_ADMIN = '88888888-8888-4888-8888-e14e00000002';
      const STAFF_SALES = '88888888-8888-4888-8888-e14e00000003';
      const TENANT_A_ORG = crypto.randomUUID();
      const TENANT_A_USER = crypto.randomUUID();
      const TENANT_B_ORG = crypto.randomUUID();
      const TENANT_B_USER = crypto.randomUUID();

      const CAT_APPROVED = '88888888-8888-4888-8888-e14e00000011';
      const CAT_DRAFT = crypto.randomUUID();
      const RULE_APPROVED = '88888888-8888-4888-8888-e14e00000013';

      const currentMs = Date.parse('2099-07-01T15:00:00.000Z');
      const baseIso = new Date(currentMs).toISOString();

      const ADMIN_PRINCIPAL: Principal = {
        userId: STAFF_ADMIN,
        organizationId: INTERNAL_ORG,
        actorType: 'staff',
        role: 'INTERNAL_ADMIN',
        purpose: 'full',
        reauthenticatedAt: Math.floor(currentMs / 1000),
      };

      const ADMIN_NO_REAUTH_PRINCIPAL: Principal = {
        userId: STAFF_ADMIN,
        organizationId: INTERNAL_ORG,
        actorType: 'staff',
        role: 'INTERNAL_ADMIN',
        purpose: 'full',
      };

      const SALES_PRINCIPAL: Principal = {
        userId: STAFF_SALES,
        organizationId: INTERNAL_ORG,
        actorType: 'staff',
        role: 'INTERNAL_SALES',
        purpose: 'full',
      };

      const TENANT_A_PRINCIPAL: Principal = {
        userId: TENANT_A_USER,
        organizationId: TENANT_A_ORG,
        actorType: 'client',
        role: 'CLIENT_ADMIN',
        purpose: 'full',
      };

      await admin(
        `INSERT INTO app.organization (id, name, is_internal) VALUES
           ($1, 'Rack Master Staff T14e', true),
           ($2, 'Cascade Cold Storage T14e', false),
           ($3, 'Olympia Distribution T14e', false)
         ON CONFLICT (id) DO NOTHING`,
        [INTERNAL_ORG, TENANT_A_ORG, TENANT_B_ORG],
      );

      await admin(
        `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
           ($1, $2, 'admin-t14e@rackmaster.test', 'Staff Admin T14e', 'staff'),
           ($3, $2, 'sales-t14e@rackmaster.test', 'Staff Sales T14e', 'staff'),
           ($4, $5, 'client-a-t14e@cascade.test', 'Cascade Client Admin', 'client'),
           ($6, $7, 'client-b-t14e@olympia.test', 'Olympia Client User', 'client')
         ON CONFLICT (id) DO NOTHING`,
        [
          STAFF_ADMIN,
          INTERNAL_ORG,
          STAFF_SALES,
          TENANT_A_USER,
          TENANT_A_ORG,
          TENANT_B_USER,
          TENANT_B_ORG,
        ],
      );

      await admin(
        `INSERT INTO app.membership (id, organization_id, user_id, role) VALUES
           ($1, $2, $3, 'INTERNAL_ADMIN'),
           ($4, $2, $5, 'INTERNAL_SALES'),
           ($6, $7, $8, 'CLIENT_ADMIN'),
           ($9, $10, $11, 'CLIENT_USER')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [
          '88888888-8888-4888-8888-e14e00000021',
          INTERNAL_ORG,
          STAFF_ADMIN,
          '88888888-8888-4888-8888-e14e00000022',
          STAFF_SALES,
          crypto.randomUUID(),
          TENANT_A_ORG,
          TENANT_A_USER,
          crypto.randomUUID(),
          TENANT_B_ORG,
          TENANT_B_USER,
        ],
      );

      await admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, verification_path, content_sha256)
         VALUES
           ($1, 'Interlake Mecalux', 'cat-2026.09-t14e', 'APPROVED', 'IM-2026.pdf', 'digitiser-1', now(),
            'approver-2', now(), 'reconciled against Kent reference BOM', $3),
           ($2, 'Interlake Mecalux', $5, 'DRAFT', 'IM-draft-2026.pdf', 'digitiser-1', now(),
            NULL, NULL, NULL, $4)
         ON CONFLICT (id) DO NOTHING`,
        [
          CAT_APPROVED,
          CAT_DRAFT,
          'a'.repeat(64),
          'b'.repeat(64),
          `cat-draft-${CAT_DRAFT.slice(0, 8)}`,
        ],
      );

      await admin(
        `INSERT INTO app.rule_pack_release
           (id, name, rev, status, approved_by, approved_at, content_sha256)
         VALUES
           ($1, 'rmi-selective', 'rules-2026.09-t14e', 'APPROVED', 'approver-2', now(), $2)
         ON CONFLICT (id) DO NOTHING`,
        [RULE_APPROVED, 'c'.repeat(64)],
      );

      let activePrincipal: Principal | undefined = ADMIN_PRINCIPAL;
      const wormStore = new InMemoryWormStore(() => new Date(currentMs).toISOString());

      const app = createApp({
        env: {
          CLAIM_LEASE_MINUTES: '10',
          OIDC_ISSUER_URL: 'https://idp.rackmaster.test',
          OIDC_CLIENT_ID: 'rms-staff-oidc',
          OIDC_REDIRECT_URI: 'https://studio.rackmaster.test/api/auth/oidc/callback',
        },
        recordDeny: databaseDenyRecorder(),
        wormStore,
        now: () => new Date(currentMs),
        verifyOidcCode: async (code) => {
          if (code === 'valid-staff-code') {
            return { organizationId: INTERNAL_ORG, email: 'admin-t14e@rackmaster.test' };
          }
          if (code === 'client-user-code') {
            return { organizationId: TENANT_A_ORG, email: 'client-a-t14e@cascade.test' };
          }
          return null;
        },
      });
      app.addHook('onRequest', async (request) => {
        if (activePrincipal !== undefined) {
          request.principal = activePrincipal;
        }
      });

      // -----------------------------------------------------------------------
      // 1. Staff OIDC SSO flow: GET /api/auth/oidc/start & GET /api/auth/oidc/callback
      // -----------------------------------------------------------------------
      activePrincipal = undefined;

      const oidcStartRes = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/start',
      });
      expect(oidcStartRes.statusCode).toBe(302);
      const locationHeader = oidcStartRes.headers['location'] as string;
      expect(locationHeader).toContain('https://idp.rackmaster.test/authorize?');
      const redirectUrl = new URL(locationHeader);
      const oidcState = redirectUrl.searchParams.get('state')!;
      const oidcNonce = redirectUrl.searchParams.get('nonce')!;
      expect(oidcState.length).toBeGreaterThanOrEqual(16);
      expect(oidcNonce.length).toBeGreaterThanOrEqual(16);

      const oidcCookies = extractCookies(oidcStartRes.headers['set-cookie']);
      expect(oidcCookies['rms_oidc_state']).toBeTruthy();

      // Mismatched state -> 401 UNAUTHENTICATED
      const badStateCallback = await app.inject({
        method: 'GET',
        url: `/api/auth/oidc/callback?code=valid-staff-code&state=wrong-state-value-1234`,
        headers: { cookie: cookieHeader(oidcCookies) },
      });
      expect(badStateCallback.statusCode).toBe(401);

      // Client account attempting OIDC -> 401 UNAUTHENTICATED + deny audit
      const clientOidcCallback = await app.inject({
        method: 'GET',
        url: `/api/auth/oidc/callback?code=client-user-code&state=${encodeURIComponent(oidcState)}`,
        headers: { cookie: cookieHeader(oidcCookies) },
      });
      expect(clientOidcCallback.statusCode).toBe(401);

      // Valid staff OIDC code + matching state -> 204 + __Host-rms_session & __Host-rms_org cookies
      const staffOidcCallback = await app.inject({
        method: 'GET',
        url: `/api/auth/oidc/callback?code=valid-staff-code&state=${encodeURIComponent(oidcState)}`,
        headers: { cookie: cookieHeader(oidcCookies) },
      });
      expect(staffOidcCallback.statusCode).toBe(204);
      const staffSessionCookies = extractCookies(staffOidcCallback.headers['set-cookie']);
      expect(staffSessionCookies['__Host-rms_session']).toBeTruthy();
      expect(staffSessionCookies['__Host-rms_org']).toBe(INTERNAL_ORG);

      // Verify the OIDC-minted staff session cookie authenticates an internal request!
      const queueViaOidcCookie = await app.inject({
        method: 'GET',
        url: '/api/internal/v1/queue?page=1&pageSize=10',
        headers: {
          cookie: cookieHeader({
            '__Host-rms_session': staffSessionCookies['__Host-rms_session']!,
            '__Host-rms_org': staffSessionCookies['__Host-rms_org']!,
          }),
        },
      });
      expect(queueViaOidcCookie.statusCode).toBe(200);

      // Switch back to injected principal for subsequent route tests
      activePrincipal = ADMIN_PRINCIPAL;

      // -----------------------------------------------------------------------
      // 2. Seed a realistic submitted revision P01 in Tenant A
      // -----------------------------------------------------------------------
      const createProjRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/projects',
        payload: {
          organization_id: TENANT_A_ORG,
          number: 'PRJ-E01',
          name: 'Cascade High-Bay Freezer',
        },
      });
      expect(createProjRes.statusCode).toBe(201);
      const projectA = createProjRes.json() as { id: string };

      const createRevRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/projects/${projectA.id}/revisions`,
        payload: {
          catalog_release_id: CAT_APPROVED,
          rule_pack_release_id: RULE_APPROVED,
          organization_id: TENANT_A_ORG,
        },
      });
      expect(createRevRes.statusCode).toBe(201);
      const p01 = createRevRes.json() as { id: string; code: string };

      activePrincipal = TENANT_A_PRINCIPAL;

      await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/facility`,
        payload: {
          width_um: 36_576_000,
          depth_um: 24_384_000,
          clear_height_um: 9_753_600,
          column_grid: { pitch_x_um: 12_192_000, pitch_y_um: 12_192_000 },
          forklift: { model_stated: false },
          dock_count: 2,
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/units`,
        payload: {
          units: [
            {
              unit_id: 'gma-48x40',
              width_um: 1_219_200,
              depth_um: 1_016_000,
              height_um: 1_371_600,
              weight_lb: 2200,
              overhang_um: null,
            },
          ],
        },
      });
      await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/options`,
        payload: {
          options: [
            {
              option_id: 'opt-a',
              label: 'Option A — Selective',
              aisle_width_um: 3_048_000,
              runs: [
                {
                  run_id: 'run-a1',
                  unit_id: 'gma-48x40',
                  x_um: 5_000_000, // off 12,192,000 grid -> COLUMN_IN_AISLE REVIEW finding
                  y_um: 12_192_000,
                  bays: [
                    { bay_id: 'bay-1', length_um: 2_438_400, levels: 4 },
                    { bay_id: 'bay-2', length_um: 2_438_400, levels: 4 },
                  ],
                },
              ],
            },
          ],
          active_option_id: 'opt-a',
        },
      });

      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/client/v1/revisions/${p01.id}/submit`,
        headers: { 'idempotency-key': 'idem-t14e-p01-submit' },
        payload: {
          assumptions_acknowledged: true,
          disclaimer_version_id: 'disclaimer-v2026.07',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      const submissionA = submitRes.json() as {
        id: string;
        revision_id: string;
        submission_hash: string;
      };

      // Switch to Staff Sales for internal workspace operations (§15.2 step 8)
      activePrincipal = SALES_PRINCIPAL;

      // -----------------------------------------------------------------------
      // 3. GET /api/internal/v1/queue + constant O(1) SQL statement count proof
      // -----------------------------------------------------------------------
      const queueRes = await app.inject({
        method: 'GET',
        url: '/api/internal/v1/queue?page=1&pageSize=10',
      });
      expect(queueRes.statusCode).toBe(200);
      const queuePage = queueRes.json() as {
        data: Array<{
          submission_id: string;
          organization_id: string;
          organization_name: string;
          project_number: string;
          status: string;
          submitted_at: string;
          blocker_count: number;
          review_count: number;
        }>;
        pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
      };
      const itemA = queuePage.data.find((d) => d.submission_id === submissionA.id);
      expect(itemA).toBeDefined();
      expect(itemA).toMatchObject({
        submission_id: submissionA.id,
        organization_id: TENANT_A_ORG,
        organization_name: 'Cascade Cold Storage T14e',
        project_number: 'PRJ-E01',
        status: 'SUBMITTED',
        blocker_count: 0,
        review_count: 1, // COLUMN_IN_AISLE REVIEW finding
      });

      // Status filter on GET /api/internal/v1/queue?status=QUOTED
      const quotedQueueRes = await app.inject({
        method: 'GET',
        url: '/api/internal/v1/queue?status=QUOTED&page=1&pageSize=10',
      });
      expect(quotedQueueRes.statusCode).toBe(200);
      const quotedQueue = quotedQueueRes.json() as {
        data: Array<{ submission_id: string; status: string }>;
      };
      expect(quotedQueue.data.every((d) => d.status === 'QUOTED')).toBe(true);
      expect(quotedQueue.data.find((d) => d.submission_id === submissionA.id)).toBeUndefined();

      // Prove constant O(1) SQL statement count on queryInternalQueuePage (2 rows vs 25+ rows)
      const countStatementsForQueueRender = async (): Promise<number> =>
        withTenant({ organizationId: INTERNAL_ORG, actorType: 'staff' }, async (client) => {
          let selectCount = 0;
          const origQuery = client.query.bind(client);
          const wrappedClient = Object.create(client, {
            query: {
              value: (...args: unknown[]) => {
                const sqlText = typeof args[0] === 'string' ? args[0] : '';
                if (/^\s*(SELECT|WITH)\b/i.test(sqlText)) {
                  selectCount += 1;
                }
                return (origQuery as (...a: unknown[]) => unknown)(...args);
              },
            },
          }) as pg.PoolClient;
          await queryInternalQueuePage(wrappedClient, { page: 1, pageSize: 10 });
          return selectCount;
        });

      const statementsAtSmallCount = await countStatementsForQueueRender();
      expect(statementsAtSmallCount).toBe(2);

      // Seed 25 additional submissions across Tenant B in one batch SQL statement and verify SQL statement count stays 2
      const projectBId = crypto.randomUUID();
      await admin(
        `INSERT INTO app.project (id, organization_id, number, name, status)
         VALUES ($1, $2, 'PRJ-B-BULK', 'Olympia Bulk Queue Project', 'active')`,
        [projectBId, TENANT_B_ORG],
      );
      await admin(
        `WITH gen AS (
           SELECT i,
                  gen_random_uuid() AS rev_id,
                  gen_random_uuid() AS sub_id,
                  'P' || lpad(i::text, 2, '0') AS code,
                  lpad(to_hex(i), 64, '0') AS hash
             FROM generate_series(1, 25) AS s(i)
         ),
         ins_rev AS (
           INSERT INTO app.revision
             (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
              audience, catalog_release_id, rule_pack_release_id, content, content_hash,
              created_by, frozen_at)
           SELECT rev_id, $1, $2, code, 1, 'FROZEN', 'client', $3, $4,
                  '{"schema_version":1}'::jsonb, hash, $5, '2020-01-01T00:00:00.000Z'::timestamptz
             FROM gen
         )
         INSERT INTO app.submission
           (id, organization_id, revision_id, audience, request_status, manifest_hash,
            manifest_uri, this_hash, submitted_by, submitted_at)
         SELECT sub_id, $1, rev_id, 'client', 'SUBMITTED', hash,
                'manifests/' || sub_id::text || '/' || hash || '.json', hash, $5, '2020-01-01T00:00:00.000Z'::timestamptz
           FROM gen`,
        [TENANT_B_ORG, projectBId, CAT_APPROVED, RULE_APPROVED, TENANT_B_USER],
      );

      const statementsAt25PlusRows = await countStatementsForQueueRender();
      expect(statementsAt25PlusRows).toBe(2);

      // -----------------------------------------------------------------------
      // 4. GET /api/internal/v1/submissions/:id & GET /api/internal/v1/revisions/:id/bom
      // -----------------------------------------------------------------------
      const missingSubRes = await app.inject({
        method: 'GET',
        url: '/api/internal/v1/submissions/88888888-8888-4888-8888-e14e99999999',
      });
      expect(missingSubRes.statusCode).toBe(404);

      const pkgRes = await app.inject({
        method: 'GET',
        url: `/api/internal/v1/submissions/${submissionA.id}`,
      });
      expect(pkgRes.statusCode, pkgRes.body).toBe(200);
      const pkg = pkgRes.json() as {
        submission: {
          id: string;
          organization_id: string;
          revision_id: string;
          request_status: string;
          manifest_hash: string;
        };
        revision: {
          id: string;
          code: string;
          audience: string;
          lifecycle_state: string;
        };
        assumptions: Array<{ key: string }>;
        findings: Array<{
          code: string;
          severity: string;
          citation: string | null;
          rule_id: string;
          verification_tier: string;
        }>;
        bom_lines: Array<{
          id: string;
          mpn: string | null;
          unresolved_reason: string | null;
        }>;
        notes: Array<{ id: string; body: string; client_visible: boolean }>;
      };
      expect(pkg.submission.id).toBe(submissionA.id);
      expect(pkg.submission.organization_id).toBe(TENANT_A_ORG);
      expect(pkg.revision.id).toBe(p01.id);
      expect(pkg.assumptions.length).toBeGreaterThan(0);
      expect(
        pkg.findings.some(
          (f) => f.code === 'COLUMN_IN_AISLE' && f.severity === 'ENGINEERING_REVIEW_REQUIRED',
        ),
      ).toBe(true);
      expect(pkg.findings[0]?.rule_id).toBeTruthy();
      expect(pkg.bom_lines.length).toBeGreaterThan(0);
      expect(pkg.bom_lines.some((l) => l.mpn !== null && l.unresolved_reason === null)).toBe(true);
      expect(pkg.bom_lines.some((l) => l.mpn === null && l.unresolved_reason !== null)).toBe(true);

      // GET /api/internal/v1/revisions/:id/bom
      const missingBomRes = await app.inject({
        method: 'GET',
        url: '/api/internal/v1/revisions/88888888-8888-4888-8888-e14e99999999/bom',
      });
      expect(missingBomRes.statusCode).toBe(404);

      const bomRes = await app.inject({
        method: 'GET',
        url: `/api/internal/v1/revisions/${p01.id}/bom?page=1&pageSize=10`,
      });
      expect(bomRes.statusCode).toBe(200);
      const bomPage = bomRes.json() as {
        data: Array<{
          id: string;
          mpn: string | null;
          unresolved_reason: string | null;
        }>;
        pagination: { totalItems: number };
      };
      expect(bomPage.pagination.totalItems).toBe(pkg.bom_lines.length);

      // -----------------------------------------------------------------------
      // 5. POST /api/internal/v1/revisions/:id/notes (E-05 — never client-visible)
      // -----------------------------------------------------------------------
      const secretNoteBody = 'INTERNAL-ONLY-SEISMIC-ANCHOR-NOTE-DO-NOT-LEAK';
      const createNoteRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/revisions/${p01.id}/notes`,
        payload: { body: secretNoteBody },
      });
      expect(createNoteRes.statusCode).toBe(201);
      const createdNote = createNoteRes.json() as {
        id: string;
        submission_id: string;
        author_id: string;
        body: string;
        client_visible: boolean;
      };
      expect(createdNote).toMatchObject({
        submission_id: submissionA.id,
        author_id: STAFF_SALES,
        body: secretNoteBody,
        client_visible: false,
      });

      // Staff sees the note in SubmissionPackage
      const pkgWithNoteRes = await app.inject({
        method: 'GET',
        url: `/api/internal/v1/submissions/${submissionA.id}`,
      });
      expect(pkgWithNoteRes.statusCode).toBe(200);
      const pkgWithNote = pkgWithNoteRes.json() as {
        notes: Array<{ id: string; body: string; client_visible: boolean }>;
      };
      expect(pkgWithNote.notes).toEqual([
        expect.objectContaining({
          id: createdNote.id,
          body: secretNoteBody,
          client_visible: false,
        }),
      ]);

      // -----------------------------------------------------------------------
      // 6. POST /api/internal/v1/submissions/:id/derive (AC-14 — C01 internal, waivers dropped, client-invisible)
      // -----------------------------------------------------------------------
      // Plant a waiver on source revision P01's finding_internal_detail to prove waivers do NOT carry over to C01
      await admin(
        `UPDATE app.finding_internal_detail
            SET waived_by = $1,
                waived_at = now(),
                waiver_reason = 'Engineer reviewed column offset on P01'
          WHERE organization_id = $2
            AND finding_id IN (SELECT id FROM app.finding WHERE revision_id = $3)`,
        [STAFF_SALES, TENANT_A_ORG, p01.id],
      );

      const p01BeforeDerive = await admin(
        `SELECT lifecycle_state, content_hash FROM app.revision WHERE id = $1`,
        [p01.id],
      );
      const p01HashBefore = p01BeforeDerive.rows[0]?.content_hash as string;

      const deriveRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/submissions/${submissionA.id}/derive`,
        headers: { 'idempotency-key': 'idem-t14e-derive-c01' },
        payload: {},
      });
      expect(deriveRes.statusCode).toBe(201);
      const c01 = deriveRes.json() as {
        id: string;
        organization_id: string;
        project_id: string;
        code: string;
        iteration: number;
        audience: string;
        lifecycle_state: string;
        content_hash: string | null;
        derived_from_revision_id: string | null;
      };
      expect(c01).toMatchObject({
        organization_id: TENANT_A_ORG,
        project_id: projectA.id,
        code: 'C01',
        iteration: 1,
        audience: 'internal',
        lifecycle_state: 'DRAFT',
        content_hash: null,
        derived_from_revision_id: p01.id,
      });

      // Idempotent replay with same Idempotency-Key returns the identical C01 without creating C02
      const deriveReplayRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/submissions/${submissionA.id}/derive`,
        headers: { 'idempotency-key': 'idem-t14e-derive-c01' },
        payload: {},
      });
      expect(deriveReplayRes.statusCode).toBe(201);
      expect(deriveReplayRes.json()).toEqual(c01);

      // Source P01 content_hash is untouched, and waivers on C01 are 0
      const p01AfterDerive = await admin(
        `SELECT lifecycle_state, content_hash FROM app.revision WHERE id = $1`,
        [p01.id],
      );
      expect(p01AfterDerive.rows[0]).toEqual({
        lifecycle_state: 'FROZEN',
        content_hash: p01HashBefore,
      });
      const c01Waivers = await admin(
        `SELECT count(*)::int AS n
           FROM app.finding f
           JOIN app.finding_internal_detail d
             ON d.finding_id = f.id AND d.organization_id = f.organization_id
          WHERE f.revision_id = $1
            AND d.waived_by IS NOT NULL`,
        [c01.id],
      );
      expect(c01Waivers.rows[0]?.n).toBe(0);

      // BOM route also works on unfrozen DRAFT revision C01 (derives BOM on the fly)
      const c01BomRes = await app.inject({
        method: 'GET',
        url: `/api/internal/v1/revisions/${c01.id}/bom?page=1&pageSize=10`,
      });
      expect(c01BomRes.statusCode).toBe(200);
      expect(
        (c01BomRes.json() as { pagination: { totalItems: number } }).pagination.totalItems,
      ).toBeGreaterThan(0);

      // Switch to Tenant A client user to prove AC-14 (C01 invisible) & E-05 (internal note invisible)
      activePrincipal = TENANT_A_PRINCIPAL;

      const clientRevsRes = await app.inject({
        method: 'GET',
        url: `/api/client/v1/projects/${projectA.id}/revisions`,
      });
      expect(clientRevsRes.statusCode).toBe(200);
      const clientRevsBody = clientRevsRes.json() as {
        data: Array<{ id: string; code: string }>;
        pagination: { totalItems: number };
      };
      expect(clientRevsBody.pagination.totalItems).toBe(1);
      expect(clientRevsBody.data.map((r) => r.code)).toEqual(['P01']);
      expect(JSON.stringify(clientRevsBody)).not.toContain('C01');
      expect(JSON.stringify(clientRevsBody)).not.toContain(c01.id);

      const clientPreviewC01 = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${c01.id}/preview`,
      });
      expect(clientPreviewC01.statusCode).toBe(404);

      const clientPreviewP01 = await app.inject({
        method: 'GET',
        url: `/api/client/v1/revisions/${p01.id}/preview`,
      });
      expect(clientPreviewP01.statusCode).toBe(200);
      expect(clientPreviewP01.body).not.toContain(secretNoteBody);

      const clientSubStatus = await app.inject({
        method: 'GET',
        url: `/api/client/v1/submissions/${submissionA.id}`,
      });
      expect(clientSubStatus.statusCode).toBe(200);
      expect(clientSubStatus.body).not.toContain(secretNoteBody);

      // -----------------------------------------------------------------------
      // 7. Client calling any /api/internal/v1/* route gets 404 NOT_FOUND + deny audit
      // -----------------------------------------------------------------------
      const clientDenyBefore = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1 AND outcome = 'denied'`,
        [TENANT_A_ORG],
      );

      const internalEndpointsForClient: Array<{
        method: 'GET' | 'POST';
        url: string;
        headers?: Record<string, string>;
        payload?: Record<string, unknown>;
      }> = [
        { method: 'GET', url: '/api/internal/v1/queue' },
        { method: 'GET', url: `/api/internal/v1/submissions/${submissionA.id}` },
        { method: 'GET', url: `/api/internal/v1/revisions/${p01.id}/bom` },
        {
          method: 'POST',
          url: `/api/internal/v1/submissions/${submissionA.id}/derive`,
          headers: { 'idempotency-key': 'client-derive-attempt' },
          payload: {},
        },
        {
          method: 'POST',
          url: `/api/internal/v1/revisions/${p01.id}/notes`,
          payload: { body: 'client note' },
        },
        {
          method: 'POST',
          url: `/api/internal/v1/users/${TENANT_A_USER}/deactivate`,
          payload: {},
        },
        {
          method: 'POST',
          url: `/api/internal/v1/invitations/${crypto.randomUUID()}/revoke`,
          payload: {},
        },
        {
          method: 'POST',
          url: `/api/internal/v1/idempotency-claims/some-key/release`,
          payload: { organization_id: TENANT_A_ORG, reason: 'client attempt' },
        },
        {
          method: 'POST',
          url: `/api/internal/v1/catalog/releases/${CAT_DRAFT}/approve`,
          payload: {},
        },
      ];

      for (const reqSpec of internalEndpointsForClient) {
        const res = await app.inject(reqSpec);
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({
          error: { code: 'NOT_FOUND', message: 'not found' },
        });
      }

      const clientDenyAfter = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1 AND outcome = 'denied'`,
        [TENANT_A_ORG],
      );
      expect(clientDenyAfter.rows[0]?.n).toBe(
        (clientDenyBefore.rows[0]?.n as number) + internalEndpointsForClient.length,
      );

      // -----------------------------------------------------------------------
      // 8. POST /api/internal/v1/invitations/:id/revoke
      // -----------------------------------------------------------------------
      activePrincipal = ADMIN_PRINCIPAL;

      const inviteRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations',
        headers: { 'idempotency-key': 'idem-t14e-invite-to-revoke' },
        payload: {
          organization_id: TENANT_A_ORG,
          email: 'revoke-target@cascade.test',
          role: 'CLIENT_USER',
        },
      });
      expect(inviteRes.statusCode).toBe(201);
      const pendingInvite = inviteRes.json() as { id: string };

      const revokeRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/invitations/${pendingInvite.id}/revoke`,
        payload: { reason: 'revoked by admin' },
      });
      expect(revokeRes.statusCode).toBe(200);
      const revokedDto = revokeRes.json() as {
        id: string;
        organization_id: string;
        email: string;
      };
      expect(revokedDto.id).toBe(pendingInvite.id);
      expect(revokedDto.organization_id).toBe(TENANT_A_ORG);

      // Confirm revoked_at was set in DB
      const revokedRow = await admin(
        `SELECT revoked_at FROM app.invitation WHERE id = $1`,
        [pendingInvite.id],
      );
      expect(revokedRow.rows[0]?.revoked_at).not.toBeNull();

      // Already-accepted invitation cannot be revoked (422)
      const acceptedInviteId = crypto.randomUUID();
      await admin(
        `INSERT INTO app.invitation
           (id, organization_id, invited_email, role, token_hash, invited_by, expires_at, accepted_at)
         VALUES ($1, $2, 'accepted@cascade.test', 'CLIENT_USER', $3, $4, now() + interval '7 days', now())`,
        [acceptedInviteId, TENANT_A_ORG, 'f'.repeat(64), STAFF_ADMIN],
      );
      const revokeAcceptedRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/invitations/${acceptedInviteId}/revoke`,
        payload: {},
      });
      expect(revokeAcceptedRes.statusCode).toBe(422);

      // Missing invitation -> 404
      const revokeMissingRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/invitations/88888888-8888-4888-8888-e14e99999999/revoke',
        payload: {},
      });
      expect(revokeMissingRes.statusCode).toBe(404);

      // -----------------------------------------------------------------------
      // 9. POST /api/internal/v1/idempotency-claims/:key/release
      // -----------------------------------------------------------------------
      // INTERNAL_SALES is denied idempotency.release (404 per authorize.ts notFound: true) and user.deactivate (403)
      activePrincipal = SALES_PRINCIPAL;
      const salesReleaseRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/idempotency-claims/stuck-claim-key-01/release',
        payload: {
          organization_id: TENANT_A_ORG,
          reason: 'Sales trying admin-only release',
        },
      });
      expect(salesReleaseRes.statusCode).toBe(404);

      const salesDeactivateRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/users/${TENANT_B_USER}/deactivate`,
        payload: { reason: 'Sales trying admin-only deactivate' },
      });
      expect(salesDeactivateRes.statusCode).toBe(403);

      activePrincipal = ADMIN_PRINCIPAL;
      // Plant an in_flight idempotency claim for Tenant A using claimIdempotencyKey
      const claimed = await claimIdempotencyKey(
        { organizationId: TENANT_A_ORG, actorType: 'client' },
        {
          id: crypto.randomUUID(),
          organizationId: TENANT_A_ORG,
          key: 'stuck-claim-key-01',
          intent: 'submit',
          body: { revision_id: p01.id },
          now: new Date(currentMs),
          leaseMs: 600_000,
        },
      );
      expect(claimed.status).toBe('claimed');

      const releaseClaimRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/idempotency-claims/stuck-claim-key-01/release',
        payload: {
          organization_id: TENANT_A_ORG,
          reason: 'Worker crashed mid-flight during maintenance window',
        },
      });
      expect(releaseClaimRes.statusCode).toBe(200);
      const releaseAuditDto = releaseClaimRes.json() as {
        id: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        outcome: string;
        subject_organization_id: string;
      };
      expect(releaseAuditDto).toMatchObject({
        action: 'idempotency.release',
        resource_type: 'idempotency_key',
        outcome: 'success',
        subject_organization_id: TENANT_A_ORG,
      });

      // Releasing again when claim is already released -> 404
      const releaseAgainRes = await app.inject({
        method: 'POST',
        url: '/api/internal/v1/idempotency-claims/stuck-claim-key-01/release',
        payload: {
          organization_id: TENANT_A_ORG,
          reason: 'Second release attempt',
        },
      });
      expect(releaseAgainRes.statusCode).toBe(404);

      // -----------------------------------------------------------------------
      // 10. POST /api/internal/v1/catalog/releases/:id/approve (T-04 gate + re-auth)
      // -----------------------------------------------------------------------
      const beamCells = Array.from({ length: 20 }, (_, i) => `59E/F5M/${String(48 + i)}in`);
      const frameCells = Array.from({ length: 20 }, (_, i) => `F24/HbL36/col${String(i)}`);
      const beamSeed = 101;
      const frameSeed = 202;
      const sampledBeams = drawSpotCheckSample(beamCells, beamSeed);
      const sampledFrames = drawSpotCheckSample(frameCells, frameSeed);

      const validApprovalPayload = {
        approver: 'approver-independent-2',
        datasets: ['beams', 'frames'],
        dataset_cells: [
          { dataset: 'beams', cell_ids: beamCells },
          { dataset: 'frames', cell_ids: frameCells },
        ],
        verification_paths: [
          {
            dataset: 'beams',
            kind: 'full_cross_check',
            cells: 20,
            note: 'Cross-checked all 20 beam capacity cells against PSG 2025 p.88',
          },
          {
            dataset: 'frames',
            kind: 'two_path_reconciliation',
            cells: 20,
            note: 'Two-path extraction reconciled against PSG 2025 p.42',
          },
        ],
        human_spot_checks: [
          {
            dataset: 'beams',
            cells: 20,
            sampled_cells: sampledBeams,
            supplementary_cells: [],
            seed: beamSeed,
            page: 'p.88',
            checker: 'approver-independent-2',
            result: 'MATCHED',
          },
          {
            dataset: 'frames',
            cells: 20,
            sampled_cells: sampledFrames,
            supplementary_cells: [],
            seed: frameSeed,
            page: 'p.42',
            checker: 'approver-independent-2',
            result: 'MATCHED',
          },
        ],
      };

      // Without re-authentication -> 401 UNAUTHENTICATED
      activePrincipal = ADMIN_NO_REAUTH_PRINCIPAL;
      const noReauthApprove = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/catalog/releases/${CAT_DRAFT}/approve`,
        payload: validApprovalPayload,
      });
      expect(noReauthApprove.statusCode).toBe(401);
      expect(noReauthApprove.json()).toMatchObject({
        error: { code: 'UNAUTHENTICATED' },
      });

      // With re-authentication: self-approval (approver === digitised_by 'digitiser-1') is refused by T-04 gate (422)
      activePrincipal = ADMIN_PRINCIPAL;
      const selfApproveRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/catalog/releases/${CAT_DRAFT}/approve`,
        payload: {
          ...validApprovalPayload,
          approver: 'digitiser-1',
        },
      });
      expect(selfApproveRes.statusCode).toBe(422);
      const selfApproveBody = selfApproveRes.json() as {
        error: { code: string; details?: { reasons?: readonly string[] } };
      };
      expect(selfApproveBody.error.code).toBe('UNPROCESSABLE');
      expect(selfApproveBody.error.details?.reasons).toContain(
        'the approver may not be the digitiser',
      );

      // Valid two-person approval transitions status to APPROVED
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/catalog/releases/${CAT_DRAFT}/approve`,
        payload: validApprovalPayload,
      });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json()).toMatchObject({
        id: CAT_DRAFT,
        status: 'APPROVED',
        approved_by: 'approver-independent-2',
        approved_at: baseIso,
      });

      // Approving an already-APPROVED release is refused with 422
      const reApproveRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/catalog/releases/${CAT_DRAFT}/approve`,
        payload: validApprovalPayload,
      });
      expect(reApproveRes.statusCode).toBe(422);

      // -----------------------------------------------------------------------
      // 11. POST /api/internal/v1/users/:id/deactivate (AC-17 — immediate session revocation)
      // -----------------------------------------------------------------------
      // Create a live session in app.session and a pending invitation for TENANT_B_USER
      const clientBSession = await withTenant(
        { organizationId: TENANT_B_ORG, actorType: 'client' },
        async (tx) => {
          await issueInvitation(tx, {
            id: crypto.randomUUID(),
            organizationId: TENANT_B_ORG,
            invitedEmail: 'pending-colleague@olympia.test',
            role: 'CLIENT_USER',
            invitedBy: TENANT_B_USER,
            now: new Date(currentMs),
          });
          return createSession(tx, {
            id: crypto.randomUUID(),
            organizationId: TENANT_B_ORG,
            userId: TENANT_B_USER,
            actorType: 'client',
            purpose: 'full',
            now: new Date(currentMs),
          });
        },
      );

      // Verify client B's session cookie works BEFORE deactivation
      activePrincipal = undefined;
      const clientBCookies = {
        '__Host-rms_session': clientBSession.token,
        '__Host-rms_org': TENANT_B_ORG,
      };
      const beforeDeactivateRes = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects',
        headers: { cookie: cookieHeader(clientBCookies) },
      });
      expect(beforeDeactivateRes.statusCode).toBe(200);

      // Staff Admin deactivates TENANT_B_USER
      activePrincipal = ADMIN_PRINCIPAL;
      const deactivateRes = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/users/${TENANT_B_USER}/deactivate`,
        payload: { reason: 'User left Olympia Distribution' },
      });
      expect(deactivateRes.statusCode).toBe(200);
      expect(deactivateRes.json()).toEqual({
        user: {
          id: TENANT_B_USER,
          organization_id: TENANT_B_ORG,
          email: 'client-b-t14e@olympia.test',
          name: 'Olympia Client User',
          actor_type: 'client',
          status: 'inactive',
        },
        sessions_revoked: 1,
        invitations_revoked: 1,
      });

      // AC-17: Client B's existing session cookie fails IMMEDIATELY on the very next request (401)
      activePrincipal = undefined;
      const afterDeactivateRes = await app.inject({
        method: 'GET',
        url: '/api/client/v1/projects',
        headers: { cookie: cookieHeader(clientBCookies) },
      });
      expect(afterDeactivateRes.statusCode).toBe(401);

      // Unknown user deactivate -> 404 and unknown invitation revoke -> 404
      activePrincipal = ADMIN_PRINCIPAL;
      const unknownUserDeactivate = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/users/${crypto.randomUUID()}/deactivate`,
        payload: {},
      });
      expect(unknownUserDeactivate.statusCode).toBe(404);

      const unknownInvRevoke = await app.inject({
        method: 'POST',
        url: `/api/internal/v1/invitations/${crypto.randomUUID()}/revoke`,
        payload: {},
      });
      expect(unknownInvRevoke.statusCode).toBe(404);

      const missingOidcParams = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/callback',
      });
      expect(missingOidcParams.statusCode).toBe(400);

      await app.close();
    },
  );
});

describe('T-15 — AC-02, AC-03 and AC-06 against the running system (real router + Postgres)', () => {
  const T15_ORG_A = '88888888-8888-4888-8888-e00000000001';
  const T15_ADMIN_A = '88888888-8888-4888-8888-e00000000002';
  const T15_ORG_B = '88888888-8888-4888-8888-e00000000003';
  const T15_USER_B = '88888888-8888-4888-8888-e00000000004';
  const T15_CAT = '88888888-8888-4888-8888-e00000000005';
  const T15_RULE = '88888888-8888-4888-8888-e00000000006';
  const T15_PROJECT = '88888888-8888-4888-8888-e00000000007';
  const T15_REV_DRAFT = '88888888-8888-4888-8888-e00000000008';

  const PRINCIPAL_A: Principal = {
    userId: T15_ADMIN_A,
    organizationId: T15_ORG_A,
    actorType: 'client',
    role: 'CLIENT_ADMIN',
    purpose: 'full',
  };

  const PRINCIPAL_B: Principal = {
    userId: T15_USER_B,
    organizationId: T15_ORG_B,
    actorType: 'client',
    role: 'CLIENT_USER',
    purpose: 'full',
  };

  maybe(
    'enumerates all 32 mounted routes from the live router, calls each against Postgres as a client principal, verifies zero forbidden fields on every client response, 404 on every internal route, and 404 + audit event on every cross-tenant access (AC-02, AC-03, AC-06)',
    async () => {
      await admin(
        `INSERT INTO app.organization (id, name, is_internal) VALUES
           ($1, 'T-15 Tenant A', false),
           ($2, 'T-15 Tenant B', false)
         ON CONFLICT (id) DO NOTHING`,
        [T15_ORG_A, T15_ORG_B],
      );

      await admin(
        `INSERT INTO app.app_user (id, organization_id, email, name, actor_type, status) VALUES
           ($1, $2, 'admin-a@t15.test', 'T-15 Admin A', 'client', 'active'),
           ($3, $4, 'user-b@t15.test', 'T-15 User B', 'client', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [T15_ADMIN_A, T15_ORG_A, T15_USER_B, T15_ORG_B],
      );

      await admin(
        `INSERT INTO app.membership (id, organization_id, user_id, role) VALUES
           ('88888888-8888-4888-8888-e15000000021', $1, $2, 'CLIENT_ADMIN'),
           ('88888888-8888-4888-8888-e15000000022', $3, $4, 'CLIENT_USER')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [T15_ORG_A, T15_ADMIN_A, T15_ORG_B, T15_USER_B],
      );

      await admin(
        `INSERT INTO app.credential
           (user_id, organization_id, password_hash, mfa_type, mfa_secret_hash, password_updated_at, created_at)
         VALUES ($1, $2, 'scrypt$t15', 'none', NULL, now(), now())
         ON CONFLICT (user_id) DO NOTHING`,
        [T15_ADMIN_A, T15_ORG_A],
      );

      await admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, verification_path, content_sha256)
         VALUES
           ($1, 'Interlake Mecalux', 'cat-t15-approved', 'APPROVED', 'IM-T15.pdf', 'dig-1', now(),
            'app-2', now(), 'reconciled against reference BOM', $2)
         ON CONFLICT (id) DO NOTHING`,
        [T15_CAT, '1'.repeat(64)],
      );

      await admin(
        `INSERT INTO app.rule_pack_release
           (id, name, rev, status, approved_by, approved_at, content_sha256)
         VALUES
           ($1, 'rmi-selective', 'rules-t15-approved', 'APPROVED', 'app-2', now(), $2)
         ON CONFLICT (id) DO NOTHING`,
        [T15_RULE, '2'.repeat(64)],
      );

      await admin(
        `INSERT INTO app.project (id, organization_id, number, name, status)
         VALUES ($1, $2, 'PRJ-T15-01', 'T-15 Verification Project', 'active')
         ON CONFLICT (id) DO NOTHING`,
        [T15_PROJECT, T15_ORG_A],
      );

      await admin(
        `INSERT INTO app.revision
           (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
            audience, catalog_release_id, rule_pack_release_id, content, content_hash, created_by)
         VALUES ($1, $2, $3, 'P01', 1, 'DRAFT', 'client', $4, $5, '{"schema_version":1}'::jsonb, NULL, $6)
         ON CONFLICT (id) DO NOTHING`,
        [T15_REV_DRAFT, T15_ORG_A, T15_PROJECT, T15_CAT, T15_RULE, T15_ADMIN_A],
      );

      const currentMs = Date.parse('2026-09-10T12:00:00.000Z');
      let idSeq = 0;
      let activePrincipal: Principal = PRINCIPAL_A;

      const wormStore = new InMemoryWormStore(() => new Date(currentMs).toISOString());
      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        now: () => new Date(currentMs),
        newId: () => {
          idSeq += 1;
          return `88888888-8888-4888-8888-e1${idSeq.toString().padStart(10, '0')}`;
        },
        recordDeny: databaseDenyRecorder(),
        wormStore,
      });
      app.addHook('onRequest', async (request) => {
        request.principal = activePrincipal;
      });
      await app.ready();

      // 1. AC-06: Enumerate mounted routes directly from the live Fastify router
      const mounted = [...app.mountedRoutes];
      expect(mounted).toHaveLength(ROUTES.length);
      expect(mounted).toHaveLength(32);
      expect(new Set(mounted)).toEqual(new Set(ROUTES.map((r) => routeKey(r.method, r.path))));

      // 2. Call every client route in lifecycle order and every internal/public route from `mounted`
      const visited = new Set<string>();
      const callRoute = async (
        key: string,
        url: string,
        opts: { headers?: Record<string, string>; payload?: Record<string, unknown> } = {},
      ) => {
        expect(mounted, `route ${key} must be mounted on the live router`).toContain(key);
        visited.add(key);
        const [method] = key.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
        const res = await app.inject({
          method,
          url,
          ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
          ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
        });
        if (url.startsWith('/api/client/')) {
          expect(
            findForbiddenFields(res.json() as unknown),
            `${key} leaked forbidden client fields`,
          ).toEqual([]);
        }
        return res;
      };

      // Exercise all 14 /api/client/* routes with real data so every 200/201 DTO shape is inspected
      const rProjects = await callRoute('GET /api/client/v1/projects', '/api/client/v1/projects');
      expect(rProjects.statusCode).toBe(200);

      const rRevisions = await callRoute(
        'GET /api/client/v1/projects/:id/revisions',
        `/api/client/v1/projects/${T15_PROJECT}/revisions`,
      );
      expect(rRevisions.statusCode).toBe(200);

      const rFacility = await callRoute(
        'POST /api/client/v1/revisions/:id/facility',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/facility`,
        {
          payload: {
            width_um: 36_576_000,
            depth_um: 24_384_000,
            clear_height_um: 9_753_600,
            column_grid: { pitch_x_um: 12_192_000, pitch_y_um: 12_192_000 },
            forklift: { model_stated: true, required_aisle_um: 3_048_000 },
            dock_count: 2,
          },
        },
      );
      expect(rFacility.statusCode).toBe(200);

      const rUnits = await callRoute(
        'POST /api/client/v1/revisions/:id/units',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/units`,
        {
          payload: {
            units: [
              {
                unit_id: 'u-1',
                width_um: 1_016_000,
                depth_um: 1_219_200,
                height_um: 1_371_600,
                weight_lb: 2_000,
                overhang_um: 0,
              },
            ],
          },
        },
      );
      expect(rUnits.statusCode).toBe(200);

      const rOptions = await callRoute(
        'POST /api/client/v1/revisions/:id/options',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/options`,
        {
          payload: {
            options: [
              {
                option_id: 'opt-a',
                label: 'Option A',
                aisle_width_um: 3_048_000,
                runs: [
                  {
                    run_id: 'run-1',
                    unit_id: 'u-1',
                    x_um: 12_192_000,
                    y_um: 12_192_000,
                    bays: [{ bay_id: 'bay-1', length_um: 2_438_400, levels: 3 }],
                  },
                ],
              },
              {
                option_id: 'opt-b',
                label: 'Option B',
                aisle_width_um: 3_352_800,
                runs: [
                  {
                    run_id: 'run-2',
                    unit_id: 'u-1',
                    x_um: 12_192_000,
                    y_um: 12_192_000,
                    bays: [{ bay_id: 'bay-1', length_um: 2_438_400, levels: 4 }],
                  },
                ],
              },
            ],
            active_option_id: 'opt-a',
          },
        },
      );
      expect(rOptions.statusCode).toBe(200);

      const rPreview = await callRoute(
        'GET /api/client/v1/revisions/:id/preview',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/preview`,
      );
      expect(rPreview.statusCode).toBe(200);

      const rCompare = await callRoute(
        'GET /api/client/v1/revisions/:id/compare',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/compare?options=opt-a,opt-b`,
      );
      expect(rCompare.statusCode).toBe(200);

      const rSubmit = await callRoute(
        'POST /api/client/v1/revisions/:id/submit',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/submit`,
        {
          headers: { 'idempotency-key': 't15-submit-key-1' },
          payload: {
            assumptions_acknowledged: true,
            disclaimer_version_id: 'disclaimer-v2026.09',
          },
        },
      );
      expect(rSubmit.statusCode).toBe(201);
      const t15SubmissionId = (rSubmit.json() as { id: string }).id;

      const rClone = await callRoute(
        'POST /api/client/v1/revisions/:id/clone',
        `/api/client/v1/revisions/${T15_REV_DRAFT}/clone`,
        {
          headers: { 'idempotency-key': 't15-clone-key-1' },
          payload: {},
        },
      );
      expect(rClone.statusCode).toBe(201);
      const t15ClonedRevId = (rClone.json() as { id: string }).id;

      const rSubRead = await callRoute(
        'GET /api/client/v1/submissions/:id',
        `/api/client/v1/submissions/${t15SubmissionId}`,
      );
      expect(rSubRead.statusCode).toBe(200);

      await processPdfOutboxBatch({
        organizationId: T15_ORG_A,
        now: () => new Date(currentMs),
        wormStore,
      });

      const rDocRead = await callRoute(
        'GET /api/client/v1/documents/:id',
        `/api/client/v1/documents/${t15SubmissionId}`,
      );
      expect(rDocRead.statusCode).toBe(200);

      const rMfaEnroll = await callRoute(
        'POST /api/client/v1/mfa/enroll',
        '/api/client/v1/mfa/enroll',
        { payload: { factor_type: 'totp' } },
      );
      expect(rMfaEnroll.statusCode).toBe(200);
      const enrollUri = (rMfaEnroll.json() as { provisioning_uri: string }).provisioning_uri;
      const totpSecret = /secret=([^&]+)/.exec(enrollUri)?.[1] ?? '';

      const rMfaVerify = await callRoute(
        'POST /api/client/v1/mfa/verify',
        '/api/client/v1/mfa/verify',
        { payload: { factor_type: 'totp', code: totpSecret } },
      );
      expect(rMfaVerify.statusCode).toBe(200);

      const rInvite = await callRoute(
        'POST /api/client/v1/invitations',
        '/api/client/v1/invitations',
        {
          headers: { 'idempotency-key': `t15-invite-${crypto.randomUUID()}` },
          payload: { email: `colleague-${crypto.randomUUID()}@t15.test` },
        },
      );
      expect(rInvite.statusCode).toBe(201);

      // Call all remaining mounted routes (the 13 internal routes + 5 public auth routes)
      for (const key of mounted) {
        if (visited.has(key)) continue;
        const [method, rawPath] = key.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
        const url = rawPath.replace(/:\w+/g, T15_PROJECT);
        const res = await callRoute(key, url, method === 'POST' ? { payload: {} } : {});
        if (rawPath.startsWith('/api/internal/')) {
          expect(res.statusCode, `${key} must return 404 to a client principal`).toBe(404);
          expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'not found' } });
        }
      }

      // Every single one of the 32 mounted routes was visited and checked
      expect(visited.size).toBe(mounted.length);
      expect(visited.size).toBe(32);

      // 3. AC-03: Cross-organization access by Tenant B against Tenant A's resources
      //    returns 404 NOT_FOUND (never 403) and writes a deny audit event per attempt.
      activePrincipal = PRINCIPAL_B;
      const bDeniesBeforeRes = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [T15_ORG_B],
      );
      const bDeniesBefore = (bDeniesBeforeRes.rows[0]?.n as number) ?? 0;

      const crossTenantCalls: ReadonlyArray<{
        readonly method: 'GET' | 'POST';
        readonly url: string;
        readonly headers?: Record<string, string>;
        readonly payload?: Record<string, unknown>;
      }> = [
        {
          method: 'GET',
          url: `/api/client/v1/projects/${T15_PROJECT}/revisions`,
        },
        {
          method: 'POST',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/facility`,
          payload: { width_um: 10_000_000, depth_um: 10_000_000, clear_height_um: 6_000_000 },
        },
        {
          method: 'POST',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/units`,
          payload: {
            units: [{ unit_id: 'u1', width_um: 100, depth_um: 100, height_um: 100, weight_lb: 100 }],
          },
        },
        {
          method: 'POST',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/options`,
          payload: {
            options: [
              {
                option_id: 'opt-a',
                label: 'A',
                aisle_width_um: 3_048_000,
                runs: [
                  {
                    run_id: 'r1',
                    unit_id: 'u1',
                    x_um: 0,
                    y_um: 0,
                    bays: [{ bay_id: 'b1', length_um: 2_438_400, levels: 3 }],
                  },
                ],
              },
            ],
            active_option_id: 'opt-a',
          },
        },
        {
          method: 'GET',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/preview`,
        },
        {
          method: 'GET',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/compare?options=opt-a,opt-b`,
        },
        {
          method: 'POST',
          url: `/api/client/v1/revisions/${t15ClonedRevId}/submit`,
          headers: { 'idempotency-key': 't15-cross-tenant-submit' },
          payload: { assumptions_acknowledged: true, disclaimer_version_id: 'd-1' },
        },
        {
          method: 'POST',
          url: `/api/client/v1/revisions/${T15_REV_DRAFT}/clone`,
          headers: { 'idempotency-key': 't15-cross-tenant-clone' },
          payload: {},
        },
        {
          method: 'GET',
          url: `/api/client/v1/submissions/${t15SubmissionId}`,
        },
        {
          method: 'GET',
          url: `/api/client/v1/documents/${t15SubmissionId}`,
        },
      ];

      for (const call of crossTenantCalls) {
        const res = await app.inject({
          method: call.method,
          url: call.url,
          ...(call.headers !== undefined ? { headers: call.headers } : {}),
          ...(call.payload !== undefined ? { payload: call.payload } : {}),
        });
        expect(res.statusCode, `cross-tenant ${call.method} ${call.url} must be 404`).toBe(404);
        expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        expect(findForbiddenFields(res.json() as unknown)).toEqual([]);
      }

      const bDeniesAfterRes = await admin(
        `SELECT count(*)::int AS n FROM app.audit_event
          WHERE actor_organization_id = $1
            AND outcome = 'denied'`,
        [T15_ORG_B],
      );
      const bDeniesAfter = (bDeniesAfterRes.rows[0]?.n as number) ?? 0;
      expect(bDeniesAfter - bDeniesBefore).toBe(crossTenantCalls.length);

      await app.close();
    },
  );
});





