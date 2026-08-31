import { describe, expect, it } from 'vitest';

import {
  COMPARABLE_METRICS,
  ComparisonError,
  FORBIDDEN_COMPARISON_METRICS,
  comparableOption,
  compare,
  rankable,
  summariseOptions,
  type ClientFinding,
} from './index.js';

function finding(severity: ClientFinding['severity'], code = 'X'): ClientFinding {
  return { code, severity, closedBy: 'do the thing', subjectObjectIds: [] };
}

function option(id: string, metrics: Record<string, number | null>, findings: ClientFinding[] = []) {
  return comparableOption({ optionId: id, label: `Option ${id}`, metrics, findings });
}

describe('a comparison never reveals the internal takeoff', () => {
  // Part counts and quantities ARE the takeoff, and the takeoff is the value
  // this product exists to protect (R-02). A comparison table is exactly where
  // they leak, because a column of numbers looks harmless beside another.

  it('refuses every forbidden metric BY NAME', () => {
    for (const forbidden of FORBIDDEN_COMPARISON_METRICS) {
      expect(
        () => option('a', { [forbidden]: 42 }),
        `'${forbidden}' must be refused in a client comparison`,
      ).toThrow(ComparisonError);
    }
  });

  it('refuses regardless of casing, so PartCount is caught too', () => {
    expect(() => option('a', { PartCount: 12 })).toThrow(ComparisonError);
    expect(() => option('a', { QTY: 12 })).toThrow(ComparisonError);
    expect(() => option('a', { Cost: 12 })).toThrow(ComparisonError);
  });

  it('THROWS rather than filtering, so the caller cannot believe it was shown', () => {
    // A filter would silently drop the field and leave the screen looking
    // correct while the developer believes the column exists.
    expect(() => option('a', { netPositions: 100, cost: 5 })).toThrow(/may not appear/);
  });

  it('refuses an unknown metric rather than passing it through', () => {
    // The comparable set is CLOSED. Anything new is a deliberate change.
    expect(() => option('a', { somethingNew: 1 })).toThrow(/not a comparable metric/);
    expect(() => option('a', { somethingNew: 1 })).toThrow(/set is closed/);
  });

  it('bans the same families the API\u2019s forbidden-field constant does', () => {
    // The API's FORBIDDEN_CLIENT_FIELDS is deliberately NOT imported here: a
    // client bundle that can import from @rms/api has already lost the
    // separation the two-app design exists to create, and tools/check-app-
    // boundaries.mjs fails the build if one ever does.
    //
    // So the overlap is asserted by FAMILY rather than by shared constant.
    // Duplicating the list would be worse: two lists drift, and the drift is
    // silent.
    const banned = FORBIDDEN_COMPARISON_METRICS.map((f) => f.toLowerCase());
    for (const family of ['cost', 'price', 'margin', 'discount', 'qty', 'count', 'capacity']) {
      expect(
        banned.some((b) => b.includes(family)),
        `the '${family}' family must be banned from comparison`,
      ).toBe(true);
    }
  });

  it('allows the four comparable metrics', () => {
    const o = option('a', {
      netPositions: 120,
      aisleClearWidthIn: 144,
      topOfLoadIn: 168,
      storageLevels: 4,
    });
    expect(Object.keys(o.metrics).sort()).toEqual([...COMPARABLE_METRICS].sort());
  });
});

describe('the comparison table', () => {
  it('reads the same way every time, in a fixed metric order', () => {
    // Rows follow COMPARABLE_METRICS, not the order the first option supplied
    // them, so two comparisons of the same options are identical.
    const a = option('a', { storageLevels: 4, netPositions: 120 });
    const b = option('b', { netPositions: 96, storageLevels: 3 });
    expect(compare([a, b]).rows.map((r) => r.metric)).toEqual(['netPositions', 'storageLevels']);
  });

  it('keeps one cell per option, in the order given', () => {
    const table = compare([
      option('a', { netPositions: 120 }),
      option('b', { netPositions: 96 }),
      option('c', { netPositions: 144 }),
    ]);
    expect(table.rows[0]?.values).toEqual([120, 96, 144]);
  });

  it('omits a metric no option supplied, rather than showing an empty row', () => {
    const table = compare([option('a', { netPositions: 1 }), option('b', { netPositions: 2 })]);
    expect(table.rows).toHaveLength(1);
  });

  it('fills a metric one option lacks with null, never with zero', () => {
    // A blank or zero cell in a comparison reads as "none", which is a claim.
    const table = compare([
      option('a', { netPositions: 120, storageLevels: 4 }),
      option('b', { netPositions: 96 }),
    ]);
    const levels = table.rows.find((r) => r.metric === 'storageLevels');
    expect(levels?.values).toEqual([4, null]);
    expect(levels?.values).not.toContain(0);
  });

  it('refuses a comparison of fewer than two options', () => {
    expect(() => compare([option('a', { netPositions: 1 })])).toThrow(/at least two options/);
    expect(() => compare([])).toThrow(ComparisonError);
  });

  it('refuses duplicate option ids', () => {
    expect(() =>
      compare([option('a', { netPositions: 1 }), option('a', { netPositions: 2 })]),
    ).toThrow(/duplicate option id/);
  });
});

describe('an unestablished value is never ranked', () => {
  // Comparing a number to VERIFY produces an ordering the model cannot
  // defend, and the client reads it as a real preference.

  it('marks a row containing a null as unrankable', () => {
    const table = compare([
      option('a', { netPositions: 120 }),
      option('b', { netPositions: null }),
    ]);
    const row = table.rows[0];
    expect(row?.hasUnestablished).toBe(true);
    expect(rankable(row!)).toBe(false);
  });

  it('allows ranking when every value is established', () => {
    const table = compare([
      option('a', { netPositions: 120 }),
      option('b', { netPositions: 96 }),
    ]);
    expect(rankable(table.rows[0]!)).toBe(true);
  });
});

describe('per-option finding counts stay separate', () => {
  // A single "3 issues" badge tells the client nothing about whether they have
  // work to do. In a comparison that matters more, not less.

  it('counts actions and reviews apart', () => {
    const table = compare([
      option('a', { netPositions: 120 }, [
        finding('BLOCKER'),
        finding('MISSING_INPUT'),
        finding('ENGINEERING_REVIEW_REQUIRED'),
      ]),
      option('b', { netPositions: 96 }, [finding('ENGINEERING_REVIEW_REQUIRED')]),
    ]);
    const [a, b] = summariseOptions(table);

    expect(a?.actionCount).toBe(2);
    expect(a?.reviewCount).toBe(1);
    expect(a?.submittable).toBe(false);

    // Option B has an issue but no work for the client, and can be submitted.
    expect(b?.actionCount).toBe(0);
    expect(b?.reviewCount).toBe(1);
    expect(b?.submittable).toBe(true);
  });

  it('reports a clean option as submittable with nothing to do', () => {
    const table = compare([
      option('a', { netPositions: 120 }),
      option('b', { netPositions: 96 }),
    ]);
    for (const s of summariseOptions(table)) {
      expect(s.actionCount).toBe(0);
      expect(s.reviewCount).toBe(0);
      expect(s.submittable).toBe(true);
    }
  });

  it('carries the option label so a column can be identified', () => {
    const table = compare([
      option('a', { netPositions: 1 }),
      option('b', { netPositions: 2 }),
    ]);
    expect(summariseOptions(table).map((s) => s.label)).toEqual(['Option a', 'Option b']);
  });
});

describe('the comparison output carries nothing forbidden, at any depth', () => {
  it('serialises with no forbidden key anywhere', () => {
    // The belt-and-braces check: whatever the construction path, the finished
    // object must not contain a forbidden name.
    const table = compare([
      option('a', { netPositions: 120, aisleClearWidthIn: 144 }, [finding('BLOCKER')]),
      option('b', { netPositions: 96, aisleClearWidthIn: 132 }, [finding('WARNING')]),
    ]);
    const serialised = JSON.stringify({ table, summary: summariseOptions(table) }).toLowerCase();

    for (const forbidden of FORBIDDEN_COMPARISON_METRICS) {
      expect(serialised, `'${forbidden}' must not appear in a comparison payload`).not.toMatch(
        new RegExp(`"${forbidden.toLowerCase()}"`),
      );
    }
  });
});
