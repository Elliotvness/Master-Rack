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

export {
  FRAME_HEIGHT_BAND_BOUNDARY_IN,
  FrameCatalog,
  FrameCatalogError,
  bandFor,
  governingHbl,
  type FrameHeightBand,
  type FrameKey,
  type FrameLookupResult,
  type FrameTable,
  type FrameVariant,
} from './frames.js';

export { loadFrameTables } from './load-frames.js';
