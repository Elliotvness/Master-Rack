/**
 * @rms/kernel-geom
 *
 * Obstruction faces and the span-bucketed clearance index (C-03, ADR-007).
 * Pure integer-µm geometry; the brute-force method is retained as the
 * correctness oracle the index is asserted against. No I/O, no clock, no RNG —
 * enforced by tools/check-boundaries.mjs.
 */

export {
  ClearanceIndex,
  GeomError,
  face,
  minClearanceBrute,
  type Axis,
  type Face,
  type Normal,
} from './geom.js';
