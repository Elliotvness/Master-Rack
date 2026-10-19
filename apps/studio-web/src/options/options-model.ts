/**
 * Pure domain model for Option Builder (Blueprint §15.2 Step 4, §15.3 D-03, FR-CP-04..07).
 *
 * Implements:
 * 1. Strict controlled-vocabulary lookups over pinned catalog data without interpolation (Demo Beat 5).
 * 2. Stated reasons and brackets for unavailable choices (FR-CP-06).
 * 3. Multi-option lifecycle (create, name, duplicate, delete) within a unit (FR-CP-04).
 * 4. Conversion to backend OptionDraft and OptionsApiPayload format.
 *
 * Pure: no I/O, no clock, no random.
 */

import {
  DEFAULT_AISLE_WIDTH_IN,
  MAX_BEAM_LEVELS,
  MIN_BEAM_LEVELS,
  PUBLISHED_BEAM_FACES_IN,
  PUBLISHED_BEAM_SPANS_IN,
  type RackConfigurationType,
} from './catalog-vocabulary.js';

export { PUBLISHED_BEAM_SPANS_IN };

export const MICROMETRES_PER_INCH = 25_400;

export class OptionBuilderError extends Error {
  override readonly name = 'OptionBuilderError';
}

/** A beam span the pinned catalog publishes, offered as a choice. */
export interface SpanChoice {
  readonly spanIn: number;
  readonly label: string;
}

export type SpanSelection =
  | { readonly state: 'unset' }
  | { readonly state: 'selected'; readonly spanIn: number }
  | {
      readonly state: 'refused';
      readonly requestedIn: number;
      readonly lowerIn: number | null;
      readonly upperIn: number | null;
      readonly explanation: string;
    };

export type LevelSelection =
  | { readonly state: 'unset' }
  | { readonly state: 'selected'; readonly beamLevels: number; readonly floorStores: boolean }
  | { readonly state: 'refused'; readonly requested: number; readonly explanation: string };

/**
 * Standardized explanation for off-grid beam span requests (Demo Beat 5).
 * Names both brackets and explains that the engine does not interpolate.
 */
export function offGridExplanation(
  requestedIn: number,
  lowerIn: number | null,
  upperIn: number | null,
): string {
  const head = `${requestedIn}" is not a published beam span.`;
  const tail =
    'The engine does not interpolate between published values, so no capacity ' +
    'can be stated for a span the manufacturer has not published.';

  if (lowerIn !== null && upperIn !== null) {
    return `${head} The published grid brackets it at ${lowerIn}" and ${upperIn}". ${tail}`;
  }
  if (lowerIn === null && upperIn !== null) {
    return `${head} The shortest published span is ${upperIn}". ${tail}`;
  }
  if (lowerIn !== null && upperIn === null) {
    return `${head} The longest published span is ${lowerIn}". ${tail}`;
  }
  return `${head} ${tail}`;
}

/**
 * Returns available span choices from the published spans list.
 */
export function spanChoices(publishedSpansIn: readonly number[] = PUBLISHED_BEAM_SPANS_IN): readonly SpanChoice[] {
  if (publishedSpansIn.length === 0) {
    throw new OptionBuilderError(
      'the pinned catalog release publishes no spans for this family and series; ' +
        'offering an empty picker would imply the client may type one instead',
    );
  }
  return Object.freeze(
    [...publishedSpansIn]
      .sort((a, b) => a - b)
      .map((spanIn) => Object.freeze({ spanIn, label: `${spanIn}" (${(spanIn / 12).toFixed(1)} ft)` })),
  );
}

/**
 * Select a span, strictly refusing anything not in the published catalog.
 * Off-grid values return a refused state with brackets and explanation (Demo Beat 5).
 * Never silently substitutes a nearest match (FR-CP-06).
 */
export function selectSpan(
  publishedSpansIn: readonly number[],
  requestedIn: number,
): SpanSelection {
  if (!Number.isFinite(requestedIn)) {
    throw new OptionBuilderError('a requested span must be a finite number of inches.');
  }

  const published = [...publishedSpansIn].sort((a, b) => a - b);
  if (published.includes(requestedIn)) {
    return { state: 'selected', spanIn: requestedIn };
  }

  let lowerIn: number | null = null;
  let upperIn: number | null = null;
  for (const span of published) {
    if (span < requestedIn) lowerIn = span;
    if (span > requestedIn && upperIn === null) upperIn = span;
  }

  return {
    state: 'refused',
    requestedIn,
    lowerIn,
    upperIn,
    explanation: offGridExplanation(requestedIn, lowerIn, upperIn),
  };
}

/**
 * Select beam level count. Scope per OD-03 is 2-6 levels above floor.
 */
export function selectBeamLevels(requested: number, floorStores = true): LevelSelection {
  if (!Number.isInteger(requested)) {
    return {
      state: 'refused',
      requested,
      explanation: 'A beam level count must be a whole number.',
    };
  }
  if (requested < MIN_BEAM_LEVELS || requested > MAX_BEAM_LEVELS) {
    return {
      state: 'refused',
      requested,
      explanation:
        `This tool configures ${MIN_BEAM_LEVELS} to ${MAX_BEAM_LEVELS} beam levels above the ` +
        'floor. Outside that range the layout needs a person to look at it, so it is not ' +
        'offered here rather than being approximated.',
    };
  }
  return { state: 'selected', beamLevels: requested, floorStores };
}

/** Front-end representation of an option in the studio option builder. */
export interface OptionConfig {
  readonly id: string;
  readonly label: string;
  readonly unitId: string;
  readonly rackType: RackConfigurationType;
  readonly span: SpanSelection;
  readonly beamFaceIn: number;
  readonly frameDepthIn: number;
  readonly frameHeightIn: number;
  readonly levels: LevelSelection;
  readonly aisleWidthIn: number;
  readonly runCount: number;
  readonly baysPerRun: number;
}

/** Creates a default valid OptionConfig. */
export function createDefaultOption(
  id: string,
  label: string,
  unitId = 'unit-1',
  rackType: RackConfigurationType = 'back_to_back',
): OptionConfig {
  return {
    id,
    label,
    unitId,
    rackType,
    span: { state: 'selected', spanIn: 96 }, // Standard 96" (8 ft) 2-pallet bay
    beamFaceIn: PUBLISHED_BEAM_FACES_IN[2] ?? 4.0,
    frameDepthIn: 42, // Standard 42" deep frame for 48x40 pallets
    frameHeightIn: 192, // 16 ft frame height
    levels: { state: 'selected', beamLevels: 4, floorStores: true },
    aisleWidthIn: DEFAULT_AISLE_WIDTH_IN,
    runCount: 4,
    baysPerRun: 8,
  };
}

/**
 * Creates the two initial options recommended for Step 4
 * ("The client creates two controlled selective-pallet-rack options").
 */
export function createInitialOptions(): readonly OptionConfig[] {
  return [
    createDefaultOption('opt-1', 'Option A: 96″ 4-Level Standard', 'unit-1', 'back_to_back'),
    {
      ...createDefaultOption('opt-2', 'Option B: 108″ 3-Level High-Clearance', 'unit-1', 'back_to_back'),
      span: { state: 'selected', spanIn: 108 },
      levels: { state: 'selected', beamLevels: 3, floorStores: true },
    },
  ];
}

/** Duplicates an existing option with a new id and label (FR-CP-04). */
export function duplicateOption(
  source: OptionConfig,
  newId: string,
  newLabel: string,
): OptionConfig {
  return {
    ...source,
    id: newId,
    label: newLabel,
  };
}

/** Checks whether an option has valid published selections and is ready for layout generation. */
export function isOptionReady(option: OptionConfig): boolean {
  return option.span.state === 'selected' && option.levels.state === 'selected';
}

/** What still needs an answer, in the words shown on screen. */
export function getOptionBlockingReasons(option: OptionConfig): readonly string[] {
  const reasons: string[] = [];
  if (option.label.trim().length === 0) {
    reasons.push('Option requires a non-empty name.');
  }
  if (option.span.state === 'unset') {
    reasons.push('Choose a beam span from the published catalog list.');
  } else if (option.span.state === 'refused') {
    reasons.push(option.span.explanation);
  }
  if (option.levels.state === 'unset') {
    reasons.push('Choose how many beam levels this rack carries.');
  } else if (option.levels.state === 'refused') {
    reasons.push(option.levels.explanation);
  }
  if (option.aisleWidthIn <= 0) {
    reasons.push('Aisle width must be a positive measurement.');
  }
  if (option.runCount < 1) {
    reasons.push('Option requires at least one rack run.');
  }
  if (option.baysPerRun < 1) {
    reasons.push('Each rack run requires at least one bay.');
  }
  return Object.freeze(reasons);
}

// ---------------------------------------------------------------------------
// Backend API Payload Types & Conversion
// ---------------------------------------------------------------------------

export interface ApiBayDraft {
  readonly bay_id: string;
  readonly length_um: number;
  readonly levels: number;
}

export interface ApiRunDraft {
  readonly run_id: string;
  readonly unit_id: string;
  readonly x_um: number;
  readonly y_um: number;
  readonly bays: readonly ApiBayDraft[];
}

export interface ApiOptionDraft {
  readonly option_id: string;
  readonly label: string;
  readonly aisle_width_um: number;
  readonly runs: readonly ApiRunDraft[];
}

export interface OptionsApiPayload {
  readonly options: readonly ApiOptionDraft[];
  readonly active_option_id: string;
}

/**
 * Builds run and bay structures for an OptionConfig to feed the backend API.
 */
export function buildOptionRuns(option: OptionConfig): readonly ApiRunDraft[] {
  const spanIn = option.span.state === 'selected' ? option.span.spanIn : 96;
  const levels = option.levels.state === 'selected' ? option.levels.beamLevels : 4;
  const bayLengthUm = Math.round(spanIn * MICROMETRES_PER_INCH);
  const aisleUm = Math.round(option.aisleWidthIn * MICROMETRES_PER_INCH);
  const frameDepthUm = Math.round(option.frameDepthIn * MICROMETRES_PER_INCH);

  const runs: ApiRunDraft[] = [];
  const runSpacingUm = option.rackType === 'back_to_back'
    ? frameDepthUm * 2 + Math.round(12 * MICROMETRES_PER_INCH) + aisleUm // back-to-back with 12" flue + aisle
    : frameDepthUm + aisleUm;

  for (let r = 0; r < option.runCount; r++) {
    const runId = `${option.id}-run-${r + 1}`;
    const yUm = r * runSpacingUm;
    const bays: ApiBayDraft[] = [];

    for (let b = 0; b < option.baysPerRun; b++) {
      bays.push({
        bay_id: `${runId}-bay-${b + 1}`,
        length_um: bayLengthUm,
        levels,
      });
    }

    runs.push({
      run_id: runId,
      unit_id: option.unitId,
      x_um: 0,
      y_um: yUm,
      bays,
    });
  }

  return Object.freeze(runs);
}

/**
 * Converts a set of OptionConfigs into the API payload expected by
 * POST /api/client/v1/revisions/:id/options.
 */
export function toOptionsApiPayload(
  options: readonly OptionConfig[],
  activeOptionId?: string,
): OptionsApiPayload {
  if (options.length === 0) {
    throw new OptionBuilderError('at least one option is required.');
  }

  const cleanOptions: ApiOptionDraft[] = options.map((opt) => {
    const reasons = getOptionBlockingReasons(opt);
    if (reasons.length > 0) {
      throw new OptionBuilderError(`Cannot serialize invalid option '${opt.label}': ${reasons[0]}`);
    }

    return {
      option_id: opt.id,
      label: opt.label,
      aisle_width_um: Math.round(opt.aisleWidthIn * MICROMETRES_PER_INCH),
      runs: buildOptionRuns(opt),
    };
  });

  const resolvedActive =
    activeOptionId !== undefined && cleanOptions.some((o) => o.option_id === activeOptionId)
      ? activeOptionId
      : cleanOptions[0]!.option_id;

  return {
    options: Object.freeze(cleanOptions),
    active_option_id: resolvedActive,
  };
}
