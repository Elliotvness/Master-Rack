# LATEST — Rack Master Studio handoff

**Written 2026-09-01 (second session of the day). Supersedes the earlier 2026-09-01 entry.**
Read this first, then `tasks/plan.md` for the route forward, `tasks/todo.md` for per-task status,
`HANDOFF.md` for the original framing, and `docs/CURRENT_STATE.md` for the dated verification log.

Every number here was measured from the repository today, not remembered. Where something is
unverified, it says so.

---

## 1. What happened this session

A conformance audit of the build against the Rev C blueprint
(`../rack-master-studio-conformance-audit.html`), then the first five remediation tasks.

**Six commits, on `fix/catalog-release-integrity`, branched from `main` at `0f1e7ac`.**

| Commit | Task | What |
|---|---|---|
| `d82c5eb` | — | `tasks/plan.md` + `tasks/todo.md`: 26 tasks, 5 phases, 6 architecture decisions |
| `7559889` | T-01 | Frame tables into the approved release; completeness gate; **manifest loader** |
| `eeaafef` | T-02 | `interlake-2026-08` quarantined — wrong, not merely old |
| `52f708a` | T-04 | The approver's own spot-check required; `2026-09` returned to DRAFT |
| `73ca8d1` | — | `audit_event`: a client admin reads its own people's events, not ours |
| `75192d0` | T-03 | The `revision.audience` RLS predicate + a checker so it cannot recur |

**Not yet pushed.** The remote exists (`https://github.com/Elliotvness/Master-Rack.git`) but the
Linux workspace has no credentials. Run from Windows:
`git push -u origin main && git push -u origin fix/catalog-release-integrity`

---

## 2. State in one table

| | | change |
|---|---|---|
| Commits | **48** | +6 |
| Tests | **961 passing** across 42 files | +35 |
| — of which DB-backed | **74** | first execution ever |
| Migrations | **6** (was 4) | +2 |
| Gate tooling | 7 checkers, 5 self-tested | `check-rls` extended |
| Coverage | 100% on all pure packages; ratcheted floors on `apps/` | held |
| `tsc --build` · `eslint` | exit 0 · exit 0 | |
| Acceptance criteria | **18 of 20** enforced | AC-14 now enforced at the DATABASE, not by a filter |
| Blueprint conformance | ~70% of MVP-1 scope | from 68%. **Reconciled 2026-09-01 (R-11): this is not comparable to the scoreboard's 13.3%.** Conformance measures requirements met across all of MVP-1; `tasks/progress.md` measures tasks executed in the remediation plan. Different denominators, both honest. Neither is the answer — **blueprint §15.2 is, and it stands at 0 of 8.** This 70% has not been re-derived since the audit and should be treated as a repository claim, not a measurement |

---

## 3. The three things a reader most needs to know

### 3.1 No catalog release is currently pinnable, and that is correct

`interlake-2026-09` is back to **DRAFT**. It said `APPROVED` because a human typed those characters
into JSON — `approveRelease()` never returned it, and no person had read a single cell of the
source. Its recorded verification was two *machine* extractions reconciled by a *machine*, which
section 10.2 anticipated by name: *"a machine is a tool, not an independent party."*

This blocks nothing today because no revisions exist. **It takes about an hour to clear:**

```
data/catalog/interlake-2026-09/manifest.json → pending_spot_checks
```

20 beam cells and 22 frame cells are already **drawn and pinned** (seed `20260901`, by
`tools/draw-spot-check.mjs`, which refuses to redraw a pinned sample — one you can reroll until it
is convenient is not a random sample). Read each off PSG 2025 p.88, record `checked_by`,
`checked_at` and `outcome: MATCHED`, and the release approves. **Any mismatch fails the entire
release** — no partial pass, no "approve with notes".

### 3.2 A real leak was closed, and proven closed

`app.revision.audience` was `NOT NULL`, indexed, correctly commented — and named in **no RLS
policy**. A derived internal revision carries the *client's own* `organization_id`, so the tenant
predicate passed it straight through. The only thing preventing the leak was an `Array.filter()` in
a front-end package.

Reverting to the old policy against a real Postgres turns four tests red. With it, a client can
**read** the internal revision derived from its own submission, **write** a row with
`audience='internal'` into its own organization, and **flip** one of its own revisions to internal —
a one-way disappearance from its own view. That is demonstrated, not argued.

`stripInternalRevisions()` was deliberately kept. Two independent controls is the design; one of
them being the only one is not.

### 3.3 A product decision was taken that should be reviewed

`check-rls` now asserts that any sensitivity column (`audience`, `actor_type`) is named in a policy.
On its first run it found `app.audit_event`, which keyed on `subject_organization_id` — the
organization an event is *about*. A client admin could therefore read `revision.derived` and
`bom.viewed` performed by staff on their own job, which names an internal revision into existence
that AC-14 requires to be absent.

**The fix narrows what a client admin sees** to events their own client principals generated. If the
intent was for clients to see an activity feed including our work on their job, this is the wrong
call and should be reverted — but AC-14 and that cannot both hold. Flagged for EL.

---

## 4. Running the tests, and the figure that was wrong

**Superseded 2026-09-01 (session 3).** The recipe that used to live here — `embedded-postgres`
18.4, plus dropping `@esbuild/linux-x64` and `@rollup/rollup-linux-x64-gnu` into a Windows
`node_modules` — existed because nothing better was available. Something better is available. It is
kept below only as a footnote, because it still works if you are driving the Windows checkout
directly.

**Use this instead.** A clean clone in a Linux workspace with network, which installs its own
dependencies for its own platform and needs no binary surgery — and against **native PostgreSQL
16**, which is the major version CI pins rather than the 18.4 the embedded package produces:

```bash
git clone https://github.com/Elliotvness/Master-Rack.git && cd Master-Rack
pnpm install --frozen-lockfile                       # ~10 s, no platform patching

su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pg16 -U postgres --auth=trust --pwfile=/tmp/pgpw"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg16 \
  -o '-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
psql -h 127.0.0.1 -p 55432 -U postgres -c 'create database rms;'

export DATABASE_ADMIN_URL='postgresql://postgres:postgres@127.0.0.1:55432/rms'
export DATABASE_URL='postgresql://app_user:app_user_dev_only@127.0.0.1:55432/rms'
node tools/migrate.mjs && pnpm test && node tools/check-rls.mjs
```

`initdb` refuses to run as root, hence `su postgres`. The daemon survives between shell
invocations, so unlike the old recipe it does not have to be started in the same command as the
tests.

**Measured 2026-09-01 with exactly that:**

| | |
|---|---|
| `pnpm test` with the database | **44 files, 1,081 tests, 0 skipped** |
| `pnpm test` without it | 42 files, 1,014 passed, **67 skipped** — `tenancy` (41), `auth.db` (12), `chain.db` (8), `outbox.db` (6) |
| `node tools/migrate.mjs` | 8 migrations applied to Postgres 16.13 |
| `node tools/check-rls.mjs` | **PASS** — 19 tables, 8 sensitivity columns |
| `pnpm typecheck` · `pnpm lint` | exit 0 |

**And the figure this document has been repeating is wrong.** "1,042 tests passing" appears
throughout the handoff trail. It is **1,081** — and after `T-05` landed, 1,084. The scoreboard was
right to carry 1,042 as an unverified repository claim; it is now measured, and it did not survive
the measurement. Quote 1,081 as of `dab5a8e`, and re-run rather than re-read it.

<details>
<summary>Superseded: the embedded-postgres recipe, for a Windows checkout</summary>

```bash
cd /tmp && mkdir pgtest && cd pgtest && npm i embedded-postgres
node -e "import('embedded-postgres').then(async({default:P})=>{const p=new P({databaseDir:'/tmp/pgtest/data',user:'postgres',password:'postgres',port:55432,persistent:true});await p.initialise();await p.start();await p.createDatabase('rms');})"
```

Then **in the same shell invocation**, because a backgrounded daemon dies with the shell:

```bash
PGBIN=/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native/bin
$PGBIN/postgres -D /tmp/pgtest/data -p 55432 -k /tmp/pgtest > /tmp/pgtest/pg.log 2>&1 &
for i in $(seq 1 25); do sleep 1; grep -q "ready to accept" /tmp/pgtest/pg.log && break; done
```

This is Postgres **18.4** where CI pins **16**. It also needed `@esbuild/linux-x64` and
`@rollup/rollup-linux-x64-gnu` dropped into a Windows `node_modules/.pnpm/`, which a `pnpm install`
then clears — a workaround that had to be repeated after every install. Both problems disappear with
a clean clone.

</details>

---

## 5. What is blocked, and on exactly what

| Blocked | On | Who |
|---|---|---|
| `interlake-2026-09` approval | 42 pinned cells read off the source | EL, ~1 hour |
| CI ever running | `git push` from Windows — no credentials in the workspace | EL, 2 minutes |
| `E-08` client PDF · `AC-16` | The standing disclaimer text, verbatim; company + contact name; document number format | EL + counsel |
| `E-07` WORM proof | Backblaze B2 credentials; Governance test bucket first, Compliance is irreversible | EL |
| R-01 retired | One external client submitting unaided (`OD-20b`) | EL |
| Audit-log narrowing | Confirm §3.3 is the intended behaviour | EL |

---

## 6. New findings this session, not in the audit

1. **`packages/*/tsconfig.json` excludes `src/**/*.test.ts`.** Test files are never type-checked, so
   a fixture can drift from a changed type invisibly. Hit directly this session. Filed as **T-27**.
2. **The approval gate had never run against a manifest on disk.** It was thoroughly unit-tested
   against objects the tests constructed — guarding the test, not the data. Fixed in T-01.
3. **`app.audit_event` leaked staff actions to client admins.** Found by the checker built in T-03,
   on its first run. Fixed in `73ca8d1`.
4. **Verification was recorded per *release*, not per *dataset*.** Beams and frames reached
   `2026-09` by different routes; one record claiming to cover both asserts a verification that never
   happened. Fixed in T-01.

---

## 7. If you pick this up tomorrow

**Run first:** the Postgres recipe in §4, then `pnpm verify` on Windows. It should be green.

**Highest-value next work, in order:**

1. **Push, and watch CI go green once** (`T-00`). Every "CI is green" claim in this repo is still
   unproven.
2. **The 42-cell spot-check** — one hour, and it converts the strongest data asset in the product
   from "a machine says so" to "a named person read twenty cells the machine chose".
3. **T-05 / T-06 / T-07** — the remaining structural defects: the `contentHash`/`manifestHash`
   conflation, the acknowledgement that is never recorded, and moving the submit orchestration out
   of the client bundle. All specified in `tasks/todo.md`.
4. **Then Phase 3** — `packages/contracts` before the server, on the blueprint's own argument that
   the leakage contract is worth ten times more written against six routes than two hundred. There
   are currently zero.

**Standing rules, unchanged and still earning their keep:**

- A gate is not proven by passing. Break it deliberately, watch it go red, revert. Eleven were
  broken and reverted this session; two of them found something.
- Never invent a value. A refusal states *why* and what would resolve it.
- Record the verification command **and its actual output**. Nothing is complete without it.
- The four trees under `Resourse (do not delete or overwrite files)\` are read-only.

**Decisions taken with EL this session:** Fastify for the API; Vite + React Router v7 SPA for both
front ends — the SPA choice being the strongest form of the §6.3 two-bundle guarantee, since there
is no server-render path that could import internal code.
