/**
 * Client-audience DTOs — one per entity the `/api/client` routes return, each
 * constructed field by field, each published under a closed schema.
 *
 * The rule that matters most in the whole product (blueprint §9.1): internal
 * commercial data never reaches a client. This module is the LAST line of that
 * defense — the physically separate tables and the RLS actor_type predicate are
 * the first — and it is built to make a leak a TEST failure, never a
 * code-review catch.
 *
 * Three disciplines, two of them new with T-13b:
 *   1. Deny-by-default construction. A DTO is built field by field, never
 *      spread from an entity and never `omit([...])`. Spreading ships the next
 *      column someone adds; naming the fields ships only what was named.
 *   2. A closed schema per DTO (`@rms/contracts` `clientResponse`), which is
 *      the OpenAPI `additionalProperties: false` promise as a value the
 *      outbound guard reads. The schema constructor refuses a forbidden field
 *      at declaration, so "add `cost` to a client DTO" is red when the module
 *      loads.
 *   3. One shared forbidden-field constant, used by the leakage test, the log
 *      redactor and the outbound guard. One list, three consumers, so they
 *      cannot drift.
 *
 * Wire case is snake_case, matching §9.2 and the forbidden list — a leak is
 * found by key, and the key has to be spelled the way the list spells it.
 */

import {
  array,
  boolean,
  clientResponse,
  integer,
  isForbiddenClientField,
  nullable,
  number,
  object,
  oneOf,
  string,
  type ObjectSchema,
  type ResponseSchema,
} from '@rms/contracts';

// The forbidden-field list and its walk live in `@rms/contracts` (T-13a).
// Re-exported so existing callers are unaffected.
export {
  FORBIDDEN_CLIENT_FIELDS,
  findForbiddenFields,
  isForbiddenClientField,
} from '@rms/contracts';

// --------------------------------------------------------------------------
// Project
// --------------------------------------------------------------------------

export interface ProjectClientDTO {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
}

interface ProjectEntity {
  id: string;
  number: string;
  name: string;
  status: string;
  organization_id: string;
  [extra: string]: unknown;
}

const Project = clientResponse('Project', {
  id: string(),
  number: string(),
  name: string(),
  status: string(),
});

/**
 * Note what this does NOT do: it never spreads `entity`. Even though a project
 * carries no commercial data today, spreading would ship whatever column is
 * added next. Naming the four fields ships exactly four fields, forever.
 */
export function toProjectClientDTO(entity: ProjectEntity): ProjectClientDTO {
  return {
    id: entity.id,
    number: entity.number,
    name: entity.name,
    status: entity.status,
  };
}

// --------------------------------------------------------------------------
// Revision — the spine (§7). The client sees its own lineage only.
// --------------------------------------------------------------------------

export interface RevisionClientDTO {
  readonly id: string;
  /** P-series code (P01, P02 …) — the client lineage, never a C code. */
  readonly code: string;
  readonly iteration: number;
  readonly frozen: boolean;
  /** §7.4 content hash once frozen; the client's proof of immutability. */
  readonly content_hash: string | null;
  readonly derived_from_revision_id: string | null;
}

interface RevisionEntity {
  id: string;
  code: string;
  iteration: number;
  frozen: boolean;
  content_hash: string | null;
  derived_from_revision_id: string | null;
  // Never on the wire: the audience split, the tenant, the internal lifecycle.
  audience?: string;
  organization_id?: string;
  lifecycle_state?: string;
  [extra: string]: unknown;
}

const Revision = clientResponse('Revision', {
  id: string(),
  code: string(),
  iteration: integer(),
  frozen: boolean(),
  content_hash: nullable(string()),
  derived_from_revision_id: nullable(string()),
});

export function toRevisionClientDTO(entity: RevisionEntity): RevisionClientDTO {
  return {
    id: entity.id,
    code: entity.code,
    iteration: entity.iteration,
    frozen: entity.frozen,
    content_hash: entity.content_hash,
    derived_from_revision_id: entity.derived_from_revision_id,
  };
}

// --------------------------------------------------------------------------
// Assumption — the register (§9.2: visible to both audiences)
// --------------------------------------------------------------------------

export interface AssumptionClientDTO {
  readonly key: string;
  readonly assumed_value: { readonly value: number; readonly unit: string };
  readonly why: string;
  readonly scope: string;
  readonly acknowledged_by: string | null;
  readonly acknowledged_at: string | null;
}

interface AssumptionEntity {
  key: string;
  assumedValue: { value: number; unit: string };
  why: string;
  scope: string;
  acknowledgedBy?: string | undefined;
  acknowledgedAt?: string | undefined;
  [extra: string]: unknown;
}

const Assumption = clientResponse('Assumption', {
  key: string(),
  assumed_value: object({ value: number(), unit: string() }),
  why: string(),
  scope: string(),
  acknowledged_by: nullable(string()),
  acknowledged_at: nullable(string()),
});

export function toAssumptionClientDTO(entity: AssumptionEntity): AssumptionClientDTO {
  return {
    key: entity.key,
    assumed_value: { value: entity.assumedValue.value, unit: entity.assumedValue.unit },
    why: entity.why,
    scope: entity.scope,
    // Unacknowledged is null on the wire, not absent: "not yet" and "not sent"
    // must be distinguishable to the screen that asks for the acknowledgement.
    acknowledged_by: entity.acknowledgedBy ?? null,
    acknowledged_at: entity.acknowledgedAt ?? null,
  };
}

// --------------------------------------------------------------------------
// Finding — the client-safe projection (§9.2: severity + what would close it)
// --------------------------------------------------------------------------

/**
 * §11.3: a parameter is a named value with an `established` flag. An
 * unestablished parameter renders as VERIFY, never as a numeral — so it has
 * no `value` on the wire at all, and a `reason` says why in words a client
 * can act on ("no load was stated for this level"). Absence is the encoding:
 * the two variants have disjoint key sets, so the schema pins exactly what
 * the type pins — an established parameter cannot lack its value and an
 * unestablished one cannot carry one.
 */
export type FindingParameterClientDTO =
  | { readonly name: string; readonly established: true; readonly value: { readonly value: number; readonly unit: string } }
  | { readonly name: string; readonly established: false; readonly reason: string };

export interface FindingClientDTO {
  readonly code: string;
  readonly severity: string;
  /** Which run / bay / level / aisle this is about — what the screen highlights. */
  readonly subject_object_ids: readonly string[];
  readonly parameters: readonly FindingParameterClientDTO[];
  /** What would resolve it — the only "internal" thing a client is shown, in plain words. */
  readonly closed_by: string;
}

export type FindingParameterEntity =
  | { name: string; established: true; value: { value: number; unit: string } }
  | { name: string; established: false; value: null; reason: string };

interface FindingEntity {
  code: string;
  severity: string;
  closed_by: string;
  // Required, as on the kernel's Finding: a producer that forgets the join
  // must not ship a finding that silently claims no subjects.
  subject_object_ids: readonly string[];
  parameters: readonly FindingParameterEntity[];
  // These live on the internal projection and must never cross into the client one.
  rule_id?: string;
  citation?: string;
  verification_tier?: string;
  [extra: string]: unknown;
}

/** Shared with the internal Finding, which is a superset of this one. */
export const findingParameter = oneOf([
  object({ name: string(), established: boolean({ enum: [true] }), value: object({ value: number(), unit: string() }) }),
  object({ name: string(), established: boolean({ enum: [false] }), reason: string() }),
]);

const Finding = clientResponse('Finding', {
  code: string(),
  severity: string(),
  subject_object_ids: array(string()),
  parameters: array(findingParameter),
  closed_by: string(),
});

export function toFindingParameterClientDTO(p: FindingParameterEntity): FindingParameterClientDTO {
  return p.established
    ? { name: p.name, established: true, value: { value: p.value.value, unit: p.value.unit } }
    : { name: p.name, established: false, reason: p.reason };
}

export function toFindingClientDTO(entity: FindingEntity): FindingClientDTO {
  return {
    code: entity.code,
    severity: entity.severity,
    subject_object_ids: [...entity.subject_object_ids],
    parameters: entity.parameters.map(toFindingParameterClientDTO),
    closed_by: entity.closed_by,
  };
}

// --------------------------------------------------------------------------
// Preview — display list, counts, assumptions, client-safe findings (§8.2)
// --------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}
interface DisplayText {
  readonly text: string;
  readonly established: boolean;
}

/** The display list's closed item union, as the client receives it. */
export type DisplayItemClientDTO =
  | { readonly kind: 'rect'; readonly item: string; readonly id: string; readonly origin: Point; readonly width: number; readonly height: number; readonly label: DisplayText | null }
  | { readonly kind: 'line'; readonly item: string; readonly id: string; readonly from: Point; readonly to: Point }
  | { readonly kind: 'dimension'; readonly item: 'annotation'; readonly id: string; readonly from: Point; readonly to: Point; readonly text: DisplayText }
  | { readonly kind: 'text'; readonly item: 'annotation'; readonly id: string; readonly at: Point; readonly text: DisplayText };

export interface PreviewViewClientDTO {
  readonly view: 'plan' | 'elevation';
  readonly extent: { readonly width: number; readonly height: number };
  readonly items: readonly DisplayItemClientDTO[];
  readonly revision_hash: string;
  /** §9.3: every client-facing plan and elevation is watermarked. Always true here. */
  readonly watermarked: true;
}

/**
 * AC-07: a number on a screen is a claim. A dimension the model could not
 * establish (`AisleGeometry.clearWidth: Quantity | null`) has no value on the
 * wire — only `established: false` — and the screen prints VERIFY. Absence is
 * the encoding, in the contract and not only in the builder: the two
 * variants have disjoint key sets, so a value with `established: false`, or
 * `established: true` with no value, is refused by the schema itself.
 */
export type DimensionClientDTO =
  | { readonly value_um: number; readonly established: true }
  | { readonly established: false };

export interface PreviewClientDTO {
  readonly revision_id: string;
  readonly counts: { readonly gross_positions: number; readonly lost_positions: number; readonly net_positions: number };
  readonly dimensions: { readonly aisle_clear_width: DimensionClientDTO; readonly bay_pitch: DimensionClientDTO; readonly run_length: DimensionClientDTO };
  readonly assumptions: readonly AssumptionClientDTO[];
  readonly findings: readonly FindingClientDTO[];
  readonly views: readonly PreviewViewClientDTO[];
}

interface DisplayListEntity {
  view: 'plan' | 'elevation';
  extent: { width: number; height: number };
  items: readonly DisplayItemClientDTO[];
  revisionHash: string;
}

interface DimensionEntity {
  value_um: number | null;
  established: boolean;
}

interface PreviewEntity {
  revision_id: string;
  counts: { gross_positions: number; lost_positions: number; net_positions: number };
  dimensions: { aisle_clear_width: DimensionEntity; bay_pitch: DimensionEntity; run_length: DimensionEntity };
  assumptions: readonly AssumptionEntity[];
  findings: readonly FindingEntity[];
  views: readonly DisplayListEntity[];
  // The internal package derives in the same pass and must not cross.
  [extra: string]: unknown;
}

const point = object({ x: integer(), y: integer() });
const displayText = object({ text: string(), established: boolean() });
const ITEM_KINDS = ['upright', 'beam', 'aisle', 'obstruction', 'no-rack-zone', 'annotation'] as const;

const displayItem = oneOf([
  object({ kind: string({ enum: ['rect'] }), item: string({ enum: ITEM_KINDS }), id: string(), origin: point, width: integer(), height: integer(), label: nullable(displayText) }),
  object({ kind: string({ enum: ['line'] }), item: string({ enum: ITEM_KINDS }), id: string(), from: point, to: point }),
  object({ kind: string({ enum: ['dimension'] }), item: string({ enum: ['annotation'] }), id: string(), from: point, to: point, text: displayText }),
  object({ kind: string({ enum: ['text'] }), item: string({ enum: ['annotation'] }), id: string(), at: point, text: displayText }),
]);

const previewView: ObjectSchema = object({
  view: string({ enum: ['plan', 'elevation'] }),
  extent: object({ width: integer(), height: integer() }),
  items: array(displayItem),
  revision_hash: string(),
  // Pinned true: a client view that says it is not watermarked is refused. The
  // flag is a statement about the view, not the watermark itself — §9.3 is
  // enforced by the renderer (T-16/T-17), which must not be able to ignore it.
  watermarked: boolean({ enum: [true] }),
});

const dimension = oneOf([
  object({ value_um: integer(), established: boolean({ enum: [true] }) }),
  object({ established: boolean({ enum: [false] }) }),
]);

const Preview = clientResponse('Preview', {
  revision_id: string(),
  counts: object({ gross_positions: integer(), lost_positions: integer(), net_positions: integer() }),
  dimensions: object({ aisle_clear_width: dimension, bay_pitch: dimension, run_length: dimension }),
  assumptions: array(Assumption),
  findings: array(Finding),
  views: array(previewView),
});

function toDisplayItemClientDTO(item: DisplayItemClientDTO): DisplayItemClientDTO {
  // Field by field per variant. The union is closed in `@rms/display-list`;
  // it is re-stated here rather than spread so a new variant or a new field
  // on an old one is a change to THIS file, which is a review point.
  switch (item.kind) {
    case 'rect':
      return { kind: 'rect', item: item.item, id: item.id, origin: { x: item.origin.x, y: item.origin.y }, width: item.width, height: item.height, label: item.label === null ? null : { text: item.label.text, established: item.label.established } };
    case 'line':
      return { kind: 'line', item: item.item, id: item.id, from: { x: item.from.x, y: item.from.y }, to: { x: item.to.x, y: item.to.y } };
    case 'dimension':
      return { kind: 'dimension', item: 'annotation', id: item.id, from: { x: item.from.x, y: item.from.y }, to: { x: item.to.x, y: item.to.y }, text: { text: item.text.text, established: item.text.established } };
    case 'text':
      return { kind: 'text', item: 'annotation', id: item.id, at: { x: item.at.x, y: item.at.y }, text: { text: item.text.text, established: item.text.established } };
  }
}

function toDimensionClientDTO(d: DimensionEntity): DimensionClientDTO {
  // An established dimension with no value, or a value with no establishment,
  // is a contradiction the kernel cannot produce; refuse rather than guess.
  if ((d.value_um === null) === d.established) {
    throw new Error(`a dimension is established exactly when it has a value (got value_um=${String(d.value_um)}, established=${String(d.established)})`);
  }
  return d.value_um === null ? { established: false } : { value_um: d.value_um, established: true };
}

export function toPreviewClientDTO(entity: PreviewEntity): PreviewClientDTO {
  return {
    revision_id: entity.revision_id,
    counts: {
      gross_positions: entity.counts.gross_positions,
      lost_positions: entity.counts.lost_positions,
      net_positions: entity.counts.net_positions,
    },
    dimensions: {
      aisle_clear_width: toDimensionClientDTO(entity.dimensions.aisle_clear_width),
      bay_pitch: toDimensionClientDTO(entity.dimensions.bay_pitch),
      run_length: toDimensionClientDTO(entity.dimensions.run_length),
    },
    assumptions: entity.assumptions.map(toAssumptionClientDTO),
    findings: entity.findings.map(toFindingClientDTO),
    views: entity.views.map((v) => ({
      view: v.view,
      extent: { width: v.extent.width, height: v.extent.height },
      items: v.items.map(toDisplayItemClientDTO),
      revision_hash: v.revisionHash,
      watermarked: true,
    })),
  };
}

// --------------------------------------------------------------------------
// Submission — status and disposition (§8.2), in the client's three states (OD-12)
// --------------------------------------------------------------------------

/**
 * §3.4's request status, verbatim from `app.request_status` in 0001_init.sql.
 * Nine states. (The first draft of this module keyed on six invented by
 * `apps/client-web/src/lib/status.ts`; the review caught it — F-38.)
 */
export const REQUEST_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'TRIAGE',
  'NEEDS_INFO',
  'IN_PROGRESS',
  'QUOTED',
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED',
] as const);
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** OD-12's "received / in progress / complete only". */
export type ClientStatus = 'received' | 'in_progress' | 'complete';

export interface SubmissionClientDTO {
  readonly id: string;
  readonly revision_id: string;
  readonly status: ClientStatus;
  readonly submitted_at: string;
  readonly submission_hash: string;
}

interface SubmissionEntity {
  id: string;
  revision_id: string;
  request_status: string;
  submitted_at: string;
  submission_hash: string;
  organization_id?: string;
  [extra: string]: unknown;
}

const Submission = clientResponse('Submission', {
  id: string(),
  revision_id: string(),
  status: string({ enum: ['received', 'in_progress', 'complete'] }),
  submitted_at: string(),
  submission_hash: string(),
});

/**
 * OD-12: the client sees three states — "internal statuses like 'in triage'
 * invite questions the team should not have to field". The collapse is a
 * table over §3.4's nine, not a default branch: a status this table does not
 * know is refused rather than shown as "received". DRAFT is refused too — a
 * submission exists only once the request left DRAFT, so a DRAFT submission
 * is a contradiction in the row, not a state to display.
 */
const CLIENT_STATUS_FOR: Readonly<Partial<Record<RequestStatus, ClientStatus>>> = Object.freeze({
  SUBMITTED: 'received',
  TRIAGE: 'in_progress',
  NEEDS_INFO: 'in_progress',
  IN_PROGRESS: 'in_progress',
  QUOTED: 'complete',
  DECLINED: 'complete',
  WITHDRAWN: 'complete',
  EXPIRED: 'complete',
});

export function toSubmissionClientDTO(entity: SubmissionEntity): SubmissionClientDTO {
  const status = Object.hasOwn(CLIENT_STATUS_FOR, entity.request_status)
    ? CLIENT_STATUS_FOR[entity.request_status as RequestStatus]
    : undefined;
  if (status === undefined) {
    throw new Error(`request status '${entity.request_status}' has no client-facing state (OD-12 maps SUBMITTED…EXPIRED; DRAFT is not a submission)`);
  }
  return {
    id: entity.id,
    revision_id: entity.revision_id,
    status,
    submitted_at: entity.submitted_at,
    submission_hash: entity.submission_hash,
  };
}

// --------------------------------------------------------------------------
// Comparison — the option comparison table (§8.2 GET /revisions/:id/compare)
// --------------------------------------------------------------------------

/** The metrics a client may compare on. Mirrors `apps/client-web` COMPARABLE_METRICS; §9.2's Visible rows only. */
const COMPARABLE_METRICS = ['net_positions', 'aisle_clear_width_in', 'top_of_load_in', 'storage_levels'] as const;
export type ComparableMetric = (typeof COMPARABLE_METRICS)[number];

export interface ComparisonRowClientDTO {
  readonly metric: ComparableMetric;
  /** One cell per option, in option order. Null renders VERIFY, never a blank or a zero. */
  readonly values: readonly (number | null)[];
  readonly has_unestablished: boolean;
}

export interface ComparisonClientDTO {
  readonly revision_id: string;
  readonly options: readonly { readonly option_id: string; readonly label: string }[];
  readonly rows: readonly ComparisonRowClientDTO[];
}

interface ComparisonEntity {
  revision_id: string;
  options: readonly { optionId: string; label: string; [extra: string]: unknown }[];
  rows: readonly { metric: ComparableMetric; values: readonly (number | null)[]; hasUnestablished: boolean }[];
  [extra: string]: unknown;
}

const Comparison = clientResponse('Comparison', {
  revision_id: string(),
  options: array(object({ option_id: string(), label: string() })),
  rows: array(object({ metric: string({ enum: COMPARABLE_METRICS }), values: array(nullable(number())), has_unestablished: boolean() })),
});

export function toComparisonClientDTO(entity: ComparisonEntity): ComparisonClientDTO {
  return {
    revision_id: entity.revision_id,
    options: entity.options.map((o) => ({ option_id: o.optionId, label: o.label })),
    rows: entity.rows.map((r) => ({ metric: r.metric, values: [...r.values], has_unestablished: r.hasUnestablished })),
  };
}

// --------------------------------------------------------------------------
// Document — a signed, short-lived URL for a watermarked PDF (§8.2, FR-DC-03)
// --------------------------------------------------------------------------

export interface DocumentClientDTO {
  readonly id: string;
  readonly number: string;
  readonly revision_code: string;
  readonly status_code: string;
  readonly url: string;
  readonly expires_at: string;
}

interface DocumentEntity {
  id: string;
  number: string;
  revision_code: string;
  status_code: string;
  url: string;
  expires_at: string;
  storage_key?: string;
  organization_id?: string;
  [extra: string]: unknown;
}

const Document = clientResponse('Document', {
  id: string(),
  number: string(),
  revision_code: string(),
  status_code: string(),
  url: string(),
  expires_at: string(),
});

export function toDocumentClientDTO(entity: DocumentEntity): DocumentClientDTO {
  return {
    id: entity.id,
    number: entity.number,
    revision_code: entity.revision_code,
    status_code: entity.status_code,
    url: entity.url,
    expires_at: entity.expires_at,
  };
}

// --------------------------------------------------------------------------
// Invitation — what a client admin sees after inviting a colleague
// --------------------------------------------------------------------------

export interface InvitationClientDTO {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expires_at: string;
}

interface InvitationEntity {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  /** The plaintext token goes in the email link, once. It is never a response field. */
  token?: string;
  token_hash?: string;
  organization_id?: string;
  [extra: string]: unknown;
}

const Invitation = clientResponse('Invitation', {
  id: string(),
  email: string(),
  role: string(),
  expires_at: string(),
});

export function toInvitationClientDTO(entity: InvitationEntity): InvitationClientDTO {
  return {
    id: entity.id,
    email: entity.email,
    role: entity.role,
    expires_at: entity.expires_at,
  };
}

// --------------------------------------------------------------------------
// The registry — every client schema, keyed by name, for the guard and the document
// --------------------------------------------------------------------------

export const CLIENT_SCHEMAS = Object.freeze({
  Project,
  Revision,
  Assumption,
  Finding,
  Preview,
  Comparison,
  Submission,
  Document,
  Invitation,
} satisfies Readonly<Record<string, ResponseSchema>>);

// --------------------------------------------------------------------------
// Log redaction — same constant, different consumer
// --------------------------------------------------------------------------

/**
 * Redact forbidden fields from a value before it reaches an application log.
 * Returns a copy; never mutates. Uses the same constant as the DTOs and the
 * contract test, so a field added to one is covered by all three.
 */
export function redactForLog(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactForLog);

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isForbiddenClientField(key) ? '[REDACTED]' : redactForLog(child);
  }
  return out;
}
