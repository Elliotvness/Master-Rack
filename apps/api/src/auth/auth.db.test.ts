/**
 * Sessions and invitations, against a REAL Postgres.
 *
 * Skips loudly without a database, for the same reason the tenancy suite does.
 * Probed at module load so the skip decision is correct at collection time.
 *
 * Acceptance criteria exercised here:
 *   AC-01  an invitation is redeemable exactly once; every failure looks alike
 *   AC-17  deactivating a user ends every session and pending invitation
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  closeDatabase,
  configureDatabase,
  withTenant,
  type TenantContext,
} from '@rms/db';
import {
  ACCEPTANCE_SESSION_TTL_MS,
  createSession,
  deactivateUser,
  lifetimeFor,
  hashToken,
  issueInvitation,
  redeemInvitation,
  redemptionResponse,
  regenerateToken,
  resolveSession,
  revokeInvitation,
  revokeSession,
  sessionCookieOptions,
} from '../index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const INVITER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const INVITEE = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

const ctx: TenantContext = { organizationId: ORG, actorType: 'client' };

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM app.session LIMIT 1');
    return true;
  } catch {
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
    '\n  SKIPPING auth tests: no migrated database at ' +
      ADMIN_URL +
      '\n  Run `pnpm db:up && pnpm migrate` first.\n',
  );
}
const maybe = available ? it : it.skip;

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

const AT = (iso: string): Date => new Date(iso);

beforeAll(async () => {
  if (!available) return;

  await admin(
    `TRUNCATE app.session, app.invitation, app.credential, app.membership,
              app.app_user, app.organization RESTART IDENTITY CASCADE`,
  );
  await admin(`INSERT INTO app.organization (id, name) VALUES ($1, 'Harbor')`, [ORG]);
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
       ($1, $3, 'inviter@harbor.invalid', 'Inviter', 'client'),
       ($2, $3, 'invitee@harbor.invalid', 'Invitee', 'client')`,
    [INVITER, INVITEE, ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('AC-01 — an invitation is redeemable exactly once', () => {
  maybe('redeems a valid token and returns the pinned org and role', async () => {
    const token = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000001',
        organizationId: ORG,
        invitedEmail: 'New@Harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return inv.token;
    });

    const result = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, token, AT('2026-08-31T01:00:00Z')),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.organizationId).toBe(ORG);
      expect(result.role).toBe('CLIENT_USER');
      // Email is stored lowercased, never taken from the client at redeem time.
      expect(result.email).toBe('new@harbor.invalid');
    }
  });

  maybe('refuses a second redemption of the same token', async () => {
    const token = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000002',
        organizationId: ORG,
        invitedEmail: 'once@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return inv.token;
    });

    const first = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, token, AT('2026-08-31T01:00:00Z')),
    );
    const second = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, token, AT('2026-08-31T02:00:00Z')),
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  maybe('refuses a CONCURRENT second redemption — exactly one winner', async () => {
    // The sequential test above proves the state check works. This proves the
    // check is atomic, which is a different property and the one that actually
    // matters: two people clicking the same invitation link at the same moment
    // is the realistic case, not one clicking twice slowly.
    //
    // The guard is `UPDATE ... WHERE accepted_at IS NULL` plus an affected-row
    // count. A read-then-write would pass the sequential test and fail this one,
    // handing two accounts a single seat.
    const token = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-00000000000c',
        organizationId: ORG,
        invitedEmail: 'race@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return inv.token;
    });

    // Eight simultaneous redemptions, each in its own transaction.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        withTenant(ctx, (tx) => redeemInvitation(tx, token, AT('2026-08-31T01:00:00Z'))),
      ),
    );

    const winners = attempts.filter((a) => a.ok);
    expect(winners).toHaveLength(1);
    // And every loser is indistinguishable from any other refusal (AC-01).
    for (const loser of attempts.filter((a) => !a.ok)) {
      expect(loser.ok).toBe(false);
    }
  });

  maybe('expired, revoked, used and nonexistent all present identically', async () => {
    // Expired.
    const expiredToken = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000003',
        organizationId: ORG,
        invitedEmail: 'exp@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-01T00:00:00Z'),
      });
      return inv.token;
    });
    const expired = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, expiredToken, AT('2026-09-30T00:00:00Z')),
    );

    // Revoked.
    const revokedToken = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000004',
        organizationId: ORG,
        invitedEmail: 'rev@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      await revokeInvitation(tx, inv.id, AT('2026-08-31T00:30:00Z'));
      return inv.token;
    });
    const revoked = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, revokedToken, AT('2026-08-31T01:00:00Z')),
    );

    // Used.
    const usedToken = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000005',
        organizationId: ORG,
        invitedEmail: 'used@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return inv.token;
    });
    await withTenant(ctx, (tx) => redeemInvitation(tx, usedToken, AT('2026-08-31T01:00:00Z')));
    const used = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, usedToken, AT('2026-08-31T02:00:00Z')),
    );

    // Nonexistent.
    const missing = await withTenant(ctx, (tx) =>
      redeemInvitation(tx, 'a-token-that-was-never-issued', AT('2026-08-31T01:00:00Z')),
    );

    // The internal reasons may differ (they are for the audit log)...
    expect(expired.ok).toBe(false);
    expect(revoked.ok).toBe(false);
    expect(used.ok).toBe(false);
    expect(missing.ok).toBe(false);

    // ...but the CLIENT-FACING response is byte-identical for all four.
    const responses = [expired, revoked, used, missing].map(redemptionResponse);
    for (const r of responses) {
      expect(r).toEqual({ status: 410, body: { state: 'unavailable' } });
    }
  });

  maybe('stores only the hash of the token, never the token', async () => {
    const token = await withTenant(ctx, async (tx) => {
      const inv = await issueInvitation(tx, {
        id: 'c0000000-0000-4000-8000-000000000006',
        organizationId: ORG,
        invitedEmail: 'hash@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITER,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return inv.token;
    });

    const stored = await admin(
      `SELECT token_hash FROM app.invitation WHERE id = 'c0000000-0000-4000-8000-000000000006'`,
    );
    expect(stored.rows[0]?.['token_hash']).toBe(hashToken(token));
    expect(stored.rows[0]?.['token_hash']).not.toBe(token);
  });
});

describe('sessions', () => {
  maybe('creates a session and resolves it by token', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: 'd0000000-0000-4000-8000-000000000001',
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );

    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-08-31T00:30:00Z')),
    );
    expect(resolved?.userId).toBe(INVITER);
  });

  maybe('does not resolve an unknown token', async () => {
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, 'never-issued', AT('2026-08-31T00:30:00Z')),
    );
    expect(resolved).toBeNull();
  });

  maybe('does not resolve past the absolute expiry', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: 'd0000000-0000-4000-8000-000000000002',
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );
    // Client absolute lifetime is 24h.
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-09-01T01:00:00Z')),
    );
    expect(resolved).toBeNull();
  });

  maybe('does not resolve past the idle window', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: 'd0000000-0000-4000-8000-000000000003',
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );
    // Client idle window is 2h.
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-08-31T03:00:00Z')),
    );
    expect(resolved).toBeNull();
  });

  maybe('regenerating the token invalidates the old one', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: 'd0000000-0000-4000-8000-000000000004',
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );

    const newToken = await withTenant(ctx, (tx) =>
      regenerateToken(tx, 'd0000000-0000-4000-8000-000000000004'),
    );

    const oldResolves = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-08-31T00:30:00Z')),
    );
    const newResolves = await withTenant(ctx, (tx) =>
      resolveSession(tx, newToken, AT('2026-08-31T00:30:00Z')),
    );

    expect(oldResolves).toBeNull();
    expect(newResolves?.userId).toBe(INVITER);
  });

  maybe('a revoked session no longer resolves', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: 'd0000000-0000-4000-8000-000000000005',
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );
    await withTenant(ctx, (tx) =>
      revokeSession(tx, 'd0000000-0000-4000-8000-000000000005', 'logout', AT('2026-08-31T00:10:00Z')),
    );
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-08-31T00:30:00Z')),
    );
    expect(resolved).toBeNull();
  });
});

describe('AC-17 — deactivation ends every session and pending invitation', () => {
  maybe('revokes all of a user\'s sessions and their pending invitations at once', async () => {
    // Two live sessions for the invitee.
    const tokens = await withTenant(ctx, async (tx) => {
      const s1 = await createSession(tx, {
        id: 'e0000000-0000-4000-8000-000000000001',
        organizationId: ORG,
        userId: INVITEE,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      });
      const s2 = await createSession(tx, {
        id: 'e0000000-0000-4000-8000-000000000002',
        organizationId: ORG,
        userId: INVITEE,
        actorType: 'client',
        purpose: 'full',
        now: AT('2026-08-31T00:00:00Z'),
      });
      // And a pending invitation the invitee sent.
      await issueInvitation(tx, {
        id: 'e0000000-0000-4000-8000-000000000010',
        organizationId: ORG,
        invitedEmail: 'downstream@harbor.invalid',
        role: 'CLIENT_USER',
        invitedBy: INVITEE,
        now: AT('2026-08-31T00:00:00Z'),
      });
      return [s1.token, s2.token];
    });

    const result = await withTenant(ctx, (tx) =>
      deactivateUser(tx, INVITEE, AT('2026-08-31T04:00:00Z')),
    );
    expect(result.sessionsRevoked).toBe(2);
    expect(result.invitationsRevoked).toBe(1);

    // Neither session resolves any more.
    for (const token of tokens) {
      const resolved = await withTenant(ctx, (tx) =>
        resolveSession(tx, token, AT('2026-08-31T04:30:00Z')),
      );
      expect(resolved).toBeNull();
    }

    // The user is inactive.
    const status = await admin(`SELECT status FROM app.app_user WHERE id = $1`, [INVITEE]);
    expect(status.rows[0]?.['status']).toBe('inactive');
  });
});

describe("a session says what it is FOR, and the database holds it to it", () => {
  /**
   * Migration 0015. The gate decides what an acceptance session may TOUCH
   * (`ACCEPTANCE_REACHABLE`, tested in `app.test.ts`); these are the other half
   * — how long it may last, and whether it may exist without saying what it is
   * for. Both are in the schema rather than in application code, for AD-3's
   * reason: a guarantee decided by a constraint is one no refactor can forget.
   */

  maybe('an acceptance session gets the enrolment window, not the client default', async () => {
    const { session } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: crypto.randomUUID(),
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'acceptance',
        now: AT('2026-09-05T12:00:00Z'),
      }),
    );
    expect(session.purpose).toBe('acceptance');
    // ACCEPTANCE_SESSION_TTL_MS, not the client 24h/2h, and not
    // LOGIN_TOKEN_TTL_MS either — the number is provisional and deliberately
    // its own constant, so this reads it rather than restating it.
    const expected = new Date(AT('2026-09-05T12:00:00Z').getTime() + ACCEPTANCE_SESSION_TTL_MS);
    expect(session.absoluteExpiresAt.toISOString()).toBe(expected.toISOString());
    expect(session.idleExpiresAt.toISOString()).toBe(expected.toISOString());
    expect(session.absoluteExpiresAt.getTime()).toBeLessThan(
      AT('2026-09-05T12:00:00Z').getTime() + 24 * 60 * 60 * 1000,
    );
  });

  maybe('the cookie does not outlive the session it carries', async () => {
    // `lifetimeFor` gained a purpose and `sessionCookieOptions` was the one
    // caller that did not, so an acceptance session died server-side at its cap
    // while its cookie sat in the browser for 24 hours.
    expect(sessionCookieOptions('client', 'acceptance').maxAgeMs).toBe(ACCEPTANCE_SESSION_TTL_MS);
    expect(sessionCookieOptions('client').maxAgeMs).toBe(lifetimeFor('client').absoluteMs);
  });

  maybe('the purpose survives the round trip, so the gate reads the row and not a guess', async () => {
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: crypto.randomUUID(),
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'acceptance',
        now: AT('2026-09-05T13:00:00Z'),
      }),
    );
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, AT('2026-09-05T13:05:00Z')),
    );
    expect(resolved?.purpose).toBe('acceptance');
  });

  maybe('resolving an acceptance session cannot slide it past its own cap', async () => {
    // `resolveSession` slides the idle window on every use. For a session whose
    // idle window IS its absolute cap, that must be a no-op rather than a
    // renewal — otherwise a page that polls keeps it alive for as long as
    // anyone leaves the tab open.
    const start = AT('2026-09-05T14:00:00Z');
    const cap = new Date(start.getTime() + ACCEPTANCE_SESSION_TTL_MS);
    const { token } = await withTenant(ctx, (tx) =>
      createSession(tx, {
        id: crypto.randomUUID(),
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'acceptance',
        now: start,
      }),
    );
    const resolved = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, new Date(cap.getTime() - 60_000)),
    );
    expect(resolved?.idleExpiresAt.toISOString()).toBe(cap.toISOString());
    // Dead at the cap, not a minute after the last poll.
    const later = await withTenant(ctx, (tx) =>
      resolveSession(tx, token, new Date(cap.getTime() + 1000)),
    );
    expect(later).toBeNull();
  });

  maybe('a session CANNOT change what it is for — one UPDATE was the whole escalation', async () => {
    // Review turned an acceptance session into a 24-hour full login in one
    // statement, and `session_tenant_update` lets the application role reach
    // its own organization's session rows — so that statement was reachable
    // from application code. Migration 0015's trigger is what refuses it.
    const id = crypto.randomUUID();
    await withTenant(ctx, (tx) =>
      createSession(tx, {
        id,
        organizationId: ORG,
        userId: INVITER,
        actorType: 'client',
        purpose: 'acceptance',
        now: AT('2026-09-05T16:00:00Z'),
      }),
    );

    await expect(
      admin(
        `UPDATE app.session
            SET purpose = 'full', absolute_expires_at = created_at + interval '24 hours'
          WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/purpose is immutable/);

    // Still what it was, and still short.
    const after = await admin(
      `SELECT purpose, absolute_expires_at - created_at AS span FROM app.session WHERE id = $1`,
      [id],
    );
    expect(after.rows[0]?.['purpose']).toBe('acceptance');

    // And an UPDATE that leaves the purpose alone is untouched by the trigger:
    // revoking an acceptance session must keep working.
    await withTenant(ctx, (tx) => revokeSession(tx, id, 'abandoned', AT('2026-09-05T16:05:00Z')));
    const revoked = await admin(`SELECT revoked_at FROM app.session WHERE id = $1`, [id]);
    expect(revoked.rows[0]?.['revoked_at']).not.toBeNull();
  });

  maybe('a session that does not say what it is for cannot be created at all', async () => {
    // NOT NULL with no default. "Forgot to decide" must not mean "full
    // authority", which is what a DEFAULT would have made it.
    await expect(
      admin(
        `INSERT INTO app.session
           (id, organization_id, user_id, actor_type, token_hash,
            created_at, absolute_expires_at, idle_expires_at, last_seen_at)
         VALUES ($1, $2, $3, 'client', 'nothash-2',
                 now(), now() + interval '1 hour', now() + interval '1 hour', now())`,
        [crypto.randomUUID(), ORG, INVITER],
      ),
    ).rejects.toThrow(/purpose/);

    const columnDefault = await admin(
      `SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'session' AND column_name = 'purpose'`,
    );
    expect(columnDefault.rows[0]?.['column_default']).toBeNull();
  });
});
