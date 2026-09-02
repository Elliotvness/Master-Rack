import { describe, expect, it } from 'vitest';

import {
  OutboundLeakError,
  OutboundValidationError,
  clientResponse,
  integer,
  internalResponse,
  object,
  outboundGuard,
  string,
  type OutboundReport,
} from './index.js';

/**
 * The outbound guard is the runtime half of §8.3's "validated at runtime —
 * failing the response in non-production, alerting in production". It sits
 * where a response leaves the process; the schema it checks against is the
 * published one.
 */

const project = clientResponse('Project', { id: string(), name: string() });
const queueEntry = internalResponse('QueueEntry', { id: string(), cost: integer() });

function harness(mode: 'fail' | 'alert') {
  const reports: OutboundReport[] = [];
  const guard = outboundGuard({ mode, alert: (r) => reports.push(r) });
  return { guard, reports };
}

describe('a conforming response passes through untouched', () => {
  it('returns the same object, in either mode, and alerts nothing', () => {
    for (const mode of ['fail', 'alert'] as const) {
      const { guard, reports } = harness(mode);
      const value = { id: 'p1', name: 'Harbor' };
      expect(guard.check(project, value)).toBe(value);
      expect(reports).toEqual([]);
    }
  });
});

describe('a schema DRIFT — the declared shape, wrong-typed or incomplete', () => {
  // The case §8.3's "alert in production" is written for: a declared field
  // arrives null, or wrong-typed, or missing. Nothing undeclared is present.
  const drifted = { id: 'p1', name: null };

  it('FAILS the response in non-production', () => {
    const { guard, reports } = harness('fail');
    expect(() => guard.check(project, drifted)).toThrow(OutboundValidationError);
    expect(() => guard.check(project, drifted)).toThrow(/Project: response does not match its schema/);
    expect(() => guard.check(project, drifted)).toThrow(/name: expected string, got null/);
    // Fail mode still alerts, so the two modes differ only in whether the
    // response ships — not in whether anyone hears about it. Three checks
    // above, three reports.
    expect(reports).toHaveLength(3);
    expect(reports[0]).toEqual({
      schema: 'Project',
      audience: 'client',
      problems: ['name: expected string, got null'],
      undeclared: [],
      leaks: [],
      shipped: false,
    });
  });

  it('ALERTS and ships the response in production', () => {
    const { guard, reports } = harness('alert');
    expect(guard.check(project, drifted)).toBe(drifted);
    expect(reports).toEqual([
      {
        schema: 'Project',
        audience: 'client',
        problems: ['name: expected string, got null'],
        undeclared: [],
        leaks: [],
        shipped: true,
      },
    ]);
  });
});

describe('an UNDECLARED key on a client response is refused in every mode', () => {
  // The closed schema is the belt and the forbidden list is the braces. A key
  // nobody declared on a client response is the leak class itself — a column
  // added last week, under a name the list has never heard of — and the
  // reviewer's plant made the point: `token_hash`, `storage_key`,
  // `organization_id`, `audience` are not on the list, and in the first draft
  // they would have shipped in production with an alert.
  const stray = { id: 'p1', name: 'Harbor', organization_id: 'org-a', token_hash: 'x' };

  it('throws OutboundLeakError in alert mode, naming the undeclared keys', () => {
    const { guard, reports } = harness('alert');
    expect(() => guard.check(project, stray)).toThrow(OutboundLeakError);
    expect(() => guard.check(project, stray)).toThrow(
      /Project: response to a client carries undeclared fields: organization_id, token_hash/,
    );
    expect(reports[0]).toEqual({
      schema: 'Project',
      audience: 'client',
      problems: ['organization_id: not a declared field of Project', 'token_hash: not a declared field of Project'],
      undeclared: ['organization_id', 'token_hash'],
      leaks: [],
      shipped: false,
    });
  });

  it('throws in fail mode too, as a leak and not as drift', () => {
    const { guard } = harness('fail');
    expect(() => guard.check(project, stray)).toThrow(OutboundLeakError);
  });

  it('finds an undeclared key at depth', () => {
    const nested = clientResponse('Nested', { id: string(), inner: object({ a: string() }) });
    const { guard } = harness('alert');
    expect(() => guard.check(nested, { id: 'x', inner: { a: 'y', audience: 'internal' } })).toThrow(/undeclared fields: inner\.audience/);
  });

  it('an undeclared key on an INTERNAL response is drift, not a leak — alert mode ships it', () => {
    // Staff are the audience the list protects clients FROM. A stray column
    // on an internal response is a contract defect, and it is treated as one:
    // fail in non-production, alert in production.
    const { guard, reports } = harness('alert');
    const value = { id: 'q1', cost: 1, extra: true };
    expect(guard.check(queueEntry, value)).toBe(value);
    expect(reports[0]?.undeclared).toEqual(['extra']);
    expect(reports[0]?.shipped).toBe(true);
    expect(() => harness('fail').guard.check(queueEntry, value)).toThrow(OutboundValidationError);
  });
});

describe('a forbidden field on a client response is refused in EVERY mode', () => {
  // §8.3 says schema violations alert in production. AC-02 and R-02 say a
  // forbidden field never reaches a client — "one margin figure in one API
  // response destroys the product's reason to exist". A schema drift and a
  // leak are different failures with different costs, and the guard treats
  // them differently: the first is availability, the second is the product.
  const leaky = { id: 'p1', name: 'Harbor', margin: 0.3 };

  it('throws OutboundLeakError in fail mode, naming the path', () => {
    const { guard, reports } = harness('fail');
    expect(() => guard.check(project, leaky)).toThrow(OutboundLeakError);
    expect(() => guard.check(project, leaky)).toThrow(/Project: response to a client carries a forbidden field: margin/);
    expect(reports[0]?.leaks).toEqual(['margin']);
    expect(reports[0]?.shipped).toBe(false);
  });

  it('throws OutboundLeakError in alert mode too — the response does not ship', () => {
    const { guard, reports } = harness('alert');
    expect(() => guard.check(project, leaky)).toThrow(OutboundLeakError);
    expect(reports).toEqual([
      {
        schema: 'Project',
        audience: 'client',
        problems: ['margin: not a declared field of Project'],
        undeclared: ['margin'],
        leaks: ['margin'],
        shipped: false,
      },
    ]);
  });

  it('finds the leak at any depth, even where the schema itself would have allowed nothing there', () => {
    const { guard } = harness('alert');
    expect(() => guard.check(project, { id: 'p1', name: { first: 'x', item_snapshot: { mpn: 'X' } } })).toThrow(
      /forbidden field: name\.item_snapshot, name\.item_snapshot\.mpn/,
    );
  });

  it('an internal response may carry the field — the walk is the client audience\'s', () => {
    const { guard, reports } = harness('fail');
    const value = { id: 'q1', cost: 1200 };
    expect(guard.check(queueEntry, value)).toBe(value);
    expect(reports).toEqual([]);
  });
});

describe('the guard refuses to be built loosely', () => {
  it('needs a mode it knows', () => {
    expect(() => outboundGuard({ mode: 'warn' as never, alert: () => {} })).toThrow(/unknown outbound mode 'warn'/);
  });

  it('needs an alert sink — a guard nobody hears is a guard that alerts into the void', () => {
    expect(() => outboundGuard({ mode: 'alert' } as never)).toThrow(/an alert sink is required/);
  });

  it('exposes its mode, so a boot log can state which one is live', () => {
    expect(harness('fail').guard.mode).toBe('fail');
    expect(harness('alert').guard.mode).toBe('alert');
  });
});

describe('errors carry the report, not just prose', () => {
  it('a validation error lists the problems', () => {
    const { guard } = harness('fail');
    try {
      guard.check(project, { id: 1 });
      expect.unreachable();
    } catch (e) {
      const err = e as OutboundValidationError;
      expect(err.name).toBe('OutboundValidationError');
      expect(err.report.problems).toEqual(['id: expected string, got number', 'name: required']);
      expect(err.report.undeclared).toEqual([]);
    }
  });

  it('a leak error lists the leaks and is not a validation error', () => {
    const { guard } = harness('fail');
    try {
      guard.check(object({ id: string() }) as never, { id: 'x' });
      expect.unreachable();
    } catch (e) {
      // An un-named object schema is not a response schema: refused, not guessed at.
      expect((e as Error).message).toMatch(/only a named response schema can guard a response/);
    }
    try {
      guard.check(project, { id: 'p1', name: 'n', price: 1 });
      expect.unreachable();
    } catch (e) {
      const err = e as OutboundLeakError;
      expect(err.name).toBe('OutboundLeakError');
      expect(err).not.toBeInstanceOf(OutboundValidationError);
      expect(err.report.leaks).toEqual(['price']);
    }
  });
});
