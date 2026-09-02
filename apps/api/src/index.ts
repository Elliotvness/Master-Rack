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

export {
  GENESIS_PREV_HASH,
  appendAuditEvent,
  chainHash,
  verifyAuditChain,
  type AuditEventContent,
  type AuditOutcome,
  type ChainVerification,
} from './audit/chain.js';

export {
  backoffFor,
  claimBatch,
  enqueue,
  markDispatched,
  markFailure,
  type OutboxMessage,
  type OutboxStatus,
} from './outbox/outbox.js';

export {
  RETENTION_DAYS_7_YEARS,
  WormError,
  anchorKey,
  manifestKey,
  modeRefusals,
  prepareManifest,
  writeRefusals,
  type RetentionMode,
  type WormObject,
  type WormStore,
} from './worm/store.js';

export { InMemoryWormStore } from './worm/memory-store.js';

export {
  anchorClaim,
  anchorDigest,
  anchorGaps,
  anchorRefusals,
  prepareAnchor,
  type DailyAnchor,
  type TimestampToken,
} from './worm/anchor.js';

export {
  ENGINE_VERSION,
  splitOnce,
  submitEffects,
  submitRevision,
  type SubmitContext,
} from './workflow/submit-effects.js';

/**
 * T-08 (audit D-01b). Internal revision derivation, internal notes and AC-14's
 * strip live in `@rms/workflow` and are surfaced HERE rather than from
 * `apps/internal-web`, because deciding what a client may see is a server
 * authority. Re-exported rather than re-implemented: `@rms/workflow` is where
 * the rule is, and two copies of a rule is one copy too many.
 *
 * There are no effects to supply for these three — all are pure constructors.
 * `submitEffects` above exists because `submit()` orchestrates a transaction;
 * these do not. When a derived revision needs persisting, the effects arrive
 * with the table, not before it.
 */
export {
  DerivationError,
  deriveInternalRevision,
  internalNote,
  stripInternalRevisions,
  type DeriveResult,
  type InternalNote,
  type InternalRevision,
  type SourceSubmission,
} from '@rms/workflow';
