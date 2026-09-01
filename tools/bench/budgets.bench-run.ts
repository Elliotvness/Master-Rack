import { describe, expect, it } from 'vitest';

import { formatTable, measure, type Measurement } from './measure.js';
import { FIXTURE, fullDerivation, preview } from './workload.js';

/**
 * The two §5.4 budgets that are measurable before the server exists.
 *
 * Run with `pnpm bench`. It has its own config and its own CI step: a benchmark
 * inside the normal suite is either slow on every run or skipped on every run,
 * and the skipped kind is how these budgets came to have no measurement behind
 * them at all.
 *
 * CAVEAT, stated rather than buried. This measures the kernel as vitest
 * transpiles it, not as `tsc` emits it. The executed JavaScript is the same
 * code — esbuild strips types and does not rewrite logic — but the two emitters
 * are not byte-identical, so treat this as the number for THIS harness. What
 * matters for a budget gate is that the baseline and the comparison are taken
 * the same way, and they are.
 */

const ITERATIONS = Number(process.env['BENCH_ITERATIONS'] ?? 200);
const results: Measurement[] = [];

describe(`§5.4 performance budgets — ${FIXTURE.id}, ${FIXTURE.shape.totalBays} bays`, () => {
  it('the workload is the size the fixture claims', () => {
    // A benchmark that silently measures an empty list is worse than none.
    const full = fullDerivation();
    expect(full.preview.plan.items.length).toBeGreaterThan(0);
    expect(full.preview.elevations).toHaveLength(FIXTURE.shape.runs);
    expect(full.bomLines).toBeGreaterThan(0);
    expect(full.canonicalBytes).toBeGreaterThan(0);
    expect(FIXTURE.shape.runs * FIXTURE.shape.baysPerRun).toBe(FIXTURE.shape.totalBays);
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
        `${ITERATIONS} iterations\n` +
        formatTable(results, FIXTURE.budgets_ms_p95),
    );
    for (const m of results) {
      expect(m.max).toBeGreaterThanOrEqual(m.p99);
      expect(m.p99).toBeGreaterThanOrEqual(m.p95);
      expect(m.p95).toBeGreaterThanOrEqual(m.p50);
    }
  });
});
