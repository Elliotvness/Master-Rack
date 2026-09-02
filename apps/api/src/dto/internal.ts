/**
 * Internal-audience DTOs — one per entity the `/api/internal` routes return.
 *
 * Same discipline as the client side: field by field, never spread, each under
 * a closed schema. The difference is what the schema is ALLOWED to declare —
 * `internalResponse` accepts the fields `FORBIDDEN_CLIENT_FIELDS` denies, and
 * the positive companion tests assert staff DO receive them. A DTO layer that
 * only ever tested absence would pass with an empty response.
 *
 * Closed here too, and for the same reason: an internal response is still a
 * contract, and a column nobody named on it is a column nobody reviewed.
 *
 * Wire case is snake_case, as on the client side.
 */

import {
  array,
  boolean,
  integer,
  internalResponse,
  nullable,
  number,
  object,
  oneOf,
  string,
  type ResponseSchema,
} from '@rms/contracts';

import {
  CLIENT_SCHEMAS,
  REQUEST_STATUSES,
  findingParameter,
  toAssumptionClientDTO,
  toFindingParameterClientDTO,
  type AssumptionClientDTO,
  type FindingParameterClientDTO,
  type FindingParameterEntity,
  type RequestStatus,
} from './client.js';

/** §3.4: DRAFT is "not visible in internal queues" — a submission row is never DRAFT. */
const SUBMITTED_STATUSES = REQUEST_STATUSES.filter((s) => s !== 'DRAFT');
type SubmittedStatus = Exclude<RequestStatus, 'DRAFT'>;

// --------------------------------------------------------------------------
// Queue entry — one row of the internal queue (§8.2 GET /api/internal/v1/queue)
// --------------------------------------------------------------------------

export interface QueueEntryInternalDTO {
  readonly submission_id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly project_number: string;
  /** §3.4's request status in full (less DRAFT, which never reaches a queue) — staff see the real lifecycle, not OD-12's collapse. */
  readonly status: SubmittedStatus;
  readonly submitted_at: string;
  readonly acknowledged_at: string | null;
  readonly quoted_at: string | null;
  readonly blocker_count: number;
  readonly review_count: number;
}

interface QueueEntryEntity {
  submissionId: string;
  organizationId: string;
  organizationName: string;
  projectNumber: string;
  status: SubmittedStatus;
  submittedAt: string;
  acknowledgedAt: string | null;
  quotedAt: string | null;
  blockerCount: number;
  reviewCount: number;
  [extra: string]: unknown;
}

const QueueEntry = internalResponse('QueueEntry', {
  submission_id: string(),
  organization_id: string(),
  organization_name: string(),
  project_number: string(),
  status: string({ enum: SUBMITTED_STATUSES }),
  submitted_at: string(),
  acknowledged_at: nullable(string()),
  quoted_at: nullable(string()),
  blocker_count: integer(),
  review_count: integer(),
});

export function toQueueEntryInternalDTO(entity: QueueEntryEntity): QueueEntryInternalDTO {
  return {
    submission_id: entity.submissionId,
    organization_id: entity.organizationId,
    organization_name: entity.organizationName,
    project_number: entity.projectNumber,
    status: entity.status,
    submitted_at: entity.submittedAt,
    acknowledged_at: entity.acknowledgedAt,
    quoted_at: entity.quotedAt,
    blocker_count: entity.blockerCount,
    review_count: entity.reviewCount,
  };
}

// --------------------------------------------------------------------------
// Finding — the full projection (§9.2: citation, standard, edition, section, tier)
// --------------------------------------------------------------------------

/**
 * A strict superset of the client Finding (§11.3): everything the client
 * sees, plus the rule id, the citation in full, the tier, and the waiver
 * fields — which are internal-only and only ever set for waivable codes.
 */
export interface FindingInternalDTO {
  readonly code: string;
  readonly severity: string;
  readonly subject_object_ids: readonly string[];
  readonly parameters: readonly FindingParameterClientDTO[];
  readonly closed_by: string;
  readonly rule_id: string;
  readonly citation: string;
  readonly standard: string;
  readonly edition: string;
  readonly section: string;
  readonly verification_tier: string;
  readonly waived_by: string | null;
  readonly waived_at: string | null;
  readonly waiver_reason: string | null;
}

interface FindingInternalEntity {
  code: string;
  severity: string;
  closed_by: string;
  subject_object_ids: readonly string[];
  parameters: readonly FindingParameterEntity[];
  rule_id: string;
  citation: string;
  standard: string;
  edition: string;
  section: string;
  verification_tier: string;
  waived_by?: string | null;
  waived_at?: string | null;
  waiver_reason?: string | null;
  [extra: string]: unknown;
}

const Finding = internalResponse('Finding', {
  code: string(),
  severity: string(),
  subject_object_ids: array(string()),
  parameters: array(findingParameter),
  closed_by: string(),
  rule_id: string(),
  citation: string(),
  standard: string(),
  edition: string(),
  section: string(),
  verification_tier: string(),
  waived_by: nullable(string()),
  waived_at: nullable(string()),
  waiver_reason: nullable(string()),
});

export function toFindingInternalDTO(entity: FindingInternalEntity): FindingInternalDTO {
  return {
    code: entity.code,
    severity: entity.severity,
    subject_object_ids: [...entity.subject_object_ids],
    parameters: entity.parameters.map(toFindingParameterClientDTO),
    closed_by: entity.closed_by,
    rule_id: entity.rule_id,
    citation: entity.citation,
    standard: entity.standard,
    edition: entity.edition,
    section: entity.section,
    verification_tier: entity.verification_tier,
    waived_by: entity.waived_by ?? null,
    waived_at: entity.waived_at ?? null,
    waiver_reason: entity.waiver_reason ?? null,
  };
}

// --------------------------------------------------------------------------
// BOM line — internal takeoff (§8.2 GET /api/internal/v1/revisions/:id/bom)
// --------------------------------------------------------------------------

export type PartRefInternalDTO =
  | { readonly kind: 'catalog'; readonly part_revision_id: string }
  | { readonly kind: 'uncatalogued'; readonly uncatalogued_part_id: string; readonly measured_geometry: string };

export interface BomLineInternalDTO {
  readonly category: string;
  readonly part_ref: PartRefInternalDTO;
  /** Manufacturer part number — Hidden from clients (§9.2), visible here. Null for uncatalogued material. */
  readonly mpn: string | null;
  readonly uom: string;
  readonly rule_text: string;
  readonly rule_id: string | null;
  readonly confirmed: boolean;
  readonly source_object_ids: readonly string[];
  readonly resolved: boolean;
  readonly qty: { readonly value: number; readonly unit: string } | null;
  readonly unresolved_reason: string | null;
}

type PartRefEntity =
  | { kind: 'catalog'; partRevisionId: string }
  | { kind: 'uncatalogued'; uncataloguedPartId: string; measuredGeometry: string };

interface BomLineEntity {
  category: string;
  partRef: PartRefEntity;
  mpn: string | null;
  uom: string;
  ruleText: string;
  ruleId: string | null;
  confirmed: boolean;
  sourceObjectIds: readonly string[];
  resolved: boolean;
  qty: { value: number; unit: string } | null;
  unresolvedReason: string | null;
  [extra: string]: unknown;
}

const BomLine = internalResponse('BomLine', {
  category: string(),
  part_ref: oneOf([
    object({ kind: string({ enum: ['catalog'] }), part_revision_id: string() }),
    // Measured geometry only. There is deliberately no capacity field — the
    // kernel's PartRef has none, and the schema being closed keeps it that way.
    object({ kind: string({ enum: ['uncatalogued'] }), uncatalogued_part_id: string(), measured_geometry: string() }),
  ]),
  mpn: nullable(string()),
  uom: string(),
  rule_text: string(),
  rule_id: nullable(string()),
  confirmed: boolean(),
  source_object_ids: array(string()),
  resolved: boolean(),
  qty: nullable(object({ value: number(), unit: string() })),
  unresolved_reason: nullable(string()),
});

function toPartRefInternalDTO(ref: PartRefEntity): PartRefInternalDTO {
  switch (ref.kind) {
    case 'catalog':
      return { kind: 'catalog', part_revision_id: ref.partRevisionId };
    case 'uncatalogued':
      return { kind: 'uncatalogued', uncatalogued_part_id: ref.uncataloguedPartId, measured_geometry: ref.measuredGeometry };
  }
}

export function toBomLineInternalDTO(entity: BomLineEntity): BomLineInternalDTO {
  return {
    category: entity.category,
    part_ref: toPartRefInternalDTO(entity.partRef),
    mpn: entity.mpn,
    uom: entity.uom,
    rule_text: entity.ruleText,
    rule_id: entity.ruleId,
    confirmed: entity.confirmed,
    source_object_ids: [...entity.sourceObjectIds],
    resolved: entity.resolved,
    qty: entity.qty === null ? null : { value: entity.qty.value, unit: entity.qty.unit },
    unresolved_reason: entity.unresolvedReason,
  };
}

// --------------------------------------------------------------------------
// Internal note (§8.2 POST /api/internal/v1/revisions/:id/notes)
// --------------------------------------------------------------------------

export interface InternalNoteDTO {
  readonly id: string;
  readonly submission_id: string;
  readonly author_id: string;
  readonly body: string;
  readonly created_at: string;
  /** Structural marker carried onto the wire: an internal note says so about itself. */
  readonly client_visible: false;
}

interface InternalNoteEntity {
  id: string;
  submissionId: string;
  authorId: string;
  body: string;
  createdAt: string;
  clientVisible: false;
  [extra: string]: unknown;
}

const InternalNote = internalResponse('InternalNote', {
  id: string(),
  submission_id: string(),
  author_id: string(),
  body: string(),
  created_at: string(),
  client_visible: boolean(),
});

export function toInternalNoteDTO(entity: InternalNoteEntity): InternalNoteDTO {
  return {
    id: entity.id,
    submission_id: entity.submissionId,
    author_id: entity.authorId,
    body: entity.body,
    created_at: entity.createdAt,
    client_visible: false,
  };
}

// --------------------------------------------------------------------------
// Revision — the internal projection (§7): audience, lifecycle and tenant shown
// --------------------------------------------------------------------------

const LIFECYCLE_STATES = ['DRAFT', 'FROZEN', 'SUPERSEDED', 'WITHDRAWN'] as const;

export interface RevisionInternalDTO {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string;
  /** P-series for the client lineage, C-series for the internal one (§7). */
  readonly code: string;
  readonly iteration: number;
  readonly audience: 'client' | 'internal';
  readonly lifecycle_state: (typeof LIFECYCLE_STATES)[number];
  readonly content_hash: string | null;
  readonly derived_from_revision_id: string | null;
  readonly created_at: string;
}

interface RevisionInternalEntity {
  id: string;
  organization_id: string;
  project_id: string;
  code: string;
  iteration: number;
  audience: 'client' | 'internal';
  lifecycle_state: (typeof LIFECYCLE_STATES)[number];
  content_hash: string | null;
  derived_from_revision_id: string | null;
  created_at: string;
  [extra: string]: unknown;
}

const Revision = internalResponse('Revision', {
  id: string(),
  organization_id: string(),
  project_id: string(),
  code: string(),
  iteration: integer(),
  audience: string({ enum: ['client', 'internal'] }),
  lifecycle_state: string({ enum: LIFECYCLE_STATES }),
  content_hash: nullable(string()),
  derived_from_revision_id: nullable(string()),
  created_at: string(),
});

export function toRevisionInternalDTO(entity: RevisionInternalEntity): RevisionInternalDTO {
  return {
    id: entity.id,
    organization_id: entity.organization_id,
    project_id: entity.project_id,
    code: entity.code,
    iteration: entity.iteration,
    audience: entity.audience,
    lifecycle_state: entity.lifecycle_state,
    content_hash: entity.content_hash,
    derived_from_revision_id: entity.derived_from_revision_id,
    created_at: entity.created_at,
  };
}

// --------------------------------------------------------------------------
// Organization (§8.2 POST /api/internal/v1/organizations)
// --------------------------------------------------------------------------

export interface OrganizationInternalDTO {
  readonly id: string;
  readonly name: string;
  readonly is_internal: boolean;
  readonly status: string;
  readonly created_at: string;
}

interface OrganizationEntity {
  id: string;
  name: string;
  is_internal: boolean;
  status: string;
  created_at: string;
  [extra: string]: unknown;
}

const Organization = internalResponse('Organization', {
  id: string(),
  name: string(),
  is_internal: boolean(),
  status: string(),
  created_at: string(),
});

export function toOrganizationInternalDTO(entity: OrganizationEntity): OrganizationInternalDTO {
  return {
    id: entity.id,
    name: entity.name,
    is_internal: entity.is_internal,
    status: entity.status,
    created_at: entity.created_at,
  };
}

// --------------------------------------------------------------------------
// Invitation — the staff view (§8.2 POST /api/internal/v1/invitations): says which org
// --------------------------------------------------------------------------

export interface InvitationInternalDTO {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: string;
  readonly expires_at: string;
  readonly issued_by: string;
}

interface InvitationInternalEntity {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  expires_at: string;
  issued_by: string;
  /** The plaintext token goes in the email link, once. Never a response field, for staff either. */
  token?: string;
  token_hash?: string;
  [extra: string]: unknown;
}

const Invitation = internalResponse('Invitation', {
  id: string(),
  organization_id: string(),
  email: string(),
  role: string(),
  expires_at: string(),
  issued_by: string(),
});

export function toInvitationInternalDTO(entity: InvitationInternalEntity): InvitationInternalDTO {
  return {
    id: entity.id,
    organization_id: entity.organization_id,
    email: entity.email,
    role: entity.role,
    expires_at: entity.expires_at,
    issued_by: entity.issued_by,
  };
}

// --------------------------------------------------------------------------
// Catalog release (§8.2 POST /api/internal/v1/catalog/releases/:id/approve)
// --------------------------------------------------------------------------

const RELEASE_STATUSES = ['DRAFT', 'APPROVED', 'SUPERSEDED', 'RETIRED', 'QUARANTINED'] as const;

export interface CatalogReleaseInternalDTO {
  readonly id: string;
  readonly manufacturer: string;
  readonly rev: string;
  readonly status: (typeof RELEASE_STATUSES)[number];
  readonly source_document: string;
  readonly digitised_by: string;
  readonly digitised_at: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly content_sha256: string;
  readonly datasets: readonly string[];
}

interface CatalogReleaseEntity {
  id: string;
  manufacturer: string;
  rev: string;
  status: (typeof RELEASE_STATUSES)[number];
  sourceDocument: string;
  digitisedBy: string;
  digitisedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  contentSha256: string;
  datasets: readonly string[];
  [extra: string]: unknown;
}

const CatalogRelease = internalResponse('CatalogRelease', {
  id: string(),
  manufacturer: string(),
  rev: string(),
  status: string({ enum: RELEASE_STATUSES }),
  source_document: string(),
  digitised_by: string(),
  digitised_at: string(),
  approved_by: nullable(string()),
  approved_at: nullable(string()),
  content_sha256: string(),
  datasets: array(string()),
});

export function toCatalogReleaseInternalDTO(entity: CatalogReleaseEntity): CatalogReleaseInternalDTO {
  return {
    id: entity.id,
    manufacturer: entity.manufacturer,
    rev: entity.rev,
    status: entity.status,
    source_document: entity.sourceDocument,
    digitised_by: entity.digitisedBy,
    digitised_at: entity.digitisedAt,
    approved_by: entity.approvedBy,
    approved_at: entity.approvedAt,
    content_sha256: entity.contentSha256,
    datasets: [...entity.datasets],
  };
}

// --------------------------------------------------------------------------
// Submission package — "full package incl. BOM, citations, notes" (§8.2)
// --------------------------------------------------------------------------

export interface SubmissionPackageInternalDTO {
  readonly submission: {
    readonly id: string;
    readonly organization_id: string;
    readonly revision_id: string;
    readonly request_status: SubmittedStatus;
    readonly manifest_hash: string;
    readonly submission_hash: string;
    readonly decline_reason: string | null;
    readonly submitted_by: string;
    readonly submitted_at: string;
    readonly acknowledged_at: string | null;
    readonly quoted_at: string | null;
  };
  readonly revision: RevisionInternalDTO;
  readonly assumptions: readonly AssumptionClientDTO[];
  readonly findings: readonly FindingInternalDTO[];
  readonly bom_lines: readonly BomLineInternalDTO[];
  readonly notes: readonly InternalNoteDTO[];
}

interface SubmissionPackageEntity {
  submission: {
    id: string;
    organization_id: string;
    revision_id: string;
    request_status: SubmittedStatus;
    manifest_hash: string;
    this_hash: string;
    decline_reason: string | null;
    submitted_by: string;
    submitted_at: string;
    acknowledged_at: string | null;
    quoted_at: string | null;
    [extra: string]: unknown;
  };
  revision: RevisionInternalEntity;
  assumptions: readonly Parameters<typeof toAssumptionClientDTO>[0][];
  findings: readonly FindingInternalEntity[];
  bomLines: readonly BomLineEntity[];
  notes: readonly InternalNoteEntity[];
  [extra: string]: unknown;
}

const SubmissionPackage = internalResponse('SubmissionPackage', {
  submission: object({
    id: string(),
    organization_id: string(),
    revision_id: string(),
    request_status: string({ enum: SUBMITTED_STATUSES }),
    manifest_hash: string(),
    submission_hash: string(),
    decline_reason: nullable(string()),
    submitted_by: string(),
    submitted_at: string(),
    acknowledged_at: nullable(string()),
    quoted_at: nullable(string()),
  }),
  revision: Revision,
  // The register is the same shape for both audiences (§9.2: Visible /
  // Visible), so the internal audience has no Assumption DTO of its own — the
  // review package shows staff exactly the register the client acknowledged,
  // by reusing the client schema. A client schema embedded in an internal one
  // is the safe direction. The day an internal-only assumption field exists,
  // this line is where the split happens.
  assumptions: array(CLIENT_SCHEMAS.Assumption),
  findings: array(Finding),
  bom_lines: array(BomLine),
  notes: array(InternalNote),
});

export function toSubmissionPackageInternalDTO(entity: SubmissionPackageEntity): SubmissionPackageInternalDTO {
  const s = entity.submission;
  return {
    submission: {
      id: s.id,
      organization_id: s.organization_id,
      revision_id: s.revision_id,
      request_status: s.request_status,
      manifest_hash: s.manifest_hash,
      submission_hash: s.this_hash,
      decline_reason: s.decline_reason,
      submitted_by: s.submitted_by,
      submitted_at: s.submitted_at,
      acknowledged_at: s.acknowledged_at,
      quoted_at: s.quoted_at,
    },
    revision: toRevisionInternalDTO(entity.revision),
    assumptions: entity.assumptions.map(toAssumptionClientDTO),
    findings: entity.findings.map(toFindingInternalDTO),
    bom_lines: entity.bomLines.map(toBomLineInternalDTO),
    notes: entity.notes.map(toInternalNoteDTO),
  };
}

// --------------------------------------------------------------------------
// Audit event (§8.2 GET /api/internal/v1/audit — phase 2; the shape is MVP-1's chain)
// --------------------------------------------------------------------------

export interface AuditEventInternalDTO {
  readonly id: string;
  readonly occurred_at: string;
  readonly actor_user_id: string | null;
  readonly actor_type: 'client' | 'staff' | 'service';
  readonly actor_organization_id: string | null;
  readonly impersonated_by: string | null;
  readonly subject_organization_id: string | null;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly outcome: string;
  readonly reasons: readonly string[];
  readonly this_hash: string;
}

interface AuditEventEntity {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorType: 'client' | 'staff' | 'service';
  actorOrganizationId: string | null;
  impersonatedBy: string | null;
  subjectOrganizationId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  reasons: readonly string[];
  thisHash: string;
  [extra: string]: unknown;
}

const AuditEvent = internalResponse('AuditEvent', {
  id: string(),
  occurred_at: string(),
  actor_user_id: nullable(string()),
  actor_type: string({ enum: ['client', 'staff', 'service'] }),
  actor_organization_id: nullable(string()),
  impersonated_by: nullable(string()),
  subject_organization_id: nullable(string()),
  action: string(),
  resource_type: string(),
  resource_id: nullable(string()),
  outcome: string(),
  reasons: array(string()),
  this_hash: string(),
});

export function toAuditEventInternalDTO(entity: AuditEventEntity): AuditEventInternalDTO {
  return {
    id: entity.id,
    occurred_at: entity.occurredAt,
    actor_user_id: entity.actorUserId,
    actor_type: entity.actorType,
    actor_organization_id: entity.actorOrganizationId,
    impersonated_by: entity.impersonatedBy,
    subject_organization_id: entity.subjectOrganizationId,
    action: entity.action,
    resource_type: entity.resourceType,
    resource_id: entity.resourceId,
    outcome: entity.outcome,
    reasons: [...entity.reasons],
    this_hash: entity.thisHash,
  };
}

// --------------------------------------------------------------------------
// The registry
// --------------------------------------------------------------------------

export const INTERNAL_SCHEMAS = Object.freeze({
  QueueEntry,
  Finding,
  BomLine,
  InternalNote,
  Revision,
  Organization,
  Invitation,
  CatalogRelease,
  SubmissionPackage,
  AuditEvent,
} satisfies Readonly<Record<string, ResponseSchema>>);
