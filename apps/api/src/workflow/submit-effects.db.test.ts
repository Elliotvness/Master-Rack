/**
 * The submit transaction against a REAL Postgres.
 *
 * `packages/workflow` proves the ORDER with injected effects. This proves the
 * other half — that each step writes what it claims, and that section 13.1's
 * rule holds where it actually has to:
 *
 *   **If any step fails, nothing happened.**
 *
 * That sentence is the one worth testing against a database, because it is the
 * one no stub can demonstrate. A test double can be made to "roll back" by
 * simply not recording; a transaction either commits or it does not, and the
 * assertion is what is in the tables afterwards.
 *
 * The failure case is deliberately injected LATE — at step 9, after the freeze,
 * the derived rows, the submission row and three audit events have all been
 * written. A rollback test that fails at step 1 proves nothing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantContext } from '@rms/db';
import { submit, type Derivation, type SubmitInput } from '@rms/workflow';

import { splitOnce, submitEffects, submitRevision, type SubmitContext } from './submit-effects.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '33333333-3333-4333-8333-aaaaaaaaaaaa';
const USER = '33333333-3333-4333-8333-aaaaaaaaaaa1';
const PROJECT = '33333333-3333-4333-8333-aaaaaaaaaaa2';
const CATALOG = '33333333-3333-4333-8333-aaaaaaaaaaa3';
const RULES = '33333333-3333-4333-8333-aaaaaaaaaaa4';
const REVISION = '33333333-3333-4333-8333-aaaaaaaaaaa5';

const IDS = {
  submissionId: '33333333-3333-4333-8333-bbbbbbbbbbb1',
  acknowledgementEventId: '33333333-3333-4333-8333-bbbbbbbbbbb2',
  freezeEventId: '33333333-3333-4333-8333-bbbbbbbbbbb3',
  submissionEventId: '33333333-3333-4333-8333-bbbbbbbbbbb4',
  outboxIds: [
    '33333333-3333-4333-8333-ccccccccccc1',
    '33333333-3333-4333-8333-ccccccccccc2',
    '33333333-3333-4333-8333-ccccccccccc3',
  ],
} as const;

const SECOND_REVISION = '33333333-3333-4333-8333-aaaaaaaaaaa6';
const SECOND_IDS = {
  submissionId: '33333333-3333-4333-8333-bbbbbbbbbbc1',
  acknowledgementEventId: '33333333-3333-4333-8333-bbbbbbbbbbc2',
  freezeEventId: '33333333-3333-4333-8333-bbbbbbbbbbc3',
  submissionEventId: '33333333-3333-4333-8333-bbbbbbbbbbc4',
  outboxIds: [
    '33333333-3333-4333-8333-cccccccccdd1',
    '33333333-3333-4333-8333-cccccccccdd2',
    '33333333-3333-4333-8333-cccccccccdd3',
  ],
} as const;

const AT = '2026-09-01T12:00:00.000Z';
const ctxTenant: TenantContext = { organizationId: ORG, actorType: 'client' };

async function admin(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT scope FROM app.assumption LIMIT 1');
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
    '\n  SKIPPING submit-effects tests: no migrated database. Run `pnpm db:up && pnpm migrate`.\n',
  );
}
const maybe = available ? it : it.skip;

function derivation(over: Partial<Derivation> = {}): Derivation {
  return {
    findings: [
      { code: 'AISLE_OK', severity: 'PASS', closedBy: 'nothing to do', subjectObjectIds: [] },
      {
        code: 'OVERHANG_ASSUMED',
        severity: 'ASSUMPTION',
        closedBy: 'state the pallet overhang',
        subjectObjectIds: ['pos-1'],
      },
    ],
    assumptions: [
      {
        key: 'pallet.overhang.front',
        assumedValue: { value: 101_600, unit: 'um' },
        why: 'No pallet overhang was supplied; the planning default was used.',
        scope: 'every position in unit U-1',
      },
    ],
    contentJson: '{"schema_version":1,"levels":4}',
    manifestJson: '{"schema_version":1,"levels":4,"author":"u","at":"2026-09-01T12:00:00.000Z"}',
    ...over,
  };
}

function input(over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    revisionId: REVISION,
    submittedBy: USER,
    submittedAt: AT,
    assumptionsAcknowledged: true,
    disclaimerVersionId: 'disclaimer-2026-08',
    ...over,
  };
}

function context(over: Partial<SubmitContext> = {}): SubmitContext {
  return {
    organizationId: ORG,
    submittedBy: USER,
    now: AT,
    ids: IDS,
    rederive: () => Promise.resolve(derivation()),
    ...over,
  };
}

beforeAll(async () => {
  if (!available) return;
  await admin(`
    TRUNCATE app.outbox_message, app.bom_line, app.finding_internal_detail, app.finding,
             app.assumption, app.uncatalogued_part, app.internal_note, app.submission,
             app.revision, app.project, app.invitation, app.membership, app.app_user,
             app.catalog_release, app.rule_pack_release, app.organization, app.audit_event
      RESTART IDENTITY CASCADE
  `);
  await admin(`INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'Harbor', false)`, [
    ORG,
  ]);
  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type)
     VALUES ($1, $2, 'ops@harbor.invalid', 'A User', 'client')`,
    [USER, ORG],
  );
  await admin(
    `INSERT INTO app.catalog_release
       (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
        approved_by, approved_at, verification_path, content_sha256)
     VALUES ($1, 'Interlake', '2026-09', 'APPROVED', 'published chart', 'machine-extract',
             now(), 'a named human', now(), 'full cross-check', 'abc')`,
    [CATALOG],
  );
  await admin(
    `INSERT INTO app.rule_pack_release (id, name, rev, status, content_sha256)
     VALUES ($1, 'base', '2026-08', 'APPROVED', 'def')`,
    [RULES],
  );
  await admin(
    `INSERT INTO app.project (id, organization_id, number, name) VALUES ($1, $2, '26-0142', 'Units')`,
    [PROJECT, ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

/** A fresh, unfrozen revision with one unacknowledged assumption. */
async function seedRevision(): Promise<void> {
  // TRUNCATE, not DELETE. `app.revision` carries a trigger refusing row
  // deletion — submitted revisions are immutable for everyone, us included —
  // and a test that had to disable that guard to run would be testing a
  // database the product never uses.
  await admin(`
    TRUNCATE app.outbox_message, app.finding, app.assumption, app.submission,
             app.revision, app.audit_event
      RESTART IDENTITY CASCADE
  `);
  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, catalog_release_id,
        rule_pack_release_id, created_by, content)
     VALUES ($1, $2, $3, 'P01', $4, $5, $6, '{"levels":4}')`,
    [REVISION, ORG, PROJECT, CATALOG, RULES, USER],
  );
  await admin(
    `INSERT INTO app.assumption
       (id, organization_id, revision_id, audience, key, assumed_value_um, assumed_unit, why, scope)
     VALUES (gen_random_uuid(), $1, $2, 'client', 'pallet.overhang.front', 101600, 'um',
             'No pallet overhang was supplied; the planning default was used.',
             'every position in unit U-1')`,
    [ORG, REVISION],
  );
}

/** A second, independent revision — for the case that needs a populated chain. */
async function seedSecondRevision(): Promise<void> {
  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, catalog_release_id,
        rule_pack_release_id, created_by, content)
     VALUES ($1, $2, $3, 'P02', $4, $5, $6, '{"levels":5}')`,
    [SECOND_REVISION, ORG, PROJECT, CATALOG, RULES, USER],
  );
  await admin(
    `INSERT INTO app.assumption
       (id, organization_id, revision_id, audience, key, assumed_value_um, assumed_unit, why, scope)
     VALUES (gen_random_uuid(), $1, $2, 'client', 'pallet.overhang.front', 101600, 'um',
             'No pallet overhang was supplied; the planning default was used.',
             'every position in unit U-2')`,
    [ORG, SECOND_REVISION],
  );
}

beforeEach(async () => {
  if (available) await seedRevision();
});

describe('the submit transaction writes what each step claims', () => {
  maybe('freezes the revision with its CONTENT hash and marks it FROZEN', async () => {
    // Through `submitRevision`, the function a route calls: it opens the
    // transaction itself and passes the revision id from the same object the
    // workflow gets, so the two cannot come apart in shipping code.
    const result = await submitRevision(ctxTenant, input(), context());

    const rows = await admin(
      `SELECT content_hash, frozen_at, lifecycle_state FROM app.revision WHERE id = $1`,
      [REVISION],
    );
    const row = rows.rows[0] as { content_hash: string; frozen_at: Date; lifecycle_state: string };
    expect(row.content_hash).toBe(result.contentHash);
    expect(row.frozen_at).not.toBeNull();
    expect(row.lifecycle_state).toBe('FROZEN');
    // D-03 again, at the database this time: the row carries the CONTENT hash,
    // and the manifest hash is a different value that lands elsewhere.
    expect(result.manifestHash).not.toBe(result.contentHash);
  });

  maybe('puts the MANIFEST hash on the submission row, chained from an empty head', async () => {
    const result = await withTenant(ctxTenant, (tx) =>
      submit(input(), submitEffects(tx, context(), REVISION)),
    );

    const rows = await admin(
      `SELECT manifest_hash, prev_hash, this_hash, revision_id FROM app.submission WHERE id = $1`,
      [IDS.submissionId],
    );
    const row = rows.rows[0] as {
      manifest_hash: string;
      prev_hash: string | null;
      this_hash: string;
      revision_id: string;
    };
    expect(row.manifest_hash).toBe(result.manifestHash);
    expect(row.prev_hash).toBeNull();
    expect(row.this_hash).toBe(result.submissionHash);
    expect(row.revision_id).toBe(REVISION);
  });

  maybe('records the acknowledgement with an audit event the chain actually holds', async () => {
    await withTenant(ctxTenant, (tx) => submit(input(), submitEffects(tx, context(), REVISION)));

    const rows = await admin(
      `SELECT a.acknowledged_by, a.acknowledged_at, a.acknowledgement_audit_event_id, e.action
         FROM app.assumption a
         JOIN app.audit_event e ON e.event_id = a.acknowledgement_audit_event_id
        WHERE a.revision_id = $1`,
      [REVISION],
    );
    expect(rows.rowCount).toBe(1);
    const row = rows.rows[0] as { acknowledged_by: string; action: string };
    expect(row.acknowledged_by).toBe(USER);
    expect(row.action).toBe('assumption.acknowledged');
  });

  maybe('persists the derived findings against the frozen content hash', async () => {
    const result = await withTenant(ctxTenant, (tx) =>
      submit(input(), submitEffects(tx, context(), REVISION)),
    );

    const rows = await admin(
      `SELECT code, severity, revision_hash, audience FROM app.finding
        WHERE revision_id = $1 ORDER BY code`,
      [REVISION],
    );
    expect(rows.rows.map((r) => (r as { code: string }).code)).toEqual([
      'AISLE_OK',
      'OVERHANG_ASSUMED',
    ]);
    for (const r of rows.rows) {
      const row = r as { revision_hash: string; audience: string };
      expect(row.revision_hash).toBe(result.contentHash);
      expect(row.audience).toBe('client');
    }
  });

  maybe('enqueues the outbox work inside the same transaction', async () => {
    await withTenant(ctxTenant, (tx) => submit(input(), submitEffects(tx, context(), REVISION)));

    const rows = await admin(`SELECT topic, status FROM app.outbox_message ORDER BY topic`);
    expect(rows.rows.map((r) => (r as { topic: string }).topic)).toEqual([
      'manifest.upload',
      'notify.submitted',
      'pdf.generate',
    ]);
    for (const r of rows.rows) expect((r as { status: string }).status).toBe('pending');
  });
});

describe('section 13.1 — if any step fails, NOTHING happened', () => {
  maybe('a failure at step 9 leaves no freeze, no submission, no findings, no events', async () => {
    // Step 9 is chosen deliberately. By the time it runs, the revision is
    // frozen, two findings are written, the submission row exists and three
    // audit events are chained. A rollback test that fails at step 1 proves
    // nothing about any of that.
    const tooFewIds = {
      ...IDS,
      outboxIds: ['33333333-3333-4333-8333-ccccccccccc1'],
    };

    await expect(
      withTenant(ctxTenant, (tx) =>
        submit(input(), submitEffects(tx, context({ ids: tooFewIds }), REVISION)),
      ),
    ).rejects.toThrow(/outbox message/);

    const revision = await admin(
      `SELECT content_hash, frozen_at, lifecycle_state FROM app.revision WHERE id = $1`,
      [REVISION],
    );
    const row = revision.rows[0] as {
      content_hash: string | null;
      frozen_at: Date | null;
      lifecycle_state: string;
    };
    expect(row.content_hash).toBeNull();
    expect(row.frozen_at).toBeNull();
    expect(row.lifecycle_state).toBe('DRAFT');

    for (const table of ['submission', 'finding', 'audit_event', 'outbox_message']) {
      const rows = await admin(`SELECT count(*)::int AS n FROM app.${table}`);
      expect({ table, n: (rows.rows[0] as { n: number }).n }).toEqual({ table, n: 0 });
    }

    const assumption = await admin(
      `SELECT acknowledged_by, acknowledgement_audit_event_id FROM app.assumption
        WHERE revision_id = $1`,
      [REVISION],
    );
    const a = assumption.rows[0] as {
      acknowledged_by: string | null;
      acknowledgement_audit_event_id: string | null;
    };
    expect(a.acknowledged_by).toBeNull();
    expect(a.acknowledgement_audit_event_id).toBeNull();
  });

  maybe('a refusal before step 3 writes nothing at all', async () => {
    const blocked = derivation({
      findings: [
        {
          code: 'AISLE_TOO_NARROW',
          severity: 'BLOCKER',
          closedBy: 'widen the aisle to 3,048,000 um',
          subjectObjectIds: [],
        },
      ],
    });

    await expect(
      withTenant(ctxTenant, (tx) =>
        submit(input(), submitEffects(tx, context({ rederive: () => Promise.resolve(blocked) }), REVISION)),
      ),
    ).rejects.toThrow(/widen the aisle/);

    const events = await admin(`SELECT count(*)::int AS n FROM app.audit_event`);
    expect((events.rows[0] as { n: number }).n).toBe(0);
  });

  maybe('refuses effects bound to a different revision than the submission', async () => {
    // The two-sources defect, now a refusal instead of a silent cross-write.
    await expect(
      withTenant(ctxTenant, (tx) =>
        submit(input(), submitEffects(tx, context(), SECOND_REVISION)),
      ),
    ).rejects.toThrow(/bound to revision/);
  });

  maybe('a step whose write matches no row refuses instead of reporting success', async () => {
    // The defect an adversarial review found and this closes: `freezeRevision`,
    // `persistDerived` and `createSubmission` all wrote with a WHERE that can
    // match nothing, and none of them looked at `rowCount`. Submitting a
    // revision id that does not exist committed two audit events asserting a
    // freeze and a submission, plus three outbox messages telling a worker to
    // generate a PDF for a submission that was never written.
    const absent = '33333333-3333-4333-8333-dddddddddddd';

    await expect(
      withTenant(ctxTenant, (tx) =>
        submit(
          input({ revisionId: absent }),
          submitEffects(
          tx,
          context({ rederive: () => Promise.resolve(derivation({ assumptions: [] })) }),
          absent,
        ),
        ),
      ),
    ).rejects.toThrow(/affected 0 row\(s\), not 1/);

    for (const table of ['submission', 'finding', 'audit_event', 'outbox_message']) {
      const rows = await admin(`SELECT count(*)::int AS n FROM app.${table}`);
      expect({ table, n: (rows.rows[0] as { n: number }).n }).toEqual({ table, n: 0 });
    }
  });

  maybe('step 8 refuses a missing event even when the chain ALREADY holds that action', async () => {
    // This is the case the first version of the control could not see, and the
    // reason its original test proved nothing: it compared `action` only, and
    // the fixture truncated `app.audit_event` before every case. After one real
    // submission there is always a `revision.frozen` row, so a second
    // transaction could skip its own event and still pass.
    //
    // So: submit once for real, leave the chain populated, then sabotage.
    await withTenant(ctxTenant, (tx) => submit(input(), submitEffects(tx, context(), REVISION)));
    const existing = await admin(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE action = 'revision.frozen'`,
    );
    expect((existing.rows[0] as { n: number }).n).toBe(1);

    await seedSecondRevision();

    await expect(
      withTenant(ctxTenant, async (tx) => {
        const effects = submitEffects(tx, context({ ids: SECOND_IDS }), SECOND_REVISION);
        const sabotaged = {
          ...effects,
          freezeRevision: async (revisionId: string, contentHash: string, at: string) => {
            // Freeze WITHOUT writing the event the workflow will claim at step 8.
            const frozen = await tx.query(
              `UPDATE app.revision SET frozen_at = $1, content_hash = $2,
                      lifecycle_state = 'FROZEN' WHERE id = $3`,
              [at, contentHash, revisionId],
            );
            expect(frozen.rowCount).toBe(1);
          },
        };
        return submit(input({ revisionId: SECOND_REVISION }), sabotaged);
      }),
    ).rejects.toThrow(/audit events this chain does not hold/);
  });
});

describe('splitOnce (pure)', () => {
  it('splits on the FIRST colon, so a reference may contain colons', () => {
    expect(splitOnce('pdf.generate:sha256:abc')).toEqual({
      head: 'pdf.generate',
      rest: 'sha256:abc',
    });
  });

  it('returns an empty reference when there is no colon at all', () => {
    expect(splitOnce('heartbeat')).toEqual({ head: 'heartbeat', rest: '' });
  });
});
