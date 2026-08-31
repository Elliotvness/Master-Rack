/**
 * @rms/kernel-catalog
 *
 * Catalog release types, the two-person approval gate, and the no-interpolation
 * beam-capacity lookup. Pure: no I/O, no clock, no RNG. Data is loaded elsewhere
 * and passed in as validated rows.
 */

export {
  ApprovalGateError,
  CatalogError,
  approvalRefusals,
  approveRelease,
  canApprove,
  canPinForNewRevision,
  type CatalogReleaseManifest,
  type ReleaseStatus,
  type VerificationPath,
} from './release.js';

export {
  BeamCatalog,
  type BeamKey,
  type BeamRow,
  type LookupResult,
} from './lookup.js';

export { CatalogDataError, loadBeamRows } from './load.js';
