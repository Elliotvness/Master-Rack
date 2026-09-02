/**
 * `part` / `part_revision`, against a REAL Postgres (task **T-09**, audit D-10).
 *
 * §19.2 names "BOM lines reference a part revision, never a part" as one of two
 * decisions that cannot be retrofitted. The type has honoured it since 0001; the
 * schema has not, because `bom_line.part_revision_id` referenced nothing. These
 * tests prove the database now refuses, rather than trusting that a caller will
 * pass a real id — the same reason the assumption record is tested here and not
 * against a stub: application validation is a control the next caller routes
 * around, and a foreign key is not.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
  closeDatabase,
  configureDatabase,
  upsertCatalogProjection,
  whereUsed,
  withTenant,
  type TenantTransaction,
} from './index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '44444444-4444-4444-8444-a00000000001';
const ORG_INTERNAL = '44444444-4444-4444-8444-a00000000002';
const USER = '44444444-4444-4444-8444-a00000000003';
const PROJECT = '44444444-4444-4444-8444-a00000000004';
const REVISION = '44444444-4444-4444-8444-a00000000005';
const SUBMISSION = '44444444-4444-4444-8444-a00000000006';
const RELEASE_08 = '44444444-4444-4444-8444-a00000000007';
const RELEASE_09 = '44444444-4444-4444-8444-a00000000008';
const RULES = '44444444-4444-4444-8444-a00000000009';

const MFR = 'Interlake Mecalux';
const CODE = 'IB27ET04800RCA2000';

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

/** Probed at MODULE LOAD — see the note in tenancy.test.ts on why not beforeAll. */
async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT id FROM app.part_revision LIMIT 1');
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
    '\n  SKIPPING part registry tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n',
  );
}
const maybe = available ? it : it.skip;

function projection(capacity: number): {
  parts: { manufacturer: string; code18: string }[];
  partRevisions: {
    manufacturer: string;
    code18: string;
    partNumber: string;
    publishedRow: Record<string, string | number>;
  }[];
} {
  return {
    parts: [{ manufacturer: MFR, code18: CODE }],
    partRevisions: [
      {
        manufacturer: MFR,
        code18: CODE,
        partNumber: 'U0200310',
        publishedRow: { code_18: CODE, span_in: 48, capacity_lbs: capacity },
      },
    ],
  };
}

/** Every function under test is staff-only by RLS, so every call runs as staff. */
async function staff<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  return withTenant({ organizationId: ORG_INTERNAL, actorType: 'staff' }, fn);
}

beforeAll(async () => {
  if (!available) return;
  await admin(`
    TRUNCATE app.bom_line, app.part_revision, app.part, app.finding_internal_detail,
             app.finding, app.assumption, app.uncatalogued_part, app.internal_note,
             app.submission, app.revision, app.project, app.invitation, app.membership,
             app.app_user, app.catalog_release, app.rule_pack_release, app.organization,
             app.audit_event
      RESTART IDENTITY CASCADE
  `);
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1,'Harbor',false), ($2,'Internal',true)`,
    [ORG, ORG_INTERNAL],
  );
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
     VALUES ($1,$2,'a@example.test','A','client')`,
    [USER, ORG],
  );
  // DRAFT, not APPROVED, and deliberately so: `catalog_release_approval_gate`
  // requires an approver who is not the digitiser AND a recorded verification
  // path. Fabricating those to make a fixture load would put a forged approval
  // in the database — the exact shape finding F-02 was about. Release status is
  // not what these tests are about, and DRAFT is the honest fixture.
  for (const [id, rev] of [
    [RELEASE_08, '2026-08'],
    [RELEASE_09, '2026-09'],
  ] as const) {
    await admin(
      `INSERT INTO app.catalog_release
         (id, manufacturer, rev, status, source_document, digitised_by, digitised_at, content_sha256)
       VALUES ($1,$2,$3,'DRAFT','PSG 2025','EL', now(), 'sha256:x')`,
      [id, MFR, rev],
    );
  }
  await admin(
    `INSERT INTO app.rule_pack_release (id, name, rev, content_sha256)
     VALUES ($1,'mvp','2026-08','sha256:y')`,
    [RULES],
  );
  await admin(
    `INSERT INTO app.project (id, organization_id, number, name) VALUES ($1,$2,'P-1','Harbor DC')`,
    [PROJECT, ORG],
  );
  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, catalog_release_id,
        rule_pack_release_id, created_by)
     VALUES ($1,$2,$3,'P01',$4,$5,$6)`,
    [REVISION, ORG, PROJECT, RELEASE_09, RULES, USER],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('T-09 — the projection, written and re-written', () => {
  maybe('writes one part and one revision, and refuses an empty projection', async () => {
    const result = await staff(async (tx) =>
      upsertCatalogProjection(tx, RELEASE_09, projection(5610), () => crypto.randomUUID()),
    );
    expect(result).toEqual({ partsSeen: 1, revisionsWritten: 1 });

    await expect(
      staff(async (tx) =>
        upsertCatalogProjection(tx, RELEASE_09, { parts: [], partRevisions: [] }, () =>
          crypto.randomUUID(),
        ),
      ),
    ).rejects.toThrow(/empty catalog projection/);
  });

  maybe('PRESERVES the id when the same release is loaded again', async () => {
    // This is what keeps a bom_line written last month resolving. If a reload
    // re-issued ids, every historical reference would dangle — and the failure
    // would be silent until someone opened an old revision.
    const before = await admin('SELECT id, published_row FROM app.part_revision');
    expect(before.rows).toHaveLength(1);

    await staff(async (tx) =>
      upsertCatalogProjection(tx, RELEASE_09, projection(9999), () => crypto.randomUUID()),
    );

    const after = await admin('SELECT id, published_row FROM app.part_revision');
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]?.['id']).toBe(before.rows[0]?.['id']);
    // The id held; the values moved. Both halves matter.
    expect(after.rows[0]?.['published_row']).toMatchObject({ capacity_lbs: 9999 });
  });

  maybe('carries the release, so one part has a revision per release (§10.2)', async () => {
    await staff(async (tx) =>
      upsertCatalogProjection(tx, RELEASE_08, projection(5620), () => crypto.randomUUID()),
    );
    const rows = await admin(
      `SELECT pr.catalog_release_id, pr.published_row, p.code_18
         FROM app.part_revision pr JOIN app.part p ON p.id = pr.part_id
        ORDER BY pr.catalog_release_id`,
    );
    // ONE part, TWO revisions — which is the whole reason a BOM line references
    // the revision. 288 of the 336 shared codes changed value between these two
    // real releases; a line pinned to 2026-08 must still render 2026-08's number.
    expect(new Set(rows.rows.map((r) => r['code_18'])).size).toBe(1);
    expect(rows.rows).toHaveLength(2);
    const caps = rows.rows.map((r) => (r['published_row'] as { capacity_lbs: number }).capacity_lbs);
    expect(new Set(caps)).toEqual(new Set([5620, 9999]));
  });
});

describe('T-09 — the write refuses to report a success it did not achieve', () => {
  maybe('REFUSES when the revision names a part that was never written', async () => {
    // The INSERT ... SELECT writes nothing when the SELECT matches nothing, and
    // pg reports rowCount 0 without erroring. Writing 0 of 336 rows and
    // returning "done" is the vacuous pass this repository guards against
    // everywhere else, so the writer checks its own rowCount. This is the test
    // that makes that check something other than decoration.
    await expect(
      staff(async (tx) =>
        upsertCatalogProjection(
          tx,
          RELEASE_09,
          {
            parts: [],
            partRevisions: [
              {
                manufacturer: MFR,
                code18: 'CODE-THAT-HAS-NO-PART-ROW',
                partNumber: 'X',
                publishedRow: { code_18: 'CODE-THAT-HAS-NO-PART-ROW' },
              },
            ],
          },
          () => crypto.randomUUID(),
        ),
      ),
    ).rejects.toThrow(/wrote 0 rows, expected 1/);
  });
});

describe('T-09 — where-used (FR-BM-05), unanswerable before 0010', () => {
  maybe('names the revision that uses a part revision, and the request over it', async () => {
    const pr = await admin(
      `SELECT id FROM app.part_revision WHERE catalog_release_id = $1`,
      [RELEASE_09],
    );
    const partRevisionId = pr.rows[0]?.['id'] as string;

    await admin(
      `INSERT INTO app.bom_line
         (id, organization_id, revision_id, category, part_revision_id, qty, uom,
          rule_text, confirmed, revision_hash, engine_version)
       VALUES ($1,$2,$3,'beam',$4,312,'each','beams per bay',true,'h','v')`,
      [crypto.randomUUID(), ORG, REVISION, partRevisionId],
    );

    const before = await staff(async (tx) => whereUsed(tx, partRevisionId));
    expect(before).toHaveLength(1);
    expect(before[0]?.revisionId).toBe(REVISION);
    expect(before[0]?.revisionCode).toBe('P01');
    // No submission yet — and it is still a use. A query that only counted
    // submitted revisions would under-report the impact of superseding a part,
    // which is exactly what FR-CT-06 asks.
    expect(before[0]?.submissionId).toBeNull();

    await admin(
      `INSERT INTO app.submission
         (id, organization_id, revision_id, request_status, audience, manifest_hash, this_hash, submitted_by)
       VALUES ($1,$2,$3,'SUBMITTED','client','mh','th',$4)`,
      [SUBMISSION, ORG, REVISION, USER],
    );

    const after = await staff(async (tx) => whereUsed(tx, partRevisionId));
    expect(after).toHaveLength(1);
    expect(after[0]?.submissionId).toBe(SUBMISSION);
    expect(after[0]?.requestStatus).toBe('SUBMITTED');
  });

  maybe('returns nothing for a part revision nothing references', async () => {
    // The other half. Without this, a whereUsed that returned every row would
    // pass the test above and be useless.
    const rows = await staff(async (tx) => whereUsed(tx, crypto.randomUUID()));
    expect(rows).toEqual([]);
  });
});

describe('T-09 — the registry is staff-only', () => {
  maybe('a CLIENT principal sees no part rows at all', async () => {
    // RLS fails by returning nothing, not by erroring, which is why this
    // asserts the empty result rather than a rejection. The catalog IS the
    // commercial position this product exists to protect.
    const rows = await withTenant({ organizationId: ORG, actorType: 'client' }, async (tx) =>
      (await tx.query('SELECT id FROM app.part_revision')).rows,
    );
    expect(rows).toEqual([]);

    // And staff, in the same shape, do see them — or the assertion above would
    // pass against an empty table and prove nothing.
    const asStaff = await staff(async (tx) =>
      (await tx.query('SELECT id FROM app.part_revision')).rows,
    );
    expect(asStaff.length).toBeGreaterThan(0);
  });
});

describe('T-09 — the foreign key that did not exist before 0010', () => {
  maybe('REFUSES a bom_line against a part revision that does not exist', async () => {
    await expect(
      admin(
        `INSERT INTO app.bom_line
           (id, organization_id, revision_id, category, part_revision_id, qty, uom,
            rule_text, confirmed, revision_hash, engine_version)
         VALUES ($1,$2,$3,'beam',$4,2,'each','r',true,'h','v')`,
        [crypto.randomUUID(), ORG, REVISION, crypto.randomUUID()],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
