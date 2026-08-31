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
