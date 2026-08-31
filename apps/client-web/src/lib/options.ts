/**
 * The option builder (`D-03`).
 *
 * The first screen a client actually configures on, and the one that carries
 * the product's single most important behaviour: **the engine does not
 * interpolate.**
 *
 * Demo beat 5, from the blueprint, is the acceptance test for this module:
 *
 *   A client tries a 110" beam. The tool refuses, states that the published
 *   grid brackets it at 108" and 114", and explains that it does not
 *   interpolate.
 *
 * Three rules govern everything here, and each one is a refusal:
 *
 *   1. **Choices come only from the pinned catalog release.** Not from a range,
 *      not from a formula, not from what looks reasonable. If the manufacturer
 *      did not publish it, it is not offered.
 *   2. **Free-text dimensional entry is not offered at all.** A text box invites
 *      a number the catalog has never heard of, and then someone has to decide
 *      what to do with it. Removing the box removes the decision.
 *   3. **An unavailable choice states WHY.** "Not available" teaches a client
 *      nothing and produces a support call. "The published grid brackets this
 *      at 108 and 114 inches, and the engine does not interpolate" teaches them
 *      how the product thinks.
 *
 * Pure: no I/O, no clock, no RNG. The catalog arrives already pinned.
 */

/** A span the pinned catalog publishes, offered as a choice. */
export interface SpanChoice {
  readonly spanIn: number;
  readonly label: string;
}

export type SpanSelection =
  | { readonly state: 'unset' }
  | { readonly state: 'selected'; readonly spanIn: number }
  /**
   * The client asked for a span the catalog does not publish. This is a normal
   * outcome, not an error state — it carries the brackets and the reason, and
   * it is what demo beat 5 renders.
   */
  | {
      readonly state: 'refused';
      readonly requestedIn: number;
      readonly lowerIn: number | null;
      readonly upperIn: number | null;
      readonly explanation: string;
    };

export class OptionBuilderError extends Error {
  override readonly name = 'OptionBuilderError';
}

/**
 * The wording used when a requested span is off-grid.
 *
 * Written out as a constant because it is a product statement, not a string:
 * it is the sentence that teaches a client the engine's most important
 * property, and it should not drift between screens.
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
 * The spans a client may choose from.
 *
 * This is the ONLY source of dimensional choice in the UI. There is deliberately
 * no `min`/`max`/`step` anywhere in this module: a stepped control implies every
 * value in the range is orderable, and most of them are not.
 */
export function spanChoices(publishedSpansIn: readonly number[]): readonly SpanChoice[] {
  if (publishedSpansIn.length === 0) {
    throw new OptionBuilderError(
      'the pinned catalog release publishes no spans for this family and series; ' +
        'offering an empty picker would imply the client may type one instead',
    );
  }
  return Object.freeze(
    [...publishedSpansIn]
      .sort((a, b) => a - b)
      .map((spanIn) => Object.freeze({ spanIn, label: `${spanIn}"` })),
  );
}

/**
 * Select a span, refusing anything the catalog does not publish.
 *
 * The refusal is a RETURNED STATE rather than a thrown error, because it is not
 * a programming mistake — it is a client asking a reasonable question and
 * deserving a real answer. Throwing would push the screen into an error path
 * and lose the brackets.
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

/* ------------------------------------------------------------------ *
 * Level configuration. Scope is OD-03: floor plus 2-6 beam levels,
 * uniform bays within a run.
 * ------------------------------------------------------------------ */

export const MIN_BEAM_LEVELS = 2;
export const MAX_BEAM_LEVELS = 6;

export type LevelSelection =
  | { readonly state: 'selected'; readonly beamLevels: number; readonly floorStores: boolean }
  | { readonly state: 'refused'; readonly requested: number; readonly explanation: string };

/**
 * Choose the number of beam levels.
 *
 * Out-of-scope counts are refused with the scope stated, rather than silently
 * clamped. A clamp would accept "12" and quietly configure 6, which is a
 * different rack from the one the client asked for.
 */
export function selectBeamLevels(requested: number, floorStores: boolean): LevelSelection {
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

/* ------------------------------------------------------------------ *
 * Readiness.
 * ------------------------------------------------------------------ */

export interface OptionDraft {
  readonly span: SpanSelection;
  readonly levels: LevelSelection | { readonly state: 'unset' };
}

export function emptyOption(): OptionDraft {
  return Object.freeze({
    span: { state: 'unset' as const },
    levels: { state: 'unset' as const },
  });
}

/**
 * Whether the option can be previewed.
 *
 * A refused span blocks: there is no capacity to derive from, so a preview
 * would have to invent one. This is the one place the product refuses to
 * proceed rather than proceeding with a finding, and the reason is that the
 * alternative is a drawing with no number behind it.
 */
export function readyToPreview(draft: OptionDraft): boolean {
  return draft.span.state === 'selected' && draft.levels.state === 'selected';
}

/** What still needs an answer, in the words the screen shows. */
export function blockingReasons(draft: OptionDraft): readonly string[] {
  const out: string[] = [];
  if (draft.span.state === 'unset') {
    out.push('Choose a beam span from the published list.');
  } else if (draft.span.state === 'refused') {
    out.push(draft.span.explanation);
  }
  if (draft.levels.state === 'unset') {
    out.push('Choose how many beam levels this run carries.');
  } else if (draft.levels.state === 'refused') {
    out.push(draft.levels.explanation);
  }
  return Object.freeze(out);
}
