# Research Brief: Configurator → BOM/Takeoff → RFQ Intake → Approval/Release, with Revision Control and Calculation Traceability

Domain: building products / material handling. External clients self-configure a *preliminary* layout and submit an RFQ; internal staff produce a real BOM and quote.

Verification note: every claim below is tied to a source in the Sources list. Items I could **not** verify against a primary source are flagged inline with **[UNVERIFIED]**. Paywalled standards (ISO 9001, ASME Y14.35, SAE EIA-649C, ISO 10303-242) were verified only to the level of their published scope/abstract pages — I did not read the normative text, and I have not quoted clause bodies I could not see.

---

## 1. Product configuration / CPQ architecture

### 1.1 The three families

The academic taxonomy comes from configuration research, canonically Sabin & Weigel's survey (IEEE Intelligent Systems, 1998) and the Felfernig/Hotz/Bagley/Tiihonen textbook *Knowledge-Based Configuration* (Morgan Kaufmann, 2014). The distinction that matters operationally:

| Family | Knowledge representation | Inference | Behavior |
|---|---|---|---|
| **Rule-based / procedural** | IF-THEN production rules, often ordered | Forward chaining; order-dependent | Fast to start, brittle; rule interactions explode; hard to explain "why can't I pick X" |
| **Constraint-based (CSP/SAT/BDD)** | Declarative variables + domains + constraints | Constraint propagation, solver | Order-independent; supports *guided selling* (filter remaining domains after each pick), backtrack-free UI, conflict explanation |
| **Parametric / generative** | Formulas + geometry rules driving a model | Evaluation / regeneration | Produces dimensions and quantities, not just selections; natural for takeoff |

Real systems are hybrids. SAP LO-VC is explicitly hybrid: **preconditions**, **selection conditions**, **procedures**, **actions**, and **constraints** — where preconditions/selection conditions/procedures are procedural and evaluated in a defined execution sequence, while **constraints** do "value assignment and consistency check in single-level and multilevel configuration" declaratively. SAP also distinguishes **local** dependencies (no external name, not centrally maintained) from **global** dependencies (externally named, centrally maintained, reused across objects — so a change propagates everywhere). That local/global split is exactly the versioning surface you have to control.

Salesforce Revenue Cloud's newer configurator is squarely constraint-based: **Constraint Modeling Language (CML)**, described as "a domain-specific language that defines models for complex systems," with core concepts of *global properties*, *variables*, *types* ("the foundational building blocks"), *relationships* (a.k.a. **ports**), and *constraints*. This is the classic component-port-constraint model from the configuration literature.

Configit markets **Virtual Tabulation** — compiling the whole rule set into a compact representation (BDD-family) so the complete solution space can be queried in real time; this is vendor material, not peer-reviewed, but the underlying technique (BDD compilation of configuration models) is well established in the literature. Configit's framing term is **Configuration Lifecycle Management (CLM)** — one configuration model shared across sales, engineering, manufacturing, service. Tacton is likewise constraint-solver-based with CAD design automation; the FLSmidth case study in *Knowledge-Based Configuration* Ch. 17 attributes success to "a powerful constraint-solver engine as well as product experts dedicated to configuration modeling." **[UNVERIFIED]**: I could not read Tacton's internal solver architecture from primary docs.

### 1.2 How the big systems pin a configuration to a rule/catalog version

This is the crux of your question, and there is one *explicitly documented* gold-standard answer:

**Oracle Configurator (E-Business Suite, Configurator Developer)** — when you restore a saved configuration you choose between two modes:
- **use the currently published Model version** (revalidate against today's rules), or
- **use the Model version saved in the configuration**: "Select this option to load the Model in the same state it was in when the configuration was saved. In other words, the Model structure and rules that are loaded are the same as when the configuration was saved, regardless of whether the published version has changed."

That is the pattern, named and shipped. Copy it.

**Oracle Fusion Configurator (Cloud SCM)** formalizes the version axis:
- A **version** is "a configurator model's ... definition that exists at a specific point in time."
- **Version 0** is the immutable baseline imported from Product Management.
- Work happens in a **workspace** (Draft); "if you release a workspace that includes a draft of the model into production, then Configurator creates a new version of the model and increments the model's version number."
- Crucially, **latest ≠ most recently released**: "The latest version of a participant is the version that has the latest effective start date … The latest version isn't necessarily the most recently released version because the release date of a version is different from and doesn't depend on the version's effective start date."

So the shipped vocabulary is: **workspace / draft → release → version → effective start date**.

**SAP** solves the same problem at the *master-data* layer rather than in the configurator: Engineering Change Management (LO-ECH) is "a central logistics function that can be used to change various aspects of production basic data (for example, BOMs, task lists, materials, and documents) with history (with date effectivity)." A **change master record** carries a **change number** and a **valid-from date**; valid-to dates on the previous state are computed automatically; **object management records** bind specific objects to the change with their own effectivity; **alternative dates** let a BOM and a routing under one change number go effective on different days; and **parameter effectivity** substitutes a parameter for a calendar date. "Changes with history" means "the changed object is saved twice: in its state before and after the changes." A configuration in SAP is therefore reproducible by re-exploding as of a **key date**.

**PTC Windchill** supports effectivity types **Date, Serial Number, MSN, Lot, Block**, selected by the context part's **trace code** (undefined trace code ⇒ Date). Planned effectivity lives on a change notice and becomes actual on approval: "When the change notice has been approved, the planned effectivities get copied over as actual effectivities on the given object."

**Dassault ENOVIA** (vendor marketing page) uses **product variants**, **effectivities**, **configured assemblies**, and the **150% BOM** — the superset structure from which a variant is filtered. SAP's equivalent term is **super BOM / maximum BOM**.

### 1.3 Standard terminology to adopt verbatim

- **Configuration model** (a.k.a. knowledge base) — the versioned artifact containing types, characteristics/variables, ports/relationships, constraints, and formulas.
- **Characteristic** and **characteristic value** (SAP), **variable** (CML/CSP), **option** (CPQ) — pick one and be consistent.
- **Configuration profile** (SAP) — binds a configurable material to its class/model and controls behavior.
- **Variant** — a specific valid combination; **variant class** groups configurable materials.
- **Effectivity** — the rule that decides which revision of a thing applies. Three canonical forms: **date-effectivity**, **unit/serial-effectivity**, **lot/block-effectivity**; PLM tools add **revision-effectivity** via **revision rules** (a named policy such as "latest released as of date D").
- **Valid-from / valid-to** — SAP's date-effectivity interval; **effective start date** — Oracle's model-version equivalent.
- **150% / super / maximum BOM** vs **100% / configured / resolved BOM**.

### ✅ Recommended for this product

1. **Constraint-based core with a parametric quantity layer.** Model discrete choices (rack type, beam gauge, deck, seismic category, finish) as a CSP; model dimensional takeoff (bay counts, beam lengths, cut lists, fastener counts, area/lineal quantities) as pure functions evaluated *after* the CSP is satisfied. Keep the two strictly separated — the CSP tells you *what*, the parametric layer tells you *how many*. This gives you explainable "why is this greyed out" in the client-facing UI and auditable arithmetic in the BOM.
2. **Adopt the Oracle vocabulary literally:** `configuration_model_version` with `effective_start_date`, produced by *releasing* a `workspace`. Never mutate a released version.
3. **Every saved configuration stores `model_version_id` (immutable FK), not "latest".** Provide the Oracle two-mode restore explicitly in the UI: *Reopen as submitted* (pinned) vs *Revalidate against current rules* (which produces a **new** configuration record and a diff report). Do not silently do the second.
4. **Compile the released model to an immutable artifact** (serialized constraint network + formula set + catalog slice), content-hash it, and store the hash on the configuration. This is what makes §4 deterministic re-computation possible.
5. **Separate `catalog_version` from `model_version`.** Part numbers, weights, and prices churn far faster than rules. Pin both independently on the submitted record. In SAP terms you are storing your own change-number-with-valid-from over your catalog.

---

## 2. BOM concepts

### 2.1 EBOM / MBOM / "SBOM"

- **EBOM** (engineering BOM) — function-oriented, mirrors the design; how the product is *conceived*.
- **MBOM** (manufacturing BOM) — process-oriented, includes consumables, packaging, phantom levels, plant-specific substitutions; how the product is *built*. Siemens markets a dedicated MBOM product line; the EBOM↔MBOM reconciliation problem is the standard PLM pain point.
- **SBOM** — historically "sales BOM," but **as of 2026 "SBOM" almost universally means Software Bill of Materials** (CISA/NTIA). ⚠️ **Do not use "SBOM" for sales BOM in this product.** Use **Sales BOM** or **Quote BOM**.

### 2.2 As-quoted / as-designed / as-built

The as-designed → as-planned → as-built → as-maintained chain is standard PLM usage (Teamcenter's BOM-view framing). **"As-quoted" is not a formally standardized PLM view** — it is common industry usage, and I could not find it in a standards document. **[UNVERIFIED as a standardized term.]** That is fine: define it yourself as a first-class view, because for a quote-driven business it is the *contractual* baseline.

Recommended chain for you: **as-configured (client, preliminary)** → **as-quoted (internal, released, contractual)** → **as-engineered** → **as-shipped/as-installed**.

### 2.3 Effectivity on BOM lines

Three mechanisms, all real and all documented:
- **Date effectivity** — SAP LO-ECH: change number + valid-from stamps `valid_from`/`valid_to` onto BOM items; explosion takes a key date. Windchill offers a **Date Effectivity configuration specification**.
- **Unit / serial effectivity** — Windchill: Serial Number, MSN; used when a change applies "from unit 147 onward" rather than from a date. Windchill selects the permitted type from the part's **trace code**.
- **Lot / block effectivity** — Windchill: Lot, Block.
- **Revision effectivity** via **revision rules** — the PLM configuration-specification concept: resolve each BOM line to a part revision by a named policy (latest working, latest released, released-as-of-date, specific baseline).

ISO 10303-242 (STEP AP242) is the interchange standard whose scope explicitly covers product structure, "breakdown data representing a parent-child structures," variant management and configuration control, "data describing the changes that have occurred during the design phase, including tracking of the versions of a product," and release/approval processes. Current edition **ISO 10303-242:2025**. Useful as a vocabulary source and as an export target if you ever exchange structures with a customer's PLM. **[UNVERIFIED]**: I did not read the normative entity definitions.

### 2.4 Where-used / where-from

- **Where-used** (upward): given a part revision, which assemblies/BOMs/quotes reference it. Ubiquitous in PLM; the standard use case is impact analysis before an ECO.
- **Where-from** (downward, less standardized): given a BOM line, what produced it. In your system this is the more valuable direction and it is the bridge to §6.

### ✅ Recommended for this product

1. **Model BOM lines as `(parent_bom_version, sequence, part_revision_id, quantity, uom, source_ref)` — never `part_id`.** The FK points at a *revision*, not a part. This is how PLM systems version a line back to a part revision, and it is the single most important schema decision here.
2. **Use revision-effectivity via an explicit `configuration_spec`** (a named resolution policy stored on the quote) rather than date-effectivity as your primary mechanism. Date-effectivity is right for SAP-style ongoing production; for quote reproducibility you want "resolve against catalog snapshot `C`," which is deterministic and does not depend on wall-clock semantics. Keep date-effectivity as a secondary attribute for phase-in/phase-out of catalog items.
3. **`source_ref` on every BOM line is mandatory and non-null.** It carries the where-from pointer described in §6.
4. **Two BOM objects, one lineage.** `preliminary_bom` (client-generated, watermarked, non-contractual) and `quote_bom` (internal, released). The quote BOM records `derived_from_preliminary_bom_id` plus a line-level diff so a salesperson can see exactly what engineering changed.
5. Build **where-used** on `part_revision_id` from day one (cheap now, brutal to retrofit). It is what answers "we're obsoleting beam SKU 4412 — which open quotes break?"

---

## 3. Engineering change / revision control

### 3.1 Vocabulary — precise, and not interchangeable

PTC Windchill's definitions are the cleanest published ones:
- A **version** is written as letter + separator + number, e.g. `A.1`.
- "The letter represents the **revision** of the object."
- "The number represents the **iteration** … The iteration is incremented each time the object is checked in."
- Revisions are created deliberately via a **Revise** action, and "the latest iteration of that object is used as the content for the new revision."

So: **iteration = every save/check-in (mechanical); revision = a deliberate, usually released, identity change (governed); version = the pair.** Use these three words with exactly these meanings and never loosely.

### 3.2 Lifecycle states

Aras Innovator's default Part lifecycle is a good published reference: **Preliminary → In Review → Released → Superseded → Obsolete**. Once Released, "no further changes allowed without revision" — you must "create a new major revision" which lands back in Preliminary. Windchill's practical equivalent is In Work / Under Review / Released with revise-on-release.

**Released-and-frozen vs working copy** is enforced by two mechanisms in every PDM/PLM: (a) **check-out / check-in** creating iterations on a working copy while others see the last checked-in iteration, and (b) **lifecycle state gating**, where Released objects are read-only and changes require a new revision under a change object.

### 3.3 ECR / ECN / ECO and CMII

Aras ships three tiers, and names them:
- **CMII change management**: **Problem Report (PR) → Engineering Change Request (ECR) → Engineering Change Notice (ECN)**
- **Simplified**: Simple ECO, Simple MCO
- **Express**: Express ECO, Express DCO

with the system "incorporat[ing] CMII principles and processes." Aras also distinguishes **release date** from **effectivity date** — "the date when a Part actually goes into production … potentially differing from the official Release date."

CMII is the Institute of Configuration Management's methodology; the widely circulated Aras and Siemens CMII white papers are the accessible primary-ish material. **[UNVERIFIED]**: ICM's own current publications were not reachable; treat vendor CMII white papers as vendor-mediated.

**SAE EIA-649C (2019)** is the consensus CM standard: it "defines five CM functions and their underlying principles," with principles "designed to individually identify the essence of the related CM function and can be used to collectively create a checklist of 'best practice' criteria to evaluate a CM program," applying equally to enterprise-internal CM and acquirer/supplier CM. **[UNVERIFIED]**: the five function names are conventionally *CM planning and management, configuration identification, change management, configuration status accounting, configuration verification and audit*, but I could not confirm the exact EIA-649C wording from the abstract page — do not print those five names as a quotation.

**ASME Y14.35** — "Revision of Engineering Drawings and Associated Documents" — "defines practices for revising drawings and associated documents and establishes methods for identification and recording revisions." **Current edition is Y14.35-2025.** **[UNVERIFIED]**: the normative content (revision-history block format, revision-status-of-sheets table, change-identification methods) is paywalled and I did not read it.

### ✅ Recommended for this product

1. **Two-track change governance.** Catalog/rule changes (which affect *all future* quotes) go through a formal ECR→ECO with approval and an effective date. Individual quote edits before release are just iterations. Don't impose ECO ceremony on a salesperson fixing a typo.
2. **Adopt Windchill's `REV.ITER` literally.** `quote_bom` version `B.3` = revision B, third check-in. Show only the revision letter externally; iterations are internal.
3. **State machine, enforced in the database, not in application code:** `Draft → In Review → Released → Superseded | Obsolete`. Released rows get a DB-level immutability guarantee (revoke UPDATE/DELETE; supersede by inserting a new revision). Aras's rule — a Released object cannot be edited, only revised — is the right invariant.
4. **Separate `released_at` from `effective_from`** (Aras's distinction). A quote can be released today and priced effective next quarter.
5. **Branched/derived revisions:** support "quote as an alternate" by deriving revision `B` from `A` with an explicit `derived_from_version_id` and a `derivation_reason`. Do not model alternates as separate unlinked quotes — you lose where-used.

---

## 4. Immutable submitted records

### 4.1 The three architectural options

**Event sourcing** — Fowler: "Capture all changes to an application state as a sequence of events." The event log becomes the system of record; current state is a derived, rebuildable projection; snapshots are a caching optimization. Fowler's own critical caveat is directly relevant to you: replay is only faithful if the system is closed. "External queries pose harder problems: reprocessing events on different dates yields different results, necessitating query logging to retrieve historical responses." **Translation for your product: if your calculation reads today's steel price, your replay is a lie unless you logged the price you read.**

**Append-only tables** — bitemporal or valid-time/transaction-time tables; simpler, SQL-native, no projection machinery. You keep `valid_from/valid_to` + `recorded_at` and never UPDATE.

**Content-addressed snapshots** — the Git model: "Git is a content-addressable filesystem … you can insert any kind of content into a Git repository, for which Git will hand you back a unique key you can use later to retrieve that content." Blobs → trees → commits, where a commit pins an entire tree state by hash plus parent pointers. Deduplication is free (identical catalog slices across 4,000 quotes store once), and equality of two submissions is a single hash comparison.

### 4.2 Tamper-evident ≠ tamper-proof — say this out loud in your architecture doc

Sigstore's security page states the distinction with unusual honesty. Rekor is "a transparency log of software signatures. The log is append-only and once entries are added they cannot be modified; a valid log can be cryptographically verified by any third-party," anchored by a periodically published **Signed Tree Head** "that contains a non-repudiable timestamp." But: "in short time windows, it would be much easier for the Rekor operator to fake or forge timestamps," and "if no third parties monitor the logs, then any misbehavior by Rekor and Fulcio might go undetected."

- **Tamper-evident**: an insider *can* rewrite history, but any verifier holding a prior root/digest will detect it. Hash chains and Merkle trees (RFC 6962 / RFC 9162 Certificate Transparency) give you inclusion and consistency proofs.
- **Tamper-proof**: nobody, including the operator, can rewrite. Requires either WORM media or externalizing the anchor to a party you do not control.

**The bridge between them is external anchoring.** RFC 3161 Time-Stamp Protocol: a TSA time-stamps "a hash representation of the datum," binding a **message imprint** ("a hash algorithm OID and the hash value of the data to be time-stamped") to a time, yielding "proof-of-existence for this particular datum at an instant in time" — **without disclosing the data itself**, which matters because your customers' layouts are confidential.

### 4.3 Legal / commercial defensibility (US-centric; check with counsel)

Three concrete hooks, all real:

- **FRE 901(b)(9)** — authentication by "evidence describing a process or system and showing that it produces an accurate result." This is why you write down your regeneration procedure: it *is* the authentication theory.
- **FRE 902(13)** — self-authentication of "a record generated by an electronic process or system that produces an accurate result, as shown by a certification of a qualified person."
- **FRE 902(14)** — self-authentication of "data copied from an electronic device, storage medium, or file, if authenticated by a process of digital identification." The Advisory Committee Note explains this is "ordinarily authenticated by 'hash value' … a number that is often represented as a sequence of characters and is produced by an algorithm based upon the digital contents," and that a hash match makes it "highly improbable that the original and copy are not identical."

**EU**: eIDAS (Reg. 910/2014) Art. 41 provides that "an electronic time stamp shall not be denied legal effect on the grounds that it is in an electronic form"; Art. 42 sets qualified-timestamp requirements built on advanced electronic seals/signatures. **[UNVERIFIED]**: the specific Art. 41(2) presumption of accuracy and data integrity for *qualified* timestamps is widely reported but the fetch returned only truncated text — confirm the exact wording before relying on it.

**Regulated-industry analogue worth borrowing even though you're not FDA-regulated**: 21 CFR 11.10(e) requires "secure, computer-generated, time-stamped audit trails to independently record the date and time of operator entries and actions that create, modify, or delete electronic records," which must **not obscure previously recorded information** and must be retained at least as long as the underlying records. That "must not obscure prior values" rule is the correct default for a quote audit trail.

### 4.4 Deterministic re-computation as verification

Reproducible-builds.org gives the definition to steal wholesale: "A build is reproducible if given the same source code, build environment and build instructions, any party can recreate bit-by-bit identical copies of all specified artifacts." Verification is "by bit-by-bit comparison … usually performed using cryptographically secure hash functions." The three enabling conditions map directly:

| Reproducible builds | Your system |
|---|---|
| Recorded build environment | `engine_version`, `model_version`, `catalog_version`, `rounding_mode`, `unit_system`, `locale`, `tz` |
| Deterministic build system | No `now()`, no RNG, no map/dict iteration order, no floating-point non-determinism, no network reads at calc time |
| Verification by hash comparison | `result_hash` recomputed and compared on demand |

The single biggest source of non-determinism in a quoting engine is **implicit inputs**: current date, current FX, "latest" price, hash-map ordering, and locale-dependent number formatting. Every one must become an explicit, recorded input.

### ✅ Recommended for this product

Use **all three patterns, layered** — they are not alternatives:

1. **Content-addressed snapshot as the record of truth.** On submit, serialize a canonical JSON document (sorted keys, fixed number formatting, explicit units) containing: configuration inputs, `model_version_id` + model artifact hash, `catalog_version_id` + catalog slice hash, engine version, and full computed output including intermediate values. SHA-256 it. Store immutably (S3 Object Lock in COMPLIANCE mode, or equivalent WORM). This is your `submission_manifest`.
2. **Hash chain over submissions.** Each `submission` row stores `prev_hash` and `this_hash = H(prev_hash ‖ manifest_hash ‖ metadata)`. Publish the head hash daily to an external anchor: an RFC 3161 TSA is the cheapest defensible option and does not disclose content.
3. **Append-only event table for the workflow** (`quote_events`: submitted, RFI-raised, RFI-answered, priced, approved, released, superseded, declined). Ordinary bitemporal SQL — you do not need a full event-sourcing framework, and the operational cost of one is real.
4. **Determinism harness in CI.** A nightly job re-renders a sample of historical submissions and asserts byte-identical output. When it fails, you have found either an accidental engine change or a leaked implicit input. This job *is* your FRE 901(b)(9) evidence that the process "produces an accurate result."
5. **Do not claim "tamper-proof" in any customer-facing copy.** Claim "tamper-evident, externally timestamped, and independently re-verifiable." That claim is true and defensible; the other one is not.

---

## 5. Quote-intake / RFQ workflows

### 5.1 Structure in practice

**Oracle CPQ** models this as a **Commerce Process**: main document + sub-documents, **steps**, transitions, actions, statuses, and approval sequences; recent releases added **Commerce Process Stages** and a stage badge for coarse-grained progress display. **[PARTIALLY VERIFIED]**: the Oracle CPQ help host blocked direct fetching (TLS/robots); the stage/step model is confirmed only from Oracle's own What's New release documents.

**Salesforce CPQ** handles post-sale change through **amendment quotes** against an existing contract, which is the right mental model for "customer wants to revise an already-submitted RFQ."

### 5.2 The data formats worth knowing

**cXML `QuoteRequest` / `QuoteMessage`** (Ariba/SAP Business Network; cXML Reference Guide, currently maintained — the guide is republished continuously, version 1.2.07x as of 2026). Buyer sends `QuoteRequest` (with `QuoteRequestHeader` + `QuoteItemOut`); supplier replies with `QuoteMessage` (`QuoteMessageHeader` + `QuoteItemIn`). Status/type attributes carry the disposition through the negotiation. This is the most directly relevant format if any of your customers are large enough to run Ariba.

**ANSI X12 `840` Request for Quotation / `843` Response to Request for Quotation.** The 843 is used to provide "price, delivery schedule, and other terms from potential sellers of goods and services, in response to a request for such information." Structure: header (`ST`, `BQR`, currency/tax/FOB/terms segments) → detail (`PO1` loop, up to 100,000 iterations, with nested pricing/scheduling/party/amount loops) → summary (`CTT`, `SE`). Relevant to construction-materials distribution and any government/large-GC customer.

**OAGIS** — `ProcessQuote` is the current recommended BOD; `AddQuote` exists but "is deprecated as of version 9.0 … OAGi recommend using ProcessQuote for all new development." **[UNVERIFIED]**: I could not confirm the OAGIS 10.x quote BOD inventory (`GetQuote`/`ShowQuote`/`AcknowledgeQuote`) from a primary OAGi source — the accessible schema documentation was 9.4.1.

### ✅ Recommended for this product

1. **A single explicit intake status lifecycle**, stored as an enum with a transition table:
   `Draft → Submitted → Triage → Needs Info (RFI) ⇄ In Progress → Quoted → {Won | Lost | Declined | Expired | Withdrawn}`
2. **RFI as a first-class loop, not a comment thread.** An RFI has: requested fields, requester, SLA clock, and — critically — it **pauses the response SLA**. Answering an RFI creates a *new revision* of the submitted configuration, chained to the original via `supersedes_submission_id`, with both hashes retained. Never edit the original submission in place.
3. **Structured `decline_reason` enum** (out of geography, below minimum order, non-standard engineering, capacity, credit, competitor-specified product, incomplete after N RFIs). Free text alongside, never instead. This is your only route to product-gap analytics and to tuning the configurator's guardrails.
4. **SLA on two clocks**: acknowledgement (hours) and quote delivery (days), each with pause semantics for RFI. Store target and actual; report on breach.
5. **Interop:** don't build EDI/cXML now. **Do** shape your intake schema so `QuoteRequest` → your intake and your quote → `843`/`QuoteMessage` are mechanical mappings later. Concretely: line-level `buyer_part_id` / `supplier_part_id` / `unspsc` fields, ISO 4217 currency, ISO 8601 dates, UN/CEFACT UoM codes, and a quote-level `valid_until`.

---

## 6. Data provenance & calculation traceability

### 6.1 W3C PROV — the right vocabulary, already standardized

PROV-O is a **W3C Recommendation (30 April 2013)** — stable, not draft. Three starting-point classes:
- **Entity** — "a physical, digital, conceptual, or other kind of thing with some fixed aspects"
- **Activity** — "something that occurs over a period of time and acts upon or with entities"
- **Agent** — "something that bears some form of responsibility for an activity taking place"

Core properties: `wasGeneratedBy`, `used`, `wasDerivedFrom`, `wasAttributedTo`, `wasAssociatedWith`, `startedAtTime`/`endedAtTime`, `wasInformedBy`. Expanded terms that matter to you: **`Plan`** and **`Association`/`hadPlan`** (the *rule/formula* an agent followed), **`wasRevisionOf`**, **`specializationOf`**, and **`Bundle`** (a named set of provenance descriptions — i.e. the provenance for one quote).

The mapping to your domain is almost embarrassingly direct:

| PROV | Your system |
|---|---|
| `Entity` | configuration input set, catalog part revision, BOM line, quote document |
| `Activity` | a rule firing, a formula evaluation, a takeoff computation, an approval |
| `Agent` | the client user, the internal estimator, the calc engine (a `SoftwareAgent`) |
| `Plan` (via `hadPlan`) | **the rule version / formula version that was executed** |
| `used` | inputs consumed by that calc step |
| `wasGeneratedBy` | BOM line ← calc step |
| `wasDerivedFrom` | quote BOM line ← preliminary BOM line |
| `Bundle` | the provenance graph for one submission |

`hadPlan` is the piece most homegrown designs miss: it is the standardized slot for "which version of the rule did this."

### 6.2 Database-provenance framing

The database literature (Herschel, Diestelkämper & Lahmar, *A survey on provenance: What for? What form? What from?*, VLDB Journal 26(6), 2017) splits provenance into **why-provenance** (which inputs caused this output to appear), **how-provenance** (the derivation, with multiplicities — i.e. the actual algebra), and **where-provenance** (which source cell the value was copied from). For "show your work," **how-provenance is what you need**: not just "these inputs mattered" but "here is the expression tree that produced 47."

### 6.3 Data-engineering lineage — OpenLineage

OpenLineage models **Job** ("a process that consumes or produces Datasets"), **Run** ("an instance of a Job that represents one of its occurrences in time," UUID-identified, UUIDv7 recommended), and **Dataset**, with three event kinds — `RunEvent` (START/COMPLETE), `JobEvent` (design-time metadata), `DatasetEvent` — extended by **facets** (`sourceCodeLocation`, `sourceCode`, `nominalTime`, `parent`, `sql`, `schema`, `version`, …). The Job/Run split is exactly the `formula_definition` vs `formula_execution` split you want.

**Relevance verdict:** OpenLineage is genuinely useful for your *catalog ingestion* pipeline (price files, vendor part feeds → catalog versions). It is the wrong tool for line-item calculation provenance — too coarse. Use PROV-O concepts for the calc graph, OpenLineage for the pipeline that feeds it.

### 6.4 The four-way trace, concretely

For BOM line `L` you must be able to answer, from stored data alone, with no recomputation:

| Question | Stored as |
|---|---|
| (a) Which configuration inputs? | `L.calc_step.used[] → input_binding_ids` in the submission manifest |
| (b) Which catalog part revision? | `L.part_revision_id` (FK to an immutable revision row) + `catalog_version_id` |
| (c) Which rule version? | `L.calc_step.hadPlan → rule_version_id`, plus the compiled-model hash |
| (d) Which formula, and with what numbers? | `L.calc_step.expression_id` + `L.calc_step.trace` = the evaluated expression tree with every operand, unit, and rounding step |

### ✅ Recommended for this product

1. **Emit a calculation trace as a by-product of evaluation, not as a separate logging pass.** Instrument the evaluator so each node in the expression tree yields `{expr_id, op, operands[], operand_provenance[], value, unit, rounding}`. Reconstructing a trace after the fact from logs is how traceability projects fail.
2. **Persist the trace in PROV-shaped tables** — `prov_entity`, `prov_activity`, `prov_agent`, `prov_used`, `prov_generated`, `prov_association(hadPlan)` — even if you never emit RDF. Using the standard's shape means you can export PROV-JSON later, and it forces you to record `hadPlan`.
3. **Ship "Show your work" as a real user-facing feature.** Click any BOM quantity → a panel showing the formula with symbols, then the same formula with substituted values and units, the rule that selected the part, and the catalog revision with its effective date. This is your strongest differentiator against spreadsheet-based competitors, and it is also your defect-detection mechanism — estimators will find engine bugs for you.
4. **Units are provenance.** Carry a unit (and, where it matters, a tolerance) on every intermediate value. Dimensional analysis catches a large fraction of takeoff errors for free, and unit-mismatch is the classic building-products failure mode (lineal ft vs sq ft vs each).
5. **Rounding is a versioned rule, not an implementation detail.** Record rounding mode and precision per calculation step in the trace. "Why does the new quote say 118 anchors and the old one said 117" is otherwise unanswerable.
6. **Use OpenLineage on catalog ingestion only.** Each price-file load = a Run producing a new `catalog_version` Dataset. This gives you "where did this price come from" for free.

---

## 7. Document release control

### 7.1 ISO 9001 clause 7.5

ISO 9001:2015 clause 7.5 covers **Documented information**: 7.5.1 General, 7.5.2 Creating and updating (identification and description, format, review and approval for suitability and adequacy), 7.5.3 Control of documented information (availability and suitability where needed; adequate protection; and the control activities of distribution/access/retrieval/use, storage and preservation including legibility, control of changes such as version control, and retention and disposition; plus control of external-origin documents and protection of retained records from unintended alteration). **[UNVERIFIED as to exact wording]** — the normative text is paywalled and the ISO OBP viewer is a JS app that returned no content; the structure above is consistent across multiple secondary sources but **do not quote it as ISO text**.

⚠️ **Currency check:** a revision of ISO 9001 is in progress with publication targeted around **2026** (multiple certification bodies — BSI, DNV, TÜV — have published transition guidance). Verify which edition your QMS is certified to before writing clause references into your product's compliance copy.

### 7.2 The AEC convention you should actually copy: ISO 19650

This is the strongest finding for section 7, and it maps onto your preliminary-vs-released problem almost perfectly. Under BS EN ISO 19650-2 and its UK National Annex:

**CDE states** (an information container moves through these):
- **Work in Progress (WIP)** — developed by the originator, not visible to others
- **Shared** — approved for sharing with other task teams / the appointing party
- **Published** — authorized for use in detailed design, construction, or asset management
- **Archive** — the audit trail of transactions

**Suitability / status codes:**
- `S0` — not yet suitable for sharing outside the task team
- `S1` suitable for coordination · `S2` for information · `S3` for review and comment · `S4` for stage approval · `S6` for PIM authorization · `S7` for Stage 6 (handover) authorization (`S5` withdrawn)
- `A1…An` — **authorized and accepted** (contractual), `n` = project stage
- `B1…Bn` — partial sign-off with comments
- `CR` — as-constructed record document

**Revision coding — this is the part to steal:**
- Prefix **`P` = Preliminary (non-contractual)**, **`C` = Contractual**
- Format `[P|C]NN.NN` where the first pair is the shared revision and the second is the WIP iteration
- Progression: `P01.01 → P01.02 → P01` (shared) `→ P02.01 → P02` (shared) `→ C01` (published)

Note how exactly this maps to Windchill's revision/iteration split — `P01.02` is "revision P01, iteration 2." Two independent industries converged on the same structure.

### 7.3 Preliminary output: watermarking and disclaimers

"NOT FOR CONSTRUCTION" is a genuine and near-universal AEC convention, but **[UNVERIFIED as a codified standard]** — I found no standards document defining it; it is established practice, reinforced by professional-licensure rules on sealing incomplete documents (state PE board rules, which vary and which counsel should review for the states you sell into). ISO 19650's `P`-prefix and `S`-code system is the closest thing to a codified equivalent, and it is a better basis for your product than a bare watermark because it is machine-readable.

### ✅ Recommended for this product

1. **Adopt the ISO 19650 `P`/`C` revision prefix directly.** Client self-configured output → `P01`, `P02`, …; internally released quote/BOM → `C01`, `C02`. It is standard, self-explanatory to your AEC-adjacent customers, and structurally identical to the revision/iteration model in §3.
2. **Make preliminary status physically inseparable from the artifact.** Not a footer toggle: a diagonal watermark across every page, a title-block status field, a distinct filename convention (`…_P01_PRELIMINARY.pdf`), and — because PDFs get screenshotted and re-cropped — the status text repeated inside the drawing frame itself. Different color scheme for preliminary vs released, so a printed copy is identifiable across a room.
3. **Standing disclaimer block on all `P`-status output**, with counsel's wording. Typical content: preliminary and for budgetary purposes only; not for construction, permit, fabrication, or procurement; subject to engineering review, site verification, and final approval; quantities are estimates derived from client-supplied inputs; no professional engineering opinion is rendered; pricing valid until `<date>`. Store the **disclaimer version ID** on the generated document — disclaimers get revised, and you need to know which one a 2024 quote carried.
4. **A drawing/document issue register**, which is what ISO 9001 7.5.3 distribution/access control looks like in AEC practice. Columns: document number, title, revision, status code, issue date, issued-to, purpose of issue, transmittal ID, superseded-by. Every outbound PDF creates a row. This gives you "who received rev P02 and did they get the P03 that fixed the beam capacity" — which is a liability question, not a nicety.
5. **Enforce the state machine on release.** `C`-status documents can only be produced from a `Released` quote revision, which requires the approval chain, which requires a completed BOM with no unresolved RFIs. Make it impossible to hand-generate a contractual PDF.
6. **Every generated PDF embeds its provenance**: quote revision, `model_version`, `catalog_version`, engine version, `manifest_hash` (short form), generation timestamp, and a verification URL. Put the hash in the title block. This is what turns "we can re-render your 2024 quote" from a claim into a demonstration.

---

## Consolidated recommendation — the ten load-bearing decisions

1. **Constraint solver for choices, pure parametric functions for quantities.** Strict separation.
2. **`model_version` (rules) and `catalog_version` (parts/prices) are separate, independently pinned, immutable-once-released artifacts** with `effective_start_date` — Oracle Fusion Configurator's exact model.
3. **BOM lines FK to `part_revision_id`, never `part_id`.**
4. **Windchill `REV.ITER` semantics + ISO 19650 `P`/`C` prefixes** — one coherent revision scheme spanning internal versioning and client-facing document status.
5. **Released ⇒ physically immutable** (DB permissions + object-store WORM). Change means new revision, always.
6. **Content-addressed submission manifest** (canonical JSON, SHA-256) as the record of truth; **hash-chained** submissions; **RFC 3161 externally timestamped** daily head. Say "tamper-evident," never "tamper-proof."
7. **Determinism is a hard engineering constraint, enforced by a nightly re-render harness.** No implicit inputs — no `now()`, no live prices, no unordered iteration, at calculation time.
8. **PROV-shaped provenance tables with `hadPlan` populated**, emitted by the evaluator itself; "Show your work" as a shipped feature.
9. **RFI as a first-class, SLA-pausing, revision-creating loop** with structured decline reasons.
10. **Document issue register + inseparable preliminary watermarking + versioned disclaimer IDs.**

The two decisions that are expensive to reverse later and cheap now: **#3 (part revisions on BOM lines)** and **#7 (determinism)**. Everything else can be retrofitted with effort; those two cannot.

---

## Sources

**Configurator / CPQ architecture**
- https://docs.oracle.com/cd/E18727_01/doc.121/e14320/T432549CHDHAEBG.htm — Oracle Configurator Developer User's Guide: the explicit "use currently published Model version" vs "use Model version saved in the configuration" restore choice. The single best primary citation for pinning a saved configuration to a rule version.
- https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/facmg/versions.html — Oracle Fusion Configurator "Manage Workspace Versions": definition of a model version, version 0 baseline, release-increments-version, and latest-by-effective-start-date ≠ most-recently-released.
- https://docs.oracle.com/en/cloud/saas/supply-chain-management/22a/facmg/how-workspaces-snapshots-and-models-work-together.html — Oracle Fusion Configurator workspaces/snapshots/models overview (fetch returned only the guide-level description; used for the workspace→release vocabulary).
- https://learning.sap.com/learning-journeys/implementing-variant-configuration-in-sap-s-4hana-cloud-private-edition/explaining-the-use-and-types-of-dependencies — SAP LO-VC dependency types (precondition, selection condition, procedure, constraint), assignment points, local vs global dependencies, classic vs Advanced Variant Configuration execution sequence.
- https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/cml_cml_core_concepts.htm — Salesforce Revenue Cloud Constraint Modeling Language core concepts: types, variables, relationships/ports, constraints.
- https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/prod_config_overview.htm — Salesforce Product Configurator overview; confirms CML as "a domain-specific language that defines models for complex systems." (No versioning/effectivity documented at this page.)
- https://www.oreilly.com/library/view/knowledge-based-configuration/9780124158177/xhtml/CHP017.xhtml — Felfernig, Hotz, Bagley, Tiihonen, *Knowledge-Based Configuration* (Morgan Kaufmann, 2014), Ch. 17 (Tacton at FLSmidth); the standard academic reference for configuration knowledge representation.
- https://www.semanticscholar.org/paper/Product-Configuration-Frameworks-A-Survey-Sabin-Weigel/1b448ee6245e1fda274a6a3f6621386f4d5ecf62 — Sabin & Weigel, "Product Configuration Frameworks — A Survey," IEEE Intelligent Systems, 1998 (DOI 10.1109/5254.708432). Record page only; **abstract not retrievable** (ACM DL returned 403).
- https://configit.com/learn/blog/valid-configurations-virtual-tabulation/ — **Vendor marketing.** Configit's Virtual Tabulation claim (compiled complete solution space).
- https://configit.com/solutions/clm/configuration-lifecycle-management-for-the-enterprise/ — **Vendor marketing.** Origin of the "Configuration Lifecycle Management" framing.
- https://www.tacton.com/use-case/design-automation/ — **Vendor marketing.** Tacton constraint-based configurator + CAD design automation positioning.

**BOM concepts / effectivity**
- https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/changemanagement/ChgMgmtEffectivityAbout.html — Windchill effectivity types and the planned→actual effectivity transfer on change-notice approval.
- https://support.ptc.com/help/windchill/r13.0.1.0/en/Windchill_Help_Center/changemanagement/ChgMgmtEffectivityTypeDetermine.html — Windchill effectivity type determination by trace code (Date/Serial/MSN/Lot/Block).
- https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/prodstructure/PMConfigSpecEffectivityDate.html — Windchill date-effectivity configuration specification (the "resolve BOM as of date D" mechanism).
- https://support.ptc.com/help/windchill/plus/r12.0.2.0/en/Windchill_Help_Center/PMConfigSpecEffectivityUnit.html — Windchill unit-effectivity configuration specification.
- https://download.consolut.com/direct/SAP_PrintDoku/en/LOECH/LOECH.PDF — SAP Engineering Change Management (LO-ECH) official documentation: change master record, change number, valid-from date, changes with history, object management records, alternative dates, parameter effectivity. Primary source for date-effectivity done properly.
- https://www.siemens.com/en-us/technology/manufacturing-bill-of-materials-mbom/ — **Vendor.** Siemens on MBOM vs EBOM.
- https://www.3ds.com/products/enovia/configuration-management — **Vendor marketing.** ENOVIA terminology: product variants, effectivities, configurable assemblies, 150% BOM, configuration items.
- https://www.iso.org/standard/84300.html — ISO 10303-242:2025 (STEP AP242) scope: product structure/breakdowns, variant management, configuration control, version tracking, release and approval. **Normative text not read.**

**Engineering change / revision control**
- https://support.ptc.com/help/windchill/r12.1.2.0/en/Windchill_Help_Center/objectoview/CommonRevisableObjAbout.html — Windchill's authoritative definitions of version = revision (letter) + iteration (number), iteration increments on check-in, Revise action creates a new revision from the latest iteration.
- https://aras.com/wp-content/uploads/2024/05/Aras-Product-Engineering-14-Users-Guide.pdf — Aras Product Engineering 14 User Guide: CMII change chain (PR → ECR → ECN), Simple/Express ECO/MCO/DCO, Part lifecycle states (Preliminary / In Review / Released / Superseded / Obsolete), released-requires-new-revision rule, release date vs effectivity date.
- https://aras.com/wp-content/uploads/2024/03/cmii-configuration-management-systems-aras-plm-software.pdf — CMII white paper (Institute of Configuration Management material, **vendor-distributed**).
- https://webstore.ansi.org/standards/sae/saeeia649c2019 — SAE EIA-649C (2019) Configuration Management Standard: abstract confirms "five CM functions and their underlying principles" and the enterprise vs acquirer/supplier framing. **Function names not confirmed from this page.**
- https://www.asme.org/codes-standards/find-codes-standards/y14-35-revision-engineering-drawings-associated-documents — ASME Y14.35 scope ("practices for revising drawings … methods for identification and recording revisions"); current edition 2025. **Normative content paywalled.**

**Immutable records / defensibility**
- https://martinfowler.com/eaaDev/EventSourcing.html — Fowler's Event Sourcing: definition, rebuild-by-replay, event log as system of record, snapshots, and the external-query non-determinism caveat.
- https://git-scm.com/book/en/v2/Git-Internals-Git-Objects — Pro Git on the content-addressable object store: blobs/trees/commits, hashing, commit pins a whole tree state. Reference model for content-addressed snapshots.
- https://reproducible-builds.org/docs/definition/ — Authoritative definition of a reproducible build and the three conditions (recorded environment, deterministic build system, hash-based verification).
- https://www.rfc-editor.org/rfc/rfc3161.html — RFC 3161 Time-Stamp Protocol: TimeStampReq/Resp, message imprint = hash, proof-of-existence without disclosing the data.
- https://docs.sigstore.dev/about/security/ — Sigstore/Rekor: append-only transparency log, Signed Tree Head, and the explicit admission that it is tamper-**evident** (short-window forgery possible; undetected misbehavior without third-party monitoring).
- https://www.rfc-editor.org/rfc/rfc9162.pdf — RFC 9162 Certificate Transparency v2: Merkle-tree append-only log with inclusion and consistency proofs. The reference construction for a hash-chained submission log.
- https://www.law.cornell.edu/rules/fre/rule_901 — FRE 901(b)(9) authentication by evidence about a process or system producing an accurate result; 901(b)(1), (4), (7), (8).
- https://www.law.cornell.edu/rules/fre/rule_902 — FRE 902(13) and 902(14) self-authentication; Advisory Committee Note on hash values as the ordinary means of authenticating copies.
- https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11 — 21 CFR 11.10(e): secure, computer-generated, time-stamped audit trails that do not obscure previously recorded information and are retained with the records. Borrowed as a design pattern, not a compliance obligation.
- https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32014R0910 — eIDAS Reg. 910/2014 Arts. 41–42 on electronic time stamps. **Fetch truncated; the Art. 41(2) qualified-timestamp presumption was not confirmed.**

**Quote intake / RFQ**
- https://xml.cxml.org/current/cXMLReferenceGuide.pdf — cXML Reference Guide (continuously republished; version 1.2.07x, 2026): QuoteRequest / QuoteMessage documents, QuoteRequestHeader / QuoteItemOut, QuoteMessageHeader / QuoteItemIn, RFQ document sequence.
- https://www.stedi.com/edi/x12-005050/843 — X12 843 Response to Request for Quotation (release 5050): purpose, ST/BQR header, PO1 detail loop, CTT/SE summary.
- https://www.truecommerce.com/edi-transaction-codes/edi-840/ — **Vendor reference page.** X12 840 Request for Quotation, the paired outbound transaction.
- http://www.datypic.com/sc/oagis941/e-ns1_AddQuote.html — OAGIS 9.4.1 AddQuote schema documentation; confirms AddQuote is deprecated as of 9.0 and OAGi recommends **ProcessQuote** for new development. **OAGIS 10.x quote BODs unverified.**
- https://help-cxsales.oraclecloud.com/cpq/Content/Commerce_Process/Commerce_Process_Overview.htm — Oracle CPQ Commerce Process overview. **Not fetchable (TLS/robots); listed for reference only.**
- https://docs.oracle.com/en/cloud/saas/readiness/sales/24d/scpq24d/24D-cpq-wn-f35119.htm — Oracle CPQ 24D release notes: Commerce Process **Stages** (verified evidence that Oracle models quote intake as staged steps).
- https://trailhead.salesforce.com/content/learn/modules/contract-amendments-with-salesforce-cpq/change-an-existing-contract — Salesforce CPQ amendment quotes: the shipped pattern for revising an already-submitted commercial document.

**Provenance / lineage**
- https://www.w3.org/TR/prov-o/ — PROV-O, W3C Recommendation 30 April 2013: Entity/Activity/Agent, wasGeneratedBy, used, wasDerivedFrom, wasAttributedTo, wasAssociatedWith, and expanded terms Plan, Association/hadPlan, Bundle, wasRevisionOf, specializationOf.
- https://openlineage.io/docs/spec/object-model/ — OpenLineage object model: Job, Run (UUIDv7), Dataset, RunEvent/JobEvent/DatasetEvent, facets. (Column-lineage facet **not** documented on this page.)
- https://link.springer.com/article/10.1007/s00778-017-0486-1 — Herschel, Diestelkämper & Lahmar, "A survey on provenance: What for? What form? What from?", VLDB Journal 26(6), 2017. Source for the why/how/where-provenance distinction. **Abstract page only.**

**Document release control**
- https://www.ukbimframework.org/wp-content/uploads/2021/02/Guidance-Part-C_Facilitating-the-common-data-environment-workflow-and-technical-solutions_Edition-1.pdf — UK BIM Framework Guidance Part C: ISO 19650 CDE states (WIP/Shared/Published/Archive), National Annex status codes S0–S7 / A1–An / B1–Bn / CR, and the **P (preliminary) / C (contractual) revision-coding scheme** with WIP sub-iterations. The most directly transferable convention in this brief.
- https://www.manandmachine.co.uk/understanding-status-codes-bs-en-iso-19650-2-national-annex-a/ — **Vendor/consultancy secondary.** Corroborates the BS EN ISO 19650-2 National Annex A status-code table.
- https://www.isms.online/iso-9001/clause-7-5-documented-information/ — **Secondary.** ISO 9001 clause 7.5 structure. **Normative text not verified.**
- https://www.thecoresolution.com/clause-7-5-3-iso-90012015-explained — **Secondary.** ISO 9001 7.5.3 control activities (legibility, identification/retrieval, protection, retention, disposition of obsolete documents). **Normative text not verified.**
- https://www.bsigroup.com/en-US/products-and-services/standards-services/iso-9001-2026-key-changes-and-guidance/ — **Certification body.** Confirms an ISO 9001 revision targeted for 2026 — verify edition before citing clause numbers in product copy.
- https://www.eng-tips.com/threads/signing-sealing-preliminary-drawings.110769/ — **Practitioner forum, not authoritative.** Illustrates the "not for construction" / preliminary-sealing convention and the licensure concerns around it. Confirm with counsel and the relevant state PE boards.agentId: a9529f7e966e9374b (use SendMessage with to: 'a9529f7e966e9374b', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 139832
tool_uses: 83
duration_ms: 665134</usage>