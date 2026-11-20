/**
 * @rms/kernel-derive
 *
 * Rack geometry, pallet-position derivation (C-02), and cold-formed thin-walled
 * section & RMI MH16.1 / AISI S100 structural calculations. Pure arithmetic;
 * no I/O, no clock, no RNG — enforced by tools/check-boundaries.mjs.
 */

export {
  DerivationError,
  aisleClearWidth,
  allocateOverhang,
  bayPitch,
  grossPositions,
  positionAccounting,
  runLength,
  type Derived,
  type GrossPositionInput,
  type OverhangSplit,
  type PositionAccounting,
  type PositionLoss,
} from './derive.js';

export {
  STEEL_GAGE_TABLE,
  coldWorkFya,
  computeSectionProperties,
  evaluateBeamCheck,
  evaluateColumnCheck,
  evaluateRackBay,
  smartSolveRackBay,
  type BeamCheckInput,
  type BeamCheckResult,
  type ColumnCheckInput,
  type ColumnCheckResult,
  type FrameBracingStyle,
  type FrameLegStyle,
  type RackBayEvaluationInput,
  type RackBayEvaluationResult,
  type RackShapeType,
  type SectionProperties,
  type SmartSolveCandidate,
} from './structural-calc.js';
