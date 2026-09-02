import { describe, expect, it } from 'vitest';
import {
  OutboundLeakError,
  OutboundValidationError,
  SchemaError,
  clientResponse,
  findForbiddenFields,
  number,
  outboundGuard,
  string,
  toJsonSchema,
  validate,
  type JsonSchema,
  type OutboundReport,
  type ResponseSchema,
} from '@rms/contracts';

import {
  CLIENT_SCHEMAS,
  INTERNAL_SCHEMAS,
  REQUEST_STATUSES,
  ROUTES,
  toAssumptionClientDTO,
  toAuditEventInternalDTO,
  toBomLineInternalDTO,
  toCatalogReleaseInternalDTO,
  toComparisonClientDTO,
  toDocumentClientDTO,
  toFindingClientDTO,
  toFindingInternalDTO,
  toInternalNoteDTO,
  toInvitationClientDTO,
  toInvitationInternalDTO,
  toOrganizationInternalDTO,
  toPreviewClientDTO,
  toProjectClientDTO,
  toQueueEntryInternalDTO,
  toRevisionClientDTO,
  toRevisionInternalDTO,
  toSubmissionClientDTO,
  toSubmissionPackageInternalDTO,
} from '../index.js';

/**
 * T-13b: one DTO per (entity × audience), constructed field by field, each
 * with a closed schema the outbound guard reads. These tests are the contract
 * between the builder and its schema — every builder's output must validate
 * against the schema it is published under, or the published schema is a lie.
 */

// --------------------------------------------------------------------------
// Fixtures: entities as the database and the kernel would hand them over,
// deliberately carrying the columns a client must never see.
// --------------------------------------------------------------------------

const revisionEntity = {
  id: 'rev-1',
  code: 'P01',
  iteration: 3,
  frozen: true,
  content_hash: 'abc123',
  derived_from_revision_id: null,
  // Never on the wire to a client:
  audience: 'client',
  organization_id: 'org-a',
  lifecycle_state: 'FROZEN',
  internal_note: 'priced high',
};

const assumptionEntity = {
  key: 'load.pallet_weight',
  assumedValue: { value: 1200, unit: 'lb' },
  why: 'not stated on the intake form',
  scope: 'unit U1',
  acknowledgedBy: 'Dana',
  acknowledgedAt: '2026-09-02T10:00:00Z',
};

const findingEntity = {
  code: 'AISLE_CLEAR_SHORTFALL',
  severity: 'BLOCKER',
  closed_by: 'widen the aisle to the stated equipment requirement',
  subject_object_ids: ['aisle-2'],
  parameters: [
    { name: 'aisle clear width', established: true as const, value: { value: 3_352_800, unit: 'um' } },
    { name: 'equipment requirement', established: false as const, value: null, reason: 'no forklift model was stated' },
  ],
  rule_id: 'RULE-AISLE-01',
  citation: 'NFPA 13 §12.1',
  standard: 'NFPA 13',
  edition: '2022',
  section: '12.1',
  verification_tier: 'SECONDARY',
};

const displayList = {
  view: 'plan' as const,
  extent: { width: 24_384_000, height: 12_192_000 },
  revisionHash: 'abc123',
  items: [
    { kind: 'rect' as const, item: 'upright' as const, id: 'u1', origin: { x: 0, y: 0 }, width: 76_200, height: 1_066_800, label: null },
    { kind: 'rect' as const, item: 'beam' as const, id: 'b1', origin: { x: 0, y: 1_066_800 }, width: 2_438_400, height: 101_600, label: { text: '96 in', established: true } },
    { kind: 'line' as const, item: 'aisle' as const, id: 'a1', from: { x: 0, y: 0 }, to: { x: 0, y: 12_192_000 } },
    { kind: 'dimension' as const, item: 'annotation' as const, id: 'd1', from: { x: 0, y: 0 }, to: { x: 2_438_400, y: 0 }, text: { text: '96 in', established: true } },
    { kind: 'text' as const, item: 'annotation' as const, id: 't1', at: { x: 10, y: 10 }, text: { text: 'Run A', established: true } },
  ],
};

const previewEntity = {
  revision_id: 'rev-1',
  counts: { gross_positions: 916, lost_positions: 12, net_positions: 904 },
  dimensions: {
    aisle_clear_width: { value_um: 3_657_600, established: true },
    bay_pitch: { value_um: 2_514_600, established: true },
    run_length: { value_um: null, established: false },
  },
  assumptions: [assumptionEntity],
  findings: [findingEntity],
  views: [displayList],
  // The internal package rides in the same derivation and must not cross:
  bom: [{ mpn: 'X' }],
  capacity_case: { table: 'p.88' },
};

const submissionEntity = {
  id: 'sub-1',
  revision_id: 'rev-1',
  request_status: 'TRIAGE',
  submitted_at: '2026-09-02T10:00:00Z',
  submission_hash: 'def456',
  organization_id: 'org-a',
  internal_note: 'call before quoting',
  margin_pct: 0.31,
};

const documentEntity = {
  id: 'doc-1',
  number: 'RMS-26-0142-P01',
  revision_code: 'P01',
  status_code: 'PRELIMINARY',
  url: 'https://files.example.invalid/signed/abc',
  expires_at: '2026-09-02T10:15:00Z',
  storage_key: 'org-a/rev-1/plan.pdf',
  organization_id: 'org-a',
};

const invitationEntity = {
  id: 'inv-1',
  organization_id: 'org-a',
  email: 'colleague@example.invalid',
  role: 'client_member',
  expires_at: '2026-09-09T10:00:00Z',
  issued_by: 'staff-7',
  token: 'PLAINTEXT-TOKEN-ONLY-FOR-THE-EMAIL-LINK',
  token_hash: 'sha256',
};

const comparisonEntity = {
  revision_id: 'rev-1',
  options: [
    { optionId: 'opt-a', label: 'A — 96 in beams', bom: [{ mpn: 'X' }] },
    { optionId: 'opt-b', label: 'B — 108 in beams' },
  ],
  rows: [
    { metric: 'net_positions' as const, values: [904, 1_012], hasUnestablished: false },
    { metric: 'aisle_clear_width_in' as const, values: [144, null], hasUnestablished: true },
  ],
};

const queueEntity = {
  submissionId: 'sub-1',
  organizationId: 'org-a',
  organizationName: 'Harbor Logistics',
  projectNumber: '26-0142',
  status: 'TRIAGE' as const,
  submittedAt: '2026-09-02T10:00:00Z',
  acknowledgedAt: '2026-09-02T12:00:00Z',
  quotedAt: null,
  blockerCount: 1,
  reviewCount: 2,
};

const bomLineEntity = {
  category: 'BEAM',
  partRef: { kind: 'catalog' as const, partRevisionId: 'prv-9' },
  mpn: 'UM005516',
  uom: 'ea',
  ruleText: '2 per bay per level',
  ruleId: 'BOM-BEAM-01',
  confirmed: true,
  sourceObjectIds: ['bay-1', 'bay-2'],
  resolved: true,
  qty: { value: 312, unit: 'ea' },
  unresolvedReason: null,
};

const noteEntity = {
  id: 'note-1',
  submissionId: 'sub-1',
  authorId: 'staff-7',
  body: 'client asked for 96 in beams — confirm before quoting',
  createdAt: '2026-09-02T12:30:00Z',
  clientVisible: false as const,
};

const revisionInternalEntity = {
  id: 'rev-9',
  organization_id: 'org-a',
  project_id: 'p1',
  code: 'C01',
  iteration: 1,
  audience: 'internal' as const,
  lifecycle_state: 'DRAFT' as const,
  content_hash: null,
  derived_from_revision_id: 'rev-1',
  created_at: '2026-09-02T12:40:00Z',
};

const guard = outboundGuard({ mode: 'fail', alert: () => {} });

// --------------------------------------------------------------------------
// The client audience
// --------------------------------------------------------------------------

describe('client DTOs — built field by field, validated against their published schema', () => {
  it('a revision drops audience, organization_id, lifecycle_state and the note', () => {
    const dto = toRevisionClientDTO(revisionEntity);
    expect(dto).toEqual({
      id: 'rev-1',
      code: 'P01',
      iteration: 3,
      frozen: true,
      content_hash: 'abc123',
      derived_from_revision_id: null,
    });
    expect(validate(CLIENT_SCHEMAS.Revision, dto)).toEqual([]);
    expect(guard.check(CLIENT_SCHEMAS.Revision, dto)).toBe(dto);
  });

  it('an assumption carries the register entry and the acknowledgement, in wire case', () => {
    const dto = toAssumptionClientDTO(assumptionEntity);
    expect(dto).toEqual({
      key: 'load.pallet_weight',
      assumed_value: { value: 1200, unit: 'lb' },
      why: 'not stated on the intake form',
      scope: 'unit U1',
      acknowledged_by: 'Dana',
      acknowledged_at: '2026-09-02T10:00:00Z',
    });
    expect(validate(CLIENT_SCHEMAS.Assumption, dto)).toEqual([]);
    // Unacknowledged is null on the wire, not absent — a client can tell
    // "not yet" from "not sent".
    const open = toAssumptionClientDTO({ ...assumptionEntity, acknowledgedBy: undefined, acknowledgedAt: undefined });
    expect(open.acknowledged_by).toBeNull();
    expect(open.acknowledged_at).toBeNull();
    expect(validate(CLIENT_SCHEMAS.Assumption, open)).toEqual([]);
  });

  it('a finding is §11.3 for the client: code, severity, subjects, parameters, what closes it — never the citation, standard or tier', () => {
    const dto = toFindingClientDTO(findingEntity);
    expect(dto).toEqual({
      code: 'AISLE_CLEAR_SHORTFALL',
      severity: 'BLOCKER',
      subject_object_ids: ['aisle-2'],
      parameters: [
        { name: 'aisle clear width', established: true, value: { value: 3_352_800, unit: 'um' } },
        { name: 'equipment requirement', established: false, reason: 'no forklift model was stated' },
      ],
      closed_by: 'widen the aisle to the stated equipment requirement',
    });
    expect(validate(CLIENT_SCHEMAS.Finding, dto)).toEqual([]);
    expect(findForbiddenFields(dto)).toEqual([]);
  });

  it('a finding parameter cannot claim to be established without a value, or unestablished with one (AC-07) — in the contract, not only the builder', () => {
    const dto = toFindingClientDTO(findingEntity);
    const lying = { ...dto, parameters: [{ name: 'x', established: true, reason: 'n' }] };
    expect(validate(CLIENT_SCHEMAS.Finding, lying)[0]).toMatch(/^parameters\[0\]: matches none of 2 variants/);
    const alsoLying = { ...dto, parameters: [{ name: 'x', established: false, value: { value: 1, unit: 'um' }, reason: 'n' }] };
    expect(validate(CLIENT_SCHEMAS.Finding, alsoLying)[0]).toMatch(/^parameters\[0\]: matches none of 2 variants/);
    // A value that says "unestablished" but carries a number is refused by the
    // schema even in alert mode: the stray `value` is undeclared on the closest variant.
    const production = outboundGuard({ mode: 'alert', alert: () => {} });
    expect(() => production.check(CLIENT_SCHEMAS.Finding, alsoLying)).toThrow(OutboundLeakError);
  });

  it('a preview carries counts, dimensions, the register, client findings and watermarked views — not the BOM or the capacity case', () => {
    const dto = toPreviewClientDTO(previewEntity);
    expect(Object.keys(dto).sort()).toEqual(['assumptions', 'counts', 'dimensions', 'findings', 'revision_id', 'views']);
    expect(dto.counts).toEqual({ gross_positions: 916, lost_positions: 12, net_positions: 904 });
    expect(dto.dimensions).toEqual({
      aisle_clear_width: { value_um: 3_657_600, established: true },
      bay_pitch: { value_um: 2_514_600, established: true },
      run_length: { established: false },
    });
    expect(dto.findings).toEqual([toFindingClientDTO(findingEntity)]);
    expect(dto.assumptions).toEqual([toAssumptionClientDTO(assumptionEntity)]);
    expect(dto.views).toHaveLength(1);
    expect(dto.views[0]?.view).toBe('plan');
    expect(dto.views[0]?.watermarked).toBe(true);
    expect(dto.views[0]?.revision_hash).toBe('abc123');
    expect(dto.views[0]?.items).toEqual(displayList.items);
    expect(validate(CLIENT_SCHEMAS.Preview, dto)).toEqual([]);
    expect(findForbiddenFields(dto)).toEqual([]);
  });

  it('a dimension is established exactly when it has a value — the contradiction is refused by the builder AND by the contract (AC-07)', () => {
    expect(() =>
      toPreviewClientDTO({ ...previewEntity, dimensions: { ...previewEntity.dimensions, run_length: { value_um: 5, established: false } } }),
    ).toThrow(/a dimension is established exactly when it has a value/);
    expect(() =>
      toPreviewClientDTO({ ...previewEntity, dimensions: { ...previewEntity.dimensions, run_length: { value_um: null, established: true } } }),
    ).toThrow(/a dimension is established exactly when it has a value/);
    // A handler that assembled the object by hand is outside the builder; the
    // schema refuses the same contradiction. `value_um` is a key the union
    // declares, so this is DRIFT, not a leak: refused in fail mode, shipped
    // with an alert in production — and the renderer keys on `established`,
    // so it prints VERIFY either way (AC-07 holds at the screen).
    const dto = toPreviewClientDTO(previewEntity);
    const byHand = { ...dto, dimensions: { ...dto.dimensions, run_length: { value_um: 5, established: false } } };
    expect(validate(CLIENT_SCHEMAS.Preview, byHand)[0]).toMatch(/^dimensions\.run_length: matches none of 2 variants/);
    expect(() => guard.check(CLIENT_SCHEMAS.Preview, byHand)).toThrow(OutboundValidationError);
    const reports: OutboundReport[] = [];
    const production = outboundGuard({ mode: 'alert', alert: (r) => reports.push(r) });
    expect(production.check(CLIENT_SCHEMAS.Preview, byHand)).toBe(byHand);
    expect(reports[0]?.shipped).toBe(true);
    expect(reports[0]?.undeclared).toEqual([]);
    const noValue = { ...dto, dimensions: { ...dto.dimensions, run_length: { established: true } } };
    expect(validate(CLIENT_SCHEMAS.Preview, noValue).some((p) => p === 'dimensions.run_length.value_um: required')).toBe(true);
  });

  it('a preview view is closed at the item level — a stray key on a display item is a LEAK in alert mode — and cannot say it is unwatermarked', () => {
    const dto = toPreviewClientDTO(previewEntity);
    const tampered = { ...dto, views: [{ ...dto.views[0], items: [{ ...displayList.items[0], part_number: 'X' }] }] };
    const problems = validate(CLIENT_SCHEMAS.Preview, tampered);
    expect(problems[0]).toMatch(/^views\[0\]\.items\[0\]: matches none of 4 variants/);
    expect(problems).toContain('views[0].items[0].part_number: not a declared field');
    // Round two of the review: in the first revision this shipped in alert
    // mode, because the union swallowed the stray into a 'oneOf' problem the
    // guard read as drift. The planted failure that would have caught it:
    const production = outboundGuard({ mode: 'alert', alert: () => {} });
    expect(() => production.check(CLIENT_SCHEMAS.Preview, tampered)).toThrow(OutboundLeakError);
    expect(() => production.check(CLIENT_SCHEMAS.Preview, tampered)).toThrow(/undeclared fields: views\[0\]\.items\[0\]\.part_number/);
    // The same through an own __proto__ key off the wire, inside the union —
    // carrying a key that is NOT on the forbidden list, so only the
    // undeclared rule stands between it and the client.
    const wireItem = JSON.parse('{"kind":"line","item":"aisle","id":"a1","from":{"x":0,"y":0},"to":{"x":0,"y":1},"__proto__":{"organization_id":"org-a"}}') as unknown;
    const proto = { ...dto, views: [{ ...dto.views[0], items: [wireItem] }] };
    expect(() => production.check(CLIENT_SCHEMAS.Preview, proto)).toThrow(/undeclared fields: views\[0\]\.items\[0\]\.__proto__/);
    // And when it carries a listed key, the forbidden walk names it first.
    const protoMpn = { ...dto, views: [{ ...dto.views[0], items: [JSON.parse('{"kind":"line","item":"aisle","id":"a1","from":{"x":0,"y":0},"to":{"x":0,"y":1},"__proto__":{"mpn":"X"}}') as unknown] }] };
    expect(() => production.check(CLIENT_SCHEMAS.Preview, protoMpn)).toThrow(/forbidden field: views\[0\]\.items\[0\]\.__proto__\.mpn/);
    const unwatermarked = { ...dto, views: [{ ...dto.views[0], watermarked: false }] };
    expect(validate(CLIENT_SCHEMAS.Preview, unwatermarked)).toEqual(['views[0].watermarked: false is not one of true']);
  });

  it('a comparison carries option labels and metric rows — not the options\' BOMs', () => {
    const dto = toComparisonClientDTO(comparisonEntity);
    expect(dto).toEqual({
      revision_id: 'rev-1',
      options: [
        { option_id: 'opt-a', label: 'A — 96 in beams' },
        { option_id: 'opt-b', label: 'B — 108 in beams' },
      ],
      rows: [
        { metric: 'net_positions', values: [904, 1_012], has_unestablished: false },
        { metric: 'aisle_clear_width_in', values: [144, null], has_unestablished: true },
      ],
    });
    expect(validate(CLIENT_SCHEMAS.Comparison, dto)).toEqual([]);
    expect(findForbiddenFields(dto)).toEqual([]);
  });

  it('a submission shows OD-12\'s three states and the hashes — not the note, the margin or the org', () => {
    const dto = toSubmissionClientDTO(submissionEntity);
    expect(dto).toEqual({
      id: 'sub-1',
      revision_id: 'rev-1',
      status: 'in_progress',
      submitted_at: '2026-09-02T10:00:00Z',
      submission_hash: 'def456',
    });
    expect(validate(CLIENT_SCHEMAS.Submission, dto)).toEqual([]);
  });

  it('the OD-12 collapse covers every §3.4 request status but DRAFT, which is refused', () => {
    const at = (request_status: string) => toSubmissionClientDTO({ ...submissionEntity, request_status }).status;
    expect(at('SUBMITTED')).toBe('received');
    expect(at('TRIAGE')).toBe('in_progress');
    expect(at('NEEDS_INFO')).toBe('in_progress');
    expect(at('IN_PROGRESS')).toBe('in_progress');
    expect(at('QUOTED')).toBe('complete');
    expect(at('DECLINED')).toBe('complete');
    expect(at('WITHDRAWN')).toBe('complete');
    expect(at('EXPIRED')).toBe('complete');
    expect(() => at('DRAFT')).toThrow(/request status 'DRAFT' has no client-facing state/);
    // The six the first draft invented (F-38) are refused as the strangers they are.
    for (const invented of ['submitted', 'acknowledged', 'in_review', 'rfi_open', 'quoted', 'declined']) {
      expect(() => at(invented)).toThrow(/has no client-facing state/);
    }
    // And the table is exhaustive over the enum minus DRAFT — a tenth status
    // added to 0001_init.sql's enum would fail here until it is mapped.
    expect(REQUEST_STATUSES.filter((s) => s !== 'DRAFT').every((s) => typeof at(s) === 'string')).toBe(true);
    expect(REQUEST_STATUSES).toHaveLength(9);
  });

  it('a document is the signed URL, its number, its expiry and its status code — not the storage key', () => {
    const dto = toDocumentClientDTO(documentEntity);
    expect(dto).toEqual({
      id: 'doc-1',
      number: 'RMS-26-0142-P01',
      revision_code: 'P01',
      status_code: 'PRELIMINARY',
      url: 'https://files.example.invalid/signed/abc',
      expires_at: '2026-09-02T10:15:00Z',
    });
    expect(validate(CLIENT_SCHEMAS.Document, dto)).toEqual([]);
  });

  it('an invitation never carries the token or its hash — the token goes in the email, once', () => {
    const dto = toInvitationClientDTO(invitationEntity);
    expect(dto).toEqual({
      id: 'inv-1',
      email: 'colleague@example.invalid',
      role: 'client_member',
      expires_at: '2026-09-09T10:00:00Z',
    });
    expect(validate(CLIENT_SCHEMAS.Invitation, dto)).toEqual([]);
  });

  it('a project is unchanged from T-12 and now has a schema too', () => {
    const dto = toProjectClientDTO({ id: 'p1', number: '26-0142', name: 'Harbor', status: 'active', organization_id: 'org-a' });
    expect(validate(CLIENT_SCHEMAS.Project, dto)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The internal audience — the POSITIVE companion: staff DO see the fields
// --------------------------------------------------------------------------

describe('internal DTOs — staff see what the client is denied', () => {
  it('a queue entry carries the organization, §3.4\'s full request status and the clocks', () => {
    const dto = toQueueEntryInternalDTO(queueEntity);
    expect(dto).toEqual({
      submission_id: 'sub-1',
      organization_id: 'org-a',
      organization_name: 'Harbor Logistics',
      project_number: '26-0142',
      status: 'TRIAGE',
      submitted_at: '2026-09-02T10:00:00Z',
      acknowledged_at: '2026-09-02T12:00:00Z',
      quoted_at: null,
      blocker_count: 1,
      review_count: 2,
    });
    expect(validate(INTERNAL_SCHEMAS.QueueEntry, dto)).toEqual([]);
    expect(guard.check(INTERNAL_SCHEMAS.QueueEntry, dto)).toBe(dto);
    // The enum is the database's less DRAFT (§3.4: "not visible in internal
    // queues"), so a real queue row always validates — and an invented status
    // from the old client-web vocabulary does not.
    for (const status of REQUEST_STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(validate(INTERNAL_SCHEMAS.QueueEntry, { ...dto, status })).toEqual([]);
    }
    expect(validate(INTERNAL_SCHEMAS.QueueEntry, { ...dto, status: 'DRAFT' })).toEqual([
      "status: 'DRAFT' is not one of SUBMITTED, TRIAGE, NEEDS_INFO, IN_PROGRESS, QUOTED, DECLINED, WITHDRAWN, EXPIRED",
    ]);
    expect(validate(INTERNAL_SCHEMAS.QueueEntry, { ...dto, status: 'in_review' })).toEqual([
      "status: 'in_review' is not one of SUBMITTED, TRIAGE, NEEDS_INFO, IN_PROGRESS, QUOTED, DECLINED, WITHDRAWN, EXPIRED",
    ]);
  });

  it('an internal finding carries the citation, standard, edition, section, tier and rule id', () => {
    const dto = toFindingInternalDTO(findingEntity);
    expect(dto).toEqual({
      code: 'AISLE_CLEAR_SHORTFALL',
      severity: 'BLOCKER',
      subject_object_ids: ['aisle-2'],
      parameters: [
        { name: 'aisle clear width', established: true, value: { value: 3_352_800, unit: 'um' } },
        { name: 'equipment requirement', established: false, reason: 'no forklift model was stated' },
      ],
      closed_by: 'widen the aisle to the stated equipment requirement',
      rule_id: 'RULE-AISLE-01',
      citation: 'NFPA 13 §12.1',
      standard: 'NFPA 13',
      edition: '2022',
      section: '12.1',
      verification_tier: 'SECONDARY',
      waived_by: null,
      waived_at: null,
      waiver_reason: null,
    });
    expect(validate(INTERNAL_SCHEMAS.Finding, dto)).toEqual([]);
    // A strict superset of the client projection: every client key is here.
    const client = toFindingClientDTO(findingEntity);
    for (const key of Object.keys(client)) expect(dto).toHaveProperty(key, client[key as keyof typeof client]);
    // The same entity, projected for the client, loses exactly these.
    expect(findForbiddenFields(dto)).toEqual(['rule_id', 'citation', 'verification_tier']);
    expect(findForbiddenFields(client)).toEqual([]);
    // A waived finding carries its waiver — internal only, never on the client shape.
    const waived = toFindingInternalDTO({ ...findingEntity, waived_by: 'staff-7', waived_at: '2026-09-02T13:00:00Z', waiver_reason: 'client-supplied engineering letter on file' });
    expect(waived.waived_by).toBe('staff-7');
    expect(validate(INTERNAL_SCHEMAS.Finding, waived)).toEqual([]);
    expect('waived_by' in client).toBe(false);
  });

  it('a BOM line carries the part reference, the manufacturer part number, the rule and the quantity', () => {
    const dto = toBomLineInternalDTO(bomLineEntity);
    expect(dto).toEqual({
      category: 'BEAM',
      part_ref: { kind: 'catalog', part_revision_id: 'prv-9' },
      mpn: 'UM005516',
      uom: 'ea',
      rule_text: '2 per bay per level',
      rule_id: 'BOM-BEAM-01',
      confirmed: true,
      source_object_ids: ['bay-1', 'bay-2'],
      resolved: true,
      qty: { value: 312, unit: 'ea' },
      unresolved_reason: null,
    });
    expect(validate(INTERNAL_SCHEMAS.BomLine, dto)).toEqual([]);
    expect(findForbiddenFields(dto)).toEqual(['mpn', 'rule_id']);
  });

  it('an unresolved, uncatalogued BOM line carries the reason and the measured geometry — and no capacity, by shape', () => {
    const dto = toBomLineInternalDTO({
      ...bomLineEntity,
      partRef: { kind: 'uncatalogued', uncataloguedPartId: 'unc-3', measuredGeometry: '3 x 1.625 in step beam' },
      mpn: null,
      ruleId: null,
      confirmed: false,
      resolved: false,
      qty: null,
      unresolvedReason: 'no published rule for a used step beam',
    });
    expect(dto.part_ref).toEqual({ kind: 'uncatalogued', uncatalogued_part_id: 'unc-3', measured_geometry: '3 x 1.625 in step beam' });
    expect(dto.qty).toBeNull();
    expect(dto.unresolved_reason).toBe('no published rule for a used step beam');
    expect(validate(INTERNAL_SCHEMAS.BomLine, dto)).toEqual([]);
    expect('capacity' in (dto.part_ref as object)).toBe(false);
  });

  it('an internal note carries its body and author, and says on the wire that it is not client-visible', () => {
    const dto = toInternalNoteDTO(noteEntity);
    expect(dto).toEqual({
      id: 'note-1',
      submission_id: 'sub-1',
      author_id: 'staff-7',
      body: 'client asked for 96 in beams — confirm before quoting',
      created_at: '2026-09-02T12:30:00Z',
      client_visible: false,
    });
    expect(validate(INTERNAL_SCHEMAS.InternalNote, dto)).toEqual([]);
  });

  it('an internal revision shows its audience, lifecycle and tenant — the C-series lineage a client never sees', () => {
    const dto = toRevisionInternalDTO({ ...revisionInternalEntity, internal_scratch: 'dropped' });
    expect(dto).toEqual({
      id: 'rev-9',
      organization_id: 'org-a',
      project_id: 'p1',
      code: 'C01',
      iteration: 1,
      audience: 'internal',
      lifecycle_state: 'DRAFT',
      content_hash: null,
      derived_from_revision_id: 'rev-1',
      created_at: '2026-09-02T12:40:00Z',
    });
    expect(validate(INTERNAL_SCHEMAS.Revision, dto)).toEqual([]);
  });

  it('an organization, a staff-issued invitation and an approved catalog release', () => {
    const org = toOrganizationInternalDTO({ id: 'org-a', name: 'Harbor Logistics', is_internal: false, status: 'active', created_at: '2026-08-01T00:00:00Z', api_key: 'x' });
    expect(org).toEqual({ id: 'org-a', name: 'Harbor Logistics', is_internal: false, status: 'active', created_at: '2026-08-01T00:00:00Z' });
    expect(validate(INTERNAL_SCHEMAS.Organization, org)).toEqual([]);

    const inv = toInvitationInternalDTO(invitationEntity);
    expect(inv).toEqual({ id: 'inv-1', organization_id: 'org-a', email: 'colleague@example.invalid', role: 'client_member', expires_at: '2026-09-09T10:00:00Z', issued_by: 'staff-7' });
    expect(validate(INTERNAL_SCHEMAS.Invitation, inv)).toEqual([]);
    expect('token' in inv).toBe(false);

    const rel = toCatalogReleaseInternalDTO({
      id: 'rel-1',
      manufacturer: 'Interlake Mecalux',
      rev: '2026-09',
      status: 'APPROVED',
      sourceDocument: 'PSG 2025',
      digitisedBy: 'automated extract',
      digitisedAt: '2026-08-19',
      approvedBy: 'Elliott Villacorta',
      approvedAt: '2026-09-01',
      contentSha256: 'abc',
      datasets: ['beams', 'frames'],
      beams: [{ capacity: 1 }],
    });
    expect(rel.status).toBe('APPROVED');
    expect(rel.approved_by).toBe('Elliott Villacorta');
    expect(rel.datasets).toEqual(['beams', 'frames']);
    expect('beams' in rel).toBe(false);
    expect(validate(INTERNAL_SCHEMAS.CatalogRelease, rel)).toEqual([]);
    expect(findForbiddenFields(rel)).toEqual(['source_document', 'digitised_by', 'approved_by']);
  });

  it('the submission package composes the full record: submission, revision, register, findings, BOM, notes', () => {
    const dto = toSubmissionPackageInternalDTO({
      submission: {
        id: 'sub-1',
        organization_id: 'org-a',
        revision_id: 'rev-1',
        request_status: 'IN_PROGRESS',
        manifest_hash: 'm1',
        this_hash: 'h1',
        decline_reason: null,
        submitted_by: 'user-3',
        submitted_at: '2026-09-02T10:00:00Z',
        acknowledged_at: '2026-09-02T12:00:00Z',
        quoted_at: null,
        prev_hash: 'h0',
      },
      revision: revisionInternalEntity,
      assumptions: [assumptionEntity],
      findings: [findingEntity],
      bomLines: [bomLineEntity],
      notes: [noteEntity],
    });
    expect(dto.submission).toEqual({
      id: 'sub-1',
      organization_id: 'org-a',
      revision_id: 'rev-1',
      request_status: 'IN_PROGRESS',
      manifest_hash: 'm1',
      submission_hash: 'h1',
      decline_reason: null,
      submitted_by: 'user-3',
      submitted_at: '2026-09-02T10:00:00Z',
      acknowledged_at: '2026-09-02T12:00:00Z',
      quoted_at: null,
    });
    expect(dto.revision).toEqual(toRevisionInternalDTO(revisionInternalEntity));
    expect(dto.bom_lines).toEqual([toBomLineInternalDTO(bomLineEntity)]);
    expect(dto.findings).toEqual([toFindingInternalDTO(findingEntity)]);
    expect(dto.notes).toEqual([toInternalNoteDTO(noteEntity)]);
    expect(validate(INTERNAL_SCHEMAS.SubmissionPackage, dto)).toEqual([]);
    expect(guard.check(INTERNAL_SCHEMAS.SubmissionPackage, dto)).toBe(dto);
    // Staff see the whole thing: the same package walked with the client's list lights up.
    expect(findForbiddenFields(dto).length).toBeGreaterThan(0);
  });

  it('an audit event carries the chain fields', () => {
    const dto = toAuditEventInternalDTO({
      id: 'ev-1',
      occurredAt: '2026-09-02T10:00:00Z',
      actorUserId: 'user-3',
      actorType: 'client',
      actorOrganizationId: 'org-a',
      impersonatedBy: null,
      subjectOrganizationId: 'org-a',
      action: 'revision.submit',
      resourceType: 'revision',
      resourceId: 'rev-1',
      outcome: 'allowed',
      reasons: [],
      thisHash: 'h1',
      prevHash: 'h0',
    });
    expect(dto.this_hash).toBe('h1');
    expect('prev_hash' in dto).toBe(false);
    expect(validate(INTERNAL_SCHEMAS.AuditEvent, dto)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The registries, measured against the route table
// --------------------------------------------------------------------------

function walkKeys(schema: JsonSchema, path: string, out: string[]): void {
  const props = schema['properties'] as Record<string, JsonSchema> | undefined;
  if (props) {
    for (const [key, child] of Object.entries(props)) {
      out.push(path === '' ? key : `${path}.${key}`);
      walkKeys(child, path === '' ? key : `${path}.${key}`, out);
    }
  }
  const items = schema['items'] as JsonSchema | undefined;
  if (items) walkKeys(items, `${path}[]`, out);
  const oneOf = schema['oneOf'] as readonly JsonSchema[] | undefined;
  if (oneOf) oneOf.forEach((v, i) => walkKeys(v, `${path}|${i}`, out));
}

describe('the registries', () => {
  it('every client schema is client-audience, named after its key, closed, and free of forbidden keys at every depth', () => {
    for (const [name, schema] of Object.entries(CLIENT_SCHEMAS) as [string, ResponseSchema][]) {
      expect(schema.audience).toBe('client');
      expect(schema.name).toBe(name);
      expect(schema.additionalProperties).toBe(false);
      const keys: string[] = [];
      walkKeys(toJsonSchema(schema), '', keys);
      // A walk that collected nothing would pass vacuously; the emitted
      // document must carry at least the schema's own top-level properties.
      expect(keys.length).toBeGreaterThanOrEqual(Object.keys(schema.properties).length);
      const leaked = keys.filter((k) => findForbiddenFields({ [k.split(/[.[|]/).pop() ?? '']: 1 }).length > 0);
      expect(leaked, `${name} declares a forbidden key`).toEqual([]);
    }
  });

  it('every internal schema is internal-audience and named after its key', () => {
    for (const [name, schema] of Object.entries(INTERNAL_SCHEMAS) as [string, ResponseSchema][]) {
      expect(schema.audience).toBe('internal');
      expect(schema.name).toBe(name);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('every non-public route in ROUTES names a response schema that exists in its namespace\'s registry', () => {
    // The measured form of "one DTO per (entity × audience) the routes
    // return": the route table says which schema each route answers with, and
    // assertRouteCoverage refuses a name the registry does not hold. This
    // test walks the same table so the count is the route count, not a
    // hand-copied list.
    let checked = 0;
    for (const route of ROUTES) {
      if (route.namespace === 'public') {
        expect(route.response).toBeNull();
        continue;
      }
      const registry = route.namespace === 'client' ? CLIENT_SCHEMAS : INTERNAL_SCHEMAS;
      expect(route.response, `${route.method} ${route.path} names no response schema`).not.toBeNull();
      expect(Object.hasOwn(registry, route.response as string), `${route.method} ${route.path} → ${String(route.response)} is not in the ${route.namespace} registry`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(ROUTES.length - 1);
    expect(checked).toBeGreaterThanOrEqual(19);
  });

  it('every registry entry is named by some route, except the two whose routes T-14a adds — a list that can only shrink', () => {
    // The reverse of the check above. `Document` answers GET /documents/:id
    // and `InternalNote` answers POST /revisions/:id/notes — the two §8.2
    // routes the registry is still short (drift 4). When T-14a adds them,
    // this allowlist goes to zero; nothing may be added to it.
    const ORPHANS_UNTIL_T14A = new Set(['Document', 'InternalNote']);
    const named = new Set(ROUTES.map((r) => r.response).filter((r): r is string => r !== null));
    for (const name of Object.keys(CLIENT_SCHEMAS)) {
      const isComponent = ['Assumption', 'Finding'].includes(name); // embedded in Preview / SubmissionPackage
      expect(named.has(name) || isComponent || ORPHANS_UNTIL_T14A.has(name), `client schema ${name} is named by no route`).toBe(true);
    }
    for (const name of Object.keys(INTERNAL_SCHEMAS)) {
      const isComponent = ['Finding', 'InternalNote'].includes(name) && !named.has(name);
      expect(named.has(name) || isComponent || ORPHANS_UNTIL_T14A.has(name), `internal schema ${name} is named by no route`).toBe(true);
    }
    expect(ORPHANS_UNTIL_T14A.size).toBeLessThanOrEqual(2);
  });

  it('the registries are frozen', () => {
    expect(Object.isFrozen(CLIENT_SCHEMAS)).toBe(true);
    expect(Object.isFrozen(INTERNAL_SCHEMAS)).toBe(true);
  });
});

describe('the control fires — T-13b\'s stated verification', () => {
  it('adding `cost` to a client DTO is red at declaration', () => {
    // This is the planted failure in test form: the exact edit the acceptance
    // criterion names, made against the real builder, refused by the real
    // schema constructor before any response exists.
    expect(() => clientResponse('Project', { id: string(), number: string(), name: string(), status: string(), cost: number() })).toThrow(SchemaError);
  });

  it('a builder that regressed to spreading the entity is red at send', () => {
    // Simulate the regression the field-by-field rule exists to prevent.
    const leakyBuilder = (entity: typeof submissionEntity) => ({ ...entity });
    expect(() => guard.check(CLIENT_SCHEMAS.Submission, leakyBuilder(submissionEntity))).toThrow(OutboundLeakError);
    expect(() => guard.check(CLIENT_SCHEMAS.Submission, leakyBuilder(submissionEntity))).toThrow(/internal_note, margin_pct/);
  });

  it('a new column with an innocent name is red at send too — in alert mode as well, because the audience is the client', () => {
    const dto = { ...toProjectClientDTO({ id: 'p1', number: '1', name: 'n', status: 'active', organization_id: 'o' }), created_by: 'staff-7' };
    expect(() => guard.check(CLIENT_SCHEMAS.Project, dto)).toThrow(OutboundLeakError);
    expect(() => guard.check(CLIENT_SCHEMAS.Project, dto)).toThrow(/undeclared fields: created_by/);
    const production = outboundGuard({ mode: 'alert', alert: () => {} });
    expect(() => production.check(CLIENT_SCHEMAS.Project, dto)).toThrow(OutboundLeakError);
  });
});
