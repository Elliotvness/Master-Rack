/**
 * @rms/contracts
 *
 * The wire contract, fixed before the first route exists: one error envelope,
 * one pagination envelope, one forbidden-field list. §6.3's argument is that a
 * leakage contract is "worth ten times more written against six routes than
 * against two hundred" — and there are currently zero.
 *
 * Owned by neither app. `apps/api` serves it, `apps/client-web` and
 * `apps/internal-web` read it, and none of the three can amend it for its own
 * convenience without the change being visible here.
 *
 * Pure: no I/O, no clock, no RNG.
 */

export {
  ERROR_CODES,
  errorEnvelope,
  isErrorCode,
  notFound,
  statusFor,
  type ErrorCode,
  type ErrorEnvelope,
  type ErrorStatus,
} from './errors.js';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  offsetOf,
  paginate,
  parsePageRequest,
  type PageRequest,
  type Paginated,
  type Pagination,
} from './pagination.js';

export type { Acknowledgement, Assumption } from './assumptions.js';

export {
  FORBIDDEN_CLIENT_FIELDS,
  findForbiddenFields,
  isForbiddenClientField,
} from './forbidden-fields.js';
