/**
 * The client application's HTTP layer.
 *
 * This module can only reach `/api/client/v1`. That is enforced here rather
 * than left to discipline, and it is the point of having two front ends at all:
 *
 *   A shared route that hides fields makes leakage a SERIALIZATION bug, which
 *   is invisible in review. Two namespaces make it a ROUTING bug, which is loud
 *   and greppable.
 *
 * So `request()` refuses any path outside the client namespace, and the refusal
 * is a thrown error at the call site rather than a filtered response. A client
 * bundle that tries to fetch `/api/internal/...` fails immediately and
 * obviously, in development, on the first attempt.
 *
 * The session rides in a `__Host-` prefixed cookie the browser attaches
 * automatically. There is deliberately no token handling here: the token is
 * HttpOnly, so this code cannot read it, which is what stops an XSS from
 * exfiltrating a session.
 */

export const CLIENT_NAMESPACE = '/api/client/v1';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  /**
   * The findings a refusal carried, when the server supplied them. A refusal
   * that lists every reason at once is worth surfacing whole (AC-10).
   */
  readonly reasons: readonly string[];

  constructor(status: number, message: string, reasons: readonly string[] = []) {
    super(message);
    this.status = status;
    this.reasons = Object.freeze([...reasons]);
  }
}

/** A path outside the client namespace reached this bundle. Loud by design. */
export class NamespaceViolationError extends Error {
  override readonly name = 'NamespaceViolationError';
  constructor(path: string) {
    super(
      `The client application attempted to call '${path}', which is outside ` +
        `'${CLIENT_NAMESPACE}'. The client and internal namespaces are hard-separated: ` +
        'a client bundle that can reach an internal route is a leak, not a convenience.',
    );
  }
}

function assertClientNamespace(path: string): void {
  // Checked with startsWith on the FULL prefix rather than a substring match,
  // so '/api/internal/v1/x?next=/api/client/v1' cannot slip through.
  if (!path.startsWith(`${CLIENT_NAMESPACE}/`) && path !== CLIENT_NAMESPACE) {
    throw new NamespaceViolationError(path);
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Perform a request against the client API.
 *
 * `fetchImpl` is injected rather than reaching for a global, so a test drives
 * this without a network and without a mocking framework standing in for the
 * thing under test.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  assertClientNamespace(path);

  const init: RequestInit = {
    method: options.method ?? 'GET',
    // The session cookie is HttpOnly and __Host- prefixed; the browser attaches
    // it. Same-origin only: a credentialed cross-origin request would defeat
    // the SameSite protection the cookie policy relies on.
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const response = await fetchImpl(path, init);

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    let reasons: string[] = [];
    try {
      const payload = (await response.json()) as { message?: unknown; reasons?: unknown };
      if (typeof payload.message === 'string') message = payload.message;
      if (Array.isArray(payload.reasons)) {
        reasons = payload.reasons.filter((r): r is string => typeof r === 'string');
      }
    } catch {
      // A non-JSON error body is not itself an error worth masking the status
      // with. Keep the status message.
    }
    throw new ApiError(response.status, message, reasons);
  }

  return (await response.json()) as T;
}
