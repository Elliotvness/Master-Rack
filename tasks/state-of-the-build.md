# State of the Build — 2026-09-01

Written after a day that produced two Critical security findings, the first pinnable catalog
release, the first CI run in the project's history, and the first performance measurement of any
kind. Everything below is **measured, not asserted**; where a figure is someone's claim rather than
something re-run today, it says so.

Supersedes the headline figures in `LATEST.md` and the Rev C conformance audit, both of which are
now stale in specific ways named at the end.

---

## The one-paragraph version

The foundations are in far better shape than they were this morning and the **product is still at
zero percent of its own definition of done**. Ten pure packages at 100% coverage, eight migrations,
a real RLS posture that now survives adversarial probing, a catalog release a human has actually
signed, and CI green for the first time. And: **no server, no routes, no UI, no screen anyone can
open.** §15.2's eight MVP-1 steps stand at 0/8, exactly where the audit found them, because every
one of them requires HTTP.

The gap is no longer *quality*. It is *existence*.

---

## Measured today

| | |
|---|---|
| Packages | **11** (10 pure + `db`); `contracts` is new today |
| Test files / tests | **44 files**, 1,042+ passing (last full count 1,042 across 43 files, before today's additions) |
| Coverage | 100% on every pure package, enforced in CI — **for the first time** |
| Migrations | **8** (`0007`, `0008` added today) |
| RLS | 19 tables, **8 sensitivity columns** where the checker saw 4 this morning |
| `.tsx` files | **0** |
| Server entry points | **0** |
| HTTP routes | **0** |
| §15.2 MVP-1 steps done | **0 of 8** |
| Branch | 24 commits ahead of `main`, PR #1 green |
| Catalog | `interlake-2026-09` **APPROVED**, first pinnable release |

---

## What actually changed today, and why it mattered

Five defects, all of the same shape: **a control that states its own method and has no mechanism
behind it.** That pattern is worth naming because it will recur.

| Finding | The control | What it was actually doing |
|---|---|---|
| **F-01** | `revision.audience` RLS closes the client/internal boundary | Closed the parent row; four child tables leaked. Demonstrated live: an internal finding readable by the client, code and severity |
| **F-02** | The two-person gate requires the approver's own spot-check | Accepted 20 fabricated cell ids. `TOTALLY/FAKE/CELL-0` through `-19` passed |
| **F-08** | "100% coverage on every pure package" | `verify` never ran `pnpm coverage`; CI had never run at all. Two modules sat at 60% and 89% |
| **F-11** | "20 cells or 5%, whichever is greater" | Counted extract ROWS. 20 cells were 19 readings, because p.88 prints `59E / 59ER` as one column |
| **§5.4** | Five performance budgets, each naming how it is measured | **None of the five was measured by anything.** No harness, no fixture |

Four of the five were found by *building the thing that was supposed to exist* rather than by
reading the code. That is the cheapest detection method available here and it should stay the
default.

---

## Performance — the first honest numbers

Full detail in `PERF.md`. The short version:

| path | p50 | p95 | §5.4 budget | headroom |
|---|---|---|---|---|
| `preview` (300-bay unit) | 0.49–0.66 ms | 1.04–2.42 ms | 120 ms | ~**100×** |
| `fullDerivation` | 0.48–0.66 ms | 0.85–1.54 ms | 400 ms | ~**300×** |

**The kernel was never the risk.** Budgets 3–5 — submission, the 5,000-row queue, PDF generation —
remain unmeasured because the code does not exist. That is where performance attention belongs, and
the cheapest moment to design for them is before they are written, not after.

A ratchet on the **median** guards against regression, because the measured p95 spread (2.3×) is
wider than any regression a p95 gate could usefully catch. Reasoning recorded rather than assumed.

---

## Where the effort actually is now

The audit put MVP-1 at 68% conformance with "the remaining 32% is a single missing layer". That
framing held up, and today sharpened it. What remains is not evenly distributed:

```
Done and solid            The kernel — 10 pure packages, 100% covered, boundary-enforced
                          The database — 8 migrations, RLS proven by mutation testing
                          The catalog — one approved, pinnable release with a human signature
                          The contract — errors, pagination, forbidden fields (today)

Not started, and large    The server        23 routes, deny-by-default, audit on every deny
                          The interface     every one of §15.2's eight steps needs a screen
                          The document path PDF generation, the job queue, WORM write

Not started, and small    Idempotency store, input DTOs, the outbound validator
```

The honest read: **the remaining work is mostly the two largest items in the plan**, and both are
things this project has never done. Everything cheap and everything already designed is finished.

---

## What is stale and should not be trusted

- `LATEST.md` records "961 tests / 42 files". The branch tip carried **40** test files. Corrected
  under R-11; the figure was never right.
- `tasks/plan.md`'s open-questions table lists **Q2 (server framework) as unchosen**. It is
  answered — **Fastify** — and has been since before today, recorded in the project status doc and
  never carried back. It gates T-14 only.
- The Rev C audit's "0% of §15.2" is still accurate. Its "68% conformance" predates eight commits of
  remediation and four new findings; treat the section scores as a snapshot, not a current state.
- Any claim that the pure packages are "all at 100%" **before today** was unverified: nothing
  measured it. It is true now, and now it is enforced.

---

## The review, honestly scored

| Phase | State |
|---|---|
| A — trust boundary (R-01…R-03) | **Done.** F-01 found and fixed, F-03/F-04 fixed, `check-rls` self-tested |
| B — approval gate (R-04…R-06) | **Done.** F-02 found and fixed, tool/kernel binding proved over 48 draws |
| C — parse and data (R-07, R-08) | **Partial.** `load-manifest` now at 100% with 28 error-path tests; R-08's independent read of the catalog data against its source is **not done** |
| D — verification and hygiene (R-09…R-11) | **Partial.** R-09 satisfied by CI; **R-10 (the commits judged as commits) is not done**; R-11 partly |

R-08 and R-10 are the two review tasks that never ran. Neither blocks the merge, and both are worth
doing before the branch becomes history — R-10 especially, because 24 commits is a long chain to
judge retrospectively.
