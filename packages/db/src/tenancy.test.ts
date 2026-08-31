/**
 * Tenancy, tested against a REAL Postgres.
 *
 * A mock cannot test this. Row-level security fails SILENTLY — a SELECT returns
 * zero rows rather than raising — so a mock that returns what the test expects
 * proves precisely nothing. These run against the container in
 * docker-compose.yml and skip, loudly, if it is not up.
 *
 * The assertions map to the blueprint's acceptance criteria:
 *   AC-04  cross-tenant SELECT returns nothing; cross-tenant INSERT is refused
 *   AC-11  a frozen revision cannot be UPDATEd at the database layer
 *   I-1    a client principal cannot reach the BOM table at all
 *   I-3    nobody can delete or alter an audit event
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant } from './index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORG_INTERNAL = '33333333-3333-4333-8333-333333333333';
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const USER_STAFF = 'cccccccc-3333-4333-8333-333333333333';
const CATALOG = 'dddddddd-4444-4444-8444-444444444444';
const RULES = 'eeeeeeee-5555-4555-8555-555555555555';
const PROJECT_A = 'ffffffff-6666-4666-8666-666666666666';
const PROJECT_B = 'ffffffff-7777-4777-8777-777777777777';
const REV_A = '99999999-8888-4888-8888-888888888888';
const REV_B = '99999999-9999-4999-8999-999999999999';

/**
 * Is the database reachable?
 *
 * Probed at MODULE LOAD, with top-level await, not in beforeAll. Vitest
 * evaluates the describe bodies — and therefore any `it` vs `it.skip` decision
 * — before beforeAll runs, so a flag set in beforeAll is always false when the
 * suite is built. That mistake silently skips the entire tenancy suite while
 * reporting a green run, which is the worst possible failure for these tests
 * in particular.
 */
async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM app.organization LIMIT 1');
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
    '\n  SKIPPING tenancy tests: no migrated database at ' +
      ADMIN_URL +
      '\n  Run `pnpm db:up && pnpm migrate` first. These tests are the ONLY evidence' +
      '\n  that tenant isolation works — RLS fails silently, so nothing else catches it.\n',
  );
}

const maybe = available ? it : it.skip;

async function admin<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query<T>(sql, [...values]);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  if (!available) return;

  // Seed. Truncate first so the suite is repeatable.
  await admin(`
    TRUNCATE app.bom_line, app.finding_internal_detail, app.finding, app.assumption,
             app.uncatalogued_part, app.internal_note, app.submission, app.revision,
             app.project, app.invitation, app.membership, app.app_user,
             app.catalog_release, app.rule_pack_release, app.organization,
             app.audit_event
      RESTART IDENTITY CASCADE
  `);

  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES
       ($1, 'Harbor Logistics', false),
       ($2, 'Rival Freight', false),
       ($3, 'McMurray Stern', true)`,
    [ORG_A, ORG_B, ORG_INTERNAL],
  );

  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
       ($1, $4, 'ops@harbor.invalid', 'A User', 'client'),
       ($2, $5, 'ops@rival.invalid', 'B User', 'client'),
       ($3, $6, 'sales@mms.invalid', 'Staff', 'staff')`,
    [USER_A, USER_B, USER_STAFF, ORG_A, ORG_B, ORG_INTERNAL],
  );

  await admin(
    `INSERT INTO app.catalog_release
       (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
        approved_by, approved_at, verification_path, content_sha256)
     VALUES ($1, 'Interlake', '2026-08', 'APPROVED', 'published chart', 'machine-extract',
             now(), 'a named human', now(), 'full cross-check 357/357', 'abc')`,
    [CATALOG],
  );

  await admin(
    `INSERT INTO app.rule_pack_release (id, name, rev, status, content_sha256)
     VALUES ($1, 'base', '2026-08', 'APPROVED', 'def')`,
    [RULES],
  );

  await admin(
    `INSERT INTO app.project (id, organization_id, number, name) VALUES
       ($1, $3, '26-0142', 'Harbor Units A/B/C'),
       ($2, $4, '26-0900', 'Rival Depot')`,
    [PROJECT_A, PROJECT_B, ORG_A, ORG_B],
  );

  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, catalog_release_id,
        rule_pack_release_id, created_by, content)
     VALUES ($1, $3, $5, 'P01', $7, $8, $9, '{"levels":4}'),
            ($2, $4, $6, 'P01', $7, $8, $10, '{"levels":3}')`,
    [REV_A, REV_B, ORG_A, ORG_B, PROJECT_A, PROJECT_B, CATALOG, RULES, USER_A, USER_B],
  );

  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('AC-04 — cross-tenant reads return nothing', () => {
  maybe('sees only its own organization\'s projects', async () => {
    const rows = await withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
      const result = await tx.query('SELECT number FROM app.project');
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['number']).toBe('26-0142');
  });

  maybe('cannot see another organization even when naming its id directly', async () => {
    const rows = await withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
      const result = await tx.query('SELECT id FROM app.project WHERE organization_id = $1', [
        ORG_B,
      ]);
      return result.rows;
    });
    // Empty, not an error. This is exactly why RLS needs a test and not a review.
    expect(rows).toHaveLength(0);
  });

  maybe('cannot see another organization\'s revisions', async () => {
    const rows = await withTenant({ organizationId: ORG_B, actorType: 'client' }, async (tx) => {
      const result = await tx.query('SELECT id FROM app.revision WHERE id = $1', [REV_A]);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  maybe('cannot see that another organization exists', async () => {
    const rows = await withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
      const result = await tx.query('SELECT name FROM app.organization');
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['name']).toBe('Harbor Logistics');
  });

  maybe('lets staff see across organizations', async () => {
    const rows = await withTenant(
      { organizationId: ORG_INTERNAL, actorType: 'staff' },
      async (tx) => (await tx.query('SELECT number FROM app.project')).rows,
    );
    expect(rows).toHaveLength(2);
  });
});

describe('AC-04 — cross-tenant writes are refused', () => {
  maybe('refuses an INSERT into another tenant', async () => {
    await expect(
      withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
        await tx.query(
          `INSERT INTO app.project (id, organization_id, number, name)
           VALUES (gen_random_uuid(), $1, 'STOLEN', 'should not exist')`,
          [ORG_B],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  maybe('refuses an UPDATE that would move a row into another tenant', async () => {
    await expect(
      withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
        await tx.query('UPDATE app.project SET organization_id = $1 WHERE id = $2', [
          ORG_B,
          PROJECT_A,
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  maybe('silently affects no rows when deleting another tenant\'s data', async () => {
    const count = await withTenant(
      { organizationId: ORG_A, actorType: 'client' },
      async (tx) => (await tx.query('DELETE FROM app.project WHERE id = $1', [PROJECT_B])).rowCount,
    );
    expect(count).toBe(0);

    // And the row is still there.
    const still = await admin('SELECT id FROM app.project WHERE id = $1', [PROJECT_B]);
    expect(still.rows).toHaveLength(1);
  });
});

describe('I-1 — a client principal cannot reach internal tables', () => {
  maybe('sees no BOM lines even within its own organization', async () => {
    await admin(
      `INSERT INTO app.bom_line
         (id, organization_id, revision_id, category, part_revision_id, qty, uom,
          rule_text, confirmed, revision_hash, engine_version)
       VALUES (gen_random_uuid(), $1, $2, 'FRAME', gen_random_uuid(), 24, 'EA',
               'frames = (bays + 1) x rows', true, 'hash', '0.0.0')`,
      [ORG_A, REV_A],
    );

    const rows = await withTenant(
      { organizationId: ORG_A, actorType: 'client' },
      async (tx) => (await tx.query('SELECT qty FROM app.bom_line')).rows,
    );
    expect(rows).toHaveLength(0);
  });

  maybe('lets staff see the BOM', async () => {
    const rows = await withTenant(
      { organizationId: ORG_INTERNAL, actorType: 'staff' },
      async (tx) => (await tx.query('SELECT qty FROM app.bom_line')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  maybe('refuses a client INSERT into the BOM', async () => {
    await expect(
      withTenant({ organizationId: ORG_A, actorType: 'client' }, async (tx) => {
        await tx.query(
          `INSERT INTO app.bom_line
             (id, organization_id, revision_id, category, part_revision_id, qty, uom,
              rule_text, confirmed, revision_hash, engine_version)
           VALUES (gen_random_uuid(), $1, $2, 'FRAME', gen_random_uuid(), 1, 'EA',
                   'x', true, 'h', '0')`,
          [ORG_A, REV_A],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('an unset tenant context sees nothing, rather than everything', () => {
  maybe('refuses a non-UUID organization id before it reaches the database', async () => {
    await expect(
      withTenant({ organizationId: 'not-a-uuid', actorType: 'client' }, async () => undefined),
    ).rejects.toThrow(/not a UUID/);
  });

  maybe('refuses an unknown actor type', async () => {
    await expect(
      withTenant(
        { organizationId: ORG_A, actorType: 'admin' as 'client' },
        async () => undefined,
      ),
    ).rejects.toThrow(/unknown actor type/);
  });
});

describe('AC-11 — a frozen revision is immutable at the database layer', () => {
  maybe('refuses to change the content of a frozen revision', async () => {
    await admin(
      `UPDATE app.revision SET lifecycle_state = 'FROZEN', content_hash = 'h', frozen_at = now()
        WHERE id = $1`,
      [REV_A],
    );

    await expect(
      admin('UPDATE app.revision SET content = $1 WHERE id = $2', ['{"levels":99}', REV_A]),
    ).rejects.toThrow(/immutable/i);
  });

  maybe('refuses to delete a frozen revision', async () => {
    await expect(admin('DELETE FROM app.revision WHERE id = $1', [REV_A])).rejects.toThrow(
      /cannot be deleted/i,
    );
  });

  maybe('refuses to move a frozen revision back to DRAFT', async () => {
    await expect(
      admin(`UPDATE app.revision SET lifecycle_state = 'DRAFT' WHERE id = $1`, [REV_A]),
    ).rejects.toThrow(/cannot move from FROZEN to DRAFT/i);
  });

  maybe('permits the one legitimate change: superseding', async () => {
    await expect(
      admin(`UPDATE app.revision SET lifecycle_state = 'SUPERSEDED' WHERE id = $1`, [REV_A]),
    ).resolves.toBeDefined();
  });

  maybe('refuses to change a frozen revision\'s derived BOM rows', async () => {
    await expect(
      admin('UPDATE app.bom_line SET qty = 999 WHERE revision_id = $1', [REV_A]),
    ).rejects.toThrow(/cannot be changed/i);
  });
});

describe('I-3 — audit events cannot be altered or removed', () => {
  maybe('refuses an UPDATE', async () => {
    await admin(
      `INSERT INTO app.audit_event
         (event_id, occurred_at, actor_type, action, resource_type, outcome, hash)
       VALUES (gen_random_uuid(), now(), 'client', 'revision.frozen', 'revision',
               'success', 'h1')`,
    );
    await expect(
      admin(`UPDATE app.audit_event SET action = 'tampered'`),
    ).rejects.toThrow(/append-only/i);
  });

  maybe('refuses a DELETE', async () => {
    await expect(admin('DELETE FROM app.audit_event')).rejects.toThrow(/append-only/i);
  });
});

describe('the approval gate is enforced by the database, not by application code', () => {
  maybe('refuses an APPROVED release whose approver is the digitiser', async () => {
    await expect(
      admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, verification_path, content_sha256)
         VALUES (gen_random_uuid(), 'X', 'r1', 'APPROVED', 'doc', 'same-person', now(),
                 'same-person', now(), 'a path', 'h')`,
      ),
    ).rejects.toThrow(/approval_gate/i);
  });

  maybe('refuses an APPROVED release with no recorded verification path', async () => {
    await expect(
      admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            approved_by, approved_at, content_sha256)
         VALUES (gen_random_uuid(), 'X', 'r2', 'APPROVED', 'doc', 'digitiser', now(),
                 'approver', now(), 'h')`,
      ),
    ).rejects.toThrow(/approval_gate/i);
  });

  maybe('refuses an APPROVED release with a null approver', async () => {
    await expect(
      admin(
        `INSERT INTO app.catalog_release
           (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
            content_sha256)
         VALUES (gen_random_uuid(), 'X', 'r3', 'APPROVED', 'doc', 'digitiser', now(), 'h')`,
      ),
    ).rejects.toThrow(/approval_gate/i);
  });
});

describe('AC-13 — a BOM line is a quantity or an unresolved reason, never both or neither', () => {
  maybe('refuses a line with neither a quantity nor a reason', async () => {
    await expect(
      admin(
        `INSERT INTO app.bom_line
           (id, organization_id, revision_id, category, part_revision_id, uom,
            rule_text, confirmed, revision_hash, engine_version)
         VALUES (gen_random_uuid(), $1, $2, 'DECK', gen_random_uuid(), 'EA', 'r', false,
                 'h', '0')`,
        [ORG_B, REV_B],
      ),
    ).rejects.toThrow(/qty_xor_reason/i);
  });

  maybe('refuses a line with both a quantity and an unresolved reason', async () => {
    await expect(
      admin(
        `INSERT INTO app.bom_line
           (id, organization_id, revision_id, category, part_revision_id, qty, uom,
            rule_text, confirmed, unresolved_reason, revision_hash, engine_version)
         VALUES (gen_random_uuid(), $1, $2, 'DECK', gen_random_uuid(), 2, 'EA', 'r', false,
                 'no support rule published', 'h', '0')`,
        [ORG_B, REV_B],
      ),
    ).rejects.toThrow(/qty_xor_reason/i);
  });

  maybe('accepts an unresolved line carrying its reason', async () => {
    await expect(
      admin(
        `INSERT INTO app.bom_line
           (id, organization_id, revision_id, category, part_revision_id, uom,
            rule_text, confirmed, unresolved_reason, revision_hash, engine_version)
         VALUES (gen_random_uuid(), $1, $2, 'DECK', gen_random_uuid(), 'EA',
                 'deck count per level', false,
                 'no published support rule; three conflicting formulas in prior work',
                 'h', '0')`,
        [ORG_B, REV_B],
      ),
    ).resolves.toBeDefined();
  });

  maybe('refuses a line referencing both a catalog part and an uncatalogued part', async () => {
    await expect(
      admin(
        `INSERT INTO app.bom_line
           (id, organization_id, revision_id, category, part_revision_id,
            uncatalogued_part_id, qty, uom, rule_text, confirmed, revision_hash,
            engine_version)
         VALUES (gen_random_uuid(), $1, $2, 'BEAM', gen_random_uuid(), gen_random_uuid(),
                 1, 'EA', 'r', true, 'h', '0')`,
        [ORG_B, REV_B],
      ),
    ).rejects.toThrow(/part_ref_xor/i);
  });
});
