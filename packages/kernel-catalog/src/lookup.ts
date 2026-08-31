/**
 * Beam capacity lookup — exact grid only, never interpolated.
 *
 * This is the single most important behaviour in the engine (blueprint §10.4).
 * The rules, each of which the reference projects proved the hard way:
 *
 *   - NEVER interpolate a published capacity table. An off-grid span returns
 *     both bracketing spans and NO value.
 *   - NEVER nearest-match a part. "Not found" is not "probably this one".
 *   - Used or generic material gets NO capacity, ever, and its trace shows no
 *     table basis at all — because no table was read.
 *   - Basis before number: a lookup is keyed on (family, series, span), and a
 *     span the manufacturer never published is off-grid, full stop.
 *
 * Spans are matched on exact micrometres, which is the entire reason lengths are
 * stored in µm: every published inch span lands on a whole µm and matches its
 * own key. Under integer millimetres, 18 of the 21 published spans miss their
 * key and every lookup silently goes off-grid.
 */

import { type Quantity, poundsPerPair, convert, inches } from '@rms/kernel-units';

/** One published row, as loaded from the declarative catalog data. */
export interface BeamRow {
  readonly family: string;
  readonly series: string;
  readonly faceHeightIn: number;
  readonly spanIn: number;
  readonly partNumber: string;
  readonly code18: string;
  readonly capacityLbs: number;
}

/** A beam lookup key. Series is a real axis: 40E differs between F3M and F4M. */
export interface BeamKey {
  readonly family: string;
  readonly series: string;
  /** The requested span, as a length quantity (stored µm). */
  readonly span: Quantity;
}

export type LookupResult =
  | {
      readonly status: 'ON_GRID';
      readonly capacity: Quantity; // lb/pr — basis-bound, never per-beam
      readonly partNumber: string;
      readonly code18: string;
    }
  | {
      /** The requested span is not a published span for this family/series. */
      readonly status: 'OFF_GRID';
      readonly lowerSpan: Quantity | null;
      readonly upperSpan: Quantity | null;
    }
  | {
      /** No such family/series exists in the release at all. */
      readonly status: 'NOT_FOUND';
    };

/**
 * An indexed release, built once from the rows. The index is keyed by
 * (family, series) so a lookup is a single map hit plus an exact-span match.
 */
export class BeamCatalog {
  private readonly bySeries: Map<string, BeamRow[]>;

  constructor(rows: readonly BeamRow[]) {
    this.bySeries = new Map();
    for (const row of rows) {
      const key = BeamCatalog.seriesKey(row.family, row.series);
      const list = this.bySeries.get(key);
      if (list === undefined) {
        this.bySeries.set(key, [row]);
      } else {
        list.push(row);
      }
    }
    // Sort each series by span so bracket-finding is a linear scan on sorted data.
    for (const list of this.bySeries.values()) {
      list.sort((a, b) => a.spanIn - b.spanIn);
    }
  }

  private static seriesKey(family: string, series: string): string {
    return `${family}\u0000${series}`;
  }

  /**
   * Look up a beam capacity for an exact span.
   *
   * The span quantity is converted to whole inches for comparison against the
   * published grid; because storage is µm, that conversion is exact for every
   * published span. A span that is not published returns OFF_GRID with both
   * brackets and no capacity — never a nearest match, never an interpolation.
   */
  lookup(key: BeamKey): LookupResult {
    const rows = this.bySeries.get(BeamCatalog.seriesKey(key.family, key.series));
    if (rows === undefined || rows.length === 0) {
      return { status: 'NOT_FOUND' };
    }

    const requestedIn = convert(key.span, 'in');

    const exact = rows.find((r) => r.spanIn === requestedIn);
    if (exact !== undefined) {
      return {
        status: 'ON_GRID',
        // A published capacity is per PAIR. Basis-bound: it will refuse
        // conversion to a per-beam pound value, which is the trap that silently
        // halves or doubles a rating.
        capacity: poundsPerPair(exact.capacityLbs, 'CATALOG'),
        partNumber: exact.partNumber,
        code18: exact.code18,
      };
    }

    // Off grid. Report both brackets so the UI can say "between 84 and 96",
    // and NO capacity, because interpolating a published table is forbidden.
    let lower: BeamRow | null = null;
    let upper: BeamRow | null = null;
    for (const row of rows) {
      if (row.spanIn < requestedIn) lower = row;
      if (row.spanIn > requestedIn) {
        upper = row;
        break;
      }
    }

    return {
      status: 'OFF_GRID',
      lowerSpan: lower === null ? null : inches(lower.spanIn, 'CATALOG'),
      upperSpan: upper === null ? null : inches(upper.spanIn, 'CATALOG'),
    };
  }

  /** Every published span for a family/series, ascending. Empty if none. */
  publishedSpans(family: string, series: string): readonly number[] {
    const rows = this.bySeries.get(BeamCatalog.seriesKey(family, series)) ?? [];
    return rows.map((r) => r.spanIn);
  }

  get size(): number {
    let n = 0;
    for (const list of this.bySeries.values()) n += list.length;
    return n;
  }
}
