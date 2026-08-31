import { describe, expect, it } from 'vitest';

import {
  VERIFY_TEXT,
  buildTracePanel,
  isFullyTraceable,
  needsUnconfirmedWarning,
  traceInconsistencies,
  unanswerableQuestions,
  type BomLineTrace,
  type PartBasis,
  type TraceStep,
} from './index.js';

const catalogBasis: PartBasis = {
  kind: 'catalog',
  partRevisionId: 'pr-1',
  partNumber: 'IB59ET09600',
  catalogReleaseId: 'rel-2026-08',
  sourceDocument: 'Interlake Mecalux PSG 2025',
  pageRef: 'p.8',
  effectiveDate: '2026-08-01',
};

const noBasis: PartBasis = {
  kind: 'no_table_basis',
  measuredGeometry: '3" x 1.625" step beam, 96" long',
  reason:
    'This material is not in the pinned catalog, so no published capacity exists for it. ' +
    'Capacity cannot be established from geometry.',
};

const frameStep: TraceStep = {
  symbolic: '(bays + 1) x rows',
  substituted: '(10 + 1) x 2',
  operands: [
    { label: 'bays', value: 10, unit: 'ea', origin: 'INPUT' },
    { label: 'rows', value: 2, unit: 'ea', origin: 'INPUT' },
  ],
  rounding: null,
  result: { label: 'frames', value: 22, unit: 'ea', origin: 'DERIVED' },
};

function trace(over: Partial<BomLineTrace> = {}): BomLineTrace {
  return {
    lineId: 'line-1',
    category: 'FRAME',
    sourceObjectIds: ['run-1'],
    partBasis: catalogBasis,
    ruleBasis: {
      ruleId: 'BOM-FRAME-COUNT',
      ruleText: 'frames = (bays + 1) x rows; back-to-back rows do not share frames',
      rulePackReleaseId: 'rules-2026-08',
      tier: 'PRIMARY',
      confirmed: true,
    },
    steps: [frameStep],
    quantity: { label: 'frames', value: 22, unit: 'ea', origin: 'DERIVED' },
    unresolvedReason: null,
    ...over,
  };
}

describe('\u00a712.4 \u2014 four questions answered from stored data alone', () => {
  it('answers all four for a resolved catalog line', () => {
    expect(unanswerableQuestions(trace())).toEqual([]);
    expect(isFullyTraceable(trace())).toBe(true);
  });

  it('(a) names a gap when no configuration input is recorded', () => {
    const gaps = unanswerableQuestions(trace({ sourceObjectIds: [] }));
    expect(gaps.join(' ')).toMatch(/\(a\)/);
  });

  it('(b) names a gap when the catalog basis has no page reference', () => {
    // "Which catalog part, at which revision" is only answered if the source
    // document and page can actually be turned to.
    const gaps = unanswerableQuestions(
      trace({ partBasis: { ...catalogBasis, kind: 'catalog', pageRef: '  ' } }),
    );
    expect(gaps.join(' ')).toMatch(/\(b\)/);
  });

  it('(c) names a gap when no rule text is recorded', () => {
    const gaps = unanswerableQuestions(
      trace({ ruleBasis: { ...trace().ruleBasis, ruleText: '' } }),
    );
    expect(gaps.join(' ')).toMatch(/\(c\)/);
  });

  it('(d) names a gap when a RESOLVED line carries no formula', () => {
    const gaps = unanswerableQuestions(trace({ steps: [] }));
    expect(gaps.join(' ')).toMatch(/\(d\)/);
  });

  it('reports EVERY unanswered question, not just the first', () => {
    const gaps = unanswerableQuestions(
      trace({
        sourceObjectIds: [],
        steps: [],
        ruleBasis: { ...trace().ruleBasis, ruleText: '' },
      }),
    );
    expect(gaps.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the branch that shows NO table basis at all', () => {
  // Kept deliberately. On half of all jobs this is the correct and complete
  // answer, not a degraded one.

  it('treats a named absence as a COMPLETE answer to (b), not a gap', () => {
    const t = trace({ partBasis: noBasis });
    expect(unanswerableQuestions(t)).toEqual([]);
    expect(isFullyTraceable(t)).toBe(true);
  });

  it('carries the measured geometry and the reason, never a blank', () => {
    const panel = buildTracePanel(trace({ partBasis: noBasis }));
    expect(panel.partBasis.kind).toBe('no_table_basis');
    if (panel.partBasis.kind === 'no_table_basis') {
      expect(panel.partBasis.measuredGeometry).toMatch(/step beam/);
      expect(panel.partBasis.reason.length).toBeGreaterThan(40);
    }
  });

  it('names a gap only when the absence has NO reason', () => {
    // An unexplained absence really is a gap: it reads as "we did not check".
    const gaps = unanswerableQuestions(
      trace({ partBasis: { ...noBasis, kind: 'no_table_basis', reason: '   ' } }),
    );
    expect(gaps.join(' ')).toMatch(/\(b\)/);
  });

  it('carries no capacity field on the absent basis', () => {
    expect(Object.keys(noBasis).sort()).toEqual(['kind', 'measuredGeometry', 'reason']);
  });
});

describe('the trace panel renders, and computes nothing', () => {
  it('shows the formula in symbols AND with values substituted', () => {
    // The differentiator against a spreadsheet: an estimator can see both.
    const panel = buildTracePanel(trace());
    expect(panel.formula[0]?.symbolic).toBe('(bays + 1) x rows');
    expect(panel.formula[0]?.substituted).toBe('(10 + 1) x 2');
  });

  it('carries every operand with its unit and origin', () => {
    const panel = buildTracePanel(trace());
    for (const operand of panel.formula[0]?.operands ?? []) {
      expect(operand.unit).not.toBe('');
      expect(operand.origin).not.toBe('');
    }
  });

  it('shows the rule that selected the part, and the catalog release', () => {
    const panel = buildTracePanel(trace());
    expect(panel.ruleBasis.ruleText).toMatch(/back-to-back rows do not share frames/);
    if (panel.partBasis.kind === 'catalog') {
      expect(panel.partBasis.catalogReleaseId).toBe('rel-2026-08');
      expect(panel.partBasis.effectiveDate).toBe('2026-08-01');
    }
  });

  it('shows an unresolved line\u2019s REASON, never a zero and never a blank', () => {
    const panel = buildTracePanel(
      trace({
        quantity: null,
        steps: [],
        unresolvedReason: 'Deck count depends on a support rule the catalog does not publish.',
      }),
    );
    expect(panel.quantity.established).toBe(false);
    expect(panel.quantity.text).toMatch(/does not publish/);
    expect(panel.quantity.text).not.toBe('0');
  });

  it('falls back to VERIFY when a quantity is neither established nor explained', () => {
    const panel = buildTracePanel(trace({ quantity: null, steps: [] }));
    expect(panel.quantity.text).toBe(VERIFY_TEXT);
  });

  it('produces structured data, not markup', () => {
    // A panel that formats its own HTML cannot be tested for what it claims.
    const panel = buildTracePanel(trace());
    expect(JSON.stringify(panel)).not.toMatch(/<[a-z]/i);
  });
});

describe('an unconfirmed rule is flagged, because it looks identical otherwise', () => {
  it('warns when the governing rule is a one-job observation', () => {
    // How a single job's coincidence becomes a company standard.
    expect(
      needsUnconfirmedWarning(trace({ ruleBasis: { ...trace().ruleBasis, confirmed: false } })),
    ).toBe(true);
  });

  it('does not warn on a confirmed rule', () => {
    expect(needsUnconfirmedWarning(trace())).toBe(false);
  });

  it('does not warn on an unresolved line, which has no rule to doubt', () => {
    expect(
      needsUnconfirmedWarning(
        trace({
          quantity: null,
          steps: [],
          unresolvedReason: 'no sourced rule',
          ruleBasis: { ...trace().ruleBasis, confirmed: false },
        }),
      ),
    ).toBe(false);
  });
});

describe('a stored trace is checked for consistency, NOT recomputed', () => {
  // Re-running the engine to explain itself proves only that it is
  // self-consistent today. It cannot explain a submission frozen two years ago.

  it('accepts a consistent trace', () => {
    expect(traceInconsistencies(trace())).toEqual([]);
  });

  it('catches a final step that disagrees with the line quantity', () => {
    const problems = traceInconsistencies(
      trace({ quantity: { label: 'frames', value: 21, unit: 'ea', origin: 'DERIVED' } }),
    );
    expect(problems.join(' ')).toMatch(/results in 22 but the line carries 21/);
  });

  it('catches a unit mismatch between the final step and the line', () => {
    const problems = traceInconsistencies(
      trace({ quantity: { label: 'frames', value: 22, unit: 'lb', origin: 'DERIVED' } }),
    );
    expect(problems.join(' ')).toMatch(/final step is in 'ea' but the line is in 'lb'/);
  });

  it('catches a line carrying BOTH a quantity and an unresolved reason', () => {
    const problems = traceInconsistencies(trace({ unresolvedReason: 'because' }));
    expect(problems.join(' ')).toMatch(/both an unresolved reason and a quantity/);
  });

  it('catches a line carrying NEITHER', () => {
    const problems = traceInconsistencies(trace({ quantity: null, steps: [] }));
    expect(problems.join(' ')).toMatch(/neither a quantity nor an unresolved reason/);
  });

  it('catches an unresolved line that carries formula steps', () => {
    // If there was a computation, the line is not unresolved.
    const problems = traceInconsistencies(
      trace({ quantity: null, unresolvedReason: 'no rule' }),
    );
    expect(problems.join(' ')).toMatch(/implying a computation happened/);
  });

  it('catches a formula step with no symbolic or substituted form', () => {
    expect(
      traceInconsistencies(trace({ steps: [{ ...frameStep, symbolic: '  ' }] })).join(' '),
    ).toMatch(/no symbolic form/);
    expect(
      traceInconsistencies(trace({ steps: [{ ...frameStep, substituted: '' }] })).join(' '),
    ).toMatch(/no substituted form/);
  });

  it('accepts a correctly unresolved line', () => {
    expect(
      traceInconsistencies(
        trace({ quantity: null, steps: [], unresolvedReason: 'no sourced rule' }),
      ),
    ).toEqual([]);
  });
});
