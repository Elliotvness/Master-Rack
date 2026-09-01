import { describe, expect, it } from 'vitest';
import {
  ApprovalGateError,
  approvalRefusals,
  approveRelease,
  canApprove,
  canPinForNewRevision,
  completenessRefusals,
  quarantineRelease,
  REQUIRED_DATASETS,
  type CatalogReleaseManifest,
  type DatasetVerificationPath,
} from './index.js';

const crossCheck: DatasetVerificationPath = {
  dataset: 'beams',
  kind: 'full_cross_check',
  cells: 357,
  note: 'cross-checked 357/357 against the live chart',
};

const framePath: DatasetVerificationPath = {
  dataset: 'frames',
  kind: 'two_path_reconciliation',
  cells: 435,
  note: 'reconciled 435/435 across two independent extraction paths',
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
    verificationPaths: [crossCheck, framePath],
    datasets: ['beams', 'frames'],
    correctedBy: null,
    quarantineReason: null,
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
    const m = manifest({ verificationPaths: [] });
    const reasons = approvalRefusals(m, 'Elliott Villacorta');
    expect(reasons.some((r) => r.includes('independent verification path'))).toBe(true);
    expect(() => approveRelease(m, 'Elliott Villacorta', '2026-08-31T00:00:00Z')).toThrow(
      ApprovalGateError,
    );
  });

  it('refuses a verification path covering no cells', () => {
    const m = manifest({
      verificationPaths: [{ ...crossCheck, cells: 0 }, framePath],
    });
    expect(approvalRefusals(m, 'Elliott Villacorta')).toContain(
      "the verification path for 'beams' must cover at least one cell",
    );
  });

  it('refuses a release verified for beams but not for frames', () => {
    // The gap the Rev C audit found, made unrepresentable. One dataset's
    // cross-check is not evidence about another's.
    const m = manifest({ verificationPaths: [crossCheck] });
    const reasons = approvalRefusals(m, 'Elliott Villacorta');
    expect(reasons.some((r) => r.includes("verification path for 'frames'"))).toBe(true);
  });

  it('refuses a verification path naming a dataset the release does not ship', () => {
    const m = manifest({
      verificationPaths: [crossCheck, framePath, { ...framePath, dataset: 'decks' }],
      datasets: ['beams', 'frames'],
    });
    expect(approvalRefusals(m, 'Elliott Villacorta')).toContain(
      "the verification path for 'decks' names a dataset this release does not ship",
    );
  });

  it('collects every reason at once, not just the first', () => {
    const m = manifest({ verificationPaths: [] });
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
      verificationPaths: [{ ...crossCheck, kind: 'two_path_reconciliation' }, framePath],
    });
    expect(canApprove(m, 'Elliott Villacorta')).toBe(true);
  });
});

describe('an APPROVED release must be able to serve the check set', () => {
  it('refuses approval of a release shipping beams but no frames', () => {
    // interlake-2026-09 was approved in exactly this state. Checks 1 and 2 both
    // need a frame, and nothing said the release could not answer them.
    const m = manifest({ datasets: ['beams'], verificationPaths: [crossCheck] });
    expect(completenessRefusals(m)).toContain(
      "an APPROVED release must ship every dataset the check set consumes; 'frames' is missing",
    );
    expect(canApprove(m, 'Elliott Villacorta')).toBe(false);
  });

  it('names every missing dataset, not only the first', () => {
    expect(completenessRefusals({ datasets: [] })).toHaveLength(REQUIRED_DATASETS.length);
  });

  it('passes a release shipping every required dataset', () => {
    expect(completenessRefusals(manifest())).toEqual([]);
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


describe('QUARANTINED — a release that is wrong, not merely old', () => {
  it('quarantines a draft, recording the reason and what corrected it', () => {
    const q = quarantineRelease(manifest(), '264 capacities appear nowhere in the source', '2026-09');
    expect(q.status).toBe('QUARANTINED');
    expect(q.correctedBy).toBe('2026-09');
    expect(q.quarantineReason).toContain('264 capacities');
  });

  it('refuses a quarantine with no stated reason', () => {
    expect(() => quarantineRelease(manifest(), '   ', '2026-09')).toThrow(ApprovalGateError);
  });

  it('never approves a QUARANTINED release, and says why', () => {
    const q = quarantineRelease(manifest(), 'values proven wrong', '2026-09');
    expect(() => approveRelease(q, 'Elliott Villacorta', '2026-09-01T00:00:00Z')).toThrow(
      /may never be approved: values proven wrong/,
    );
  });

  it('refuses to quarantine an APPROVED release — revisions may already pin it', () => {
    // A different and worse event: reclassifying it would silently change what
    // those revisions mean. That path needs an impact review (FR-CT-06).
    expect(() => quarantineRelease(manifest({ status: 'APPROVED' }), 'wrong', '2026-09')).toThrow(
      /open revisions may pin it/,
    );
  });

  it('bars approval on correctedBy alone, even if the status is flipped back', () => {
    // Status is one field one edit away from saying something else. The reason
    // is the second latch, and it is the one that cannot be argued with.
    const m = manifest({ status: 'DRAFT', correctedBy: '2026-09' });
    const reasons = approvalRefusals(m, 'Elliott Villacorta');
    expect(reasons.some((r) => r.includes("corrected by '2026-09'"))).toBe(true);
    expect(canApprove(m, 'Elliott Villacorta')).toBe(false);
  });

  it('leaves a quarantined release pinnable by nobody new', () => {
    const q = quarantineRelease(manifest(), 'wrong', '2026-09');
    expect(canPinForNewRevision(q)).toBe(false);
  });
});
