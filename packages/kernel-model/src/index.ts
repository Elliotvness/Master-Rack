/**
 * @rms/kernel-model
 *
 * The canonical project model: deterministic serialisation, content hashing and
 * the revision lifecycle.
 *
 * Pure. No I/O, no clock, no RNG — enforced by tools/check-boundaries.mjs.
 * SHA-256 is implemented in-package rather than imported from `node:crypto`,
 * because the same compiled module runs in the browser and on the server and
 * must produce the same digest in both.
 */

export { sha256 } from './sha256.js';

export {
  CanonicalDepthError,
  CanonicalError,
  MAX_CANONICAL_DEPTH,
  NON_CONTENT_FIELDS,
  UnhashableValueError,
  canonicalise,
  canonicaliseAll,
  contentHash,
} from './canonical.js';

export {
  TransitionRefusedError,
  UndecidedAuthorityError,
  canTransition,
  cloneToDraft,
  deepFreeze,
  freeze,
  mayWaive,
  transitionRefusals,
  type AuditEvent,
  type Audience,
  type LifecycleState,
  type Revision,
  type TransitionResult,
} from './revision.js';
