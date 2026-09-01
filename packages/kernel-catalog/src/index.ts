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
  REQUIRED_DATASETS,
  approvalRefusals,
  approveRelease,
  canApprove,
  canPinForNewRevision,
  completenessRefusals,
  quarantineRelease,
  type ApprovalFacts,
  type DatasetCells,
  type HumanSpotCheck,
  type CatalogReleaseManifest,
  type DatasetVerificationPath,
  type ReleaseStatus,
  type VerificationPath,
} from './release.js';

export { ManifestError, loadReleaseManifest } from './load-manifest.js';

export {
  drawSpotCheckSample,
  drawSupplementarySample,
  readingsCovered,
  requiredSampleSize,
  spotCheckRefusals,
} from './spot-check.js';

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

export {
  CELL_ID_DATASETS,
  CellIdError,
  cellIdsOf,
  distinctPublishedCount,
  publishedKeyOf,
} from './cell-ids.js';
