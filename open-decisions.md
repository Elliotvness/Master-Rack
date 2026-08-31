# Open Decisions

Twenty decisions needed before development on Rack Master Studio starts. Companion to §18 of `rack-master-studio-blueprint.html`.

Ordered by how much rework a late answer causes.

- **🔴 Blocking** — gates work that starts early.
- **🟡 Phase 2** — can wait, but should not drift.

Each entry says what happens if it is not answered.

> **Status, 2026-08-31 — decision set closed.** Every decision is settled. The approval-gate loophole is closed by gating on the verification act rather than the digitiser identity; the SLA clocks are renamed *acknowledgement* and *quote delivery*; the three Phase 2 decisions are taken on their recommendations; OD-06 is confirmed as millimetres displayed, ×1000 stored.
>
> **One thing is deliberately not closed: the name of the external pilot client (`OD-20b`).** Its selection criteria are settled and one audited account fits them, but choosing the account is a commercial judgement and is recorded as yours. `R-01` — will a client actually do this work — stays open until an outside organization completes a submission unaided. Nothing else blocks Phase 0. **OD-06** needs one word confirmed (millimetres on screen, ×1000 in storage — see the follow-up note). **OD-17 is answered and has since been re-cut against the source quotes** — see the revised entry. **OD-21 is answered:** catalog-only with an explicit off-ramp. **OD-20** remains TBD. Phase 2 decisions OD-14, OD-18 and OD-19 are untouched, which is fine. The decision log is at the end of this file.

---

## When each answer is actually needed

The blocking/deferrable split above is coarser than the real dependency graph, and it overstates urgency. Checked against the backlog in blueprint §15.3, **every decision that gates Phase 0 is answered.** The three outstanding items gate specific later points, not the start of work.

| Outstanding | Earliest task it gates | Last responsible moment | Can it wait? |
|---|---|---|---|
| **OD-06** storage base | `A-02` kernel-units — the first kernel task | Before `B-02` / `C-08`, when the catalog is ingested and the golden fixtures are written | **Yes — and it needs a veto, not a decision.** See below. |
| **OD-06** confirmation | `A-02` kernel-units | Before `B-02` / `C-08` | **Yes** — proceed on ×1000 storage; one word settles it. |
| **OD-17** matching feature | Phase 2 | When Phase 2 is planned | **Yes.** Nothing is needed now — the engine already refuses to invent a capacity for used material, so the safe behaviour is the default. |
| **OD-20** pilot client | nothing in Phase 0 or MVP-1 development | Before MVP-1 ships to anyone | **Yes, with a real cost.** See below. |
| **OD-02** Entra licence tier | SCIM provisioning only, not OIDC sign-in | Before staff offboarding matters in practice | **Yes.** Build OIDC now; it works on any tier. Without P1 there is no automatic deprovisioning and offboarding becomes a manual checklist item — a process gap, not a build gap. |
| **OD-07** fallback approver | `B-04` release gate | Before the first catalog release is approved | **Yes**, but it is a five-minute decision and the gate is designed to refuse without it. |
| **OD-11** SLA measurement | `E-02` queue, once clients can see status | Before the targets are shown outside | **Yes.** Record actuals on the first ten submissions first. |

### OD-06 is a veto window, not a decision

This one gates the very first kernel task, which sounds urgent — but there is no future answer that makes micrometres wrong:

- If the dual-unit decision stands, µm is correct (exact for both inches and whole millimetres).
- If dual units are dropped later and the product goes US-only, µm is still correct — just finer than strictly needed. Nothing breaks.
- Millimetres are the only other candidate, and they cannot represent the published lookup grid.

So **proceed on micrometres and treat this as a veto window.** It closes when the catalog is ingested and the golden fixtures are written (`B-02`, `C-08`), because re-basing is a one-file change before that and a wide mechanical change after. If nothing is said before then, µm stands.

### OD-20 can wait, and here is what deferring actually costs

Nothing technical. Phase 0 is tenant plumbing, row-level security, authorization, DTOs and the audit chain — none of it is client-specific, and none of it changes based on who the pilot is. MVP-1 can be built end to end without a named client.

The cost is not rework, it is that **MVP-1 gets built against assumptions instead of against one real building.** The later a pilot client appears, the less they shape the product and the more likely the first real submission surfaces something the design did not anticipate. It also leaves the central premise — that a client will do this configuration work themselves — untested for longer.

Practical middle ground: start Phase 0 now, and name the pilot before `D-03` (the option builder), which is the first task where a real client's actual requirements would change what you build.

---

## 🔴 Blocking

### OD-01 — Where does this run?

**Decision:** cloud provider, region, and whether any client will contractually require data residency or a dedicated database.

**Options:** single-region managed Postgres + object storage · a specific vendor's platform · self-hosted.

**Recommendation:** single-region managed Postgres with Object Lock-capable object storage. Design the tenant plumbing so that database-per-tenant is a configuration change rather than a rewrite, and keep it as an escape hatch for the one enterprise client whose procurement demands it.

**If unanswered:** the audit and immutability design cannot be finished — WORM retention is a storage-tier decision, not an application one.

---

### OD-02 — Which identity provider for internal staff?

**Decision:** determines the SSO integration and whether SCIM provisioning is available.

**Options:** Microsoft Entra ID (likely, given the Windows estate) · Google Workspace · a standalone IdP.

**Recommendation:** whatever McMurray Stern already uses for email and file access. **Do not introduce a second identity system** — a staff account that can see every client's data must not have a password we manage.

**If unanswered:** internal authentication cannot be built, and internal accounts are the ones that see cost, margin and every organization's data.

---

### OD-03 — What is the true MVP option template?

**Decision:** "selective pallet rack" still spans single-deep, back-to-back, single-row-against-wall and several level configurations.

**Options:** back-to-back + single row only · add wall rows · add double-deep.

**Recommendation:** back-to-back and single row, floor level plus 2–6 beam levels, uniform bays within a run. Everything else produces a finding that says "our team will configure this". Narrow is the point.

**If unanswered:** the configurator's controlled vocabulary cannot be defined, and it is the first screen a client sees.

---

### OD-04 — Can a client create a project, or only work in one we created?

**Decision:** changes the invitation model and the abuse surface.

**Options:** internal-created only · client can add units to an existing project · client can create projects.

**Recommendation:** internal-created only in MVP-1. Client-created projects turn a controlled engagement into an inbound funnel and need a different qualification story, a different abuse posture, and a different support model.

**If unanswered:** the invitation and project-assignment model is undefined.

---

### OD-05 — Can one person belong to more than one client organization?

**Decision:** a consultant working for two of our clients is a real case.

**Options:** one organization per user · multi-organization membership with an explicit switcher.

**Recommendation:** one organization per user in MVP-1; a second person account if genuinely needed. Multi-org membership makes every row-level-security policy and every session a harder problem, and it is the kind of thing that quietly breaks isolation.

**If unanswered:** the RLS policies cannot be written, and they are the foundation of Phase 0.

---

### OD-06 — US customary only, or metric too?  ✅ **SETTLED 2026-08-31**

**Answered:** US Customary primary in the UI and on deliverables, metric in parentheses alongside. Metric in the backend, to keep EN 15512 cross-reference easy.

**Accepted — the dual display.** US primary with metric in parentheses is a formatting layer, it costs very little, and it is genuinely useful if a European-sourced drawing ever has to be reconciled. Do it from the start rather than later.

**Corrected — the storage base cannot be millimetres.** This is arithmetic, not preference. The engine's single most important behaviour is that it never interpolates a published capacity table: a span either matches a published grid key exactly or it returns `OFF_GRID` with both brackets and no value. Integer millimetres cannot represent that grid.

| Published span | Stored as integer mm | Read back | Result |
|---|---|---|---|
| 48″ | 1219 mm | 47.9921″ | key `48` no longer matches |
| 96″ | 2438 mm | 95.9843″ | key `96` no longer matches |
| 108″ | 2743 mm | 107.9921″ | key `108` no longer matches |

**18 of the 21 published spans miss their own lookup key**, along with most of the frame-height grid and the 5.92″ beam face height. Every lookup silently degrades to off-grid, and the product loses the behaviour it is built around.

**Use integer micrometres (µm) instead.** One inch is 25.4 mm exactly by definition, so:

- every published inch value is a whole number of µm — 48″ = 1,219,200 µm, 5.92″ = 150,368 µm — and **zero** of the 44 grid values lose precision;
- every whole millimetre is a whole number of µm (1 mm = 1,000 µm), so metric input and metric display are exact too;
- it is a metric base unit, which is what the answer actually asked for.

Micrometres give the metric backend with none of the loss. Integer mil (thousandths of an inch) would be the choice for a US-only product, but it cannot hold whole millimetres exactly — 1 mm = 39.3700787 mil — so µm is the better base *because* of the dual-unit decision.

**Mass is asymmetric, and should be stated plainly.** The pound is defined as exactly 0.45359237 kg, so pounds convert to metric exactly but not the reverse at any sane integer base. Store load and capacity as **integer millipounds** and render kg as a rounded display value. A published capacity of 8,030 lb is 3,642.3467 kg — not a number anyone will type, which is the point: **the US value is the value of record; the metric value is derived, one-way, and never re-parsed as an input.** `rack-studio` already ships this pattern — its `formatMm` is documented as lossy-by-design and a test asserts it can never become a claim.

**On the EN 15512 rationale, honestly:** storing in metric does not make EN 15512 and RMI cross-reference easier. They differ in safety factors, load combinations and test protocols, not in units — and this product performs no structural design under either standard (no FEA, no Direct Strength Method, no seismic from first principles, in any phase). What it does is exact table lookup plus geometry, against a US manufacturer's charts published in inches and pounds on a 2012 RMI / 2001 AISI basis. The dual display is worth having on its own merits; the metric-for-EN-15512 benefit will not materialise in this product.

**Net decision to confirm:** length stored as integer µm, mass as integer millipounds; US Customary displayed primary with metric in parentheses; metric derived and one-way.

> **Settled 2026-08-31:** displayed in **millimetres**, stored ×1000 as whole numbers. The two answers were the same answer. **Micrometres are not an alternative to millimetres — they are millimetres carried as a whole number rather than a decimal.** Stored `1219200`, displayed `1219.2 mm`. Nothing is ever shown to anyone in µm; the metric unit on screen and on deliverables is the millimetre. The only thing µm changes is that the `.2` survives storage, which is what keeps a 48″ beam matching its own capacity-table key. If "mm" meant the display unit, this is settled. If it meant the stored integer base, the table above is what breaks.

---

### OD-07 — Which catalog release ships first, and who approves it?

**Decision:** the two-person rule needs a named second person who is **not** the digitiser.

**Options:** the already-reconciled 378-row Interlake beam set plus the three verified frame tables · a broader set · start from the source PDFs again.

**Recommendation:** the already-reconciled sets, re-approved in the new system by a named person. **Nominate that person now.** The release gate blocks everything downstream and it needs a human with time, not a process.

**If unanswered:** no revision can pin a catalog, so nothing derives, so nothing can be tested end to end.

---

### OD-08 — What exactly is on the client PDF?

**Decision:** the sharpest commercial question in the whole blueprint. Every element on that page is a decision about how transferable our work is.

**Options:** plan only · plan + elevation · plus dimensioned aisles · plus bay dimensions · plus a position schedule.

**Recommendation:** plan, elevation, net pallet-position count, aisle clear widths, the assumption register and the findings list. **No bay-by-bay schedule, no part descriptions, no beam capacities, no quantities.**

Decide this deliberately and **write down the reasoning**, because the first client who asks for more will re-open it and the answer needs to be a policy rather than a preference.

**If unanswered:** the document pipeline cannot be built, and it is what makes the tool feel worth using to a client.

---

### OD-09 — Who may waive a finding, and which findings are waivable at all? *(blocking as a non-default)*

**Decision:** currently undecided in every reference project, and correctly so.

**Options:** internal admin only · any internal user with a stated reason · a named engineering approver.

**Recommendation:** keep it undecided **in code**. The waiver function throws an error naming this decision rather than defaulting to permissive — `rack-studio` already ships exactly this pattern and it is the right one. Answer the question before any waiver feature ships.

**If unanswered:** that is acceptable, *provided* the code refuses rather than defaults. It becomes blocking the moment anyone wants to waive something.

---

### OD-10 — Do clients get a preliminary PDF at submit, or only after we accept?

**Decision:** determines whether a client can generate a takeaway document without ever engaging us.

**Options:** at submit · after internal acknowledgement · only on request.

**Recommendation:** at submit. The document is what makes the tool feel worth using, and a preliminary plan with no quantities and no part numbers is a poor competitor package. Revisit if it is abused — and instrument for that from day one.

**If unanswered:** the submit flow is incomplete.

---

### OD-13 — How long do we keep a client's facility data?

**Decision:** their layouts are commercially sensitive *to them*, and retention needs to be in the terms before the first client, not after.

**Options:** indefinite · 3 years · 12 months after closure · client-configurable.

**Recommendation:** audit events **7 years** in WORM storage with 13 months hot and queryable; facility and configuration data **3 years after closure**, then de-identified. Write it into the terms now.

**If unanswered:** the terms of service cannot be written, and retroactive retention changes are painful.

---

### OD-15 — Who owns the rule packs, and what is the review cadence?

**Decision:** standards editions move. A stale pack silently degrades every finding in the product.

**Options:** product owner · an internal engineer · an external PE on retainer.

**Recommendation:** name a single owner now. A quarterly review with a written outcome is enough. An unowned rule pack is a slow failure that nobody notices until a finding is wrong in front of a client.

**If unanswered:** the rule-pack release gate has no approver, which is the same problem as OD-07.

---

### OD-16 — Is a preliminary output ever allowed to carry a name or a licence number?

**Decision:** a hard liability question.

**Options:** never · company name only · a named contact.

**Recommendation:** company name and a contact name only. **No licence number, no seal, no stamp, and no engineer's name on any preliminary output, in any phase.** Confirm with counsel and against the professional-licensure rules of the states we sell into — those rules vary and they govern.

**If unanswered:** the document template cannot be finalised, and getting this wrong is the highest-consequence error available.

---

### OD-17 — What share of our jobs use used or generic material?  ✅ **ANSWERED, then re-cut against the source quotes**

**First answer (project count):** ~40% used/generic, ~60% new certified.
**After reading the eight distinct quotes: the headline holds, but three things in the audit need correcting, and the volume cut lands somewhere very different.**

#### Correction 1 — one quote was counted as a racking job and is not one

`Q-39047-3` was placed in the used/generic bucket for the phrase *"using customer's (2) existing 9' sections."* Reading it: it is a **Guard Rail** quote — an L-shaped 14′×14′ barrier at an office and bathroom area, made of Handle It guard rail sections and posts. The existing 9′ sections are guard rail, not rack. There is no structural rack component in it and no capacity question of the kind this product deals with.

The audit already excluded `Q-39047-5.1` (column protectors) and `Q-39047-4` (wall guards) as *"component add-ons rather than independent structural system jobs."* `Q-39047-3` is the same kind of thing and goes with them.

#### Correction 2 — the real mixed-material evidence is much stronger than the phrase that was quoted

The genuine mixed job is `Q-39047-1.2`, and its scope block reconciles exactly:

| Component | Reused (torn down) | Newly purchased | Installed |
|---|---:|---:|---:|
| Upright 42×324 | 28 | 6 | **34** ✓ |
| Beam 144×5 | 24 | 288 | **312** ✓ |
| Wire Deck 42×46 | 342 | 126 | **468** ✓ |
| Row Spacer 46″ | 0 | 63 | **63** ✓ |
| End Aisle Protector DBL | 4 | 11 | **15** ✓ |

Every line balances. This is a precise, arithmetically verifiable specification of what the mixed-material data model has to represent — far better evidence than a sentence in a scope note. Note also that 204 of the torn-down 144×3 beams are *not* reinstalled: teardown inventory and install BOM are different sets, and the model needs both.

#### Correction 3 — used-vs-new is a property of a component, not of a job

`Q-38857-8` is the used job, and it buys **new** End Aisle Protectors (54 left, 54 right, 12 double) while every structural component is used. `Q-39047-1.2` mixes reused and new within the same component type. There is no job-level flag that would be correct. This is direct confirmation that the reference has to sit on the BOM line — `part_revision_id XOR uncatalogued_part_id` — and not on the project.

#### The corrected counts

**Four structural racking jobs**, not five: one entirely used (Jam-N Carson Phase 4), one mixed (KOAM–IBOCO), two entirely new (The One Rancho, GoPlus Crest Hill).

| Measure | Share on material with no published capacity |
|---|---|
| **By job** | **2 of 4 = 50%** — one all-used, one mixed |
| By structural component count | 4,032 of 58,652 = **6.9%** |
| By material dollar value | **7.3%** |
| By pallet position | 4,268 of 60,380 = **7.1%** |

**The volume figures are not trustworthy at this sample size.** One job — GoPlus — is **91.3% of every structural component in the sample** (53,548 of 58,652, including 44,720 beams on a single line). A single mega-project swamps every volume metric. Add or remove one job like it and the 7% moves by a factor of two or more.

**Use the job-count number for product decisions.** The failure this product can cause is per client, per job: a client whose material is not in the catalog hits a wall on the first screen whether their job is 500 components or 50,000. Tonnage is the wrong denominator for a client-experience question. The volume cut is useful for one thing only — sizing *material* exposure — and there it says used material is a small fraction of what is actually purchased, which is unsurprising given that used material is reused rather than bought.

#### Two findings from the quotes that are worth more than the percentage

**1. The same job has three different position counts across three artifacts, with nothing linking them.**

| Artifact | Bays | Pallet positions |
|---|---:|---:|
| Drawing 0005-01 R-1 (the acceptance fixture) | 916 | 6,824 net (6,980 gross − 156 lost), 324 picking levels |
| `Q-38857-1` | 916 (850 A + 66 AT) | **7,196** |
| `Q-38857-8` | 551 (481 A + 30 B + 40 BT) | **4,268**, 90 picking levels |

The bay count in the drawing and the first quote agree; the position counts do not, and the later revision is a major scope reduction that nothing in the documents ties back to the drawing. **This is the product's whole thesis, evidenced from real paperwork** — three derived numbers for one job with no shared model behind them. It also means the acceptance fixture's headline number needs reconciling against the quote before it is trusted as a golden value; do not assume either is wrong until someone checks which revision the drawing belongs to.

**2. The verified anchor constant's actual source is now identified.** `Q-38857-1` line 1 is 953 used uprights and line 7 is 3,812 SD2 wedge anchors — exactly 4.000 per upright. That is where the reference project's verified constant came from, and it is confirmed from the original document rather than inherited on trust.

**Also worth noting, outside OD-17:** a second GoPlus discrepancy — that quote states *"(55,320) 48×60″ Pallet Positions or (4,806) 48″×72″ Pallet Positions"* on the same line. Those two numbers cannot both describe the same layout and nothing in the document reconciles them. And permitting appears as a line item on three of the four jobs at $7,600–$8,200 each, plus anchor inspection at $1,700–$1,800 — the engineering and permit work that sits immediately adjacent to this product's scope fence, and firmly outside it.

#### The matching feature — unchanged, still Phase 2

At 50% of jobs an estimator aid saying *"this 96×4 is dimensionally consistent with a TS-400 — go verify"* clearly earns its place. It still must not transfer that SKU's published capacity onto the client's part, with or without a reduction: a used-material derate has no published basis, so it caps at `SECONDARY` tier, which §11.2's ceiling limits to *engineering review required* regardless of any click. Identification hypothesis, no derate, internal-only, unblocked only by a written PE determination recorded as a `pe_stamped` entry.

---

### OD-21 — Does MVP-1 serve used-material jobs, or only new?  ✅ **ANSWERED 2026-08-31**

**Decision:** MVP-1's controlled vocabulary (`FR-CP-05`) offers only parts from the pinned catalog release. On the audit numbers that serves roughly **60% of jobs cleanly**. A client with existing 42×240 3×3 uprights cannot pick them from a Mecalux dropdown, because they are not in it.

**Options:**

- **(a) Catalog-only MVP-1.** Used-material jobs stay on the current manual process until Phase 2. Smallest scope, fastest to a working loop, and the 60% it serves are the jobs where the configurator is most useful anyway.
- **(b) Include uncatalogued entry in MVP-1** (`FR-CP-14`, `FR-CP-15` pulled forward). Covers the whole pipeline, but adds a second entry path, a second finding class and a mixed-material layout case to the narrowest release.
- **(c) Catalog-only, with an explicit off-ramp.** A client who has existing material picks "some of this is existing material" and the option is routed to internal configuration with the facility and unit inputs already captured. They get value from the intake even though they cannot finish the configuration themselves.

**Answered: (c) — catalog-only with an explicit off-ramp.**

What that means concretely for `D-03`:

- The option builder offers only parts from the pinned catalog release, as `FR-CP-05` already specifies.
- A visible, first-class control lets the client declare *"some of this uses existing material"* — not an error state, not a warning chip. It is a normal branch of the flow.
- Taking it stops the configuration but **keeps everything already entered**: facility, units, operational requirements, and whatever options were built from catalog parts. The revision is submitted as an off-ramp request rather than abandoned.
- Internal receives the same structured package minus the layout — which is still far more than a phone call.
- Instrument it. Count off-ramp rate, and how far each client got before taking it. That is the Phase 2 scoping input, measured rather than assumed.

It keeps MVP-1 narrow, does not pretend the used-material jobs do not exist, and still captures the intake — which is most of what the internal team gains from the product.

**If unanswered:** MVP-1 gets built with an implicit assumption that every client's material is in the catalog, and 40% of pilot candidates hit a dead end on the first screen with no explanation.

**When it is needed:** before `D-03`, the option builder.

---

### OD-20 — Who is the first client, and will they pilot it?

**Decision:** not a technical decision, and the most important one here.

**Recommendation:** name one before Phase 0 ends. A blueprint validated against one real client's actual building beats six months of speculative generality — and it is the only way to answer the question the entire business case rests on: **will a client actually do this configuration work themselves?**

**If unanswered:** the product may be built correctly and used by nobody. A tool that shifts work to someone who refuses to do it does not save the work; it adds a support channel.

---

## 🟡 Phase 2

### OD-11 — What are the two SLA targets?

Acknowledgement and quote delivery, both with pause semantics for an outstanding request for information.

**Recommendation:** set them from what the team can actually meet today, not from an aspiration. A breached SLA displayed to a client is worse than no SLA.

---

### OD-12 — Do clients see the request status, or only the outcome?

**Options:** full status · received / in progress / complete · outcome only.

**Recommendation:** a coarse three-state view. Internal statuses like "in triage" invite questions the team should not have to field.

---

### OD-14 — Do we ever use client configuration data in aggregate?  ✅ **SETTLED 2026-08-31**

"What are clients configuring that we cannot serve" is genuinely valuable and genuinely sensitive.

**Options:** never · de-identified aggregates only · with contractual permission.

**Settled: de-identified aggregates only, stated in the terms of service.** No client's facility data, layout or configuration is used in named form for any internal analysis. The structured decline-reason enum carries most of the analytical value with none of the exposure, and it is available without touching client configuration at all.

---

### OD-18 — Should option choices be constrained per organization?  ✅ **SETTLED 2026-08-31**

A client with a standard pallet and a standard truck should not be re-asked every time.

**Options:** global vocabulary · per-organization defaults · per-organization restrictions.

**Settled: per-organization defaults in Phase 2, never restrictions.** A client with a standard pallet and a standard truck gets those pre-filled and can change them. Nothing is removed from their vocabulary — a restriction that hides a valid option produces a support call and no explanation the client can act on.

---

### OD-19 — Do we need concurrent editing within a client organization?  ✅ **SETTLED 2026-08-31**

Two people from the same client in the same option at once.

**Options:** single-writer with stale-base rejection · last-write-wins · real-time collaboration.

**Settled: single-writer with explicit stale-base rejection.** A second editor's change against a stale base is refused with a clear message and a reload, never merged. `rack-app/model/edit.py` already implements exactly this and it is the behaviour to port. Real-time collaborative editing is a large, separate product and is not on this roadmap.

---

## The three questions nobody has asked yet

Across all four reference projects, two validation gates were repeatedly deferred and never closed:

1. **No PE has been asked** whether this kind of output is a useful input to them.
2. **No drafter has confirmed** which step of their workflow this actually removes.

For Rack Master Studio there is a third, and the entire business case rests on it:

3. **Will a client actually do this configuration work themselves?**

`OD-20` is how the third one gets answered. It is cheap to answer now and expensive to discover late.

---

## Decision log

Record each answer here as it is made — date, decision, who decided, and the reasoning. A reversed decision gets written down as a reversal with its reason, never deleted.

| ID | Answered | Decision | By | Note |
|---|---|---|---|---|
| OD-01 | 2026-08-31 | Single-region managed Postgres with Object Lock-capable storage; tenant plumbing designed so database-per-tenant is a config change | EL | Matches recommendation. |
| OD-02 | 2026-08-31 | **Microsoft Entra ID** for internal staff SSO. Build OIDC now — it works on any tier. SCIM is conditional on P1 or above | EL | Settled. If the tier turns out to be below P1, automatic deprovisioning is unavailable and **offboarding becomes a named step in the quarterly access review** rather than an automated one. That is a process gap to write down, not a build blocker. |
| OD-03 | 2026-08-31 | Back-to-back and single row, floor level plus 2–6 beam levels, uniform bays within a run; everything else is a finding | EL | Matches recommendation. |
| OD-04 | 2026-08-31 | Internal-created projects only in MVP-1 | EL | Matches recommendation. |
| OD-05 | 2026-08-31 | One organization per user in MVP-1; a second account if needed | EL | Matches recommendation. |
| OD-06 | 2026-08-31 | **Settled.** US Customary primary, **millimetres** in parentheses; length stored ×1000 as whole numbers so the fraction survives; mass in integer millipounds | EL | Integer mm alone would break the exact-match lookup on 18 of 21 published spans. Nothing is ever displayed in µm. |
| OD-07 | 2026-08-31 | The already-reconciled Interlake sets, approved by **Elliott Villacorta** | EL | See the note below on what the two-person rule means here. |
| OD-08 | 2026-08-31 | Plan, elevation, position count, aisle clear widths, assumptions and findings. No bay-by-bay schedule, no part descriptions, no beam capacities, no quantities | EL | Matches recommendation. Write the reasoning down before the first client asks for more. |
| OD-09 | 2026-08-31 | Stays undecided in code — the waiver function throws, naming this decision, rather than defaulting to permissive | EL | Matches recommendation. Becomes blocking the moment anyone wants to waive something. |
| OD-10 | 2026-08-31 | Preliminary PDF at submit | EL | Matches recommendation. Instrument for abuse from day one. |
| OD-11 | 2026-08-31 | **1 business day** / **5 business days**, both pausing on an open RFI; targets hidden from external users until a baseline exists over ten live submissions | EL | Calibration accepted. **Rename the clocks** — "stamped engineering review" is outside this product's scope and must not be a client-visible label. Confirm they mean acknowledgement and quote delivery. |
| OD-12 | 2026-08-31 | Coarse three-state client view | EL | Matches recommendation. |
| OD-13 | 2026-08-31 | Audit events 7 years; facility and configuration data 3 years after closure, then de-identified | EL | Into the terms of service before the first client. |
| OD-14 | 2026-08-31 | **De-identified aggregates only**, stated in the terms of service | EL (recommendation adopted) | Decline-reason enum carries most of the analytical value with none of the exposure. |
| OD-15 | 2026-08-31 | Rule-pack owner: **Elliott Villacorta** | EL | Set the review cadence too — quarterly, with a written outcome. |
| OD-16 | 2026-08-31 | Company name and a contact name only. No licence number, seal, stamp or engineer's name on any preliminary output, in any phase | EL | Still worth a one-off check with counsel against the PE board rules of the states we sell into. |
| OD-17 | 2026-08-31 | **2 of 4 structural jobs (50%) involve material with no published capacity**; ~7% by component count, dollar value and pallet position — but 91% of the volume sample is one job, so use the job count | EL, re-cut from source quotes | One quote was a guard-rail add-on, not a racking job. Schema changed in response: `bom_line` takes `part_revision_id` XOR `uncatalogued_part_id`. |
| OD-18 | 2026-08-31 | **Per-organization defaults, never restrictions** | EL (recommendation adopted) | Defaults save time; restrictions produce support calls. Phase 2. |
| OD-19 | 2026-08-31 | **Single-writer with explicit stale-base rejection** | EL (recommendation adopted) | Refuse and reload, never merge. `rack-app/model/edit.py` is the reference. Phase 2. |
| OD-20a | 2026-08-31 | **Internal dogfood pilot** — McMurray Stern, closed single-environment trial, first three submissions treated as user research | EL | Right framing, and it should happen. |
| OD-20b | 2026-08-31 (criteria) | **Selection criteria settled**: outside McMurray Stern · new-material job · small enough to finish in one sitting · a live opportunity · a relationship that survives a rough release. **The account name remains yours to pick.** | EL (criteria adopted) | One of the four audited accounts fits all five. `R-01` is only retired when an outside client submits unaided. |
| OD-21 | 2026-08-31 | **(c) catalog-only with an explicit off-ramp** — declaring existing material keeps all entered inputs and submits as an off-ramp request | EL | Instrument off-ramp rate and drop-off point; that is the Phase 2 scoping input. |

---

## Notes on the answers

### OD-07 / OD-15 — operationalized 2026-08-31 ✅, with one loophole to close

**Recorded:** digitiser ≠ checker is satisfied for both Interlake sets — beam data cross-checked 357/357 by a human against an automated extraction; frame tables reconciled across two independent extraction paths, sample spot-checked and signed. Machine reconciliation is treated as structural evidence, never as a signature block. A fallback approver is nominated so the gate is never bypassed under deadline pressure. Single-point dependency is formally accepted for MVP-1 and to be refactored when a second internal engineering resource is onboarded. All correct, and the risk acceptance is properly dated and named.

**One loophole in the gate as written.** *"Refuse when the active user context matches the Digitizer ID"* is necessary but not sufficient. Both current tables record a **machine** as the digitiser, so that check never fires for them — which is fine here. But it means the rule is trivially satisfiable in general: run an extraction script, the digitiser becomes a machine identity, and one person can then approve data they produced themselves. **A machine is a tool, not an independent party.**

What actually makes the two Interlake sets trustworthy is not the machine identity — it is the 357/357 cross-check and the 435/435 two-path reconciliation. So the gate should key on **the verification act, not the identity string**:

> A release may be approved by a single human only if it carries a recorded independent verification path — a full cross-check, or a reconciliation across two independent extractions — stored as data on the release. Without one, a second human signature is required. A machine digitiser identity does not by itself satisfy the second-party requirement.

That closes the loophole, and it is also the better answer when someone asks in two years why the table was trusted: the record points at a reconciliation, not at a name.

**Define what the approver does, not only who they are.** ✅ **Adopted 2026-08-31.** A name without a verification act is ceremony: the 72% capacity overstatement was caught by *reconciliation*, not by a signature. The approval procedure is now part of the release gate:

1. The release must arrive carrying a **recorded verification path** — a 100% cross-check or a two-path reconciliation — stored as data on the release, not asserted in prose.
2. The approver independently spot-checks a sample against the source document: **20 cells or 5% of the table, whichever is greater**, and **the tool draws the sample at random**. An approver-chosen sample drifts toward the easy cells; that is the whole reason to let the tool pick.
3. **Any mismatch fails the entire release.** There is no partial pass and no "approve with notes".
4. The approver records sample size, which cells, the source document and page reference, and the outcome.
5. **The signature attaches to that record**, not to the release in the abstract. "Approved" with no verification record behind it is not a state the schema can represent.

One thing still to confirm at leisure: that the nominated fallback approver is positioned to catch a *capacity-table* error specifically. That is a different competence from design or sales review, and the procedure above only works if the person running it would recognise a wrong number when the sample turns one up.

### OD-07 / OD-15 — background: what the two-person rule means here

Elliott is named as both the catalog approver and the rule-pack owner. That is workable and it is the practical reality at this size, but write down *how* the two-person rule is satisfied, because it is not two humans:

- The beam data was digitised by an automated extract and cross-checked 357/357 by Elliott. **Digitiser = machine, checker = human.** The rule holds.
- The three frame tables were digitised by machine (recorded as `claude-opus-5 (PDF read)`) and reconciled 435/435 across two independent extraction paths, then signed by Elliott. The rule holds — but note the project's own caveat that the human spot-checked a *sample*, not all 435 cells, and that machine reconciliation is evidence rather than a signature.
- **Where it does not hold:** any table Elliott both digitises *and* approves. For those, the gate should refuse, and a second qualified name is needed. Nominate a fallback approver now even if they are rarely used, because the alternative is that the gate gets bypassed under deadline pressure.

Being the sole owner of both the catalog and the rule pack also means there is no independent check on the data anywhere in the system. That is acceptable for MVP-1 and worth revisiting the moment a second qualified person is available.

### OD-11 — SETTLED 2026-08-31 ✅ (calibration accepted, clocks renamed)

**Accepted:** suppress the countdown targets from external users initially, and measure the team's true lifecycle duration across the first ten live submissions to establish an empirical baseline before any clock is shown outside. That is exactly right.

**The naming is a problem.** The two clocks were described as *"1-business-day prelim turnaround and 5-business-day **stamped engineering review**."* This product does not produce stamped engineering review, in any phase — that is the scope fence, and OD-16 puts no seal, stamp or engineer's name on any preliminary output. A client-visible clock labelled anything close to *engineering review* creates exactly the expectation the rest of the design works to avoid, and it is the kind of wording that survives into a UI string and then into a client's email.

Two readings, and they need separating:

- **If the 5-day clock is our internal quote turnaround** — the time from submission to a returned quote — then call it **quote delivery**, and it fits the design as written.
- **If it genuinely covers producing a stamped engineering package**, that is out of scope for this product and belongs to the existing permitting and engineering workflow, which the quotes price separately at $7,600–8,200 per job. It should not be a clock inside Rack Master Studio at all.

The same applies to *"prelim turnaround"* on the 1-day clock. In this product the client produces the preliminary themselves; what we return in one business day is an **acknowledgement** that a human has picked the submission up. Name it for what it delivers.

**Settled: the clocks are named for what they deliver.**

| Clock | Target | What it measures |
|---|---|---|
| **Acknowledgement** | 1 business day | A human has picked the submission up and it is in triage. Not a deliverable. |
| **Quote delivery** | 5 business days | Submission to a returned quote. Pauses while an RFI is open. |

Neither is called *prelim turnaround* or *engineering review* anywhere — not in the schema, not in a UI string, not in an email template. Stamped engineering belongs to the existing permitting workflow, which is priced separately per job and sits outside this product in every phase. Both targets stay hidden from external users until a baseline exists across ten live submissions.

### OD-20 — splits in two. One is answered; the one that matters is not. ⚠️

**OD-20a — internal dogfood pilot: answered.** McMurray Stern via the internal pipeline, deployed as a closed trial to a single environment, with the first three submissions treated as an ethnographic study of friction points, un-mapped generic parts and workflow drop-offs rather than a commercial launch. The gated-launch framing and the research framing are both right, and this should happen.

**OD-20b — external pilot client: still open, and it is the risk the whole business case rests on.**

The premise under test is that *a commercial client will willingly perform this configuration work themselves.* An internal pilot cannot test that, because internal users:

- are paid to use the tool, so they will not abandon it;
- already know rack, so they will not hit the comprehension failures a client would;
- cannot fall back to picking up the phone and asking us to do it — which is precisely the behaviour the product needs to displace.

Internal dogfooding measures **usability**, which is genuinely valuable and will find real defects. It does not measure **willingness**, which is the stated risk `R-01`. Marking OD-20 closed on an internal pilot would retire a critical risk that has not been touched.

**What is needed:** one client organization outside McMurray Stern, completing a submission unaided.

**One constraint on who it can be.** MVP-1 is catalog-only with an off-ramp (`OD-21`), so a pilot on a used-material job will hit the off-ramp on the first screen and test the off-ramp rather than the configurator. **The external pilot must be a new-material job** — the profile of the Rancho or Crest Hill jobs, not the Carson one. The quotes reviewed for OD-17 supply four real candidate accounts with the same design consultant, so the name may be one conversation away.

**Selection criteria — settled 2026-08-31:**

1. **Outside McMurray Stern.** An internal user cannot test willingness.
2. **A new-material job.** MVP-1 is catalog-only with an off-ramp (`OD-21`); a used-material client hits the off-ramp on the first screen and tests the off-ramp rather than the configurator.
3. **Small enough to finish in one sitting.** A single unit, one or two options, a job in the low hundreds of bays rather than the low thousands. The question is whether they will finish, not whether the engine scales.
4. **A live opportunity, not a favour.** Someone with a real building and a real reason to want the layout, so the incentive to complete it is genuine.
5. **A relationship that survives a rough first release.** The first three submissions are research; the tool will have sharp edges.

Of the four accounts in the OD-17 audit, **one fits all five cleanly** — the small all-new single-unit job, roughly 70 bays across 14 profiles. The two large new-material jobs fail criterion 3, and the used and mixed jobs fail criterion 2.

**What is still yours to decide:** the account itself. Whether that particular relationship suits a pilot ask is a commercial judgement I am not positioned to make, and I am not going to record a client name as a decision on your behalf. The criteria are settled; pick the name against them.

**When it is needed:** not before Phase 0, and not before MVP-1 is built. It is needed before MVP-1 is called *validated*, and before any conclusion is drawn about whether the premise holds.

