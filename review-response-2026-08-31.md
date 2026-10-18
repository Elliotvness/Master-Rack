# Response to the section-by-section review

**Written 2026-08-31 against blueprint Rev C (`rack-master-studio-blueprint.html`, 316,002 bytes).**

Two parts, because the review has two very different halves.

Part A answers *"any statement corrections?"*. The short answer is that most of the flagged
statements are not in the blueprint — several of them are the exact opposite of what it says.
Part B answers *"a full list of all missing comments that you recommend adding"*: 63 items,
each with an ID, a target section, and a disposition you can set item by item.

Part C lists the recommendations that must **not** be adopted, because they collide with a
settled decision or the scope fence.

---

## Part A — statement corrections

I checked each flagged statement against the built document. The reviewed text does not match
the delivered blueprint. Twelve examples, verbatim from the file:

| The review says the document states | What the document actually states | Where |
|---|---|---|
| "Audit logs are retained for 90 days, after which inactive audit records are permanently deleted." | "Retention: audit events **7 years in WORM, 13 months hot and queryable**; application logs 30–90 days." | NFR-AUD-06, §5.3 |
| "Internal fields are excluded from client views by filtering the API response JSON in the web application." | "Internal fields are **not filtered out late**; they live in tables a client-facing query cannot reach." | §6.2, §9.1 |
| Dimensional attributes are floating-point | "fixed-point **µm** and millipounds, unit + origin on every value, allocate-never-divide" | §7.3, A-02 |
| Staff can unlock a SUBMITTED revision back to DRAFT | A frozen revision is immutable **at the database layer**, for every principal including staff. There is no unlock path; refinement happens in a separate derived lineage that never writes back. | §13.3, §13.5 |
| Three primary role classes | **Five** principals, with a full permission matrix | §2.1–2.2 |
| A "Guest Viewer" role for unauthenticated preview links | Invitation-only. No public or guest access anywhere — settled as OD-04. | §2, §14.3 |
| Cross-tenant access returns 403 | **404, never 403.** A 403 confirms the object exists. | §14.2 |
| Discontinued parts are deleted from the catalog | Discontinued parts stay **resolvable** — a submitted revision must regenerate byte-identically years later. | §7.2, §10.3 |
| Internal service traffic is unencrypted HTTP | The document does not describe internal transport at all. See **N-31** in Part B — this is a real gap, but it is a gap, not an error. | §6, §14 |
| The client app renders a 3D canvas | No 3D in any phase. It is on the do-not-build fence in §19.2 and restated in §17. | §19.2 |
| Clients can swap structural components | Clients never select structural components. They choose within controlled options; component selection is internal. | §4, §9.2 |
| A DXF/DWG export for clients | Never for clients. §19.2 excludes it explicitly. | §19.2 |

**What I think happened.** The review is written against a different document — one with a
"Section 09 Output projections & watermark controls", a "Section 12 Integration & export
pipelines", and a 3D SPA architecture. My §9 is *client-visible vs internal* and my §12 is
*BOM and takeoff*. The section titles, the architecture, and the failure modes all belong to
something else.

So I have made **no statement corrections to the blueprint**, and I would not want to: applying
these as corrections would move the document from its position to the weaker one in nine of the
twelve rows above.

**Two flags in the review are right, and are gaps rather than errors:**

- Internal service-to-service transport is genuinely unspecified (**N-31**).
- Object-storage access for client documents is genuinely unspecified (**N-33**).

**One is half-present.** Idempotency keys exist, but on exactly one route:
`POST /api/client/v1/revisions/:id/submit — freeze + manifest + create submission — client,
idempotency key required`. Extending the requirement to every state-mutating route is a real
addition (**N-30**).

---

## Part B — recommended additions

63 items. Every one is checked against the scope fence: this product **records inputs and names
gaps**; it never concludes compliance, approval, or structural adequacy. Where an item touches a
question with an authority behind it, the recommendation is to capture the input and emit a
`MISSING INPUT` / `ENGINEERING REVIEW REQUIRED` finding — never a pass.

Sizes: **S** ≈ under a day, **M** ≈ 1–3 days, **L** ≈ a week or more.

### B1. Site and physical inputs — §4 (functional), §7 (model), §11 (validation)

These are the inputs a preliminary layout silently assumes today. Capturing them costs little and
converts a hidden assumption into a recorded one.

| ID | Add | Why | Size |
|---|---|---|---|
| N-01 | `facility.slab_thickness`, `slab_fc`, `joint_grid`, `slab_survey_status` on the facility record, all nullable, all defaulting to `MISSING INPUT` | §12 already says footplates and shims are "UNRESOLVED — depends on slab condition, which is not surveyed at this stage". That is the right answer, but the input has nowhere to live. | S |
| N-02 | A `BLOCKER`-free `ASSUMPTION` finding whenever base-plate or anchor quantities are derived with `slab_survey_status = NOT_SURVEYED` | Makes the assumption visible on the client's own preview instead of only in our heads. | S |
| N-03 | `facility.seismic_ss`, `seismic_s1`, `site_class`, `risk_category` — **recorded, never evaluated** | The single most common reason a preliminary layout is wrong. Recording it lets §11 emit `ENGINEERING REVIEW REQUIRED` with the actual site numbers attached instead of a generic caveat. Explicitly **not** a seismic calculation — that stays on the fence. | S |
| N-04 | `facility.clear_height`, `deck_height`, `low_steel`, `obstruction_height` with the measurement convention named on each | Top-of-load clearance is currently derivable only if someone typed the right number into the right box with no stated convention. | S |
| N-05 | Building column grid as first-class geometry (spacing, size, orientation) rather than the per-run disposition flag in FR-CP-10 alone | FR-CP-10 asks the client to resolve each column. It cannot check the answer without knowing where the columns are. | M |
| N-06 | `facility.floor_flatness_ff`, `floor_levelness_fl`, nullable | Only material for VNA-adjacent aisle widths; cheap to carry, impossible to retrofit into a submitted revision. | S |
| N-07 | Dock, door and egress-path geometry as a keep-out region type | Aisles that end in a door are a layout error the client can see and we currently cannot. | M |
| N-08 | A generic `keep_out_region` (polygon + reason + source) covering columns, drains, mezzanine footings, existing equipment | One concept instead of five special cases. Also the natural home for "the client said there is something here". | M |
| N-09 | `unit.ambient_class` (dry / freezer / cooler / outdoor) as a recorded input | Changes finish, fastener and clearance answers downstream. Record now; no rule reads it in MVP-1. | S |

### B2. Material-handling inputs — §4, §11

| ID | Add | Why | Size |
|---|---|---|---|
| N-10 | `mhe_profile`: type, right-angle stacking aisle, load length, mast collapsed/extended height, capacity at height, turning radius | The review's strongest single point. Aisle width without an MHE profile is a number with no basis. | M |
| N-11 | Validation: configured aisle width vs the profile's right-angle stacking aisle + a stated clearance allowance, emitting `WARNING` with both numbers and the allowance's origin | Checkable, sourced from the client's own equipment, and makes no compliance claim. | M |
| N-12 | Validation: mast extended height vs top beam elevation + load height | Catches the layout that cannot physically be served. | S |
| N-13 | A small seeded MHE catalog (a dozen common trucks) with `verification_tier` on every row, plus free entry | Most clients know the truck model, not its stacking aisle. Seeded rows are `SECONDARY` at best and must say so. | M |
| N-14 | `WARNING` when the MHE profile is absent and any aisle-width-dependent output is produced | Same shape as N-02: an assumption you can see. | S |

### B3. Clearance and geometry rules — §11

All of these emit facts and gaps. None emit "compliant".

| ID | Add | Why | Size |
|---|---|---|---|
| N-15 | Transverse and longitudinal **flue** as computed, reported dimensions on every layout | §10.8 already carries the unresolved 21.5"-vs-12" question and §11 already refuses to call flue "compliant". The dimension itself is still not reported. Report the fact; keep the refusal. | M |
| N-16 | Top-of-load to sprinkler/low-steel clearance as a reported dimension with a `MISSING INPUT` when either side is unknown | Same treatment as flue: a fact, never a conclusion. | M |
| N-17 | Beam **deflection limit** as a rule-pack-driven check, with `deflection_limit` and `code_basis` already in the rule schema doing the work | §10 already carries `deflection_limit` and `code_basis` fields. Nothing reads them. This closes that loop and inherits the verification-tier ceiling automatically. | M |
| N-18 | Tunnel-bay / cross-aisle clearance rule, driven by the same keep-out concept as N-08 | Common in the reference jobs, absent from the model. | M |
| N-19 | Back-to-back row spacer dimension reported explicitly, with the "UNRESOLVED — depends on the fire/storage profile" note attached to the number rather than to the section | §12 flags the reference implementation hardcoding a 12" spec string while ignoring the editable value. Reporting the configured value makes that divergence visible. | S |
| N-20 | End-of-aisle and end-of-row protection as a recorded option with quantity implications, not a rule | Estimating asks for it every time. | S |
| N-21 | Load overhang front/back/side as explicit configuration with a reported result | Currently implicit in bay depth. | S |
| N-22 | Rub-rail / guide-rail requirement flag driven by `mhe_profile.type = VNA` | Records the dependency without asserting it. | S |
| N-23 | Minimum and maximum first-beam elevation as a validated range | Cheap catch for an entry error that otherwise reaches a quote. | S |

### B4. Derivation, performance and the client app — §6, §5

| ID | Add | Why | Size |
|---|---|---|---|
| N-24 | Run the derivation kernel **off the main thread** in a Web Worker, with a monotonic sequence ID on every request and results from a stale sequence discarded | The single best item in the review. A 900-bay layout re-deriving on the main thread on every keystroke is the most likely way MVP-1 feels broken. The kernel is already pure, so this is a transport change, not a design change. | M |
| N-25 | An explicit statement in §6.1 that the Worker loads **the same compiled kernel artifact** as the server, verified by hash at build time | Otherwise the Worker quietly becomes the second implementation the boundary checker exists to prevent. | S |
| N-26 | Input debounce + coalescing policy, stated as a number in §5.1 rather than left to implementation | An NFR you can fail. | S |
| N-27 | A stated derivation-latency budget by layout size (e.g. p95 under X ms at 200 / 900 / 2000 bays) and a CI benchmark that fails the build when exceeded | §5.1 has responsiveness targets; it has no derivation budget, which is the thing that will actually blow them. | M |
| N-28 | Display-list rendering budget stated separately from derivation, since they fail independently | Keeps a slow renderer from being blamed on the kernel and vice versa. | S |
| N-29 | Cancellation semantics: what happens to an in-flight derivation when the input changes again | Names the race before it is a bug report. | S |

### B5. API, transport and integration — §8, §14

| ID | Add | Why | Size |
|---|---|---|---|
| N-30 | **Idempotency keys required on every state-mutating route**, not only `submit` — with the key, the response hash and the outcome stored, and a replayed key returning the original response | Half-present today. A double-tapped "add bay run" on a flaky connection is the common case; submit is the rare one. | M |
| N-31 | Specify internal service-to-service transport: mTLS with short-lived certificates, or an equivalent named mechanism, and say plainly which | Genuinely unspecified. §14's threat model stops at the edge. | M |
| N-32 | Per-tenant and per-principal rate limits, not only the edge WAF limits in §6.2 | An edge limit protects the platform. A per-tenant limit protects tenants from each other and is the one that matters for a shared database. | M |
| N-33 | Short-lived, scoped, single-use signed URLs for every client document fetch, with the expiry stated and the object key carrying no guessable structure | The client PDF has to come from somewhere and the document never says where. | M |
| N-34 | State that signed URLs are **not** an authorization boundary — the authorization decision happens before minting, and the URL is a delivery mechanism | Prevents the classic "we already checked, the URL is enough" regression. | S |
| N-35 | A written API versioning and deprecation policy for `/api/client/v1` — how v2 is introduced, how long v1 survives | Two namespaces make this cheap now and expensive later. | S |
| N-36 | Request-size, nesting-depth and array-length limits on every write route, stated once and enforced centrally | A 40,000-bay payload is a denial of service with no exploit needed. | S |
| N-37 | Explicit `Cache-Control: no-store` on every client-visible internal-adjacent response, plus a statement about shared-cache behaviour | Cheap; catches the CDN that caches a tenant's preview. | S |
| N-38 | Webhook/outbox delivery semantics stated: at-least-once, consumer-side dedupe on event ID, ordering guarantees | A-11 introduces the outbox; nothing says what consumers may assume. | S |

### B6. Data model and database — §7

| ID | Add | Why | Size |
|---|---|---|---|
| N-39 | **Partial unique indexes** on every soft-deletable table (`WHERE deleted_at IS NULL`), composite with `organization_id` as §7 already requires | Without it, a soft-deleted row permanently blocks its own name from being reused — and the error message leaks that a row exists. | S |
| N-40 | State the soft-delete policy per table rather than globally: which tables soft-delete, which hard-delete, which never delete | Currently ambiguous, and it interacts with immutability. | S |
| N-41 | An explicit statement that `audit_event` and any submitted-revision table are **hard-delete-forbidden at the grant level**, not only by trigger | Defence in depth for invariant 3. | S |
| N-42 | Optimistic concurrency (`version` column + conditional update) on the revision aggregate, with a stated conflict-resolution behaviour | Two staff members in the same draft is a Tuesday, not an edge case. | M |
| N-43 | A stated ordering key for repeated child collections (bay runs, beam levels) so a BOM regenerates byte-identically regardless of row order | Invariant 7 depends on this and nothing currently guarantees it. | S |
| N-44 | `CHECK` constraint enforcing the `part_revision_id` XOR `uncatalogued_part_id` rule in the database, not only in application code | The XOR is the load-bearing decision in §7. It should be impossible to violate. | S |
| N-45 | Numeric domain constraints at the column level (non-negative lengths, plausible upper bounds) with the bounds stated | Catches the unit error that produces a 40-metre beam. | S |
| N-46 | A retention and purge policy for **draft** revisions, separate from submitted ones | Submitted is 7 years. Draft is undefined and will grow forever. | S |

### B7. Submission, audit and immutability — §13

| ID | Add | Why | Size |
|---|---|---|---|
| N-47 | Say what happens when the RFC 3161 anchor is **unavailable** at submit time: queue and anchor later, with the submission recording `anchor_pending` and the audit event recording both timestamps | Currently the external anchor is described as if it always succeeds. | M |
| N-48 | A periodic hash-chain verification job with an alert, plus a documented procedure for what to do when it fails | A chain nobody verifies is a chain nobody knows is broken. | M |
| N-49 | Clock-source and skew policy for anchoring and audit ordering | Ordering claims rest on it. | S |
| N-50 | State the watermark's failure mode: if watermark application fails, the document is not produced — never produced unwatermarked | The preliminary-output rule is the product's most exposed promise. It needs a fail-closed statement. | S |
| N-51 | Watermark and disclaimer applied in the **document generator**, below any per-format path, so PDF/PNG/print all inherit it from one place | Prevents the third export format that forgot. | M |
| N-52 | Manifest coverage assertion: a test that fails when a new field is added to the revision aggregate but not to the canonical manifest | The realistic immutability failure is an un-hashed new field, not a broken hash. | M |
| N-53 | State the canonicalization spec by name (RFC 8785 JCS) rather than "canonical JSON", including number and Unicode handling | Two implementations of "canonical" is exactly the bug that breaks invariant 7 in year three. | S |
| N-54 | Legal-hold flag that can extend but never shorten retention | Cheap now, painful to add after the fact. | S |

### B8. Catalog, provenance and BOM — §10, §12

| ID | Add | Why | Size |
|---|---|---|---|
| N-55 | Supplier lead time and availability as **recorded, non-client-visible** catalog attributes, feeding an internal-only signal | Estimating asks; the client must never see it. Belongs in the internal-only table set by construction. | M |
| N-56 | Multi-sourcing: allow a part revision to carry more than one supplier mapping, with one marked primary | The reference data already has cases the single-mapping model cannot represent. | M |
| N-57 | State that lead time, supplier and availability are on the §9.2 forbidden list explicitly, so N-55 cannot leak through a future serializer | Adding an internal field without adding it to the forbidden list is the leak path. | S |
| N-58 | A catalog **diff report** between released versions, generated automatically and reviewed as part of the two-person rule | The two-person rule currently reviews a file, not a change. | M |
| N-59 | A quarantine reason taxonomy, so the seven quarantined tables in `rack-app` carry a machine-readable reason rather than prose | Makes "do not port this" enforceable by the boundary checker. | S |
| N-60 | Round-trip test: every published capacity table row re-derives its own lookup key from stored µm and matches | This is the check that would have caught the 18-of-21 span problem before it was found by hand. | M |

### B9. Test and acceptance — §16

| ID | Add | Why | Size |
|---|---|---|---|
| N-61 | A leakage fuzz test: walk every client-facing response at arbitrary nesting depth and fail on any forbidden key, driven by the §9.2 constant | Invariant 1 says "at any nesting depth". Nothing currently tests at any nesting depth. | M |
| N-62 | An RLS escape test that runs the full client route table as tenant A holding tenant B's identifiers, asserting 404 on every one | Turns §14.2 from a policy into a gate. | M |
| N-63 | A determinism soak: regenerate every fixture's BOM 100× across process restarts and assert byte identity | Invariant 7, actually exercised. | S |

---

## Part C — do not adopt

Six recommendations from the review collide with something already settled. Recording them here
so they are not adopted by accident later.

| Recommendation | Why not |
|---|---|
| A "Guest Viewer" role / unauthenticated preview links | Invitation-only is settled (OD-04). A shareable preview link is an unauthenticated read of client-scoped data, and it defeats the invitation token design in §14.3. |
| Client-side component swapping | Clients never select structural components. That boundary is what makes the two-option model defensible and what keeps a client from configuring something we then have to disown. |
| 3D canvas rendering in the client app | On the do-not-build fence in §19.2, in every phase. Plan and elevation only. |
| Client-facing DXF/DWG export | §19.2, never for clients. It is the drawing-travels-to-competitors problem the product exists to solve. |
| LOD / instanced meshes | Follows 3D. Not applicable to a 2D display list. |
| Field-filtering internal data out of shared responses | §9.1 rejects this by design. Adopting it would replace the structural control with the exact serialization-bug class it was chosen to avoid. |

---

## What I have not done

Nothing in this file has been applied to the blueprint. The standing instruction is to stop
after the deliverables and wait, and Rev C's decision set is closed — so these are proposals
against a frozen document, not edits to it.

If you want them in, the shape I would suggest is a **Rev D** that takes B1–B3 (the site, MHE and
clearance inputs) and N-24/N-25 (off-main-thread derivation), because those change the data model
and are expensive to retrofit after Phase 0 starts. Everything in B5–B9 is additive and can land
against the running build without a revision bump.
