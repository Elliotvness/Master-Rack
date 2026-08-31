/**
 * Frame capacity lookup (B-03).
 *
 * Frame capacity differs from beam capacity in one structural way, and getting
 * it wrong is how the reference project shipped a table that overstated
 * capacity by 72%: **it is a function of TWO independent variables.**
 *
 *   1. HbL — height between levels. The published definition is the maximum
 *      beam spacing OR the floor-to-first-beam distance, WHICHEVER IS GREATER.
 *      The floor gap is included by definition, not by convention.
 *
 *   2. Overall frame height band. Models 2.314 / 2.313 / 2.312 carry two strut
 *      patterns, one for frames under 21 ft and one for frames over. Different
 *      bracing, different capacity. Unbanded models have a single pattern.
 *
 * A lookup keyed on HbL alone cannot reproduce the published table. That is not
 * a modelling preference; it is what the chart says.
 *
 * As with beams, the lookup is exact-grid only. Off-grid returns both brackets
 * and NO value.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { type Quantity, convert, pounds } from '@rms/kernel-units';

/** The 21 ft boundary, in inches, as published. */
export const FRAME_HEIGHT_BAND_BOUNDARY_IN = 21 * 12;

export type FrameHeightBand = 'lte21ft' | 'gt21ft';

export interface FrameVariant {
  readonly model: string;
  /** True when the model publishes separate ≤21ft / >21ft columns. */
  readonly banded: boolean;
}

export interface FrameTable {
  readonly tableId: string;
  readonly pageRef: string;
  readonly loadBasis: string;
  readonly columnOrder: readonly string[];
  readonly variants: readonly FrameVariant[];
  /** HbL in whole inches → one capacity per column, in publication order. */
  readonly rows: ReadonlyMap<number, readonly number[]>;
}

export interface FrameKey {
  readonly model: string;
  /** Governing HbL: the greater of max beam spacing and floor-to-first-beam. */
  readonly hbl: Quantity;
  /** Overall frame height, used only to derive the band. */
  readonly overallHeight: Quantity;
}

export type FrameLookupResult =
  | {
      readonly status: 'ON_GRID';
      readonly capacity: Quantity;
      readonly column: string;
      readonly band: FrameHeightBand | null;
    }
  | {
      readonly status: 'OFF_GRID';
      readonly lowerHblIn: number | null;
      readonly upperHblIn: number | null;
      readonly publishedHblIn: readonly number[];
    }
  | { readonly status: 'NOT_FOUND'; readonly reason: string };

export class FrameCatalogError extends Error {
  override readonly name = 'FrameCatalogError';
}

/**
 * Which band an overall frame height falls in.
 *
 * The boundary is inclusive at 21 ft: the published columns are "≤21'" and
 * ">21'", so a frame of exactly 252 in is in the LOWER band. An off-by-one here
 * silently selects the more generous column, which is the direction that hurts.
 */
export function bandFor(overallHeight: Quantity): FrameHeightBand {
  return convert(overallHeight, 'in') <= FRAME_HEIGHT_BAND_BOUNDARY_IN ? 'lte21ft' : 'gt21ft';
}

/**
 * The governing HbL for a set of levels.
 *
 * Published definition, from all three charts: the maximum beam spacing OR the
 * distance from the floor to the top of the first beam, whichever is greater.
 * The floor-to-first-beam gap is INCLUDED — this was previously filed as an
 * interpretation decision and is in fact published basis.
 */
export function governingHbl(elevationsAscending: readonly Quantity[]): Quantity {
  if (elevationsAscending.length === 0) {
    throw new FrameCatalogError('governing HbL needs at least one beam level.');
  }
  let maxGap = convert(elevationsAscending[0] as Quantity, 'um'); // floor to first beam
  for (let i = 1; i < elevationsAscending.length; i += 1) {
    const gap =
      convert(elevationsAscending[i] as Quantity, 'um') -
      convert(elevationsAscending[i - 1] as Quantity, 'um');
    if (gap < 0) {
      throw new FrameCatalogError('beam elevations must ascend to compute a governing HbL.');
    }
    if (gap > maxGap) maxGap = gap;
  }
  return { value: maxGap, unit: 'um', origin: 'DERIVED' };
}

/** The column name for a model in a given band, matching the published header. */
function columnFor(variant: FrameVariant, band: FrameHeightBand): string {
  if (!variant.banded) return variant.model;
  return band === 'lte21ft' ? `${variant.model}@<=21ft` : `${variant.model}@>21ft`;
}

export class FrameCatalog {
  private readonly tables: readonly FrameTable[];

  constructor(tables: readonly FrameTable[]) {
    this.tables = Object.freeze([...tables]);
    Object.freeze(this);
  }

  get tableCount(): number {
    return this.tables.length;
  }

  /** Total published cells, for asserting the extraction is complete. */
  get cellCount(): number {
    let n = 0;
    for (const t of this.tables) {
      for (const values of t.rows.values()) n += values.length;
    }
    return n;
  }

  /** Every model published across all three tables, sorted. */
  models(): readonly string[] {
    const out = new Set<string>();
    for (const t of this.tables) {
      for (const v of t.variants) out.add(v.model);
    }
    return Object.freeze([...out].sort());
  }

  publishedHbl(model: string): readonly number[] {
    for (const t of this.tables) {
      if (t.variants.some((v) => v.model === model)) {
        return Object.freeze([...t.rows.keys()].sort((a, b) => a - b));
      }
    }
    return Object.freeze([]);
  }

  /**
   * Look up a frame capacity. Exact grid only: an unpublished HbL returns both
   * brackets and no value, never a nearest match and never an interpolation.
   */
  lookup(key: FrameKey): FrameLookupResult {
    const table = this.tables.find((t) => t.variants.some((v) => v.model === key.model));
    if (table === undefined) {
      return { status: 'NOT_FOUND', reason: `model '${key.model}' is not published in this release` };
    }
    const variant = table.variants.find((v) => v.model === key.model) as FrameVariant;

    const band = bandFor(key.overallHeight);
    const column = columnFor(variant, band);
    const columnIndex = table.columnOrder.indexOf(column);
    if (columnIndex < 0) {
      return {
        status: 'NOT_FOUND',
        reason: `no published column '${column}' for model '${key.model}'`,
      };
    }

    const hblIn = convert(key.hbl, 'in');
    const published = [...table.rows.keys()].sort((a, b) => a - b);

    const exact = table.rows.get(hblIn);
    if (exact !== undefined) {
      const value = exact[columnIndex] as number;
      return {
        status: 'ON_GRID',
        // Per PAIR of frames, as published. Basis-bound so it refuses
        // conversion to a per-frame figure — the trap that halves a rating.
        capacity: pounds(value, 'CATALOG'),
        column,
        band: variant.banded ? band : null,
      };
    }

    let lower: number | null = null;
    let upper: number | null = null;
    for (const h of published) {
      if (h < hblIn) lower = h;
      if (h > hblIn && upper === null) upper = h;
    }
    return {
      status: 'OFF_GRID',
      lowerHblIn: lower,
      upperHblIn: upper,
      publishedHblIn: Object.freeze(published),
    };
  }
}
