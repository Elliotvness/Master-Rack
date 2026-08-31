/**
 * @rms/api
 *
 * The HTTP layer: authentication, sessions, and (later) authorization and DTOs.
 */

export {
  generateToken,
  generateRecoveryCode,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from './auth/crypto.js';

export {
  INVITATION_TTL_MS,
  LOGIN_TOKEN_TTL_MS,
  SESSION_COOKIE_NAME,
  lifetimeFor,
  sessionCookieOptions,
  type CookieOptions,
  type SessionLifetime,
} from './auth/policy.js';

export {
  createSession,
  deactivateUser,
  regenerateToken,
  resolveSession,
  revokeSession,
  type NewSession,
  type Session,
} from './auth/session.js';

export {
  issueInvitation,
  redeemInvitation,
  redemptionResponse,
  revokeInvitation,
  type IssuedInvitation,
  type MemberRole,
  type RedemptionResult,
} from './auth/invitation.js';

export {
  KNOWN_ACTIONS,
  authorize,
  type Action,
  type Actor,
  type Decision,
  type Resource,
  type Role,
} from './authz/authorize.js';

export {
  ROUTES,
  RouteCoverageError,
  assertRouteCoverage,
  namespaceAllows,
  type Namespace,
  type RoutePolicy,
} from './authz/routes.js';

export {
  FORBIDDEN_CLIENT_FIELDS,
  findForbiddenFields,
  isForbiddenClientField,
  redactForLog,
  toFindingClientDTO,
  toProjectClientDTO,
  type FindingClientDTO,
  type ProjectClientDTO,
} from './dto/client.js';
