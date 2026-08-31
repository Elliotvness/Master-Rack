/**
 * @rms/kernel-derive
 *
 * Rack geometry and pallet-position derivation (C-02): bay pitch, run length,
 * overhang allocation, aisle clear width, gross/lost/net positions. Pure
 * arithmetic over provenanced quantities; no catalog or rule number is invented
 * here. No I/O, no clock, no RNG — enforced by tools/check-boundaries.mjs.
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
