# Current State — Rack Master Studio

**Assessed 2026-08-31 by repository inspection.** Every claim below is traceable to a file that was
read or a command that was run. Where something was not verified, it says so.

Status vocabulary used here, carried from `rack-engine/CLAUDE.md`:
`CONFIRMED IMPLEMENTED` · `IMPLEMENTED BUT UNVERIFIED` · `PLANNED ONLY` · `BLOCKED`.

---

## 1. Headline

**Phase 0 Group A is complete and the kernel is under way.** The planning package is complete and
twelve foundation tasks are implemented, verified and committed: `A-01` scaffold, `A-02`
`kernel-units`, `A-03` boundary checker, `A-04` schema + RLS, `A-05` `withTenant()`, `A-06` RLS
assertion, `A-07` sessions and authentication, `A-08` `authorize()`, `A-09` the DTO leakage layer,
`A-10` the audit hash chain, `A-11` the transactional outbox, plus `C-01` `kernel-model`. Group B
has begun: the verified Interlake catalog is migrated (`B-01`/`B-02`/`B-04`/`B-06`) with a
no-interpolation lookup. The derivation kernel has two slices landed — `C-02` `kernel-derive`
(geometry and pallet-position counts) and `C-03` `kernel-geom` (obstruction faces and the clearance
index). Group B's rule pack (`B-05`) has landed with the verification-tier ceiling, and `C-04` —
the twelve MVP checks with that ceiling applied by the framework — is complete and its control
proven by deliberate breakage. `C-05` — the internal takeoff BOM with its unresolved register — is
complete, `C-06` — the renderer-neutral display list — is complete with `AC-07` proven at the
drawing layer, and `C-07` — the provenance lint that enforces it mechanically — is in the verify
chain. **`C-08` (golden fixtures) and `B-03` (frame capacity) are the next real work.**

| | |
|---|---|
| Blueprint revision | Rev C, 2026-08-31 |
| Decisions | 21 of 21 settled; one commercial item deliberately open (`OD-20b`) |
| Production source files | **70+** across nine pure packages, `db`, `apps/api`, `tools/` |
| Product tests | **885**, all passing across 38 files (pure + real-Postgres + real catalog, rule and as-built fixture data) |
| Coverage | **100%** on all nine pure packages; `apps/` and `db` measured with ratcheted floors (authz 92%, auth 96%, DTO/audit/outbox 100%) |
| Catalog data | 378 verified beam rows **and 435 verified frame-capacity cells**, extracted verbatim, status `DRAFT` (awaiting human approval) |
| Database | Postgres 16, **19 tables**, RLS enabled + forced on every one |
| Documentation toolchain | Working, 11 checks, all passing |
| Mechanical gates | **9**: kernel-boundary self-test + scan, **app-boundary self-test + scan**, provenance self-test + lint, RLS assertion, coverage thresholds, eslint determinism bans |
| Version control | **git, 39 commits**, working tree clean |
| Last full verification | `pnpm verify` **PASS**, exit 0, 2026-08-31 |

## 2. Naming

`READFIRST.md` previously named a `Master Rack Studio` folder that never existed. That brief has
been removed at the owner's instruction and the canonical, and only, project path is:

```
C:\Rack Master\rack-master-studio
```


## 3. Inventory of the active project

```
C:\Rack Master\rack-master-studio\
├── rack-master-studio-blueprint.html   316,002 bytes · 19 sections · 7 SVG figures · GOVERNING DOC
├── README.md · HANDOFF.md · open-decisions.md
├── reference-project-inventory.md · reuse-register.md
├── TODO.md                             prioritised backlog
├── docs\CURRENT_STATE.md               this file
│
├── package.json · pnpm-workspace.yaml  pnpm workspace
├── tsconfig.base.json · tsconfig.json  TypeScript strict + project references
├── vitest.config.ts                    test runner; alias table
├── eslint.config.mjs                   incl. the Date.now / Math.random determinism bans
├── .gitignore · .gitattributes         LF everywhere, so hashes match across machines
├── .github\workflows\ci.yml            typecheck → lint → test → self-test → boundaries → coverage
│
├── packages\kernel-units\src\          A-02. Pure: no I/O, no clock, no RNG
│   ├── units.ts                        storage bases, BASIS_BOUND
│   ├── errors.ts                       every refusal names what and why
│   ├── quantity.ts                     fixed-point arithmetic, allocate-never-divide
│   ├── provenance.ts                   fail-closed walkers, depth bound 32
│   ├── display.ts                      one-way formatting; VERIFY, never a numeral
│   └── *.test.ts                       68 tests
│
├── tools\
│   ├── check-boundaries.mjs            A-03. Kernel purity scan
│   └── selftest-boundaries.mjs         proves the checker catches all 10 violation types
│
└── src\                                the blueprint's Python build toolchain (unchanged)
```


## 4. Verification log

Every row is a command that was run and its actual result. Nothing is recorded here on the strength
of looking finished.

**2026-08-31 — `P0-009`: face heights stored exactly, displayed to one decimal**

| Check | Command | Result |
|---|---|---|
| Catalog suite | `pnpm test` | **PASS.** 11 PSG-authority tests |
| **59E stored at one decimal (5.9)** | deliberate break | **PROVEN RED**, 2 tests |
| **65E/65Q stored at one decimal (6.5)** | deliberate break | **PROVEN RED**, 2 tests |
| **59E reverted to 5.92** | deliberate break | **PROVEN RED**, 3 tests |
| **65E reverted to 6.54** | deliberate break | **PROVEN RED**, 3 tests |
| **59E set to the printed 5.93** | deliberate break | **PROVEN RED**, 3 tests |
| **27E truncated to 2.7** | deliberate break | **PROVEN RED**, 2 tests |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **885/885** tests |

**The decision, and the pushback behind it.** The owner asked for one decimal everywhere, on the
reasonable grounds that a second decimal complicates things and does not matter. It does not matter
*while face height is descriptive* — but the same message named **elevations**, which is the one use
that makes it matter. Face height enters an elevation stack **once per level**, and rounding errs
the same direction every time, so it **accumulates rather than cancelling**:

| Family | Published | 6 levels | 12 levels | 20 levels |
|---|---|---|---|---|
| 65E | `6 9/16"` = 6.5625 | 0.38" | 0.75" | **1.25"** |
| 36E | `3 21/32"` = 3.65625 | 0.34" | 0.68" | **1.13"** |

1.25" is past the ~1/4" a pallet opening is specified to, and a smaller stored face reports **more**
clear height than exists — the unsafe direction. `27E` is sharper still: it is published `2 3/4"`,
**exactly 2.75**, so a one-decimal store would discard a digit the manufacturer actually printed.

**Resolution: store the exact fraction, display one decimal.** The owner gets the simplicity asked
for on screen, and the engine keeps the precision an elevation needs. `FACE_HEIGHT_PRECISION = 1`
records the display convention in one named place.

**Both disputes are now closed, not settled.** `59E` (5.92 / 5.928 / 5.93 / 5.9375) and `65E`
(6.54 / 6.56) were every one of them approximations of a fraction the guide states exactly. Storing
the fraction removes the rounding choice that caused the argument. All six superseded figures are
pinned as failures.

**A refusal in `kernel-units` was hit and respected rather than worked around.** `5.9375"` is
150,812.5 µm, and the fixed-point domain refuses a value that is not a whole micrometre instead of
rounding it silently. So face height stays a catalog scalar and cannot be passed through
`formatLength`. The constant's doc comment says so plainly rather than implying a formatter
integration that does not exist — if face height is ever used dimensionally, the conversion must be
a deliberate, stated rounding at that call site.

**2026-08-31 — `P0-005` CLOSED: the 59E face height resolved to the published figure**

| Check | Command | Result |
|---|---|---|
| Catalog suite | `pnpm test` | **PASS.** 10 PSG-authority tests |
| **59E reverted to the superseded 5.92** | deliberate break | **PROVEN RED**, 2 tests |
| **59E "corrected" to 5.94 by rounding** | deliberate break | **PROVEN RED**, 2 tests |
| **65E/65Q silently closed to 6.56** | deliberate break | **PROVEN RED** |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **884/884** tests |

**The park is closed because the page reference finally exists.** PSG 2025 p.84 prints the 59E
profile as `5 15/16"` with `(5.93")` beside it. Three readings had been in play — 5.92 on all 42
transcribed rows, 5.928 in a documentation table, and 5.93 read from the chart — and none could be
promoted while none carried a reference. 5.92 is now superseded outright: **it appears nowhere in
the 98-page source document.**

**A trap worth naming: 5.93 is NOT a rounding.** `5 15/16` is 5.9375, which rounds to **5.94**. The
manufacturer's parenthesised figure is a *truncation they chose*, not arithmetic anyone can
re-derive. The catalog records 5.93 because that is what the source prints; "correcting" it to 5.94
would substitute our arithmetic for the manufacturer's own statement. Both wrong values are pinned
by test, and the 5.94 break was performed to prove the pin holds.

**The same page-84 cross-check found a SECOND discrepancy, deliberately left open.**
`65E/65ER/65Q/65QR` carry `6.54`, but page 84 prints those profiles as `6 9/16"` (6.5625, rendered
`6.56"`). Our value matches neither the fraction nor the printed decimal. It is **not** changed
here: the owner ruled on 59E specifically, and applying that ruling to a different family would be
inventing a decision nobody made. The unresolved `6.54` is **pinned by test**, so the gap cannot be
quietly closed by a later edit — it has to be ruled on, and the test updated with it. Non-blocking
on the same grounds `P0-005` was: face height is not a lookup key, and `lookup()` never reads it.

**The superseded release keeps its old answer.** `interlake-2026-08` still asserts 5.92, with the
test renamed to say so. A frozen release that quietly acquires a newer answer stops being a record
of what was believed at the time, and every submission pinned to it would silently re-rate.

**2026-08-31 — `P0-008`: PSG 2025 established as sole authority for beam capacity**

| Check | Command | Result |
|---|---|---|
| PSG authority suite | `pnpm test` | **PASS.** 7 tests over all 336 rows |
| **RED FIRST** | run against the 2026-08 data | **306 capacity mismatches + 42 phantom end-plate rows.** The test was written before the data changed and failed for the right reasons |
| **A capacity off by 5 lbs** | deliberate break | **PROVEN RED** |
| **A 40E/F3M phantom row reintroduced** | deliberate break | **PROVEN RED**, 3 tests |
| **A sixth short `code_18`** | deliberate break | **PROVEN RED** |
| **A whole family dropped** | deliberate break | **PROVEN RED** |
| **A new wrong end-plate letter** | deliberate break | **PROVEN RED** (the one published typo stays exempt) |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **881/881** tests |

**The decision.** The Interlake Mecalux Product Support Guide 2025 (`SEL-PSG-12/2025`) is **SOLE
authority** for beam capacity. The Mecalux Material Catalog is **disregarded for capacity values**,
and the reason is recorded rather than implied: it describes a different product line (25E, 31E,
35E, 39E, 43E, 47E, 55E, 65Q-DX) and carries **no capacity data for twelve of our sixteen
families**. Where the two overlap they disagree on every span — 65E at 48" reads 17,115 lbs in PSG
and 15,000 in the Material Catalog. A prior reconciliation recommended the Material Catalog for
capacity lookups; that is superseded as **impossible to satisfy**, not merely outvoted. Same shape
as `P0-004`: one source governs, the loser is named with its reason so nobody "restores" it later.

**Everything was verified against the original PDF, not the intermediate spreadsheet.** `98 pages`
confirmed. Page 88 confirmed as the capacity chart; page 84 confirmed as `BEAM PROFILES`. The chart
was then parsed straight out of the PDF and compared to the supplied file: **378/378 agreement, 0
mismatches**. The shipped catalog was **rebuilt from the chart** rather than copied from the
supplied file — which happened to be correct, but had no provenance, and adopting it would have
replaced one unverified number with another.

**A real defect was found and removed: 42 phantom rows.** The 2026-08 extract carried 40E/40ER
beams under an **F3M** (6", 3-tab) end plate. Page 84 publishes F3M for **27E and 36E only**, page
88 groups the 40E column under **F4M**, and character 13 of those rows' own codes reads `C` — an
end plate the 18-digit format does not allow on a 40E beam. They also read **3.8–12.2% below** the
real 40E capacity, so the engine looked conservative while quoting a beam that does not exist.
Deleted, not corrected: an unpublished variant has no right value.

**264 capacities were off by 5–25 lbs**, none of which appear anywhere in the source. Corrected to
the published cell.

**Six manufacturer anomalies were preserved verbatim, not silently fixed.** One 65QR code carries
the wrong end-plate letter and five are 17 characters where the format says 18. They are pinned as
**named literals**, so the published oddities stay quiet while a *new* one fails the build — the
catalog has to remain reconcilable against the document it came from.

**`2026-08` is retained and still referenced by existing tests.** A submission resolves against the
release it was built on; superseding a release must not silently re-rate a frozen job.

**2026-08-31 — `E-09`: the determinism harness**

| Check | Command | Result |
|---|---|---|
| Determinism self-test | `pnpm check:determinism:selftest` | **PASS.** 7 divergence types caught, 3 legitimate outputs allowed |
| Determinism check | `pnpm check:determinism` | **PASS.** 4 cases byte-identical across two environments and matching the pin |
| **`now()` in a quantity path** | deliberate break | **PROVEN RED.** `case 'bom' is NOT deterministic across machines` |
| **A silent constant change** | deliberate break | **PROVEN RED** by the pin alone — `frames * 4` → `frames * 5`, identical on both machines |
| **A dropped corpus case** | deliberate break | **PROVEN RED.** Renaming a case fails as "pinned but no longer runs" |
| **Both children in the SAME environment** | deliberate break | **PROVEN RED.** Refuses to certify agreement it did not earn |
| **`compareRuns` gutted** | deliberate break | **PROVEN RED.** The self-test reports 4 MISSED divergences |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **874/874** tests, determinism wired into `verify` and CI |

**A same-process double-run would have been theatre.** `AC-12` asks for byte-identical regeneration
*on two machines*. Two runs inside one process share a clock, a locale, a timezone and a module
cache, so every implicit input they might leak is identical by construction and the comparison
passes regardless of what the code reads. The second machine is therefore simulated: the corpus runs
in two separate child processes under `Pacific/Kiritimati` and `Pacific/Midway`, 26 hours apart and
across the date line.

**The pin is the other half, and it is the half that catches an unintended engine change.** Two runs
of a changed engine agree perfectly with each other. Only a stored digest notices that they no
longer agree with last week. `frames * 4` → `frames * 5` is deterministic, reproducible, and wrong,
and the cross-machine check alone is blind to it.

**A claimed hostility that never arrived was found and removed.** The first version also set `LANG`
and `LC_ALL` to `tr_TR.UTF-8`, on the reasoning that Turkish is the classic locale trap. Measuring
it rather than assuming it showed Node ignores both on Windows — the children resolved to `en-US`
either way, so the check advertised a locale comparison it never performed. A green result that
reads as evidence about locale, while testing nothing about locale, is worse than staying silent.
The variables were dropped, and the corpus now reports the environment it actually *observes*;
`assertEnvironmentsDiffer` refuses to certify agreement unless the children genuinely ran
differently. That guard is itself proven by breakage.

**The self-test matters more here than for the other three checkers.** They scan source and fail
loudly when broken. This one compares hashes, and a broken hash comparison fails GREEN — it would
report "byte-identical" forever while comparing nothing.

**2026-08-31 — `E-01`..`E-05`: the internal application**

| Check | Command | Result |
|---|---|---|
| Internal-web tests | `pnpm test` | **PASS.** 50 tests: the §12.4 trace, the queue, derivation, internal notes |
| **The no-table-basis branch survives** | deliberate break | **PROVEN.** Treating a named absence as a gap turned **1 test red** |
| **Unresolved shows its reason** | deliberate break | **PROVEN.** Rendering `0` instead turned **2 tests red** |
| **Trace consistency is checked** | deliberate break | **PROVEN.** Dropping the final-step comparison turned **1 test red** |
| **Waivers do not carry over** | deliberate break | **PROVEN.** Carrying them into a derived revision turned **1 test red** |
| **`AC-14` — absent, not locked** | deliberate break | **PROVEN.** Keeping internal items in client output turned **3 tests red** |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **869/869** tests across 36 files |
| Coverage | `pnpm coverage` | **PASS.** `trace.ts` and `queue.ts` at **100%** |

**`E-03` — "show your work" — answers §12.4's four questions from stored data alone.** That phrase
is load-bearing: a trace that re-runs the engine to explain itself proves only that the engine is
self-consistent *today*, and cannot explain a submission frozen two years ago against a catalog
release since superseded. So the module **renders** a stored trace and performs no arithmetic.
`traceInconsistencies()` is a **consistency** check rather than a recomputation — it confirms the
stored result of each step is carried into the next, catching a trace assembled from mismatched
pieces, without evaluating the formula.

**The branch that shows no table basis at all is kept, and is a COMPLETE answer.** `NoCatalogBasis`
is a named absence carrying the measured geometry and the reason — not a null, which would render as
a blank panel section, and a blank reads as *"we did not check"*. On half of all jobs this is the
correct output, not a degraded one. `unanswerableQuestions()` treats it as answered, and flags it
only when the *reason* is missing.

**An unconfirmed rule is flagged.** A one-job observation looks identical to an established rule on
a sheet unless the panel says otherwise, which is how a single job's coincidence becomes a company
standard.

**`E-04`: waivers do not carry into a derived internal revision.** A waiver is a judgement about one
specific configuration; carrying it would silently apply a decision to a configuration nobody made
it about. The derived revision forks into the `C` lineage and cannot write back, so the client's
submitted record stays the thing they actually submitted.

**`AC-14`: an internal revision is ABSENT from client responses, not locked.** "Locked" tells a
client something exists that they may not see, which is itself information — it says we are working
on a variant of their job, and invites the question we cannot answer.

**`E-05`: an internal note is a distinct entity, not a flagged message.** A flag is one wrong
default, one missing predicate or one `SELECT *` away from publication, and the failure is silent.

**Two pieces of dead code removed rather than tested.** `TraceError` was exported but never thrown,
and `buildTracePanel` carried `?? 0` fallbacks inside a branch where the narrowing already proved
them unreachable. Both were unreachable guards implying doubt the types had settled — the same
pattern found earlier in `PreviewError`, which suggests writing the error class before knowing it is
needed is a habit worth watching.

**2026-08-31 — `D-08` status and clone-to-draft: Group D complete**

| Check | Command | Result |
|---|---|---|
| Status and clone tests | `pnpm test` | **PASS.** 22 tests: the coarse vocabulary, the clocks, SLA visibility, clone lineage |
| **Internal states stay internal** | deliberate break | **PROVEN.** Surfacing the lifecycle to the client turned **3 tests red** |
| **Unmapped states fail closed** | deliberate break | **PROVEN.** Letting an unmapped state fall through under its own name turned **1 test red** |
| **Clone leaves the source untouched** | deliberate break | **PROVEN.** Giving the clone the source's content hash turned **1 test red** |
| **SLA targets stay hidden** | deliberate break | **PROVEN.** Showing targets before a baseline turned **1 test red** |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **819/819** tests across 34 files |
| Coverage | `pnpm coverage` | **PASS.** `status.ts` at **100%** |

**Three client states, not seven internal ones** (`OD-12`). `acknowledged`, `in_review` and
`rfi_open` all read as *"With our team"*. A client watching a submission move through the internal
lifecycle learns our process rather than their answer, and every transition becomes a question we
have to field. The mapping is kept in one table **with the internal names visible**, because that is
what makes a well-meant "let's show them more detail" a visible change rather than a quiet one.

**The mapping fails closed.** Adding a lifecycle state without deciding what the client sees throws
rather than leaking the internal name — asserted with a state that does not exist.

**The clocks are named for what they deliver:** *Acknowledgement* and *Quote delivery*. Never
*prelim turnaround* or *engineering review*, which name an authority this product does not hold and
escape into UI strings and client emails where they cannot be recalled. `forbiddenWordingIn()`
checks any client string and reports **every** offending phrase, and the status wording is asserted
clean by it.

**SLA targets stay hidden until ten live submissions are measured** (`OD-11`). Showing a target
before it is measured is a promise made from a guess, and the first time it is missed the client is
right to be annoyed.

**A clone leaves the source byte-identical.** The acceptance criterion is exact — *"clone leaves the
source `content_hash` byte-identical"* — so `cloneToDraft` returns the source alongside the clone,
letting a caller assert it rather than trust it. The new draft carries **no content hash at all**:
it has not been frozen, so there is nothing to hash, and carrying the source's would be a lie about
what the draft contains.

**Group D is complete.** `D-01` through `D-08`: invitation acceptance, facility entry, the option
builder, preview, findings, comparison, submit and status.

**2026-08-31 — `D-07`/`E-06`: the submit transaction**

| Check | Command | Result |
|---|---|---|
| Submit tests | `pnpm test` | **PASS.** 22 tests: the nine-step order, `AC-10`, and the do-nothing refusal |
| **Order enforced: freeze before persist** | deliberate break | **PROVEN.** Persisting derived rows first turned **2 tests red** |
| **Order enforced: audit before outbox** | deliberate break | **PROVEN.** Enqueueing early turned **2 tests red** |
| **`AC-10` — every reason** | deliberate break | **PROVEN.** Reporting only the first refusal turned **2 tests red** |
| **Reviews do not block** | deliberate break | **PROVEN.** Blocking on engineering-review findings turned **1 test red** |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **797/797** tests across 33 files |
| Coverage | `pnpm coverage` | **PASS.** `submit.ts` at **100%** |

**The one place client data crosses into internal workflow, and it crosses once.** §13.1 fixes nine
steps and *"if any step fails, nothing happened"*. The steps are modelled explicitly and the
completed list is **returned**, so the order can be asserted rather than inferred — an invariant
nobody can observe is one nobody can defend.

**Two orderings carry the weight, and both are now proven by breaking them:**

- **Re-derive before refusing.** Checking a cached finding set would let a revision submit against
  results that no longer match its inputs; the submission would be internally inconsistent from the
  moment it froze.
- **Freeze before persisting derived rows.** The rows are keyed to the content hash, so the hash must
  be final first. Persisting first keys them to a hash that can still change.

**The outbox is last, deliberately.** An email must not be sent for a transaction that rolled back.
A test asserts that a failure at `create_submission` leaves **no audit write and no outbox message**
— the refusal path performs `rederive` and nothing else.

**`AC-10`: a refusal lists every reason.** Blockers *and* a missing acknowledgement are reported
together, so a client does not tick the assumption box only to discover three blockers behind it.
Surfacing one problem at a time turns a single correction into several round trips and hides the
scope of the work.

**Only a `BLOCKER` stops a submit.** A review item is what the submission is *for*; blocking on one
would strand every job touching an under-sourced rule, which is most of them.

**2026-08-31 — `D-06` comparison, and a gap it exposed in the app separation**

| Check | Command | Result |
|---|---|---|
| Comparison tests | `pnpm test` | **PASS.** 18 tests: the closed metric set, the null-not-zero rule, per-option finding counts |
| **App boundary check** | `pnpm check:apps` | **PASS.** 11 client files scanned; no internal import |
| **App boundary self-test** | `pnpm check:apps:selftest` | **PASS.** All **6** violation types caught, all **5** legal imports allowed |
| **Forbidden metrics refused** | deliberate break | **PROVEN.** Filtering instead of throwing turned **3 tests red** |
| **The closed set holds** | deliberate break | **PROVEN.** Opening it to arbitrary keys turned **1 test red** |
| **Unestablished rows unrankable** | deliberate break | **PROVEN.** Ranking a row containing a null turned **1 test red** |
| **The boundary gate fires** | deliberate break | **PROVEN.** Adding `import ... from '@rms/api'` to a client file failed the check |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **775/775** tests across 32 files |

**A gap found while writing the tests, not by a gate.** The comparison test originally imported
`FORBIDDEN_CLIENT_FIELDS` from `@rms/api` to cross-check the two lists. That import is *reasonable
looking* and completely wrong: **nothing in the repository prevented the client bundle from
importing internal code.** `check-boundaries.mjs` enforces kernel purity and scans only `packages/`,
so `apps/client-web` was unguarded. The blueprint's claim that *"two bundles is the cheapest
structural guarantee that internal DTO types cannot reach a client screen"* was, until now, a
convention.

**`tools/check-app-boundaries.mjs` closes it**, with a self-test alongside. It catches static,
side-effect **and dynamic** imports — the last matters because `import('@rms/api')` defeats a type
check entirely — and it scans test files too, since an import reachable from a test is reachable
from the package. It allows the pure kernels, the display list and the catalog, because a client
legitimately reads published choices.

Both are now in `pnpm verify` and CI. That is the project's **eighth and ninth mechanical gates**.

**The comparison's own rule: never cost, price, part count or any BOM quantity.** Part counts *are*
the internal takeoff, and a comparison table is exactly where they leak, because a column of numbers
looks harmless beside another column of numbers. The comparable set is **closed and enumerated**
(`netPositions`, `aisleClearWidthIn`, `topOfLoadIn`, `storageLevels`), and anything outside it
**throws rather than being filtered** — a filter silently drops the field and leaves the developer
believing the column exists.

**A missing value is null, never zero.** A blank or zero cell in a comparison reads as *"none"*,
which is a claim. And a row containing an unestablished value is **not rankable**: comparing a number
to VERIFY produces an ordering the model cannot defend, which the client would read as a real
preference.

**Per-option counts stay split** — actions apart from reviews. A single "3 issues" badge tells the
client nothing about whether they have work to do, and in a comparison that matters more, not less.

**2026-08-31 — `D-04`/`D-05`: the preview and findings panel**

| Check | Command | Result |
|---|---|---|
| Preview and findings tests | `pnpm test` | **PASS.** 20 tests: the staleness guard, the finding split, submission gating |
| **Stale results discarded** | deliberate break | **PROVEN.** Applying every result regardless of generation turned **2 tests red** |
| **Stale FAILURES discarded** | deliberate break | **PROVEN.** Letting a late error through turned **1 test red** |
| **The finding split holds** | deliberate break | **PROVEN.** Merging review items into the client action list turned **2 tests red** |
| **A null count is not a zero** | deliberate break | **PROVEN.** Rendering an unestablished position count as `0` turned **1 test red** |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **757/757** tests across 31 files, against the live database |
| Coverage | `pnpm coverage` | **PASS.** `preview.ts` at **100%** |

**"Nothing displays from a stale computation" is a correctness requirement, not a performance one.**
A client changes a span, then changes it again before the first derivation lands. If the slower
earlier result arrives second, the screen shows a **real drawing of a configuration the client no
longer has**, and nothing on the page indicates it. So every derivation carries a generation number
and a result is applied only if it is still the newest. Late results are discarded, not merged and
not queued.

The sequencer also discards a stale **failure**, which is the subtler half: a late error would
otherwise replace a good current drawing with an error belonging to inputs the client has already
moved past. `isCurrent()` reports false the moment a new derivation begins, so a renderer can tell
the difference between "this is the answer" and "this was the answer".

**Missing input and engineering review are separate lists**, per §11.1. One is a task the client can
finish in thirty seconds; the other needs a person with authority. `clientActionList()` contains
**only blockers and missing inputs** — a review item is a notification, not a task, and putting it on
the action list asks the client to do something only we can do. Blockers come first because they
stop progress.

**Review items do not block submission.** A review item is what the submission is *for*; blocking on
one would strand every job touching an under-sourced rule, which is most of them. Only a `BLOCKER`
stops a submit.

**Client-facing wording never exposes the mechanism** (`R-15`). The panel says *"Our team will review
this before your quote is issued"* rather than naming tiers or rules — asserted by a test that the
wording contains no such vocabulary.

**A `ClientFinding` carries no citation, rule id or tier.** `AC-02` at the panel layer: the client
sees severity and `closed_by`; the citation lives in `finding_internal_detail` and never crosses.

**Dead code removed rather than tested.** The coverage gate found `PreviewError` exported but never
constructed. An unused error class is a claim that something can fail in a way nothing produces, so
it was deleted instead of given a test.

**2026-08-31 — `D-03` the option builder: demo beat 5, implemented**

| Check | Command | Result |
|---|---|---|
| Option builder tests | `pnpm test` | **PASS.** 25 tests against the **real pinned catalog**, not a fixture |
| **Demo beat 5** | `pnpm test` | **PASS.** A 110" beam is refused, the brackets 108" and 114" are named, and the explanation states the engine does not interpolate |
| **Nearest-match fires** | deliberate break | **PROVEN.** Snapping an off-grid span to the nearest published value turned **6 tests red** |
| **Clamping fires** | deliberate break | **PROVEN.** Clamping 12 beam levels to 6 instead of refusing turned **2 tests red** |
| **A generic refusal fires** | deliberate break | **PROVEN** — *after a test was added*. See below |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **737/737** tests across 30 files |
| Coverage | `pnpm coverage` | **PASS.** `options.ts` at **100%** |

**The screen where the product's thesis becomes visible.** A client asks for a 110" beam; the tool
refuses, names both brackets, and explains why. 110 is *closer to 108 than to 114*, so a
nearest-match would look helpful and would hand the client a different beam with a capacity that
belongs to that other beam. The test asserts the refusal explicitly against that temptation.

**Three refusals, each structural rather than advisory.** Choices come only from the pinned catalog
release; there is **no free-text dimensional entry and no min/max/step anywhere in the module**,
because a stepped control implies every value in the range is orderable and most are not; and an
out-of-scope level count is **refused rather than clamped**, since a clamp accepts "12" and quietly
configures 6 — a different rack from the one the client asked for, with no indication anything
changed.

**A gap the probes found, in the tests rather than the code.** The third probe replaced the
explanation's opening with a generic *"Not available."* and **all 24 tests still passed**: they
asserted the bracket text and the interpolation sentence, both of which live in the second half of
the message. A generic refusal would have shipped. Two assertions were added — that the explanation
repeats the requested value, checked across four different off-grid requests rather than for 110
alone — and the probe now turns 2 tests red. **This is the value of probing a gate rather than
observing it pass: the gate was real but partial, and only breaking it revealed which half was
untested.**

**An empty picker is refused outright**, because an empty dropdown is exactly what invites someone
to add a text box "temporarily".

**A refused span blocks the preview.** This is the one place the product refuses to proceed rather
than proceeding with a finding, and the reason is that the alternative is a drawing with no number
behind it.

**Operational note:** the Docker daemon had stopped during this session, and 53 integration tests
skipped. `pnpm verify` **correctly exited 1** — `check-rls` fails closed on `ECONNREFUSED` rather
than passing a run that proved nothing. Verified deliberately by stopping the container and
re-running. The database was restarted and the full 737 re-run green.

**2026-08-31 — `D-01`/`D-02`: the client application begins**

| Check | Command | Result |
|---|---|---|
| Client-web tests | `pnpm test` | **PASS.** 28 tests: the namespace guard, the `AC-01` collapse, and facility entry |
| **Namespace guard fires** | deliberate break | **PROVEN.** Weakening the guard to a substring check — the exact fix a developer makes for a false positive — turned **2 tests red** |
| **The AC-01 oracle is caught** | deliberate break | **PROVEN.** Making the invitation refusal "helpful" by showing the server's message turned **3 tests red** |
| **A zero is refused** | deliberate break | **PROVEN.** Accepting `0` as a facility measurement turned a test red |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **712/712** tests across 29 files |
| Coverage | `pnpm coverage` | **PASS.** `client-web/src/lib` at **100%**, threshold enforced |

**Two applications, enforced in code rather than by convention.** `apps/client-web` can reach only
`/api/client/v1`, and `request()` throws a `NamespaceViolationError` before issuing the call. The
prefix is anchored, so `/api/internal/v1/x?next=/api/client/v1` cannot slip through a substring
match and `/api/client/v10/` is refused as a lookalike. This is the blueprint's reasoning made
mechanical: **a shared route that hides fields makes leakage a serialization bug, invisible in
review; two namespaces make it a routing bug, loud and greppable.**

**`AC-01` is enforced by an ABSENCE.** The refusal type carries no reason code — not "expired", not
a status. The distinction is not available to render, so it cannot be rendered, and the natural
future "improvement" of showing a more helpful message cannot compile against this type without
deliberately adding the field back. Probe 2 shows what that improvement costs: three tests red.

A test asserts the refusals are structurally identical, not merely textually equal — an extra key
present on one refusal and absent on another is an oracle even when both messages match.

**The standing message names all three possibilities without confirming any:** *"It may have expired,
already been used, or been withdrawn."* An earlier draft of the test asserted the word "expired"
never appears, which **failed against correct code** — honest wording and a non-revealing response
are compatible, and the thing to forbid is the machine-readable field.

**No auto-login on acceptance**, deliberately. Auto-login turns a single-use invitation into a
session-granting token, so a forwarded email becomes an account takeover rather than a wasted
invitation.

**`D-02`: a zero is refused at the field.** Every facility field is `known`, `not_known` or `empty`,
and `setKnown` refuses zero and negatives with a message pointing at the NOT KNOWN control. A zero
clear height is not a measurement — it is a blank wearing a number's clothes, and it would sail
through every downstream check. **"Not known" does not block submission**, because refusing to accept
*I do not know* pushes a client into inventing a number, which is the outcome the whole product
exists to prevent.

Every finding names **who can answer it**, asserted by test, because a MISSING INPUT finding with no
route to an answer is a dead end and dead ends become support calls (`R-15`).

**Password policy is length-only.** Composition rules push people toward `Password1!` and away from
length, which is the property that actually matters.

**2026-08-31 — `B-03` frame capacity: Group B complete**

| Check | Command | Result |
|---|---|---|
| Extraction | `python tools/extract-frames.py` | **PASS.** 3 tables, **435 cells**, verbatim — matching the source's own 435/435 double-extraction reconciliation exactly |
| Frame lookup | `pnpm test` | **PASS.** 27 tests against the real published data |
| **Quarantine refused BY NAME** | deliberate break | **PROVEN.** Asking the extractor for a quarantined table refused it by name and exited 1, quoting the 72.4% overstatement |
| **A restored bad value fails** | deliberate break | **PROVEN.** Putting the quarantined 10,400 back into the data turned the test red: `expected 10400 to be 7597` |
| **The silent left-shift fails** | deliberate break | **PROVEN.** Dropping one column from a row refused at load: `HbL 36 has 9 values but 10 columns` |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **684/684** tests across 28 files |
| Coverage | `pnpm coverage` | **PASS.** `frames.ts` and `load-frames.ts` at **100%** |

**Frame capacity keys on TWO independent variables, and this is the whole substance of `B-03`.**
Models 2.314 / 2.313 / 2.312 carry two strut patterns — one for frames under 21 ft, one for over —
and therefore two published capacity columns. **A lookup keyed on HbL alone cannot reproduce the
published table.** That is not a modelling preference; it is what the chart says, and a test asserts
the two bands return genuinely different values (24,571 vs 25,847 lb at HbL 36) so a future
simplification to one variable fails loudly.

**The 21 ft boundary is inclusive at the lower band**, because the column header reads ≤ 21′. An
off-by-one there silently selects the more generous column, which is the direction that hurts, so it
is asserted at 251, 252 and 253 inches.

**The seven quarantined tables are refused by name in the extractor**, not left to a maintainer's
memory. The refusal message carries the reason: one table overstates published capacity by up to
**72.4%** at HbL 120 in because it was indexed on overall frame height under an HbL label. Three
tests assert the published values are what the catalog returns and the quarantined ones are not —
7,597 rather than 10,400 at HbL 96, and 4,989 rather than 8,600 at HbL 120.

**One documentation item closed by the source, recorded here because it was previously filed as a
judgement call.** The governing HbL includes the floor-to-first-beam distance. All three charts
define it as *"the maximum beam spacing **or** the distance between the floor and the top of the
first beam, whichever is greater"*. That is published basis, not an interpretation — `rack-app`'s
`REVIEW.md` B3 listed it as a modelling choice that might be flipped, and flipping it would
contradict the source.

**Still `DRAFT`, and still needs a person.** The 435/435 reconciliation is *evidence*, not a
signature. The source's own verification note is explicit: *"My double-extraction reconciliation is
evidence, not a signature."* The release gate refuses approval by the digitiser.

**2026-08-31 — `C-08` golden fixtures: `P1-014` closed, the derivation kernel complete**

| Check | Command | Result |
|---|---|---|
| The fixture is CONSUMED | `pnpm test` | **PASS.** 11 tests read `fixtures/golden/carson-0005-01-r1.json` from disk |
| **Proven consumed** | deleted the fixture | **PROVEN.** The build failed with `ENOENT`. The reference project's fixtures are read by nothing; this one cannot quietly become decorative |
| **The decisive probe** | deliberate break | **PROVEN.** An engine inflating gross AND lost by 100 still returns **net = 6,824** — the right headline by the wrong route. The fixture caught it on gross (7,080) and lost (256). A headline-only fixture would have passed it |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **657/657** tests across 27 files |
| Coverage | `pnpm coverage` | **PASS.** All thresholds met, including the new application floors |

**`P1-014` is complete.** The derivation kernel now runs end to end: units, model, catalog, geometry,
counts, rules, the twelve checks, the BOM, the display list, the provenance lint, and a golden
fixture wired into the test run. Every gate has been proven to fire by deliberate breakage.

**The fixture asserts the breakdown, not the headline** — and the probe shows why that distinction
is the entire point. `gross − lost = net` is checked, along with the engine's own invariants
(`net + lost = gross`, and the per-reason breakdown summing to the total), against a job that was
actually installed.

**An arithmetic finding while building it.** `6,980 / 916 = 7.6201`, which is not an integer, so
**no uniform level count reproduces the as-built gross**. Carson is a mixed configuration and the
drawing does not break it down by run. The fixture therefore records `beam_levels_per_bay` as
`not_established`, with the arithmetic reason — rather than inventing a configuration that happens
to multiply out. A fixture encoding a guess is worse than no fixture: it is a wrong answer with a
test defending it. The same applies to the 156 lost positions, which the drawing gives as a total
with no per-reason breakdown.

**A test asserts every `not_established` entry carries a reason longer than a marker word**, so the
section cannot decay into a list of bare `TODO`s.

**The rejected artifacts are recorded inside the fixture.** `Q-38857-1` and `Q-38857-8` appear in
`source.disregarded` with the reason they were rejected, so a future reader knows they were
considered rather than missed — and cannot "restore" a number that was deliberately dropped.

**2026-08-31 — review finding: the coverage gate had a blind spot over the riskiest code**

| Check | Command | Result |
|---|---|---|
| Coverage now measures `apps/` | `pnpm coverage` | **PASS.** `apps/api` was **excluded from measurement entirely**; it is now included with ratcheted floors |
| Authorization matrix | `pnpm test` | **PASS.** **114 new tests** — every action × every role, enumerated rather than sampled |
| Concurrent invitation redemption | `pnpm test` | **PASS.** 8 simultaneous redemptions of one token, **exactly one winner** |
| `withTenant` guards | `pnpm test` | **PASS.** 7 tests for the refusals that fire before a database is reached |
| **The ratchet bites** | deliberate break | **PROVEN.** Deleting the authorization matrix dropped authz to 85.8% lines / 77.3% functions and **failed the build** against the new floors. Reverted and re-verified |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. **646/646** tests (was 513) across 26 files |

**What the review found.** `vitest.config.ts` measured only `packages/*/src/**`. Everything under
`apps/` — authentication, authorization, the DTO leakage boundary, the audit chain — produced **no
coverage number at all**, and an unmeasured directory reads as an unproblematic one. Measured
manually, the picture was uncomfortable:

| | Before | After |
|---|---|---|
| `authz/authorize.ts` | **70.9%** | **92.4%** |
| `auth/policy.ts` | **63.6%** | **100%** |
| `apps/api/src/auth` overall | 93.2% | 97.0% |

The kernel sat at 100% while the layer carrying the actual commercial risk sat at 71%, behind a
headline that said "100% on all nine pure packages" — true, and misleading.

**The authorization matrix is the substantive addition.** The existing suite was example-based, and
examples leave holes: several actions had no test at all. The new suite enumerates **every action
against every role**, with the expected decision written out by hand rather than derived from the
implementation — a table derived from the code would agree with a bug. A test asserts the table
covers exactly `KNOWN_ACTIONS`, so adding an action without deciding its policy for each role fails.

**A distinction the matrix forced into the open.** The first draft asserted that *every* client
denial on an internal resource returns 404, and it **failed against correct code**. Reading `AC-03`
settled it: a 404 is required when a client asks for an internal **artifact**, because a 403 would
confirm the object exists. But attempting a staff-only **capability** — creating an organization,
approving a release — leaks nothing about existence, and a 404 there would be dishonest in the other
direction. The code was right and the test was wrong. The two groups are now listed explicitly, so
the distinction is a decision on the record rather than an accident.

**Why the application floors are not 100%, stated so it is not mistaken for a concession.** A pure
function's every branch is reachable from its arguments, so 100% is achievable and anything less
means an untested refusal. An I/O layer has branches reachable only from a driver fault or a
corrupted row; chasing those to 100% produces mocks that assert the mock, converting a known
weakness into a false assurance. The floors sit just under the measured value and are a **ratchet**:
a regression fails the build, an improvement is free, and lowering one to make a build pass is the
one thing that must not happen.

**Two genuinely valuable behaviours are now asserted rather than assumed.** Eight concurrent
redemptions of a single invitation yield exactly one winner — the sequential test proved the state
check, this proves it is *atomic*, and a read-then-write would pass the first and fail this one.
And `verifyPassword` survives stored parameters that make scrypt itself throw, because a corrupted
credential row is a data problem, not an availability problem, and a 500 on the login path is both
an outage and an oracle.

**2026-08-31 — `C-07` provenance lint: enforcing the rule `C-06` only states**

| Check | Command | Result |
|---|---|---|
| Self-test | `pnpm lint:provenance:selftest` | **PASS.** All **8** violation types caught **and all 6 legal forms allowed** — the second half matters as much as the first |
| Real tree | `pnpm lint:provenance` | **PASS.** 57 files scanned, clean |
| **Gate fires — probe 1** | deliberate break | **PROVEN on real source.** Making a display builder format a raw number (`displayText(convert(…) * 2)`) failed the lint, exit 1 |
| **Gate fires — probe 2** | deliberate break | **PROVEN.** Renaming the scan roots so the lint matched nothing produced *"Refusing to report a pass for a scan that checked nothing"*, exit 1 — not a silent green |
| **Gate fires — probe 3, the control on the control** | deliberate break | **PROVEN.** Disabling the linter's numeric-literal detection was caught by its **own self-test**: `MISSED a real violation: numeric literal passed to a formatter`. All three reverted and re-verified |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0, with both new gates in the chain. 513/513 tests |

**What it enforces.** `C-06` states that a renderer consumes a display list and may not recompute a
dimension. That is one line of prose, and the failure it prevents is one line of code written in a
hurry: `formatLength(96)` instead of `formatLength(inches(96))`. A `Quantity` carries a unit and an
origin, so the formatter can refuse to print a numeral for an unestablished value. A raw number
carries neither, so it always prints — and `AC-07` is silently bypassed at the last inch, on the one
surface a client actually reads.

**Why a source scan when the type checker already rejects this.** Because `as never`,
`as unknown as Quantity`, `@ts-expect-error` and a hand-built object literal all defeat the type
system, and every one of them appears in real code under deadline pressure. A cast is precisely how
a raw number reaches a formatter. The lint flags the cast itself: provenance carried through a cast
is fiction.

**Deliberately narrow, and that is a design decision.** A bare identifier is **not** flagged, because
`formatLength(x)` is correct when `x` is a `Quantity`, and deciding that needs types rather than
text. The lint flags only what is provably wrong: a numeric literal, arithmetic on raw numbers,
`.value` reached past the quantity, a numeric coercion, or a laundering cast. **A linter that flags
correct code trains people to ignore it, and an ignored gate is an absent gate** — which is why the
self-test asserts the negative cases too, including a formatter named in a comment or inside a
string.

**The self-test is the more important artifact.** A linter that silently stopped working reports a
clean pass forever, and the build stays green while the invariant rots. Probe 3 is the proof that
this cannot happen quietly: breaking the detection turns the self-test red, so the checker cannot
decay without saying so.

**2026-08-31 — `C-06` `display-list`: the renderer-neutral drawing model**

| Check | Command | Result |
|---|---|---|
| Display-list tests | `pnpm test` | **PASS.** 26 tests: the model's refusals, plan and elevation builders, and the one-list-many-renderers property |
| **`AC-07` at the drawing layer** | `pnpm test` | **PASS.** An unestablished value renders `VERIFY`, asserted as *no digit anywhere* in the entry rather than as a string match |
| **Gate fires — probe 1** | deliberate break | **PROVEN.** Making an unknown aisle width print `0"` instead of `VERIFY` turned **2 tests red**. This is the exact `AC-07` leak: a refusal in the engine that leaks a number into the interface is not a refusal |
| **Gate fires — probe 2** | deliberate break | **PROVEN.** Drawing `n` uprights instead of `n+1` turned **2 tests red** (`expected length 4 but got 3`) — the off-by-one caught at the drawing layer, not just in derivation. Both probes reverted and re-verified |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. 513/513 tests (was 487); boundaries now **31 files across 9 pure packages** |
| Kernel coverage | `pnpm coverage` | **PASS.** `display-list/src` at **100%** on all four measures |

**One display list, three renderers.** Canvas 2D for plans, inline SVG for elevations, server-side
PDF for documents. The blueprint's reasoning is a liability argument, not an aesthetic one: *"A
drawing that prints differently from the screen is a support burden and a liability."* The client
and internal PDFs are the same list with two render options, one watermarked and one not.

**The boundary rule is what gives it teeth** (§8): a renderer consumes a display list and **may not
recompute a dimension**. If it could, every provenance guarantee upstream would be void at the last
inch — the screen would make claims the model never made. So the extent is *supplied* rather than
inferred from the items, and geometry is carried as integer micrometres in **model space**: a pixel
is a rendering decision, and baking one in is how two renderers drift apart.

**`{text, established}`, never a bare string.** A bare string has already lost the distinction
between "144 inches" and "we do not know", and by then it is too late to refuse. Every text-bearing
entry carries its establishment flag to the renderer.

**A dimension the model cannot state still draws.** Witness lines are emitted and the number prints
`VERIFY`. Omitting it would read as *"no aisle dimension applies"*, which is a different claim from
*"we cannot state it"* — and on a drawing that difference is the whole product.

**Two defects the gates caught during this build.** The coverage gate found `rect()`'s `?? null`
branch untested, which mattered because a renderer switching on `label !== null` must not also have
to handle `undefined` — one absent representation, not two. And a test asserting that a fractional
micrometre is refused **failed to fail**: lengths are stored as integer micrometres and µm has scale
1, so `convert(q, 'um')` is exact by construction and the guard was unreachable. The guard was
deleted and the test rewritten to assert what is real — that a *load* where a *length* belongs is
refused. An unreachable guard is worse than none, because it implies a doubt the type system has
already settled.

**2026-08-31 — `C-05` `kernel-bom`: the internal takeoff and its unresolved register**

| Check | Command | Result |
|---|---|---|
| BOM tests | `pnpm test` | **PASS.** 31 tests: the three established rules, the unresolved register, uncatalogued material, and byte-identical regeneration |
| **`AC-13` made unrepresentable** | `pnpm test` | **PASS.** `BomLine` is a discriminated union: a resolved line has a quantity and a null reason, an unresolved line the reverse. "Both" and "neither" cannot be constructed, not merely refused |
| **`AC-12` byte-identical regeneration** | `pnpm test` | **PASS.** `canonicalBom` is stable across repeated derivation, and independent of the order the caller listed source objects. Asserted non-vacuous: changing a bay count *does* change the bytes |
| **Gate fires — probe 1** | deliberate break | **PROVEN.** Adopting a wire-deck formula turned **3 tests red**, including the register listing and the category total |
| **Gate fires — probe 2** | deliberate break | **PROVEN.** Letting back-to-back rows share frames turned **5 tests red** with exactly the off-by-one the rule exists to prevent: `expected 21 to be 22`. Both probes reverted and re-verified |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. 487/487 tests (was 456); boundaries now **28 files across 8 pure packages** |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-bom/src` at **100%** on all four measures, first run, with no test written to chase a line |

**Three quantities are derived; everything else is refused.** Frames = `(bays + 1) × rows` with
back-to-back rows **not** sharing uprights, beams = `bays × levels × 2 × rows`, anchors = `frames × 4`
(verified against a delivered job at 3,812 / 953 = 4.000 exactly). Wire decks, row spacers and
footplates emit `UNRESOLVED` with their reasons.

**That asymmetry is the deliverable, not a gap in it.** The reference projects contain three
conflicting wire-deck formulas — `len >= 132 ? 3 : 2`, `max(2, ceil(len/60))`, and a one-job
observation of about 1.14 per bay. **All three are named in the unresolved reason**, specifically so
a future reader cannot "restore" one believing it was lost by accident. Probe 1 demonstrates the
cost of adopting one: the BOM looks complete and rests on a number nobody can defend.

**Each unresolved reason names what would close it**, so the register is a roadmap rather than a
list of complaints. The row-spacer entry also records that the reference implementation hardcodes a
12-inch spec string while ignoring its own editable flue field — a live defect, documented as not
carried forward.

**An unresolved line contributes nothing to a category total — null, never 0.** A zero reads as
"none required", which is a different claim from "we cannot say", and on a takeoff sheet that
difference is a purchase order.

**Uncatalogued material yields a quantity but never a capacity.** The *count* is geometry and is as
reliable as for a catalog part, so an uncatalogued frame counts identically. The *capacity* does not
exist and there is deliberately no field for it. This is a normal output, not a degraded one, and it
is what makes the schema able to represent the half of all jobs that carry such material.

**2026-08-31 — `C-04` `kernel-checks`: the twelve MVP checks and the ceiling framework**

| Check | Command | Result |
|---|---|---|
| Framework tests | `pnpm test` | **PASS.** 20 tests: the ceiling applied centrally, the citation carried, silence named, `closed_by` mandatory, duplicate check codes refused |
| The twelve checks | `pnpm test` | **PASS.** 36 tests, one or more per check, incl. `AC-08` off-grid brackets, `AC-09` no table basis for uncatalogued material, and the clean-configuration baseline that produces **no findings at all** |
| **`AC-19` proven by breaking it — probe 1** | deliberate break | **PROVEN.** Rewriting the aisle check to claim `PASS` against its `SECONDARY` rule went **red** (1 failed / 56): the framework still returned ENGINEERING REVIEW REQUIRED |
| **`AC-19` proven by breaking it — probe 2** | deliberate break | **PROVEN, and this is the decisive one.** Demoting `GEOM-TOP-OF-LOAD` from `PRIMARY` to `SECONDARY` **in `rules.json`, editing no code at all**, turned check 4's outcome from `BLOCKER` into `ENGINEERING_REVIEW_REQUIRED`. Both probes reverted and re-verified |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. 456/456 tests (was 400); boundaries now **25 files across 7 pure packages** |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-checks/src` at **100%** statements / branches / functions / lines |

**The control is structural, not a convention.** A `Check` returns an `Observation`; only
`runChecks` produces a `Finding`; and `applyCeiling` is called in exactly one place. A developer
therefore cannot write a check that returns PASS against a secondary-sourced rule, because a check
**cannot produce a finding at all**. Probe 2 is the proof that matters: the tier lives in data, and
moving it changed a verdict with no code touched. That is the property `AC-19` actually asks for,
and it is what makes an unresolved source conflict safe to ship — the conflict caps the conclusion
automatically rather than relying on someone remembering.

**What the check set refuses to conclude.** Check 5 observes a `BLOCKER` on an aisle shortfall and
is capped at ENGINEERING REVIEW REQUIRED, because the load-face convention has no located code
basis. Check 11 reports the measured flue dimension and is forced to NOT EVALUATED, so **no
fire-protection verdict is reachable** even though the check runs and the number is shown. Check 12
names uncatalogued material and states that capacity cannot be established from geometry, carrying
no capacity and **no table basis at all** (`AC-09`) — its citation names the product's own scope
constraint, because no table was read.

**Three §11.1 failure modes are asserted rather than assumed.** *Silence is not a pass*:
`silentChecks()` names every check that reported nothing, so the screen can show it rather than omit
it. *Missing input is not engineering review*: a `MISSING_INPUT` observation survives even a
`SECONDARY` rule, so the client's actionable list is never buried inside things they cannot act on.
*An unestablished value is never a numeral* (`AC-07`): `FindingParameter` is a discriminated union
where `value` is `null` exactly when `established` is false, making "unestablished but here is the
number anyway" unrepresentable rather than merely discouraged.

**A defect the coverage gate caught:** `checks.ts` carried `n.kind === 'value' ? n.label : n.label`
— a ternary whose branches are identical, left over from an earlier shape of the provenance walk. It
was dead logic pretending to be a decision. Deleted rather than tested, because the honest fix for
an uncoverable branch is usually that the branch should not exist.

**2026-08-31 — `B-05` `kernel-rules`: rule packs and the verification-tier ceiling**

| Check | Command | Result |
|---|---|---|
| `kernel-rules` unit tests | `pnpm test` | **PASS.** 46 new tests: the five-tier ladder, the §11.2 ceiling table asserted verbatim, rule/citation loading, the rule-pack approval gate, and the real seed pack |
| **`AC-19` proven, not asserted** | `pnpm test` | **PASS.** `applyCeiling` is exhaustive over all 5 tiers × 7 severities: PASS survives only at `PRIMARY`, a bare BLOCKER only at `PRIMARY`/`REPRODUCED`, and `NOT_FOUND` collapses **every** severity to NOT EVALUATED |
| **The gate fires** | deliberate break | **PROVEN.** Adding `PASS` to the `SECONDARY` permitted list turned **3 tests red across both files** — the AC-19 test, the subset-monotonicity property, and a seed-data test asserting the aisle rule caps at engineering review. Reverted and re-run green |
| Whole pipeline | `pnpm verify` | **PASS**, exit 0. 400/400 tests (was 354); boundaries now **21 files across 6 pure packages**; typecheck, lint, self-test, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-rules/src` at **100%** statements / branches / functions / lines; threshold added to `vitest.config.ts` |

**Why this lands before `C-04`.** The twelve checks cannot be written first. `AC-19` requires the
tier ceiling to be applied *by the framework* from the rule's own tier, so the tier has to exist as
data before a check can be subject to it. Building the checks first would mean each check carrying
its own ceiling — which is exactly the design the *Rack Screening Register* Rev A review found
failing, where **14 checks asserted a hard FAIL while their own notes conceded the source had never
been read**. The fix is mechanical, not editorial: `applyCeiling` makes the overstatement
unrepresentable rather than merely discouraged.

**The seed pack is honest about what it does not know.** Twelve rules for the twelve MVP checks,
each carrying the tier its source actually supports rather than the tier that would be convenient:

- **Nine at `PRIMARY`** — and every one of them is either arithmetic over the client's own stated
  geometry, or a fact about the pinned catalog. None claims an external standard. The loader
  *enforces* that a `PRIMARY` rule cites an edition **and** a section: if the standard was read, the
  reader can say where.
- **`AISLE-CLEAR-WIDTH` at `SECONDARY`**, so it can produce at most ENGINEERING REVIEW REQUIRED. The
  requirement comes from the client's equipment sheet and the load-face measurement convention has
  no located code basis (ADR-006 fixes the datum for internal consistency, which is not a compliance
  claim).
- **`FLUE-SPRINKLER-GEOMETRY` at `NOT_FOUND`.** The NFPA section for the 18-inch rule has not been
  located, so check 11 reports a measured dimension and the ceiling forces NOT EVALUATED — no
  fire-protection verdict is reachable even if a check tried. `rack-takeoff`'s 21.5-inch flue claim
  is carried as a **question**, not adopted.
- No rule cites MH16.1 or NFPA at `PRIMARY`, and a test asserts that property over the data rather
  than trusting review. All **six** open source conflicts (§10.8) are recorded on the manifest.

**Two integrity rules are enforced by the loader rather than left to review:** a `NOT_FOUND` rule
may not carry a value at all (no source located means no established number, and a number in the
data will eventually be read by something regardless of its tier), and a rule with a value must name
its unit. The pack arrives as `DRAFT` — authored here, but approval is an act, not an inheritance,
and the gate refuses the author approving their own pack or approval with no recorded verification
path.

**A defect the boundary checker caught during this build:** `RulePack.require()` — an ordinary
lookup-or-throw method — tripped the kernel purity scan's `require(` ban, which exists to stop
dynamic module loading defeating the scan. The checker was blunt but correct, and weakening the
pattern to allow a method call would have put a real hole in it. Renamed to `mustGet()`; the ban
stands unmodified.

**2026-08-31 — `P0-005` closed: the 59E face height, parked and pinned**

| Check | Command | Result |
|---|---|---|
| Rows unchanged | `pnpm test` | **PASS.** All 42 rows of 59E/59ER still read `5.92` — the value as published |
| The discrepancy cannot reach a capacity | `pnpm test` | **PASS.** Perturbing every 59E face height to 5.93 and re-running the lookup returns a byte-identical result, because the key is `family + series + span` |
| **The new gate fires** | deliberate break | **PROVEN.** Changing the pin to `5.93` turned the row test red (1 failed / 24); reverted and re-run green |
| Whole pipeline | `pnpm verify` | **PASS.** 354/354 tests (was 352); typecheck, lint, boundaries, self-test, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-catalog/src` still 100% on all four measures; no threshold breached |

**EL read the source chart as 5.93.** That is a *third* distinct value, and it corroborates rather
than conflicts: 5.928 rounds to 5.93 at two decimals, whereas 5.92 is a genuinely different
printing. So the reading favours the documentation table over the transcribed rows — but it still
arrives **without a page reference**, so no figure is promoted to a fact. All three readings, the
reader and the date are recorded on the catalog manifest under `face_height_59e_status`, with
`page_ref` deliberately empty.

**The 42 rows were not "corrected".** Transcribe-as-published is what keeps the extract
reconcilable against its source; editing a row to match a better reading destroys the property that
makes the data trustworthy. The rows stay at 5.92 and the disagreement is carried as data.

**A correction to the backlog, recorded rather than quietly dropped.** `P0-005` was written claiming
face height "feeds a lookup key, and a wrong key silently sends every lookup off-grid". Reading
`kernel-catalog/src/lookup.ts` shows that is **false** — `faceHeightIn` is loaded, carried, and never
read by `lookup()`. The item was rated `P0` on a misreading of the code. It is non-blocking today,
and the second new test pins exactly that property, so if face height ever *does* become load-bearing
the test stops being true and the question returns on its own rather than being forgotten.

**2026-08-31 — state review (re-run of the whole gate, no code change)**

| Check | Command | Result |
|---|---|---|
| Whole pipeline, from a clean tree | `pnpm verify` | **PASS**, exit 0 in 16.7 s. 352/352 tests across 17 files; `tsc --build` and `eslint .` clean |
| Boundary self-test | (in `pnpm verify`) | **PASS.** All 10 violation types caught |
| Boundary scan | (in `pnpm verify`) | **PASS.** 18 files across 5 pure packages |
| RLS assertion | (in `pnpm verify`) | **PASS.** 19 tables in schema `app`, all enabled and forced |

This run confirms the committed state reproduces on a cold checkout. `TODO.md` was found stale — it
still listed `A-07`..`A-11` and the catalog work as `Not started` after they had been built and
committed, and it carried a file-impact plan for `A-07`, long since done. Corrected in the same
pass; the stale plan was replaced with one for `C-04`. Recorded because a status document that
lags the repository is the same defect class the product exists to prevent.

**2026-08-31 — `C-03` `kernel-geom` (second slice of P1-014)**

| Check | Command | Result |
|---|---|---|
| `kernel-geom` unit + agreement tests | `pnpm test` | **PASS.** 23 new tests: face validation (empty/inverted span, non-integer µm, missing id), clearance semantics (opposing normal, span overlap, facing direction, nearest-of-many), and the span-bucketed `ClearanceIndex` |
| **Index agrees with the oracle** | (in `pnpm test`) | **PASS.** On a full synthetic scene (>300 irregular faces: back-to-back rows, column guards, dock jambs, closed perimeter, a no-rack zone) the index returns byte-identical clearance to `minClearanceBrute` for **every** face — 0 mismatches |
| Whole pipeline | `pnpm verify` | **PASS.** 352/352 tests (was 329); typecheck, lint, boundary self-test + scan, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-geom/src` at **100%** statements / branches / functions / lines; threshold added to `vitest.config.ts` |
| Purity | `node tools/check-boundaries.mjs` | **PASS.** now 18 files across **5** pure packages; `kernel-geom` imports only `@rms/kernel-units` |

**ADR-007's implementation is honoured, not reinterpreted.** The benchmark fixed the strategy — a
brute-force sweep is 63.79 ms p95, four times a frame budget, so the span-bucketed index is required
rather than optional. `kernel-geom` ports it faithfully: faces bucketed by (axis, normal, span
bucket) at the benchmark's 120 in width, each bucket sorted by coordinate, a query walking only the
touched buckets and scanning forward from its own coordinate. Everything is integer µm, so a
clearance is exact. The brute-force method is kept in the shipped module as the correctness oracle,
and the index is asserted to agree with it across a whole scene — a faster wrong answer is not a
result. `C-04`..`C-08` (checks, BOM, display list, provenance lint, golden fixtures) remain.



| Check | Command | Result |
|---|---|---|
| `kernel-derive` unit + property tests | `pnpm test` | **PASS.** 39 new tests: bay pitch, run length (n+1-upright property for n ∈ {1,2,5,20,82}), overhang allocation (sum-exact, odd-µm-to-front), aisle clear width (order-independent, never negative), gross positions (floor counted only when it stores), position accounting (breakdown sums to lost; net + lost = gross) |
| Whole pipeline | `pnpm verify` | **PASS.** 329/329 tests (was 290); typecheck, lint, boundary self-test + scan, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-derive/src` at **100%** statements / branches / functions / lines; threshold added to `vitest.config.ts` |
| Purity | `node tools/check-boundaries.mjs` | **PASS.** now 16 files across **4** pure packages; `kernel-derive` imports only `@rms/kernel-units` |

**The discipline the slice keeps.** No catalog or rule number appears in `kernel-derive`: the clear
span, upright face, overhang and face positions are all supplied by the caller from pinned data or
client input. `UNKNOWN` inputs propagate to `UNKNOWN` results rather than being laundered, and every
returned value carries a `ProvenanceNode` tree written in the words a sheet prints. The n+1-upright
rule — the off-by-one that looks correct — is asserted as a property from both ends, not just by
example. `C-03`..`C-08` (geom, checks, BOM, display list, provenance lint, golden fixtures) remain.

**2026-08-31 — review pass**

| Check | Command | Result |
|---|---|---|
| Blueprint builds from source | `python src\build.py` | **PASS.** 14 parts → 316,002 bytes |
| All 11 structural checks | (run by `build.py`) | **PASS.** strict parse · self-contained · anchors resolve · 19 sections · 7 figures · diagrams labelled · svg markers · no client identifiers · language discipline · svg geometry in bounds · link interception present |
| Version control present | `git status` | **FAIL — not a git repository.** Fixed same day, below |
| Reference trees intact | `dir` on all four | Present and untouched |

**2026-08-31 — Phase 0 build (`A-01`, `A-02`, `A-03`)**

| Check | Command | Result |
|---|---|---|
| P0-002 repository | `git log --oneline` | **PASS.** 3 commits; `git status --short` clean |
| P1-001 install | `pnpm install` | **PASS.** 193 packages; only `esbuild` allowed a build script |
| P1-001 typecheck | `pnpm typecheck` | **PASS.** `tsc --build`, exit 0, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| P1-001 lint | `pnpm lint` | **PASS.** exit 0 |
| P1-002 tests | `pnpm test` | **PASS.** 68/68 across 3 files |
| P1-002 coverage gate | `pnpm coverage` | **PASS.** 100% statements / branches / functions / lines on `kernel-units`; threshold enforced |
| P1-003 checker self-test | `node tools/selftest-boundaries.mjs` | **PASS.** all 10 violation types caught |
| P1-003 boundary check | `node tools/check-boundaries.mjs` | **PASS.** 9 files across 1 pure package |
| Whole pipeline | `pnpm verify` | **PASS.** exit 0 |

**Two defects the gates caught during this build, recorded because a gate that never fires is
unproven:**

1. `convert()` multiplied by the source scale as well as dividing by the target scale, so the
   identity conversion of a per-pair capacity returned 5,400,000 instead of 5,400. Caught by the
   `lb/pr` identity test. Fixed.
2. A test asserted the blueprint's "18 of 21 spans" figure against a span list that was
   reconstructed rather than read from the published catalog. That is the exact failure mode the
   product exists to prevent, so the borrowed count was removed and the test now asserts only the
   property that does not depend on the real list. The exact count becomes assertable at `B-02`,
   when the real catalog arrives. Recorded in the test's own comment.

Not verified: `verify-visual.py` (needs Playwright, not installed) — `P0-003` remains open. CI has
never run on a real runner; the workflow is written but unexercised.

**2026-08-31 — Phase 0 continued (`C-01`, `A-04`, `A-05`, `A-06`)**

| Check | Command | Result |
|---|---|---|
| C-01 hash stability | `pnpm test` | **PASS.** Written before the hashing code; 38 canonical + 17 SHA-256 + 26 revision tests |
| C-01 SHA-256 vectors | (in `pnpm test`) | **PASS** against FIPS 180-4 `abc`, the two multi-block examples, the million-`a` case, five padding boundaries, and independently pinned UTF-8 digests |
| A-04 migrations | `pnpm migrate` | **PASS.** `0001_init.sql`, `0002_rls.sql` applied to Postgres 16 |
| A-06 RLS assertion | `pnpm check:rls` | **PASS.** 16 tables, all RLS enabled + forced with a policy per operation; `app_user` has no SUPERUSER or BYPASSRLS |
| A-04/A-05 tenancy | `pnpm test` | **PASS.** 27 tests against **real Postgres**, not a mock |
| Whole pipeline | `pnpm verify` | **PASS.** 176/176 tests; typecheck, lint, boundaries, self-test, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** 100% statements / branches / functions / lines on `kernel-units` **and** `kernel-model` |

**The gates were proven to fire, not merely observed passing.** RLS was disabled on one table in the
throwaway container: 5 tenancy tests went red and `check-rls` named `app.project` by name. Both were
restored and re-verified immediately.

**Three defects the gates caught during this build:**

1. **SHA-256 padding was wrong at the 55-byte boundary**, where the message plus its marker byte
   plus the 8 length bytes fits a block exactly. The formula appended a whole extra block and
   produced a confidently wrong digest. Caught only because the test vectors included the boundary
   lengths rather than just `abc`. This is the single strongest argument for writing the
   hash-stability test first: every hash stored by the system would have been wrong and nothing
   downstream would have noticed.
2. **The tenancy suite silently skipped all 27 tests.** The `available` flag was set in `beforeAll`,
   but Vitest evaluates `it` vs `it.skip` at collection time, so the flag was always false when the
   suite was built. It reported a green run while testing nothing — the worst possible failure mode
   for exactly these tests. Now probed at module load with top-level await.
3. **`convert()` double-counted scale** (recorded in the previous session).

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.

**2026-08-31 — Group A complete (`A-08`, `A-09`, `A-10`)**

| Check | Command | Result |
|---|---|---|
| A-08 authorize + route coverage | `pnpm test` | **PASS.** 23 tests: org and actor_type scoping, 404-not-403, `SERVICE_ENGINE` denied all (I-4), boot-time coverage assertion (AC-06) |
| A-09 DTO leakage | `pnpm test` | **PASS.** 13 tests: forbidden-field constant matches §9.2, recursive walk at every depth, DTOs built field by field (AC-02) |
| A-10 audit chain | `pnpm test` | **PASS.** 12 tests against real Postgres; chain verifies from genesis and **tamper detection proven** by corrupting a row (AC-15) |
| Whole pipeline | `pnpm verify` | **PASS.** 248/248 tests; lint, boundaries, self-test, RLS all green |

**A defect the gate caught:** `appendAuditEvent` first used `SELECT ... FOR UPDATE` to lock the
chain head, but that requires UPDATE privilege, which the append-only application role deliberately
lacks — `permission denied for table audit_event`. Replaced with a transaction-scoped advisory lock,
which needs no table privilege and still serializes appends so two writers cannot fork the chain.

**2026-08-31 — Group A complete + Group B started (`A-11`, `B-01`/`B-02`/`B-04`/`B-06`)**

| Check | Command | Result |
|---|---|---|
| A-11 outbox | `pnpm test` | **PASS.** 8 tests against real Postgres; a rolled-back transaction dispatches nothing, claim is exactly-once via `FOR UPDATE SKIP LOCKED`, retry backs off, exhausted attempts dead-letter |
| B-02 catalog extract | `python tools/extract-catalog.py` | **PASS.** 378 rows, 16 families, 21 spans, 7 anomalies, all verbatim; parsed via `ast`, source never executed |
| B-06 lookup | `pnpm test` | **PASS.** 29 tests against **real published data**: on-grid capacities, `AC-08` off-grid brackets, no nearest-match, per-pair basis; `AC-18` approval gate |
| **18-of-21 span claim** | `pnpm test` | **PROVEN** against the actual span grid: exactly 18 of the 21 published spans miss their key under integer mm; all 21 preserved under µm |
| Whole pipeline | `pnpm verify` | **PASS.** 290/290 tests; 100% coverage on all three kernel packages; lint, boundaries, self-test, RLS all green |

**`OD-06` veto window closed.** The blueprint's headline claim — that integer millimetres cannot
represent the published lookup grid — is now proven against the real extracted catalog rather than a
reconstruction. Micrometres stand; the one-file re-base window is closed and the base is correct.

**Group A is complete** — `A-01` through `A-11`, plus `C-01`. Group B has begun with the catalog
migration and the no-interpolation lookup. The next real work is the derivation kernel
(`C-02`..`C-08`): geometry and counts, the twelve checks, the BOM, and the golden fixtures.

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.

**2026-08-31 — earlier the same day (`A-07`)**

| Check | Command | Result |
|---|---|---|
| Fresh-database migrate | `pnpm migrate` from an empty schema | **PASS.** `0001`, `0002`, `0003` applied clean; 18 tables |
| A-07 crypto | `pnpm test` | **PASS.** 13 tests: token entropy, SHA-256, scrypt round-trip, malformed-hash safety, constant-time compare |
| A-07 sessions + invitations | `pnpm test` | **PASS.** 11 tests against real Postgres, incl. `AC-01` and `AC-17` |
| Whole pipeline | `pnpm verify` | **PASS.** 200/200 tests; lint, boundaries, self-test, RLS all green |

**A defect the gate caught during this build:** migration `0003` created the `session` and
`credential` tables but the `GRANT ... ON ALL TABLES` in `0002` only covers tables that existed when
it ran. The application role got `permission denied for table session` — caught by the first session
test, fixed by an explicit grant in `0003`, and proven by resetting the schema and re-migrating from
scratch.

**A second-order issue the run surfaced:** the two integration suites share one Postgres and each
truncates the tables it seeds, so running test files in parallel let one wipe the other's fixture
mid-run. Fixed with `fileParallelism: false`; the pure suites are fast enough that serial files cost
nothing noticeable.

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.




## 5. Canonical flow — is it confirmed?

The brief's flow is **confirmed and fully specified in the blueprint**, with two clarifications
the blueprint adds that the brief's one-line version omits:

```
Project → Draft Revision → Rack Configuration → Version-pinned Catalog + Rule Pack
        → Validation → BOM → Client Preview → Quote Submission → Internal Review
```

- The pins are **two independent artifacts on two clocks** (§10.1): a catalog release and a rule
  pack release, pinned separately, both inside the hashed revision content.
- **BOM comes after submission, not before the client preview.** The client never sees a BOM at
  all (§9.2). The internal takeoff is derived at submit time and lives in a physically separate
  table. The brief's ordering reads as if BOM feeds the client preview; it does not, deliberately.
- Internal review forks into a **separate `C` revision lineage** that cannot write back (§13.5).

## 6. Capability audit against the brief's checklist

| Capability | State | Evidence |
|---|---|---|
| **Fixed-point units with mandatory provenance** | **CONFIRMED IMPLEMENTED** | `packages/kernel-units`, 68 tests, 100% coverage. µm/millipound bases, `BASIS_BOUND`, allocate-never-divide, fail-closed walkers, `VERIFY` display rule |
| **Kernel purity enforcement** | **CONFIRMED IMPLEMENTED** | `tools/check-boundaries.mjs` + self-test proving all 10 violation types are caught |
| **Canonical serialisation and content hashing** | **CONFIRMED IMPLEMENTED** | `packages/kernel-model/canonical.ts` + `sha256.ts`. Hash-stability test written first; 55 tests |
| **Draft vs frozen revisions** | **CONFIRMED IMPLEMENTED at both layers** | `kernel-model/revision.ts` (refusals list every reason, deep freeze) **and** database triggers refusing content change or deletion |
| **Tenant isolation** | **CONFIRMED IMPLEMENTED** | 16 tables with RLS enabled + forced, `withTenant()` transaction-local context, 27 tests against real Postgres, proven to fail when RLS is removed |
| Canonical rack/configuration data model | **PARTIAL** — schema exists, the entity graph does not | `0001_init.sql` has the tables; the typed option/run/bay/level graph is `C-02` |
| Version-pinned catalogs and rule sources | **PARTIAL** — schema and approval gate exist, data not migrated | `catalog_release` with a CHECK enforcing approver ≠ digitiser and a recorded verification path. Data migration is `B-02` |
| Validation findings with source traceability | **PARTIAL** — tables exist, checks do not | `finding` + `finding_internal_detail` split; the 12 checks are `C-04` |
| BOM generation tied to selected revision | **PARTIAL** — schema enforces the hard parts | `bom_line` with `part_revision_id XOR uncatalogued_part_id` and `qty XOR unresolved_reason`. Derivation is `C-05` |
| Audit history | **PARTIAL** — table and append-only enforcement exist | `audit_event` with a trigger refusing UPDATE/DELETE, revoked privileges, and no RLS policy for either. Hash chaining is `A-10` |
| Floor-plan and elevation outputs | **PLANNED ONLY** | `FR-CP-08/09`, display-list + 3 renderers (§6.2) |
| Client options and quote-request submission | **PLANNED ONLY** | `FR-QS-01..06`, §13.1 submit transaction |
| Internal review / quote workflow | **PLANNED ONLY** (MVP-1 partial; quoting is Phase 3) | `FR-IR-01..07`, §3.4 status lifecycle |
| PE disclaimer + external-review workflow | **PLANNED ONLY — text written and version-controlled by design** | §9.3 standing disclaimer, `OD-16` (never a seal, name or licence number) |
| Testing | **CONFIRMED IMPLEMENTED for the kernel and the database layer** | 176 tests, 100% kernel coverage, real-Postgres tenancy suite |
| Build verification | **CONFIRMED IMPLEMENTED.** `pnpm verify` for the product; `src/verify.py` for the docs | Both run this pass, all green |
| Deployment readiness | **PLANNED ONLY** | `OD-01` settled: single-region managed Postgres + Object Lock storage |

Acceptance criteria now partly or fully evidenced: **`AC-04`** (cross-tenant reads empty, writes
refused), **`AC-05`** (every table RLS-enabled, forced, with policies — asserted in CI), **`AC-07`**
(unestablished values never render as numerals, at the formatter), **`AC-10`** (refusals list every
reason), **`AC-11`** (frozen revisions immutable at the database layer), **`AC-13`** (a BOM line is
a quantity or a reason, never both or neither), **`AC-18`** (the catalog approval gate). Each is
evidenced at the layer built so far, not end to end — the routes and applications they ultimately
describe do not exist yet.

## 7. Reusable assets in the four read-only reference projects

Inspected read-only; nothing edited, moved or executed. Full classification in `reuse-register.md`.
The highest-value items, confirmed present on disk this pass:

| Asset | Location | Why it matters |
|---|---|---|
| Interlake beam capacity set — 378 rows, 21 spans, full provenance | `rack-engine\catalog\interlake-2026-08\` | Cross-checked 357/357 by a named person. The most expensive asset in all four trees |
| Frame capacity tables — 3 tables, 435/435 cells reconciled | `rack-app\frame_capacity_published_2025\` | Best-provenanced data anywhere; the model for future ingestion |
| `packages/units` — fixed-point, provenance walkers, 100% branch | `rack-studio\packages\units\` | Port mechanics, re-base `mil` → µm |
| `packages/model/revision.ts` — canonical hashing, lifecycle, deep freeze | `rack-studio\packages\model\` | Refusals list every reason; a refusal is itself an audit event |
| `e2e/mvp.walkthrough.test.ts` — 402 lines, 9 cases, 66 assertions | `rack-studio\e2e\` | The whole flow as an asserted transcript |
| Golden fixtures + `build-reference.mjs` | `rack-studio\fixtures\` | 11 expected values with tolerances — **nothing consumes them today** |
| `model/quantity.py` `BASIS_BOUND`, `checks/*` refusal ordering | `rack-engine\rack_core\` | Basis before number; per-pair capacity refuses conversion |
| `CLAUDE.md` — 12 rules, priority order, status vocabulary | `rack-engine\CLAUDE.md` | Carry verbatim as product policy |

**Do not port:** all of `rack-takeoff`'s rates and `BEAM_CAP` (the file's own banner says they are
not manufacturer data); the seven `QUARANTINED` tables in `rack-app` (one overstates capacity by up
to 72%); `runpy.run_path` catalog loading; the DOM-as-model architecture.

## 8. Known-wrong, contested or unverified — carried forward, not settled

From `HANDOFF.md` §6, and all still open:

1. ~~**Carson fixture headline is contested.**~~ **Resolved 2026-08-31 by owner decision.** The two
   quotes are reference material, not acceptance sources, and are disregarded. As-built drawing
   0005-01 R-1 governs: 916 bays / 6,980 gross / 156 lost / **6,824 net** — the only one of the
   three artifacts whose own breakdown reconciles. `P0-004` closed; the `C-08` fixture will assert
   the breakdown as well as the headline.
2. **59E beam face height: parked 2026-08-31, not settled.** 5.92″ on the 42 catalog rows, 5.928″
   in a docs table, source chart read by EL as **5.93″** — corroborating 5.928 over 5.92. No page
   reference yet, so no figure is promoted; the rows stay at 5.92 as published and all three
   readings sit on the manifest. **Not blocking:** face height is not a lookup key (the key is
   `family + series + span`), so no capacity result depends on it. The original `P0-005` framing
   claimed otherwise and was wrong; see `TODO.md` for the correction.
3. **Seven quarantined capacity tables** in `rack-app` are proven wrong. Do not port.
4. **Every rate in `rack-takeoff` is uncited**, by its own admission.
5. **Performance figures came from software rasterization in a cloud container.** A floor, not a
   measurement. Re-run on target hardware.
6. **Six source conflicts stay open** (§10.8): MH16.1 edition, the NFPA section for the 18-inch
   rule, aisle measurement convention, max row length, dock setback, dead-load basis. None block
   MVP-1 because MVP-1 makes no compliance claim.

## 9. Structural gaps

Found in the review pass. Resolved items keep their entry so the record shows what was fixed.

- ~~**No version control.**~~ **Resolved.** git initialised, 3 commits, LF normalised via
  `.gitattributes` so the byte-identical rebuild guarantee survives a Windows checkout.
- ~~**No repository scaffold.**~~ **Resolved.** `A-01` landed: workspace, strict TypeScript,
  vitest, eslint, CI.
- ~~**Folder name mismatch.**~~ **Resolved.** `READFIRST.md` removed; one canonical path.
- **`verify-visual.py` has never been run** — `P0-003`, still open.
- **CI has never run on a real runner.** The workflow is written but unexercised; it will first be
  proven when this repository gets a remote.
- **The golden fixtures in `rack-studio` are still unconsumed**, exactly as the reuse register
  warns. `P1-014` requires them wired into the test run so the defect is not inherited.
- **The 18-of-21 span figure cannot yet be asserted** because the real published span list is not
  in this repository. It becomes assertable at `B-02`. Recorded in the test.

## 10. Honest assessment

The planning is unusually strong, and the foundation now matches it. The kernel is pure, fully
covered, and its purity is enforced by a checker that has been proven to fire. The two structural
decisions the blueprint singles out — BOM lines referencing a part *revision*, and fully
deterministic derivation — are respected from the first file: the eslint config bans `Date.now()`
and `Math.random()`, and the boundary checker independently bans clock, filesystem, network and
environment access inside the kernel.

Two things are worth stating plainly.

**What is built is narrow.** `kernel-units` is one package of the eight in the blueprint's kernel,
and everything with tenancy, authorization or persistence in it — the layers that carry the actual
commercial risk — is untouched. The 100% coverage figure means the units package is thoroughly
tested; it does not mean the product is 100% anything.

**The gates earn their keep.** Two real defects surfaced during this build, one an arithmetic bug in
`convert()` and one a borrowed number asserted against invented data. The second is the more
interesting: it is precisely the failure the product exists to prevent, and it appeared in the first
hour of writing code by someone who had just read the document forbidding it. That is the argument
for keeping the checks mechanical rather than relying on discipline.

