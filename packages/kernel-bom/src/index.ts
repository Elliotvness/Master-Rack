/**
 * @rms/kernel-bom
 *
 * The internal takeoff BOM (§12) and its unresolved register. Pure: no I/O, no
 * clock, no RNG.
 *
 * A line is either a quantity or a reason, never both and never neither — and
 * that is enforced by the type, not by a convention.
 */

export {
  BomError,
  resolvedLine,
  uncataloguedLines,
  unconfirmedLines,
  unresolvedLine,
  unresolvedLines,
  type BomCategory,
  type BomLine,
  type PartRef,
} from './line.js';

export {
  FOOTPLATE_REASON,
  ROW_SPACER_REASON,
  WIRE_DECK_REASON,
  anchorQty,
  beamQty,
  canonicalBom,
  categoryTotal,
  deriveBom,
  deriveRunBom,
  frameQty,
  type RunTakeoff,
} from './derive-bom.js';
