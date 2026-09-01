/**
 * @rms/client-web
 *
 * The client-facing application. Serves CLIENT_USER and CLIENT_ADMIN only.
 *
 * The structural rule, from blueprint §6: this bundle cannot import internal
 * DTOs and cannot reach the internal API namespace. Two applications is the
 * cheapest guarantee that an internal field never reaches a client screen —
 * it makes leakage a routing bug rather than a serialization bug.
 */

export {
  ApiError,
  CLIENT_NAMESPACE,
  NamespaceViolationError,
  request,
  type RequestOptions,
} from './lib/api.js';

export {
  INVITATION_REFUSED_MESSAGE,
  MIN_PASSWORD_LENGTH,
  acceptInvitation,
  checkInvitation,
  passwordProblems,
  type AcceptInvitationInput,
  type AcceptResult,
  type InvitationCheckResponse,
  type InvitationState,
} from './lib/invitation.js';

export {
  FACILITY_FIELDS,
  FacilityEntryError,
  clearField,
  emptyFacility,
  facilityFindings,
  readyToSubmit,
  setKnown,
  setNotKnown,
  unansweredFields,
  type FacilityDraft,
  type FacilityFieldId,
  type FacilityFieldSpec,
  type FacilityFinding,
  type FieldValue,
} from './lib/facility.js';

export {
  MAX_BEAM_LEVELS,
  MIN_BEAM_LEVELS,
  OptionBuilderError,
  blockingReasons,
  emptyOption,
  offGridExplanation,
  readyToPreview,
  selectBeamLevels,
  selectSpan,
  spanChoices,
  type LevelSelection,
  type OptionDraft,
  type SpanChoice,
  type SpanSelection,
} from './lib/options.js';

export {
  PreviewSequencer,
  REVIEW_WORDING,
  canSubmit,
  clientActionList,
  groupFindings,
  summarise,
  type ClientFinding,
  type FindingGroups,
  type PreviewResult,
  type PreviewState,
  type SummaryCounts,
} from './lib/preview.js';

export {
  COMPARABLE_METRICS,
  ComparisonError,
  FORBIDDEN_COMPARISON_METRICS,
  comparableOption,
  compare,
  rankable,
  summariseOptions,
  type ComparableMetric,
  type ComparableOption,
  type ComparisonRow,
  type ComparisonTable,
  type OptionSummary,
} from './lib/comparison.js';

/**
 * The submit transaction itself is NOT here, and that is the point of T-07.
 *
 * `submit` lives in `@rms/workflow` and runs on the server; this bundle keeps
 * everything a screen legitimately needs — the step vocabulary, the refusal
 * type so it can name which step refused and list every reason (`AC-10`),
 * `submitRefusals` so it can show them BEFORE the round trip, and
 * `preSubmitConfirmation`, which is by definition what the client is shown
 * immediately before submitting (§11.6, register first). What it does not get
 * is the ability to drive the sequence itself. `tools/check-app-boundaries.mjs` asserts
 * that this file exports no symbol named `submit`, `freeze`, `derive*` or
 * `strip*`, so the omission is enforced rather than remembered.
 */
export {
  SUBMIT_STEPS,
  SubmitError,
  preSubmitConfirmation,
  stepsInOrder,
  submitRefusals,
  type Acknowledgement,
  type Assumption,
  type Derivation,
  type SubmitStep,
} from '@rms/workflow';

export {
  CLOCK_NAMES,
  FORBIDDEN_STATUS_WORDING,
  SLA_BASELINE_SUBMISSIONS,
  STATUS_WORDING,
  StatusError,
  clientStatusFor,
  cloneToDraft,
  editable,
  forbiddenWordingIn,
  slaTargetsVisible,
  type ClientStatus,
  type CloneResult,
  type InternalStatus,
  type Revision,
} from './lib/status.js';
