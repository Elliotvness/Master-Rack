/**
 * @rms/studio-model
 *
 * The studio document, its migration chain, and the commands that are the only
 * way to change it.
 *
 * Pure: no I/O, no clock, no RNG, no framework import. `check-boundaries`
 * enforces that, and its self-test proves the enforcement works.
 *
 * Every export is named. No `export *` — a star re-export is invisible to the
 * symbol-level scans that police what may cross an application boundary.
 */

export {
  ID_PREFIXES,
  INITIAL_COUNTER,
  IdError,
  collectIds,
  counterAt,
  counterOf,
  mintId,
  mintIds,
  resumeFrom,
  type EntityId,
  type IdCounter,
  type IdPrefix,
} from './ids.js';

export {
  FT,
  IN,
  LengthError,
  MICROMETRES_PER_INCH,
  MICROMETRES_PER_MIL,
  convertsExactly,
  inchesToMicrometres,
  isMicrometres,
  milToMicrometres,
  type Micrometres,
  type Mil,
} from './length.js';

export {
  SCHEMA_VERSION,
  bayTypeForRun,
  bayTypeOf,
  locateBay,
  runOf,
  type Bay,
  type BayType,
  type Established,
  type PackPins,
  type Run,
  type StudioDocument,
  type V1Bay,
  type V1BayType,
  type V1Document,
  type V1Run,
  type Witnessed,
} from './document.js';

export {
  allocateGaps,
  overhangOf,
  planGeometry,
  type AislePlan,
  type BayRect,
  type FlueRect,
  type PalletRect,
  type PlanGeometry,
  type RowRect,
  type RunPlan,
} from './plan.js';

export { MigrationError, migrate, migrateV1ToV2, type Migrated } from './migrate.js';

export {
  apply,
  type BatchCommand,
  type Command,
  type CommandOk,
  type CommandRefused,
  type CommandResult,
  type FieldChange,
} from './commands.js';

export {
  BridgeError,
  length,
  runGeometry,
  witnessedQuantity,
  type RunGeometry,
} from './to-kernel.js';

export {
  EMPTY_LEDGER,
  canRedo,
  canUndo,
  dispatch,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type Ledger,
  type LedgerEntry,
  type Session,
  type SessionOk,
  type SessionRefused,
  type SessionResult,
} from './undo.js';

export {
  COLUMN_GUARD_REASON,
  DEFAULT_PRICING_RATES,
  DRAFT_TAKEOFF_WATERMARK,
  TUNNEL_TIE_REASON,
  bomForDocument,
  exportBomCsv,
  exportBomJson,
  exportLegacyTakeoffXlsx,
  pricingForDocument,
  quoteReadinessForDocument,
  runScopeLabelForLine,
  takeoffRunsForDocument,
  takeoffSummary,
  umToFeet,
  type LegacyTakeoffExportResult,
  type PricingRates,
  type QuoteReadiness,
  type TakeoffEstimate,
  type TakeoffSummary,
} from './bom.js';

export {
  FORKLIFT_PLANNING_OPTIONS,
  PUBLISHED_BEAM_FAMILIES,
  PUBLISHED_BEAM_SPANS_IN,
  PUBLISHED_CATALOG_RELEASES,
  PUBLISHED_FRAME_DEPTHS_IN,
  PUBLISHED_FRAME_DEPTH_OPTIONS,
  PUBLISHED_FRAME_OPTIONS,
  beamFamilyFromPartLabel,
  canUseCatalogRelease,
  lookupForkliftPlanningOption,
  lookupFrameOption,
  lookupPublishedBeamSpan,
  type BeamConnectorSeries,
  type BeamFamilyOption,
  type CatalogReleaseOption,
  type ForkliftPlanningOption,
  type FrameDepthOption,
  type FrameOption,
  type PublishedBeamSpanResult,
} from './catalog-options.js';

export {
  LOST_POSITION_REASONS,
  OBSTRUCTION_ENTITY_KINDS,
  buildSceneFaces,
  closureVector,
  lostPositionLedger,
  resolvePerimeterClosure,
  type CardinalDirection,
  type ClosureResolutionAction,
  type ClosureResult,
  type ColumnOverride,
  type DoorDock,
  type KBrace,
  type LostPositionInput,
  type LostPositionLedger,
  type LostPositionReason,
  type NoRackZone,
  type ObstructionEntityKind,
  type WallSegment,
  type WarehouseShell,
} from './shell.js';

export {
  countFindings,
  inchesForComparison,
  screeningFindingsForDocument,
  type FindingCounts,
  type FindingSeverity,
  type ScreeningFindingRow,
} from './screening.js';

export {
  acceptFixProposal,
  proposeFixes,
  type AcceptedFixAuditRecord,
  type FixPreviewDelta,
  type FixProposal,
} from './fix-proposals.js';

export {
  ALLOWED_COMMODITY_CLASSES,
  COMMAND_BAR_SCHEMA,
  GEMINI_INTAKE_MODEL,
  INTAKE_EXTRACTION_SCHEMA,
  LOW_CONFIDENCE_THRESHOLD,
  applyConfirmedIntakeRows,
  buildCommandBarRequest,
  buildIntakeConfirmationRows,
  buildSpecSheetIntakeRequest,
  dispatchAll,
  isIntakeCurrent,
  isPreviewCurrent,
  lengthToMicrometres,
  parseAndValidateCommandBarOutput,
  parseAndValidateIntakeOutput,
  previewCommandSequence,
  runCommandBarInstruction,
  runSpecSheetIntake,
  stageIntakeConfirmationTable,
  toggleIntakeRowAcceptance,
  validateGeminiBackendConfig,
  type AllowedCommodityClass,
  type BackendConfigCheck,
  type CommandBarRunResult,
  type CommandPreviewCard,
  type ExtractedField,
  type ExtractedLengthField,
  type GeminiBackendConfig,
  type GeminiInteractionPart,
  type GeminiInteractionsClient,
  type GeminiInteractionsCreateRequest,
  type IntakeConfirmationRow,
  type IntakeDocumentKind,
  type IntakeExtractionPayload,
  type LengthUnit,
  type ParseCommandBarResult,
  type ParseIntakeResult,
  type SpecSheetIntakeInput,
  type SpecSheetIntakeResult,
} from './ai-intake.js';



