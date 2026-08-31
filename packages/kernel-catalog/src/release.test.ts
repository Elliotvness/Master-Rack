import { describe, expect, it } from 'vitest';
import {
  ApprovalGateError,
  approvalRefusals,
  approveRelease,
  canApprove,
  canPinForNewRevision,
  type CatalogReleaseManifest,
  type VerificationPath,
} from './index.js';

const crossCheck: VerificationPath = {
  kind: 'full_cross_check',
  cells: 357,
  note: 'cross-checked 357/357 against the live chart',
};

function manifest(overrides: Partial<CatalogReleaseManifest> = {}): CatalogReleaseManifest {
  return {
    manufacturer: 'Interlake Mecalux',
    rev: '2026-08',
    status: 'DRAFT',
    sourceDocument: 'live chart',
    sourceUrl: 'https://example.invalid',
    pageRef: 'Beam Load Capacities Chart',
    units: 'lbs',
    loadBasis: 'per pair, UDL, L/180',
    deflectionLimit: 'L/180',
    codeBasis: '2012 RMI and 2001 AISI',
    digitisedBy: 'automated extract (Claude)',
    digitisedAt: '2026-08-19',
    approvedBy: null,
    approvedAt: null,
    verificationPath: crossCheck,
    contentSha256: 'abc',
    sourceAnomalies: [],
    constraints: {},
    ...overrides,
  };
}

describe('AC-18 — the two-person approval gate', () => {
  it('approves a draft with a named approver, not the digitiser, and a verification path', () => {
    const approved = approveRelease(manifest(), 'Elliott Villacorta', '2026-08-31T00:00:00Z');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('Elliott Villacorta');
    expect(approved.approvedAt).toBe('2026-08-31T00:00:00Z');
  });

  it('refuses an approver who is the digitiser', () => {
    const m = manifest();
    const reasons = approvalRefusals(m, m.digitisedBy);
    expect(reasons).toContain('the approver may not be the digitiser');
    expect(() => approveRelease(m, m.digitisedBy, '2026-08-31T00:00:00Z')).toThrow(
      ApprovalGateError,
    );
  });

  it('refuses an empty approver name', () => {
    expect(approvalRefusals(manifest(), '   ')).toContain('the approver must be a named person');
  });

  it('refuses single-human approval with no recorded verification path', () => {
    const m = manifest({ verificationPath: null });
    const reasons = approvalRefusals(m, 'Elliott Villacorta');
    expect(reasons.some((r) => r.includes('independent verification path'))).toBe(true);
    expect(() => approveRelease(m, 'Elliott Villacorta', '2026-08-31T00:00:00Z')).toThrow(
      ApprovalGateError,
    );
  });

  it('refuses a verification path covering no cells', () => {
    const m = manifest({
      verificationPath: { kind: 'full_cross_check', cells: 0, note: 'nothing checked' },
    });
    expect(approvalRefusals(m, 'Elliott Villacorta')).toContain(
      'the recorded verification path must cover at least one cell',
    );
  });

  it('collects every reason at once, not just the first', () => {
    const m = manifest({ verificationPath: null });
    // Approver is empty AND equals... use empty which is not the digitiser but
    // trips two rules: empty name and missing path.
    const reasons = approvalRefusals(m, '');
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('canApprove agrees with approvalRefusals', () => {
    expect(canApprove(manifest(), 'Elliott Villacorta')).toBe(true);
    expect(canApprove(manifest(), manifest().digitisedBy)).toBe(false);
  });

  it('refuses to approve anything not in DRAFT', () => {
    const approved = manifest({ status: 'APPROVED' });
    expect(() => approveRelease(approved, 'Someone Else', '2026-08-31T00:00:00Z')).toThrow(
      /only a DRAFT release/,
    );
  });

  it('accepts a two-path reconciliation as a verification path', () => {
    const m = manifest({
      verificationPath: {
        kind: 'two_path_reconciliation',
        cells: 435,
        note: 'reconciled 435/435 across two extractions',
      },
    });
    expect(canApprove(m, 'Elliott Villacorta')).toBe(true);
  });
});

describe('only an APPROVED release may be pinned by a new revision', () => {
  it('permits pinning an APPROVED release', () => {
    expect(canPinForNewRevision({ status: 'APPROVED' })).toBe(true);
  });

  it('refuses a DRAFT, SUPERSEDED or RETIRED release for a new revision', () => {
    expect(canPinForNewRevision({ status: 'DRAFT' })).toBe(false);
    expect(canPinForNewRevision({ status: 'SUPERSEDED' })).toBe(false);
    expect(canPinForNewRevision({ status: 'RETIRED' })).toBe(false);
  });
});

describe('immutability', () => {
  it('approveRelease returns a new frozen manifest and does not mutate the input', () => {
    const draft = manifest();
    const approved = approveRelease(draft, 'Elliott Villacorta', '2026-08-31T00:00:00Z');
    expect(draft.status).toBe('DRAFT');
    expect(Object.isFrozen(approved)).toBe(true);
  });
});
