import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { closeDatabase, configureDatabase, withTenant, type TenantTransaction } from '@rms/db';

import { createApp, databaseDenyRecorder, type Principal } from '../../apps/api/src/app.js';
import {
  assertPdfJobBudget,
  type PdfJobSample,
} from '../../apps/api/src/outbox/pdf-job.js';
import {
  processPdfOutboxBatch,
  queryInternalQueuePage,
} from '../../apps/api/src/revisions/routes.js';
import { InMemoryWormStore } from '../../apps/api/src/worm/memory-store.js';
import { requireDatabase } from '../test-support/require-db.js';
import { formatTable, measure, measureAsync, type Measurement } from './measure.js';
import { FIXTURE, fullDerivation, preview, submissionDraftContent } from './workload.js';

/**
 * The §5.4 budgets that are measurable in CI (`preview`, `fullDerivation`,
 * `submission` via **P-01**, `queueLoad` at 5,000 submissions via **P-02**,
 * and `pdfGeneration` from the outbox job queue via **P-03**).
 *
 * Run with `pnpm bench`. It has its own config and its own CI step: a benchmark
 * inside the normal suite is either slow on every run or skipped on every run,
 * and the skipped kind is how these budgets came to have no measurement behind
 * them at all.
 *
 * CAVEAT, stated rather than buried. This measures the kernel and Fastify
 * server as vitest transpiles them, not as `tsc` emits them. The executed
 * JavaScript is the same code — esbuild strips types and does not rewrite logic
 * — but the two emitters are not byte-identical, so treat this as the number
 * for THIS harness. What matters for a budget gate is that the baseline and the
 * comparison are taken the same way, and they are.
 */

const ITERATIONS = Number(process.env['BENCH_ITERATIONS'] ?? 200);
const SUBMIT_WARMUP = Number(process.env['BENCH_SUBMIT_WARMUP'] ?? 5);
const SUBMIT_ITERATIONS = Number(process.env['BENCH_SUBMIT_ITERATIONS'] ?? 30);
const QUEUE_WARMUP = Number(process.env['BENCH_QUEUE_WARMUP'] ?? 5);
const QUEUE_ITERATIONS = Number(process.env['BENCH_QUEUE_ITERATIONS'] ?? 30);

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ?? 'postgresql://postgres:postgres@localhost:55432/rms';
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://app_user:app_user_dev_only@localhost:55432/rms';

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
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('SELECT id FROM app.submission LIMIT 1');
    return true;
  } catch (error) {
    if (connected) {
      throw new Error(
        `app.submission is missing from a reachable database: ${String(error)}`,
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
requireDatabase(available, 'P-01 / P-02 benchmarks', ADMIN_URL);
const maybe = available ? it : it.skip;

const BENCH_STAFF_ORG = '88888888-8888-4888-8888-b30000000001';
const BENCH_STAFF_USER = '88888888-8888-4888-8888-b30000000002';
const BENCH_CAT_APPROVED = '88888888-8888-4888-8888-b30000000003';
const BENCH_RULE_APPROVED = '88888888-8888-4888-8888-b30000000004';

const BENCH_STAFF_PRINCIPAL: Principal = {
  userId: BENCH_STAFF_USER,
  organizationId: BENCH_STAFF_ORG,
  actorType: 'staff',
  role: 'INTERNAL_SALES',
  purpose: 'full',
};

/**
 * Deterministic 5,000-submission seed across 50 client organizations (P-02).
 * Uses fixed RFC-4122 v4 UUIDs (`88888888-8888-4888-8888-b401..b406`) and
 * `ON CONFLICT (id) DO NOTHING` so repeated runs are idempotent and fast.
 */
async function seedQueueDataset(rowCount: number, orgCount = 50): Promise<void> {
  await admin(
    `INSERT INTO app.organization (id, name, is_internal)
     SELECT ('88888888-8888-4888-8888-b401' || lpad(to_hex(k), 8, '0'))::uuid,
            'P-02 Queue Org ' || lpad(k::text, 3, '0'),
            false
       FROM generate_series(1, $1::int) AS g(k)
     ON CONFLICT (id) DO NOTHING`,
    [orgCount],
  );

  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type, status)
     SELECT ('88888888-8888-4888-8888-b402' || lpad(to_hex(k), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b401' || lpad(to_hex(k), 8, '0'))::uuid,
            'p02-user-' || k::text || '@queue-bench.test',
            'P-02 Queue User ' || k::text,
            'client',
            'active'
       FROM generate_series(1, $1::int) AS g(k)
     ON CONFLICT (id) DO NOTHING`,
    [orgCount],
  );

  await admin(
    `INSERT INTO app.project (id, organization_id, number, name, status)
     SELECT ('88888888-8888-4888-8888-b403' || lpad(to_hex(k), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b401' || lpad(to_hex(k), 8, '0'))::uuid,
            'PRJ-P02-' || lpad(k::text, 3, '0'),
            'P-02 Queue Benchmark Project ' || k::text,
            'active'
       FROM generate_series(1, $1::int) AS g(k)
     ON CONFLICT (id) DO NOTHING`,
    [orgCount],
  );

  await admin(
    `INSERT INTO app.revision
       (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
        audience, catalog_release_id, rule_pack_release_id, content, content_hash,
        created_by, frozen_at)
     SELECT ('88888888-8888-4888-8888-b404' || lpad(to_hex(i), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b401' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b403' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            'P' || lpad((((i - 1) / $2::int) + 1)::text, 3, '0'),
            ((i - 1) / $2::int) + 1,
            'FROZEN',
            'client',
            $3::uuid,
            $4::uuid,
            '{"schema_version":1}'::jsonb,
            repeat(lpad(to_hex(i), 8, '0'), 8),
            ('88888888-8888-4888-8888-b402' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            '2026-01-01T00:00:00Z'::timestamptz + (i * interval '1 minute')
       FROM generate_series(1, $1::int) AS g(i)
     ON CONFLICT (id) DO NOTHING`,
    [rowCount, orgCount, BENCH_CAT_APPROVED, BENCH_RULE_APPROVED],
  );

  await admin(
    `INSERT INTO app.submission
       (id, organization_id, revision_id, audience, request_status, manifest_hash,
        prev_hash, this_hash, submitted_by, submitted_at)
     SELECT ('88888888-8888-4888-8888-b405' || lpad(to_hex(i), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b401' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b404' || lpad(to_hex(i), 8, '0'))::uuid,
            'client',
            CASE (i % 3)
              WHEN 0 THEN 'SUBMITTED'::app.request_status
              WHEN 1 THEN 'IN_PROGRESS'::app.request_status
              ELSE 'QUOTED'::app.request_status
            END,
            repeat(lpad(to_hex(i + 65536), 8, '0'), 8),
            CASE WHEN i = 1 THEN NULL ELSE repeat(lpad(to_hex(i + 131072 - 1), 8, '0'), 8) END,
            repeat(lpad(to_hex(i + 131072), 8, '0'), 8),
            ('88888888-8888-4888-8888-b402' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            '2026-01-01T00:00:00Z'::timestamptz + (i * interval '1 minute')
       FROM generate_series(1, $1::int) AS g(i)
     ON CONFLICT (id) DO NOTHING`,
    [rowCount, orgCount],
  );

  await admin(
    `INSERT INTO app.finding
       (id, organization_id, revision_id, audience, code, severity,
        subject_object_ids, closed_by, revision_hash, engine_version)
     SELECT ('88888888-8888-4888-8888-b406' || lpad(to_hex(i), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b401' || lpad(to_hex(((i - 1) % $2::int) + 1), 8, '0'))::uuid,
            ('88888888-8888-4888-8888-b404' || lpad(to_hex(i), 8, '0'))::uuid,
            'client',
            CASE WHEN (i % 2) = 0 THEN 'COLUMN_IN_AISLE' ELSE 'AISLE_CLEAR_OK' END,
            CASE WHEN (i % 2) = 0
              THEN 'ENGINEERING_REVIEW_REQUIRED'::app.finding_severity
              ELSE 'PASS'::app.finding_severity
            END,
            ARRAY['opt-a']::text[],
            'Confirm column alignment.',
            repeat(lpad(to_hex(i), 8, '0'), 8),
            '0.1.0-mvp1'
       FROM generate_series(1, $1::int) AS g(i)
     ON CONFLICT (id) DO NOTHING`,
    [rowCount, orgCount],
  );
}

const results: Measurement[] = [];
const seededRevisionIds: string[] = [];
let benchClientPrincipal: Principal;
let benchOrgId: string;

beforeAll(async () => {
  if (!available) return;

  benchOrgId = crypto.randomUUID();
  const benchUserId = crypto.randomUUID();
  const benchProjectId = crypto.randomUUID();

  benchClientPrincipal = {
    userId: benchUserId,
    organizationId: benchOrgId,
    actorType: 'client',
    role: 'CLIENT_USER',
    purpose: 'full',
  };

  await admin(
    `INSERT INTO app.organization (id, name, is_internal) VALUES
       ($1, 'Bench Staff Org', true),
       ($2, 'Bench 300-Bay Client Org', false)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_STAFF_ORG, benchOrgId],
  );

  await admin(
    `INSERT INTO app.app_user (id, organization_id, email, name, actor_type) VALUES
       ($1, $2, 'bench-staff@rackmaster.test', 'Bench Staff', 'staff'),
       ($3, $4, 'bench-client@rackmaster.test', 'Bench Client', 'client')
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_STAFF_USER, BENCH_STAFF_ORG, benchUserId, benchOrgId],
  );

  await admin(
    `INSERT INTO app.catalog_release
       (id, manufacturer, rev, status, source_document, digitised_by, digitised_at,
        approved_by, approved_at, verification_path, content_sha256)
     VALUES
       ($1, 'Interlake Mecalux', 'cat-2026.09-bench-p01', 'APPROVED', 'IM-2026.pdf', 'digitiser-1', now(),
        'approver-2', now(), 'reconciled against Kent reference BOM', $2)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_CAT_APPROVED, 'a'.repeat(64)],
  );

  await admin(
    `INSERT INTO app.rule_pack_release
       (id, name, rev, status, approved_by, approved_at, content_sha256)
     VALUES
       ($1, 'rmi-selective', 'rules-2026.09-bench-p01', 'APPROVED', 'approver-2', now(), $2)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_RULE_APPROVED, 'b'.repeat(64)],
  );

  await admin(
    `INSERT INTO app.project (id, organization_id, number, name, status)
     VALUES ($1, $2, 'PRJ-BENCH-300', '300-Bay Submission Benchmark', 'active')`,
    [benchProjectId, benchOrgId],
  );

  const totalSamples = SUBMIT_WARMUP + SUBMIT_ITERATIONS;
  const draftJson = JSON.stringify(submissionDraftContent());

  for (let i = 0; i < totalSamples; i += 1) {
    const revId = crypto.randomUUID();
    const revCode = `P${String(i + 1).padStart(2, '0')}`;
    await admin(
      `INSERT INTO app.revision
         (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
          audience, catalog_release_id, rule_pack_release_id, content, content_hash, created_by)
       VALUES ($1, $2, $3, $4, 1, 'DRAFT', 'client', $5, $6, $7::jsonb, NULL, $8)`,
      [
        revId,
        benchOrgId,
        benchProjectId,
        revCode,
        BENCH_CAT_APPROVED,
        BENCH_RULE_APPROVED,
        draftJson,
        benchUserId,
      ],
    );
    seededRevisionIds.push(revId);
  }

  configureDatabase(APP_URL);
});

afterAll(async () => {
  if (!available) return;
  await closeDatabase();
});

describe(`§5.4 performance budgets — ${FIXTURE.id}, ${FIXTURE.shape.totalBays} bays`, () => {
  it('the workload is the size the fixture claims', () => {
    // A benchmark that silently measures an empty list is worse than none.
    const full = fullDerivation();
    expect(full.preview.plan.items.length).toBeGreaterThan(0);
    expect(full.preview.elevations).toHaveLength(FIXTURE.shape.runs);
    expect(full.bomLines).toBeGreaterThan(0);
    expect(full.canonicalBytes).toBeGreaterThan(0);
    expect(FIXTURE.shape.runs * FIXTURE.shape.baysPerRun).toBe(FIXTURE.shape.totalBays);

    const draft = submissionDraftContent();
    const options = draft['options'] as ReadonlyArray<{
      readonly runs: ReadonlyArray<{ readonly bays: readonly unknown[] }>;
    }>;
    const totalDraftBays =
      options[0]?.runs.reduce((acc, r) => acc + r.bays.length, 0) ?? 0;
    expect(totalDraftBays).toBe(FIXTURE.shape.totalBays);
  });

  it('preview: parameter change → updated preview', () => {
    const m = measure('preview', preview, { iterations: ITERATIONS });
    results.push(m);
    expect(
      m.p95,
      `preview p95 ${m.p95.toFixed(2)}ms exceeds the §5.4 budget of ${FIXTURE.budgets_ms_p95['preview']}ms`,
    ).toBeLessThanOrEqual(FIXTURE.budgets_ms_p95['preview'] ?? Infinity);
  });

  it('fullDerivation: layout + validation + BOM', () => {
    const m = measure('fullDerivation', fullDerivation, { iterations: ITERATIONS });
    results.push(m);
    expect(
      m.p95,
      `fullDerivation p95 ${m.p95.toFixed(2)}ms exceeds the §5.4 budget of ${FIXTURE.budgets_ms_p95['fullDerivation']}ms`,
    ).toBeLessThanOrEqual(FIXTURE.budgets_ms_p95['fullDerivation'] ?? Infinity);
  });

  maybe(
    'submission: freeze + manifest + hash + derived persist on the 300-bay fixture over HTTP + Postgres (P-01)',
    async () => {
      const beforeRes = await admin(
        `SELECT count(*)::int AS n FROM app.submission WHERE organization_id = $1`,
        [benchOrgId],
      );
      const beforeCount = (beforeRes.rows[0]?.n as number) ?? 0;

      const wormStore = new InMemoryWormStore(() => new Date().toISOString());
      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        recordDeny: databaseDenyRecorder(),
        wormStore,
      });
      app.addHook('onRequest', async (request) => {
        request.principal = benchClientPrincipal;
      });

      try {
        const m = await measureAsync(
          'submission',
          async (idx) => {
            const revisionId = seededRevisionIds[idx]!;
            const res = await app.inject({
              method: 'POST',
              url: `/api/client/v1/revisions/${revisionId}/submit`,
              headers: {
                'idempotency-key': `bench-300-bay-submit-${String(idx)}`,
              },
              payload: {
                assumptions_acknowledged: true,
                disclaimer_version_id: 'disclaimer-v2026.07',
              },
            });
            if (res.statusCode !== 201) {
              throw new Error(
                `P-01 benchmark submit failed with status ${String(res.statusCode)}: ${res.body}`,
              );
            }
          },
          { warmup: SUBMIT_WARMUP, iterations: SUBMIT_ITERATIONS },
        );

        results.push(m);

        const afterRes = await admin(
          `SELECT count(*)::int AS n FROM app.submission WHERE organization_id = $1`,
          [benchOrgId],
        );
        const afterCount = (afterRes.rows[0]?.n as number) ?? 0;
        expect(afterCount - beforeCount).toBe(SUBMIT_WARMUP + SUBMIT_ITERATIONS);

        expect(
          m.p95,
          `submission p95 ${m.p95.toFixed(2)}ms exceeds the §5.4 budget of ${FIXTURE.budgets_ms_p95['submission']}ms`,
        ).toBeLessThanOrEqual(FIXTURE.budgets_ms_p95['submission'] ?? Infinity);
      } finally {
        await app.close();
      }
    },
  );

  maybe(
    'queueLoad: internal queue at 5,000 submissions across >=50 organizations with RLS ON and constant O(1) statement count (P-02)',
    async () => {
      async function countQueueRenderStatements(): Promise<{
        statements: number;
        totalItems: number;
        pageCount: number;
      }> {
        return withTenant(
          { organizationId: BENCH_STAFF_ORG, actorType: 'staff' },
          async (tx) => {
            let statements = 0;
            const countingTx: TenantTransaction = {
              query: async (text, values) => {
                statements += 1;
                return tx.query(text, values);
              },
            };
            const page = await queryInternalQueuePage(countingTx, { page: 1, pageSize: 25 });
            return {
              statements,
              totalItems: page.pagination.totalItems,
              pageCount: page.data.length,
            };
          },
        );
      }

      // 1. Seed 10 rows first and measure SQL statement count before scaling to 5,000.
      await seedQueueDataset(10, 10);
      const smallSample = await countQueueRenderStatements();
      expect(smallSample.statements).toBe(2);

      // 2. Seed deterministic 5,000 submissions across 50 organizations and update planner stats.
      await seedQueueDataset(5000, 50);
      await admin(
        `ANALYZE app.organization, app.project, app.revision, app.submission, app.finding`,
      );

      const seededSummary = await admin(
        `SELECT count(*)::int AS total_submissions,
                count(DISTINCT organization_id)::int AS distinct_orgs
           FROM app.submission
          WHERE audience = 'client'`,
      );
      const totalSubmissions = (seededSummary.rows[0]?.total_submissions as number) ?? 0;
      const distinctOrgs = (seededSummary.rows[0]?.distinct_orgs as number) ?? 0;
      expect(totalSubmissions).toBeGreaterThanOrEqual(5000);
      expect(distinctOrgs).toBeGreaterThanOrEqual(50);

      // 3. Statement count at 5,000+ rows is identical (2 statements — zero N+1).
      const largeSample = await countQueueRenderStatements();
      expect(largeSample.statements).toBe(smallSample.statements);
      expect(largeSample.statements).toBe(2);
      expect(largeSample.pageCount).toBe(25);
      expect(largeSample.totalItems).toBeGreaterThanOrEqual(5000);

      // 4. Verify RLS is ON under withTenant and capture EXPLAIN (ANALYZE, BUFFERS) at 5,000 rows.
      const explainLines = await withTenant(
        { organizationId: BENCH_STAFF_ORG, actorType: 'staff' },
        async (tx) => {
          const rlsRes = await tx.query<{ row_security: string }>(`SHOW row_security`);
          expect(rlsRes.rows[0]?.row_security).toBe('on');
          const actorRes = await tx.query<{ actor_type: string }>(
            `SELECT current_setting('app.actor_type', true) AS actor_type`,
          );
          expect(actorRes.rows[0]?.actor_type).toBe('staff');

          const explainRes = await tx.query<{ 'QUERY PLAN': string }>(
            `EXPLAIN (ANALYZE, BUFFERS)
             WITH page_sub AS (
               SELECT s.id AS submission_id,
                      s.organization_id,
                      s.revision_id,
                      s.request_status::text AS status,
                      s.submitted_at,
                      s.acknowledged_at,
                      s.quoted_at
                 FROM app.submission s
                WHERE s.audience = 'client'
                ORDER BY s.submitted_at DESC, s.id ASC
                LIMIT $1 OFFSET $2
             ),
             finding_counts AS (
               SELECT f.organization_id,
                      f.revision_id,
                      count(*) FILTER (WHERE f.severity = 'BLOCKER')::int AS blocker_count,
                      count(*) FILTER (WHERE f.severity = 'ENGINEERING_REVIEW_REQUIRED')::int AS review_count
                 FROM app.finding f
                 JOIN page_sub ps
                   ON ps.organization_id = f.organization_id
                  AND ps.revision_id = f.revision_id
                GROUP BY f.organization_id, f.revision_id
             )
             SELECT ps.submission_id,
                    ps.organization_id,
                    o.name AS organization_name,
                    p.number AS project_number,
                    ps.status,
                    ps.submitted_at,
                    ps.acknowledged_at,
                    ps.quoted_at,
                    COALESCE(fc.blocker_count, 0) AS blocker_count,
                    COALESCE(fc.review_count, 0) AS review_count
               FROM page_sub ps
               JOIN app.organization o
                 ON o.id = ps.organization_id
               JOIN app.revision r
                 ON r.id = ps.revision_id
                AND r.organization_id = ps.organization_id
               JOIN app.project p
                 ON p.id = r.project_id
                AND p.organization_id = ps.organization_id
               LEFT JOIN finding_counts fc
                 ON fc.organization_id = ps.organization_id
                AND fc.revision_id = ps.revision_id
              ORDER BY ps.submitted_at DESC, ps.submission_id ASC`,
            [25, 0],
          );
          return explainRes.rows.map((r) => r['QUERY PLAN']);
        },
      );

      const explainPlanText = explainLines.join('\n');
      console.log(`\n  [P-02 EXPLAIN (ANALYZE, BUFFERS) at ${String(totalSubmissions)} rows across ${String(distinctOrgs)} orgs]\n${explainPlanText}\n`);
      expect(explainPlanText).toContain('organization_pkey');
      expect(explainPlanText).toMatch(/revision_pkey|revision_id_audience_key/);
      expect(explainPlanText).toContain('finding_org_revision_idx');

      // 5. Measure GET /api/internal/v1/queue?page=1&pageSize=25 over HTTP + Postgres with RLS ON.
      const app = createApp({
        env: { CLAIM_LEASE_MINUTES: '10' },
        recordDeny: databaseDenyRecorder(),
      });
      app.addHook('onRequest', async (request) => {
        request.principal = BENCH_STAFF_PRINCIPAL;
      });

      try {
        const m = await measureAsync(
          'queueLoad',
          async () => {
            const res = await app.inject({
              method: 'GET',
              url: '/api/internal/v1/queue?page=1&pageSize=25',
            });
            if (res.statusCode !== 200) {
              throw new Error(
                `P-02 benchmark queueLoad failed with status ${String(res.statusCode)}: ${res.body}`,
              );
            }
            const body = res.json() as {
              data: unknown[];
              pagination: { totalItems: number };
            };
            if (body.data.length !== 25 || body.pagination.totalItems < 5000) {
              throw new Error(
                `P-02 unexpected queue page shape: length=${String(body.data.length)}, totalItems=${String(body.pagination.totalItems)}`,
              );
            }
          },
          { warmup: QUEUE_WARMUP, iterations: QUEUE_ITERATIONS },
        );

        results.push(m);

        expect(
          m.p95,
          `queueLoad p95 ${m.p95.toFixed(2)}ms exceeds the §5.4 budget of ${FIXTURE.budgets_ms_p95['queueLoad']}ms`,
        ).toBeLessThanOrEqual(FIXTURE.budgets_ms_p95['queueLoad'] ?? Infinity);
      } finally {
        await app.close();
      }
    },
  );

  maybe(
    'pdfGeneration: preliminary multi-page PDF generation on the 300-bay fixture via the outbox job queue (P-03)',
    async () => {
      const wormStore = new InMemoryWormStore(() => new Date().toISOString());

      // 1. Drain the 5 warm-up pdf.generate jobs enqueued by P-01 and verify that
      //    < 20 jobs skips LOUDLY rather than silently passing.
      const warmupMetrics: PdfJobSample[] = [];
      const warmupBatch = await processPdfOutboxBatch({
        organizationId: benchOrgId,
        now: () => new Date(),
        wormStore,
        metrics: warmupMetrics,
        limit: SUBMIT_WARMUP,
      });
      expect(warmupBatch.claimed).toBe(SUBMIT_WARMUP);
      expect(warmupMetrics).toHaveLength(SUBMIT_WARMUP);

      const loudWarnings: string[] = [];
      const skipVerdict = assertPdfJobBudget(warmupMetrics, {
        budgetP95Ms: FIXTURE.budgets_ms_p95['pdfGeneration'] ?? 6000,
        onSkip: (msg) => {
          loudWarnings.push(msg);
          console.log(`  ${msg}`);
        },
      });
      expect(skipVerdict.status).toBe('skipped_loudly');
      expect(loudWarnings).toHaveLength(1);
      expect(loudWarnings[0]).toContain('[P-03 SKIPPED LOUDLY]');

      // 2. Drain the remaining 30 (>= 20) pdf.generate jobs for the 300-bay unit
      //    and assert the p95 budget (6,000 ms) over the recorded set.
      const measuredMetrics: PdfJobSample[] = [];
      const measuredBatch = await processPdfOutboxBatch({
        organizationId: benchOrgId,
        now: () => new Date(),
        wormStore,
        metrics: measuredMetrics,
        limit: SUBMIT_ITERATIONS,
      });
      expect(measuredBatch.claimed).toBe(SUBMIT_ITERATIONS);
      expect(measuredBatch.failed).toHaveLength(0);
      expect(measuredMetrics).toHaveLength(SUBMIT_ITERATIONS);
      expect(measuredMetrics.length).toBeGreaterThanOrEqual(20);

      // Every job rendered the full 300-bay unit across 9 pages (1 cover/plan + 8 schedule pages),
      // never a one-page toy fixture.
      for (const sample of measuredMetrics) {
        expect(sample.bayCount).toBe(FIXTURE.shape.totalBays);
        expect(sample.pageCount).toBe(9);
      }

      const verdict = assertPdfJobBudget(measuredMetrics, {
        budgetP95Ms: FIXTURE.budgets_ms_p95['pdfGeneration'] ?? 6000,
        ratchetP50Ms: FIXTURE.ratchet_ms_p50['pdfGeneration'],
      });
      expect(verdict.status).toBe('asserted');
      if (verdict.status === 'asserted') {
        results.push({
          name: 'pdfGeneration',
          iterations: verdict.summary.count,
          min: verdict.summary.min,
          p50: verdict.summary.p50,
          p95: verdict.summary.p95,
          p99: verdict.summary.p99,
          max: verdict.summary.max,
          mean: verdict.summary.mean,
        });
      }
    },
  );

  it('holds the ratchet — a regression fails even with 100x of budget headroom', () => {
    // The §5.4 gates are met by roughly two orders of magnitude, so on their own
    // they catch a catastrophe and nothing smaller. The ratchet is what makes
    // this a regression test: same idea as the coverage floors, set just above
    // the measured value so an improvement is free and a slide is loud.
    for (const m of results) {
      const limit = FIXTURE.ratchet_ms_p50[m.name];
      expect(limit, `no ratchet recorded for '${m.name}'`).toBeDefined();
      expect(
        m.p50,
        `${m.name} p50 ${m.p50.toFixed(2)}ms is above the ${String(limit)}ms ratchet. Either ` +
          'something got slower, or the ratchet needs re-deriving on this hardware — decide ' +
          'which, and record it in PERF.md.',
      ).toBeLessThanOrEqual(limit ?? Infinity);
    }
  });

  it('reports the distribution, not just the p95', () => {
    // A p95 quoted without its spread is a number nobody can tell a regression
    // from. Printed so a CI log carries the whole shape.
    console.log(
      `\n  ${process.version} on ${process.platform}/${process.arch}, ` +
        `${ITERATIONS} kernel iterations, ${SUBMIT_ITERATIONS} submission iterations, ` +
        `${QUEUE_ITERATIONS} queueLoad iterations, ${SUBMIT_ITERATIONS} pdfGeneration jobs\n` +
        formatTable(results, FIXTURE.budgets_ms_p95),
    );
    for (const m of results) {
      expect(m.max).toBeGreaterThanOrEqual(m.p99);
      expect(m.p99).toBeGreaterThanOrEqual(m.p95);
      expect(m.p95).toBeGreaterThanOrEqual(m.p50);
    }
  });
});


