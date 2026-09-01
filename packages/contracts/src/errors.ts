/**
 * One error shape, fixed before the first route exists (AD-2).
 *
 * "Throws here, null there, `{error}` elsewhere" is how consumers stop being
 * able to predict behaviour, and it is far cheaper to fix now — against zero
 * routes — than against the twenty-three §8.2 will mount.
 *
 * The code is a CLOSED enum. An open string is a code nobody can switch on: the
 * client ends up matching on `message`, which is prose and will be reworded.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/**
 * Every error this API can return, and the status each carries.
 *
 * The 403/404 split is the one the authorization matrix already gets right and
 * a test already defends, and it is the reason this is a table rather than a
 * convention:
 *
 *   - A staff-only ARTIFACT is 404. A 403 confirms the thing exists, which is
 *     the disclosure AC-03 exists to prevent — and for a cross-tenant object it
 *     would confirm another client's project by id.
 *   - A staff-only CAPABILITY is 403. Refusing to admit the verb exists is
 *     dishonest in the other direction: the caller is authenticated, the route
 *     is real, and they may not use it.
 *
 * `NOT_FOUND` therefore covers three distinct facts deliberately — absent,
 * another tenant's, and the wrong audience — because distinguishing them on the
 * wire is the leak.
 */
export const ERROR_CODES = Object.freeze({
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
} as const);

export type ErrorCode = keyof typeof ERROR_CODES;
export type ErrorStatus = (typeof ERROR_CODES)[ErrorCode];

/** The body of every non-2xx response. No other shape is permitted. */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    /** Optional, structured. Never a stack, never a query, never a row. */
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

export function statusFor(code: ErrorCode): ErrorStatus {
  return ERROR_CODES[code];
}

/**
 * Build an error envelope.
 *
 * `message` is for a human reading a log or a toast. It is never the thing a
 * client branches on — that is `code` — and it must never carry internal
 * detail: no SQL, no stack, no row contents, no table names. A 500 in
 * particular says nothing about what happened, ever.
 */
export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ErrorEnvelope {
  if (message.trim() === '') {
    // An empty message is a log line that says nothing and a toast that shows
    // nothing. Cheaper to refuse here than to find it in production.
    throw new RangeError(`error '${code}' needs a message`);
  }
  return Object.freeze({
    error: Object.freeze(
      details === undefined
        ? { code, message }
        : { code, message, details: Object.freeze({ ...details }) },
    ),
  });
}

/**
 * The envelope for a denial that must not confirm existence.
 *
 * A helper rather than a convention, because "return 404 here" is exactly the
 * kind of rule that holds in the routes written the week it was agreed and not
 * in the ones written six months later.
 */
export function notFound(): ErrorEnvelope {
  // The same message for absent, cross-tenant and wrong-audience. A message
  // that varies between them is a 403 wearing a 404's status code.
  return errorEnvelope('NOT_FOUND', 'Not found');
}
