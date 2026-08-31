/**
 * @rms/kernel-units
 *
 * Fixed-point quantities with mandatory unit and origin.
 *
 * This package is pure: no I/O, no filesystem, no clock, no RNG, no framework
 * import. tools/check-boundaries.mjs enforces that, and its self-test proves
 * the enforcement works.
 */

export {
  BASIS_BOUND,
  ORIGINS,
  dimensionOf,
  isBasisBound,
  isStorable,
  scaleOf,
  storageUnitFor,
  type CountUnit,
  type Dimension,
  type LengthUnit,
  type LoadUnit,
  type Origin,
  type Unit,
} from './units.js';

export {
  BasisBoundError,
  DimensionMismatchError,
  InexactDivisionError,
  InexactValueError,
  NotStorableError,
  ProvenanceDepthError,
  UnitError,
  UnitMismatchError,
} from './errors.js';

export {
  add,
  allocate,
  allocateNamed,
  compare,
  convert,
  dimension,
  divideExact,
  each,
  equals,
  fromUnit,
  inches,
  isZero,
  millimetres,
  mlb,
  pounds,
  poundsPerPair,
  quantity,
  scale,
  subtract,
  um,
  type Quantity,
} from './quantity.js';

export {
  MAX_PROVENANCE_DEPTH,
  emptySteps,
  isEstablished,
  isEstablishedOrigin,
  nodeCount,
  rulesUsed,
  unestablished,
  type ProvenanceNode,
} from './provenance.js';

export {
  VERIFY,
  displayText,
  format,
  formatCount,
  formatLength,
  formatLoad,
  type DisplayText,
  type FormatOptions,
} from './display.js';
