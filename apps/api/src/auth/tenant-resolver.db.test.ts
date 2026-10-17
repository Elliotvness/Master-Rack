/**
 * The invitation tenant resolver, against a REAL Postgres (**F-47**).
 *
 * Two things are proven here and neither can be proven any other way.
 *
 * 1. THE RESOLVER RESOLVES. An anonymous caller holding only a token learns
 *    which organization to open a tenant context on, which is the circle §14.3
 *    and RLS between them close: the organization may not travel in the token
 *    or the URL, and the row that holds it cannot be read until the
 *    organization is known.
 *
 * 2. THE ROOM IS EMPTY. `withUnresolvedTenant` opens a transaction with no
 *    tenant context, and the claim that such a context "sees nothing rather
 *    than everything" was, until this file, asserted in prose and by argument
 *    and never by a query. F-47 found that gap while checking something else:
 *    the suite named after that sentence contains only the two
 *    argument-validation cases and never runs a statement with no context at
 *    all. A guarantee nothing queries is a guarantee nobody has tested.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  closeDatabase,
  configureDatabase,
  withTenant,
  withUnresolvedTenant,
} from '@rms/db';

import { hashToken } from './crypto.js';
import { issueInvitation, redeemInvitation, resolveInvitationTenant } from './invitation.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '77777777-7777-4777-8777-b00000000001';
const OTHER_ORG = '77777777-7777-4777-8777-b00000000002';
const INVITER = '77777777-7777-4777-8777-b00000000003';

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

/**
 * Probed at MODULE LOAD, and it refuses rather than skips when the database is
 * reachable but the function is absent — the same posture as `app.db.test.ts`.
 * "The resolver is the only privileged surface in the schema" verifies against
 * a real function or not at all.
 */
async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query(`SELECT app.resolve_invitation_tenant('probe')`);
    return true;
  } catch (error) {
    if (connected) {
      throw new Error(
        'app.resolve_invitation_tenant is missing from a reachable database — migration 0014 ' +
          'has not applied. Refusing to skip: the one SECURITY DEFINER function in this schema ' +
          `verifies against a real one or not at all. Underlying error: ${String(error)}`,
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
if (!available) {
  console.warn('\n  SKIPPING tenant-resolver tests: no migrated database.\n');
}
const maybe = available ? it : it.skip;

const AT = (iso: string): Date => new Date(iso);

beforeAll(async () => {
  if (!available) return;
  for (const [id, name] of [
    [ORG, 'Resolver Org'],
    [OTHER_ORG, 'Resolver Rival'],
  ] as const) {
    await admin(
      `INSERT INTO app.organization (id, name, is_internal) VALUES ($1,$2,false)
       ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
  }
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
     VALUES ($1,$2,'inviter@example.test','Inviter','client') ON CONFLICT (id) DO NOTHING`,
    [INVITER, ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

async function issue(id: string, now: Date): Promise<string> {
  const { token } = await withTenant({ organizationId: ORG, actorType: 'client' }, (tx) =>
    issueInvitation(tx, {
      id,
      organizationId: ORG,
      invitedEmail: 'invited@example.test',
      role: 'CLIENT_USER',
      invitedBy: INVITER,
      now,
    }),
  );
  return token;
}

describe('F-47 — an anonymous bearer resolves to its tenant, and to nothing else', () => {
  maybe('a token resolves to the organization that owns the invitation', async () => {
    const token = await issue(crypto.randomUUID(), AT('2026-09-05T09:00:00Z'));
    // No tenant context is supplied anywhere in this call. That is the point:
    // the caller does not know one yet, which is the whole problem.
    expect(await resolveInvitationTenant(token)).toBe(ORG);
  });

  maybe('a token nobody issued resolves to null, not to an error and not to a guess', async () => {
    expect(await resolveInvitationTenant('a-token-that-was-never-issued')).toBeNull();
  });

  maybe('an ACCEPTED invitation still resolves, so the refusal can be recorded with its reason', async () => {
    // Deliberate, and the migration says so: filtering used and expired tokens
    // inside the resolver would return null, the caller would never enter the
    // tenant, `redeemInvitation` would never run, and the distinct audit reason
    // — invalid / expired / used / revoked — would be lost. AC-01 requires the
    // CLIENT cannot tell them apart. The audit log must.
    const token = await issue(crypto.randomUUID(), AT('2026-09-05T09:00:00Z'));
    const first = await withTenant({ organizationId: ORG, actorType: 'client' }, (tx) =>
      redeemInvitation(tx, token, AT('2026-09-05T09:30:00Z')),
    );
    expect(first.ok).toBe(true);

    expect(await resolveInvitationTenant(token)).toBe(ORG);
    const second = await withTenant({ organizationId: ORG, actorType: 'client' }, (tx) =>
      redeemInvitation(tx, token, AT('2026-09-05T09:31:00Z')),
    );
    expect(second).toEqual({ ok: false, reason: 'used' });
  });

  maybe('the resolver returns a uuid and the row stays unreadable from the same transaction', async () => {
    const id = crypto.randomUUID();
    const token = await issue(id, AT('2026-09-05T09:00:00Z'));

    const seen = await withUnresolvedTenant(async (tx) => {
      const resolved = await tx.query<{ organization_id: string | null }>(
        'SELECT app.resolve_invitation_tenant($1) AS organization_id',
        [hashToken(token)],
      );
      // The same transaction, immediately afterwards, reading the row the
      // function just read one column of.
      const row = await tx.query(
        'SELECT id, invited_email, role, expires_at FROM app.invitation WHERE id = $1',
        [id],
      );
      return { organizationId: resolved.rows[0]?.organization_id ?? null, rows: row.rowCount };
    });

    expect(seen.organizationId).toBe(ORG);
    // The function is a tenant RESOLVER, not a reader. Its caller learns one
    // uuid and cannot follow it back to the email, the role or the expiry.
    expect(seen.rows).toBe(0);
  });
});

describe('an unset tenant context sees nothing, rather than everything — queried, not argued', () => {
  maybe('every tenant table returns zero rows with no context set', async () => {
    // The rows exist: `admin` seeded them above and the tenant-scoped reads in
    // the previous suite found them. So a zero here is RLS refusing, not an
    // empty database — and the assertion below proves that distinction rather
    // than assuming it.
    const withContext = await withTenant({ organizationId: ORG, actorType: 'client' }, (tx) =>
      tx.query('SELECT id FROM app.organization WHERE id = $1', [ORG]),
    );
    expect(withContext.rowCount).toBe(1);

    // EVERY tenant table, derived from the catalog rather than from a list
    // somebody keeps current. The first version of this test named five tables
    // by hand and passed — while the one table it omitted was the one that
    // mattered. A hand-written inventory of what to check is the same defect
    // shape as a hand-written count.
    const tables = (
      await admin(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname`,
      )
    ).rows.map((r) => r['relname'] as string);
    expect(tables.length).toBeGreaterThanOrEqual(20);

    const readable = await withUnresolvedTenant(async (tx) => {
      const out: string[] = [];
      for (const table of tables) {
        const r = await tx.query(`SELECT 1 FROM app.${table} LIMIT 1`);
        if ((r.rowCount ?? 0) > 0) out.push(table);
      }
      return out;
    });
    expect(readable).toEqual([]);
  });

  maybe('a WRITE with no tenant context is refused — including into the audit log', async () => {
    // THE ONE REVIEW FOUND, and the reason `withUnresolvedTenant` opens
    // READ ONLY rather than relying on RLS. `audit_event_insert` is
    // `WITH CHECK (true)` — deliberately, because a deny by any actor must be
    // recordable — and `app_user` holds INSERT. So RLS does NOT make a
    // no-tenant transaction inert for writes: review committed a forged
    // `catalog.approve` row through this doorway and then could not delete it,
    // because the append-only trigger refuses DELETE. A write that is both
    // possible and irreversible is the worst kind to leave to an argument.
    const forged = crypto.randomUUID();
    await expect(
      withUnresolvedTenant((tx) =>
        tx.query(
          `INSERT INTO app.audit_event
             (event_id, occurred_at, actor_type, action, resource_type, resource_id, outcome, hash)
           VALUES ($1, now(), 'staff', 'catalog.approve', 'catalog_release', 'forged', 'success', 'x')`,
          [forged],
        ),
      ),
    ).rejects.toThrow(/read-only transaction/i);
    expect((await admin(`SELECT 1 FROM app.audit_event WHERE event_id = $1`, [forged])).rowCount).toBe(0);

    // And the RLS-governed case, which was the only one tested before.
    await expect(
      withUnresolvedTenant((tx) =>
        tx.query(
          `INSERT INTO app.organization (id, name, is_internal) VALUES ($1,'Smuggled',false)`,
          ['77777777-7777-4777-8777-b00000000099'],
        ),
      ),
    ).rejects.toThrow();
    expect((await admin(`SELECT 1 FROM app.organization WHERE name = 'Smuggled'`)).rowCount).toBe(0);
  });

  maybe('two organizations holding one token hash resolve to NOTHING, not to whichever came first', async () => {
    // `token_hash` is unique only PER ORGANIZATION — §14.2 item 5 requires every
    // uniqueness constraint to be composite with organization_id, because a
    // global unique index leaks another tenant's row existence through a
    // constraint-violation message. So two tenants holding one hash is a shape
    // the schema ACCEPTS, and a bare scalar SELECT would have returned whichever
    // row came first: the acceptance path would open a stranger's tenant and
    // redeem there. Review demonstrated it against the first draft.
    const hash = `collide-${crypto.randomUUID()}`;
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await admin(
      `INSERT INTO app.invitation (id, organization_id, token_hash, invited_email, role, invited_by, expires_at)
       VALUES ($1,$3,$5,'a@example.test','CLIENT_USER',$4,now() + interval '1 day'),
              ($2,$6,$5,'b@example.test','CLIENT_USER',$4,now() + interval '1 day')`,
      [ids[0], ids[1], ORG, INVITER, hash, OTHER_ORG],
    );
    try {
      expect((await admin(`SELECT 1 FROM app.invitation WHERE token_hash = $1`, [hash])).rowCount).toBe(2);
      const resolved = await withUnresolvedTenant(async (tx) => {
        const r = await tx.query<{ organization_id: string | null }>(
          'SELECT app.resolve_invitation_tenant($1) AS organization_id',
          [hash],
        );
        return r.rows[0]?.organization_id ?? null;
      });
      // NULL, which the caller reports as the same generic refusal as an
      // unknown token. Nobody is misdirected.
      expect(resolved).toBeNull();
    } finally {
      await admin(`DELETE FROM app.invitation WHERE token_hash = $1`, [hash]);
    }
  });
});
