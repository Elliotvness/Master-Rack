# Review Findings — `fix/catalog-release-integrity`

Companion to `tasks/review-plan.md` and `tasks/review-todo.md`.
**Severities:** **Critical:** blocks merge · *(no prefix)* required before merge · **Consider:** ·
**Nit:** · **FYI**. Findings are ordered by leverage, not by task.

**Environment.** Reviewed 2026-09-01 against a live Postgres 18.4 (embedded, port 55433, migrations
0001–0006 applied clean). `check-rls` re-run independently: **PASS, 19 tables, 4 sensitivity
columns.** Vitest runs in the Linux workspace against the Windows `node_modules` without the
esbuild/rollup workaround `LATEST.md` §4 describes — that note is now stale.

---

## F-01 — **Critical:** the audience boundary stops at `revision`. Its children leak. *(FIXED — `270631b`)*

**Demonstrated, not argued.** Against the live database, as a client principal of ORG_A:

```
internal revision row visible : 0  (absent, correct — 0005 works)
findings on it visible        : 1  <-- LEAK
leaked: [{"id":"cafe0002-…","code":"INTERNAL-MARGIN-NOTE","severity":"BLOCKER"}]
```

0005 closed `app.revision`. Four tables carrying a `revision_id` foreign key were not closed, and
their SELECT policies still read the generic tenant predicate alone:

| table | policy | predicate |
|---|---|---|
| `assumption` | `assumption_tenant_select` | `organization_id = app.current_org() OR app.is_staff()` |
| `finding` | `finding_tenant_select` | same |
| `submission` | `submission_tenant_select` | same |
| `uncatalogued_part` | `uncatalogued_part_tenant_select` | same |

The mechanism is D-02's, exactly: **a derived internal revision carries the client's own
`organization_id`**, so every child row written against it satisfies the tenant predicate. Suppressing
the parent row while leaving its children readable is the same shape of defect as suppressing the
revision while publishing an audit event that names it — which is what 0006 was written to fix.

`bom_line`, `internal_note` and `finding_internal_detail` are staff-only and are **not** affected.
That is the design working: the *detail* behind a finding is protected. The finding row itself —
its code and severity, e.g. an internal blocker on our own working copy — is not.

**Why no gate caught it.** `check-rls`'s new assertion keys on a table **having** a sensitivity
column. These four tables have none; they inherit their audience from a parent. The checker built to
stop D-02 recurring is structurally unable to see D-02 recurring one join away. That is the more
important half of this finding.

**Latency.** Not exploitable today: `deriveInternalRevision` is a pure function returning a shape,
nothing persists a derived revision's children, and there is no server. It goes live the first time
Phase 3 writes them — at which point nothing in `pnpm verify` will say a word.

**Proposed remedy** — make the existing checker cover them, rather than adding a second checker:

1. `UNIQUE (id, audience)` on `app.revision` (redundant given the PK, which is what makes it free).
2. `audience` column on each of the four children, `NOT NULL`, with a **composite foreign key**
   `(revision_id, audience) REFERENCES app.revision (id, audience)`. Divergence from the parent then
   becomes impossible at the database rather than by convention — the same argument `0001` already
   makes for denormalising `organization_id` onto every child.
3. Their four policies gain `AND audience = 'client'`, matching 0005 exactly.
4. `check-rls` then covers all five tables with no new rule, because they now carry the column.

**Alternatives considered and rejected:** a `revision_is_client_visible(uuid)` STABLE function in each
child policy (a function call per row, and it re-centralises rather than removes the problem); an
`EXISTS` subquery per policy (same cost, and the predicate stops being readable).

**Decision needed:** fix on this branch, or file as a task and merge with the hole recorded. Filing is
defensible — nothing writes these rows yet — but the branch must not be described as having closed
the audience boundary until it is done.

---

## F-02 — **Critical:** the approval gate does not enforce the draw it pinned *(FIXED — `540f4cd`)*

`approvalRefusals()` returns **`[]`** — the release is approvable — for a manifest whose recorded
spot-check cells are `TOTALLY/FAKE/CELL-0` … `TOTALLY/FAKE/CELL-19`. Reproduced against the real
`interlake-2026-09` manifest:

```
REFUSALS WITH FABRICATED CELLS: []
```

The fabrication kept only what the gate checks: the right *count* (20 beams, 22 frames), the right
seed, unique ids, a non-empty page ref, `outcome: 'MATCHED'`, and `checked_by ≠ digitised_by`. Every
cell id was invented. `spotCheckRefusals` never calls `drawSpotCheckSample`, so the seed it insists
on recording is never used for anything, and the cells are never checked against the dataset either —
ids that exist in no file at all pass.

This is **D-07's own failure mode, one layer up.** D-07 was "the two-person rule is satisfied by a
machine checking its own work." The fix requires the approver's own recorded reading of cells the
tool drew. The record can be written without the tool, without the source, and without reading a
cell. `52f708a`'s entire purpose is the thing that does not hold.

`release-integrity.test.ts:205` ("the pinned draw matches what the tool draws for that seed") does
bind the *currently pinned* draw to the kernel. That is a test over today's data file. It is not the
gate, and it does not run when a manifest is approved.

**Proposed remedy.** The identity check needs the dataset's cell ids, which a pure function in
`release.ts` does not have. So:

- `spotCheckRefusals` gains a required `cellIds: readonly string[]` parameter and asserts
  `sampledCells` deep-equals `drawSpotCheckSample(cellIds, seed, requiredSampleSize(cells))`, in
  order — the draw records the order for exactly this reason.
- `approvalRefusals` takes a `datasetCells: ReadonlyMap<string, readonly string[]>` and passes each
  dataset's ids through. A dataset with no entry is a refusal, not a skip.
- The caller (`release-integrity.test.ts` today, `apps/api` later) supplies them from the loaded
  datasets. The package stays pure — the ids are data, not I/O.
- `check.cells` is asserted equal to `cellIds.length`, so a shrunken `cells` cannot shrink the
  required sample.

**Regression test to write with the fix:** the probe above, inverted — fabricated cells at the right
count must produce a refusal naming the dataset. Record it failing before the fix lands.

---

## F-03 — the `actor_type = 'client'` half of 0006 is untested *(FIXED — `e6b4784`)*

Removed the clause from the live policy, leaving `actor_organization_id = app.current_org() OR
app.is_staff()`. **All 35 tenancy tests pass.**

The migration argues the point at length in its own comment — "the second is not redundant.
SERVICE_ENGINE writes derived outputs and audit events, and a service principal acting inside a
client organization is not that organization's own action either" — and nothing proves it. A future
hand simplifying the predicate to one clause gets a green suite.

For contrast, 0005 **is** properly tested: reverting `revision_audience_select` to the generic tenant
predicate fails 2 of 35, at `tenancy.test.ts:251`. That is what a test of a fix looks like.

**Remedy:** a test in the AC-14 audit-log block that writes an audit event with
`actor_organization_id = ORG_A` and `actor_type = 'service'`, and asserts a client principal of ORG_A
cannot read it.

---

## F-04 — `actor_organization_id` is nullable with nothing tying it to `actor_type` *(FIXED — `e6b4784`, migration 0007)*

```
actor_type              NO   (NOT NULL)   ✓
actor_organization_id   YES  (nullable)
```

`app.audit_event` carries no CHECK constraints at all. The 0006 predicate compares a nullable column,
so a client-actor event written without an actor organization yields NULL, not false, and is
invisible to every client principal — including the organization whose action it records.

It **fails closed**, so this is not a leak. It is a silent hole in a client's own audit trail, and
0002's own comment names why that matters: "RLS fails silently … application predicates fail loudly."
Here both halves are silent.

**Remedy:** `ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_client_actor_has_org
CHECK (actor_type <> 'client' OR actor_organization_id IS NOT NULL);`

---

## F-05 — **FYI** `audit_event_subject_org_idx` no longer serves the SELECT policy

`(subject_organization_id, sequence)` was built for the predicate 0006 replaced. The new policy reads
`(actor_organization_id, actor_type)`, which `audit_event_actor_org_idx` now covers. Keep the old
index only if staff-side queries filter by subject organization; drop it otherwise. Worth a sentence
in the migration, not a change on this branch.

---

## F-06 — the missing self-test, now written *(R-03, fixed on this branch)*

`check-rls` gained a real control in 0005 and shipped with no self-test, in a repository where every
other checker has one and `pnpm verify` runs the self-test **first**. That ordering is not ceremony:
a checker that silently stops working reports a clean pass forever, which is worse than no checker,
because the build stays green while the invariant rots.

Fixed here rather than filed, because it is an hour and it guards the control that found F-01's
sibling:

- `sensitivityViolations()` extracted from `main()` in `tools/check-rls.mjs` and **exported pure** —
  the shape every other checker in `tools/` already has, and the reason `selftest-boundaries` can
  import `checkBoundaries`.
- `check-rls.mjs` gained the same `import.meta.url` entry-point guard as `check-boundaries.mjs`.
  Without it, importing the module opened a database connection, so the self-test needed the very
  Postgres it exists to avoid depending on.
- **New:** a stale-exemption assertion. `SENSITIVITY_EXEMPTIONS` naming a table/column that no longer
  exists is now a violation. A justification for a dropped column is not evidence about the schema as
  it stands, and it was being honoured silently.
- `tools/selftest-rls.mjs`, seven cases, no database: D-02's own shape, D-06's own shape, a
  sensitivity column on a table with no policies, a substring near-miss (`audience_id` must not count
  as `audience`), a stale exemption — all must go **red**; the WITH-CHECK-only case and the schema as
  0005/0006 leave it must stay **green**, because a checker that fails on everything is no more use
  than one that fails on nothing.
- Wired into `verify` as `check:rls:selftest`, ahead of `check:rls`, matching every sibling.

```
selftest-rls: PASS — 7 cases.
check-rls: inspected 19 table(s) in schema "app", 4 sensitivity column(s).
check-rls: PASS
```

**Still open, and it is F-01's real remedy:** the assertion keys on a table *having* a sensitivity
column, so it cannot see a table that inherits its audience through a foreign key. The self-test now
locks in the behaviour that exists; it does not widen it.

---

## F-07 — a test name that promised more than its body delivered *(FIXED — `540f4cd`)*

`release-integrity.test.ts` carried a test called **"the pinned draw matches what the tool draws for
that seed"** whose body asserted only that the sample was the right SIZE. Nothing compared a cell.

This is most of why F-02 survived. Anyone auditing the test list — including the author of the gate —
would read that name as coverage of the draw's identity, and write the gate to match what they
believed was already proven. A name that overstates its body is worse than a missing test: a missing
test is visibly missing.

It now derives the ids and compares the pinned cells to `drawSpotCheckSample`, and it passes: the pin
in `interlake-2026-09` is a genuine draw at seed 20260901.

---

## F-08 — the 100% coverage rule has not been enforced by anything *(FIXED — `c6f603e`)*

`pnpm verify` runs `pnpm test`, not `pnpm coverage`. `ci.yml` **does** have a "Kernel coverage gate"
step — and CI has never executed, because there is still no remote (`T-00`). So blueprint §16.1's
rule that every pure package sits at 100% has been unchecked since the packages were written.

It was not holding. `kernel-catalog` measured **90.9% lines**: `load-manifest.ts` at 60% and
`spot-check.ts` at 89%, both added by this branch. **The branch would have failed CI on its first
push**, on a gate nobody could see.

Fixed by writing the two missing test files — `spot-check.test.ts` (18) and `load-manifest.test.ts`
(28), for the two modules that shipped without one — and adding `pnpm coverage` to `verify` so it
matches what CI already runs. kernel-catalog is back to 100% on all four measures across its ten
files.

One branch was **deleted rather than tested**: `strays[0] ?? ''` inside a `strays.length > 0` guard is
unreachable. Destructuring the first stray turns two branches into one that the tests exercise.

**Limit, stated plainly:** a full-repo coverage run exceeds this workspace's 180-second shell limit,
so only `kernel-catalog` has been measured. Whether the other nine packages still meet their
thresholds is exactly what `T-00`'s first green CI run is for.

**Executed 2026-09-01 (R-09):** `pnpm coverage` ran to completion (31s, 974 passed / 67 skipped).
`kernel-catalog` measured **100% statements / 100% branches / 100% functions / 100% lines** across
all ten files — the F-08 gate holds. The run's only failures were the DB-backed layers
(`apps/api/src/auth/**`, `apps/api/src/audit/**`, `apps/api/src/outbox/**`, `packages/db/src/**`),
which sit below threshold **only because their tests skip without a migrated Postgres** — CI's
Postgres service is what measures them. The first real CI run (PR #1, 2026-09-01) died in
`pnpm/action-setup@v4` before a single test executed: `version: 11` in `ci.yml` conflicted with
`"packageManager": "pnpm@11.22.0"` in `package.json`. Fixed by deleting the `version` key so the
action reads `packageManager` (`2ffd173`).

---

## F-09 — **FYI** the recorded file count was wrong

`LATEST.md` records "961 tests / 42 files". The branch tip carried **40** test files
(`git ls-tree -r 0b9fd73`). The current tree carries 43 and **1042 tests, all passing**, DB-backed
included. The test count is plausible; the file count was not. Corrected under R-11.

---

## Confirmed sound — recorded so the review is not re-run

These were checked and are correct. Listed because "we looked and it held" is a review output too.

- **Policy names.** `revision_tenant_{select,insert,update,delete}` are exactly what 0002's
  `format('%1$I_tenant_select', 'revision')` generates. The `DROP POLICY IF EXISTS` names match, so
  none of the wide policies survived to be OR-ed with the new ones. Verified against `pg_policy` on
  the live database: `app.revision` carries **four** policies, all `revision_audience_*`.
- **All four commands, both clauses.** `SELECT`/`INSERT`/`UPDATE`/`DELETE` present; `UPDATE` carries
  both `USING` and `WITH CHECK`, so a client cannot flip its own revision to `audience='internal'`.
- **Enum, not free text.** The predicate renders as `audience = 'client'::app.audience`. There is no
  string to misspell into a passing comparison.
- **No re-widening at the policy layer.** No other table's policy expression mentions `revision` in
  a subquery. (The leak in F-01 is by FK, not by predicate — which is why this check was not enough.)
- **Index.** `revision_audience_idx (organization_id, audience)` matches the new predicate's leading
  columns; the change costs nothing on the read path.
- **`stripInternalRevisions` was kept**, at `apps/internal-web/src/lib/queue.ts:211`. Two independent
  controls, as designed — one quiet, one loud.
- **`check-rls` PASS re-run independently**: 19 tables, 4 sensitivity columns
  (`app_user.actor_type`, `audit_event.actor_type`, `revision.audience`, `session.actor_type`); the
  two exemptions cover the two `app_user`/`session` cases and are consistent with staff living in
  their own organization.

---

# Phase C/D — R-08 and R-10, reviewed 2026-09-01 (session 3)

**Environment.** Reviewed from the Linux bridge shell against the working tree at `ab390d5`.
Every figure below was re-derived here with `git` and a Python read of the JSON — deliberately
**not** by reading the tests that assert the same things. The one thing that could not be run here
is the vitest suite: this repo's `node_modules` is a Windows pnpm store, so `rollup` and `esbuild`
have no Linux binaries. Installing the two Linux binaries into scratch got past `rollup` and then
hit `esbuild`; the attempt was abandoned rather than pursued, and nothing was written into the
repository. CI covers it instead — see the disposition on each task.

## F-12 — `changes_from_2026_08` denies a change it made to 168 rows

**Required before merge. The data is right; the change log is wrong about it.**

`data/catalog/interlake-2026-09/manifest.json`, `changes_from_2026_08[2]`, states verbatim:

> "No part number, code_18, face height or deflection value was altered. Only capacity was
> re-sourced, and only unpublished rows were removed."

Measured, by diffing the two `beams.json` on the 336 rows the releases share:

| field | rows changed 2026-08 → 2026-09 |
|---|---|
| `capacity_lbs` | **264** — matches the manifest's own claim exactly |
| `face_height_in` | **168** — the manifest says zero |
| `part_number`, `code_18`, `deflection_in` | 0 — as claimed |

The 168 are eight of the sixteen families, every span:

| families | 2026-08 | 2026-09 | published as (p.84) |
|---|---|---|---|
| 36E, 36ER | 3.65 | 3.65625 | 3 21/32 |
| 59E, 59ER | 5.92 | 5.9375 | 5 15/16 |
| 65E, 65ER, 65Q, 65QR | 6.54 | 6.5625 | 6 9/16 |

The other eight families (27E/ER, 40E/ER, 45E/ER, 50E/ER) were already exact and did not move.

**The change itself is correct and is documented — three fields down, in the same file.**
`face_height_59e_status` and `face_height_65_status` both read `disposition: RESOLVED`, resolved by
Elliott Villacorta on 2026-08-31 against p.84, and `face_height_policy` explains why the exact
fraction is stored rather than a rounded value. So this is not a hidden change; it is a change
recorded in one place and **denied in another**, inside one artifact.

That matters more here than it would elsewhere. `changes_from_2026_08` is the field a future reader
consults to learn what moved between two releases — it is the release's own diff, and the reason
2026-08 was allowed to keep its wrong values was precisely so the record of what was believed stays
reconcilable. A change log that under-reports is the same defect as an extract that over-reports.

**Fix:** amend the sentence to name the face-height correction and point at
`face_height_*_status`. Do not touch a single value.

## F-13 — the approved manifest still carries the note saying it is DRAFT

**Required before merge.** `manifest.json` holds, simultaneously:

- `status: "APPROVED"`, `approved_by: "Elliott Villacorta"`, `approved_at: "2026-09-01"`; and
- `approval_record`: "*Returned to DRAFT 2026-09-01 after approval … the release is DRAFT until
  that cell is read and the record re-made.*"

The cell **was** read — `65ER/F5M/78in` is in `human_spot_checks[beams].supplementary_cells` with
`outcome: MATCHED`, `checked_by: Elliott Villacorta` — so the release is legitimately approved and
the narrative is simply stale. But `approval_record` is prose inside the artifact that gates
pinning, and it currently contradicts the field one line above it. A reader who trusts the prose
concludes the release cannot be pinned.

**Fix:** rewrite `approval_record` to describe the whole arc — approved, returned to DRAFT on the
19-distinct-values finding, topped up, re-approved — in the past tense.

## F-14 — WITHDRAWN as filed, and replaced by the narrower finding underneath it

**What I filed:** that `pending_spot_checks` and `human_spot_checks` are "two records of one fact",
citing the codebase's own line about how such pairs come to disagree.

**Why that was wrong.** They are not two records of one fact. They are the **question and the
answer**, and the code says so in as many words. `tools/record-spot-check.mjs`, at the point where it
would have been easiest to delete the pin:

> "The pinned draw stays in the file. It is the record of what was ASKED, and removing it once
> answered would delete the evidence that the sample was fixed before it was read."

And `tools/draw-spot-check.mjs` refuses to redraw while a pin exists — "a sample that can be redrawn
until it is convenient is not a random sample." The duplicated `sampled_cells` is not redundancy; it
is what makes the pairing auditable. Deleting either half destroys the property the two-person rule
depends on.

I pattern-matched a shape without reading the mechanism — which is the same error as the session-2
drift item that would have edited 23 routes down to 20 to make a document agree with the code.
Recorded rather than quietly dropped, because a withdrawn finding is evidence about the reviewer.

**The real finding, which survives.** The design's whole value is that the answer covers the
question, and **nothing asserted it.** `approveRelease` reads only `human_spot_checks`
(`release.ts:243`); it never compares them. A recorder bug, a rebase or a hand-edit could leave a
signature over a *different* set of cells from the one that was pinned, and every existing gate
would still pass — a named person's signature attached to a sample nobody drew.

**Closed:**

- `tools/check-spot-check-record.mjs` compares every signed record against its pin: the sampled
  cells **in order** (the draw is ordered evidence), the supplementary cells, the seed and the
  population size. A record with no pin behind it is a failure. A pin with no record yet is not —
  that is merely unread.
- `tools/selftest-spot-check-record.mjs` — **10 cases**, run first: a different cell, a *reordered*
  list, a dropped cell, a changed supplementary cell, a changed seed, a changed population size, an
  unpinned signature, an unread pin, and a refusal to report a clean pass over an empty set.
- **Proven to fire against the real release**: one drawn cell in `interlake-2026-09`'s signed record
  swapped for a different *real* row, checker went red printing both lists side by side, reverted.
- Wired into `pnpm verify` and CI, self-test first.

## F-15 — the E/ER collision is the shape of the whole chart, not a 59E quirk

**Required before merge — it changes what the gate should draw over.**

`approval_record` explains the 20-cells-but-19-readings finding as a property of one column:
"*PSG 2025 p.88 prints one column headed 59E / 59ER and the extract carries two rows for it.*"

Measured across the whole dataset: **every** family behaves that way.

| base family | spans where E and ER carry an identical (series, span, capacity) |
|---|---|
| 27E/27ER, 36E/36ER, 40E/40ER, 45E/45ER, 50E/50ER, 59E/59ER, 65E/65ER, 65Q/65QR | **21 of 21, all eight pairs** |

336 rows carry **168 distinct published capacity values**. Within a pair the rows differ only in
`part_number` and one character of `code_18`; capacity, deflection and face height are identical
(e.g. 59E and 59ER at 120" are both 7,330 lb, 0.67", 5.9375").

Three consequences:

1. **The narrative understates it.** As written, a reader takes 59E/59ER for an anomaly. It is the
   structure of the chart: the guide prints one column per E/ER pair throughout.
2. **The top-up is the normal case, not the exception.** A uniform draw of 20 rows over 168 pairs
   yields fewer than 20 distinct values far more often than not — the expected count is about
   18.9. The current gate is *correct* (it counts distinct published values and tops up), but its
   shape implies a rare correction. **The sampler should draw over distinct published values in the
   first place**, and record which row of the pair was read. Otherwise every future release repeats
   this session: draw, fail the floor, top up, re-approve.
3. **`verification_paths[beams].cells = 336` counts rows, not readings.** The full cross-check
   re-derived 336 rows from a chart printing 168 values, so each published value was checked twice
   by construction. The number is not false, but it reports twice the independent evidence that was
   obtained — the same class of overstatement F-11 found in the spot-check floor, one level up.
   State it as "336 rows / 168 distinct published values".

## F-16 — "byte-for-byte" describes more than the mechanism does

**Nit.** `frames.json`'s `carried_forward_from` and the test name both say the frame tables were
carried forward "byte-for-byte". The mechanism is
`sha256(JSON.stringify(JSON.parse(file).tables))` — structural equality **after parse**. Reformat
either file, reorder nothing, and the check stays green; the files are in fact *not* byte-identical
(2026-09 adds `carried_forward_from` and `tables_sha256`, drops `status`/`approved_*`, and changes
`rev`).

Testing meaning rather than whitespace is the better choice. Only the word was wrong.

**Fixed.** The test is now named *"carried the frame tables forward from 2026-08 unchanged after
parse"*, and `carried_forward_from` says "IDENTICAL AFTER PARSE, asserted by a SHA-256 over the
tables array — not byte-identical, which this file plainly is not", and names the consequence:
**because the assertion parses first, reformatting either file leaves it green.**

That consequence is not hypothetical. While making this very edit I rewrote `frames.json` with a
different indent and produced an 841-line reformat that **every gate passed** — the tables hash was
unchanged, because it is computed after parse. Restored to one changed line. A data file's
formatting is part of its reviewability even when nothing asserts it.

**Independently confirmed, for the record:** the `tables` arrays are structurally equal, and
recomputing the stored hash here by the same method reproduces
`8895b30674682bc6087c906378d2e2824452bf3c13ea23411d7caa4b57908c8f` exactly. The hash is real and
reproducible outside the codebase.

## F-17 — one commit subject stops mid-clause

**Nit.** `36881f3` — *"review: Phase A findings, and the self-test check-rls shipped without"*.
Shipped without **what**? It is the one subject on the branch that fails the standalone-and-
informative bar the other 35 clear. Not worth rewriting history for; recorded so the pattern is not
repeated.

## F-18 — the commit type vocabulary is undocumented and overlapping

**Nit.** The branch uses `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `perf` — conventional — plus
`tools:`, `catalog:` and `review:`, which are this project's own, and one commit (`a5d9c5b`) that
uses a task id, `T-00:`, as its type. `tools:` and `chore:` overlap in practice: `6f05043` adds a
checker under `tools:` while `e488a14` edits a comment under `chore(authz):`.

The extra types are *good* — `catalog:` and `review:` name things this project genuinely does. They
are just written down nowhere, so the next contributor will guess. **Fix:** one short section in
`CONTRIBUTING` or the plan listing the seven conventional types plus the three local ones, and
saying task ids go in the body, not the type.

## F-19 — `content_sha256` had no verifier, and its method changed between releases without saying so

**Found while answering "is it safe to edit an approved manifest?" — the answer was yes, and this
was underneath it.**

Every catalog manifest records a `content_sha256`. Nothing recomputed it. `load-manifest.ts:179`
reads it with `str(m, 'content_sha256')` — an opaque string — and the only assertion on it,
`release-integrity.test.ts:132`, pins the **2026-08** value against a hard-coded literal. That
assertion is worth keeping: it proves the quarantine commit did not alter the data. It says nothing
about whether the hash *describes* the data.

Worse, the two releases in the same directory use two different definitions of the field:

| release | method | recomputes to the stored value? |
|---|---|---|
| `interlake-2026-09` | `sha256` of the canonical `rows` array — `json.dumps(rows, sort_keys=True, separators=(',',':'))`, per `tools/build-2026-09-manifest.py` | yes |
| `interlake-2026-08` | `sha256` of the **file text** with the trailing newline stripped, per `tools/extract-catalog.py` | yes |

Cross-applied, they disagree. One field name, two definitions, no verifier, and the method stated
nowhere — the shape of F-02, F-08 and F-11 again, this time in the field whose entire job is
integrity.

**And the 2026-09 digest is not implementation-independent.** `beams.json` carries
`"face_height_in": 4.0` for the whole-number families. Python keeps the float and writes `4.0`;
every other JSON implementation parses it to `4` and writes `4`. One character, a different digest,
identical data. The stored hash is reproducible only by something that preserves the original
numeric literal.

**Closed, mechanically:**

- Each manifest now declares `content_sha256_method` as `{ id, note }`, with the caveat above
  recorded in the 2026-09 note.
- `tools/check-content-hash.mjs` recomputes by the declared id and **fails closed**: a manifest with
  no declared method, an unimplemented method, or a missing hash is a failure, never a skip. It
  preserves numeric literals through Node 22's source-preserving reviver, and throws rather than
  hashing a normalised form if the runtime cannot.
- `tools/selftest-content-hash.mjs` — **11 cases**, run before the checker: the honest pair under
  both methods; the two methods proven to disagree on identical data; a hash computed by the *other*
  method caught; one changed capacity value red; the `4.0`-vs-`4` trap; all three fail-closed cases;
  a vacuous empty-set pass refused; the bare-string method form accepted.
- **Proven to fire against the real release**, not only fixtures: one character changed in
  `interlake-2026-09`'s stored hash, `check-content-hash` went red naming both digests, reverted.
- Wired into `pnpm verify` and CI, self-test first.

**Fixture handling, deliberately different from the other checkers.** This self-test writes to the
OS temp directory. The others write probe files into the working tree and delete them at the end,
which on 2026-09-01 stranded four `__*_probe__` folders on a mount that forbids deletion and made
`check-boundaries` report a **false FAIL against its own leftover fixture**. Worth retrofitting to
the others.

**Left for the approver, not done here.** Re-basing the 2026-09 digest onto an
implementation-independent canonical form would change a field on an **APPROVED** release. The
checker records and verifies what is there; changing it is EL's call.

## F-20 — the register the client is SHOWN and the register that gets RECORDED are two lists, tied by nothing

Raised by the adversarial review of T-06 (2026-09-01, session 4), and **not fixed there** — T-06's
AC-5 states the refusal "already is" in place and scopes the task to making the *recording* real.

There are two representations of an assumption in the client bundle:

- `groupFindings(...).assumptions` — `ClientFinding[]` of severity `ASSUMPTION`, from the rule
  engine. This is what a client screen displays.
- `Derivation.assumptions` — `Assumption[]`, the §11.6 register, produced by `effects.rederive`
  inside `submit`.

`submitRefusals` gates on `input.assumptionsAcknowledged`, a client-supplied **boolean**, against
`derivation.assumptions`. Nothing compares the two lists, and no code derives one from the other. So
a client can tick a box against the list it saw and have a **different** list recorded against its
name, and every control added by T-06 passes: the acknowledgement is recorded, the audit event is
written, the keys are covered — of the register nobody was shown.

The recording is now real. What it is a recording *of* is still unpinned.

**Remedy, when the surface that shows the register exists (Phase 4, or T-07 when the orchestration
moves):** replace `assumptionsAcknowledged: boolean` with the keys the client acknowledged, and
refuse when the acknowledged set and the re-derived register disagree. A boolean cannot carry which
register it was ticked against; a key list can.

## F-21 — `vitest.alias.ts` names a checker that does not exist

The recurring shape again — a control that states its own method with no mechanism behind it.

`vitest.alias.ts` line 6: the alias table *"must agree with `paths` in tsconfig.base.json and with the
bundler config when apps exist, and tools/check-aliases.mjs asserts that three-way agreement."*
`ls tools/check-aliases.mjs` → **No such file or directory**. Verified 2026-09-01. Nothing asserts
the agreement; the sentence asserting it is the only thing there.

The cost is not theoretical: an alias present in `vitest.alias.ts` and absent from
`tsconfig.base.json` gives green tests and a red build, and the reverse gives a green build and tests
that resolve a different file than the one shipping.

**Remedy:** either write `tools/check-aliases.mjs` with a self-test and wire it into `verify` and CI,
or delete the claim. Writing it is cheap — the three sources are three files in the repo root.

## F-22 — **FYI** the shared contracts barrel now reaches `client-web`, and `check-app-boundaries` has no rule about it

T-06 made `apps/client-web` a dependant of `@rms/contracts` for the first time, to share the §11.6
`Assumption` record with `apps/internal-web`. That barrel also exports `FORBIDDEN_CLIENT_FIELDS` —
the internal-schema field-name blocklist (`cost`, `margin`, `supplier`, `buy_price`, …).

Today there is no leak: `submit.ts` imports it as `import type`, which a bundler erases, and the
blocklist is a list of *names to refuse*, not internal data. The observation worth recording is that
`RULES` in `tools/check-app-boundaries.mjs` has no entry for `@rms/contracts`, so the next
**value** import from that barrel into the client bundle ships the list with nothing objecting.

**Remedy, cheap and worth doing before T-13b adds more to the barrel:** either move
`forbidden-fields` behind its own entry point that the client rule forbids, or add a rule that
`client-web` may import `@rms/contracts` for types only.

## F-23 — a symbol-level rule that six two-line files walked past *(raised and fixed in T-07)*

Recorded because the SHAPE recurs, not because it is open.

T-07 added `check-app-boundaries`'s first symbol rule: the client bundle may not export or import
`submit`, `freeze`, `derive*` or `strip*`. It was written against brace clauses and declarations. An
adversarial review put `submit` into the client bundle in **two lines**, with both the checker and
`tsc` reporting success:

```ts
import * as wf from '@rms/workflow';
export const driveSubmission = wf.submit;
```

Five more followed: `wf['submit']`, a destructured namespace, `const submit = …; export default
submit;`, `module.exports = { submit }`, and the same forbidden source in a `.jsx`, `.cts` or `.cjs`
file — three extensions the scan's own file filter did not list.

**The lesson is not "regexes are hard".** The eight self-test cases written alongside the rule were
real tests: remove the rule and they go red. But every one of them was a brace-clause or declaration
form. **The self-test tested the regexes that were written, not the rule that was stated** — which is
this project's recurring defect wearing its most convincing disguise, because the control does fire,
and fires on exactly the cases its author imagined.

**Fixed:** namespace imports and CommonJS are refused outright in a restricted app (a namespace
import binds every symbol under one name, so no symbol-level rule can see through it); top-level
bindings of a forbidden name are caught whether exported or not; the scan reads seven extensions.
20 violation types, 9 legal forms, and the extension list itself proven.

**Carry forward:** when a control's self-test is written by the same person in the same hour as the
control, the cases it contains are the cases the control already handles. The check that pays is
someone else trying to get past it.

## F-24 — three writes that matched no row and reported success *(raised and fixed in T-07)*

`apps/api/src/workflow/submit-effects.ts`, as first written: `freezeRevision`'s `UPDATE … WHERE id`,
`persistDerived`'s `INSERT … SELECT … WHERE r.id`, and `createSubmission`'s `INSERT … SELECT …
WHERE r.id` all wrote with a predicate that can match nothing, and none of the three looked at
`rowCount`.

Demonstrated against the live database with a revision id that does not exist: `submit()` **resolved
with all nine steps complete**, and the transaction **committed** two audit events asserting that a
revision was frozen and a submission created, plus three outbox messages instructing a worker to
generate a PDF and notify a client about a submission that was never written.

This is the project's own named shape — *a reproducible wrong answer is invisible to every gate that
only checks reproducibility*. Every gate passed. **Fixed:** every write asserts exactly one row.

## F-25 — a reconciliation that proved its fixture *(raised and fixed in T-07)*

Step 8 of the submit transaction was written to check that every audit event the workflow claims is
actually in the chain. It compared **action name only** (`WHERE action = $1`), so after the first
submission there is always a `revision.frozen` row and a transaction that froze a revision while
skipping its event still passed.

It had a test, and the test went red on demand — because the fixture `TRUNCATE`s `app.audit_event`
before every case. **The control was only ever exercised against an empty table, a state production
occupies exactly once.** A green test proving a fixture is worse than no test, because it retires the
question.

**Fixed:** the reconciliation is by **event id** — a primary key the transaction generated, which no
pre-existing row can satisfy — with counts compared in both directions, and the test now performs a
real submission first so the chain is populated when the sabotage runs.

## F-26 — the determinism corpus digested the literal string `"undefined"` *(raised and fixed in T-27)*

`tools/determinism/corpus.test.ts`, case **`units`**, built its digest from:

```
String(convert(inches(132), 'ft').value)
String(convert(inches(1),   'mm').value)
```

`convert(q, to)` returns a **`number`** (`packages/kernel-units/src/quantity.ts:145`), and `.value`
on a number primitive is `undefined`. Confirmed at runtime before anything was changed, not inferred
from the type error — the string actually being hashed was:

```
undefined|undefined|3812|2451100|3175
```

The two **conversions** — the only conversions in a case named *"unit conversion and formatting"* —
contributed nothing. `check:determinism` runs the corpus in two hostile environments and pins the
digest in `fixtures/determinism/digests.txt`, and **none of that machinery would have gone red if
`convert()` had started returning a different number.** The control ran in CI, passed, and did not
cover the thing it is named for.

This is the recurring shape once more — *a control that states its own method and has no mechanism
behind it* — and it survived because **no test file in this repository had ever been type-checked.**
It is the first thing T-27 found, and the argument for T-27 having gone first.

**Fixed.** The `.value` accesses are removed, the case now digests `11|25.4|3812|2451100|3175`, and
the `units` pin was re-based with `--update`. Only that one line of the pin moved; `bom`,
`content-hash` and `positions` are unchanged, which is the correct blast radius for a change confined
to the units case. A digest pinned over `"undefined"` was never a baseline.

## F-27 — `stripInternalRevisions` cannot be called with the shapes its own tests describe *(raised in T-27, FIXED in T-08)*

`stripInternalRevisions<T extends { readonly clientVisible?: boolean }>` enforces **AC-14** — an
internal revision is *absent* from client responses, not locked. Type-checking its test file for the
first time showed it refuses two shapes it handles perfectly well at runtime:

1. **Present-but-undefined.** `{ id: 'p1', clientVisible: undefined }` is rejected under
   `exactOptionalPropertyTypes`. That is exactly the shape a row read back from Postgres with a NULL
   column produces.
2. **Absent entirely.** `{ readonly clientVisible?: boolean }` is a **weak type** — every property
   optional — so TypeScript refuses an object literal sharing no property with it.
   `stripInternalRevisions([{ id: 'p1' }])` does not compile, and *"keeps items that carry no
   visibility marker"* is the name of one of its own tests.

**Why this matters more than a type nit.** A caller wiring real rows into AC-14's enforcement point
hits both of these, and the path of least resistance is a cast. A cast around the function that
decides what a client may see is how the control silently stops applying — and nothing would go red.

**FIXED in T-08, 2026-09-02, as the second of two commits** — the move first, then this, so the
move's diff stayed reviewable as location-only.

The remedy turned out **not** to be `clientVisible?: boolean | undefined`, which fixes the first
shape and not the second: a constraint with every property optional stays a weak type, and the bare
object literal still would not compile. The constraint is now **`T extends object`**, with the
marker read through an `in` narrowing so the implementation needs no cast either.

Written test-first, and **the gate T-27 added is what caught it**: two cases using the bare shapes,
no annotation and no cast, went in before the fix — `tsc -p tsconfig.tests.json` **exit 2**, four
errors; after the fix, **exit 0**. Behaviour is unchanged: an item is internal only when it carries
the marker and the marker is exactly `false`.

**The control was re-proven against the rewritten implementation**, because a passing test after a
rewrite proves nothing: internal-items-kept goes **4 red** (up from 3 — the two new cases made it
stronger), and inverting the membership test so *absent* counts as internal goes 3 red.

## F-28 — the units case still does not test what its comment claims *(raised in T-27, open)*

With F-26 fixed, the `units` case digests real numbers. Its comment still says:

> Formatting is where a locale leak shows up first: a tr-TR `toLocaleString` renders 1.5 as "1,5",
> and a digest over the **formatted string** catches it where a digest over the raw number never
> would.

But `String(11)` is not locale-sensitive; it is the raw number. The case digests raw values and calls
them formatted. The claim is not backed by the mechanism — a smaller instance of the same shape as
F-26, left standing rather than fixed inside T-27.

Two honest options, neither of them T-27's to take: route the case through `kernel-units`'
`format`/`displayText` so a locale leak genuinely shows, or delete the locale sentence and let the
case be what it is, a digest over derived numbers. Note that `check-determinism`'s own header already
records that **locale hostility was attempted and removed** because Node ignores `LANG`/`LC_ALL` on
Windows — so the first option needs the locale to be forced in-process, not by environment.
**Owner: E-09 / T-23.**

## F-29 — with no database, the DB suites skip and `pnpm test` reports a green 1,042 *(raised in T-28, open)*

Found while proving T-28, not by looking for it. The container's Postgres stopped between two runs,
and `pnpm test` reported:

```
Test Files  44 passed | 3 skipped (47)
     Tests  1042 passed | 84 skipped (1126)
```

**1,042 is the exact figure this repository spent two sessions correcting.** It is what the suite
reports when the entire database layer is absent — tenancy, auth, audit chain, outbox, submit
effects — because each of those suites calls `describe.skip` with a console note rather than failing:

```
SKIPPING tenancy tests: no migrated database at postgresql://…/rms
```

**The build was safe, and the reason matters.** `pnpm verify` went red — the coverage gate cannot
meet its floors with those suites absent, so the run failed at exit 1. The control held. But the
control that held was **coverage**, not the test step; `pnpm test` on its own was green over a
missing database, and CI runs `pnpm test` as its own named step whose green tick a human reads.

**Why this is the recurring shape rather than a convenience.** Skipping is right for a developer
without Docker. It is wrong in CI, where "no database" is a broken pipeline and not a preference,
and where the skip is reported as a pass. The `pnpm migrate` step ahead of it is what makes CI safe
today — a silent no-op there, or a service container that starts but is never migrated, and the
tests would skip and the step would still tick.

**Remedy, when someone owns it:** honour an explicit `RMS_REQUIRE_DB=1` (set in CI) that turns every
one of those skips into a failure, so the pipeline distinguishes "no database" from "database fine".
That is a one-line guard per suite plus one line in `ci.yml`. Not taken inside T-28: T-28 is about
self-test fixtures, and this belongs with the CI hardening in **T-11 / T-23**.

Historical note, because it is the same number: `LATEST.md`'s long-standing "1,042 tests passing"
claim was replaced in session 3 for being stale. It is now also, exactly, the count of a run with no
database. A figure that means two different things is worth never quoting again without the file
count beside it — 47 files, 1,126 tests, 0 skipped, is the whole assertion.

**Seen a third time, on Windows, 2026-09-02.** The first Windows `pnpm verify` ran `pnpm migrate`
immediately after `docker compose up -d`, before the container was healthy; migrate died on
*"Connection terminated unexpectedly"*, and `pnpm test` then reported **46 passed | 4 skipped (50)
files, 1,051 passed | 92 skipped (1,143)** — green ticks over an unmigrated database, exactly this
finding. The run was saved by `check-rls`, which refused: *"found no tables in schema 'app'.
Refusing to report a pass for a check that inspected nothing."* The second run used
`docker compose up -d --wait` and skipped nothing. The `RMS_REQUIRE_DB=1` remedy above is still
unowned; the skip count is now the first thing to read in any verify log, before the tick.

## F-30 — `part_number` is not unique in either approved release *(raised in T-09, open — the approver's call)*

Found by measuring the release before keying a table on it, not by reading it.

In **`interlake-2026-09`**, two part numbers each appear on two rows, with different
spans and different capacities:

| part_number | code_18 | span | capacity |
|---|---|---|---|
| `UM005516` | `IB65QT05400RSA400` | 54 in | 24,940 lbs |
| `UM005516` | `IB65QT06000RSA4000` | 60 in | 22,540 lbs |
| `UM005517` | `IB65QT06600RSA400` | 66 in | 20,570 lbs |
| `UM005517` | `IB65QT07200RSA4000` | 72 in | 18,940 lbs |

**The same duplication is present in `interlake-2026-08`**, so it is carried forward from the
original extraction rather than introduced by the 2026-09 corrections. `code_18` is unique — 336
distinct codes across 336 rows, in both releases.

**Two of these four rows are already flagged elsewhere.** `IB65QT05400RSA400` and
`IB65QT06600RSA400` appear in the 2026-08 manifest's own anomaly list as 17-character codes where 18
were expected. All four are 65QR / F5M, the same family as the `...RRA4000` end-plate-letter
exemption recorded in the 2026-09 manifest. There is a cluster of oddities in one family.

**Consequence, already handled:** `app.part` is keyed on `(manufacturer, code_18)` and `part_number`
is carried as an attribute of the revision. A registry keyed on the part number would have refused to
load the approved catalog on its first run.

**What is NOT decided, and is not mine to decide:** whether one order number genuinely covers two
spans in the published source, or whether these are transcription slips. It sits inside an APPROVED
release, so per the standing rule it is EL's call, and **nothing in T-09 alters the release either
way.** If they are slips, the fix belongs to a future release, not a correction of a signed one.

## F-31 — a new table can pass `check-rls` and still be unusable *(raised in T-09, **CLOSED in T-10b**)*

Migration 0010 created `app.part` and `app.part_revision` with RLS enabled, forced, and a policy for
every operation. `pnpm check:rls` reported **PASS** over both. The application role could not read or
write either of them: `permission denied for table part`.

The missing piece was the `GRANT`. `0002_rls.sql` runs
`GRANT ... ON ALL TABLES IN SCHEMA app`, and **`0003_auth.sql` already records why that is not
enough** — ON ALL TABLES affects only the tables that existed when it ran, so every migration adding
a table must grant explicitly. 0003 and 0004 both do. 0010 did not.

**This is the recurring shape at the privilege layer.** `check-rls` does exactly what its docstring
says and nothing more; the gap is that *nothing at all* checks the other half. A table added with RLS
and no GRANT is a table CI calls secure and the application cannot use — and the failure appears at
runtime, in whatever code first touches it, with an error that names permissions rather than the
migration that forgot them.

Caught here by the T-09 tests failing, which is the expensive way. **Remedy:** extend `check-rls` (or
add a sibling) to assert that every table in `app` grants SELECT/INSERT/UPDATE/DELETE to the
application role, with the same exemptions-as-data structure it already uses for policies. That is a
dozen lines against `information_schema.role_table_grants`, and it belongs with the checker work in
T-10b.

**Also worth recording:** the FK added by 0010 immediately turned **four existing tests red**. They
were inserting `bom_line` rows with `gen_random_uuid()` in `part_revision_id` — a reference to
nothing. That is not a test bug so much as the evidence for D-10: the column had never had a
referent, so every value in it was unverified by construction. The fixtures now reference a real part
revision; the constraint was not relaxed.

**Closed in T-10b, on the axis the finding named.** `grantViolations` asserts, for every table in
`app`, that `app_user` holds each command the table allows — and, in the other direction, that it
does **not** hold a command `EXEMPTIONS` says the table disallows, so the audit table's revoke cannot
be silently undone by a later migration. One exemption table now governs both axes, because two lists
can disagree and an exemption honoured on one axis has stopped meaning what it says. Proven against
the live database: `REVOKE SELECT ON app.part` → red; `GRANT UPDATE ON app.audit_event` → red;
restored → green at 82 grants. `selftest-rls` gained six privilege cases and was itself proven
against a deliberately broken checker (2 of 13 red, both named).

## F-32 — "push each task's commit as it lands" has no mechanism behind it *(raised 2026-09-02 by EL, open, owner T-11)*

**The repeating shape, this time in the practice rather than the code.**

Session 4 recorded drift 16 — both scoreboard copies asserted CI covered the tip when it did not —
and wrote the remedy in the same bullet: *push each task's commit as it lands*. Sessions 4 and 5 then
applied it, recorded it as applied, and measured the gap it was supposed to close ("T-28 is one
commit unpushed", "the gap is one task deep by design"). **The remedy buys no CI coverage at all.**

`.github/workflows/ci.yml` fires on `push: branches: [main]`, on `pull_request`, and on a nightly
schedule. A push to a task branch matches none of them. Re-derived from the file today; EL confirmed
it independently three ways — `gh run list --commit be78f19` empty, `--branch task/t-09-part-registry`
empty, and the API's `commits/be78f19/check-runs` returning `total: 0`.

So the honest statement about `be78f19` is not *"pushed, run not read"* — which every copy of the
scoreboard has said, and which implies a run exists. It is **no run was ever created**. Three
sessions have been counting a push as a verification event, and a push is not one.

**This is F-01/F-02/F-08/F-11/F-19/F-26/F-31 one layer up:** a control that states its own method,
is applied conscientiously, is measured — and has nothing behind it. It was invisible because the
thing it produces (a green tick) is produced by a *different* trigger, so it appeared whenever a PR
happened to be open and never when one was not.

**What did cover the work:** PR #7, head `b5850fb`, which contains all 12 commits — so `be78f19`'s
content is judged, but by the PR trigger and only once the PR was opened, days after the push the
project recorded as the verification.

**Remedy, and it carries a decision.** Either:

- **(a)** add `push: branches: ['**']` to the `on:` block, so every branch push is judged when it
  lands. Correct, and it makes the existing remedy true. Cost: a PR branch is then built twice per
  push unless a `concurrency` group with `cancel-in-progress` is added alongside it. That is the
  version that matches what the practice already claims.
- **(b)** keep the trigger and change the practice: open a **draft PR with the first commit** of each
  task branch, so the `pull_request` trigger covers every subsequent push. No workflow change, and it
  also gets the diff in front of a reviewer earlier.

Not chosen here. **(a) is a CI modification and belongs in T-11**, which is the open task that touches
`ci.yml`; (b) is a change to how EL works and is EL's to accept. What must not survive either way is
the current wording, which describes a mechanism that does not exist.

## F-33 — the source-conflict register cites a source that was not read *(raised and **CLOSED** 2026-09-02)*

T-12 landed the IBC/MH16.1 adoption facts into `data/rules/mvp-2026-08/rules.json`, the blueprint and
`src/parts/09-s10.html`. **The facts are right.** Verified independently today against RMI — the
standard's own sponsor — which states that the 2024 IBC adopted ANSI MH16.1-2021 and that the 2021
IBC referenced MH16.1-2012, and against ANSI's webstore, whose Document History for MH16.1-2023 reads
`Revises: ANSI MH16.1-2021`.

**The attribution is wrong.** All three copies say the facts are known *"per the IBC's own
referenced-standards lists."* That list was not read. IBC 2024 Chapter 35 sits behind ICC's Premium
subscription, UpCodes disallows automated access, and California's published Chapter 35 material
carries only its amendments. Four attempts, no primary text.

**This is F-08's shape at the citation layer, and it is in a governing artifact**, which makes it
worse than the same defect in a scoreboard: the sentence names a method (reading the code's
referenced-standards list) that is not the method used (reading the standard sponsor's summary of
it). A later reader checking the register against the IBC will not find the sentence there.

**One substantive point rides along.** ANSI's own blog states that *"ANSI MH16.1-2023 is referenced by
the International Building Code"* — naming no edition, and contradicting RMI's specific claim that the
adopted edition is 2021. That is unresolved, it bears directly on the Fresno half of the conflict
("City of Fresno cites 2023"), and it is exactly the kind of thing a conflict register exists to
hold open rather than resolve by picking the more convenient source.

**Remedy (XS):** change *"per the IBC's own referenced-standards lists"* to name what was actually
read — RMI's 2024-07-10 statement and the ANSI webstore's revision history — and add the ANSI-blog
contradiction as a second open thread beneath the AHJ-enforcement one. **The register keeps its
facts; it stops overstating where they came from.**

**Closed the same day.** Both copies now credit RMI and the ANSI revision history and say explicitly
that the IBC lists *were not read and are paywalled*; the ANSI-blog contradiction is recorded as a
second unresolved thread against the Fresno position. **Not one figure changed** — the facts were
right and only the provenance was wrong, which is the whole point of separating the two. Rebuilt with
`python src/build.py` (all checks passed), `vitest run packages/kernel-rules` 46 passed,
`pnpm verify` exit 0.

## F-34 — a commit was lost because "pushed" was never checked *(raised 2026-09-02, **recovered**, owner T-11's practice half)*

Commit `97a54d9`, carrying the F-32 finding, drift items 28 and 29, T-11's grown scope and the
denominator move to 148, **was never pushed**. `task/t-10a-reconcile-documents` was deleted after
PR #7 merged; the commit survived only as a dangling object, reachable through the reflog and
scheduled for `gc`. Everything it recorded was absent from `main` for two merges — during which T-11
was implemented *against* the F-32 write-up and shipped citing it, while the repository contained no
F-32 at all.

Recovered today: `git branch rescue/f32-record 97a54d9`, then the four files restored from that
tree onto a branch off `main`. Nothing was lost.

**The mechanism is worth stating precisely, because it is F-32 wearing different clothes.** The
branch-deletion step was guarded by a check — *tips are ancestors of `main`* — and that check passed,
because it was asked about a ref that no longer pointed at the last commit. **A verification ran, and
answered a question adjacent to the one that mattered.** F-32 was a control with no mechanism; this
is a mechanism aimed slightly to the left of its control.

**Remedy:** before deleting any branch, `git log --oneline @{u}..` must be empty, not merely
`merge-base --is-ancestor`. Cheap, and it asks the question the deletion actually depends on. Belongs
with T-11's practice half, which is already the task that owns "does the thing we say we do actually
happen".

## F-35 — `await import()` of a built path fails on Windows *(raised 2026-09-02 by EL, **CLOSED** 2026-09-02 — merged as PR #11, proven on Windows)*

`tools/selftest-spot-check-draw.mjs` loaded its built modules with `await import(join(DIST, '…js'))`.
On POSIX an absolute path is an acceptable ESM specifier; **on Windows `C:\…` is not** — Node reads
the drive letter as a URL scheme and throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`. All three call sites
now wrap the path in `pathToFileURL`, which is correct and platform-neutral.

**The finding is not the fix, it is what the fix implies:** `pnpm check:draw:selftest` — and therefore
`pnpm verify` — **has never completed on Windows.** CI is Linux, so every green run in this
repository's history passed over a step that could not run on the machine Checkpoint A requires it to
run on. **Checkpoint A's Windows half was blocked by this and nobody knew**, because the Windows half
had never been attempted.

Re-derived today: `selftest-spot-check-draw.mjs` is the **only** file in `tools/` using dynamic
import, and all three of its call sites are converted, so the class is closed rather than one instance
of it.

**The fix is uncommitted in the working tree** and is deliberately left there — it is a code change
and wants its own commit and its own proof, which is a Windows `pnpm verify` run reaching that step.
**That run is the evidence Checkpoint A needs anyway.**

**Closed 2026-09-02, later the same day.** Committed as `fe68172`, CI #42 green (which, as the commit
body says, proves nothing about F-35), merged as PR #11 → `1f3d6d5`. **Then the run that could prove
it was made:** `pnpm verify` on Windows (Node v24.19.0, pnpm 11.22.0, Docker Postgres 16) at
`89e55fa`, launched from Explorer under computer control, output captured to
`_to_delete/verify-windows.log`. The step reached and passed:

```
selftest-spot-check-draw: PASS — 48 draws agree.
```

That is the first time `check:draw:selftest` has executed on Windows. The same run went on to fail
one step later, at coverage, for an unrelated reason — see **F-37**. F-35 itself is closed.

## F-36 — "either front-end package" was enforced on one of them *(raised and **CLOSED** 2026-09-02, found while executing Checkpoint A)*

Checkpoint A's criterion reads *"No orchestration remains in **either** front-end package."*
`check-app-boundaries` reported `1 restricted app(s): client-web`.

`apps/internal-web` was **clean** — T-08 moved `deriveInternalRevision`, `internalNote` and
`stripInternalRevisions` into `@rms/workflow` and its barrel deliberately does not re-export them.
So the *state* satisfied the criterion. **Nothing held it there**, and the criterion's own words
promise a mechanism that covered half of what they name.

**The exemption was real but was doing a job it was never argued for.** The checker's docstring said
the internal app is *"deliberately unrestricted: it is allowed to see everything, which is the point
of it."* That is a sound argument about **visibility** — an internal reviewer must see the database
layer, the BOM and the internal DTOs — and it was silently carrying **authority** as well.
Those are different axes. `apps/internal-web` is still a **browser bundle**, and a browser bundle
that can drive the submit sequence decides for itself when a revision freezes, whoever is looking at
the screen. D-01 and AD-1 say the server owns that sequence; they say nothing about audience.

**Closed by splitting the axes rather than by copying the client rule.** `internal-web` now carries
`forbidden: []` — empty *on purpose*, with the visibility argument written where the next reader
will meet it — and the same four `forbiddenSymbols` as the client bundle, justified on authority
rather than audience.

**Proven to fire, both directions, against the real app:**

| Planted in `apps/internal-web/src/lib/queue.ts` | Result |
|---|---|
| `export function deriveInternalRevision()` | **red**, exit 1 — *"binds 'deriveInternalRevision' at the top level … T-08 moved it out and this keeps it out"* |
| `import { stripInternalRevisions } from '@rms/workflow'` | **red**, exit 1 — *"deciding what an audience may see is a server authority"* |
| restored | **green**, exit 0, 20 files across 2 restricted apps |

`selftest-app-boundaries` gained **4 must-catch** cases and **4 must-allow** cases. The must-allow
set is the load-bearing half: it asserts `@rms/db`, `@rms/kernel-bom` and `@rms/api` remain legal
here, so a later edit that "tidies" the internal rule by copying the client's import list goes red
and says why. **And the self-test was proven against a broken checker** — neutering the four
patterns turned it red on exactly those 4 cases, naming each.

**Two defects in the checker surfaced while proving it**, both fixed in the same change:

- A top-level `export function derive…` matched both `EXPORT_DECL_RE` and `TOP_LEVEL_DECL_RE` and
  was **reported twice**, so one defect read as two. Deduped by **name**, not by message, so two
  distinct forbidden bindings in one file still produce two lines (asserted).
- The violation message hard-coded *"out of the client bundle"* and now interpolates `rule.app`,
  because a control that misdescribes which rule it is enforcing is this project's whole subject.

`pnpm verify` exit 0 in 71 s, 50 files, 1,143 tests, coverage 99.58%.

## F-37 — the coverage gate's verdict depends on the operating system *(raised 2026-09-02, **CLOSED** the same day — remedy option 1 with the guard, proven by a Windows `pnpm verify` at exit 0)*

Found by the Windows `pnpm verify` that F-35 unblocked, at `89e55fa`, Node v24.19.0, pnpm 11.22.0,
Docker Postgres 16 migrated and healthy. Every step through `check:claims` was green — 50 files,
1,143 tests, 0 skipped, all twelve self-tested checkers, `selftest-spot-check-draw: PASS`. The
**last** step, `pnpm coverage`, exited 1:

```
ERROR: Coverage for lines (67.85%) does not meet "packages/workflow/src/**" threshold (100%)
ERROR: Coverage for functions (84.61%) does not meet "packages/workflow/src/**" threshold (100%)
ERROR: Coverage for statements (67.85%) does not meet "packages/workflow/src/**" threshold (100%)
ERROR: Coverage for branches (96.82%) does not meet "packages/workflow/src/**" threshold (100%)
```

The two files responsible are `packages/workflow/src/assumptions.ts` (62 lines) and `finding.ts`
(28 lines). **Both are types only** — interfaces, no runtime, nothing a test could execute. On
Windows the coverage table lists them as `0 | 0 | 0 | 0 | 1-62` and `1-28`: every line uncovered.
On Linux the same files show `0 | 0 | 0 | 0` with **no** uncovered lines — zero of zero — and the
package aggregate reads 100.

**Isolated to the OS, not the Node version.** The same commit's coverage was re-run in the container
under Node 22.22.2 and under Node 24.19.0 (the Windows machine's version): both exit 0, both report
`packages/workflow/src` at 100 with the two files at 0/0. So it is vitest's coverage-v8 handling of
a never-loaded, types-only module on Windows — most likely the "uncovered file" pass counting raw
source lines where the Linux path finds an empty transform. The mechanism is not confirmed and does
not need to be for the finding to stand.

**Why it is a finding and not an annoyance.** The `packages/workflow/src/**` threshold is a
control, and its answer is *"pass"* on one machine and *"fail"* on another for identical source and
identical tests. A gate whose verdict is a property of the runner is not measuring the code. And the
Linux 100% is partly hollow: two files that cannot be covered are inside a rule that says everything
in the directory must be — on Linux they satisfy it by being invisible, on Windows they break it by
being counted. Neither reading is the one the threshold's docstring promises (*"a refusal that is
never exercised is a refusal nobody knows is broken"* — these files contain no refusals).

**Consequence for Checkpoint A.** Its first criterion, *"`pnpm verify` PASS, exit 0, on Windows and
in CI"*, is **red on Windows** — one step later than F-35 left it, and for a different reason. It
cannot be ticked. Everything above coverage is Windows-green and recorded in `tasks/todo.md`'s
checkpoint block, so the checkpoint's other criteria do not wait on this.

**Remedy options, not taken here (EL's call — it changes a gate):**

1. Exclude the two files from coverage `include` by name, with a comment stating they are types
   only — **and a guard that keeps that true**: a small check that each excluded file compiles to an
   empty JavaScript module (its emitted `.js` in `dist/` contains no statement), so a runtime export
   added later drags the file back under the threshold instead of hiding behind the exclusion. An
   exclusion with no guard is F-08's shape.
2. Move the two type definitions into files whose exclusion is already structural — the package's
   `index.ts` is excluded from coverage today — or into a `*.types.ts` convention that the coverage
   config excludes and the guard in (1) polices.
3. Keep the gate as is and accept that Windows `pnpm verify` stays red at the final step. Honest,
   but it leaves Checkpoint A's Windows criterion permanently unmeetable on the machine the plan
   names, which is what F-35 was found guilty of.

Whichever is chosen, the Windows run is now cheap to repeat: `_to_delete/verify-windows.cmd` waits
for the database, migrates, runs verify and writes the log with the exit code.

**Remedy taken: option 1, on `fix/f-37-types-only-coverage`.** One list, `tools/types-only.mjs`,
read by two consumers: `vitest.config.ts` spreads it into coverage `exclude`, and a new checker,
`tools/check-types-only.mjs`, asserts on every run that each listed source file's **emitted**
JavaScript (`src/x.ts` → `dist/x.js`) reduces to nothing but `export {};` once comments and the
source-map directive are stripped. It reads the emitted file rather than the source on purpose —
`export interface` is erased by the compiler, so "what survives emit" is exactly "is there anything
here a test could execute", answered by `tsc` and not by a regex over TypeScript. It refuses to pass
on an empty list, on a listed file that does not exist, and on a listed file that has not been built.

**Proven to fire against the real file:** `export const planted = 1;` appended to
`packages/workflow/src/assumptions.ts`, `tsc --build`, then

```
check-types-only: FAIL
  packages/workflow/src/assumptions.ts: is no longer types-only — packages/workflow/dist/assumptions.js contains `export const planted = 1`. Remove the path from tools/types-only.mjs so coverage measures it again.
```

exit 1; restored and rebuilt, `PASS — 2 types-only module(s) still compile to an empty module`,
exit 0. `selftest-types-only` runs first with eight fixture cases (a runtime export, a bare
statement, a missing source, an unbuilt file, an unmappable path, an empty list, a genuinely empty
module, and code-shaped text inside comments) plus two pins and a read-only reachability check
against the real list. Wired into `pnpm verify` and `ci.yml` immediately before the coverage gate,
which is the thing it protects. Blind spots stated in its header: it checks the listed paths and
nothing else (an unlisted types-only file is simply measured, the safe direction), and its comment
stripper is a small hand-rolled pass rather than a parser — enough, because any residue at all fails.

**What this changes and what it does not.** On Linux the two files were 0/0 and invisible; now they
are excluded and invisible — the reported 99.58% does not move. On Windows they were 90 uncovered
lines; now they are excluded. **The finding closes when a Windows `pnpm verify` exits 0**, which is
the same run Checkpoint A's first criterion needs, and not before.

**Closed.** `_to_delete/verify-windows.cmd` at `0df4af5` (the remedy plus its `ci.yml` steps), Node
v24.19.0, Docker Postgres healthy, `pnpm migrate` exit 0 — the third Windows run of the day and the
first to finish:

```
 Test Files  50 passed (50)
      Tests  1143 passed (1143)
selftest-spot-check-draw: PASS — 48 draws agree.
selftest-types-only: PASS — 10 cases, real list reachable.
check-types-only: PASS — 2 types-only module(s) still compile to an empty module.
All files          |   99.58 |    99.03 |   99.75 |   99.58 |
 ...s/workflow/src |     100 |      100 |     100 |     100 |
=== pnpm verify EXIT CODE 0 at 09/02/2026  4:38:54.90
```

1 m 34 s wall. **Windows and Linux now report the same coverage to the second decimal**, which is
what a gate that measures the code rather than the runner looks like. Checkpoint A's first
criterion — `pnpm verify` PASS on Windows **and** in CI — is met; its record in `tasks/todo.md` is
ticked in the same commit as this paragraph.

## F-38 — two front-end packages carry a request lifecycle the blueprint does not have *(raised 2026-09-02 by T-13b's adversarial review — **OPEN**, owner T-14c / T-16)*

Found by the fresh-context review of T-13b, which caught the task **copying** the defect rather
than the defect itself: the first draft of the client `Submission` DTO and the internal `QueueEntry`
DTO keyed their status tables on `submitted / acknowledged / in_review / rfi_open / quoted /
declined` and a `draft / submitted / answered` client view. Those six and those three come from
`apps/client-web/src/lib/status.ts` and `apps/internal-web/src/lib/queue.ts`. **They appear
nowhere else.** Blueprint §3.4 defines the request status as nine states — `DRAFT, SUBMITTED,
TRIAGE, NEEDS_INFO, IN_PROGRESS, QUOTED, DECLINED, WITHDRAWN, EXPIRED` — and `app.request_status`
in `0001_init.sql` is that enum verbatim. OD-12's three-state view is "received / in progress /
complete only".

Consequence had it shipped: `toSubmissionClientDTO` would have thrown on the first real row
(`unknown internal status 'SUBMITTED'`), and every real queue row would have failed the internal
schema's enum. Two controls, each keyed on a lifecycle nothing emits — the hollow shape, one layer
out. The T-13b DTOs now key on `app.request_status` (exported as `REQUEST_STATUSES`) with an
exhaustiveness test over the enum minus DRAFT; the collapse is `SUBMITTED → received`, `TRIAGE /
NEEDS_INFO / IN_PROGRESS → in_progress`, `QUOTED / DECLINED / WITHDRAWN / EXPIRED → complete`
(the last two are a product call made in code and recorded under T-13b for EL).

**What is still wrong, and owned elsewhere:** the two front-end modules themselves. `status.ts`'s
`clientStatusFor`, `STATUS_WORDING` and `ClientStatus`, and `queue.ts`'s `InternalStatus`, `QueueEntry`
and the two clocks, all speak the invented vocabulary; their tests pin it. They are pure library
code with no route behind them yet, so nothing is live — but T-14c's client status route and T-16's
screens will consume them, and they must be re-keyed on the DTOs before that (the API's `ClientStatus`
and `RequestStatus` are the source; the SPA cannot import `@rms/api`, so a shared const in
`@rms/contracts` is the likely home). Two smaller items of the same class, filed here rather than
separately: the kernel's `RELEASE_STATUSES` has five values (`QUARANTINED`) while `app.release_status`
in 0001 has four — the migration is the stale copy; and `COMPARABLE_METRICS` now exists twice
(client-web camelCase, api snake_case) with nothing asserting they agree.

**Why it was not caught earlier:** the two modules were written in T-08/T-12 against the client
screens' needs, with the blueprint's §3.4 table three sections away, and their tests test the
modules. Nothing compared either to the migration's enum, because nothing consumed both until a
DTO tried to. The lesson is the one CLAUDE.md already states: a vocabulary in code is a claim until
something re-derives it from the governing document.

## F-39 — a guarantee stated in three places, enforced in none, and the module exported the way to break it *(raised and **CLOSED** 2026-09-03 by T-13d's adversarial review)*

**The shape, again.** AD-3's "the intent row is written **before** the effect" was stated in
`0011_idempotency.sql`'s header, in `idempotency.ts`'s module note, and in T-13d's acceptance
criteria. `claimIdempotencyKey` honoured it by owning its transaction. Nothing made it true.
`claimOn` — which takes a *caller's* transaction — was exported from the module **and re-exported
from `apps/api/src/index.ts`**, and the last DB test blessed calling it inside a caller's
transaction. Claiming inside the effect's transaction is the tidiest thing a T-14 handler will
reach for, and it silently deletes the third outcome: the intent row rolls back with the effect,
so a crash leaves no evidence and the retry duplicates the work.

**Demonstrated, not argued.** The review ran a probe that claimed inside a transaction which then
threw: `{ first: 'rolled-back', second: 'rolled-back', effects: 2, rowsLeft: 0 }` — two effects for
one key, no evidence of either. No test, lint rule or checker went red.

**Closed three ways, weakest to strongest.** `claimOn`/`settleOn` removed from
`apps/api/src/index.ts` with the reason written where the export used to be; a DB test in which the
effect rolls back and the claim must survive; and a symbol rule for `apps/api` in
`tools/check-app-boundaries.mjs` — the first rule in that checker to carry a path **exemption**, so
the directory that defines them may name them and no other may. Proven on the real tree: a
`apps/api/src/routes/probe-t14.ts` importing `claimOn` turns the checker FAIL, and its self-test
carries three catch cases, two allow cases, and the case that would notice if the exemption ever
widened from the owning directory to the whole app.

**Four more from the same review, all closed in the same commit.**

- **The retention control could not fire for the change it named.** `idempotency.test.ts` said in
  its own docstring that asserting `RETENTION_MS === 30 days` would "pass forever while someone
  raised `max_attempts` to 200" — and then hardcoded 5 and 100. The review planted
  `DEFAULT 5000` in `0004_outbox.sql` (a ~208-day window against 30-day retention) and all three
  assertions stayed green. Now read from the migration; the same plant turns 2 of 39 red.
- **A false statement of record.** Both the module source and the commit body said a deviation was
  "recorded for EL in `tasks/todo.md`". It was not; `todo.md` was not in the commit. The record now
  exists, and it carries the two shapes inside the deviation and one question T-13d deliberately
  did not answer (a stranded `in_flight` claim gets `409` for thirty days and nothing settles it).
- **A legitimate late retry raised a raw Postgres error.** The re-claim moved `claimed_at` and left
  `expires_at`, so `CHECK (expires_at > claimed_at)` fired on a failed key retried after its
  window. Reproduced by the review; fixed and pinned.
- **A client could turn any idempotent route into a 500 with one character.** `requestHash` was
  unguarded and `canonicaliseAll` refuses `-0`, which survives `JSON.parse` and a numeric DTO.
  Now a modelled `unhashable` outcome. The same commit adds `errorCodeFor`, because the acceptance
  criteria say the guard *returns* 422 and 409 and the module returned `'mismatch'` and stopped.

**Two figures in the original commit body were wrong** and are corrected here: dropping
`UNIQUE (organization_id, key)` turns **15** of 30 red, not 8; removing the `request_hash`
comparison turns **2** of 30 red, not 3. The controls fire; the arithmetic reported did not
reproduce, which in this repository is its own small instance of the shape.

**Still open, and not T-13d's to close.** F-29 remains: the DB suites skip to green without a
database. T-13d narrows it — the probe now REFUSES rather than skips when Postgres is reachable but
`app.idempotency_key` is absent, which is the migration-failed case the review reproduced by
renaming the table (18 skipped, exit 0). A no-database developer still skips, by design.

## F-40 — the lease was not a fence, and the config check it named had no startup to run at *(raised and **CLOSED** 2026-09-03 by the review of EL's stranded-claim fix)*

**The lease shipped without a fence, and that is a duplicate-effect bug, not a nicety.** A takeover
reused the row id and `settleOn` guarded only on `claim_outcome = 'in_flight'`, so the overtaken
holder was indistinguishable from the new one. Review demonstrated it against the live database
rather than arguing it:

```
stale holder A settle -> true
real  holder B settle -> false
replay -> A's result_ref, while B's effect had also committed
```

The client is handed the wrong result for an effect that ran twice — the exact failure AD-3 exists
to prevent. **And the stated cost was itself too generous:** a stale holder settling `failed` frees
the key immediately, with no lease expiry, so a third effect can start at once. "One effect per key
per lease window" was not the guarantee; there was no bound inside a window at all.

Closed by `lease_epoch` (migration 0013): a monotonic token bumped on every re-claim, takeover and
release, returned in the `claimed` result, and required by every settle. Removing it from
`settleOn`'s WHERE clause turns **14 of 56** red; not bumping it on takeover turns **2 of 56** red.

**Second blocker, and it is this repository's signature defect committed inside the paragraph that
names it.** The commit body, the module docstring, AD-3 and both scoreboard copies all said a
malformed `CLAIM_LEASE_MINUTES` "throws at startup". There is no startup. `claimLeaseMs()` is
called lazily from one branch of `claimOn`, so a typo'd deploy comes up healthy, serves every
first-attempt request, and throws an unhandled `RangeError` at the first duplicate claim — the one
path the lease exists to protect. Review proved it:

```
fresh claim with CLAIM_LEASE_MINUTES=ten -> claimed
duplicate claim threw -> CLAIM_LEASE_MINUTES must be a positive whole number…
```

Closed two ways, neither of them a reword: `assertConfiguration()` exists and is exported, and
**T-14a's acceptance criteria now require `createApp()` to call it**; and every document that said
"at startup" now says where it actually throws and why. The unit tests proved the *function*
throws; nothing proved the *process* refuses to start, because nothing made it.

**Three more from the same review.**

- **`releaseClaim` fabricated its audit actor.** `actorType` was hardcoded `'staff'` and the
  function took `releasedBy` on trust, so a client tenant released its own claim and produced an
  audit event asserting a staff actor inside a client organization — a function whose whole
  justification is that an override must leave a trace, leaving a false one. It now derives
  `actorType` from the tenant and refuses a non-staff context outright. Cross-org release was
  already blocked by RLS, and that held.
- **The retention sweep deleted `in_flight` rows**, so bookkeeping could free a key an effect still
  held. It now deletes settled rows only; an `in_flight` row past its window is a bug and leaving
  it visible is the point. The first attempt at this fix had no test and the plant stayed green —
  the test came second, and the plant now turns 1 of 57 red.
- **`idempotency.release` was missing from `INTERNAL_ONLY_ACTIONS`** while every comparable action
  was in it, so `assertRouteCoverage` would have waved it onto a client route.

**A figure in the previous commit body did not reproduce.** It claimed "lease takeover removed —
9 of 50 red"; the measured number is **2 of 50**, and 9 is the neighbouring row's figure, copied.
Corrected here rather than left standing. Under `verified-not-claimed` a duplicated number in an
evidence table is precisely what the rule exists to stop, and this is the second commit in two days
to carry one.

**Not closed, and named so it is not mistaken for closed.** The operator release is a policy row, an
authorization rule and a library function — there is **no endpoint**, because there is no server.
Nothing calls `authorize(actor, 'idempotency.release', …)` outside the matrix test, `purgeExpiredOn`
still has no caller, and the route is not a §8.2 row. All three belong to T-14a/T-14e and are
recorded there.

## F-12 and F-13 — fixed, values untouched

Both were prose inside `data/catalog/interlake-2026-09/manifest.json`, and both are corrected.
Established first, because it governed whether the edit was safe at all: **`content_sha256` covers
`beams.json` only** — the rows array under 2026-09's method, the file text under 2026-08's — so no
manifest prose is inside either hash, and the approval gate reads `status`, the approver identity,
the verification paths and the human spot-checks, none of which this touches. Editing the prose
neither invalidates the hash nor reopens the gate. Confirmed by recomputing both hashes before and
after: unchanged.

- **F-12** — `changes_from_2026_08` now names the face-height correction, the three affected family
  groups with their old and new values, the eight families that did not move, and points at
  `face_height_59e_status` / `face_height_65_status` / `face_height_policy`. It also records that
  the sentence previously said the opposite, and why that mattered.
- **F-13** — `approval_record` is rewritten in the past tense across the whole arc: approved,
  returned to DRAFT on the 19-distinct-values finding, gate changed to count published values, the
  one-cell top-up drawn and read, re-approved.

**No capacity, part number, code, face height or deflection value was altered.** The diff is
1 line in the 2026-08 manifest and 6 in the 2026-09 manifest, all of them prose or the new method
field.


---

## R-08 — the catalog data, reviewed as data

Every check below was run here, against the files, not against the tests that assert them.

| Acceptance criterion | Result |
|---|---|
| `frames.json` carried forward from 2026-08, verified independently | **Confirmed at the level that matters.** The `tables` arrays are structurally identical and the stored hash reproduces exactly. The *files* are not byte-identical, by design — see F-16 |
| 2026-08's transcribed values unchanged by the quarantine commit | **Confirmed.** `git diff eeaafef^ eeaafef` on that manifest touches exactly three things: `status` DRAFT → QUARANTINED, and the two added fields `corrected_by` and `quarantine_reason`. No transcribed value moved |
| `quarantine_reason` and `corrected_by` non-null and naming the correcting release | **Confirmed.** `corrected_by: "2026-09"`; the reason names the finding (D-06), the count (264), the phantom rows (42) and why the values are deliberately not corrected |
| 2026-09 is DRAFT with no residue of a hand-typed APPROVED | **Stale criterion — superseded, not failed.** It was written while `52f708a` held the release at DRAFT. `eaeb8f0` and `a2f166e` then re-approved it against a recorded human spot-check, which is the outcome the criterion was protecting. The residue it was hunting is absent: the APPROVED is backed by `human_spot_checks` with a named checker, a date and MATCHED. See F-13 for the stale prose that *did* survive |
| Sample sizes re-derived from `max(20, ceil(0.05 × N))` | **Confirmed.** beams `max(20, ⌈16.8⌉) = 20`, pinned 20 (+1 supplementary); frames `max(20, ⌈21.75⌉) = 22`, pinned 22 |
| Every pinned cell id resolves to a real row | **Confirmed. 43 of 43.** 21 beam ids (20 + the top-up) resolve against `(family, series, span_in)`; 22 frame ids resolve to a non-null cell at `table_id/HbL<height>/col<n>` |
| `source_anomalies` and `constraints` carried forward unchanged | **`constraints` yes; `source_anomalies` no — and correctly so.** 2026-08 listed 8, 2026-09 lists 3. The 5 individual 17-character `code_18` entries were consolidated into one, and the **59E face-height anomaly was removed because the re-source resolved it** (5.92 → 5.9375, recorded in `face_height_59e_status`). One anomaly is new and correctly recorded: 65QR at 162" carries end-plate letter `R` where F5M specifies `S`, transcribed verbatim and pinned as a named exemption |
| The 42 phantom 40E/40ER-F3M rows still absent | **Confirmed. Zero.** The family/series map is 16 families × 21 spans = 336, each family under exactly one end plate: F3M for 27E/36E, F4M for 40E/45E/50E, F5M for 59E/65E/65Q |
| `pnpm lint:provenance` PASS | **PASS**, re-run here, self-test first |
| `pnpm test packages/kernel-catalog` green | **Not run here** — Windows pnpm store, no Linux `rollup`/`esbuild` binaries. **Covered by CI instead, which is stronger:** the `verify` job's "Unit and tenancy tests" step ran green on `efbafbd` (run #10) and `a5d9c5b` (run #11 attempt 2), and the catalog data has not changed since |
| Cell-id existence script | Run, and extended past the criterion to cover **both** datasets rather than one |

**Independently re-derived numbers, all matching the manifest's own claims:** 378 → 336 rows;
exactly 42 removed, all 40E/40ER under F3M; exactly **264** capacity values changed; frame cells
150 + 135 + 150 = **435**; beam `row_count` 336 with no duplicate `(family, series, span)` key.

**Disposition:** the catalog data is in good order and the arithmetic holds everywhere it was
checked. **F-12, F-13 and F-16 are fixed. F-14 is withdrawn as filed and replaced by a checker.
F-15's counting note is recorded in the manifest**; its code half — making the sampler draw over
distinct published values — changes the draw on an APPROVED release and is left to the approver. F-19 was found
underneath them and is closed with a checker and its self-test. The findings are all in the *prose*
wrapped around the data — F-12 denies a change, F-13
contradicts the status, F-14 duplicates a record, F-15 mis-frames a structural property as a quirk.
That is the same defect class this branch has been finding all day, arrived at from a fourth
direction.

## R-10 — the commits, judged as commits

**36 commits**, `origin/main..HEAD`.

| Acceptance criterion | Result |
|---|---|
| Each subject judged against the standard | **35 of 36 clear it.** They are imperative, standalone, and say what changed *and why it matters* — "quarantine interlake-2026-08 — it is wrong, not merely old" is a better subject than most repositories manage. None reads as "Fix bug" or "Phase 1". The exception is F-17. Eleven subjects exceed 72 characters, a consequence of the house "clause, and clause" style; informative, at the cost of truncation in narrow views |
| Each commit leaves the tree green on its own | **Not verified, and not verifiable here** — it needs `pnpm typecheck && pnpm test` at 36 checkouts on Windows. **Partially covered by a check that was run:** every relative import in every `.ts` file added or modified by each commit resolves against that commit's own tree — **0 of 36 commits has an unresolved import**. That rules out the ordinary cause of a commit that only builds with its successor; it does not rule out a type error or a red test. The full check stays open |
| `7559889` (1,294 lines) assessed against sizing | **Within guidance; the raw number misleads.** 873 of the 1,294 insertions are transcribed data (850 of them `frames.json`). Of the 421 remaining, **204 are tests**. It is a ~217-line source change — a new `load-manifest.ts` (132) and edits to `release.ts` (80) and `index.ts` (5) — landing with its data and its tests. Reviewable in one sitting |
| L-12: do `75192d0` and `73ca8d1` belong here? | **Answered below** |
| No commit mixes a refactor with new behaviour so as to hide either | **None found.** The one that invited the question is `14d608f` — 17 files, "the spot-check floor counts readings, not rows". It is a single semantic change propagated honestly: two new modules (`cell-ids.ts`, `spot-check.ts`) with their tests, the three tools that draw, record and worksheet the sample, and the manifest re-pinned. It *could* have been split, but the split would have left an intermediate commit where the floor and the id parser disagree — which is worse than a large coherent one |
| Nothing touches the read-only reference projects | **Confirmed.** No path under `Resourse (do not delete or overwrite files)` — or anywhere outside the repository — appears in any of the 36 commits |

### L-12, answered: they belonged elsewhere, and it is now too late to be worth it

`73ca8d1` (audit-event actor scope) and `75192d0` (the revision audience predicate + `check-rls`
assertion) are RLS work on a different subsystem from catalog release integrity, and on the day
they landed the right answer was to split them onto their own branch with their own reviewer.

That is no longer the recommendation. The branch is now 36 commits and carries, beyond the catalog
work: the RLS pair, the wire contract (`e3ef4fa`), a performance harness and the first §5.4
measurements (`48c7654`), a CI fix (`2ffd173`), lockfile tooling (`6f05043`), and the scoreboard and
its gate. **The name stopped describing the contents around commit five, and splitting retroactively
now costs more review than it buys** — the RLS commits have already been reviewed here (F-01, F-03,
F-04, F-05) and CI is green on the tip.

**Recommendation:** merge as one, and **rename PR #1** to say what it is — something like
*"Audit remediation: catalog release integrity, RLS audience boundary, the wire contract, and a
measured scoreboard"* — so the history does not claim a scope it outgrew. Then adopt one
short-lived branch per task from Phase 2, which the plan already requires. The cost of this branch
is not a defect that got through; it is that no single reviewer ever saw a coherent unit.

**Disposition:** R-10 is **substantively complete with one criterion outstanding** — the per-commit
build check. Everything else is judged and recorded.

---

## Task status

| Task | State |
|---|---|
| R-01 | **Done** — F-01 found and fixed |
| R-02 | **Done** — F-03, F-04, F-05 found; F-03/F-04 fixed. AC-14 kept as absence, per EL |
| R-03 | **Done** — F-06 fixed; 7-case self-test in `verify` and CI |
| R-04 | **Done** — L-6 (the duplicated `Pick<>`) and L-7 closed in `540f4cd`; the `release.ts` split is **declined**, see below |
| R-05 | **Done** — F-02 confirmed and fixed, with 7 regression tests |
| R-06 | **Done** — remedy (b): `selftest-spot-check-draw.mjs`, 24 draws over both releases |
| R-07 | **Partly** — L-3 pinned as deliberate, L-5/L-2 open, L-4 still EL's scope call |
| **R-08** | **Done 2026-09-01 (session 3)** — data re-derived independently; F-12…F-16 raised. One verification item (`pnpm test packages/kernel-catalog`) not runnable from the bridge and covered by CI on `efbafbd`/`a5d9c5b` |
| R-09 | Open (measurement partly done: 1042 tests / 43 files) |
| **R-10** | **Substantively done 2026-09-01 (session 3)** — all 36 subjects judged, sizing and mixing assessed, L-12 answered, reference projects confirmed untouched, F-17/F-18 raised. **Open:** the per-commit `typecheck && test` check, which needs Windows |
| R-11 | **Documentation closed 2026-09-01 (session 3)** — five drift items fixed, one reclassified as T-14 implementation; T-09's migration renumbered to 0009 |

### R-04: the `release.ts` split, answered

**Declined, for now.** 353 lines holding one concept — what a catalog release is and when it may
change state — is still one coherent module, and the change that grew it also gave it a second file
(`spot-check.ts`) and now a third (`cell-ids.ts`), which is the decomposition happening in the right
direction. Revisit when `apps/api` gives it a fourth caller, not before. Recorded so it is a decision
rather than a deferral.

## Verify runs recorded for R-09 / Checkpoint A (2026-09-02)

Three runs, all read this session rather than reported. Full logs are outside the repository
(container `/tmp/verify-main-e86d2bf.log`; Windows `_to_delete/verify-windows.log`, gitignored);
these are the lines that carry the claims.

**Container — fresh clone, `main` @ `e86d2bf`, Node 22.22.2, pnpm 11.22.0, native PostgreSQL 16,
`pnpm migrate` → `migrate: OK — 10 migration(s) present.`**

```
verify exit=0 in 84s
 Test Files  50 passed (50)
      Tests  1143 passed (1143)
selftest-spot-check-draw: PASS — 48 draws agree.
All files          |   99.58 |    99.03 |   99.75 |   99.58 |
```

**Windows — `C:\Rack Master\rack-master-studio`, `89e55fa`, Node v24.19.0, pnpm 11.22.0,
Docker Postgres 16 (`docker compose up -d --wait` → `Container rms-db Healthy`),
`pnpm migrate` exit 0.**

```
 Test Files  50 passed (50)
      Tests  1143 passed (1143)
selftest-spot-check-draw: PASS — 48 draws agree.
All files          |   97.92 |    98.91 |   99.27 |   97.92 |
ERROR: Coverage for lines (67.85%) does not meet "packages/workflow/src/**" threshold (100%)
=== pnpm verify EXIT CODE 1 at 09/02/2026  2:45:16.37
```

Run time 1 m 40 s wall. Every step before coverage green; the coverage failure is F-37. The first
Windows attempt, three minutes earlier, is the F-29 record (92 skipped over an unmigrated database,
`check-rls` refused, exit 1).

**CI #48 — `main` @ `e86d2bf`, push, Success 1m40s; `verify` job 1m22s, `docs` job green.** Read in
the browser, per step: `Apply migrations` 0s · `Unit and tenancy tests` 14s with all seven DB suites
`✓` at database durations (tenancy 436ms, submit-effects 1408ms, auth 198ms, part-registry 279ms,
chain 226ms, outbox 166ms, assumption 216ms) · twelve checker self-tests and checks green ·
`Kernel coverage gate` 16s green · `Performance budgets` 1s green.
