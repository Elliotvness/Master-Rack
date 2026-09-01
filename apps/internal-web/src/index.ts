/**
 * @rms/internal-web
 *
 * The internal staff application. Serves INTERNAL_SALES and INTERNAL_ADMIN.
 *
 * The mirror image of `client-web`: this bundle spans every organization, sees
 * the BOM and the audit log, and is never reachable by a client principal. The
 * separation is structural — two bundles, two API namespaces — so a leak is a
 * routing bug rather than a serialization bug.
 */

export {
  VERIFY_TEXT,
  buildTracePanel,
  isFullyTraceable,
  needsUnconfirmedWarning,
  traceInconsistencies,
  unanswerableQuestions,
  type BomLineTrace,
  type CatalogBasis,
  type NoCatalogBasis,
  type PartBasis,
  type RuleBasis,
  type TraceOperand,
  type TracePanel,
  type TraceStep,
} from './lib/trace.js';

export {
  DerivationError,
  QueueError,
  acknowledgementClock,
  ageHours,
  deriveInternalRevision,
  internalNote,
  orderQueue,
  organizationsInQueue,
  quoteDeliveryClock,
  stripInternalRevisions,
  type ClockReading,
  type DeriveResult,
  type InternalNote,
  type InternalRevision,
  type InternalStatus,
  type QueueEntry,
  type SourceSubmission,
} from './lib/queue.js';

export {
  REVIEW_PACKAGE_KEYS,
  ReviewPackageError,
  assembleReviewPackage,
  type DisplayListRef,
  type ReviewPackage,
  type ReviewPackageFinding,
  type ReviewPackageInput,
  type ReviewPackageKey,
} from './lib/review-package.js';

export type { Acknowledgement, Assumption } from '@rms/contracts';
