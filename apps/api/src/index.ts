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
