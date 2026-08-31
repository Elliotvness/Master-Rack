/**
 * Catalog release types and the release lifecycle.
 *
 * Blueprint §10. A catalog release is one manufacturer, one published revision.
 * Two rules govern it, both learned the expensive way in the reference projects:
 *
 *   1. The approver may not be the digitiser, and single-human approval needs a
 *      recorded independent verification path. A machine extraction is evidence,
 *      not a signature. The 72% overstatement in the reference data was caught by
 *      reconciliation, not by a name. So "APPROVED" is a state the data can only
 *      reach with a verification act behind it.
 *
 *   2. Only an APPROVED release may be pinned by a NEW revision. Existing
 *      revisions keep their pins forever, including to SUPERSEDED releases, so a
 *      two-year-old submission still renders.
 */

export type ReleaseStatus = 'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'RETIRED';

/**
 * How a release earned single-human approval, recorded as data. A name with no
 * verification path behind it is ceremony.
 */
export type VerificationPath =
  | { readonly kind: 'full_cross_check'; readonly cells: number; readonly note: string }
  | { readonly kind: 'two_path_reconciliation'; readonly cells: number; readonly note: string };

export interface CatalogReleaseManifest {
  readonly manufacturer: string;
  readonly rev: string;
  readonly status: ReleaseStatus;
  readonly sourceDocument: string;
  readonly sourceUrl: string | null;
  readonly pageRef: string | null;
  readonly units: string;
  readonly loadBasis: string;
  readonly deflectionLimit: string;
  readonly codeBasis: string;
  readonly digitisedBy: string;
  readonly digitisedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly verificationPath: VerificationPath | null;
  readonly contentSha256: string;
  /** Manufacturer's own errors, transcribed as published. Reported, never fixed. */
  readonly sourceAnomalies: readonly string[];
  /** Published footnotes as data (e.g. bracing over 126"). Reported, never enforced. */
  readonly constraints: Readonly<Record<string, number>>;
}

export class CatalogError extends Error {
  override readonly name: string = 'CatalogError';
}

/** A release that fails the two-person approval gate. */
export class ApprovalGateError extends CatalogError {
  override readonly name = 'ApprovalGateError';
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`Release cannot be approved: ${reasons.join(' | ')}`);
    this.reasons = Object.freeze([...reasons]);
  }
}

/**
 * Every reason a release may NOT be approved. Empty means it may.
 *
 * This is the gate that keeps a wrong capacity out of a drawing, and it gates on
 * the verification ACT, not merely the digitiser's identity — because running an
 * extraction script sets the digitiser to a machine identity, which would let
 * one person approve their own work if identity were the only check.
 */
export function approvalRefusals(
  manifest: Pick<
    CatalogReleaseManifest,
    'approvedBy' | 'digitisedBy' | 'verificationPath'
  >,
  approver: string,
): readonly string[] {
  const reasons: string[] = [];

  if (approver.trim() === '') {
    reasons.push('the approver must be a named person');
  }
  if (approver === manifest.digitisedBy) {
    reasons.push('the approver may not be the digitiser');
  }
  // A machine digitiser plus one human approver is NOT two independent parties
  // unless a recorded verification path establishes independence.
  if (manifest.verificationPath === null) {
    reasons.push(
      'single-human approval requires a recorded independent verification path ' +
        '(a full cross-check or a two-path reconciliation)',
    );
  } else if (manifest.verificationPath.cells <= 0) {
    reasons.push('the recorded verification path must cover at least one cell');
  }

  return Object.freeze(reasons);
}

export function canApprove(
  manifest: Pick<CatalogReleaseManifest, 'approvedBy' | 'digitisedBy' | 'verificationPath'>,
  approver: string,
): boolean {
  return approvalRefusals(manifest, approver).length === 0;
}

/**
 * Approve a DRAFT release, or throw with every reason it cannot be approved.
 * Returns a new manifest; never mutates. `approvedAt` is supplied by the caller,
 * not read from a clock.
 */
export function approveRelease(
  manifest: CatalogReleaseManifest,
  approver: string,
  approvedAt: string,
): CatalogReleaseManifest {
  if (manifest.status !== 'DRAFT') {
    throw new ApprovalGateError([`only a DRAFT release may be approved; this is ${manifest.status}`]);
  }
  const reasons = approvalRefusals(manifest, approver);
  if (reasons.length > 0) {
    throw new ApprovalGateError(reasons);
  }
  return Object.freeze({
    ...manifest,
    status: 'APPROVED' as const,
    approvedBy: approver,
    approvedAt,
  });
}

/** Only an APPROVED release may be pinned by a new revision. */
export function canPinForNewRevision(manifest: Pick<CatalogReleaseManifest, 'status'>): boolean {
  return manifest.status === 'APPROVED';
}
