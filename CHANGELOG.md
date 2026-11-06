# Changelog

All notable changes to **Rack Master Studio** (`@rms/*`) are recorded in this file.

## [Unreleased]

### Studio redesign — blueprint visual system (ADR-020)
- **ADR-020**: the product owner chose the Project Scout blueprint direction for `apps/studio-web` (2026-11-06) — one steel-blue palette, square corners, Barlow type, navigation by job step.
- **F-67 (closed)**: `tokens.css` is now the only palette. `industry-blueprint.css` → `theme/components.css` with no colour of its own; 19 token names components used but nothing declared are now defined as aliases; every literal colour in `studio.css` replaced by a token. `tokens.test.ts` fails on an undefined `var(--name)` or a literal colour in any other stylesheet (both proven by planted failures). The INFO and MISSING status chips now pass AA (were 2.80:1 and 4.02:1).
- `plan/use-pens.test.ts` pins the canvas pens' fallback colours to `tokens.css`.
- **Navigation by job step (ADR-020)**: the chrome is brand · job · actions over a step bar — Facility, Options, Layout, Takeoff, Sheets, Review & submit — with Plan, Elevation and Checks as the Layout step's views. Facility and Options were routed but unreachable from the chrome. Keyboard order still reaches undo, save and theme last. Screen headings now match their navigation labels (Checks, Takeoff, Review & submit) with plain-language subtitles in place of section and requirement ids.
- McMurray Stern wordmark in the chrome (colour on light, white on dark, including follow-system) and the monogram as favicon; the theme button draws its icon instead of a glyph the font lacked (it rendered as "‹"). `index.html` loads three font families instead of seven.
- The screening-only notice is unchanged in wording, still on every view and still not dismissible; it is now a compact strip.
- Facility number fields no longer cut their placeholder to "Ent".

## [0.1.0-mvp1] — 2026-11-04

### Phase 0 — Governance & Baseline Infrastructure
- **T-00 / T-01 / T-02**: Remote CI workflow (`.github/workflows/ci.yml`), pre-commit hook (`tools/hooks/pre-commit`), overclaiming language guard (`tools/check-language.mjs`), and deterministic catalog spot-check draw self-test (`tools/selftest-spot-check.mjs`).
- **T-27 / T-28**: Root test type-checking (`tsconfig.tests.json`) and isolated temporary directories for all checker self-tests.

### Phase 1 & 2 — Kernel, Database & Tenant Isolation
- **13 Pure Packages (`100%` line, branch, function, and statement coverage)**:
  - `@rms/kernel-units`, `@rms/kernel-model`, `@rms/kernel-catalog`, `@rms/kernel-rules`, `@rms/kernel-derive`, `@rms/kernel-checks`, `@rms/kernel-bom`, `@rms/kernel- golden`, `@rms/display-list`, `@rms/contracts`, `@rms/workflow`, `@rms/studio-model`, `@rms/render-svg`.
- **Database & Row-Level Security (`T-03`, `T-04`, `T-05`, `T-06`, `T-07`, `T-08`, `T-09`)**:
  - 16 PostgreSQL migrations enforcing tenant RLS across 22 tables, 86 privilege grants, and 8 functions (`app_user` with `NOBYPASSRLS` and `FORCE ROW LEVEL SECURITY`).
  - Content-only hash (`contentHash`) separated from submission `manifestHash` (`T-05`).
  - Structured `Assumption` register (`0009_assumption_record.sql`) linked by foreign key to `app.audit_event` (`T-06`).
  - Pure workflow package (`@rms/workflow`) owning the 9-step submission sequence, `deriveInternalRevision`, `internalNote`, and `stripInternalRevisions` (`T-07`, `T-08`).
  - Queryable `app.part` and `app.part_revision` projection (`0010_part_registry.sql`) keyed by `code_18` (`T-09`).
- **Checker Suite (`T-10a`, `T-10b`, `T-11`, `T-12`)**:
  - 20 self-test invocations covering 19 automated checkers in `pnpm verify` and CI, plus checksum-pinned `gitleaks` secret scanning.

### Phase 3 — Server, Contracts, Idempotency & Performance Benchmarks
- **Error Envelope, Outbound & Inbound DTOs (`T-13a`, `T-13b`, `T-13c`)**:
  - Single error envelope (`@rms/contracts`), audience-separated outbound DTOs (`apps/api/src/dto/client.ts` and `internal.ts` at `100%` coverage), and mass-assignment-safe input DTO builders backed by `tools/check-server-owned.mjs`.
- **Idempotency Store (`T-13d`)**:
  - Atomic `(organization_id, key)` claims (`0011_idempotency.sql`), 10-minute configurable lease (`0012_idempotency_lease.sql`), `lease_epoch` fencing (`0013_idempotency_fence.sql`), and `INTERNAL_ADMIN` operator release.
- **Fastify API Server & Route Surface (`T-14a`–`T-14e`, `T-15`)**:
  - All 33 MVP-1 routes declared in Blueprint §8.2 and `apps/api/src/authz/routes.ts` (`15 client`, `13 internal`, `5 public`) mounted and verified at boot via `routerCoverageProblems`.
  - Invite acceptance (`0014_resolve_invitation_tenant.sql`, `0015_session_purpose.sql`), TOTP MFA enrollment/verification, Entra ID OIDC PKCE (`S256`) staff sign-in, client drafting, unified `@rms/display-list` plan and elevation previews (`F-63`), idempotent submission with 7-year compliance WORM manifest storage, asynchronous multi-page PDF outbox worker (`P-03`), and internal triage/BOM/derivation routes.
  - Contract and cross-tenant isolation proofs (`AC-02`, `AC-03`, `AC-06`) verified against the live router and PostgreSQL 16 (`T-15`).
- **Performance Benchmarks (`P-00`, `P-01`, `P-02`, `P-03`, `P-05`)**:
  - 300-bay submission (`p50 19.36 ms`, `p95 26.65 ms` vs `2,000 ms` budget), 5,000-row queue load (`p50 25.83 ms`, `p95 32.06 ms` vs `800 ms` budget in constant `2` SQL statements), 300-bay 9-page preliminary PDF job (`p50 5.61 ms`, `p95 8.45 ms` vs `6,000 ms` budget), and initial web bundle size (`100 KB gz` vs `200 KB gz` budget).

### Phase 4 — Studio Web Interface & AI Spec-Sheet Intake
- **Design System, Renderers & MVP Slices (`T-16`, `T-17`, `T-18a`–`T-18e`, `T-19`)**:
  - WCAG 2.1 AA light/dark design tokens (`T-16`), `@rms/render-svg` and `@rms/render-canvas` display-list renderers (`T-17`, `100%` coverage), invitation/MFA/sign-in flow (`T-18a`), facility/unit entry with `not_known` vs `not_answered` distinction (`T-18b`), controlled-vocabulary option builder with Demo Beat 5 off-grid 110" refusal (`T-18c`), plan/elevation/3D/screening/takeoff/revisions workspace (`T-18d`, `T-18e`, `T-19`), and executable 8-step walkthrough (`AC-20` in `apps/api/src/e2e-walkthrough.db.test.ts`).
- **AI Spec-Sheet Intake & Command Bar (`Phase 3 Studio`)**:
  - Pure `@rms/studio-model` schemas and validators (`intake.ts`, `command-bar.ts`) with atomic `BatchCommand` undo/redo, explicit `MANUAL_VERIFY` fallback on off-grid spans, and server-side `@google/genai` adapter (`apps/api/src/ai/gemini-adapter.ts` at `100%` coverage) mounted at `POST /api/client/v1/intake` (`store: false`, paid tier required).

### Phase 5 — Observability & Rollback Triggers (`T-22`, `T-26`)
- **Correlation IDs & Day-One Alerts (`T-22`)**:
  - Request correlation ID (`x-correlation-id`) propagated on every HTTP request and response (`NFR-OB-01`).
  - Six `NFR-OB-03` day-one alert codes (`DAY_ONE_ALERT_CODES`) and `onAlert` hook in `createApp`, firing `INTERNAL_FIELD_ON_CLIENT_RESPONSE` as an immediate incident at a count of `1` and `REPEATED_AUTHZ_DENIALS` at threshold.
- **Standing Rollback Triggers (`T-26`, per `tasks/plan.md`)**:
  1. Any internal-only field on a client-facing response (`INTERNAL_FIELD_ON_CLIENT_RESPONSE` at count `1`).
  2. Audit hash-chain verification failure (`AUDIT_CHAIN_VERIFICATION_FAILURE`).
  3. Determinism harness failure (`DETERMINISM_HARNESS_FAILURE`).
  4. Latency SLA breach (`SLA_BREACH`: preview update p95 > 120 ms; full derivation p95 > 400 ms; submit p95 > 2 s; queue p95 > 800 ms at 5,000 rows).
  5. Failed catalog release gate (`FAILED_CATALOG_RELEASE_GATE`).
  6. Repeated authorization denials for a single principal above baseline (`REPEATED_AUTHZ_DENIALS`).
