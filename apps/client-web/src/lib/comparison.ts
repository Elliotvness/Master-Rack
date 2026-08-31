/**
 * Option comparison (`D-06`).
 *
 * A client configures two or three options and wants to know which is better.
 * The blueprint constrains what "better" may mean here, and the constraint is
 * the whole design:
 *
 *   **Comparison never shows cost, price, part count or any BOM quantity.**
 *
 * That is not a simplification for MVP. Part counts and quantities ARE the
 * internal takeoff, and the takeoff is the value the product exists to protect
 * (`R-02`). A comparison table is exactly where they would leak, because a
 * column of numbers looks harmless next to another column of numbers.
 *
 * So the comparable metrics are enumerated here as a closed set, and anything
 * outside it is refused rather than filtered. A closed set is greppable; a
 * filter is a place someone adds one more field.
 *
 * The second rule, from §11.1: **missing input must be visually distinct from
 * engineering review.** In a comparison that matters more, not less — a column
 * with three "issues" is unreadable if one is a task and two are notifications.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { groupFindings, type ClientFinding } from './preview.js';

/**
 * The ONLY metrics a client comparison may show.
 *
 * Enumerated deliberately. Adding a metric means editing this list, which is a
 * review point — and the review question is always the same: does this reveal
 * anything about how the job is built rather than what it does?
 */
export const COMPARABLE_METRICS = Object.freeze([
  'netPositions',
  'aisleClearWidthIn',
  'topOfLoadIn',
  'storageLevels',
] as const);

export type ComparableMetric = (typeof COMPARABLE_METRICS)[number];

/**
 * Metrics that must NEVER appear in a comparison, named so the refusal is
 * explicit rather than implied by omission.
 *
 * Part counts and quantities are the internal takeoff. Cost and price do not
 * exist in the system at all in MVP-1, and are listed anyway: a constant that
 * only forbids what currently exists stops working the moment something new
 * arrives.
 */
export const FORBIDDEN_COMPARISON_METRICS = Object.freeze([
  'cost',
  'unitCost',
  'landedCost',
  'price',
  'buyPrice',
  'margin',
  'marginPct',
  'discount',
  'supplier',
  'mpn',
  'partNumber',
  'partCount',
  'frameCount',
  'beamCount',
  'anchorCount',
  'bom',
  'bomLine',
  'quantity',
  'qty',
  'itemSnapshot',
  'capacity',
  'catalogRelease',
  'internalNote',
]);

export class ComparisonError extends Error {
  override readonly name = 'ComparisonError';
}

/** One option, reduced to what a client may compare. */
export interface ComparableOption {
  readonly optionId: string;
  readonly label: string;
  /**
   * A metric is a number or null. Null means the model could not establish it,
   * and the column renders VERIFY rather than a blank or a zero — a blank cell
   * in a comparison reads as "none", which is a claim.
   */
  readonly metrics: Readonly<Partial<Record<ComparableMetric, number | null>>>;
  readonly findings: readonly ClientFinding[];
}

/**
 * Build a comparable option, refusing any forbidden metric.
 *
 * The refusal is a throw rather than a filter. A filter would silently drop the
 * field and leave the caller believing it was shown; a throw fails in
 * development, on the first attempt, with the field named.
 */
export function comparableOption(input: {
  readonly optionId: string;
  readonly label: string;
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly findings: readonly ClientFinding[];
}): ComparableOption {
  const allowed: Partial<Record<ComparableMetric, number | null>> = {};

  for (const [key, value] of Object.entries(input.metrics)) {
    const forbidden = FORBIDDEN_COMPARISON_METRICS.find(
      (f) => f.toLowerCase() === key.toLowerCase(),
    );
    if (forbidden !== undefined) {
      throw new ComparisonError(
        `'${key}' may not appear in a client comparison. Part counts, quantities and ` +
          'anything priced are the internal takeoff, which is the value this product ' +
          'exists to protect.',
      );
    }
    if (!(COMPARABLE_METRICS as readonly string[]).includes(key)) {
      throw new ComparisonError(
        `'${key}' is not a comparable metric. The comparable set is closed: ` +
          `${COMPARABLE_METRICS.join(', ')}. Adding one is a deliberate change, not a default.`,
      );
    }
    allowed[key as ComparableMetric] = value;
  }

  return Object.freeze({
    optionId: input.optionId,
    label: input.label,
    metrics: Object.freeze(allowed),
    findings: Object.freeze([...input.findings]),
  });
}

export interface ComparisonRow {
  readonly metric: ComparableMetric;
  /** One cell per option, in the order the options were given. */
  readonly values: readonly (number | null)[];
  /**
   * True when at least one option could not establish this metric. The row
   * renders VERIFY in those cells and must not be used to rank.
   */
  readonly hasUnestablished: boolean;
}

export interface ComparisonTable {
  readonly options: readonly ComparableOption[];
  readonly rows: readonly ComparisonRow[];
}

/**
 * Build the comparison table.
 *
 * Rows appear in the fixed order of `COMPARABLE_METRICS` rather than the order
 * the first option happened to supply them, so two comparisons of the same
 * options always read the same way.
 */
export function compare(options: readonly ComparableOption[]): ComparisonTable {
  if (options.length < 2) {
    throw new ComparisonError('a comparison needs at least two options.');
  }
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.optionId)) {
      throw new ComparisonError(`duplicate option id '${o.optionId}' in a comparison.`);
    }
    seen.add(o.optionId);
  }

  const rows: ComparisonRow[] = [];
  for (const metric of COMPARABLE_METRICS) {
    const present = options.some((o) => metric in o.metrics);
    if (!present) continue;

    const values = options.map((o) => o.metrics[metric] ?? null);
    rows.push(
      Object.freeze({
        metric,
        values: Object.freeze(values),
        hasUnestablished: values.some((v) => v === null),
      }),
    );
  }

  return Object.freeze({
    options: Object.freeze([...options]),
    rows: Object.freeze(rows),
  });
}

/**
 * Whether a row may be used to rank the options.
 *
 * A row with an unestablished value cannot be ranked: comparing a number to
 * VERIFY produces an ordering the model cannot defend, and the client would
 * read it as a real preference.
 */
export function rankable(row: ComparisonRow): boolean {
  return !row.hasUnestablished;
}

export interface OptionSummary {
  readonly optionId: string;
  readonly label: string;
  readonly blockerCount: number;
  /** Tasks the client can do. Kept apart from review items, per §11.1. */
  readonly actionCount: number;
  /** Notifications, not tasks. */
  readonly reviewCount: number;
  readonly submittable: boolean;
}

/**
 * Per-option finding summary for the comparison header.
 *
 * The three counts stay separate for the same reason they do in the findings
 * panel: a single "3 issues" badge tells the client nothing about whether they
 * have work to do.
 */
export function summariseOptions(table: ComparisonTable): readonly OptionSummary[] {
  return Object.freeze(
    table.options.map((o) => {
      const g = groupFindings(o.findings);
      return Object.freeze({
        optionId: o.optionId,
        label: o.label,
        blockerCount: g.blockers.length,
        actionCount: g.blockers.length + g.missingInputs.length,
        reviewCount: g.forReview.length,
        submittable: g.blockers.length === 0,
      });
    }),
  );
}
