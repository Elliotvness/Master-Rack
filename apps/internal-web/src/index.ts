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
  QueueError,
  acknowledgementClock,
  ageHours,
  orderQueue,
  organizationsInQueue,
  quoteDeliveryClock,
  type ClockReading,
  type InternalStatus,
  type QueueEntry,
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

/**
 * T-08 moved `deriveInternalRevision`, `internalNote` and `stripInternalRevisions`
 * to `@rms/workflow`, and this barrel deliberately does NOT re-export them.
 *
 * Re-exporting would leave the old import path working and the move cosmetic:
 * every caller would keep reaching a server authority through the app bundle,
 * which is the thing D-01b is about. `apps/api` owns that surface now. What
 * stays here is the queue's VIEW logic — ordering, the two OD-11 clocks, ages —
 * and the trace panel.
 */
export type { Acknowledgement, Assumption } from '@rms/workflow';
