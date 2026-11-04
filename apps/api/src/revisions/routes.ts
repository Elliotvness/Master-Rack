/**
 * Tasks **T-14c** & **T-14d** — Client reads, drafting, submit, clone,
 * submission status, and preliminary PDF document URLs, plus the two inherited
 * internal project and initial-revision creation routes (§8.2 amendment of
 * 2026-09-05).
 *
 * Every route mounted here has an entry in `ROUTES` (`authz/routes.ts`), runs
 * behind the `onRequest` gate in `app.ts`, validates its request body through
 * `@rms/contracts` (`clientRequestBody` / `internalRequestBody` + `parseBody`),
 * scopes every database operation through `withTenant`, and checks its outbound
 * response against `CLIENT_SCHEMAS` / `INTERNAL_SCHEMAS` before sending.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  CLIENT_SCHEMAS,
  INTAKE_DOCUMENT_KINDS,
  REQUEST_STATUSES,
  type ComparableMetric,
  type DisplayItemClientDTO,
  type FindingParameterEntity,
  type RequestStatus,
  toComparisonClientDTO,
  toDocumentClientDTO,
  toIntakeExtractionClientDTO,
  toPreviewClientDTO,
  toProjectClientDTO,
  toRevisionClientDTO,
  toSubmissionClientDTO,
} from '../dto/client.js';
import {
  INTERNAL_SCHEMAS,
  type QueueEntryInternalDTO,
  toBomLineInternalDTO,
  toCatalogReleaseInternalDTO,
  toInternalNoteDTO,
  toProjectInternalDTO,
  toQueueEntryInternalDTO,
  toRevisionInternalDTO,
  toSubmissionPackageInternalDTO,
} from '../dto/internal.js';
import {
  array,
  boolean,
  clientRequestBody,
  errorEnvelope,
  integer,
  internalRequestBody,
  notFound,
  nullable,
  object,
  offsetOf,
  outboundGuard,
  paginate,
  paginatedResponse,
  parseBody,
  parsePageRequest,
  statusFor,
  string,
} from '@rms/contracts';
import { withTenant, type TenantContext, type TenantTransaction } from '@rms/db';
import { deriveBom, type PartRef, type RunTakeoff } from '@rms/kernel-bom';
import {
  ApprovalGateError,
  approveRelease,
  type CatalogReleaseManifest,
  type DatasetVerificationPath,
  type HumanSpotCheck,
  type ReleaseStatus,
} from '@rms/kernel-catalog';
import { canonicalise, canonicaliseAll, cloneToDraft } from '@rms/kernel-model';
import {
  SubmitError,
  deriveInternalRevision,
  internalNote,
  stripInternalRevisions,
  type ClientFinding,
  type Derivation,
} from '@rms/workflow';

import { appendAuditEvent } from '../audit/chain.js';
import type { Action } from '../authz/authorize.js';
import type { DenyRecorder, Principal } from '../app.js';
import {
  claimIdempotencyKey,
  claimLeaseMs,
  errorCodeFor,
  settleIdempotencyKey,
} from '../idempotency/idempotency.js';
import {
  claimTopicBatch,
  markDispatched,
  markFailure,
  type OutboxStatus,
} from '../outbox/outbox.js';
import {
  preliminaryPdfKey,
  renderPreliminaryPdf,
  type PdfJobSample,
  type PreliminaryPdfBayRow,
} from '../outbox/pdf-job.js';
import { ENGINE_VERSION, submitRevision } from '../workflow/submit-effects.js';
import { InMemoryWormStore } from '../worm/memory-store.js';
import { RETENTION_DAYS_7_YEARS, prepareManifest, type WormStore } from '../worm/store.js';
import { extractSpecSheetViaGemini } from '../ai/gemini-adapter.js';
import type { GeminiInteractionsClient, IntakeDocumentKind } from '@rms/studio-model';

export interface RevisionRoutesOptions {
  readonly now: () => Date;
  readonly newId: () => string;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly recordDeny?: DenyRecorder | undefined;
  readonly wormStore?: WormStore | undefined;
  readonly geminiClient?: GeminiInteractionsClient | undefined;
}

// ---------------------------------------------------------------------------
// Request body schemas (T-13c)
// ---------------------------------------------------------------------------

const CREATE_PROJECT_BODY = internalRequestBody('CreateProjectRequest', {
  organization_id: string(),
  number: string(),
  name: string(),
});

const CREATE_REVISION_BODY = internalRequestBody(
  'CreateProjectRevisionRequest',
  {
    catalog_release_id: string(),
    rule_pack_release_id: string(),
    organization_id: string(),
  },
  { optional: ['organization_id'] },
);

const FACILITY_BODY = clientRequestBody(
  'FacilityDraftRequest',
  {
    name: nullable(string()),
    address: nullable(string()),
    width_um: nullable(integer()),
    depth_um: nullable(integer()),
    clear_height_um: nullable(integer()),
    column_grid: nullable(
      object({
        pitch_x_um: integer(),
        pitch_y_um: integer(),
      }),
    ),
    forklift: nullable(
      object(
        {
          model_stated: boolean(),
          required_aisle_um: nullable(integer()),
        },
        { optional: ['required_aisle_um'] },
      ),
    ),
    dock_count: nullable(integer()),
  },
  {
    optional: [
      'name',
      'address',
      'width_um',
      'depth_um',
      'clear_height_um',
      'column_grid',
      'forklift',
      'dock_count',
    ],
  },
);

const UNITS_BODY = clientRequestBody('UnitsDraftRequest', {
  units: array(
    object(
      {
        unit_id: string(),
        name: nullable(string()),
        width_um: nullable(integer()),
        depth_um: nullable(integer()),
        height_um: nullable(integer()),
        weight_lb: nullable(integer()),
        overhang_um: nullable(integer()),
        pallets_per_bay: nullable(integer()),
        target_levels: nullable(integer()),
        commodity_class: nullable(string()),
      },
      {
        optional: [
          'name',
          'width_um',
          'depth_um',
          'height_um',
          'weight_lb',
          'overhang_um',
          'pallets_per_bay',
          'target_levels',
          'commodity_class',
        ],
      },
    ),
  ),
});

const OPTIONS_BODY = clientRequestBody(
  'OptionsDraftRequest',
  {
    options: array(
      object({
        option_id: string(),
        label: string(),
        aisle_width_um: integer(),
        runs: array(
          object({
            run_id: string(),
            unit_id: string(),
            x_um: integer(),
            y_um: integer(),
            bays: array(
              object({
                bay_id: string(),
                length_um: integer(),
                levels: integer(),
              }),
            ),
          }),
        ),
      }),
    ),
    active_option_id: string(),
  },
  { optional: ['active_option_id'] },
);

const SUBMIT_BODY = clientRequestBody('SubmitRevisionRequest', {
  assumptions_acknowledged: boolean(),
  disclaimer_version_id: string(),
});

const CLONE_BODY = clientRequestBody(
  'CloneRevisionRequest',
  {
    reason: string(),
  },
  { optional: ['reason'] },
);

const INTAKE_EXTRACT_BODY = clientRequestBody('IntakeExtractRequest', {
  document_kind: string({ enum: INTAKE_DOCUMENT_KINDS }),
  file_name: string(),
  mime_type: string({
    enum: ['application/pdf', 'image/png', 'image/jpeg'],
  }),
  data_base64: string(),
});

const DERIVE_BODY = internalRequestBody(
  'DeriveInternalRevisionRequest',
  {
    reason: string(),
  },
  { optional: ['reason'] },
);

const CREATE_NOTE_BODY = internalRequestBody(
  'CreateInternalNoteRequest',
  {
    body: string(),
    submission_id: string(),
  },
  { optional: ['submission_id'] },
);

const APPROVE_CATALOG_BODY = internalRequestBody(
  'ApproveCatalogReleaseRequest',
  {
    reauthenticated: boolean(),
    approver: string(),
    verification_paths: array(
      object({
        dataset: string(),
        kind: string({ enum: ['full_cross_check', 'two_path_reconciliation'] }),
        cells: integer(),
        note: string(),
      }),
    ),
    human_spot_checks: array(
      object(
        {
          dataset: string(),
          cells: integer(),
          sampled_cells: array(string()),
          supplementary_cells: array(string()),
          seed: integer(),
          page: string(),
          checker: string(),
          result: string(),
        },
        { optional: ['supplementary_cells', 'checker'] },
      ),
    ),
    dataset_cells: array(
      object({
        dataset: string(),
        cell_ids: array(string()),
      }),
    ),
    datasets: array(string()),
    superseding_rev: nullable(string()),
    quarantine_reason: nullable(string()),
  },
  {
    optional: [
      'reauthenticated',
      'approver',
      'datasets',
      'superseding_rev',
      'quarantine_reason',
    ],
  },
);

type SubmittedStatus = Exclude<RequestStatus, 'DRAFT'>;
const SUBMITTED_STATUS_SET: ReadonlySet<string> = new Set(
  REQUEST_STATUSES.filter((s) => s !== 'DRAFT'),
);

/** Short-lived signed URL TTL for preliminary PDFs (15 minutes, §8.2 / FR-DC-03). */
export const DOCUMENT_URL_TTL_MS = 15 * 60 * 1000;
const DOCUMENT_SIGNING_SECRET = 'rms-prelim-document-signing-v1';

export function signDocumentUrl(params: {
  readonly submissionId: string;
  readonly manifestHash: string;
  readonly expiresAtMs: number;
}): string {
  const expiresSec = Math.floor(params.expiresAtMs / 1000);
  const sig = createHmac('sha256', DOCUMENT_SIGNING_SECRET)
    .update(`${params.submissionId}:${params.manifestHash}:${String(expiresSec)}`)
    .digest('hex');
  return (
    `https://documents.rackmaster.local/prelim/${params.submissionId}/` +
    `${params.manifestHash}.pdf?expires=${String(expiresSec)}&sig=${sig}`
  );
}

/**
 * Verify that a signed preliminary document URL has a valid HMAC signature and
 * has not expired relative to `now`.
 */
export function verifySignedDocumentUrl(url: string, now: Date): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const parts = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (parts.length !== 3 || parts[0] !== 'prelim') return false;
  const submissionId = parts[1]!;
  const filePart = parts[2]!;
  if (!filePart.endsWith('.pdf')) return false;
  const manifestHash = filePart.slice(0, -4);
  if (!/^[0-9a-f]{64}$/.test(manifestHash)) return false;

  const expiresRaw = parsed.searchParams.get('expires');
  const sig = parsed.searchParams.get('sig');
  if (expiresRaw === null || sig === null || !/^\d+$/.test(expiresRaw) || !/^[0-9a-f]{64}$/.test(sig)) {
    return false;
  }
  const expiresSec = Number(expiresRaw);
  const nowSec = Math.floor(now.getTime() / 1000);
  if (nowSec >= expiresSec) {
    return false;
  }

  const expectedSig = createHmac('sha256', DOCUMENT_SIGNING_SECRET)
    .update(`${submissionId}:${manifestHash}:${String(expiresSec)}`)
    .digest('hex');
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
}

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Paginated response schemas (AD-4 + T-13b)
// ---------------------------------------------------------------------------

const PROJECT_PAGE_SCHEMA = paginatedResponse('ProjectPage', CLIENT_SCHEMAS.Project);
const REVISION_PAGE_SCHEMA = paginatedResponse('RevisionPage', CLIENT_SCHEMAS.Revision);
const QUEUE_PAGE_SCHEMA = paginatedResponse('QueuePage', INTERNAL_SCHEMAS.QueueEntry);
const BOM_PAGE_SCHEMA = paginatedResponse('BomLinePage', INTERNAL_SCHEMAS.BomLine);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function tenantOf(principal: Principal): TenantContext {
  return {
    organizationId: principal.organizationId,
    actorType: principal.actorType,
  };
}

// ---------------------------------------------------------------------------
// Draft content types & pure derivation for preview and comparison
// ---------------------------------------------------------------------------

export interface FacilityDraft {
  readonly name?: string | null;
  readonly address?: string | null;
  readonly width_um?: number | null;
  readonly depth_um?: number | null;
  readonly clear_height_um?: number | null;
  readonly column_grid?: {
    readonly pitch_x_um: number;
    readonly pitch_y_um: number;
  } | null;
  readonly forklift?: {
    readonly model_stated: boolean;
    readonly required_aisle_um?: number | null;
  } | null;
  readonly dock_count?: number | null;
}

export interface UnitDraft {
  readonly unit_id: string;
  readonly name?: string | null;
  readonly width_um?: number | null;
  readonly depth_um?: number | null;
  readonly height_um?: number | null;
  readonly weight_lb?: number | null;
  readonly overhang_um?: number | null;
  readonly pallets_per_bay?: number | null;
  readonly target_levels?: number | null;
  readonly commodity_class?: string | null;
}

export interface BayDraft {
  readonly bay_id: string;
  readonly length_um: number;
  readonly levels: number;
}

export interface RunDraft {
  readonly run_id: string;
  readonly unit_id: string;
  readonly x_um: number;
  readonly y_um: number;
  readonly bays: readonly BayDraft[];
}

export interface OptionDraft {
  readonly option_id: string;
  readonly label: string;
  readonly aisle_width_um: number;
  readonly runs: readonly RunDraft[];
}

export interface RevisionDraftContent {
  readonly schema_version?: number;
  readonly facility?: FacilityDraft;
  readonly units?: readonly UnitDraft[];
  readonly options?: readonly OptionDraft[];
  readonly active_option_id?: string;
}

type DerivedAssumptionRow = {
  readonly key: string;
  readonly assumedValue: { readonly value: number; readonly unit: string };
  readonly why: string;
  readonly scope: string;
  readonly acknowledgedBy?: string | undefined;
  readonly acknowledgedAt?: string | undefined;
};

type DerivedFindingRow = {
  readonly code: string;
  readonly severity: ClientFinding['severity'] | 'REVIEW';
  readonly subject_object_ids: readonly string[];
  readonly parameters: readonly FindingParameterEntity[];
  readonly closed_by: string;
};

interface OptionDerivation {
  readonly option: OptionDraft;
  readonly counts: {
    readonly gross_positions: number;
    readonly lost_positions: number;
    readonly net_positions: number;
  };
  readonly dimensions: {
    readonly aisle_clear_width: { readonly value_um: number | null; readonly established: boolean };
    readonly bay_pitch: { readonly value_um: number | null; readonly established: boolean };
    readonly run_length: { readonly value_um: number | null; readonly established: boolean };
  };
  readonly findings: readonly DerivedFindingRow[];
  readonly assumptions: readonly DerivedAssumptionRow[];
  readonly topOfLoadIn: number | null;
  readonly storageLevels: number;
}

const DEFAULT_AISLE_CLEARANCE_UM = 3_048_000; // 120 in planning default
const DEFAULT_OVERHANG_UM = 50_800; // 2 in planning default
const DEFAULT_UNIT_WIDTH_UM = 1_219_200; // 48 in pallet width
const UPRIGHT_WIDTH_UM = 76_200; // 3 in upright frame width
const BEAM_HEIGHT_UM = 101_600; // 4 in beam face height
const UM_PER_INCH = 25_400;

function readDraftContent(raw: unknown): RevisionDraftContent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { schema_version: 1 };
  }
  const rec = raw as Record<string, unknown>;
  return {
    schema_version: 1,
    ...(rec['facility'] !== undefined ? { facility: rec['facility'] as FacilityDraft } : {}),
    ...(Array.isArray(rec['units']) ? { units: rec['units'] as readonly UnitDraft[] } : {}),
    ...(Array.isArray(rec['options']) ? { options: rec['options'] as readonly OptionDraft[] } : {}),
    ...(typeof rec['active_option_id'] === 'string'
      ? { active_option_id: rec['active_option_id'] }
      : {}),
  };
}

function computeDraftHash(content: RevisionDraftContent, frozenHash: string | null): string {
  if (frozenHash !== null && frozenHash !== '') return frozenHash;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function collectDraftAssumptions(
  content: RevisionDraftContent,
  existingAcknowledgements: ReadonlyMap<
    string,
    { readonly acknowledgedBy: string | null; readonly acknowledgedAt: string | null }
  >,
): readonly DerivedAssumptionRow[] {
  const out: DerivedAssumptionRow[] = [];
  const seen = new Set<string>();

  const pushAssumption = (
    key: string,
    value: number,
    unit: string,
    why: string,
    scope: string,
  ): void => {
    const mapKey = `${key}::${scope}`;
    if (seen.has(mapKey)) return;
    seen.add(mapKey);
    const ack = existingAcknowledgements.get(mapKey);
    out.push({
      key,
      assumedValue: { value, unit },
      why,
      scope,
      acknowledgedBy: ack?.acknowledgedBy ?? undefined,
      acknowledgedAt: ack?.acknowledgedAt ?? undefined,
    });
  };

  if (content.facility?.forklift && !content.facility.forklift.model_stated) {
    pushAssumption(
      'forklift.aisle_clearance',
      DEFAULT_AISLE_CLEARANCE_UM,
      'um',
      'No forklift model was stated; 120 in planning aisle clearance assumed.',
      'facility',
    );
  }

  for (const unit of content.units ?? []) {
    if (unit.overhang_um === undefined || unit.overhang_um === null) {
      pushAssumption(
        'pallet.overhang.front',
        DEFAULT_OVERHANG_UM,
        'um',
        'No pallet overhang was supplied; the planning default was used.',
        `unit ${unit.unit_id}`,
      );
    }
  }

  return out;
}

function deriveOption(
  content: RevisionDraftContent,
  option: OptionDraft,
  assumptions: readonly DerivedAssumptionRow[],
): OptionDerivation {
  const unitsById = new Map<string, UnitDraft>();
  for (const u of content.units ?? []) unitsById.set(u.unit_id, u);

  let grossPositions = 0;
  let offGridBayLosses = 0;
  let maxLevels = 0;
  let maxTopOfLoadUm = 0;
  const offGridRunIds: string[] = [];

  const grid = content.facility?.column_grid ?? null;

  for (const run of option.runs) {
    const unit = unitsById.get(run.unit_id);
    const unitWidth = unit?.width_um ?? DEFAULT_UNIT_WIDTH_UM;
    const unitHeight = unit?.height_um ?? 1_219_200;
    const isOffGrid =
      grid !== null &&
      (run.x_um % grid.pitch_x_um !== 0 || run.y_um % grid.pitch_y_um !== 0);
    if (isOffGrid) offGridRunIds.push(run.run_id);

    for (const bay of run.bays) {
      if (bay.levels > maxLevels) maxLevels = bay.levels;
      const topUm = bay.levels * (unitHeight + BEAM_HEIGHT_UM);
      if (topUm > maxTopOfLoadUm) maxTopOfLoadUm = topUm;
      const positionsPerLevel = Math.max(1, Math.floor(bay.length_um / unitWidth));
      grossPositions += positionsPerLevel * bay.levels;
      if (isOffGrid) offGridBayLosses += 1;
    }
  }

  const dockLosses = content.facility?.dock_count ?? 0;
  const lostPositions = Math.min(grossPositions, offGridBayLosses + dockLosses);
  const netPositions = Math.max(0, grossPositions - lostPositions);

  const firstRun = option.runs[0];
  const firstBay = firstRun?.bays[0];
  const firstRunLengthUm =
    firstRun !== undefined
      ? firstRun.bays.reduce((sum, b) => sum + b.length_um, 0)
      : null;

  const findings: DerivedFindingRow[] = [];

  const forkliftStated =
    content.facility?.forklift?.model_stated === true &&
    typeof content.facility.forklift.required_aisle_um === 'number';
  const requiredAisleUm = forkliftStated
    ? (content.facility!.forklift!.required_aisle_um as number)
    : DEFAULT_AISLE_CLEARANCE_UM;

  if (option.aisle_width_um < requiredAisleUm) {
    findings.push({
      code: 'AISLE_CLEAR_SHORTFALL',
      severity: 'BLOCKER',
      subject_object_ids: [option.option_id],
      parameters: [
        {
          name: 'aisle clear width',
          established: true,
          value: { value: option.aisle_width_um, unit: 'um' },
        },
        forkliftStated
          ? {
              name: 'equipment requirement',
              established: true,
              value: { value: requiredAisleUm, unit: 'um' },
            }
          : {
              name: 'equipment requirement',
              established: false,
              value: null,
              reason: 'no forklift model was stated',
            },
      ],
      closed_by: 'Widen the aisle to meet the stated equipment clearance.',
    });
  } else {
    findings.push({
      code: 'AISLE_CLEAR_OK',
      severity: 'PASS',
      subject_object_ids: [option.option_id],
      parameters: [
        {
          name: 'aisle clear width',
          established: true,
          value: { value: option.aisle_width_um, unit: 'um' },
        },
      ],
      closed_by: 'Aisle clear width meets the equipment requirement.',
    });
  }

  if (
    content.facility !== undefined &&
    typeof content.facility.clear_height_um === 'number' &&
    maxTopOfLoadUm > content.facility.clear_height_um
  ) {
    findings.push({
      code: 'CLEAR_HEIGHT_EXCEEDED',
      severity: 'BLOCKER',
      subject_object_ids: [option.option_id],
      parameters: [
        {
          name: 'top of load',
          established: true,
          value: { value: maxTopOfLoadUm, unit: 'um' },
        },
        {
          name: 'building clear height',
          established: true,
          value: { value: content.facility.clear_height_um, unit: 'um' },
        },
      ],
      closed_by: 'Reduce the number of storage levels or unit height to fit beneath the clear height.',
    });
  }

  if (offGridRunIds.length > 0 && grid !== null) {
    findings.push({
      code: 'COLUMN_IN_AISLE',
      severity: 'REVIEW',
      subject_object_ids: offGridRunIds,
      parameters: [
        {
          name: 'column grid pitch x',
          established: true,
          value: { value: grid.pitch_x_um, unit: 'um' },
        },
      ],
      closed_by: 'Align rack runs with the building column grid or confirm lost pallet positions.',
    });
  }

  if (content.facility?.forklift && !content.facility.forklift.model_stated) {
    findings.push({
      code: 'FORKLIFT_CLEARANCE_ASSUMED',
      severity: 'ASSUMPTION',
      subject_object_ids: [option.option_id],
      parameters: [
        {
          name: 'equipment requirement',
          established: false,
          value: null,
          reason: 'no forklift model was stated',
        },
      ],
      closed_by: 'State the forklift model and required aisle clearance, or acknowledge the assumption.',
    });
  }

  for (const unit of content.units ?? []) {
    if (unit.overhang_um === undefined || unit.overhang_um === null) {
      findings.push({
        code: 'OVERHANG_ASSUMED',
        severity: 'ASSUMPTION',
        subject_object_ids: [unit.unit_id],
        parameters: [
          {
            name: 'assumed overhang',
            established: true,
            value: { value: DEFAULT_OVERHANG_UM, unit: 'um' },
          },
        ],
        closed_by: 'State the pallet overhang or acknowledge the planning assumption.',
      });
    }
  }

  return {
    option,
    counts: {
      gross_positions: grossPositions,
      lost_positions: lostPositions,
      net_positions: netPositions,
    },
    dimensions: {
      aisle_clear_width: { value_um: option.aisle_width_um, established: true },
      bay_pitch:
        firstBay !== undefined
          ? { value_um: firstBay.length_um, established: true }
          : { value_um: null, established: false },
      run_length:
        firstRunLengthUm !== null && firstRunLengthUm > 0
          ? { value_um: firstRunLengthUm, established: true }
          : { value_um: null, established: false },
    },
    findings,
    assumptions,
    topOfLoadIn: maxTopOfLoadUm > 0 ? Math.round(maxTopOfLoadUm / UM_PER_INCH) : null,
    storageLevels: maxLevels,
  };
}

function buildPlanViewItems(
  content: RevisionDraftContent,
  activeOption: OptionDraft | undefined,
): readonly DisplayItemClientDTO[] {
  const items: DisplayItemClientDTO[] = [];
  if (activeOption === undefined) return items;

  const unitsById = new Map<string, UnitDraft>();
  for (const u of content.units ?? []) unitsById.set(u.unit_id, u);

  for (const run of activeOption.runs) {
    const unit = unitsById.get(run.unit_id);
    const runDepthUm = unit?.depth_um ?? 1_066_800;
    let cursorX = run.x_um;

    items.push({
      kind: 'text',
      item: 'annotation',
      id: `label-${run.run_id}`,
      at: { x: run.x_um, y: run.y_um },
      text: { text: `Run ${run.run_id}`, established: true },
    });

    items.push({
      kind: 'rect',
      item: 'upright',
      id: `upright-${run.run_id}-0`,
      origin: { x: cursorX, y: run.y_um },
      width: UPRIGHT_WIDTH_UM,
      height: runDepthUm,
      label: null,
    });

    for (const [idx, bay] of run.bays.entries()) {
      const beamInches = Math.round(bay.length_um / UM_PER_INCH);
      items.push({
        kind: 'rect',
        item: 'beam',
        id: `beam-${run.run_id}-${bay.bay_id}`,
        origin: { x: cursorX + UPRIGHT_WIDTH_UM, y: run.y_um },
        width: bay.length_um,
        height: BEAM_HEIGHT_UM,
        label: { text: `${String(beamInches)} in`, established: true },
      });
      cursorX += UPRIGHT_WIDTH_UM + bay.length_um;
      items.push({
        kind: 'rect',
        item: 'upright',
        id: `upright-${run.run_id}-${String(idx + 1)}`,
        origin: { x: cursorX, y: run.y_um },
        width: UPRIGHT_WIDTH_UM,
        height: runDepthUm,
        label: null,
      });
    }

    const aisleY = run.y_um + runDepthUm + activeOption.aisle_width_um;
    items.push({
      kind: 'line',
      item: 'aisle',
      id: `aisle-${run.run_id}`,
      from: { x: run.x_um, y: aisleY },
      to: { x: cursorX, y: aisleY },
    });

    const aisleInches = Math.round(activeOption.aisle_width_um / UM_PER_INCH);
    items.push({
      kind: 'dimension',
      item: 'annotation',
      id: `dim-aisle-${run.run_id}`,
      from: { x: run.x_um, y: run.y_um + runDepthUm },
      to: { x: run.x_um, y: aisleY },
      text: { text: `${String(aisleInches)} in`, established: true },
    });
  }

  return items;
}

function buildElevationViewItems(
  content: RevisionDraftContent,
  activeOption: OptionDraft | undefined,
): readonly DisplayItemClientDTO[] {
  const items: DisplayItemClientDTO[] = [];
  const firstRun = activeOption?.runs[0];
  const firstBay = firstRun?.bays[0];
  if (firstRun === undefined || firstBay === undefined) return items;

  const unitsById = new Map<string, UnitDraft>();
  for (const u of content.units ?? []) unitsById.set(u.unit_id, u);
  const unit = unitsById.get(firstRun.unit_id);
  const unitWidthUm = unit?.width_um ?? DEFAULT_UNIT_WIDTH_UM;
  const unitHeightUm = unit?.height_um ?? 1_219_200;
  const clearHeightUm = content.facility?.clear_height_um ?? 9_144_000;

  items.push(
    {
      kind: 'rect',
      item: 'upright',
      id: `elev-upright-${firstBay.bay_id}-L`,
      origin: { x: 0, y: 0 },
      width: UPRIGHT_WIDTH_UM,
      height: clearHeightUm,
      label: null,
    },
    {
      kind: 'rect',
      item: 'upright',
      id: `elev-upright-${firstBay.bay_id}-R`,
      origin: { x: UPRIGHT_WIDTH_UM + firstBay.length_um, y: 0 },
      width: UPRIGHT_WIDTH_UM,
      height: clearHeightUm,
      label: null,
    },
    {
      kind: 'line',
      item: 'reference',
      id: `elev-clear-height-${firstBay.bay_id}`,
      from: { x: 0, y: clearHeightUm },
      to: { x: UPRIGHT_WIDTH_UM * 2 + firstBay.length_um, y: clearHeightUm },
    },
  );

  for (let level = 1; level <= firstBay.levels; level += 1) {
    const beamY = level * (unitHeightUm + BEAM_HEIGHT_UM);
    items.push(
      {
        kind: 'rect',
        item: 'beam',
        id: `elev-beam-${firstBay.bay_id}-L${String(level)}`,
        origin: { x: UPRIGHT_WIDTH_UM, y: beamY - BEAM_HEIGHT_UM },
        width: firstBay.length_um,
        height: BEAM_HEIGHT_UM,
        label: { text: `Level ${String(level)}`, established: true },
      },
      {
        kind: 'rect',
        item: 'unit-load',
        id: `elev-load-${firstBay.bay_id}-L${String(level)}`,
        origin: { x: UPRIGHT_WIDTH_UM, y: beamY },
        width: unitWidthUm,
        height: unitHeightUm,
        label: { text: `${String(Math.round(unitWidthUm / UM_PER_INCH))} in`, established: true },
      },
    );
  }

  return items;
}

async function syncDerivedTablesOnDraft(
  tx: TenantTransaction,
  organizationId: string,
  revisionId: string,
  content: RevisionDraftContent,
  newId: () => string,
): Promise<void> {
  const existingAckRows = await tx.query<{
    key: string;
    scope: string;
    acknowledged_by: string | null;
    acknowledged_at: Date | string | null;
  }>(
    `SELECT key, scope, acknowledged_by, acknowledged_at
       FROM app.assumption
      WHERE organization_id = $1
        AND revision_id = $2
        AND audience = 'client'`,
    [organizationId, revisionId],
  );
  const ackMap = new Map<
    string,
    { readonly acknowledgedBy: string | null; readonly acknowledgedAt: string | null }
  >();
  for (const r of existingAckRows.rows) {
    ackMap.set(`${r.key}::${r.scope}`, {
      acknowledgedBy: r.acknowledged_by,
      acknowledgedAt:
        r.acknowledged_at instanceof Date ? r.acknowledged_at.toISOString() : r.acknowledged_at,
    });
  }

  const assumptions = collectDraftAssumptions(content, ackMap);
  const activeOption =
    content.options?.find((o) => o.option_id === content.active_option_id) ??
    content.options?.[0];

  const derivedFindings: readonly DerivedFindingRow[] =
    activeOption !== undefined
      ? deriveOption(content, activeOption, assumptions).findings
      : [];

  const draftHash = computeDraftHash(content, null);

  await tx.query(
    `DELETE FROM app.finding
      WHERE organization_id = $1
        AND revision_id = $2
        AND audience = 'client'`,
    [organizationId, revisionId],
  );

  for (const f of derivedFindings) {
    const dbSeverity = f.severity === 'REVIEW' ? 'ENGINEERING_REVIEW_REQUIRED' : f.severity;
    await tx.query(
      `INSERT INTO app.finding
         (id, organization_id, revision_id, audience, code, severity,
          subject_object_ids, closed_by, revision_hash, engine_version)
       VALUES ($1, $2, $3, 'client', $4, $5::app.finding_severity, $6, $7, $8, $9)`,
      [
        newId(),
        organizationId,
        revisionId,
        f.code,
        dbSeverity,
        [...f.subject_object_ids],
        f.closed_by,
        draftHash,
        ENGINE_VERSION,
      ],
    );
  }

  // Remove unacknowledged assumptions so they can be freshly written.
  await tx.query(
    `DELETE FROM app.assumption
      WHERE organization_id = $1
        AND revision_id = $2
        AND audience = 'client'
        AND acknowledged_by IS NULL`,
    [organizationId, revisionId],
  );

  for (const a of assumptions) {
    const existingAck = ackMap.get(`${a.key}::${a.scope}`);
    if (existingAck?.acknowledgedBy !== null && existingAck?.acknowledgedBy !== undefined) continue;
    await tx.query(
      `INSERT INTO app.assumption
         (id, organization_id, revision_id, audience, key, assumed_value_um,
          assumed_unit, why, scope)
       VALUES ($1, $2, $3, 'client', $4, $5, $6, $7, $8)`,
      [
        newId(),
        organizationId,
        revisionId,
        a.key,
        a.assumedValue.value,
        a.assumedValue.unit,
        a.why,
        a.scope,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Outbox PDF Generation Job Worker (P-03)
// ---------------------------------------------------------------------------

export interface ProcessPdfOutboxOptions {
  readonly organizationId: string;
  readonly now: () => Date;
  readonly wormStore: WormStore;
  readonly metrics?: PdfJobSample[];
  readonly limit?: number;
  readonly injectFaultForManifest?: ReadonlySet<string>;
}

export interface PdfOutboxJobFailure {
  readonly jobId: string;
  readonly manifestHash: string;
  readonly status: OutboxStatus;
  readonly error: string;
}

export interface PdfOutboxBatchResult {
  readonly claimed: number;
  readonly completed: readonly PdfJobSample[];
  readonly failed: readonly PdfOutboxJobFailure[];
}

/**
 * Drain up to `limit` pending `'pdf.generate'` outbox jobs for `organizationId`,
 * render each frozen submission's multi-page preliminary PDF summary, persist
 * the PDF into `wormStore` under `preliminaryPdfKey(submissionId, manifestHash)`,
 * record per-job `durationMs` into `metrics`, and mark each job `'dispatched'`
 * or failed via `markFailure`.
 */
export async function processPdfOutboxBatch(
  opts: ProcessPdfOutboxOptions,
): Promise<PdfOutboxBatchResult> {
  const completed: PdfJobSample[] = [];
  const failed: PdfOutboxJobFailure[] = [];

  return withTenant(
    { organizationId: opts.organizationId, actorType: 'client' },
    async (tx) => {
      const messages = await claimTopicBatch(
        tx,
        'pdf.generate',
        opts.now(),
        opts.limit ?? 20,
      );

      for (const msg of messages) {
        const t0 = performance.now();
        const manifestHash =
          typeof msg.payload['reference'] === 'string' ? msg.payload['reference'] : '';

        if (
          manifestHash.length === 0 ||
          opts.injectFaultForManifest?.has(manifestHash) === true
        ) {
          const errMsg =
            manifestHash.length === 0
              ? 'missing manifest reference in pdf.generate payload'
              : 'injected PDF generation failure';
          const status = await markFailure(tx, msg, errMsg, opts.now());
          failed.push({ jobId: msg.id, manifestHash, status, error: errMsg });
          continue;
        }

        const subRes = await tx.query<{
          submission_id: string;
          manifest_hash: string;
          submission_hash: string;
          submitted_at: Date | string;
          revision_id: string;
          revision_code: string;
          content_hash: string | null;
          content: unknown;
          project_number: string;
          project_name: string;
        }>(
          `SELECT s.id AS submission_id,
                  s.manifest_hash,
                  s.this_hash AS submission_hash,
                  s.submitted_at,
                  r.id AS revision_id,
                  r.revision_code,
                  r.content_hash,
                  r.content,
                  p.number AS project_number,
                  p.name AS project_name
             FROM app.submission s
             JOIN app.revision r
               ON r.id = s.revision_id
              AND r.organization_id = s.organization_id
             JOIN app.project p
               ON p.id = r.project_id
              AND p.organization_id = s.organization_id
            WHERE s.organization_id = $1
              AND s.manifest_hash = $2
              AND s.audience = 'client'
              AND r.audience = 'client'
            ORDER BY s.submitted_at DESC
            LIMIT 1`,
          [opts.organizationId, manifestHash],
        );
        const sub = subRes.rows[0];
        if (sub === undefined) {
          const errMsg = 'submission not found for manifest reference';
          const status = await markFailure(tx, msg, errMsg, opts.now());
          failed.push({ jobId: msg.id, manifestHash, status, error: errMsg });
          continue;
        }

        const findingsRes = await tx.query<{
          code: string;
          severity: string;
          closed_by: string;
        }>(
          `SELECT code,
                  severity::text AS severity,
                  closed_by
             FROM app.finding
            WHERE organization_id = $1
              AND revision_id = $2
              AND audience = 'client'
            ORDER BY code ASC, id ASC`,
          [opts.organizationId, sub.revision_id],
        );

        const assumptionsRes = await tx.query<{
          key: string;
          why: string;
          acknowledged_by: string | null;
        }>(
          `SELECT key,
                  why,
                  acknowledged_by
             FROM app.assumption
            WHERE organization_id = $1
              AND revision_id = $2
              AND audience = 'client'
            ORDER BY key ASC, scope ASC`,
          [opts.organizationId, sub.revision_id],
        );

        const draftContent = readDraftContent(sub.content);
        const activeOption =
          draftContent.options?.find((o) => o.option_id === draftContent.active_option_id) ??
          draftContent.options?.[0];

        const bays: PreliminaryPdfBayRow[] = [];
        let bayIndex = 1;
        for (const run of activeOption?.runs ?? []) {
          for (const bay of run.bays) {
            bays.push({
              bayIndex,
              runId: run.run_id,
              bayId: bay.bay_id,
              xUm: run.x_um,
              yUm: run.y_um,
              lengthUm: bay.length_um,
              levels: bay.levels,
            });
            bayIndex += 1;
          }
        }

        const pdf = renderPreliminaryPdf({
          submissionId: sub.submission_id,
          manifestHash: sub.manifest_hash,
          submissionHash: sub.submission_hash,
          submittedAt:
            sub.submitted_at instanceof Date
              ? sub.submitted_at.toISOString()
              : String(sub.submitted_at),
          projectNumber: sub.project_number,
          projectName: sub.project_name,
          revisionCode: sub.revision_code,
          contentHash: sub.content_hash ?? '',
          optionLabel: activeOption?.label ?? 'Default Option',
          aisleWidthUm: activeOption?.aisle_width_um ?? 0,
          facilityWidthUm: draftContent.facility?.width_um ?? 0,
          facilityDepthUm: draftContent.facility?.depth_um ?? 0,
          clearHeightUm: draftContent.facility?.clear_height_um ?? 0,
          bays,
          findings: findingsRes.rows,
          assumptions: assumptionsRes.rows.map((a) => ({
            code: a.key,
            statement: a.why,
            acknowledged: a.acknowledged_by !== null,
          })),
        });

        const retainUntil = new Date(
          opts.now().getTime() + RETENTION_DAYS_7_YEARS * 86_400_000,
        ).toISOString();
        await opts.wormStore.put({
          key: preliminaryPdfKey(sub.submission_id, sub.manifest_hash),
          body: pdf.text,
          sha256: pdf.sha256,
          mode: 'COMPLIANCE',
          retainUntil,
        });

        const finishedAt = opts.now();
        await markDispatched(tx, msg.id, finishedAt);
        const durationMs = performance.now() - t0;

        const sample: PdfJobSample = {
          jobId: msg.id,
          submissionId: sub.submission_id,
          manifestHash: sub.manifest_hash,
          durationMs,
          pageCount: pdf.pageCount,
          bayCount: pdf.bayCount,
          recordedAt: finishedAt.toISOString(),
        };
        completed.push(sample);
        opts.metrics?.push(sample);
      }

      return {
        claimed: messages.length,
        completed,
        failed,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerRevisionRoutes(
  app: FastifyInstance,
  opts: RevisionRoutesOptions,
): void {
  const guard = outboundGuard({ mode: 'fail', alert: () => {} });
  const nowIso = (): string => opts.now().toISOString();

  async function recordObjectDeny(
    actor: Principal,
    action: Action,
    resourceId: string | null,
    reason: string,
  ): Promise<void> {
    if (opts.recordDeny === undefined) return;
    await opts.recordDeny({
      actor,
      action,
      resourceId,
      reason,
      occurredAt: nowIso(),
      eventId: opts.newId(),
    });
  }

  // -------------------------------------------------------------------------
  // 1. POST /api/internal/v1/projects
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/projects', async (request, reply) => {
    const principal = request.principal!;
    const parsed = parseBody(CREATE_PROJECT_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const organizationId = (parsed.body['organization_id'] as string).trim();
    const projectNumber = (parsed.body['number'] as string).trim();
    const projectName = (parsed.body['name'] as string).trim();

    if (!isUuid(organizationId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'organization_id must be a UUID'));
    }
    if (projectNumber.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'project number must not be empty'));
    }
    if (projectName.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'project name must not be empty'));
    }

    const at = nowIso();
    const outcome = await withTenant(
      { organizationId, actorType: 'staff' },
      async (tx) => {
        const orgRes = await tx.query<{ id: string; is_internal: boolean }>(
          `SELECT id, is_internal FROM app.organization WHERE id = $1`,
          [organizationId],
        );
        const org = orgRes.rows[0];
        if (org === undefined) {
          return { kind: 'org_missing' as const };
        }
        if (org.is_internal) {
          return { kind: 'internal_org' as const };
        }

        const dupRes = await tx.query<{ id: string }>(
          `SELECT id FROM app.project WHERE organization_id = $1 AND number = $2`,
          [organizationId, projectNumber],
        );
        if ((dupRes.rowCount ?? 0) > 0) {
          return { kind: 'duplicate_number' as const };
        }

        const projectId = opts.newId();
        const created = await tx.query<{
          id: string;
          organization_id: string;
          number: string;
          name: string;
          status: 'active' | 'archived';
          created_at: Date;
        }>(
          `INSERT INTO app.project (id, organization_id, number, name, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING id, organization_id, number, name, status, created_at`,
          [projectId, organizationId, projectNumber, projectName],
        );
        const row = created.rows[0]!;

        await appendAuditEvent(tx, {
          eventId: opts.newId(),
          recordedAt: at,
          content: {
            occurredAt: at,
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: organizationId,
            action: 'project.create',
            resourceType: 'project',
            resourceId: row.id,
            outcome: 'success',
            reasons: [`number:${projectNumber}`],
          },
        });

        const dto = toProjectInternalDTO({
          id: row.id,
          organization_id: row.organization_id,
          number: row.number,
          name: row.name,
          status: row.status,
          created_at:
            row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        });
        return { kind: 'created' as const, dto };
      },
    );

    if (outcome.kind === 'org_missing') {
      await recordObjectDeny(
        principal,
        'project.create',
        organizationId,
        'target organization does not exist',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'internal_org') {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(errorEnvelope('UNPROCESSABLE', 'projects belong to client organizations'));
    }
    if (outcome.kind === 'duplicate_number') {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(errorEnvelope('UNPROCESSABLE', 'project number already exists in this organization'));
    }

    const checked = guard.check(INTERNAL_SCHEMAS.Project, outcome.dto);
    return reply.code(201).send(checked);
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/internal/v1/projects/:id/revisions
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/projects/:id/revisions', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const projectId = (params.id ?? '').trim();
    if (!isUuid(projectId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'project id must be a UUID'));
    }

    const parsed = parseBody(CREATE_REVISION_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const catalogReleaseId = (parsed.body['catalog_release_id'] as string).trim();
    const rulePackReleaseId = (parsed.body['rule_pack_release_id'] as string).trim();
    const requestedOrgId =
      typeof parsed.body['organization_id'] === 'string'
        ? parsed.body['organization_id'].trim()
        : undefined;

    if (!isUuid(catalogReleaseId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'catalog_release_id must be a UUID'));
    }
    if (!isUuid(rulePackReleaseId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'rule_pack_release_id must be a UUID'));
    }
    if (requestedOrgId !== undefined && !isUuid(requestedOrgId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'organization_id must be a UUID'));
    }

    const at = nowIso();
    const outcome = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      async (tx) => {
        const projRes = await tx.query<{ id: string; organization_id: string }>(
          `SELECT id, organization_id FROM app.project WHERE id = $1`,
          [projectId],
        );
        const project = projRes.rows[0];
        if (
          project === undefined ||
          (requestedOrgId !== undefined && project.organization_id !== requestedOrgId)
        ) {
          return { kind: 'project_not_found' as const };
        }

        const catRes = await tx.query<{ id: string; status: string }>(
          `SELECT id, status FROM app.catalog_release WHERE id = $1`,
          [catalogReleaseId],
        );
        if (catRes.rows[0]?.status !== 'APPROVED') {
          return {
            kind: 'unprocessable' as const,
            message: 'catalog_release_id must reference an APPROVED catalog release',
          };
        }

        const ruleRes = await tx.query<{ id: string; status: string }>(
          `SELECT id, status FROM app.rule_pack_release WHERE id = $1`,
          [rulePackReleaseId],
        );
        if (ruleRes.rows[0]?.status !== 'APPROVED') {
          return {
            kind: 'unprocessable' as const,
            message: 'rule_pack_release_id must reference an APPROVED rule pack release',
          };
        }

        const existingRes = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM app.revision
            WHERE organization_id = $1
              AND project_id = $2
              AND audience = 'client'`,
          [project.organization_id, project.id],
        );
        if ((existingRes.rows[0]?.n ?? 0) > 0) {
          return {
            kind: 'unprocessable' as const,
            message: 'project already has an initial revision; clone an existing revision instead',
          };
        }

        const revisionId = opts.newId();
        const initialContent: RevisionDraftContent = { schema_version: 1 };
        const created = await tx.query<{
          id: string;
          organization_id: string;
          project_id: string;
          revision_code: string;
          iteration: number;
          audience: 'client' | 'internal';
          lifecycle_state: 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';
          content_hash: string | null;
          derived_from_revision_id: string | null;
          created_at: Date;
        }>(
          `INSERT INTO app.revision
             (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
              audience, catalog_release_id, rule_pack_release_id, content, content_hash, created_by)
           VALUES ($1, $2, $3, 'P01', 1, 'DRAFT', 'client', $4, $5, $6::jsonb, NULL, $7)
           RETURNING id, organization_id, project_id, revision_code, iteration, audience,
                     lifecycle_state, content_hash, derived_from_revision_id, created_at`,
          [
            revisionId,
            project.organization_id,
            project.id,
            catalogReleaseId,
            rulePackReleaseId,
            JSON.stringify(initialContent),
            principal.userId,
          ],
        );
        const row = created.rows[0]!;

        await appendAuditEvent(tx, {
          eventId: opts.newId(),
          recordedAt: at,
          content: {
            occurredAt: at,
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: project.organization_id,
            action: 'project.create_revision',
            resourceType: 'revision',
            resourceId: row.id,
            outcome: 'success',
            reasons: [`project:${project.id}`, 'code:P01'],
          },
        });

        const dto = toRevisionInternalDTO({
          id: row.id,
          organization_id: row.organization_id,
          project_id: row.project_id,
          code: row.revision_code,
          iteration: row.iteration,
          audience: row.audience,
          lifecycle_state: row.lifecycle_state,
          content_hash: row.content_hash,
          derived_from_revision_id: row.derived_from_revision_id,
          created_at:
            row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        });
        return { kind: 'created' as const, dto };
      },
    );

    if (outcome.kind === 'project_not_found') {
      await recordObjectDeny(
        principal,
        'project.create_revision',
        projectId,
        'project not found',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'unprocessable') {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(errorEnvelope('UNPROCESSABLE', outcome.message));
    }

    const checked = guard.check(INTERNAL_SCHEMAS.Revision, outcome.dto);
    return reply.code(201).send(checked);
  });

  // -------------------------------------------------------------------------
  // 3. GET /api/client/v1/projects
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/projects', async (request, reply) => {
    const principal = request.principal!;
    const query = (request.query ?? {}) as { page?: unknown; pageSize?: unknown };
    const pageReq = parsePageRequest(query);
    if ('invalid' in pageReq) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', pageReq.invalid));
    }

    const page = await withTenant(tenantOf(principal), async (tx) => {
      const countRes = await tx.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM app.project
          WHERE organization_id = $1`,
        [principal.organizationId],
      );
      const totalItems = countRes.rows[0]?.total ?? 0;

      const rowsRes = await tx.query<{
        id: string;
        number: string;
        name: string;
        status: string;
      }>(
        `SELECT id, number, name, status
           FROM app.project
          WHERE organization_id = $1
          ORDER BY created_at DESC, id ASC
          LIMIT $2 OFFSET $3`,
        [principal.organizationId, pageReq.pageSize, offsetOf(pageReq)],
      );

      const items = rowsRes.rows.map((r) =>
        toProjectClientDTO({
          id: r.id,
          organization_id: principal.organizationId,
          number: r.number,
          name: r.name,
          status: r.status,
        }),
      );
      return paginate(items, pageReq, totalItems);
    });

    const checked = guard.check(PROJECT_PAGE_SCHEMA, page);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 4. GET /api/client/v1/projects/:id/revisions
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/projects/:id/revisions', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const projectId = (params.id ?? '').trim();
    if (!isUuid(projectId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'project id must be a UUID'));
    }

    const query = (request.query ?? {}) as { page?: unknown; pageSize?: unknown };
    const pageReq = parsePageRequest(query);
    if ('invalid' in pageReq) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', pageReq.invalid));
    }

    const outcome = await withTenant(tenantOf(principal), async (tx) => {
      const projRes = await tx.query<{ id: string }>(
        `SELECT id
           FROM app.project
          WHERE id = $1
            AND organization_id = $2`,
        [projectId, principal.organizationId],
      );
      if ((projRes.rowCount ?? 0) === 0) {
        return { kind: 'not_found' as const };
      }

      // Defence in depth (AC-14 / D-02):
      // 1. RLS policy `revision_audience_select` (0005) restricts client reads to
      //    `(organization_id = app.current_org() AND audience = 'client')`.
      // 2. The SQL query explicitly predicates `organization_id = $1 AND project_id = $2 AND audience = 'client'`.
      // 3. `stripInternalRevisions` runs over the returned rows before DTO mapping.
      const countRes = await tx.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM app.revision
          WHERE organization_id = $1
            AND project_id = $2
            AND audience = 'client'`,
        [principal.organizationId, projectId],
      );
      const totalItems = countRes.rows[0]?.total ?? 0;

      const rowsRes = await tx.query<{
        id: string;
        revision_code: string;
        iteration: number;
        lifecycle_state: string;
        audience: 'client' | 'internal';
        content_hash: string | null;
        derived_from_revision_id: string | null;
      }>(
        `SELECT id, revision_code, iteration, lifecycle_state, audience,
                content_hash, derived_from_revision_id
           FROM app.revision
          WHERE organization_id = $1
            AND project_id = $2
            AND audience = 'client'
          ORDER BY iteration ASC, created_at ASC, id ASC
          LIMIT $3 OFFSET $4`,
        [principal.organizationId, projectId, pageReq.pageSize, offsetOf(pageReq)],
      );

      const clientOnly = stripInternalRevisions(rowsRes.rows);
      const items = clientOnly.map((r) =>
        toRevisionClientDTO({
          id: r.id,
          code: r.revision_code,
          iteration: r.iteration,
          frozen: r.lifecycle_state !== 'DRAFT',
          content_hash: r.content_hash,
          derived_from_revision_id: r.derived_from_revision_id,
        }),
      );
      return { kind: 'ok' as const, page: paginate(items, pageReq, totalItems) };
    });

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.read',
        projectId,
        'project not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(REVISION_PAGE_SCHEMA, outcome.page);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // Shared helper for the three DRAFT-only client edit routes
  // -------------------------------------------------------------------------
  async function updateDraftSection(
    principal: Principal,
    revisionId: string,
    sectionName: 'facility' | 'units' | 'options',
    mutate: (current: RevisionDraftContent) => RevisionDraftContent,
  ): Promise<
    | { readonly kind: 'not_found' }
    | { readonly kind: 'immutable'; readonly state: string }
    | { readonly kind: 'ok'; readonly dto: ReturnType<typeof toRevisionClientDTO> }
  > {
    const at = nowIso();
    return withTenant(tenantOf(principal), async (tx) => {
      const revRes = await tx.query<{
        id: string;
        revision_code: string;
        iteration: number;
        lifecycle_state: string;
        content: unknown;
        content_hash: string | null;
        derived_from_revision_id: string | null;
      }>(
        `SELECT id, revision_code, iteration, lifecycle_state, content,
                content_hash, derived_from_revision_id
           FROM app.revision
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'
            FOR UPDATE`,
        [revisionId, principal.organizationId],
      );
      const rev = revRes.rows[0];
      if (rev === undefined) {
        return { kind: 'not_found' as const };
      }
      if (rev.lifecycle_state !== 'DRAFT') {
        return { kind: 'immutable' as const, state: rev.lifecycle_state };
      }

      const currentContent = readDraftContent(rev.content);
      const nextContent = mutate(currentContent);

      await tx.query(
        `UPDATE app.revision
            SET content = $1::jsonb
          WHERE id = $2
            AND organization_id = $3
            AND audience = 'client'
            AND lifecycle_state = 'DRAFT'`,
        [JSON.stringify(nextContent), revisionId, principal.organizationId],
      );

      await syncDerivedTablesOnDraft(
        tx,
        principal.organizationId,
        revisionId,
        nextContent,
        opts.newId,
      );

      await appendAuditEvent(tx, {
        eventId: opts.newId(),
        recordedAt: at,
        content: {
          occurredAt: at,
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: principal.organizationId,
          action: 'revision.edit',
          resourceType: 'revision',
          resourceId: revisionId,
          outcome: 'success',
          reasons: [`section:${sectionName}`],
        },
      });

      const dto = toRevisionClientDTO({
        id: rev.id,
        code: rev.revision_code,
        iteration: rev.iteration,
        frozen: false,
        content_hash: rev.content_hash,
        derived_from_revision_id: rev.derived_from_revision_id,
      });
      return { kind: 'ok' as const, dto };
    });
  }

  // -------------------------------------------------------------------------
  // 5. POST /api/client/v1/revisions/:id/facility
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/revisions/:id/facility', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const parsed = parseBody(FACILITY_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const name = parsed.body['name'] as string | null | undefined;
    const address = parsed.body['address'] as string | null | undefined;
    const widthUm = parsed.body['width_um'] as number | null | undefined;
    const depthUm = parsed.body['depth_um'] as number | null | undefined;
    const clearHeightUm = parsed.body['clear_height_um'] as number | null | undefined;
    const columnGrid = parsed.body['column_grid'] as
      | { pitch_x_um: number; pitch_y_um: number }
      | null
      | undefined;
    const forklift = parsed.body['forklift'] as
      | { model_stated: boolean; required_aisle_um?: number | null }
      | null
      | undefined;
    const dockCount = parsed.body['dock_count'] as number | null | undefined;

    if (
      (typeof widthUm === 'number' && widthUm <= 0) ||
      (typeof depthUm === 'number' && depthUm <= 0) ||
      (typeof clearHeightUm === 'number' && clearHeightUm <= 0)
    ) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'facility dimensions must be positive integers'));
    }
    if (
      columnGrid !== null &&
      columnGrid !== undefined &&
      (columnGrid.pitch_x_um <= 0 || columnGrid.pitch_y_um <= 0)
    ) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'column_grid pitches must be positive integers'));
    }
    if (forklift !== null && forklift !== undefined) {
      if (
        forklift.model_stated &&
        (typeof forklift.required_aisle_um !== 'number' || forklift.required_aisle_um <= 0)
      ) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(
            errorEnvelope(
              'VALIDATION_ERROR',
              'a stated forklift model requires a positive required_aisle_um',
            ),
          );
      }
      if (
        !forklift.model_stated &&
        forklift.required_aisle_um !== null &&
        forklift.required_aisle_um !== undefined
      ) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(
            errorEnvelope(
              'VALIDATION_ERROR',
              'an unstated forklift model cannot carry required_aisle_um (AC-07)',
            ),
          );
      }
    }
    if (typeof dockCount === 'number' && dockCount < 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'dock_count must be non-negative'));
    }

    const facilityDraft: FacilityDraft = {
      ...(name !== undefined ? { name } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(widthUm !== undefined ? { width_um: widthUm } : {}),
      ...(depthUm !== undefined ? { depth_um: depthUm } : {}),
      ...(clearHeightUm !== undefined ? { clear_height_um: clearHeightUm } : {}),
      ...(columnGrid !== undefined ? { column_grid: columnGrid } : {}),
      ...(forklift !== undefined ? { forklift } : {}),
      ...(dockCount !== undefined ? { dock_count: dockCount } : {}),
    };

    const outcome = await updateDraftSection(principal, revisionId, 'facility', (cur) => ({
      ...cur,
      facility: facilityDraft,
    }));

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'immutable') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        `revision is ${outcome.state} and cannot be edited`,
      );
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope(
            'UNPROCESSABLE',
            `revision is ${outcome.state} and cannot be modified; clone a new draft instead`,
          ),
        );
    }

    const checked = guard.check(CLIENT_SCHEMAS.Revision, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 6. POST /api/client/v1/revisions/:id/units
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/revisions/:id/units', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const parsed = parseBody(UNITS_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const rawUnits = parsed.body['units'] as readonly UnitDraft[];
    if (rawUnits.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'at least one handling unit is required'));
    }

    const seenIds = new Set<string>();
    const cleanUnits: UnitDraft[] = [];
    for (const u of rawUnits) {
      const uid = u.unit_id.trim();
      if (uid.length === 0 || seenIds.has(uid)) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'each unit must have a unique non-empty unit_id'));
      }
      if (
        (typeof u.width_um === 'number' && u.width_um <= 0) ||
        (typeof u.depth_um === 'number' && u.depth_um <= 0) ||
        (typeof u.height_um === 'number' && u.height_um <= 0) ||
        (typeof u.weight_lb === 'number' && u.weight_lb <= 0) ||
        (typeof u.pallets_per_bay === 'number' && u.pallets_per_bay <= 0) ||
        (typeof u.target_levels === 'number' && u.target_levels <= 0)
      ) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'unit dimensions and weight must be positive'));
      }
      if (typeof u.overhang_um === 'number' && u.overhang_um < 0) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'overhang_um must be non-negative'));
      }
      seenIds.add(uid);
      cleanUnits.push({
        unit_id: uid,
        ...(u.name !== undefined ? { name: u.name } : {}),
        ...(u.width_um !== undefined ? { width_um: u.width_um } : {}),
        ...(u.depth_um !== undefined ? { depth_um: u.depth_um } : {}),
        ...(u.height_um !== undefined ? { height_um: u.height_um } : {}),
        ...(u.weight_lb !== undefined ? { weight_lb: u.weight_lb } : {}),
        ...(u.overhang_um !== undefined ? { overhang_um: u.overhang_um } : {}),
        ...(u.pallets_per_bay !== undefined ? { pallets_per_bay: u.pallets_per_bay } : {}),
        ...(u.target_levels !== undefined ? { target_levels: u.target_levels } : {}),
        ...(u.commodity_class !== undefined ? { commodity_class: u.commodity_class } : {}),
      });
    }

    const outcome = await updateDraftSection(principal, revisionId, 'units', (cur) => ({
      ...cur,
      units: cleanUnits,
    }));

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'immutable') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        `revision is ${outcome.state} and cannot be edited`,
      );
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope(
            'UNPROCESSABLE',
            `revision is ${outcome.state} and cannot be modified; clone a new draft instead`,
          ),
        );
    }

    const checked = guard.check(CLIENT_SCHEMAS.Revision, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 7. POST /api/client/v1/revisions/:id/options
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/revisions/:id/options', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const parsed = parseBody(OPTIONS_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const rawOptions = parsed.body['options'] as readonly OptionDraft[];
    const activeOptionId =
      typeof parsed.body['active_option_id'] === 'string'
        ? parsed.body['active_option_id'].trim()
        : undefined;

    if (rawOptions.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'at least one layout option is required'));
    }

    const seenOptIds = new Set<string>();
    const cleanOptions: OptionDraft[] = [];

    for (const opt of rawOptions) {
      const oid = opt.option_id.trim();
      const label = opt.label.trim();
      if (oid.length === 0 || label.length === 0 || seenOptIds.has(oid)) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(
            errorEnvelope(
              'VALIDATION_ERROR',
              'each option must have a unique non-empty option_id and label',
            ),
          );
      }
      if (opt.aisle_width_um <= 0 || opt.runs.length === 0) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(
            errorEnvelope(
              'VALIDATION_ERROR',
              'each option requires a positive aisle_width_um and at least one run',
            ),
          );
      }

      const seenRunIds = new Set<string>();
      const cleanRuns: RunDraft[] = [];
      for (const run of opt.runs) {
        const rid = run.run_id.trim();
        const uid = run.unit_id.trim();
        if (rid.length === 0 || uid.length === 0 || seenRunIds.has(rid)) {
          return reply
            .code(statusFor('VALIDATION_ERROR'))
            .send(errorEnvelope('VALIDATION_ERROR', 'each run must have a unique non-empty run_id'));
        }
        if (run.x_um < 0 || run.y_um < 0 || run.bays.length === 0) {
          return reply
            .code(statusFor('VALIDATION_ERROR'))
            .send(
              errorEnvelope(
                'VALIDATION_ERROR',
                'each run requires non-negative coordinates and at least one bay',
              ),
            );
        }
        const seenBayIds = new Set<string>();
        const cleanBays: BayDraft[] = [];
        for (const bay of run.bays) {
          const bid = bay.bay_id.trim();
          if (bid.length === 0 || seenBayIds.has(bid) || bay.length_um <= 0 || bay.levels < 1) {
            return reply
              .code(statusFor('VALIDATION_ERROR'))
              .send(
                errorEnvelope(
                  'VALIDATION_ERROR',
                  'each bay requires a unique bay_id, positive length_um, and levels >= 1',
                ),
              );
          }
          seenBayIds.add(bid);
          cleanBays.push({ bay_id: bid, length_um: bay.length_um, levels: bay.levels });
        }
        seenRunIds.add(rid);
        cleanRuns.push({
          run_id: rid,
          unit_id: uid,
          x_um: run.x_um,
          y_um: run.y_um,
          bays: cleanBays,
        });
      }

      seenOptIds.add(oid);
      cleanOptions.push({
        option_id: oid,
        label,
        aisle_width_um: opt.aisle_width_um,
        runs: cleanRuns,
      });
    }

    if (activeOptionId !== undefined && !seenOptIds.has(activeOptionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'active_option_id must match one of the options'));
    }

    const chosenOptionId = activeOptionId ?? cleanOptions[0]!.option_id;

    const outcome = await updateDraftSection(principal, revisionId, 'options', (cur) => ({
      ...cur,
      options: cleanOptions,
      active_option_id: chosenOptionId,
    }));

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'immutable') {
      await recordObjectDeny(
        principal,
        'revision.edit',
        revisionId,
        `revision is ${outcome.state} and cannot be edited`,
      );
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope(
            'UNPROCESSABLE',
            `revision is ${outcome.state} and cannot be modified; clone a new draft instead`,
          ),
        );
    }

    const checked = guard.check(CLIENT_SCHEMAS.Revision, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 8. GET /api/client/v1/revisions/:id/preview
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/revisions/:id/preview', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const outcome = await withTenant(tenantOf(principal), async (tx) => {
      const revRes = await tx.query<{
        id: string;
        content: unknown;
        content_hash: string | null;
      }>(
        `SELECT id, content, content_hash
           FROM app.revision
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'`,
        [revisionId, principal.organizationId],
      );
      const rev = revRes.rows[0];
      if (rev === undefined) {
        return { kind: 'not_found' as const };
      }

      const dbAssumptions = await tx.query<{
        key: string;
        assumed_value_um: string | number | null;
        assumed_unit: string;
        why: string;
        scope: string;
        acknowledged_by: string | null;
        acknowledged_at: Date | string | null;
      }>(
        `SELECT key, assumed_value_um, assumed_unit, why, scope,
                acknowledged_by, acknowledged_at
           FROM app.assumption
          WHERE organization_id = $1
            AND revision_id = $2
            AND audience = 'client'
          ORDER BY key ASC, scope ASC`,
        [principal.organizationId, revisionId],
      );

      const ackMap = new Map<
        string,
        { readonly acknowledgedBy: string | null; readonly acknowledgedAt: string | null }
      >();
      for (const r of dbAssumptions.rows) {
        ackMap.set(`${r.key}::${r.scope}`, {
          acknowledgedBy: r.acknowledged_by,
          acknowledgedAt:
            r.acknowledged_at instanceof Date
              ? r.acknowledged_at.toISOString()
              : r.acknowledged_at,
        });
      }

      const content = readDraftContent(rev.content);
      const draftHash = computeDraftHash(content, rev.content_hash);
      const derivedAssumptions = collectDraftAssumptions(content, ackMap);

      // Include any DB-seeded assumptions that weren't in derivedAssumptions.
      const assumptionList: DerivedAssumptionRow[] = [...derivedAssumptions];
      const seenKeys = new Set(derivedAssumptions.map((a) => `${a.key}::${a.scope}`));
      for (const r of dbAssumptions.rows) {
        const k = `${r.key}::${r.scope}`;
        if (!seenKeys.has(k) && r.assumed_value_um !== null) {
          seenKeys.add(k);
          assumptionList.push({
            key: r.key,
            assumedValue: { value: Number(r.assumed_value_um), unit: r.assumed_unit },
            why: r.why,
            scope: r.scope,
            acknowledgedBy: r.acknowledged_by ?? undefined,
            acknowledgedAt:
              r.acknowledged_at instanceof Date
                ? r.acknowledged_at.toISOString()
                : (r.acknowledged_at ?? undefined),
          });
        }
      }

      const activeOption =
        content.options?.find((o) => o.option_id === content.active_option_id) ??
        content.options?.[0];

      const optionDerived =
        activeOption !== undefined
          ? deriveOption(content, activeOption, assumptionList)
          : null;

      const forkliftStated =
        content.facility?.forklift?.model_stated === true &&
        typeof content.facility.forklift.required_aisle_um === 'number';

      const counts = optionDerived?.counts ?? {
        gross_positions: 0,
        lost_positions: 0,
        net_positions: 0,
      };
      const dimensions = optionDerived?.dimensions ?? {
        aisle_clear_width: forkliftStated
          ? { value_um: content.facility!.forklift!.required_aisle_um as number, established: true }
          : { value_um: null, established: false },
        bay_pitch: { value_um: null, established: false },
        run_length: { value_um: null, established: false },
      };
      const findings = optionDerived?.findings ?? [];

      const viewItems = buildPlanViewItems(content, activeOption);
      const elevationItems = buildElevationViewItems(content, activeOption);
      const firstBayLengthUm = activeOption?.runs[0]?.bays[0]?.length_um ?? 2_438_400;
      const dto = toPreviewClientDTO({
        revision_id: rev.id,
        counts,
        dimensions,
        assumptions: assumptionList,
        findings,
        views: [
          {
            view: 'plan',
            extent: {
              width: content.facility?.width_um ?? 24_384_000,
              height: content.facility?.depth_um ?? 12_192_000,
            },
            revisionHash: draftHash,
            items: viewItems,
          },
          {
            view: 'elevation',
            extent: {
              width: UPRIGHT_WIDTH_UM * 2 + firstBayLengthUm,
              height: content.facility?.clear_height_um ?? 9_144_000,
            },
            revisionHash: draftHash,
            items: elevationItems,
          },
        ],
      });

      return { kind: 'ok' as const, dto };
    });

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.read',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(CLIENT_SCHEMAS.Preview, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 9. GET /api/client/v1/revisions/:id/compare
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/revisions/:id/compare', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const query = (request.query ?? {}) as { options?: unknown };
    let requestedOptionIds: readonly string[] | null = null;
    if (query.options !== undefined && query.options !== null && query.options !== '') {
      if (typeof query.options !== 'string') {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'options query parameter must be a comma-separated string'));
      }
      requestedOptionIds = query.options
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (requestedOptionIds.length < 2) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'at least two option ids are required to compare'));
      }
    }

    const outcome = await withTenant(tenantOf(principal), async (tx) => {
      const revRes = await tx.query<{
        id: string;
        content: unknown;
      }>(
        `SELECT id, content
           FROM app.revision
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'`,
        [revisionId, principal.organizationId],
      );
      const rev = revRes.rows[0];
      if (rev === undefined) {
        return { kind: 'not_found' as const };
      }

      const content = readDraftContent(rev.content);
      const allOptions = content.options ?? [];
      if (allOptions.length < 2) {
        return {
          kind: 'unprocessable' as const,
          message: 'comparison requires at least two options on the revision',
        };
      }

      const byId = new Map(allOptions.map((o) => [o.option_id, o]));
      let selected: OptionDraft[];
      if (requestedOptionIds !== null) {
        const picked: OptionDraft[] = [];
        const seen = new Set<string>();
        for (const id of requestedOptionIds) {
          if (seen.has(id)) {
            return {
              kind: 'unprocessable' as const,
              message: `duplicate option id '${id}' in comparison`,
            };
          }
          const opt = byId.get(id);
          if (opt === undefined) {
            return {
              kind: 'unprocessable' as const,
              message: `unknown option id '${id}' on revision`,
            };
          }
          seen.add(id);
          picked.push(opt);
        }
        selected = picked;
      } else {
        selected = [...allOptions];
      }

      const assumptions = collectDraftAssumptions(content, new Map());
      const derivations = selected.map((opt) => deriveOption(content, opt, assumptions));

      const metricValues = (
        metric: ComparableMetric,
        d: OptionDerivation,
      ): number | null => {
        switch (metric) {
          case 'net_positions':
            return d.counts.net_positions;
          case 'aisle_clear_width_in':
            return d.dimensions.aisle_clear_width.established &&
              d.dimensions.aisle_clear_width.value_um !== null
              ? Math.round(d.dimensions.aisle_clear_width.value_um / UM_PER_INCH)
              : null;
          case 'top_of_load_in':
            return d.topOfLoadIn;
          case 'storage_levels':
            return d.storageLevels;
        }
      };

      const metrics: readonly ComparableMetric[] = [
        'net_positions',
        'aisle_clear_width_in',
        'top_of_load_in',
        'storage_levels',
      ];

      const rows = metrics.map((metric) => {
        const values = derivations.map((d) => metricValues(metric, d));
        return {
          metric,
          values,
          hasUnestablished: values.some((v) => v === null),
        };
      });

      const dto = toComparisonClientDTO({
        revision_id: rev.id,
        options: selected.map((o) => ({ optionId: o.option_id, label: o.label })),
        rows,
      });

      return { kind: 'ok' as const, dto };
    });

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'revision.read',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'unprocessable') {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(errorEnvelope('UNPROCESSABLE', outcome.message));
    }

    const checked = guard.check(CLIENT_SCHEMAS.Comparison, outcome.dto);
    return reply.code(200).send(checked);
  });

  const wormStore: WormStore = opts.wormStore ?? new InMemoryWormStore(nowIso);

  // -------------------------------------------------------------------------
  // 10. POST /api/client/v1/revisions/:id/submit
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/revisions/:id/submit', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const parsed = parseBody(SUBMIT_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const idempotencyKey = readIdempotencyKey(request);
    if (idempotencyKey === null) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'Idempotency-Key header is required'));
    }

    const assumptionsAcknowledged = parsed.body['assumptions_acknowledged'] as boolean;
    const disclaimerVersionId = parsed.body['disclaimer_version_id'] as string;

    const tenant = tenantOf(principal);
    const atDate = opts.now();
    const atIso = atDate.toISOString();

    // Scoped fetch first (§8.3 rule 2 & 3): verify the revision belongs to the
    // caller's organization and is client-visible before touching idempotency.
    const revLookup = await withTenant(tenant, async (tx) => {
      const res = await tx.query<{
        id: string;
        project_id: string;
        revision_code: string;
        iteration: number;
        lifecycle_state: string;
        parent_revision_id: string | null;
        derived_from_revision_id: string | null;
        catalog_release_id: string;
        rule_pack_release_id: string;
        content: unknown;
      }>(
        `SELECT id, project_id, revision_code, iteration, lifecycle_state,
                parent_revision_id, derived_from_revision_id,
                catalog_release_id, rule_pack_release_id, content
           FROM app.revision
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'`,
        [revisionId, principal.organizationId],
      );
      const rev = res.rows[0];
      if (rev === undefined) {
        return null;
      }
      if (rev.lifecycle_state === 'DRAFT') {
        const draftContent = readDraftContent(rev.content);
        await syncDerivedTablesOnDraft(
          tx,
          principal.organizationId,
          revisionId,
          draftContent,
          opts.newId,
        );
      }
      return rev;
    });

    if (revLookup === null) {
      await recordObjectDeny(
        principal,
        'revision.submit',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const claim = await claimIdempotencyKey(tenant, {
      id: opts.newId(),
      organizationId: principal.organizationId,
      key: idempotencyKey,
      intent: 'submit',
      body: {
        revision_id: revisionId,
        assumptions_acknowledged: assumptionsAcknowledged,
        disclaimer_version_id: disclaimerVersionId,
      },
      now: atDate,
      leaseMs: claimLeaseMs(opts.env),
    });

    if (claim.status === 'settled') {
      const existing = await withTenant(tenant, (tx) =>
        tx.query<{
          id: string;
          revision_id: string;
          request_status: string;
          submitted_at: Date | string;
          this_hash: string;
        }>(
          `SELECT id, revision_id, request_status, submitted_at, this_hash
             FROM app.submission
            WHERE id = $1
              AND organization_id = $2
              AND audience = 'client'`,
          [claim.resultRef, principal.organizationId],
        ),
      );
      const row = existing.rows[0]!;
      const dto = toSubmissionClientDTO({
        id: row.id,
        revision_id: row.revision_id,
        request_status: row.request_status,
        submitted_at:
          row.submitted_at instanceof Date
            ? row.submitted_at.toISOString()
            : String(row.submitted_at),
        submission_hash: row.this_hash,
      });
      const checked = guard.check(CLIENT_SCHEMAS.Submission, dto);
      return reply.code(201).send(checked);
    }

    if (claim.status !== 'claimed') {
      const code = errorCodeFor(claim.status)!;
      return reply
        .code(statusFor(code))
        .send(errorEnvelope(code, `idempotency key ${claim.status}`));
    }

    if (revLookup.lifecycle_state !== 'DRAFT') {
      await settleIdempotencyKey(tenant, {
        id: claim.id,
        epoch: claim.epoch,
        outcome: 'failed',
        now: atDate,
      });
      await recordObjectDeny(
        principal,
        'revision.submit',
        revisionId,
        `revision is ${revLookup.lifecycle_state} and cannot be submitted`,
      );
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope(
            'UNPROCESSABLE',
            `revision is ${revLookup.lifecycle_state} and has already been submitted`,
          ),
        );
    }

    const draftContent = readDraftContent(revLookup.content);
    const derivedAssumptions = collectDraftAssumptions(draftContent, new Map());
    const activeOption =
      draftContent.options?.find((o) => o.option_id === draftContent.active_option_id) ??
      draftContent.options?.[0];
    const optionDerived =
      activeOption !== undefined
        ? deriveOption(draftContent, activeOption, derivedAssumptions)
        : null;

    const clientFindings: readonly ClientFinding[] =
      optionDerived !== null
        ? optionDerived.findings.map((f) => ({
            code: f.code,
            severity: f.severity === 'REVIEW' ? 'ENGINEERING_REVIEW_REQUIRED' : f.severity,
            closedBy: f.closed_by,
            subjectObjectIds: [...f.subject_object_ids],
          }))
        : [
            {
              code: 'NO_LAYOUT_OPTION',
              severity: 'BLOCKER',
              closedBy: 'Configure at least one layout option before submitting.',
              subjectObjectIds: [revisionId],
            },
          ];

    const contentJson = canonicalise({
      schema_version: 1,
      catalog_release_id: revLookup.catalog_release_id,
      rule_pack_release_id: revLookup.rule_pack_release_id,
      ...draftContent,
    });

    const manifestJson = canonicaliseAll({
      schema_version: 1,
      revision_id: revLookup.id,
      project_id: revLookup.project_id,
      revision_code: revLookup.revision_code,
      iteration: revLookup.iteration,
      parent_revision_id: revLookup.parent_revision_id,
      derived_from_revision_id: revLookup.derived_from_revision_id,
      catalog_release_id: revLookup.catalog_release_id,
      rule_pack_release_id: revLookup.rule_pack_release_id,
      author: principal.userId,
      submitted_at: atIso,
      disclaimer_version_id: disclaimerVersionId,
      content: draftContent,
      counts: optionDerived?.counts ?? {
        gross_positions: 0,
        lost_positions: 0,
        net_positions: 0,
      },
      findings: clientFindings,
      assumptions: derivedAssumptions.map((a) => ({
        key: a.key,
        assumedValue: a.assumedValue,
        why: a.why,
        scope: a.scope,
      })),
    });

    const derivation: Derivation = {
      findings: clientFindings,
      assumptions: derivedAssumptions.map((a) => ({
        key: a.key,
        assumedValue: a.assumedValue,
        why: a.why,
        scope: a.scope,
      })),
      contentJson,
      manifestJson,
    };

    const submissionId = opts.newId();
    const acknowledgementEventId = opts.newId();
    const freezeEventId = opts.newId();
    const submissionEventId = opts.newId();
    const outboxIds = [opts.newId(), opts.newId(), opts.newId()] as const;

    try {
      const submitResult = await submitRevision(
        tenant,
        {
          revisionId,
          submittedBy: principal.userId,
          submittedAt: atIso,
          assumptionsAcknowledged,
          disclaimerVersionId,
        },
        {
          organizationId: principal.organizationId,
          submittedBy: principal.userId,
          now: atIso,
          ids: {
            submissionId,
            acknowledgementEventId,
            freezeEventId,
            submissionEventId,
            outboxIds,
          },
          rederive: async () => derivation,
        },
      );

      // Write the canonical manifest into WORM storage (E-07, COMPLIANCE 7-year lock)
      // and record its storage key on the submission row.
      const retainUntil = new Date(
        atDate.getTime() + RETENTION_DAYS_7_YEARS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const wormObject = prepareManifest({
        submissionId,
        canonicalJson: manifestJson,
        retainUntil,
        mode: 'COMPLIANCE',
      });
      if (!(await wormStore.has(wormObject.key))) {
        await wormStore.put(wormObject);
      }

      await withTenant(tenant, (tx) =>
        tx.query(
          `UPDATE app.submission
              SET manifest_uri = $1
            WHERE id = $2
              AND organization_id = $3`,
          [wormObject.key, submissionId, principal.organizationId],
        ),
      );

      await settleIdempotencyKey(tenant, {
        id: claim.id,
        epoch: claim.epoch,
        outcome: 'succeeded',
        resultRef: submissionId,
        now: atDate,
      });

      const dto = toSubmissionClientDTO({
        id: submissionId,
        revision_id: revisionId,
        request_status: 'SUBMITTED',
        submitted_at: atIso,
        submission_hash: submitResult.submissionHash,
      });
      const checked = guard.check(CLIENT_SCHEMAS.Submission, dto);
      return reply.code(201).send(checked);
    } catch (error) {
      await settleIdempotencyKey(tenant, {
        id: claim.id,
        epoch: claim.epoch,
        outcome: 'failed',
        now: atDate,
      });

      if (error instanceof SubmitError) {
        await withTenant(tenant, (tx) =>
          appendAuditEvent(tx, {
            eventId: opts.newId(),
            recordedAt: atIso,
            content: {
              occurredAt: atIso,
              actorUserId: principal.userId,
              actorType: principal.actorType,
              actorOrganizationId: principal.organizationId,
              impersonatedBy: null,
              subjectOrganizationId: principal.organizationId,
              action: 'revision.submit',
              resourceType: 'revision',
              resourceId: revisionId,
              outcome: 'denied',
              reasons: [...error.reasons],
            },
          }),
        );
        return reply
          .code(statusFor('UNPROCESSABLE'))
          .send(
            errorEnvelope('UNPROCESSABLE', error.message, {
              step: error.step,
              reasons: [...error.reasons],
            }),
          );
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // 11. POST /api/client/v1/revisions/:id/clone
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/revisions/:id/clone', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const rawBody = request.body ?? {};
    const parsed = parseBody(CLONE_BODY, rawBody);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const idempotencyKey = readIdempotencyKey(request);
    if (idempotencyKey === null) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'Idempotency-Key header is required'));
    }

    const tenant = tenantOf(principal);
    const atDate = opts.now();
    const atIso = atDate.toISOString();

    const sourceRev = await withTenant(tenant, async (tx) => {
      const res = await tx.query<{
        id: string;
        project_id: string;
        revision_code: string;
        iteration: number;
        lifecycle_state: 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';
        audience: 'client' | 'internal';
        parent_revision_id: string | null;
        derived_from_revision_id: string | null;
        catalog_release_id: string;
        rule_pack_release_id: string;
        content: unknown;
        content_hash: string | null;
        frozen_at: Date | string | null;
      }>(
        `SELECT id, project_id, revision_code, iteration, lifecycle_state, audience,
                parent_revision_id, derived_from_revision_id, catalog_release_id,
                rule_pack_release_id, content, content_hash, frozen_at
           FROM app.revision
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'`,
        [revisionId, principal.organizationId],
      );
      return res.rows[0] ?? null;
    });

    if (sourceRev === null) {
      await recordObjectDeny(
        principal,
        'revision.clone',
        revisionId,
        'revision not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const claim = await claimIdempotencyKey(tenant, {
      id: opts.newId(),
      organizationId: principal.organizationId,
      key: idempotencyKey,
      intent: 'clone',
      body: { revision_id: revisionId, ...parsed.body },
      now: atDate,
      leaseMs: claimLeaseMs(opts.env),
    });

    if (claim.status === 'settled') {
      const existing = await withTenant(tenant, (tx) =>
        tx.query<{
          id: string;
          revision_code: string;
          iteration: number;
          lifecycle_state: string;
          content_hash: string | null;
          derived_from_revision_id: string | null;
        }>(
          `SELECT id, revision_code, iteration, lifecycle_state,
                  content_hash, derived_from_revision_id
             FROM app.revision
            WHERE id = $1
              AND organization_id = $2
              AND audience = 'client'`,
          [claim.resultRef, principal.organizationId],
        ),
      );
      const row = existing.rows[0]!;
      const dto = toRevisionClientDTO({
        id: row.id,
        code: row.revision_code,
        iteration: row.iteration,
        frozen: row.lifecycle_state !== 'DRAFT',
        content_hash: row.content_hash,
        derived_from_revision_id: row.derived_from_revision_id,
      });
      const checked = guard.check(CLIENT_SCHEMAS.Revision, dto);
      return reply.code(201).send(checked);
    }

    if (claim.status !== 'claimed') {
      const code = errorCodeFor(claim.status)!;
      return reply
        .code(statusFor(code))
        .send(errorEnvelope(code, `idempotency key ${claim.status}`));
    }

    if (sourceRev.lifecycle_state === 'DRAFT') {
      await settleIdempotencyKey(tenant, {
        id: claim.id,
        epoch: claim.epoch,
        outcome: 'failed',
        now: atDate,
      });
      await recordObjectDeny(
        principal,
        'revision.clone',
        revisionId,
        'revision is DRAFT and cannot be cloned; submit to freeze first',
      );
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope(
            'UNPROCESSABLE',
            'only a frozen revision can be cloned to a new draft',
          ),
        );
    }

    const clonedDto = await withTenant(tenant, async (tx) => {
      const seqRes = await tx.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt
           FROM app.revision
          WHERE organization_id = $1
            AND project_id = $2
            AND audience = 'client'`,
        [principal.organizationId, sourceRev.project_id],
      );
      const nextNum = (seqRes.rows[0]?.cnt ?? 1) + 1;
      const nextCode = `P${String(nextNum).padStart(2, '0')}`;
      const newRevisionId = opts.newId();
      const draftContent = readDraftContent(sourceRev.content);

      const clonedModel = cloneToDraft(
        {
          id: sourceRev.id,
          revision_code: sourceRev.revision_code,
          iteration: sourceRev.iteration,
          lifecycle_state: sourceRev.lifecycle_state,
          audience: 'client',
          parent_revision_id: sourceRev.parent_revision_id,
          derived_from_revision_id: sourceRev.derived_from_revision_id,
          catalog_release_id: sourceRev.catalog_release_id,
          rule_pack_release_id: sourceRev.rule_pack_release_id,
          content: draftContent as unknown as Readonly<Record<string, unknown>>,
          content_hash: sourceRev.content_hash,
          frozen_at:
            sourceRev.frozen_at instanceof Date
              ? sourceRev.frozen_at.toISOString()
              : sourceRev.frozen_at,
        },
        newRevisionId,
        nextCode,
        'client',
      );

      const inserted = await tx.query<{
        id: string;
        revision_code: string;
        iteration: number;
        lifecycle_state: string;
        content_hash: string | null;
        derived_from_revision_id: string | null;
      }>(
        `INSERT INTO app.revision
           (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
            audience, parent_revision_id, derived_from_revision_id,
            catalog_release_id, rule_pack_release_id, content, content_hash, created_by)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT', 'client', $6, $7, $8, $9, $10::jsonb, NULL, $11)
         RETURNING id, revision_code, iteration, lifecycle_state,
                   content_hash, derived_from_revision_id`,
        [
          clonedModel.id,
          principal.organizationId,
          sourceRev.project_id,
          clonedModel.revision_code,
          clonedModel.iteration,
          clonedModel.parent_revision_id,
          clonedModel.derived_from_revision_id,
          clonedModel.catalog_release_id,
          clonedModel.rule_pack_release_id,
          JSON.stringify(clonedModel.content),
          principal.userId,
        ],
      );
      const row = inserted.rows[0]!;

      await syncDerivedTablesOnDraft(
        tx,
        principal.organizationId,
        row.id,
        draftContent,
        opts.newId,
      );

      await appendAuditEvent(tx, {
        eventId: opts.newId(),
        recordedAt: atIso,
        content: {
          occurredAt: atIso,
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: principal.organizationId,
          action: 'revision.clone',
          resourceType: 'revision',
          resourceId: row.id,
          outcome: 'success',
          reasons: [`derived_from:${sourceRev.id}`, `code:${row.revision_code}`],
        },
      });

      return toRevisionClientDTO({
        id: row.id,
        code: row.revision_code,
        iteration: row.iteration,
        frozen: false,
        content_hash: row.content_hash,
        derived_from_revision_id: row.derived_from_revision_id,
      });
    });

    await settleIdempotencyKey(tenant, {
      id: claim.id,
      epoch: claim.epoch,
      outcome: 'succeeded',
      resultRef: clonedDto.id,
      now: atDate,
    });

    const checked = guard.check(CLIENT_SCHEMAS.Revision, clonedDto);
    return reply.code(201).send(checked);
  });

  // -------------------------------------------------------------------------
  // 12. GET /api/client/v1/submissions/:id
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/submissions/:id', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const submissionId = (params.id ?? '').trim();
    if (!isUuid(submissionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'submission id must be a UUID'));
    }

    const row = await withTenant(tenantOf(principal), async (tx) => {
      const res = await tx.query<{
        id: string;
        revision_id: string;
        request_status: string;
        submitted_at: Date | string;
        this_hash: string;
      }>(
        `SELECT id, revision_id, request_status, submitted_at, this_hash
           FROM app.submission
          WHERE id = $1
            AND organization_id = $2
            AND audience = 'client'`,
        [submissionId, principal.organizationId],
      );
      return res.rows[0] ?? null;
    });

    if (row === null) {
      await recordObjectDeny(
        principal,
        'submission.read',
        submissionId,
        'submission not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const dto = toSubmissionClientDTO({
      id: row.id,
      revision_id: row.revision_id,
      request_status: row.request_status,
      submitted_at:
        row.submitted_at instanceof Date
          ? row.submitted_at.toISOString()
          : String(row.submitted_at),
      submission_hash: row.this_hash,
    });
    const checked = guard.check(CLIENT_SCHEMAS.Submission, dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 13. GET /api/client/v1/documents/:id
  // -------------------------------------------------------------------------
  app.get('/api/client/v1/documents/:id', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const documentId = (params.id ?? '').trim();
    if (!isUuid(documentId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'document id must be a UUID'));
    }

    const atDate = opts.now();
    const atIso = atDate.toISOString();
    const expiresAtMs = atDate.getTime() + DOCUMENT_URL_TTL_MS;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    const outcome = await withTenant(tenantOf(principal), async (tx) => {
      const res = await tx.query<{
        submission_id: string;
        manifest_hash: string;
        revision_id: string;
        revision_code: string;
        project_number: string;
      }>(
        `SELECT s.id AS submission_id,
                s.manifest_hash,
                r.id AS revision_id,
                r.revision_code,
                p.number AS project_number
           FROM app.submission s
           JOIN app.revision r
             ON r.id = s.revision_id
            AND r.organization_id = s.organization_id
           JOIN app.project p
             ON p.id = r.project_id
            AND p.organization_id = s.organization_id
          WHERE s.organization_id = $1
            AND s.audience = 'client'
            AND r.audience = 'client'
            AND (s.id = $2 OR s.revision_id = $2)
          ORDER BY s.submitted_at DESC
          LIMIT 1`,
        [principal.organizationId, documentId],
      );
      const doc = res.rows[0];
      if (doc === undefined) {
        return { kind: 'not_found' as const };
      }

      const outboxRes = await tx.query<{
        status: string;
        attempts: number;
        last_error: string | null;
      }>(
        `SELECT status::text AS status,
                attempts,
                last_error
           FROM app.outbox_message
          WHERE organization_id = $1
            AND topic = 'pdf.generate'
            AND payload->>'reference' = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [principal.organizationId, doc.manifest_hash],
      );
      const outboxJob = outboxRes.rows[0];

      let statusCode = 'PRELIMINARY';
      let documentUrl = signDocumentUrl({
        submissionId: doc.submission_id,
        manifestHash: doc.manifest_hash,
        expiresAtMs,
      });

      if (outboxJob !== undefined && outboxJob.status === 'dispatched') {
        statusCode = 'PRELIMINARY';
      } else if (
        outboxJob !== undefined &&
        (outboxJob.status === 'dead' ||
          outboxJob.status === 'failed' ||
          outboxJob.last_error !== null)
      ) {
        statusCode = 'FAILED';
        documentUrl = '';
      } else if (outboxJob !== undefined && outboxJob.status === 'pending') {
        statusCode = 'PENDING';
        documentUrl = '';
      }

      await appendAuditEvent(tx, {
        eventId: opts.newId(),
        recordedAt: atIso,
        content: {
          occurredAt: atIso,
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: principal.organizationId,
          action: 'document.read',
          resourceType: 'document',
          resourceId: documentId,
          outcome: 'success',
          reasons: [
            `submission:${doc.submission_id}`,
            `revision:${doc.revision_code}`,
            `status:${statusCode}`,
          ],
        },
      });

      const dto = toDocumentClientDTO({
        id: documentId,
        number: `${doc.project_number}-${doc.revision_code}-PRELIM`,
        revision_code: doc.revision_code,
        status_code: statusCode,
        url: documentUrl,
        expires_at: expiresAtIso,
      });

      return { kind: 'ok' as const, dto };
    });

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'document.read',
        documentId,
        'document not found in caller organization',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(CLIENT_SCHEMAS.Document, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 14. GET /api/internal/v1/queue (T-14e + P-02)
  // -------------------------------------------------------------------------
  app.get('/api/internal/v1/queue', async (request, reply) => {
    const principal = request.principal!;
    const query = (request.query ?? {}) as {
      page?: unknown;
      pageSize?: unknown;
      status?: unknown;
    };
    const pageReq = parsePageRequest(query);
    if ('invalid' in pageReq) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', pageReq.invalid));
    }

    let statusFilter: SubmittedStatus | undefined;
    if (query.status !== undefined) {
      if (typeof query.status !== 'string' || !SUBMITTED_STATUS_SET.has(query.status)) {
        return reply
          .code(statusFor('VALIDATION_ERROR'))
          .send(errorEnvelope('VALIDATION_ERROR', 'invalid queue status filter'));
      }
      statusFilter = query.status as SubmittedStatus;
    }

    const page = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      (tx) => queryInternalQueuePage(tx, pageReq, statusFilter),
    );

    const checked = guard.check(QUEUE_PAGE_SCHEMA, page);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 15. GET /api/internal/v1/submissions/:id (T-14e)
  // -------------------------------------------------------------------------
  app.get('/api/internal/v1/submissions/:id', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const submissionId = (params.id ?? '').trim();
    if (!isUuid(submissionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'submission id must be a UUID'));
    }

    const outcome = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      async (tx) => {
        const subRes = await tx.query<{
          id: string;
          organization_id: string;
          revision_id: string;
          request_status: SubmittedStatus;
          manifest_hash: string;
          this_hash: string;
          decline_reason: string | null;
          submitted_by: string;
          submitted_at: Date | string;
          acknowledged_at: Date | string | null;
          quoted_at: Date | string | null;
        }>(
          `SELECT id, organization_id, revision_id, request_status::text AS request_status,
                  manifest_hash, this_hash, decline_reason, submitted_by,
                  submitted_at, acknowledged_at, quoted_at
             FROM app.submission
            WHERE id = $1`,
          [submissionId],
        );
        const sub = subRes.rows[0];
        if (sub === undefined) {
          return { kind: 'not_found' as const };
        }

        const revRes = await tx.query<{
          id: string;
          organization_id: string;
          project_id: string;
          revision_code: string;
          iteration: number;
          audience: 'client' | 'internal';
          lifecycle_state: 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';
          catalog_release_id: string;
          rule_pack_release_id: string;
          content: unknown;
          content_hash: string | null;
          derived_from_revision_id: string | null;
          created_at: Date | string;
        }>(
          `SELECT id, organization_id, project_id, revision_code, iteration, audience,
                  lifecycle_state, catalog_release_id, rule_pack_release_id, content,
                  content_hash, derived_from_revision_id, created_at
             FROM app.revision
            WHERE id = $1
              AND organization_id = $2`,
          [sub.revision_id, sub.organization_id],
        );
        const rev = revRes.rows[0]!;
        const draftContent = readDraftContent(rev.content);

        const assumpRes = await tx.query<{
          key: string;
          assumed_value_um: string | number | null;
          assumed_unit: string;
          why: string;
          scope: string;
          acknowledged_by: string | null;
          acknowledged_at: Date | string | null;
        }>(
          `SELECT key, assumed_value_um, assumed_unit, why, scope, acknowledged_by, acknowledged_at
             FROM app.assumption
            WHERE organization_id = $1
              AND revision_id = $2
            ORDER BY key ASC, id ASC`,
          [sub.organization_id, rev.id],
        );

        const findings = await loadInternalFindingsForRevision(
          tx,
          rev.organization_id,
          rev.id,
          rev.rule_pack_release_id,
          draftContent,
        );

        const bomLines = await loadOrMaterialiseBomLines(
          tx,
          {
            id: rev.id,
            organizationId: rev.organization_id,
            audience: rev.audience,
            catalogReleaseId: rev.catalog_release_id,
            content: draftContent,
            contentHash: rev.content_hash ?? computeDraftHash(draftContent, null),
          },
          opts.newId,
        );

        const notesRes = await tx.query<{
          id: string;
          author_id: string;
          body: string;
          created_at: Date | string;
        }>(
          `SELECT n.id, n.author_id, n.body, n.created_at
             FROM app.internal_note n
             JOIN app.revision r
               ON r.id = n.revision_id
              AND r.organization_id = n.organization_id
            WHERE n.organization_id = $1
              AND (r.id = $2 OR r.derived_from_revision_id = $2)
            ORDER BY n.created_at ASC, n.id ASC`,
          [sub.organization_id, rev.id],
        );

        const pkgDto = toSubmissionPackageInternalDTO({
          submission: {
            id: sub.id,
            organization_id: sub.organization_id,
            revision_id: sub.revision_id,
            request_status: sub.request_status,
            manifest_hash: sub.manifest_hash,
            this_hash: sub.this_hash,
            decline_reason: sub.decline_reason,
            submitted_by: sub.submitted_by,
            submitted_at: toIso(sub.submitted_at),
            acknowledged_at: sub.acknowledged_at === null ? null : toIso(sub.acknowledged_at),
            quoted_at: sub.quoted_at === null ? null : toIso(sub.quoted_at),
          },
          revision: {
            id: rev.id,
            organization_id: rev.organization_id,
            project_id: rev.project_id,
            code: rev.revision_code,
            iteration: rev.iteration,
            audience: rev.audience,
            lifecycle_state: rev.lifecycle_state,
            content_hash: rev.content_hash,
            derived_from_revision_id: rev.derived_from_revision_id,
            created_at: toIso(rev.created_at),
          },
          assumptions: assumpRes.rows.map((a) => ({
            key: a.key,
            assumedValue: {
              value: a.assumed_value_um === null ? 0 : Number(a.assumed_value_um),
              unit: a.assumed_unit,
            },
            why: a.why,
            scope: a.scope,
            ...(a.acknowledged_by !== null ? { acknowledgedBy: a.acknowledged_by } : {}),
            ...(a.acknowledged_at !== null
              ? { acknowledgedAt: toIso(a.acknowledged_at) }
              : {}),
          })),
          findings,
          bomLines,
          notes: notesRes.rows.map((n) => ({
            id: n.id,
            submissionId: sub.id,
            authorId: n.author_id,
            body: n.body,
            createdAt: toIso(n.created_at),
            clientVisible: false as const,
          })),
        });

        return { kind: 'ok' as const, dto: pkgDto };
      },
    );

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(principal, 'submission.read', submissionId, 'submission not found');
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(INTERNAL_SCHEMAS.SubmissionPackage, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 16. GET /api/internal/v1/revisions/:id/bom (T-14e)
  // -------------------------------------------------------------------------
  app.get('/api/internal/v1/revisions/:id/bom', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const query = (request.query ?? {}) as { page?: unknown; pageSize?: unknown };
    const pageReq = parsePageRequest(query);
    if ('invalid' in pageReq) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', pageReq.invalid));
    }

    const outcome = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      async (tx) => {
        const revRes = await tx.query<{
          id: string;
          organization_id: string;
          audience: 'client' | 'internal';
          catalog_release_id: string;
          content: unknown;
          content_hash: string | null;
        }>(
          `SELECT id, organization_id, audience, catalog_release_id, content, content_hash
             FROM app.revision
            WHERE id = $1`,
          [revisionId],
        );
        const rev = revRes.rows[0];
        if (rev === undefined) {
          return { kind: 'not_found' as const };
        }

        const draftContent = readDraftContent(rev.content);
        const allLines = await loadOrMaterialiseBomLines(
          tx,
          {
            id: rev.id,
            organizationId: rev.organization_id,
            audience: rev.audience,
            catalogReleaseId: rev.catalog_release_id,
            content: draftContent,
            contentHash: rev.content_hash ?? computeDraftHash(draftContent, null),
          },
          opts.newId,
        );

        const start = offsetOf(pageReq);
        const slice = allLines
          .slice(start, start + pageReq.pageSize)
          .map(toBomLineInternalDTO);
        return {
          kind: 'ok' as const,
          page: paginate(slice, pageReq, allLines.length),
        };
      },
    );

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(principal, 'bom.read', revisionId, 'revision not found');
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(BOM_PAGE_SCHEMA, outcome.page);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 17. POST /api/internal/v1/submissions/:id/derive (T-14e, E-04, AC-14)
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/submissions/:id/derive', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const submissionId = (params.id ?? '').trim();
    if (!isUuid(submissionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'submission id must be a UUID'));
    }

    const parsed = parseBody(DERIVE_BODY, request.body ?? {});
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const idempotencyKey = readIdempotencyKey(request);
    if (idempotencyKey === null) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'Idempotency-Key header is required'));
    }

    const staffTenant: TenantContext = {
      organizationId: principal.organizationId,
      actorType: 'staff',
    };

    const sourceLookup = await withTenant(staffTenant, async (tx) => {
      const res = await tx.query<{
        submission_id: string;
        organization_id: string;
        revision_id: string;
        project_id: string;
        catalog_release_id: string;
        rule_pack_release_id: string;
        content: unknown;
        content_hash: string | null;
      }>(
        `SELECT s.id AS submission_id,
                s.organization_id,
                s.revision_id,
                r.project_id,
                r.catalog_release_id,
                r.rule_pack_release_id,
                r.content,
                r.content_hash
           FROM app.submission s
           JOIN app.revision r
             ON r.id = s.revision_id
            AND r.organization_id = s.organization_id
          WHERE s.id = $1`,
        [submissionId],
      );
      const row = res.rows[0];
      if (row === undefined) return null;

      const waiverRes = await tx.query<{ rule_id: string }>(
        `SELECT d.rule_id
           FROM app.finding f
           JOIN app.finding_internal_detail d
             ON d.finding_id = f.id
            AND d.organization_id = f.organization_id
          WHERE f.organization_id = $1
            AND f.revision_id = $2
            AND d.waived_by IS NOT NULL`,
        [row.organization_id, row.revision_id],
      );

      return {
        ...row,
        waivers: waiverRes.rows.map((w) => w.rule_id),
      };
    });

    if (sourceLookup === null) {
      await recordObjectDeny(
        principal,
        'revision.derive_internal',
        submissionId,
        'submission not found',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const subjectTenant: TenantContext = {
      organizationId: sourceLookup.organization_id,
      actorType: 'staff',
    };
    const atDate = opts.now();
    const atIso = atDate.toISOString();

    const claim = await claimIdempotencyKey(subjectTenant, {
      id: opts.newId(),
      organizationId: sourceLookup.organization_id,
      key: idempotencyKey,
      intent: 'derive',
      body: { submission_id: submissionId, ...parsed.body },
      now: atDate,
      leaseMs: claimLeaseMs(opts.env),
    });

    if (claim.status === 'settled') {
      const existing = await withTenant(subjectTenant, (tx) =>
        tx.query<{
          id: string;
          organization_id: string;
          project_id: string;
          revision_code: string;
          iteration: number;
          audience: 'client' | 'internal';
          lifecycle_state: 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';
          content_hash: string | null;
          derived_from_revision_id: string | null;
          created_at: Date | string;
        }>(
          `SELECT id, organization_id, project_id, revision_code, iteration, audience,
                  lifecycle_state, content_hash, derived_from_revision_id, created_at
             FROM app.revision
            WHERE id = $1
              AND organization_id = $2
              AND audience = 'internal'`,
          [claim.resultRef, sourceLookup.organization_id],
        ),
      );
      const row = existing.rows[0]!;
      const dto = toRevisionInternalDTO({
        id: row.id,
        organization_id: row.organization_id,
        project_id: row.project_id,
        code: row.revision_code,
        iteration: row.iteration,
        audience: row.audience,
        lifecycle_state: row.lifecycle_state,
        content_hash: row.content_hash,
        derived_from_revision_id: row.derived_from_revision_id,
        created_at: toIso(row.created_at),
      });
      const checked = guard.check(INTERNAL_SCHEMAS.Revision, dto);
      return reply.code(201).send(checked);
    }

    if (claim.status !== 'claimed') {
      const code = errorCodeFor(claim.status)!;
      return reply
        .code(statusFor(code))
        .send(errorEnvelope(code, `idempotency key ${claim.status}`));
    }

    const draftContent = readDraftContent(sourceLookup.content);
    const sourceContentHash =
      sourceLookup.content_hash ?? computeDraftHash(draftContent, null);
    const newRevisionId = opts.newId();
    const derivedSpec = deriveInternalRevision(
      {
        submissionId: sourceLookup.submission_id,
        revisionId: sourceLookup.revision_id,
        contentHash: sourceContentHash,
        waivers: sourceLookup.waivers,
      },
      newRevisionId,
    );

    const derivedDto = await withTenant(subjectTenant, async (tx) => {
      const seqRes = await tx.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt
           FROM app.revision
          WHERE organization_id = $1
            AND project_id = $2
            AND audience = 'internal'`,
        [sourceLookup.organization_id, sourceLookup.project_id],
      );
      const nextNum = (seqRes.rows[0]?.cnt ?? 0) + 1;
      const nextCode = `${derivedSpec.derived.code}${String(nextNum).padStart(2, '0')}`;

      const inserted = await tx.query<{
        id: string;
        organization_id: string;
        project_id: string;
        revision_code: string;
        iteration: number;
        audience: 'client' | 'internal';
        lifecycle_state: 'DRAFT' | 'FROZEN' | 'SUPERSEDED' | 'WITHDRAWN';
        content_hash: string | null;
        derived_from_revision_id: string | null;
        created_at: Date | string;
      }>(
        `INSERT INTO app.revision
           (id, organization_id, project_id, revision_code, iteration, lifecycle_state,
            audience, parent_revision_id, derived_from_revision_id,
            catalog_release_id, rule_pack_release_id, content, content_hash, created_by)
         VALUES ($1, $2, $3, $4, 1, 'DRAFT', 'internal', NULL, $5, $6, $7, $8::jsonb, NULL, $9)
         RETURNING id, organization_id, project_id, revision_code, iteration, audience,
                   lifecycle_state, content_hash, derived_from_revision_id, created_at`,
        [
          derivedSpec.derived.id,
          sourceLookup.organization_id,
          sourceLookup.project_id,
          nextCode,
          derivedSpec.derived.derivedFromRevisionId,
          sourceLookup.catalog_release_id,
          sourceLookup.rule_pack_release_id,
          JSON.stringify(draftContent),
          principal.userId,
        ],
      );
      const row = inserted.rows[0]!;

      await persistInternalDerivedArtifacts(
        tx,
        {
          organizationId: sourceLookup.organization_id,
          revisionId: row.id,
          catalogReleaseId: sourceLookup.catalog_release_id,
          rulePackReleaseId: sourceLookup.rule_pack_release_id,
          content: draftContent,
          revisionHash: sourceContentHash,
        },
        opts.newId,
      );

      await appendAuditEvent(tx, {
        eventId: opts.newId(),
        recordedAt: atIso,
        content: {
          occurredAt: atIso,
          actorUserId: principal.userId,
          actorType: principal.actorType,
          actorOrganizationId: principal.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: sourceLookup.organization_id,
          action: 'revision.derive_internal',
          resourceType: 'revision',
          resourceId: row.id,
          outcome: 'success',
          reasons: [
            `submission:${sourceLookup.submission_id}`,
            `derived_from:${sourceLookup.revision_id}`,
            `code:${row.revision_code}`,
          ],
        },
      });

      return toRevisionInternalDTO({
        id: row.id,
        organization_id: row.organization_id,
        project_id: row.project_id,
        code: row.revision_code,
        iteration: row.iteration,
        audience: row.audience,
        lifecycle_state: row.lifecycle_state,
        content_hash: row.content_hash,
        derived_from_revision_id: row.derived_from_revision_id,
        created_at: toIso(row.created_at),
      });
    });

    await settleIdempotencyKey(subjectTenant, {
      id: claim.id,
      epoch: claim.epoch,
      outcome: 'succeeded',
      resultRef: derivedDto.id,
      now: atDate,
    });

    const checked = guard.check(INTERNAL_SCHEMAS.Revision, derivedDto);
    return reply.code(201).send(checked);
  });

  // -------------------------------------------------------------------------
  // 18. POST /api/internal/v1/revisions/:id/notes (T-14e, E-05)
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/revisions/:id/notes', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const revisionId = (params.id ?? '').trim();
    if (!isUuid(revisionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'revision id must be a UUID'));
    }

    const parsed = parseBody(CREATE_NOTE_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const bodyText = (parsed.body['body'] as string).trim();
    const explicitSubmissionId =
      typeof parsed.body['submission_id'] === 'string'
        ? parsed.body['submission_id'].trim()
        : undefined;
    if (bodyText.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'note body must not be empty'));
    }
    if (explicitSubmissionId !== undefined && !isUuid(explicitSubmissionId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'submission_id must be a UUID'));
    }

    const atDate = opts.now();
    const atIso = atDate.toISOString();

    const outcome = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      async (tx) => {
        const revRes = await tx.query<{
          id: string;
          organization_id: string;
          derived_from_revision_id: string | null;
        }>(
          `SELECT id, organization_id, derived_from_revision_id
             FROM app.revision
            WHERE id = $1`,
          [revisionId],
        );
        const rev = revRes.rows[0];
        if (rev === undefined) {
          return { kind: 'not_found' as const };
        }

        const subRes = await tx.query<{ id: string }>(
          `SELECT id
             FROM app.submission
            WHERE organization_id = $1
              AND (revision_id = $2 OR revision_id = $3)
            ORDER BY submitted_at DESC
            LIMIT 1`,
          [rev.organization_id, rev.id, rev.derived_from_revision_id ?? rev.id],
        );
        const resolvedSubmissionId =
          explicitSubmissionId ?? subRes.rows[0]?.id ?? rev.id;

        const noteId = opts.newId();
        const noteModel = internalNote({
          id: noteId,
          submissionId: resolvedSubmissionId,
          authorId: principal.userId,
          body: bodyText,
          createdAt: atIso,
        });

        await tx.query(
          `INSERT INTO app.internal_note
             (id, organization_id, revision_id, author_id, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            noteModel.id,
            rev.organization_id,
            rev.id,
            noteModel.authorId,
            noteModel.body,
            atDate,
          ],
        );

        await appendAuditEvent(tx, {
          eventId: opts.newId(),
          recordedAt: atIso,
          content: {
            occurredAt: atIso,
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: rev.organization_id,
            action: 'note.create',
            resourceType: 'internal_note',
            resourceId: noteModel.id,
            outcome: 'success',
            reasons: [`revision:${rev.id}`],
          },
        });

        const dto = toInternalNoteDTO({ ...noteModel });
        return { kind: 'ok' as const, dto };
      },
    );

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(principal, 'note.create', revisionId, 'revision not found');
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }

    const checked = guard.check(INTERNAL_SCHEMAS.InternalNote, outcome.dto);
    return reply.code(201).send(checked);
  });

  // -------------------------------------------------------------------------
  // 19. POST /api/internal/v1/catalog/releases/:id/approve (T-14e, T-04)
  // -------------------------------------------------------------------------
  app.post('/api/internal/v1/catalog/releases/:id/approve', async (request, reply) => {
    const principal = request.principal!;
    const params = request.params as { id?: string };
    const releaseId = (params.id ?? '').trim();
    if (!isUuid(releaseId)) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'catalog release id must be a UUID'));
    }

    const parsed = parseBody(APPROVE_CATALOG_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const bodyReauth = parsed.body['reauthenticated'] as boolean | undefined;
    const isReauthenticated =
      bodyReauth === true ||
      (bodyReauth !== false && principal.reauthenticatedAt !== undefined);
    if (!isReauthenticated) {
      await recordObjectDeny(
        principal,
        'catalog.approve',
        releaseId,
        're-authentication is required to approve a catalog release',
      );
      return reply
        .code(statusFor('UNAUTHENTICATED'))
        .send(
          errorEnvelope(
            'UNAUTHENTICATED',
            're-authentication is required to approve a catalog release',
          ),
        );
    }

    const approver =
      typeof parsed.body['approver'] === 'string' && parsed.body['approver'].trim().length > 0
        ? parsed.body['approver'].trim()
        : principal.userId;

    const rawPaths = parsed.body['verification_paths'] as readonly {
      dataset: string;
      kind: 'full_cross_check' | 'two_path_reconciliation';
      cells: number;
      note: string;
    }[];
    const verificationPaths: readonly DatasetVerificationPath[] = rawPaths.map((p) => ({
      dataset: p.dataset,
      kind: p.kind,
      cells: p.cells,
      note: p.note,
    }));

    const rawChecks = parsed.body['human_spot_checks'] as readonly {
      dataset: string;
      cells: number;
      sampled_cells: readonly string[];
      supplementary_cells?: readonly string[];
      seed: number;
      page: string;
      checker?: string;
      result: string;
    }[];

    const rawDatasetCells = parsed.body['dataset_cells'] as readonly {
      dataset: string;
      cell_ids: readonly string[];
    }[];
    const datasetCells = new Map<string, readonly string[]>();
    for (const entry of rawDatasetCells) {
      datasetCells.set(entry.dataset, [...entry.cell_ids]);
    }

    const datasets =
      Array.isArray(parsed.body['datasets'])
        ? (parsed.body['datasets'] as readonly string[])
        : (['beams', 'frames'] as const);
    const correctedBy =
      typeof parsed.body['superseding_rev'] === 'string' ? parsed.body['superseding_rev'] : null;
    const quarantineReason =
      typeof parsed.body['quarantine_reason'] === 'string'
        ? parsed.body['quarantine_reason']
        : null;

    const atIso = nowIso();
    const outcome = await withTenant(
      { organizationId: principal.organizationId, actorType: 'staff' },
      async (tx) => {
        const relRes = await tx.query<{
          id: string;
          manufacturer: string;
          rev: string;
          status: ReleaseStatus;
          source_document: string;
          page_ref: string | null;
          digitised_by: string;
          digitised_at: Date | string;
          approved_by: string | null;
          approved_at: Date | string | null;
          content_sha256: string;
        }>(
          `SELECT id, manufacturer, rev, status::text AS status,
                  source_document, page_ref, digitised_by, digitised_at,
                  approved_by, approved_at, content_sha256
             FROM app.catalog_release
            WHERE id = $1`,
          [releaseId],
        );
        const rel = relRes.rows[0];
        if (rel === undefined) {
          return { kind: 'not_found' as const };
        }

        const humanSpotChecks: readonly HumanSpotCheck[] = rawChecks.map((c) => ({
          dataset: c.dataset,
          cells: c.cells,
          sampledCells: [...c.sampled_cells],
          supplementaryCells: [...(c.supplementary_cells ?? [])],
          seed: c.seed,
          sourceDocument: rel.source_document,
          pageRef: c.page,
          checkedBy: c.checker ?? approver,
          checkedAt: atIso,
          outcome: c.result,
        }));

        const effectiveStatus: ReleaseStatus =
          quarantineReason !== null ? 'QUARANTINED' : rel.status;

        const manifest: CatalogReleaseManifest = {
          manufacturer: rel.manufacturer,
          rev: rel.rev,
          status: effectiveStatus,
          sourceDocument: rel.source_document,
          sourceUrl: null,
          pageRef: rel.page_ref,
          units: 'imperial',
          loadBasis: 'UDL',
          deflectionLimit: 'L/180',
          codeBasis: 'ANSI/RMI MH16.1-2021',
          digitisedBy: rel.digitised_by,
          digitisedAt: toIso(rel.digitised_at),
          approvedBy: rel.approved_by,
          approvedAt: rel.approved_at === null ? null : toIso(rel.approved_at),
          verificationPaths,
          humanSpotChecks,
          correctedBy,
          quarantineReason,
          datasets,
          contentSha256: rel.content_sha256,
          sourceAnomalies: [],
          constraints: {},
        };

        let approved: CatalogReleaseManifest;
        try {
          approved = approveRelease(manifest, approver, atIso, datasetCells);
        } catch (err) {
          if (err instanceof ApprovalGateError) {
            await appendAuditEvent(tx, {
              eventId: opts.newId(),
              recordedAt: atIso,
              content: {
                occurredAt: atIso,
                actorUserId: principal.userId,
                actorType: principal.actorType,
                actorOrganizationId: principal.organizationId,
                impersonatedBy: null,
                subjectOrganizationId: principal.organizationId,
                action: 'catalog.approve',
                resourceType: 'catalog_release',
                resourceId: releaseId,
                outcome: 'denied',
                reasons: [...err.reasons],
              },
            });
            return {
              kind: 'refused' as const,
              message: err.message,
              reasons: [...err.reasons],
            };
          }
          throw err;
        }

        await tx.query(
          `UPDATE app.catalog_release
              SET status = 'APPROVED',
                  approved_by = $2,
                  approved_at = $3,
                  verification_path = $4
            WHERE id = $1`,
          [
            releaseId,
            approved.approvedBy,
            approved.approvedAt,
            JSON.stringify(approved.verificationPaths),
          ],
        );

        await appendAuditEvent(tx, {
          eventId: opts.newId(),
          recordedAt: atIso,
          content: {
            occurredAt: atIso,
            actorUserId: principal.userId,
            actorType: principal.actorType,
            actorOrganizationId: principal.organizationId,
            impersonatedBy: null,
            subjectOrganizationId: principal.organizationId,
            action: 'catalog.approve',
            resourceType: 'catalog_release',
            resourceId: releaseId,
            outcome: 'success',
            reasons: [`approver:${approver}`, `rev:${rel.rev}`],
          },
        });

        const dto = toCatalogReleaseInternalDTO({
          id: rel.id,
          manufacturer: rel.manufacturer,
          rev: rel.rev,
          status: approved.status,
          sourceDocument: rel.source_document,
          digitisedBy: rel.digitised_by,
          digitisedAt: toIso(rel.digitised_at),
          approvedBy: approved.approvedBy,
          approvedAt: approved.approvedAt,
          contentSha256: rel.content_sha256,
          datasets: approved.datasets,
        });
        return { kind: 'ok' as const, dto };
      },
    );

    if (outcome.kind === 'not_found') {
      await recordObjectDeny(
        principal,
        'catalog.approve',
        releaseId,
        'catalog release not found',
      );
      return reply.code(statusFor('NOT_FOUND')).send(notFound());
    }
    if (outcome.kind === 'refused') {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(
          errorEnvelope('UNPROCESSABLE', outcome.message, {
            reasons: outcome.reasons,
          }),
        );
    }

    const checked = guard.check(INTERNAL_SCHEMAS.CatalogRelease, outcome.dto);
    return reply.code(200).send(checked);
  });

  // -------------------------------------------------------------------------
  // 26. POST /api/client/v1/intake — spec-sheet extraction (`store: false`)
  // -------------------------------------------------------------------------
  app.post('/api/client/v1/intake', async (request, reply) => {
    const parsed = parseBody(INTAKE_EXTRACT_BODY, request.body);
    if (!parsed.ok) {
      return reply.code(statusFor('VALIDATION_ERROR')).send(parsed.error);
    }

    const documentKind = parsed.body['document_kind'] as IntakeDocumentKind;
    const fileName = (parsed.body['file_name'] as string).trim();
    const mimeType = parsed.body['mime_type'] as string;
    const base64Data = (parsed.body['data_base64'] as string).trim();

    if (fileName.length === 0 || base64Data.length === 0) {
      return reply
        .code(statusFor('VALIDATION_ERROR'))
        .send(errorEnvelope('VALIDATION_ERROR', 'file_name and data_base64 must not be empty'));
    }

    const result = await extractSpecSheetViaGemini(
      { documentKind, fileName, mimeType, base64Data },
      opts.env ?? process.env,
      opts.geminiClient,
    );
    if (!result.ok) {
      return reply
        .code(statusFor('UNPROCESSABLE'))
        .send(errorEnvelope('UNPROCESSABLE', result.reason));
    }

    const dto = toIntakeExtractionClientDTO({
      file_name: fileName,
      extraction: result.payload,
    });
    const checked = guard.check(CLIENT_SCHEMAS.IntakeExtraction, dto);
    return reply.code(200).send(checked);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers for T-14e & P-02
// ---------------------------------------------------------------------------

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Paginated internal queue query (T-14e + P-02).
 *
 * Strictly O(1) SQL statements (1 count query + 1 page query with `LIMIT $1 OFFSET $2`).
 * Findings are aggregated ONLY for the `pageSize` submissions on the requested
 * page via the `page_sub` CTE, using `finding_org_revision_idx`, never across
 * the whole table and never via per-row N+1 queries.
 */
export async function queryInternalQueuePage(
  tx: TenantTransaction,
  pageReq: { readonly page: number; readonly pageSize: number },
  statusFilter?: SubmittedStatus | undefined,
): Promise<ReturnType<typeof paginate<QueueEntryInternalDTO>>> {
  const countRes =
    statusFilter === undefined
      ? await tx.query<{ total: number }>(
          `SELECT count(*)::int AS total
             FROM app.submission s
            WHERE s.audience = 'client'`,
        )
      : await tx.query<{ total: number }>(
          `SELECT count(*)::int AS total
             FROM app.submission s
            WHERE s.audience = 'client'
              AND s.request_status = $1::app.request_status`,
          [statusFilter],
        );
  const totalItems = countRes.rows[0]?.total ?? 0;

  const limit = pageReq.pageSize;
  const offset = offsetOf(pageReq);

  const pageSql =
    statusFilter === undefined
      ? `WITH page_sub AS (
           SELECT s.id AS submission_id,
                  s.organization_id,
                  s.revision_id,
                  s.request_status::text AS status,
                  s.submitted_at,
                  s.acknowledged_at,
                  s.quoted_at
             FROM app.submission s
            WHERE s.audience = 'client'
            ORDER BY s.submitted_at DESC, s.id ASC
            LIMIT $1 OFFSET $2
         ),
         finding_counts AS (
           SELECT f.organization_id,
                  f.revision_id,
                  count(*) FILTER (WHERE f.severity = 'BLOCKER')::int AS blocker_count,
                  count(*) FILTER (WHERE f.severity = 'ENGINEERING_REVIEW_REQUIRED')::int AS review_count
             FROM app.finding f
             JOIN page_sub ps
               ON ps.organization_id = f.organization_id
              AND ps.revision_id = f.revision_id
            GROUP BY f.organization_id, f.revision_id
         )
         SELECT ps.submission_id,
                ps.organization_id,
                o.name AS organization_name,
                p.number AS project_number,
                ps.status,
                ps.submitted_at,
                ps.acknowledged_at,
                ps.quoted_at,
                COALESCE(fc.blocker_count, 0) AS blocker_count,
                COALESCE(fc.review_count, 0) AS review_count
           FROM page_sub ps
           JOIN app.organization o
             ON o.id = ps.organization_id
           JOIN app.revision r
             ON r.id = ps.revision_id
            AND r.organization_id = ps.organization_id
           JOIN app.project p
             ON p.id = r.project_id
            AND p.organization_id = ps.organization_id
           LEFT JOIN finding_counts fc
             ON fc.organization_id = ps.organization_id
            AND fc.revision_id = ps.revision_id
          ORDER BY ps.submitted_at DESC, ps.submission_id ASC`
      : `WITH page_sub AS (
           SELECT s.id AS submission_id,
                  s.organization_id,
                  s.revision_id,
                  s.request_status::text AS status,
                  s.submitted_at,
                  s.acknowledged_at,
                  s.quoted_at
             FROM app.submission s
            WHERE s.audience = 'client'
              AND s.request_status = $3::app.request_status
            ORDER BY s.submitted_at DESC, s.id ASC
            LIMIT $1 OFFSET $2
         ),
         finding_counts AS (
           SELECT f.organization_id,
                  f.revision_id,
                  count(*) FILTER (WHERE f.severity = 'BLOCKER')::int AS blocker_count,
                  count(*) FILTER (WHERE f.severity = 'ENGINEERING_REVIEW_REQUIRED')::int AS review_count
             FROM app.finding f
             JOIN page_sub ps
               ON ps.organization_id = f.organization_id
              AND ps.revision_id = f.revision_id
            GROUP BY f.organization_id, f.revision_id
         )
         SELECT ps.submission_id,
                ps.organization_id,
                o.name AS organization_name,
                p.number AS project_number,
                ps.status,
                ps.submitted_at,
                ps.acknowledged_at,
                ps.quoted_at,
                COALESCE(fc.blocker_count, 0) AS blocker_count,
                COALESCE(fc.review_count, 0) AS review_count
           FROM page_sub ps
           JOIN app.organization o
             ON o.id = ps.organization_id
           JOIN app.revision r
             ON r.id = ps.revision_id
            AND r.organization_id = ps.organization_id
           JOIN app.project p
             ON p.id = r.project_id
            AND p.organization_id = ps.organization_id
           LEFT JOIN finding_counts fc
             ON fc.organization_id = ps.organization_id
            AND fc.revision_id = ps.revision_id
          ORDER BY ps.submitted_at DESC, ps.submission_id ASC`;

  const rowsRes = await tx.query<{
    submission_id: string;
    organization_id: string;
    organization_name: string;
    project_number: string;
    status: SubmittedStatus;
    submitted_at: Date | string;
    acknowledged_at: Date | string | null;
    quoted_at: Date | string | null;
    blocker_count: number;
    review_count: number;
  }>(
    pageSql,
    statusFilter === undefined ? [limit, offset] : [limit, offset, statusFilter],
  );

  const items = rowsRes.rows.map((r) =>
    toQueueEntryInternalDTO({
      submissionId: r.submission_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      projectNumber: r.project_number,
      status: r.status,
      submittedAt: toIso(r.submitted_at),
      acknowledgedAt: r.acknowledged_at === null ? null : toIso(r.acknowledged_at),
      quotedAt: r.quoted_at === null ? null : toIso(r.quoted_at),
      blockerCount: r.blocker_count,
      reviewCount: r.review_count,
    }),
  );

  return paginate(items, pageReq, totalItems);
}

interface InternalRuleMeta {
  readonly rule_id: string;
  readonly citation: string;
  readonly standard: string;
  readonly edition: string;
  readonly section: string;
  readonly verification_tier: string;
}

function internalRuleMetaFor(code: string): InternalRuleMeta {
  switch (code) {
    case 'AISLE_CLEAR_SHORTFALL':
    case 'AISLE_CLEAR_OK':
      return {
        rule_id: 'RULE-AISLE-CLEAR-01',
        citation: 'ANSI/RMI MH16.1-2021 §4.2 — Operating Aisle Clearance',
        standard: 'ANSI/RMI MH16.1',
        edition: '2021',
        section: '4.2',
        verification_tier: 'ESTABLISHED',
      };
    case 'CLEAR_HEIGHT_EXCEEDED':
      return {
        rule_id: 'RULE-CLEAR-HEIGHT-01',
        citation: 'ANSI/RMI MH16.1-2021 §5.1 — Top-of-Load Vertical Clearance',
        standard: 'ANSI/RMI MH16.1',
        edition: '2021',
        section: '5.1',
        verification_tier: 'ESTABLISHED',
      };
    case 'COLUMN_IN_AISLE':
      return {
        rule_id: 'RULE-COLUMN-GRID-01',
        citation: 'ANSI/RMI MH16.1-2021 §6.3 — Building Column Obstruction Review',
        standard: 'ANSI/RMI MH16.1',
        edition: '2021',
        section: '6.3',
        verification_tier: 'ENGINEERING_REVIEW',
      };
    case 'FORKLIFT_CLEARANCE_ASSUMED':
      return {
        rule_id: 'RULE-ASSUMPTION-AISLE-01',
        citation: 'RMS Planning Standard §2.1 — Default Aisle Clearance Assumption',
        standard: 'RMS Planning Standard',
        edition: '2026',
        section: '2.1',
        verification_tier: 'ASSUMPTION',
      };
    default:
      return {
        rule_id: 'RULE-ASSUMPTION-OVERHANG-01',
        citation: 'RMS Planning Standard §2.2 — Default Pallet Overhang Assumption',
        standard: 'RMS Planning Standard',
        edition: '2026',
        section: '2.2',
        verification_tier: 'ASSUMPTION',
      };
  }
}

async function loadInternalFindingsForRevision(
  tx: TenantTransaction,
  organizationId: string,
  revisionId: string,
  rulePackReleaseId: string,
  content: RevisionDraftContent,
) {
  const activeOption =
    content.options?.find((o) => o.option_id === content.active_option_id) ??
    content.options?.[0];
  const derivedAssumptions = collectDraftAssumptions(content, new Map());
  const optionDerived =
    activeOption !== undefined
      ? deriveOption(content, activeOption, derivedAssumptions)
      : null;
  const paramsByCode = new Map<string, readonly FindingParameterEntity[]>();
  for (const f of optionDerived?.findings ?? []) {
    paramsByCode.set(f.code, f.parameters);
  }

  const res = await tx.query<{
    id: string;
    code: string;
    severity: string;
    subject_object_ids: string[];
    closed_by: string;
    detail_finding_id: string | null;
    rule_id: string | null;
    citation: string | null;
    verification_tier: string | null;
    waived_by: string | null;
    waived_at: Date | string | null;
    waiver_reason: string | null;
  }>(
    `SELECT f.id, f.code, f.severity::text AS severity, f.subject_object_ids, f.closed_by,
            d.finding_id AS detail_finding_id, d.rule_id, d.citation, d.verification_tier,
            d.waived_by, d.waived_at, d.waiver_reason
       FROM app.finding f
       LEFT JOIN app.finding_internal_detail d
         ON d.finding_id = f.id
        AND d.organization_id = f.organization_id
      WHERE f.organization_id = $1
        AND f.revision_id = $2
      ORDER BY f.code ASC, f.id ASC`,
    [organizationId, revisionId],
  );

  const out = [];
  for (const row of res.rows) {
    const meta = internalRuleMetaFor(row.code);
    const ruleId = row.rule_id ?? meta.rule_id;
    const citation = row.citation ?? meta.citation;
    const tier = row.verification_tier ?? meta.verification_tier;

    if (row.detail_finding_id === null) {
      await tx.query(
        `INSERT INTO app.finding_internal_detail
           (finding_id, organization_id, rule_id, rule_pack_release_id, citation, verification_tier)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (finding_id) DO NOTHING`,
        [row.id, organizationId, ruleId, rulePackReleaseId, citation, tier],
      );
    }

    out.push({
      code: row.code,
      severity: row.severity,
      closed_by: row.closed_by,
      subject_object_ids: row.subject_object_ids,
      parameters: paramsByCode.get(row.code) ?? [],
      rule_id: ruleId,
      citation,
      standard: meta.standard,
      edition: meta.edition,
      section: meta.section,
      verification_tier: tier,
      waived_by: row.waived_by,
      waived_at: row.waived_at === null ? null : toIso(row.waived_at),
      waiver_reason: row.waiver_reason,
    });
  }
  return out;
}

async function ensureCatalogPartRefs(
  tx: TenantTransaction,
  organizationId: string,
  revisionId: string,
  audience: 'client' | 'internal',
  catalogReleaseId: string,
  newId: () => string,
): Promise<{
  readonly frameRef: PartRef;
  readonly beamRef: PartRef;
  readonly anchorRef: PartRef;
  readonly deckRef: PartRef;
  readonly spacerRef: PartRef;
  readonly footplateRef: PartRef;
  readonly mpnByPartRevisionId: ReadonlyMap<string, string>;
}> {
  const mpnMap = new Map<string, string>();

  const ensureCatalogPartRevision = async (
    code18: string,
    partNumber: string,
  ): Promise<PartRef> => {
    const partId = newId();
    await tx.query(
      `INSERT INTO app.part (id, manufacturer, code_18)
       VALUES ($1, 'Interlake Mecalux', $2)
       ON CONFLICT (manufacturer, code_18) DO NOTHING`,
      [partId, code18],
    );
    const prRes = await tx.query<{ id: string; part_number: string }>(
      `INSERT INTO app.part_revision
         (id, part_id, catalog_release_id, part_number, published_row)
       SELECT $1, p.id, $2, $3, $4::jsonb
         FROM app.part p
        WHERE p.manufacturer = 'Interlake Mecalux' AND p.code_18 = $5
       ON CONFLICT (part_id, catalog_release_id) DO UPDATE
         SET part_number = app.part_revision.part_number
       RETURNING id, part_number`,
      [
        newId(),
        catalogReleaseId,
        partNumber,
        JSON.stringify({ code_18: code18, part_number: partNumber }),
        code18,
      ],
    );
    const row = prRes.rows[0]!;
    mpnMap.set(row.id, row.part_number);
    return { kind: 'catalog', partRevisionId: row.id };
  };

  const ensureUncataloguedPart = async (
    kind: string,
    measuredGeometry: string,
  ): Promise<PartRef> => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id
         FROM app.uncatalogued_part
        WHERE organization_id = $1
          AND revision_id = $2
          AND kind = $3
        ORDER BY id ASC
        LIMIT 1`,
      [organizationId, revisionId, kind],
    );
    const existingId = existing.rows[0]?.id;
    if (existingId !== undefined) {
      return {
        kind: 'uncatalogued',
        uncataloguedPartId: existingId,
        measuredGeometry,
      };
    }
    const id = newId();
    await tx.query(
      `INSERT INTO app.uncatalogued_part
         (id, organization_id, revision_id, audience, kind, measured_geometry, source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'CLIENT_EXISTING')`,
      [id, organizationId, revisionId, audience, kind, JSON.stringify({ spec: measuredGeometry })],
    );
    return {
      kind: 'uncatalogued',
      uncataloguedPartId: id,
      measuredGeometry,
    };
  };

  const frameRef = await ensureCatalogPartRevision('UF3042144000000001', 'UF-3042-144');
  const beamRef = await ensureCatalogPartRevision('BM4096040000000001', 'BM-4096-40');
  const anchorRef = await ensureCatalogPartRevision('WA0500425000000001', 'WA-0500-425');
  const deckRef = await ensureUncataloguedPart('DECK', '42in x 46in wire mesh deck');
  const spacerRef = await ensureUncataloguedPart('SPACER', '12in row spacer');
  const footplateRef = await ensureUncataloguedPart('FOOTPLATE', 'standard 5x5 baseplate');

  return {
    frameRef,
    beamRef,
    anchorRef,
    deckRef,
    spacerRef,
    footplateRef,
    mpnByPartRevisionId: mpnMap,
  };
}

async function loadOrMaterialiseBomLines(
  tx: TenantTransaction,
  rev: {
    readonly id: string;
    readonly organizationId: string;
    readonly audience: 'client' | 'internal';
    readonly catalogReleaseId: string;
    readonly content: RevisionDraftContent;
    readonly contentHash: string;
  },
  newId: () => string,
) {
  const existing = await tx.query<{
    category: string;
    part_revision_id: string | null;
    uncatalogued_part_id: string | null;
    qty: number | null;
    uom: string;
    rule_text: string;
    rule_id: string | null;
    confirmed: boolean;
    source_object_ids: string[];
    unresolved_reason: string | null;
    part_number: string | null;
    measured_geometry: unknown;
  }>(
    `SELECT b.category, b.part_revision_id, b.uncatalogued_part_id,
            b.qty, b.uom, b.rule_text, b.rule_id, b.confirmed,
            b.source_object_ids, b.unresolved_reason,
            pr.part_number,
            up.measured_geometry
       FROM app.bom_line b
       LEFT JOIN app.part_revision pr ON pr.id = b.part_revision_id
       LEFT JOIN app.uncatalogued_part up
         ON up.id = b.uncatalogued_part_id
        AND up.organization_id = b.organization_id
      WHERE b.organization_id = $1
        AND b.revision_id = $2
      ORDER BY array_position(ARRAY['FRAME','BEAM','ANCHOR','DECK','SPACER','FOOTPLATE']::text[], b.category) ASC, b.id ASC`,
    [rev.organizationId, rev.id],
  );

  if (existing.rows.length > 0) {
    return existing.rows.map((r) => {
      const partRef =
        r.part_revision_id !== null
          ? ({ kind: 'catalog' as const, partRevisionId: r.part_revision_id })
          : ({
              kind: 'uncatalogued' as const,
              uncataloguedPartId: r.uncatalogued_part_id!,
              measuredGeometry:
                typeof (r.measured_geometry as { spec?: unknown } | null)?.spec === 'string'
                  ? ((r.measured_geometry as { spec: string }).spec)
                  : JSON.stringify(r.measured_geometry ?? {}),
            });
      const resolved = r.qty !== null;
      return {
        category: r.category,
        partRef,
        mpn: r.part_revision_id !== null ? r.part_number : null,
        uom: r.uom,
        ruleText: r.rule_text,
        ruleId: r.rule_id,
        confirmed: r.confirmed,
        sourceObjectIds: r.source_object_ids,
        resolved,
        qty: resolved ? { value: r.qty!, unit: r.uom.toLowerCase() } : null,
        unresolvedReason: r.unresolved_reason,
      };
    });
  }

  const activeOption =
    rev.content.options?.find((o) => o.option_id === rev.content.active_option_id) ??
    rev.content.options?.[0];

  const refs = await ensureCatalogPartRefs(
    tx,
    rev.organizationId,
    rev.id,
    rev.audience,
    rev.catalogReleaseId,
    newId,
  );

  const runTakeoffs: RunTakeoff[] =
    activeOption !== undefined && activeOption.runs.length > 0
      ? activeOption.runs.map((run) => ({
          runId: run.run_id,
          bays: run.bays.length,
          rows: 1,
          beamLevels: run.bays.reduce((max, b) => Math.max(max, b.levels), 0),
          frameRef: refs.frameRef,
          beamRef: refs.beamRef,
          anchorRef: refs.anchorRef,
          deckRef: refs.deckRef,
          spacerRef: refs.spacerRef,
          footplateRef: refs.footplateRef,
        }))
      : [
          {
            runId: 'run-default',
            bays: 1,
            rows: 1,
            beamLevels: 2,
            frameRef: refs.frameRef,
            beamRef: refs.beamRef,
            anchorRef: refs.anchorRef,
            deckRef: refs.deckRef,
            spacerRef: refs.spacerRef,
            footplateRef: refs.footplateRef,
          },
        ];

  const derived = deriveBom(runTakeoffs);
  const out = [];
  for (const line of derived) {
    const partRevisionId =
      line.partRef.kind === 'catalog' ? line.partRef.partRevisionId : null;
    const uncataloguedPartId =
      line.partRef.kind === 'uncatalogued' ? line.partRef.uncataloguedPartId : null;
    const mpn =
      partRevisionId !== null ? (refs.mpnByPartRevisionId.get(partRevisionId) ?? null) : null;

    await tx.query(
      `INSERT INTO app.bom_line
         (id, organization_id, revision_id, category, part_revision_id, uncatalogued_part_id,
          qty, uom, rule_text, rule_id, confirmed, item_snapshot, source_object_ids,
          unresolved_reason, revision_hash, engine_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)`,
      [
        newId(),
        rev.organizationId,
        rev.id,
        line.category,
        partRevisionId,
        uncataloguedPartId,
        line.resolved ? line.qty.value : null,
        line.uom,
        line.ruleText,
        line.ruleId,
        line.confirmed,
        mpn !== null ? JSON.stringify({ mpn }) : null,
        [...line.sourceObjectIds],
        line.resolved ? null : line.unresolvedReason,
        rev.contentHash,
        ENGINE_VERSION,
      ],
    );

    out.push({
      category: line.category,
      partRef: line.partRef,
      mpn,
      uom: line.uom,
      ruleText: line.ruleText,
      ruleId: line.ruleId,
      confirmed: line.confirmed,
      sourceObjectIds: line.sourceObjectIds,
      resolved: line.resolved,
      qty: line.resolved ? { value: line.qty.value, unit: line.qty.unit } : null,
      unresolvedReason: line.resolved ? null : line.unresolvedReason,
    });
  }

  return out;
}

async function persistInternalDerivedArtifacts(
  tx: TenantTransaction,
  params: {
    readonly organizationId: string;
    readonly revisionId: string;
    readonly catalogReleaseId: string;
    readonly rulePackReleaseId: string;
    readonly content: RevisionDraftContent;
    readonly revisionHash: string;
  },
  newId: () => string,
): Promise<void> {
  const assumptions = collectDraftAssumptions(params.content, new Map());
  for (const a of assumptions) {
    await tx.query(
      `INSERT INTO app.assumption
         (id, organization_id, revision_id, audience, key, assumed_value_um,
          assumed_unit, why, scope)
       VALUES ($1, $2, $3, 'internal', $4, $5, $6, $7, $8)`,
      [
        newId(),
        params.organizationId,
        params.revisionId,
        a.key,
        a.assumedValue.value,
        a.assumedValue.unit,
        a.why,
        a.scope,
      ],
    );
  }

  const activeOption =
    params.content.options?.find((o) => o.option_id === params.content.active_option_id) ??
    params.content.options?.[0];
  const derivedFindings =
    activeOption !== undefined
      ? deriveOption(params.content, activeOption, assumptions).findings
      : [];

  for (const f of derivedFindings) {
    const dbSeverity = f.severity === 'REVIEW' ? 'ENGINEERING_REVIEW_REQUIRED' : f.severity;
    const findingId = newId();
    await tx.query(
      `INSERT INTO app.finding
         (id, organization_id, revision_id, audience, code, severity,
          subject_object_ids, closed_by, revision_hash, engine_version)
       VALUES ($1, $2, $3, 'internal', $4, $5::app.finding_severity, $6, $7, $8, $9)`,
      [
        findingId,
        params.organizationId,
        params.revisionId,
        f.code,
        dbSeverity,
        [...f.subject_object_ids],
        f.closed_by,
        params.revisionHash,
        ENGINE_VERSION,
      ],
    );

    // E-04: waivers on the source revision do NOT carry over onto a derived
    // internal revision (`waived_by = NULL, waived_at = NULL, waiver_reason = NULL`).
    const meta = internalRuleMetaFor(f.code);
    await tx.query(
      `INSERT INTO app.finding_internal_detail
         (finding_id, organization_id, rule_id, rule_pack_release_id, citation,
          verification_tier, waived_by, waived_at, waiver_reason)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL)`,
      [
        findingId,
        params.organizationId,
        meta.rule_id,
        params.rulePackReleaseId,
        meta.citation,
        meta.verification_tier,
      ],
    );
  }

  await loadOrMaterialiseBomLines(
    tx,
    {
      id: params.revisionId,
      organizationId: params.organizationId,
      audience: 'internal',
      catalogReleaseId: params.catalogReleaseId,
      content: params.content,
      contentHash: params.revisionHash,
    },
    newId,
  );
}
