/**
 * Pagination on every list endpoint, from the first one (AD-4).
 *
 * `GET /api/internal/v1/queue` is budgeted at 5,000 submissions in §5.4. It
 * ships paginated or it ships broken — and retrofitting pagination changes the
 * response SHAPE, so every consumer written against the unpaginated version
 * breaks at once. Cheaper now, when there are no consumers.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Page size bounds. A caller may not ask for everything. */
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface Paginated<T> {
  readonly data: readonly T[];
  readonly pagination: Pagination;
}

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Read a page request off untrusted query parameters.
 *
 * Absent means the default. PRESENT AND WRONG means a refusal, not a default:
 * silently correcting `pageSize=1000` to 100 tells a caller their request
 * succeeded as asked, and they then page through data they never receive. The
 * same for `page=0`, `page=-1`, and `pageSize=abc`.
 */
export function parsePageRequest(query: {
  readonly page?: unknown;
  readonly pageSize?: unknown;
}): PageRequest | { readonly invalid: string } {
  const page = readBoundedInt(query.page, 1, 'page', 1);
  if (typeof page !== 'number') return page;

  const pageSize = readBoundedInt(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize', MIN_PAGE_SIZE);
  if (typeof pageSize !== 'number') return pageSize;

  if (pageSize > MAX_PAGE_SIZE) {
    return { invalid: `pageSize must be at most ${MAX_PAGE_SIZE}, got ${pageSize}` };
  }
  return Object.freeze({ page, pageSize });
}

/**
 * The lower bound is a PARAMETER rather than a second check after the fact.
 * Two guards for one rule is how they end up disagreeing — and the second was
 * unreachable while MIN_PAGE_SIZE was 1, which is a branch no input could take.
 */
function readBoundedInt(
  raw: unknown,
  fallback: number,
  name: string,
  min: number,
): number | { readonly invalid: string } {
  if (raw === undefined || raw === null || raw === '') return fallback;
  // Query strings arrive as strings; a number is accepted for direct callers.
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n) || n < min) {
    return { invalid: `${name} must be a whole number of at least ${min}, got ${String(raw)}` };
  }
  return n;
}

/**
 * Wrap a page of rows with its envelope.
 *
 * `totalItems` is supplied by the caller because only the query knows it, and
 * counting the page you happened to receive is how a UI reports "142 results"
 * as "20". `totalPages` is derived, never passed: two fields that must agree
 * and can be set independently will eventually disagree.
 */
export function paginate<T>(
  data: readonly T[],
  request: PageRequest,
  totalItems: number,
): Paginated<T> {
  if (!Number.isInteger(totalItems) || totalItems < 0) {
    throw new RangeError(`totalItems must be a non-negative integer, got ${totalItems}`);
  }
  if (data.length > request.pageSize) {
    // The query returned more than the page asked for, which means the LIMIT
    // was not applied. Loud here beats a UI that silently renders 5,000 rows.
    throw new RangeError(
      `a page of ${request.pageSize} cannot carry ${data.length} rows; the query is unbounded`,
    );
  }
  return Object.freeze({
    data: Object.freeze([...data]),
    pagination: Object.freeze({
      page: request.page,
      pageSize: request.pageSize,
      totalItems,
      // An empty result is one empty page, not zero pages: "page 1 of 0" is a
      // string no UI handles well.
      totalPages: Math.max(1, Math.ceil(totalItems / request.pageSize)),
    }),
  });
}

/** The SQL offset for a page request. Derived, so no route computes it by hand. */
export function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}
