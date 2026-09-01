import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  ERROR_CODES,
  FORBIDDEN_CLIENT_FIELDS,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  errorEnvelope,
  findForbiddenFields,
  isErrorCode,
  isForbiddenClientField,
  notFound,
  offsetOf,
  paginate,
  parsePageRequest,
  statusFor,
  type ErrorCode,
} from './index.js';

describe('AD-2 — one error envelope, closed codes', () => {
  it('maps every code to the status the blueprint assigns it', () => {
    expect(ERROR_CODES).toEqual({
      VALIDATION_ERROR: 400,
      MALFORMED_REQUEST: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN_CAPABILITY: 403,
      NOT_FOUND: 404,
      STALE_BASE: 409,
      IDEMPOTENCY_IN_FLIGHT: 409,
      IDEMPOTENCY_KEY_REUSED: 422,
      UNPROCESSABLE: 422,
      INTERNAL_ERROR: 500,
    });
  });

  it('is closed — an unknown code is not a code', () => {
    // The point of the enum: a client can switch on `code` exhaustively. An
    // open string means matching on `message`, which is prose and gets reworded.
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('SOMETHING_WENT_WRONG')).toBe(false);
    expect(isErrorCode(404)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    // And not inherited keys.
    expect(isErrorCode('toString')).toBe(false);
  });

  it('keeps the 403/404 split the authorization matrix already defends', () => {
    // A staff-only ARTIFACT is 404: a 403 confirms it exists (AC-03).
    expect(statusFor('NOT_FOUND')).toBe(404);
    // A staff-only CAPABILITY is 403: the caller is authenticated, the route is
    // real, and refusing to admit the verb exists is dishonest the other way.
    expect(statusFor('FORBIDDEN_CAPABILITY')).toBe(403);
  });

  it('builds a frozen envelope, with and without details', () => {
    const e = errorEnvelope('VALIDATION_ERROR', 'Clear height is required');
    expect(e).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Clear height is required' },
    });
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.error)).toBe(true);
    expect('details' in e.error).toBe(false);

    const d = errorEnvelope('UNPROCESSABLE', 'Bad span', { span_in: 999 });
    expect(d.error.details).toEqual({ span_in: 999 });
    expect(Object.isFrozen(d.error.details)).toBe(true);
  });

  it('refuses an empty message', () => {
    // A log line that says nothing and a toast that shows nothing.
    expect(() => errorEnvelope('INTERNAL_ERROR', '   ')).toThrow(/needs a message/);
  });

  it('notFound() says the same thing for every reason it is returned', () => {
    // Absent, cross-tenant and wrong-audience must be indistinguishable. A
    // message that varies between them is a 403 wearing a 404's status code.
    expect(notFound()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('every code is reachable from the type', () => {
    // Guards against a code added to the table and never given a status.
    const codes = Object.keys(ERROR_CODES) as ErrorCode[];
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(typeof statusFor(c)).toBe('number');
  });
});

describe('AD-4 — pagination, from the first list endpoint', () => {
  it('defaults an absent page request', () => {
    expect(parsePageRequest({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePageRequest({ page: undefined, pageSize: '' })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('reads strings, because a query string is strings', () => {
    expect(parsePageRequest({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('REFUSES a bad value rather than correcting it', () => {
    // Silently clamping tells a caller their request succeeded as asked, and
    // they then page through data they never receive.
    expect(parsePageRequest({ pageSize: 1000 })).toEqual({
      invalid: `pageSize must be at most ${MAX_PAGE_SIZE}, got 1000`,
    });
    expect(parsePageRequest({ page: 0 })).toEqual({
      invalid: 'page must be a whole number of at least 1, got 0',
    });
    expect(parsePageRequest({ page: -1 })).toEqual({
      invalid: 'page must be a whole number of at least 1, got -1',
    });
    expect(parsePageRequest({ page: 'abc' })).toEqual({
      invalid: 'page must be a whole number of at least 1, got abc',
    });
    expect(parsePageRequest({ page: 1.5 })).toEqual({
      invalid: 'page must be a whole number of at least 1, got 1.5',
    });
    expect(parsePageRequest({ pageSize: {} })).toEqual({
      invalid: 'pageSize must be a whole number of at least 1, got [object Object]',
    });
  });

  it('enforces the lower bound through one guard, not two', () => {
    // MIN_PAGE_SIZE is the parameter the read uses, so raising it moves the
    // refusal with it rather than leaving a second, unreachable check behind.
    expect(parsePageRequest({ pageSize: 0 })).toEqual({
      invalid: `pageSize must be a whole number of at least ${MIN_PAGE_SIZE}, got 0`,
    });
  });

  it('wraps a page and derives totalPages rather than trusting it', () => {
    const p = paginate(['a', 'b'], { page: 1, pageSize: 20 }, 142);
    expect(p.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 142, totalPages: 8 });
    expect(Object.isFrozen(p.data)).toBe(true);
  });

  it('reports an empty result as one empty page, not zero pages', () => {
    // "Page 1 of 0" is a string no UI handles well.
    expect(paginate([], { page: 1, pageSize: 20 }, 0).pagination.totalPages).toBe(1);
  });

  it('refuses a page carrying more rows than it asked for', () => {
    // The LIMIT was not applied. Loud here beats a UI rendering 5,000 rows.
    expect(() => paginate(['a', 'b', 'c'], { page: 1, pageSize: 2 }, 3)).toThrow(
      /the query is unbounded/,
    );
  });

  it('refuses a nonsense total', () => {
    expect(() => paginate([], { page: 1, pageSize: 20 }, -1)).toThrow(/non-negative integer/);
    expect(() => paginate([], { page: 1, pageSize: 20 }, 1.5)).toThrow(/non-negative integer/);
  });

  it('derives the offset, so no route computes it by hand', () => {
    expect(offsetOf({ page: 1, pageSize: 20 })).toBe(0);
    expect(offsetOf({ page: 4, pageSize: 25 })).toBe(75);
  });
});

describe('AC-02 — the forbidden-field list, now shared', () => {
  it('still covers every field marked Hidden in §9.2', () => {
    const required = [
      'cost', 'unit_cost', 'landed_cost', 'buy_price', 'price', 'margin',
      'margin_pct', 'discount', 'supplier', 'supplier_id', 'mpn',
      'manufacturer_part_number', 'bom', 'bom_line', 'item_snapshot', 'capacity',
      'capacity_case', 'catalog_release', 'source_document', 'page_ref',
      'catalog_page_ref', 'digitised_by', 'approved_by', 'citation',
      'verification_tier', 'rule_id', 'internal_note',
    ];
    for (const field of required) expect(isForbiddenClientField(field)).toBe(true);
    expect(FORBIDDEN_CLIENT_FIELDS).toHaveLength(required.length);
    expect(Object.isFrozen(FORBIDDEN_CLIENT_FIELDS)).toBe(true);
  });

  it('is not fooled by inherited keys', () => {
    expect(isForbiddenClientField('constructor')).toBe(false);
  });

  it('walks every nesting depth', () => {
    expect(findForbiddenFields({ price: 10 })).toEqual(['price']);
    expect(findForbiddenFields({ a: { b: { margin: 0.2 } } })).toEqual(['a.b.margin']);
    expect(findForbiddenFields({ lines: [{ ok: 1 }, { cost: 5 }] })).toEqual(['lines[1].cost']);
    expect(findForbiddenFields({ id: 'x', name: 'y' })).toEqual([]);
    expect(findForbiddenFields(null)).toEqual([]);
    expect(findForbiddenFields('a string')).toEqual([]);
  });

  it('stops at a cycle rather than recursing forever', () => {
    const a: Record<string, unknown> = { safe: 1 };
    a['self'] = a;
    expect(findForbiddenFields(a)).toEqual([]);
  });
});

describe('the contract is one package, owned by neither app', () => {
  it('exports nothing that reads a clock, a file or the network', async () => {
    // check-boundaries asserts this structurally; this asserts the shape of the
    // surface, so a helper that quietly needs a request object is visible.
    const mod = await import('./index.js');
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue;
      expect(value.length, `${name} takes more than 3 arguments`).toBeLessThanOrEqual(3);
    }
  });
});
