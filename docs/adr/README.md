# Architecture decision records

**These are canonical here.** ADR-001 through ADR-014 were written in the `rack-studio` reference
project and, until 2026-09-05, existed *only* there — inside
`C:\Rack Master\Resourse (do not delete or overwrite files)\rack-studio\docs\adr\`, a tree this
repository's working agreement forbids writing to.

That is the defect this directory closes. The blueprint and `rack-studio-build-plan.md` cite
ADR-002 through ADR-014 as governing, and resolve open questions with the words *"settled by
ADR-003"* and *"settled by ADR-009"*. Governing decisions were therefore stored where they could
be read but never amended, outside the version control that holds the code they govern. A decision
that cannot be superseded is not a decision record; it is a fossil.

ADR-001..014 were copied verbatim on 2026-09-05 and verified byte-identical to their source by
`md5sum`. The reference copies remain in place, unmodified, and are now historical. **From this
date, `docs/adr/` is the only place an ADR is edited, superseded or added.**

## The register

| ADR | Subject | Status |
|---|---|---|
| [001](ADR-001-tempo-boundary.md) | Tempo boundary — no HTTP in the interaction loop | Accepted |
| [002](ADR-002-screening-not-design.md) | Screening, never design | Accepted |
| [003](ADR-003-display-list.md) | One display list, three renderers | Accepted, amended 2026-08-30 |
| [004](ADR-004-dxf-writer.md) | DXF writer | **Proposed**, pending spike |
| [005](ADR-005-fixed-point.md) | Fixed-point arithmetic | Accepted |
| [006](ADR-006-aisle-datum.md) | Aisle datum | Accepted, generalised by 007 |
| [007](ADR-007-obstruction-faces.md) | Obstruction faces and the clearance index | Accepted |
| [008](ADR-008-entity-model.md) | Entity model — bays reference a bay type | Accepted |
| [009](ADR-009-status-vocabulary.md) | One status vocabulary — seven states | Accepted, amended by 014 |
| [010](ADR-010-remediation-proposals.md) | Remediation proposals | Accepted |
| [011](ADR-011-repo-is-source-of-truth.md) | The repository is the source of truth | Accepted |
| [012](ADR-012-deployment.md) | Deployment, environments and release | **Proposed**; item 1 superseded by [015](ADR-015-hosting-and-system-of-record.md) |
| [013](ADR-013-identity-and-authorization.md) | Identity and authorization | **Proposed**; item 1 superseded by [015](ADR-015-hosting-and-system-of-record.md) |
| [014](ADR-014-revision-lifecycle.md) | Revision lifecycle | Accepted |
| [015](ADR-015-hosting-and-system-of-record.md) | Hosting and the system of record | Accepted · 2026-09-05 |
| [016](ADR-016-studio-web-delivery-track.md) | `apps/studio-web` — audience and delivery track | Accepted · 2026-09-05 |
| [017](ADR-017-spatial-index.md) | Spatial lookup behind an interface | Accepted · 2026-09-05 |
| [018](ADR-018-front-end-state.md) | Front-end state and the command bus | Accepted · 2026-09-05 |
| [019](ADR-019-confidence-badges.md) | Confidence badges are display-list items | Accepted · 2026-09-05 |

## Two records are overtaken, and saying so is the point

**ADR-012 item 1** answers "hosting target" with *"A desktop application. Decided by the product
owner, 2026-08-30."* **ADR-013 item 1** answers identity with *workstation identity*. Both were
decided for a single-tenant internal drafting tool. Rack Master Studio is a multi-tenant
client-facing product with Entra ID for staff and password+TOTP for clients, all of it built and
tested. The blueprint already notes the incompatibility in prose; ADR-015 makes it a record.

Items 2–9 of ADR-012 and 2–8 of ADR-013 remain open and are **not** answered by ADR-015. Neither
ADR can be accepted while they are, and ADR-015 deliberately does not close them by implication.
