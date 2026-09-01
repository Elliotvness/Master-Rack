# LATEST — Rack Master Studio handoff

**Written 2026-09-01. Supersedes nothing: read this first, then `HANDOFF.md` for the
original framing and `docs/CURRENT_STATE.md` for the dated verification log.**

Every number here was measured from the repository on the date above, not remembered.
Where something is unverified, it says so.

---

## 1. What this product is

A client self-service pallet-rack configuration and quote-intake platform whose thesis is a
refusal: **it never states anything it cannot defend.** Where a number is not established,
the system says so and names what would establish it, rather than emitting a plausible
figure. That single commitment explains nearly every unusual decision in the codebase — the
verification tiers, the unresolved register, the provenance lint, the language gate, and the
absence of any interpolation in catalog lookup.

---

## 2. State in one table

| | |
|---|---|
| Commits | **41**, working tree clean |
| Tests | **926 passing** across 39 files |
| Shipped TypeScript | **9,744 lines** |
| Test TypeScript | **9,542 lines** (0.98 : 1 against shipped) |
| Migrations | **863 lines** SQL, 19 tables, RLS on every one |
| Gate tooling | **2,062 lines** across 7 checkers |
| Coverage | **99.49%** statements, 98.86% branches |
| `pnpm verify` | **PASS**, exit 0, 14 sequential steps |
| Acceptance criteria | **18 of 20 enforced by a test** |
| Deliverables | 42 defined; **41 built as logic**, 1 not started, **0 built as UI** |

---

## 3. Honest completion estimate

| Layer | Complete | Basis |
|---|---|---|
| Kernel packages (`A`, `B`, `C`) | **~98%** | 10 pure packages, all at 100% coverage, golden fixtures wired into the run |
| Catalog data | **100%** | 336 beam rows + 3 frame tables, approved, page-referenced |
| Application logic (`D`, `E`) | **~85%** | every module built and tested; no route wiring for internal-web |
| User interface | **0%** | no `.tsx`, no renderer, no bundler |
| Runtime | **0%** | no HTTP server, no `start` script |
| Infrastructure (`E-07`, `E-08`) | **~40%** | contracts and gates built; no credentials, no PDF |
| **Overall** | **~70%** | weighted by remaining effort, not by item count |

**The 70% is honest but uncomfortable, and the shape matters more than the number.**
Everything hard about *correctness* is done and proven. Everything about *being a program a
person can open* is not started.

---

## 4. The single most important thing to understand

**There is no running program.** Verified this session: **0** `.tsx` files, **0** HTTP server
entry points, no `start` or `dev` script, no bundler configuration.

926 tests prove the *logic* of submitting a rack configuration is correct. **None proves a
person can submit one.** The client app is nine tested library modules; it is not a website.
The API is an authorization matrix, a DTO layer and an audit chain; it is not a server.

This is a defensible position — correctness first, and the correctness is real — but anyone
reading "Group D complete" should understand it means *the logic of Group D is complete and
proven*, not *a client can use it*.

---

## 5. What was built, group by group

### Group A — foundation (11 deliverables, complete)
Monorepo with strict TypeScript; `kernel-units` in fixed-point µm and millipounds with
allocate-never-divide and fail-closed provenance; boundary checker with self-test; Postgres
schema with RLS enabled *and forced* on all 19 tables; `withTenant()` as the only path to the
database; sessions with hardened cookies; `authorize()` with a boot-time route-coverage
assertion; the DTO layer with the forbidden-field constant; the audit hash chain; the
transactional outbox.

**Gap:** OIDC for staff and TOTP for clients are **not built** — both need an external
identity provider. `A-07` is therefore ~80%, and this is the one Group A item that is not
what its "Complete" label suggests.

### Group B — catalog and rules (6 deliverables, complete)
378 verified Interlake beam rows migrated out of executable Python into declarative JSON; 3
frame capacity tables (435 reconciled cells); the two-person approval gate where a null
`approved_by` fails the build; the rule pack with verification tiers; and lookup semantics
that return **both brackets and no capacity** on an off-grid span rather than interpolating.

### Group C — the engine (8 deliverables, complete)
`kernel-model` with canonical serialisation and content hashing (hash-stability test written
first); geometry and pallet-position derivation; the clearance index; the eleven MVP checks
with the tier ceiling applied by the framework; the BOM with its unresolved register; the
renderer-neutral display list; the provenance lint; golden fixtures wired into the test run.

### Group D — client application (8 deliverables, logic complete, no UI)
Invitation acceptance with the `AC-01` identical-refusal collapse; facility entry with an
explicit *not known* on every field; the option builder with cascade filtering and stated
reasons; the preview with its staleness guard; the split findings panel; comparison over a
closed metric set; the nine-step submit transaction; status and clone-to-draft.

### Group E — internal application (9 deliverables, mixed)
Cross-org queue with both OD-11 clocks; the §12.4 "show your work" trace answering all four
traceability questions **from stored data with no recomputation**; internal revision
derivation where waivers do not carry over; internal notes as a distinct entity; the
determinism harness; the WORM contract and daily anchor.

**Not built:** `E-08` (client PDF) — the **only** one of 42 deliverables with no
implementation at all. `E-07` needs credentials.

---

## 6. Acceptance criteria: 18 of 20 enforced

`AC-01` through `AC-15`, `AC-17`, `AC-18`, `AC-19` are each enforced by a named test.
`AC-05` is enforced by `check-rls` over 19 tables (the criterion ID was added to that tool
this session, because a control that enforces a criterion without citing it is
indistinguishable from an unenforced one during an audit).

**Genuinely unmet:**
- **`AC-16`** — the client PDF's watermark, disclaimer, revision code and manifest hash.
  Blocked on `E-08`.
- **`AC-20`** — the end-to-end walkthrough of all eight MVP steps. Depends on all of P2 and
  on there being a program to walk through.

---

## 7. The gate discipline, which is the real asset

Seven checkers, five with their own self-test. **The self-tests exist because a broken
checker fails green** — it reports a clean pass forever while the invariant rots.

| Gate | Proves |
|---|---|
| `check-boundaries` | no kernel package reaches I/O, a clock, a framework or RNG |
| `check-app-boundaries` | the client bundle cannot import internal code |
| `lint-provenance` | no formatter is applied to a raw value |
| `check-language` | no shipped string overclaims (`tamper-proof` and 5 more) |
| `check-rls` | AC-05, over every table |
| `check-determinism` | byte-identical output across two hostile environments **and** against a pinned digest |

**74 invariants have been proven to fire by deliberate breakage, then reverted** — counted
from the verification tables in `docs/CURRENT_STATE.md`, every one recording the command and
its actual output. Observing a pass is not evidence; only a red build is.

Three times this session, that discipline caught something a passing test hid:

1. **The language gate's own exemption was too wide.** Widening it to `/lib/` silenced the
   checker across the whole client library and every test still passed. Fixed, then the fix
   *also* passed for the wrong reason (two probes shared a directory name), and that was
   caught too.
2. **A test asserting `5 15/16` rounds to 5.93.** It rounds to 5.94. The failure revealed
   that the manufacturer's printed figure is a *truncation*, which changed how the value is
   documented.
3. **42 phantom catalog rows** surfaced by a cross-check against the source PDF.

---

## 8. Decisions made, with their reasoning

| ID | Decision | Why it was not the obvious choice |
|---|---|---|
| `P0-004` | The as-built drawing is **sole authority** for the Carson count | Two quotes disagreed; averaging them would have invented a number nobody could defend |
| `P0-005` | 59E face height resolved to the published `5 15/16"` | Had been parked with three conflicting readings and no page reference |
| `P0-008` | **PSG 2025 is sole authority for beam capacity** | The Material Catalog covers a different product line and lacks capacity for 12 of 16 families, so the earlier "use it for lookups" advice was *impossible to satisfy*, not merely wrong |
| `P0-009` | Store the **exact fraction**, display one decimal | One decimal *stored* drifts 1.25" over a 20-level stack, in the direction that reports more clear height than exists |
| — | **Backblaze B2, not Cloudflare R2**, for manifests | R2's bucket locks are removable by one documented command; the threat is an insider, and a lock the attacker can remove is not a control |

Every rejected option is recorded **with its reason**, so nobody later "restores" it believing
it was dropped by accident.

---

## 9. What is blocked, and on exactly what

### `E-08` — watermarked client PDF — **BLOCKED**
Needs the **standing disclaimer text, verbatim**. This is a legal document governing
liability; inventing plausible legal text is the precise failure this product exists to
prevent. Either paste it, or authorise extraction from `docs/CALC_PACKAGE.md` in the
reference tree (the blueprint says it "already articulates the preliminary-vs-final boundary
this product needs"), for approval before use.

Also needed: the exact **company and contact name** for the title block (`OD-16` permits those
two only — never a licence number, seal, stamp or engineer's name), and the **document number
format** for `…_P01_PRELIMINARY.pdf`.

### `E-07` — WORM storage — **awaiting credentials**
Decided: **Backblaze B2**, Object Lock, **Compliance** mode, **7-year** retention (2557 days —
seven years plus two leap days, rounded up, because retention that expires early is a silent
failure). Staged: prove upload-then-overwrite fails on a **Governance** test bucket first,
because Compliance is irreversible. Timestamp authority: **FreeTSA**.

**The one thing no test here can establish:** whether the live provider actually refuses. Only
an upload-then-overwrite attempt against a real bucket can show that. Also test
`DeleteObject` inside a locked prefix. *(That report was against R2 bucket locks, not B2 —
recorded accurately rather than carried to the wrong vendor, but still worth proving.)*

### Not blocked, just not started
The UI. Every module it needs is built and tested.

---

## 10. If you pick this up tomorrow

**Read first:** this file, then `docs/CURRENT_STATE.md` (dated verification log with real
command output), then `TODO.md` (per-item status with commit references).

**Run first:** `pnpm verify`. It should print PASS and exit 0 after 14 steps. If it does not,
stop and fix that before anything else.

**Standing rules, learned the hard way:**
- A gate is not proven by passing. Break it deliberately, watch it go red, revert.
- Never invent a value. A refusal must state *why* and what would resolve it.
- Delete dead code rather than testing around it. An unreachable guard implies a doubt the
  types have already settled.
- Record the verification command **and its actual output**. Nothing is complete without it.
- The four trees under `Resourse (do not delete or overwrite files)\` are **read-only**.
- Shell quirk: `&&` chaining here can produce misleading exit codes. Use
  `&& echo PASS || echo FAIL`, or a Python subprocess wrapper.

**Highest-value next work, in order:**
1. **The disclaimer text** — one paste unblocks `E-08` and `AC-16`.
2. **B2 credentials + the live overwrite test** — closes `E-07`, and is the only way to
   validate the claim we make to clients about the record surviving an insider.
3. **A running program** — the largest gap between this repository and a product. Wire the
   API routes to a server, then build the client UI on the nine tested modules.
4. **`AC-20`** — the end-to-end walkthrough, once there is something to walk through.

**Two claims in this repo remain unverified, and are labelled as such:** CI has never been
observed green (no remote exists), and the `E-01` queue performance target (p95 < 800 ms at
5,000 submissions) needs a seeded dataset that does not exist.
