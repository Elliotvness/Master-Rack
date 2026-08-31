/**
 * Units, and the rules that make a unit more than a label.
 *
 * Storage bases (blueprint §7.3, OD-06):
 *   length   integer micrometres (um)
 *   load     integer millipounds (mlb)
 *
 * Why micrometres. One inch is 25.4 mm exactly, so every published inch value
 * and every whole millimetre is a whole number of um. Integer millimetres
 * cannot do this: 48" is 1219.2 mm, and rounding to 1219 reads back as
 * 47.9921", which no longer matches its own capacity-table lookup key. 18 of
 * the 21 published spans miss their key that way, silently turning every
 * lookup off-grid and destroying the one behaviour the engine is built around.
 */

/** Physical dimension. Values of different dimensions never combine. */
export type Dimension = 'length' | 'load' | 'count';

/**
 * Unit symbols. Storage units are integer-valued; display units exist only for
 * one-way rendering and are never parsed back into a stored value.
 */
export type LengthUnit = 'um' | 'mm' | 'in' | 'ft';
export type LoadUnit = 'mlb' | 'lb' | 'lb/pr' | 'kg';
export type CountUnit = 'ea';
export type Unit = LengthUnit | LoadUnit | CountUnit;

/**
 * Where a value came from. Carried on the value itself rather than inferred
 * later, so a number in a package can always name who put it there.
 */
export type Origin = 'INPUT' | 'DERIVED' | 'CATALOG' | 'RULE' | 'UNKNOWN';

export const ORIGINS: readonly Origin[] = ['INPUT', 'DERIVED', 'CATALOG', 'RULE', 'UNKNOWN'];

interface UnitSpec {
  readonly dimension: Dimension;
  /** How many storage units one of this unit is. Exact integers only. */
  readonly perStorageUnit: number;
  /** The storage unit for this unit's dimension. */
  readonly storageUnit: Unit;
  /** True when a value in this unit may be stored, not merely displayed. */
  readonly storable: boolean;
}

/**
 * BASIS_BOUND — units that state the basis the quantity is measured against.
 *
 * A capacity published "per pair" is lb/pr. Converting it to lb is refused,
 * because in a general-purpose unit library that conversion is a silent no-op
 * that turns a per-pair capacity into a per-beam one. Carried from
 * rack-engine/model/quantity.py, where the trap was found the expensive way.
 */
export const BASIS_BOUND: ReadonlySet<Unit> = new Set<Unit>(['lb/pr']);

const UNITS: Readonly<Record<Unit, UnitSpec>> = {
  // Length. Storage base: micrometres.
  um: { dimension: 'length', perStorageUnit: 1, storageUnit: 'um', storable: true },
  mm: { dimension: 'length', perStorageUnit: 1_000, storageUnit: 'um', storable: true },
  in: { dimension: 'length', perStorageUnit: 25_400, storageUnit: 'um', storable: true },
  ft: { dimension: 'length', perStorageUnit: 304_800, storageUnit: 'um', storable: true },

  // Load. Storage base: millipounds.
  mlb: { dimension: 'load', perStorageUnit: 1, storageUnit: 'mlb', storable: true },
  lb: { dimension: 'load', perStorageUnit: 1_000, storageUnit: 'mlb', storable: true },
  // Basis-bound: same magnitude as lb, but it will not convert. See BASIS_BOUND.
  'lb/pr': { dimension: 'load', perStorageUnit: 1_000, storageUnit: 'mlb', storable: true },
  // Kilograms are asymmetric: the pound converts to metric exactly, not the
  // reverse. kg is therefore display-only and never a stored value.
  kg: { dimension: 'load', perStorageUnit: 2_204.622_622, storageUnit: 'mlb', storable: false },

  ea: { dimension: 'count', perStorageUnit: 1, storageUnit: 'ea', storable: true },
};

export function dimensionOf(unit: Unit): Dimension {
  return UNITS[unit].dimension;
}

export function storageUnitFor(unit: Unit): Unit {
  return UNITS[unit].storageUnit;
}

export function isStorable(unit: Unit): boolean {
  return UNITS[unit].storable;
}

export function isBasisBound(unit: Unit): boolean {
  return BASIS_BOUND.has(unit);
}

/**
 * How many storage units one of `unit` is. Exact for every storable unit.
 */
export function scaleOf(unit: Unit): number {
  return UNITS[unit].perStorageUnit;
}
