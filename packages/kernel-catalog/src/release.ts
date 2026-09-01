import { CatalogError } from './errors.js';
import { spotCheckRefusals } from './spot-check.js';

export { CatalogError };

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

/**
 * Where a release sits in its lifecycle.
 *
 * `DRAFT -> APPROVED -> SUPERSEDED -> RETIRED` is the published path (section
 * 10.2). `QUARANTINED` is a fifth state and a terminal one, and it is not the
 * same fact as either of the two that look like it:
 *
 *   SUPERSEDED  was approved; a newer release exists; still pinnable by the
 *               revisions that already pin it, so a two-year-old submission
 *               still renders.
 *   RETIRED     was approved; withdrawn from use.
 *   QUARANTINED never approved, and PROVEN WRONG. Not "old" -- incorrect.
 *
 * The distinction is the reference projects' most expensive lesson. A frame
 * table there overstated capacity by up to 72% and looked entirely plausible;
 * what stopped it reaching a drawing was a status field on the data reading
 * QUARANTINED until a human signed it. Calling such a release SUPERSEDED would
 * say "there is a newer one" when the fact is "this one is wrong", and the two
 * invite different behaviour from whoever reads it next.
 */
export type ReleaseStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'SUPERSEDED'
  | 'RETIRED'
  | 'QUARANTINED';

/**
 * How a release earned single-human approval, recorded as data. A name with no
 * verification path behind it is ceremony.
 */
export type VerificationPath =
  | { readonly kind: 'full_cross_check'; readonly cells: number; readonly note: string }
  | { readonly kind: 'two_path_reconciliation'; readonly cells: number; readonly note: string };

/**
 * A verification path, bound to the dataset it actually covers.
 *
 * Verification is a property of a DATASET, not of a release. The beam rows and
 * the frame tables in one release reach it by different routes - one re-sourced
 * from the published PDF, one double-extracted and reconciled - and a single
 * record cannot honestly describe both. A release reporting the beam
 * cross-check as though it covered the frames would be claiming a verification
 * that never happened, which is the exact failure mode the gate exists to stop.
 */
export type DatasetVerificationPath = VerificationPath & { readonly dataset: string };

/**
 * The approver's own reading of the source, recorded as data.
 *
 * A machine cross-check is EVIDENCE. This is the SIGNATURE, and section 10.2 is
 * clear that the two are not interchangeable: "A machine extraction is
 * evidence, not a signature." A release carrying only machine paths has been
 * checked by nobody, however many times the machine agreed with itself.
 */
export interface HumanSpotCheck {
  readonly dataset: string;
  /** Total cells in the dataset, so the required sample size is derivable. */
  readonly cells: number;
  /** The cells the TOOL drew. An approver-chosen sample drifts to the easy ones. */
  readonly sampledCells: readonly string[];
  /**
   * Extra cells the tool drew because the primary sample covered fewer PUBLISHED
   * values than cells — the `59E / 59ER` case, where two extract rows transcribe
   * one printed column. Appended, never a redraw. Usually empty.
   */
  readonly supplementaryCells: readonly string[];
  /** Recorded so the draw can be reproduced and audited years later. */
  readonly seed: number;
  readonly sourceDocument: string;
  readonly pageRef: string;
  readonly checkedBy: string;
  readonly checkedAt: string;
  /** 'MATCHED' or anything else. Anything else fails the entire release. */
  readonly outcome: string;
}

/**
 * The datasets the MVP-1 check set consumes.
 *
 * Check 1 (beam/frame connector compatibility) and check 2 (beam pair capacity)
 * both need frames; every span lookup needs beams. A release missing either
 * cannot serve the check set, so it must not be approvable - see
 * `completenessRefusals`.
 */
export const REQUIRED_DATASETS: readonly string[] = Object.freeze(['beams', 'frames']);

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
  readonly verificationPaths: readonly DatasetVerificationPath[];
  /**
   * The rev of a later release that corrected this one's values, or null.
   *
   * Non-null is a permanent bar on approval, independent of `status`. Status is
   * one field one edit away from saying something else; this records WHY, and
   * the gate reads both. Status on the data, gate on the status -- and a second
   * latch on the reason, so flipping the status back to DRAFT does not reopen
   * the door.
   */
  readonly humanSpotChecks: readonly HumanSpotCheck[];
  readonly correctedBy: string | null;
  /** Why this release was quarantined, in words. Non-null iff QUARANTINED. */
  readonly quarantineReason: string | null;
  /** Dataset names this release ships, as declared by its manifest. */
  readonly datasets: readonly string[];
  readonly contentSha256: string;
  /** Manufacturer's own errors, transcribed as published. Reported, never fixed. */
  readonly sourceAnomalies: readonly string[];
  /** Published footnotes as data (e.g. bracing over 126"). Reported, never enforced. */
  readonly constraints: Readonly<Record<string, number>>;
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
 * The manifest fields the approval gate reads, named once.
 *
 * `approvedBy` is deliberately absent: the gate decides whether a release MAY be
 * approved, and the name already on it is not evidence about that. It was in the
 * parameter type and unread, which reads as a check nobody wrote.
 */
export type ApprovalFacts = Pick<
  CatalogReleaseManifest,
  'digitisedBy' | 'verificationPaths' | 'datasets' | 'correctedBy' | 'humanSpotChecks'
>;

/**
 * Each dataset's cell ids, in file order, keyed by dataset name.
 *
 * The gate needs them to re-derive the draw a spot-check claims to have read.
 * They are DATA, supplied by the caller — the package stays pure; nothing here
 * opens a file.
 */
export type DatasetCells = ReadonlyMap<string, readonly string[]>;

/**
 * Every reason a release may NOT be approved. Empty means it may.
 *
 * This is the gate that keeps a wrong capacity out of a drawing, and it gates on
 * the verification ACT, not merely the digitiser's identity — because running an
 * extraction script sets the digitiser to a machine identity, which would let
 * one person approve their own work if identity were the only check.
 */
export function approvalRefusals(
  manifest: ApprovalFacts,
  approver: string,
  datasetCells: DatasetCells,
): readonly string[] {
  const reasons: string[] = [];

  // A release a later one had to correct is wrong, and stays wrong. This is
  // checked before anything else because no amount of signature or sampling
  // makes a superseded-by-correction table safe to pin.
  if (manifest.correctedBy !== null) {
    reasons.push(
      `this release was corrected by '${manifest.correctedBy}' and can never be approved; ` +
        'approve the release that corrected it',
    );
  }

  if (approver.trim() === '') {
    reasons.push('the approver must be a named person');
  }
  if (approver === manifest.digitisedBy) {
    reasons.push('the approver may not be the digitiser');
  }

  // A machine digitiser plus one human approver is NOT two independent parties
  // unless a recorded verification path establishes independence - and the path
  // must cover the dataset it is claimed for. One path covering one dataset is
  // not evidence about another.
  for (const dataset of REQUIRED_DATASETS) {
    const path = manifest.verificationPaths.find((p) => p.dataset === dataset);
    if (path === undefined) {
      reasons.push(
        `single-human approval requires a recorded independent verification path for '${dataset}' ` +
          '(a full cross-check or a two-path reconciliation)',
      );
    } else if (path.cells <= 0) {
      reasons.push(`the verification path for '${dataset}' must cover at least one cell`);
    }
  }

  // A path claiming a dataset the release does not ship is a record of work on
  // something that is not here.
  for (const path of manifest.verificationPaths) {
    if (!manifest.datasets.includes(path.dataset)) {
      reasons.push(
        `the verification path for '${path.dataset}' names a dataset this release does not ship`,
      );
    }
  }

  // The approver's own act, per dataset. A machine cross-check is evidence; a
  // person reading cells the tool chose is the signature. Without this, a
  // release can be "approved" by someone who never opened the source.
  for (const dataset of REQUIRED_DATASETS) {
    const check = manifest.humanSpotChecks.find((c) => c.dataset === dataset);
    if (check === undefined) {
      reasons.push(
        `approval requires the approver's own recorded spot-check of '${dataset}' ` +
          '(20 cells or 5%, whichever is greater, drawn by the tool)',
      );
      continue;
    }
    if (check.checkedBy !== approver) {
      reasons.push(
        `the spot-check of '${dataset}' was recorded by '${check.checkedBy}' but '${approver}' is approving; ` +
          'the signature must attach to the person who did the reading',
      );
    }
    // No cell ids means the draw cannot be re-derived, so the record cannot be
    // verified. That is a refusal, never a skip: a missing input must not make
    // a control pass quietly.
    const cellIds = datasetCells.get(dataset);
    if (cellIds === undefined) {
      reasons.push(
        `the '${dataset}' dataset's cell ids were not supplied, so the recorded spot-check ` +
          'cannot be checked against the draw',
      );
      continue;
    }
    reasons.push(...spotCheckRefusals(check, manifest.digitisedBy, cellIds));
  }

  reasons.push(...completenessRefusals(manifest));

  return Object.freeze(reasons);
}

/**
 * Every reason a release is too incomplete to be APPROVED. Empty means complete.
 *
 * An APPROVED release is one a new revision may pin, and pinning it is a promise
 * that the check set can run against it. `interlake-2026-09` was approved
 * carrying beams alone while the three frame tables sat in the DRAFT 2026-08
 * release - so every check needing a frame had nothing to read, and nothing
 * said so. A release that cannot serve the check set is not approvable, and
 * that has to be a refusal rather than a convention.
 */
export function completenessRefusals(
  manifest: Pick<CatalogReleaseManifest, 'datasets'>,
): readonly string[] {
  const reasons: string[] = [];
  for (const dataset of REQUIRED_DATASETS) {
    if (!manifest.datasets.includes(dataset)) {
      reasons.push(
        `an APPROVED release must ship every dataset the check set consumes; '${dataset}' is missing`,
      );
    }
  }
  return Object.freeze(reasons);
}

export function canApprove(
  manifest: ApprovalFacts,
  approver: string,
  datasetCells: DatasetCells,
): boolean {
  return approvalRefusals(manifest, approver, datasetCells).length === 0;
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
  datasetCells: DatasetCells,
): CatalogReleaseManifest {
  if (manifest.status === 'QUARANTINED') {
    throw new ApprovalGateError([
      'a QUARANTINED release may never be approved' +
        (manifest.quarantineReason === null ? '' : `: ${manifest.quarantineReason}`),
    ]);
  }
  if (manifest.status !== 'DRAFT') {
    throw new ApprovalGateError([`only a DRAFT release may be approved; this is ${manifest.status}`]);
  }
  const reasons = approvalRefusals(manifest, approver, datasetCells);
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


/**
 * Quarantine a release: it is not old, it is wrong.
 *
 * Terminal and one-way. There is deliberately no `unquarantine`: a release
 * reaches this state because its values were proven incorrect, and the remedy
 * is a new release that transcribes the source correctly -- not an edit to the
 * record of what was wrong. The wrong values stay exactly as transcribed, so
 * the extract remains reconcilable against its source and a future reader can
 * see what was believed and when.
 */
export function quarantineRelease(
  manifest: CatalogReleaseManifest,
  reason: string,
  correctedBy: string | null,
): CatalogReleaseManifest {
  if (reason.trim() === '') {
    throw new ApprovalGateError(['a quarantine must state its reason']);
  }
  if (manifest.status === 'APPROVED') {
    // An approved release that turns out to be wrong is a different and worse
    // event: revisions may already pin it, and silently reclassifying it would
    // change what those revisions mean. That path needs an impact review
    // (FR-CT-06) and is not this function.
    throw new ApprovalGateError([
      'an APPROVED release cannot be quarantined directly; open revisions may pin it',
    ]);
  }
  return Object.freeze({
    ...manifest,
    status: 'QUARANTINED' as const,
    quarantineReason: reason,
    correctedBy,
  });
}
