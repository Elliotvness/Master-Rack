/**
 * Timing and distribution, separated from the thing being timed.
 *
 * Kept apart so a change to the workload cannot quietly change how it is
 * measured, and so the statistics can be read on their own.
 */

export interface Measurement {
  readonly name: string;
  readonly iterations: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

export interface MeasureOptions {
  readonly iterations?: number;
  readonly warmup?: number;
}

/**
 * Time `fn` and report its distribution in milliseconds.
 *
 * Warm-up iterations are discarded: the first passes through a JIT-compiled
 * path measure compilation, not the path. A FIXED iteration count is used
 * rather than a fixed wall-clock budget, so two runs on different machines
 * compare like with like.
 *
 * p95 is reported with p50, p99 and max beside it, because a p95 quoted alone
 * is a number nobody can tell a regression from — the spread is what says
 * whether a 10% move is a change or a different sample.
 */
export function measure(name: string, fn: () => unknown, options: MeasureOptions = {}): Measurement {
  const iterations = options.iterations ?? 200;
  const warmup = options.warmup ?? 30;

  for (let i = 0; i < warmup; i += 1) fn();

  const samples: number[] = new Array<number>(iterations);
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    fn();
    samples[i] = performance.now() - t0;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

  return {
    name,
    iterations,
    min: sorted[0] ?? 0,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

/** A fixed-width table, so two runs can be diffed by eye. */
export function formatTable(
  results: readonly Measurement[],
  budgets: Readonly<Record<string, number | undefined>>,
): string {
  const rows = ['  path              p50      p95      p99      max    budget(p95)'];
  for (const r of results) {
    const b = budgets[r.name];
    const verdict = b === undefined ? '' : r.p95 <= b ? '  PASS' : '  OVER';
    rows.push(
      `  ${r.name.padEnd(16)}${r.p50.toFixed(2).padStart(6)}ms${r.p95.toFixed(2).padStart(7)}ms` +
        `${r.p99.toFixed(2).padStart(7)}ms${r.max.toFixed(2).padStart(7)}ms` +
        `${String(b ?? '—').padStart(9)}ms${verdict}`,
    );
  }
  return rows.join('\n');
}
