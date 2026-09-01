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
| R-08, R-09, R-10 | Open (R-09's measurement partly done: 1042 tests / 43 files) |
| R-11 | **Partly** — T-09's migration renumbered to 0009; the rest open |

### R-04: the `release.ts` split, answered

**Declined, for now.** 353 lines holding one concept — what a catalog release is and when it may
change state — is still one coherent module, and the change that grew it also gave it a second file
(`spot-check.ts`) and now a third (`cell-ids.ts`), which is the decomposition happening in the right
direction. Revisit when `apps/api` gives it a fourth caller, not before. Recorded so it is a decision
rather than a deferral.
