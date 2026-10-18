# Performance — budgets, baseline, and the ledger of what was tried

Blueprint §5.4 sets five budgets and states, for each, how it is measured. Until 2026-09-01 **none
of the five was measured by anything**: there was no benchmark harness in the repository and no
fixture for the one the budget names. The only figures the blueprint quotes come from rack-studio
spikes measured under software rasterization in a cloud container, and it correctly calls them
"a floor rather than a measurement".

This file is the record. **Read it before proposing a performance experiment** — a discarded idea
that leaves no trace gets re-run next quarter.

## The five budgets, and which are measured

| # | Budget | §5.4 target | Measured how (§5.4) | Status |
|---|---|---|---|---|
| 1 | Parameter change → updated preview | p95 **120 ms** on a 300-bay unit | Synthetic benchmark in CI on a fixed fixture | ✅ **measured** |
| 2 | Full derivation (layout + validation + BOM) | p95 **400 ms** server-side | Same fixture, server path | ✅ **measured** |
| 3 | Submission (freeze + manifest + hash + BOM persist) | p95 **2 s** | End-to-end test (`P-01`) | ✅ **measured** |
| 4 | Internal queue load | p95 **800 ms** at 5,000 submissions | Seeded load test (`P-02`) | ✅ **measured** |
| 5 | Preliminary PDF generation | p95 **6 s**, async with progress | Job queue metric (`P-03`) | ✅ **measured** |

## The four front-end budgets — agreed 2026-09-04, before the first screen exists (P-05)

All five budgets above are server- or kernel-side. **The 120 ms preview budget covers the
computation; nothing above covers the paint** — in a product whose premise is a client self-service
web app where the preview interaction *is* the product. P-05's argument, and the reason these are
agreed now rather than later: *a bundle ceiling agreed after the bundle exists is a ceiling nobody
meets.* Amended into blueprint §5.4 on 2026-09-04.

| # | Front-end budget | §5.4 target | Measured how | Status |
|---|---|---|---|---|
| 6 | **INP** — Interaction to Next Paint | **200 ms** | Lighthouse or equivalent in CI against the built SPA | ⛔ needs T-16 (no screen yet) |
| 7 | LCP — Largest Contentful Paint | **2.5 s** | Same run | ⛔ needs T-16 |
| 8 | CLS — Cumulative Layout Shift | **0.1** | Same run | ⛔ needs T-16 |
| 9 | Initial JavaScript, gzipped | **200 KB** | Asserted in CI on every build; the number recorded here | ✅ **measured (84 KB gz vs 200 KB ceiling)** |

**INP is the one that matters** and §5.4 says so: a rack configurator is an interaction loop, not a
page view. LCP and CLS are ordinary hygiene; INP is the product.

**Route-level code splitting, decided before there are routes to split.** Each of the eight §15.2
steps is a lazily-loaded route chunk. The 200 KB ceiling applies to the **initial** bundle — the
shell plus the first route — not to the sum of all chunks. The renderers (`render-svg`,
`render-canvas`, T-17) and the kernel packages they consume load with the preview step that needs
them, never in the shell. The client and internal applications are budgeted separately; **the
client bundle is the one this ceiling exists for.**

### What is gated and measured for P-05 (Row 9 ✅), and what awaits T-16 for rows 6–8

`check-front-end-budgets` runs self-test-first in `verify` and in `ci.yml`. What it proves
is that one ceiling is stated in three places and they agree: blueprint §5.4, the checker's own
`BUDGETS`, and this file. A budget loosened in the blueprint without the checker following, a budget
deleted, a budget added that nothing enforces, this file dropping the number, or §5.4 reworded so
the parser matches nothing — each is red, and each is planted in `selftest-front-end-budgets`.

**What is proven for P-05: the bundle arm is now live and measured.** `apps/studio-web` builds via
Vite (`pnpm build:web`) in `verify` and CI before `check-front-end-budgets` executes. The checker
discovers `apps/studio-web/dist/index.html`, identifies the initial script references (shell + initial
route payload, excluding lazily-loaded route chunks), and measures **84 KB gzipped** JavaScript
against the **200 KB** ceiling (~2.38× headroom).

**What awaits T-16:** rows 6–8 (INP, LCP, CLS) require active browser rendering and user interaction
to measure via Lighthouse or equivalent in CI once screens and interaction flows are established.

## Baseline — 2026-09-01 (kernel), 2026-10-17 (P-01 submission, P-02 queue at 5,000), & 2026-10-18 (P-03 async PDF generation)

`pnpm bench` · `fixtures/perf/unit-300-bay.json` · 300 bays, 12 runs × 25 bays, 4 beam levels ·
200 kernel iterations after 30 warm-up (`preview`, `fullDerivation`), 30 end-to-end HTTP + PostgreSQL
iterations after 5 warm-up (`submission`, `POST /api/client/v1/revisions/:id/submit`), 30
end-to-end HTTP + PostgreSQL iterations after 5 warm-up (`queueLoad`,
`GET /api/internal/v1/queue?page=1&pageSize=25` against ≥5,000 submissions across ≥50 organizations
with RLS ON), and 30 outbox job-queue dispatches after 5 warm-up (`pdfGeneration`,
`processPdfOutboxBatch` rendering the 9-page PDF-1.4 summary across all 300 bays of
`unit-300-bay.json`, writing to WORM storage, and marking each `pdf.generate` outbox job
`dispatched`).

| path | p50 | p95 | p99 | budget (p95) | headroom |
|---|---|---|---|---|---|
| `preview` | **0.37 – 0.66 ms** | 0.66 – 2.42 ms | 1.04 – 3.9 ms | 120 ms | ~**100×** |
| `fullDerivation` | **0.39 – 0.66 ms** | 0.82 – 1.54 ms | 1.27 – 2.3 ms | 400 ms | ~**300×** |
| `submission` (`P-01`) | **19.36 – 33.61 ms** | **26.65 – 46.22 ms** | **28.15 – 47.08 ms** | 2,000 ms | ~**43–75×** |
| `queueLoad` (`P-02`) | **25.83 – 33.44 ms** | **32.06 – 38.92 ms** | **32.17 – 40.28 ms** | 800 ms | ~**20–25×** |
| `pdfGeneration` (`P-03`) | **5.61 ms** | **8.45 ms** | **9.60 ms** | 6,000 ms | ~**710×** |

Ranges are across five runs for the kernel paths, plus the live PostgreSQL 18.4 end-to-end runs for
`submission`, `queueLoad`, and `pdfGeneration` (`v24.19.0` on `win32/x64`). **The headline: the
derivation kernel, the single-revision atomic submission transaction, the 5,000-row paginated queue
render, and the 300-bay multi-page outbox PDF generation job are all well within budget.** All five
server/kernel budgets in §5.4 are now measured and met by more than an order of magnitude.

### P-02 — `EXPLAIN (ANALYZE, BUFFERS)` for the queue query at 5,000+ rows with RLS ON

Captured inside `withTenant({ organizationId: BENCH_STAFF_ORG, actorType: 'staff' })` with
`SHOW row_security = 'on'` and `current_setting('app.actor_type') = 'staff'` over **5,377** client
submissions across **83** organizations (`LIMIT 25 OFFSET 0`):

```text
Nested Loop Left Join  (cost=595.38..609.52 rows=1 width=126) (actual time=9.041..9.572 rows=25.00 loops=1)
  Join Filter: ((f.organization_id = ps.organization_id) AND (f.revision_id = ps.revision_id))
  Rows Removed by Join Filter: 300
  Buffers: shared hit=442
  CTE page_sub
    ->  Limit  (cost=410.01..410.07 rows=25 width=104) (actual time=8.666..8.669 rows=25.00 loops=1)
          Buffers: shared hit=221
          ->  Sort  (cost=410.01..410.08 rows=28 width=104) (actual time=8.665..8.667 rows=25.00 loops=1)
                Sort Key: s.submitted_at DESC, s.id
                Sort Method: top-N heapsort  Memory: 29kB
                Buffers: shared hit=221
                ->  Seq Scan on submission s  (cost=0.00..409.33 rows=28 width=104) (actual time=0.033..7.792 rows=5377.00 loops=1)
                      Filter: ((((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid) AND (audience = 'client'::app.audience)) OR (NULLIF(current_setting('app.actor_type'::text, true), ''::text) = 'staff'::text)) AND (audience = 'client'::app.audience))
                      Buffers: shared hit=221
  ->  Nested Loop  (cost=0.43..14.51 rows=1 width=134) (actual time=8.897..9.287 rows=25.00 loops=1)
        Join Filter: (o.id = ps.organization_id)
        Buffers: shared hit=348
        ->  Nested Loop  (cost=0.28..13.74 rows=1 width=146) (actual time=8.884..9.212 rows=25.00 loops=1)
              Join Filter: (p.id = r.project_id)
              Buffers: shared hit=298
              ->  Nested Loop  (cost=0.00..6.52 rows=1 width=146) (actual time=8.851..9.093 rows=25.00 loops=1)
                    Join Filter: (p.organization_id = ps.organization_id)
                    Rows Removed by Join Filter: 2700
                    Buffers: shared hit=223
                    ->  CTE Scan on page_sub ps  (cost=0.00..0.50 rows=25 width=104) (actual time=8.669..8.673 rows=25.00 loops=1)
                          Storage: Memory  Maximum Storage: 19kB
                          Buffers: shared hit=221
                    ->  Materialize  (cost=0.00..5.28 rows=2 width=42) (actual time=0.001..0.010 rows=109.00 loops=25)
                          Storage: Memory  Maximum Storage: 24kB
                          Buffers: shared hit=2
                          ->  Seq Scan on project p  (cost=0.00..5.27 rows=2 width=42) (actual time=0.019..0.142 rows=109.00 loops=1)
                                Filter: ((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.actor_type'::text, true), ''::text) = 'staff'::text))
                                Buffers: shared hit=2
              ->  Index Scan using revision_pkey on revision r  (cost=0.28..7.21 rows=1 width=48) (actual time=0.004..0.004 rows=1.00 loops=25)
                    Index Cond: (id = ps.revision_id)
                    Filter: ((ps.organization_id = organization_id) AND (((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid) AND (audience = 'client'::app.audience)) OR (NULLIF(current_setting('app.actor_type'::text, true), ''::text) = 'staff'::text)))
                    Index Searches: 25
                    Buffers: shared hit=75
        ->  Index Scan using organization_pkey on organization o  (cost=0.14..0.75 rows=1 width=36) (actual time=0.003..0.003 rows=1.00 loops=25)
              Index Cond: (id = r.organization_id)
              Filter: ((id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid) OR (NULLIF(current_setting('app.actor_type'::text, true), ''::text) = 'staff'::text))
              Index Searches: 25
              Buffers: shared hit=50
  ->  GroupAggregate  (cost=184.88..184.92 rows=1 width=40) (actual time=0.006..0.010 rows=13.00 loops=25)
        Group Key: f.organization_id, f.revision_id
        Buffers: shared hit=94
        ->  Sort  (cost=184.88..184.89 rows=1 width=36) (actual time=0.005..0.006 rows=13.96 loops=25)
              Sort Key: f.organization_id, f.revision_id
              Sort Method: quicksort  Memory: 26kB
              Buffers: shared hit=94
              ->  Nested Loop  (cost=0.28..184.88 rows=1 width=36) (actual time=0.022..0.111 rows=25.00 loops=1)
                    Buffers: shared hit=94
                    ->  CTE Scan on page_sub ps_1  (cost=0.00..0.50 rows=25 width=32) (actual time=0.000..0.009 rows=25.00 loops=1)
                          Storage: Memory  Maximum Storage: 19kB
                    ->  Index Scan using finding_org_revision_idx on finding f  (cost=0.28..7.36 rows=1 width=36) (actual time=0.003..0.004 rows=1.00 loops=25)
                          Index Cond: ((organization_id = ps_1.organization_id) AND (revision_id = ps_1.revision_id))
                          Filter: (((organization_id = (NULLIF(current_setting('app.organization_id'::text, true), ''::text))::uuid) AND (audience = 'client'::app.audience)) OR (NULLIF(current_setting('app.actor_type'::text, true), ''::text) = 'staff'::text))
                          Index Searches: 25
                          Buffers: shared hit=94
Planning:
  Buffers: shared hit=50
Planning Time: 1.750 ms
Execution Time: 9.692 ms
```

**Chosen indexes named (and why no speculative index was added):**
1. **`finding_org_revision_idx`** on `app.finding (organization_id, revision_id)`: because `page_sub` bounds the page to 25 submissions first (`LIMIT $1 OFFSET $2`), `finding_counts` executes exactly 25 bounded index searches (`0.004 ms` per lookup, 94 buffer hits total) instead of scanning or grouping the entire `app.finding` table.
2. **`revision_pkey`** on `app.revision (id)`: 25 bounded index lookups (`0.004 ms` each, 75 buffer hits) to resolve `project_id` for the 25 page rows.
3. **`organization_pkey`** on `app.organization (id)`: 25 bounded index lookups (`0.003 ms` each, 50 buffer hits) to resolve `organization_name`.
4. **Why no extra index was added on `app.submission` or `app.project`:** `app.submission` at 5,377 rows occupies 221 shared pages and sorts via a 29 kB `top-N heapsort` in `8.67 ms` (with RLS filter evaluated inline), and `app.project` occupies 2 shared pages (`24 kB` materialized once in `0.14 ms`), giving a total SQL execution time of **`9.69 ms`** and full HTTP round-trip `p95` of **`32.06 ms`** against the **`800 ms`** budget (~25× headroom). Per P-02: *"An index added without the plan that justifies it is a guess."*

### What that changes

1. **Do not optimise the kernel, single-submission path, 5,000-row queue query, or preliminary PDF
   generation worker.** There is no evidence of a problem, and the skill's first rule applies:
   optimisation without measurement is guessing, and here the measurement says stop.
2. **All five server/kernel budgets in §5.4 now have a live CI benchmark runner** (`preview`,
   `fullDerivation`, `submission` (`P-01`), `queueLoad` (`P-02`), and `pdfGeneration` (`P-03`)).
3. **The §5.4 gates alone cannot catch a regression.** At 20×–710× headroom they fire only on a
   catastrophe. Hence the ratchet below (`2.5 ms` p50 for `preview` and `fullDerivation`; `60 ms`
   p50 for `submission`, `queueLoad`, and `pdfGeneration`).

### Why the ratchet keys on p50, not p95

Across five runs the **p95 varied by 2.3×** (1.04 → 2.42 ms) while the **p50 varied by 1.3×**
(0.49 → 0.66 ms). At sub-millisecond scale the p95 is dominated by scheduler and GC noise rather
than by the work. A p95 ratchet tight enough to catch a real regression would flap on noise; one
loose enough not to flap would catch nothing. So the ratchet is on the median, at **2.5 ms** for the
kernel paths and **60 ms** for the PostgreSQL-backed `submission`, `queueLoad`, and `pdfGeneration`
paths, in the same spirit as the coverage floors in `vitest.config.ts`: just above the measured
value, so an improvement is free and a slide is loud.

Raise a ratchet when the measured value drops. **Never raise one to make a build pass** — if it
fires, decide whether something got slower or the hardware changed, and record which, here.

### Caveat, stated rather than buried

The harness measures the kernel as **vitest transpiles it**, not as `tsc` emits it. The executed
JavaScript is the same code — esbuild strips types and does not rewrite logic — but the two
emitters are not byte-identical. What a gate needs is that the baseline and the comparison are
taken the same way, and they are. A `dist`-based harness was tried first and abandoned; see the
ledger.

## Ledger

Every attempt, kept and reverted alike.

| Date | Idea | Baseline → Result | Verdict | Why |
|---|---|---|---|---|
| 2026-09-01 | Run the harness against the compiled `dist/` via plain node | — | **abandoned** | The workspace symlinks resolve `@rms/*` through each package's `main`, which points at `src/index.ts`. A compiled `dist/index.js` therefore pulls its dependencies in as TypeScript source and will not load. Changing `main` to `dist` to suit a benchmark would change how every consumer resolves the packages — a large change to serve a small one. Moved to a vitest config that already has the alias table. |
| 2026-09-01 | Ratchet on p95 | p95 spread 1.04–2.42 ms | **rejected** | The run-to-run spread (2.3×) is larger than any regression the gate could usefully catch. Moved to p50. |
| 2026-09-01 | Run `pnpm bench` as a CI gate on a GitHub runner, with a ratchet derived on the desktop VM | p50 ratchet 2.5 ms, measured 0.49–0.88 ms locally | **kept** | The runner met it — CI green, `verify` 1m11s including the bench step. So the 4× margin absorbs the hardware difference. If it ever fires on CI alone, that is the runner, not a regression: record the runner's number here and set a runner-specific ratchet rather than loosening this one. |
| 2026-09-01 | Establish the first baseline at all | none existed → see above | **kept** | Two of five budgets now have a number. Three still do not, and are not claimed. |
| 2026-10-17 | Measure §5.4 budget 3 (`submission`) end-to-end against live PostgreSQL in the same commit as `POST /api/client/v1/revisions/:id/submit` (`P-01`) | unmeasured → p50 **19.36 ms**, p95 **26.65 ms**, p99 **28.15 ms** (30 iterations after 5 warm-up on the 300-bay fixture) | **kept** | Pre-seeds 35 `DRAFT` 300-bay revisions outside the timed loop so each sample times the full HTTP + idempotency + `submitRevision` transaction + WORM manifest write + audit hash-chain append. Meets the 2,000 ms p95 budget by ~75×; p50 ratchet set at 60 ms. |
| 2026-10-17 | Measure §5.4 budget 4 (`queueLoad`) at 5,000+ submissions across ≥50 organizations with RLS ON in the same commit as `GET /api/internal/v1/queue` (`P-02`) | unmeasured → p50 **25.83 ms**, p95 **32.06 ms**, p99 **32.17 ms** (30 iterations after 5 warm-up; SQL `EXPLAIN (ANALYZE, BUFFERS)` **9.69 ms**, 442 shared buffer hits) | **kept** | Bounds the page to `LIMIT 25 OFFSET 0` in the `page_sub` CTE first and joins `app.finding` via `finding_org_revision_idx`, `app.revision` via `revision_pkey`, and `app.organization` via `organization_pkey`. Constant 2 SQL statements at 10 rows and at 5,000+ rows (zero N+1). Meets the 800 ms p95 budget by ~25×; p50 ratchet set at 60 ms. |
| 2026-10-18 | Measure §5.4 budget 5 (`pdfGeneration`) via the outbox job queue (`topic = 'pdf.generate'`) on the 300-bay fixture (`P-03`) | unmeasured → p50 **5.61 ms**, p95 **8.45 ms**, p99 **9.60 ms** (30 job dispatches after 5 warm-up, each rendering a 9-page PDF-1.4 document across 300 bays + WORM COMPLIANCE write + `markDispatched`) | **kept** | Generation runs strictly as an outbox job via `claimTopicBatch('pdf.generate')` + `processPdfOutboxBatch`, never in the HTTP request path. `GET /api/client/v1/documents/:id` surfaces `PENDING`, `PRELIMINARY`, and `FAILED` job states. Per-job `durationMs` is summarized across the set (`summarizePdfJobMetrics`), loud-skips below 20 jobs (`assertPdfJobBudget`), and meets the 6,000 ms p95 budget by ~710× at 30 jobs; p50 ratchet set at 60 ms. |
| 2026-10-18 | Measure §5.4 budget 9 (Initial JavaScript, gzipped) against real SPA build in `apps/studio-web/dist` (`P-05`) | unmeasured → **84 KB gz** initial JS payload (`index.html` references) vs 200 KB ceiling (~2.38× headroom) | **kept** | Built via Vite in `pnpm build:web` before `check-front-end-budgets` runs in `verify` and CI. Enforces code-splitting so renderers and routes do not bloat initial shell payload. |

## Running it

```bash
pnpm bench                          # 200 kernel + 30 submission + 30 queueLoad + 30 pdfGeneration iterations, asserts budgets and ratchets
BENCH_ITERATIONS=1000 pnpm bench    # tighter distribution, slower
```

It has its own config (`vitest.bench.config.ts`) and its own CI step, deliberately. A benchmark
inside the normal suite is either slow on every run or skipped on every run — and the skipped kind
is exactly how §5.4's budgets came to have no measurement behind them for the life of the project.
