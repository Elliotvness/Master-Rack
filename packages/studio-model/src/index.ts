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
  type Command,
  type CommandOk,
  type CommandRefused,
  type CommandResult,
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
