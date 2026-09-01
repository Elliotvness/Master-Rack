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
| 2 | Full derivation (layout + validation + BOM) | p95 **400 ms** server-side | Same fixture, server path | ✅ **measured** (kernel path; no server yet) |
| 3 | Submission (freeze + manifest + hash + BOM persist) | p95 **2 s** | End-to-end test | ⛔ needs T-14 |
| 4 | Internal queue load | p95 **800 ms** at 5,000 submissions | Seeded load test | ⛔ needs T-14 |
| 5 | Preliminary PDF generation | p95 **6 s**, async with progress | Job queue metric | ⛔ needs the job queue |

## Baseline — 2026-09-01

`pnpm bench` · `fixtures/perf/unit-300-bay.json` · 300 bays, 12 runs × 25 bays, 4 beam levels ·
200 iterations after 30 warm-up · Node v22.23.2 on linux/x64 (the desktop Linux VM).

| path | p50 | p95 | p99 | budget (p95) | headroom |
|---|---|---|---|---|---|
| `preview` | **0.49 – 0.66 ms** | 1.04 – 2.42 ms | 1.6 – 3.9 ms | 120 ms | ~**100×** |
| `fullDerivation` | **0.48 – 0.66 ms** | 0.85 – 1.54 ms | 1.3 – 2.3 ms | 400 ms | ~**300×** |

Ranges are across five runs, not one. **The headline: the derivation kernel is not the bottleneck
and was never close to being one.** Both measurable budgets are met by roughly two orders of
magnitude.

### What that changes

1. **Do not optimise the kernel.** There is no evidence of a problem, and the skill's first rule
   applies: optimisation without measurement is guessing, and here the measurement says stop.
2. **The risk is in the three unmeasured budgets**, all of which need code that does not exist:
   the submission path, the 5,000-row queue, and PDF generation. Those are where a performance
   task belongs, and the cheapest time to design for them is before they are written.
3. **The §5.4 gates alone cannot catch a regression.** At 100× headroom they fire only on a
   catastrophe. Hence the ratchet below.

### Why the ratchet keys on p50, not p95

Across five runs the **p95 varied by 2.3×** (1.04 → 2.42 ms) while the **p50 varied by 1.3×**
(0.49 → 0.66 ms). At sub-millisecond scale the p95 is dominated by scheduler and GC noise rather
than by the work. A p95 ratchet tight enough to catch a real regression would flap on noise; one
loose enough not to flap would catch nothing. So the ratchet is on the median, at **2.5 ms**, in the
same spirit as the coverage floors in `vitest.config.ts`: just above the measured value, so an
improvement is free and a slide is loud.

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
| 2026-09-01 | Establish the first baseline at all | none existed → see above | **kept** | Two of five budgets now have a number. Three still do not, and are not claimed. |

## Running it

```bash
pnpm bench                          # 200 iterations, asserts budgets and ratchets
BENCH_ITERATIONS=1000 pnpm bench    # tighter distribution, slower
```

It has its own config (`vitest.bench.config.ts`) and its own CI step, deliberately. A benchmark
inside the normal suite is either slow on every run or skipped on every run — and the skipped kind
is exactly how §5.4's budgets came to have no measurement behind them for the life of the project.
