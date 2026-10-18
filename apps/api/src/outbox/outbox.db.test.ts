/**
 * The transactional outbox, against a REAL Postgres.
 *
 * The one guarantee worth proving directly: a message enqueued in a transaction
 * that ROLLS BACK is never dispatched, because it was never committed. That is
 * the whole reason the outbox exists, and it cannot be tested with a mock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantContext } from '@rms/db';

import { requireDatabase } from '../../../../tools/test-support/require-db.js';
import {
  BAYS_PER_SCHEDULE_PAGE,
  PDF_BUDGET_MIN_JOBS,
  PDF_BUDGET_P95_MS,
  assertPdfJobBudget,
  backoffFor,
  claimBatch,
  claimTopicBatch,
  enqueue,
  markDispatched,
  markFailure,
  preliminaryPdfKey,
  renderPreliminaryPdf,
  summarizePdfJobMetrics,
  type PdfJobSample,
  type PreliminaryPdfBayRow,
} from '../index.js';

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

const ORG = '11111111-1111-4111-8111-dddddddddddd';
const ctx: TenantContext = { organizationId: ORG, actorType: 'staff' };

async function probe(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM app.outbox_message LIMIT 1');
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
requireDatabase(available, 'outbox', ADMIN_URL);
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
let n = 0;
const uuid = (): string => {
  n += 1;
  return `f0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
};

beforeAll(async () => {
  if (!available) return;
  await admin(`TRUNCATE app.outbox_message RESTART IDENTITY CASCADE`);
  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES ($1, 'Outbox Org', true)
       ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (available) await closeDatabase();
});

describe('the core guarantee — a rolled-back transaction dispatches nothing', () => {
  maybe('an outbox row written in a rolled-back transaction never exists', async () => {
    const id = uuid();
    // Force a rollback AFTER enqueue by throwing inside withTenant.
    await expect(
      withTenant(ctx, async (tx) => {
        await enqueue(tx, {
          id,
          organizationId: ORG,
          topic: 'email.invitation',
          payload: { invitationId: 'x' },
          now: AT('2026-08-31T00:00:00Z'),
        });
        // The business change failed after we enqueued. Everything rolls back.
        throw new Error('business change failed');
      }),
    ).rejects.toThrow('business change failed');

    // The row was never committed, so a worker will never see it.
    const rows = await admin('SELECT id FROM app.outbox_message WHERE id = $1', [id]);
    expect(rows.rows).toHaveLength(0);
  });

  maybe('an outbox row written in a committed transaction is durably present', async () => {
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, {
        id,
        organizationId: ORG,
        topic: 'email.submission',
        payload: { submissionId: 's1' },
        now: AT('2026-08-31T00:00:00Z'),
      }),
    );
    const rows = await admin('SELECT status FROM app.outbox_message WHERE id = $1', [id]);
    expect(rows.rows[0]?.['status']).toBe('pending');
  });
});

describe('claiming', () => {
  maybe('claims only pending, due messages', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const due = uuid();
    const future = uuid();

    await withTenant(ctx, async (tx) => {
      await enqueue(tx, {
        id: due,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T00:00:00Z'),
      });
      await enqueue(tx, {
        id: future,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T02:00:00Z'), // available_at in the future
      });
    });

    const claimed = await withTenant(ctx, (tx) =>
      claimBatch(tx, AT('2026-08-31T01:00:00Z')),
    );
    const ids = claimed.map((m) => m.id);
    expect(ids).toContain(due);
    expect(ids).not.toContain(future);
  });

  maybe('a dispatched message is not claimed again', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, { id, organizationId: ORG, topic: 't', payload: {}, now: AT('2026-08-31T00:00:00Z') }),
    );

    await withTenant(ctx, async (tx) => {
      const batch = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      expect(batch).toHaveLength(1);
      await markDispatched(tx, id, AT('2026-08-31T00:01:00Z'));
    });

    const again = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T00:02:00Z')));
    expect(again).toHaveLength(0);

    const row = await admin('SELECT status, attempts FROM app.outbox_message WHERE id = $1', [id]);
    expect(row.rows[0]?.['status']).toBe('dispatched');
    expect(row.rows[0]?.['attempts']).toBe(1);
  });
});

describe('retry and dead-lettering', () => {
  maybe('a failure returns the message to pending with a backed-off availability', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, { id, organizationId: ORG, topic: 't', payload: {}, now: AT('2026-08-31T00:00:00Z') }),
    );

    const outcome = await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      return markFailure(tx, msg!, 'smtp timeout', AT('2026-08-31T00:01:00Z'));
    });
    expect(outcome).toBe('pending');

    const row = await admin(
      'SELECT status, attempts, available_at, last_error FROM app.outbox_message WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.['status']).toBe('pending');
    expect(row.rows[0]?.['attempts']).toBe(1);
    expect(row.rows[0]?.['last_error']).toBe('smtp timeout');
    // available_at moved forward by ~1 minute (the first backoff).
    expect(new Date(row.rows[0]?.['available_at'] as string).getTime()).toBe(
      AT('2026-08-31T00:02:00Z').getTime(),
    );

    // And it is NOT claimable until then.
    const tooEarly = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T00:01:30Z')));
    expect(tooEarly.map((m) => m.id)).not.toContain(id);
  });

  maybe('dead-letters after exhausting attempts', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const id = uuid();
    await withTenant(ctx, (tx) =>
      enqueue(tx, {
        id,
        organizationId: ORG,
        topic: 't',
        payload: {},
        now: AT('2026-08-31T00:00:00Z'),
        maxAttempts: 2,
      }),
    );

    // First failure -> pending (attempt 1 of 2).
    await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:01:00Z'));
      const r = await markFailure(tx, msg!, 'err1', AT('2026-08-31T00:01:00Z'));
      expect(r).toBe('pending');
    });

    // Second failure -> dead (attempt 2 reaches maxAttempts).
    const second = await withTenant(ctx, async (tx) => {
      const [msg] = await claimBatch(tx, AT('2026-08-31T00:05:00Z'));
      return markFailure(tx, msg!, 'err2', AT('2026-08-31T00:05:00Z'));
    });
    expect(second).toBe('dead');

    const row = await admin('SELECT status, attempts FROM app.outbox_message WHERE id = $1', [id]);
    expect(row.rows[0]?.['status']).toBe('dead');
    expect(row.rows[0]?.['attempts']).toBe(2);

    // A dead message is never claimed again.
    const never = await withTenant(ctx, (tx) => claimBatch(tx, AT('2026-08-31T09:00:00Z')));
    expect(never).toHaveLength(0);
  });

  maybe('claimTopicBatch claims only due messages matching the requested topic', async () => {
    await admin('TRUNCATE app.outbox_message RESTART IDENTITY');
    const pdfJob = uuid();
    const otherJob = uuid();

    await withTenant(ctx, async (tx) => {
      await enqueue(tx, {
        id: pdfJob,
        organizationId: ORG,
        topic: 'pdf.generate',
        payload: { reference: 'a'.repeat(64) },
        now: AT('2026-08-31T00:00:00Z'),
      });
      await enqueue(tx, {
        id: otherJob,
        organizationId: ORG,
        topic: 'notify.submitted',
        payload: { reference: 'b'.repeat(64) },
        now: AT('2026-08-31T00:00:00Z'),
      });
    });

    const claimedDefault = await withTenant(ctx, (tx) =>
      claimTopicBatch(tx, 'pdf.generate', AT('2026-08-31T00:01:00Z')),
    );
    expect(claimedDefault.map((m) => m.id)).toEqual([pdfJob]);

    const claimedExplicit = await withTenant(ctx, (tx) =>
      claimTopicBatch(tx, 'notify.submitted', AT('2026-08-31T00:01:00Z'), 5),
    );
    expect(claimedExplicit.map((m) => m.id)).toEqual([otherJob]);
  });
});

describe('backoffFor (pure)', () => {
  it('doubles from a one-minute base', () => {
    expect(backoffFor(1)).toBe(60_000);
    expect(backoffFor(2)).toBe(120_000);
    expect(backoffFor(3)).toBe(240_000);
  });

  it('caps at one hour', () => {
    expect(backoffFor(20)).toBe(60 * 60_000);
  });
});

describe('P-03 — multi-page preliminary PDF renderer and job metric budget gate', () => {
  it('renders a multi-page PDF-1.4 document for a 300-bay unit and a 2-page PDF when 0 bays are present', () => {
    expect(BAYS_PER_SCHEDULE_PAGE).toBe(40);
    expect(PDF_BUDGET_MIN_JOBS).toBe(20);
    expect(PDF_BUDGET_P95_MS).toBe(6_000);
    expect(preliminaryPdfKey('sub-1', 'c'.repeat(64))).toBe(`documents/sub-1/${'c'.repeat(64)}.pdf`);

    const emptyPdf = renderPreliminaryPdf({
      submissionId: 'sub-0',
      manifestHash: 'a'.repeat(64),
      submissionHash: 'b'.repeat(64),
      submittedAt: '2026-09-01T00:00:00.000Z',
      projectNumber: 'PRJ-000',
      projectName: 'Empty (Special \\ Chars)',
      revisionCode: 'P01',
      contentHash: 'c'.repeat(64),
      optionLabel: 'Option A',
      aisleWidthUm: 3_048_000,
      facilityWidthUm: 10_000_000,
      facilityDepthUm: 10_000_000,
      clearHeightUm: 6_000_000,
      bays: [],
      findings: [{ code: 'AISLE_CLEAR_OK', severity: 'PASS', closed_by: 'OK' }],
      assumptions: [
        { code: 'SLAB_ASSUMED', statement: 'Assumed (6 in) slab', acknowledged: true },
        { code: 'SEISMIC_ASSUMED', statement: 'Unacknowledged check', acknowledged: false },
      ],
    });
    expect(emptyPdf.pageCount).toBe(2);
    expect(emptyPdf.bayCount).toBe(0);
    expect(emptyPdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    const emptyText = Buffer.from(emptyPdf.bytes).toString('utf8');
    expect(emptyText.startsWith('%PDF-1.4\n')).toBe(true);
    expect(emptyText.endsWith('%%EOF\n')).toBe(true);
    expect(emptyText).toContain('PRELIMINARY - NOT FOR CONSTRUCTION');

    const bays300: PreliminaryPdfBayRow[] = Array.from({ length: 300 }, (_, idx) => ({
      bayIndex: idx + 1,
      runId: `run-${String(Math.floor(idx / 25) + 1).padStart(2, '0')}`,
      bayId: `bay-${String((idx % 25) + 1).padStart(2, '0')}`,
      xUm: (idx % 25) * 2_743_000,
      yUm: Math.floor(idx / 25) * 2_200_000,
      lengthUm: 2_743_000,
      levels: 4,
    }));

    const pdf300 = renderPreliminaryPdf({
      submissionId: 'sub-300',
      manifestHash: 'd'.repeat(64),
      submissionHash: 'e'.repeat(64),
      submittedAt: '2026-09-01T00:00:00.000Z',
      projectNumber: 'PRJ-300',
      projectName: '300-Bay Facility',
      revisionCode: 'P01',
      contentHash: 'f'.repeat(64),
      optionLabel: 'Option A — 300 Bays',
      aisleWidthUm: 3_353_000,
      facilityWidthUm: 80_000_000,
      facilityDepthUm: 50_000_000,
      clearHeightUm: 9_144_000,
      bays: bays300,
      findings: [],
      assumptions: [],
    });
    // 1 cover/plan page + ceil(300 / 40) = 8 schedule pages = 9 pages total
    expect(pdf300.pageCount).toBe(9);
    expect(pdf300.bayCount).toBe(300);
    const pdf300Text = Buffer.from(pdf300.bytes).toString('utf8');
    expect(pdf300Text).toContain('/Count 9');
    expect(pdf300Text).toContain('#300');
  });

  it('refuses to render a preliminary PDF if any forbidden client field is present (AC-02)', () => {
    const leakyInput = {
      submissionId: 'sub-leak',
      manifestHash: 'a'.repeat(64),
      submissionHash: 'b'.repeat(64),
      submittedAt: '2026-09-01T00:00:00.000Z',
      projectNumber: 'PRJ-LEAK',
      projectName: 'Leak Check',
      revisionCode: 'P01',
      contentHash: 'c'.repeat(64),
      optionLabel: 'Option A',
      aisleWidthUm: 3_048_000,
      facilityWidthUm: 10_000_000,
      facilityDepthUm: 10_000_000,
      clearHeightUm: 6_000_000,
      bays: [],
      findings: [],
      assumptions: [],
      cost: 123.45,
    };
    expect(() => renderPreliminaryPdf(leakyInput)).toThrow(/forbidden client field/);
  });

  it('computes p50/p95/p99 over the recorded set and skips loudly below 20 jobs', () => {
    expect(() => summarizePdfJobMetrics([])).toThrow(RangeError);

    const makeSamples = (durations: readonly number[]): PdfJobSample[] =>
      durations.map((durationMs, i) => ({
        jobId: `job-${String(i + 1)}`,
        submissionId: `sub-${String(i + 1)}`,
        manifestHash: 'a'.repeat(64),
        durationMs,
        pageCount: 9,
        bayCount: 300,
        recordedAt: '2026-09-01T00:00:00.000Z',
      }));

    // Below 20 jobs: skipped loudly (both custom onSkip and default console.warn)
    const warnings: string[] = [];
    const under20 = makeSamples([10, 12, 15, 11, 14]);
    const skipVerdict = assertPdfJobBudget(under20, {
      onSkip: (msg) => warnings.push(msg),
    });
    expect(skipVerdict.status).toBe('skipped_loudly');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[P-03 SKIPPED LOUDLY]');
    expect(warnings[0]).toContain('only 5 of 20 required jobs recorded');

    // Also exercise default console.warn path when onSkip is omitted
    const defaultSkip = assertPdfJobBudget(under20);
    expect(defaultSkip.status).toBe('skipped_loudly');

    // At >= 20 jobs: asserts p95 against 6,000 ms and optional p50 ratchet
    const twentyGood = makeSamples(
      Array.from({ length: 20 }, (_, i) => 10 + i),
    );
    const asserted = assertPdfJobBudget(twentyGood, { ratchetP50Ms: 60 });
    expect(asserted.status).toBe('asserted');
    if (asserted.status === 'asserted') {
      expect(asserted.summary.count).toBe(20);
      expect(asserted.summary.p95).toBeLessThanOrEqual(6_000);
    }

    // Exceeding p95 budget throws
    const twentySlowP95 = makeSamples([
      ...Array.from({ length: 19 }, () => 20),
      7_500,
    ]);
    expect(() => assertPdfJobBudget(twentySlowP95)).toThrow(/exceeds §5\.4 budget/);

    // Exceeding p50 ratchet throws
    const twentySlowP50 = makeSamples(
      Array.from({ length: 20 }, () => 120),
    );
    expect(() =>
      assertPdfJobBudget(twentySlowP50, { budgetP95Ms: 6_000, ratchetP50Ms: 60 }),
    ).toThrow(/exceeds p50 ratchet/);
  });
});

