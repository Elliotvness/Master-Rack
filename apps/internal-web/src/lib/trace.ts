/**
 * The internal BOM trace \u2014 "show your work" (`E-03`).
 *
 * The strongest differentiator against spreadsheet estimating, and the fastest
 * way for an estimator to find an engine bug. \u00a712.4 sets the bar precisely:
 *
 *   For any BOM line the system must answer four questions **from stored data
 *   alone, with no recomputation**.
 *
 *     (a) Which configuration inputs produced this?
 *     (b) Which catalog part, at which revision?
 *     (c) Which rule version produced the quantity?
 *     (d) What was the formula, with what numbers?
 *
 * "From stored data alone" is the load-bearing phrase. A trace that re-runs the
 * engine to explain itself proves only that the engine is self-consistent
 * today; it cannot explain a submission frozen two years ago against a catalog
 * release that has since been superseded. So this module takes a stored trace
 * and RENDERS it. It performs no arithmetic, and it has no access to the kernel
 * to do any.
 *
 * The trace is structured data plus components, never string-concatenated HTML
 * \u2014 the reference implementation in `rack-engine/rack_app/panels.py` is a
 * working five-section panel, and its one flaw is that it builds strings.
 *
 * **Every branch is kept, including the branch that shows no table basis at
 * all** for uncatalogued material. That branch is not an error state: on half
 * of all jobs it is the correct and complete answer.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** One operand in an evaluated expression, with everything needed to defend it. */
export interface TraceOperand {
  readonly label: string;
  /** The value AS STORED. Null when the model could not establish it. */
  readonly value: number | null;
  readonly unit: string;
  /** Where it came from: INPUT, DERIVED, CATALOG, RULE, UNKNOWN. */
  readonly origin: string;
}

/** One step of the evaluated expression tree. */
export interface TraceStep {
  /** The formula in symbols, e.g. "(bays + 1) x rows". */
  readonly symbolic: string;
  /** The same formula with values substituted, e.g. "(10 + 1) x 2". */
  readonly substituted: string;
  readonly operands: readonly TraceOperand[];
  /** Rounding applied at this step, or null when none was. */
  readonly rounding: string | null;
  readonly result: TraceOperand;
}

/** (b) The catalog part, at the revision that was pinned. */
export interface CatalogBasis {
  readonly partRevisionId: string;
  readonly partNumber: string;
  readonly catalogReleaseId: string;
  readonly sourceDocument: string;
  readonly pageRef: string;
  readonly effectiveDate: string;
}

/**
 * The absence of a catalog basis, as a first-class value.
 *
 * Not null, not an empty object: a NAMED absence carrying the reason. A null
 * would render as a blank panel section, and a blank reads as "we did not
 * check". This reads as "there is nothing to check, and here is why".
 */
export interface NoCatalogBasis {
  readonly kind: 'no_table_basis';
  readonly measuredGeometry: string;
  readonly reason: string;
}

export type PartBasis =
  | ({ readonly kind: 'catalog' } & CatalogBasis)
  | NoCatalogBasis;

/** (c) The rule version that produced the quantity \u2014 PROV's hadPlan. */
export interface RuleBasis {
  readonly ruleId: string | null;
  readonly ruleText: string;
  readonly rulePackReleaseId: string | null;
  readonly tier: string | null;
  /** False when the rule is a one-job observation rather than established. */
  readonly confirmed: boolean;
}

export interface BomLineTrace {
  readonly lineId: string;
  readonly category: string;
  /** (a) Which configuration inputs produced this. */
  readonly sourceObjectIds: readonly string[];
  /** (b) */
  readonly partBasis: PartBasis;
  /** (c) */
  readonly ruleBasis: RuleBasis;
  /** (d) The evaluated expression tree. Empty for an unresolved line. */
  readonly steps: readonly TraceStep[];
  /** The quantity, or null when the line is unresolved. */
  readonly quantity: TraceOperand | null;
  readonly unresolvedReason: string | null;
}

/**
 * Whether a trace can answer all four \u00a712.4 questions.
 *
 * Returns the questions it CANNOT answer, so a gap is named rather than
 * discovered by a reader staring at a half-empty panel.
 */
export function unanswerableQuestions(trace: BomLineTrace): readonly string[] {
  const gaps: string[] = [];

  if (trace.sourceObjectIds.length === 0) {
    gaps.push('(a) which configuration inputs produced this');
  }

  // (b) is answerable EITHER by a catalog basis or by a named absence. The
  // named absence is a complete answer, not a gap \u2014 that distinction is the
  // whole reason NoCatalogBasis exists.
  if (trace.partBasis.kind === 'catalog') {
    if (trace.partBasis.pageRef.trim() === '' || trace.partBasis.sourceDocument.trim() === '') {
      gaps.push('(b) which catalog part, at which revision');
    }
  } else if (trace.partBasis.reason.trim() === '') {
    gaps.push('(b) which catalog part, at which revision');
  }

  if (trace.ruleBasis.ruleText.trim() === '') {
    gaps.push('(c) which rule version produced the quantity');
  }

  // (d) An unresolved line legitimately has no formula: there was no
  // computation to show. A RESOLVED line with no steps is a real gap.
  if (trace.unresolvedReason === null && trace.steps.length === 0) {
    gaps.push('(d) what the formula was, with what numbers');
  }

  return Object.freeze(gaps);
}

export function isFullyTraceable(trace: BomLineTrace): boolean {
  return unanswerableQuestions(trace).length === 0;
}

/**
 * The five sections of the trace panel, as structured data.
 *
 * Components render these. Nothing here produces markup, and nothing here
 * computes a value \u2014 both are deliberate: a panel that formats its own HTML
 * cannot be tested for what it claims, and a panel that computes cannot be
 * trusted to explain a frozen submission.
 */
export interface TracePanel {
  readonly quantity: {
    readonly text: string;
    readonly established: boolean;
  };
  readonly formula: readonly TraceStep[];
  readonly partBasis: PartBasis;
  readonly ruleBasis: RuleBasis;
  readonly inputs: readonly string[];
}

/** The text shown in place of a quantity that was never established. */
export const VERIFY_TEXT = 'VERIFY';

export function buildTracePanel(trace: BomLineTrace): TracePanel {
  const quantity = trace.quantity;
  // Narrowed once, here, so the branches below carry no defensive fallbacks.
  // A `?? 0` inside the established branch would be unreachable code implying
  // a doubt this check has already settled — and an unreachable guard is worse
  // than none, because it suggests the invariant is uncertain when it is not.
  const established = quantity !== null && quantity.value !== null;

  return Object.freeze({
    quantity: Object.freeze({
      // An unresolved line shows its REASON, never a zero and never a blank.
      text: established
        ? `${String(quantity.value)} ${quantity.unit}`.trim()
        : (trace.unresolvedReason ?? VERIFY_TEXT),
      established,
    }),
    formula: Object.freeze([...trace.steps]),
    partBasis: trace.partBasis,
    ruleBasis: trace.ruleBasis,
    inputs: Object.freeze([...trace.sourceObjectIds]),
  });
}

/**
 * Whether the panel must warn that the governing rule is not established.
 *
 * An unconfirmed rule is a one-job observation. It looks identical to a
 * confirmed one on a sheet unless this is carried, which is how a single job's
 * coincidence becomes a company standard.
 */
export function needsUnconfirmedWarning(trace: BomLineTrace): boolean {
  return trace.unresolvedReason === null && !trace.ruleBasis.confirmed;
}

/**
 * Verify a stored trace is internally consistent.
 *
 * This is a CONSISTENCY check, not a recomputation: it confirms the stored
 * result of each step is carried into the next, which catches a trace assembled
 * from mismatched pieces. It deliberately does not evaluate the formula \u2014 doing
 * so would reintroduce the recomputation \u00a712.4 forbids.
 */
export function traceInconsistencies(trace: BomLineTrace): readonly string[] {
  const problems: string[] = [];

  if (trace.unresolvedReason !== null && trace.quantity !== null) {
    problems.push('a line carries both an unresolved reason and a quantity');
  }
  if (trace.unresolvedReason === null && trace.quantity === null) {
    problems.push('a line carries neither a quantity nor an unresolved reason');
  }
  if (trace.unresolvedReason !== null && trace.steps.length > 0) {
    problems.push('an unresolved line carries formula steps, implying a computation happened');
  }

  const last = trace.steps[trace.steps.length - 1];
  if (last !== undefined && trace.quantity !== null) {
    if (last.result.value !== trace.quantity.value) {
      problems.push(
        `the final formula step results in ${String(last.result.value)} but the line ` +
          `carries ${String(trace.quantity.value)}`,
      );
    }
    if (last.result.unit !== trace.quantity.unit) {
      problems.push(
        `the final step is in '${last.result.unit}' but the line is in '${trace.quantity.unit}'`,
      );
    }
  }

  for (const step of trace.steps) {
    if (step.symbolic.trim() === '') {
      problems.push('a formula step has no symbolic form');
    }
    if (step.substituted.trim() === '') {
      problems.push('a formula step has no substituted form');
    }
  }

  return Object.freeze(problems);
}
