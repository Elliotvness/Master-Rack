/**
 * Facility and unit entry (`D-02`).
 *
 * The governing decision, from the blueprint: **every facility field is
 * individually markable *not known*, producing a finding rather than a zero.**
 *
 * That sounds like a UI nicety and is actually the product's whole thesis
 * applied to input. A blank field and a field the client has told us they
 * cannot answer are different facts:
 *
 *   - A blank is an absence of information. It might be an oversight.
 *   - "Not known" is information: the client has looked, and the answer is not
 *     available to them. That produces a MISSING INPUT finding naming who can
 *     answer it, which is actionable.
 *   - A zero is neither. It is a CLAIM, and it is almost always false.
 *
 * So the type makes a zero-by-accident unrepresentable: a field is `known` with
 * a value, or `not_known` with a reason, and there is no third state.
 *
 * Pure: no I/O, no clock, no RNG. This is the model the form binds to; the
 * form itself is elsewhere.
 */

export type FieldValue =
  | { readonly state: 'known'; readonly value: number }
  | { readonly state: 'not_known'; readonly note: string }
  | { readonly state: 'empty' };

export type FacilityFieldId =
  | 'clearHeightIn'
  | 'columnGridXIn'
  | 'columnGridYIn'
  | 'slabThicknessIn'
  | 'dockSetbackIn';

export interface FacilityFieldSpec {
  readonly id: FacilityFieldId;
  readonly label: string;
  /** What this field is for, in the words a client would use. */
  readonly help: string;
  /**
   * Who can answer it when the client cannot. A MISSING INPUT finding that does
   * not say who to ask is a dead end, and dead ends become support calls.
   */
  readonly whoCanAnswer: string;
  readonly unit: 'in';
}

/**
 * The MVP-1 facility fields.
 *
 * Deliberately short. Each one is here because a check needs it, not because a
 * form felt thin — an unused field is a question we make a client answer for
 * nothing.
 */
export const FACILITY_FIELDS: readonly FacilityFieldSpec[] = Object.freeze([
  Object.freeze({
    id: 'clearHeightIn' as const,
    label: 'Building clear height',
    help: 'Floor to the lowest obstruction — joist, duct, sprinkler pipe or light, whichever is lowest.',
    whoCanAnswer: 'Your facilities team, the building drawings, or a site measure.',
    unit: 'in' as const,
  }),
  Object.freeze({
    id: 'columnGridXIn' as const,
    label: 'Column grid spacing (across)',
    help: 'Centre to centre between building columns, across the aisle direction.',
    whoCanAnswer: 'The building drawings, or a tape measure between two columns.',
    unit: 'in' as const,
  }),
  Object.freeze({
    id: 'columnGridYIn' as const,
    label: 'Column grid spacing (along)',
    help: 'Centre to centre between building columns, along the aisle direction.',
    whoCanAnswer: 'The building drawings, or a tape measure between two columns.',
    unit: 'in' as const,
  }),
  Object.freeze({
    id: 'slabThicknessIn' as const,
    label: 'Slab thickness',
    help: 'Concrete slab thickness. Affects anchoring, and is often unknown without a core.',
    whoCanAnswer: 'The building drawings, or your landlord. Frequently not known — that is fine.',
    unit: 'in' as const,
  }),
  Object.freeze({
    id: 'dockSetbackIn' as const,
    label: 'Dock setback',
    help: 'Clear distance kept in front of the dock doors.',
    whoCanAnswer: 'Your operations team — it depends on how you stage outbound pallets.',
    unit: 'in' as const,
  }),
]);

export type FacilityDraft = Readonly<Record<FacilityFieldId, FieldValue>>;

/** A new facility form: every field empty, nothing assumed. */
export function emptyFacility(): FacilityDraft {
  const out = {} as Record<FacilityFieldId, FieldValue>;
  for (const field of FACILITY_FIELDS) {
    out[field.id] = { state: 'empty' };
  }
  return Object.freeze(out);
}

export class FacilityEntryError extends Error {
  override readonly name = 'FacilityEntryError';
}

/**
 * Set a field to a known value.
 *
 * A non-finite or negative measurement is refused here rather than sent, so the
 * client is told at the field rather than after a round trip. Zero is refused
 * for the same reason it is refused everywhere in this product: a zero clear
 * height is not a measurement, it is a blank wearing a number's clothes.
 */
export function setKnown(
  draft: FacilityDraft,
  id: FacilityFieldId,
  value: number,
): FacilityDraft {
  if (!Number.isFinite(value)) {
    throw new FacilityEntryError(`${id}: a measurement must be a finite number.`);
  }
  if (value <= 0) {
    throw new FacilityEntryError(
      `${id}: a measurement must be greater than zero. If the value is not ` +
        'available, mark the field NOT KNOWN rather than entering a zero.',
    );
  }
  return Object.freeze({ ...draft, [id]: { state: 'known', value } });
}

/**
 * Mark a field as not known. The note is optional but encouraged, and an empty
 * note is normalised to a standing reason rather than left blank — a finding
 * that says nothing is the dead end this design exists to avoid.
 */
export function setNotKnown(
  draft: FacilityDraft,
  id: FacilityFieldId,
  note = '',
): FacilityDraft {
  const trimmed = note.trim();
  return Object.freeze({
    ...draft,
    [id]: {
      state: 'not_known',
      note: trimmed === '' ? 'Marked not known by the client; no further detail supplied.' : trimmed,
    },
  });
}

/** Clear a field back to empty. Distinct from marking it not known. */
export function clearField(draft: FacilityDraft, id: FacilityFieldId): FacilityDraft {
  return Object.freeze({ ...draft, [id]: { state: 'empty' } });
}

export interface FacilityFinding {
  readonly fieldId: FacilityFieldId;
  readonly label: string;
  readonly kind: 'not_known' | 'not_answered';
  readonly whoCanAnswer: string;
}

/**
 * The findings a facility draft produces.
 *
 * Both empty and not-known fields produce a finding, and they are DIFFERENT
 * kinds. An unanswered field is a prompt; a not-known field is a recorded fact
 * about the client's information, and it should stop nagging them once stated.
 */
export function facilityFindings(draft: FacilityDraft): readonly FacilityFinding[] {
  const out: FacilityFinding[] = [];
  for (const spec of FACILITY_FIELDS) {
    const field = draft[spec.id];
    if (field.state === 'known') continue;
    out.push({
      fieldId: spec.id,
      label: spec.label,
      kind: field.state === 'not_known' ? 'not_known' : 'not_answered',
      whoCanAnswer: spec.whoCanAnswer,
    });
  }
  return Object.freeze(out);
}

/**
 * Whether the draft may be submitted.
 *
 * A not-known field does NOT block submission: refusing to accept "I do not
 * know" would push the client into inventing a number, which is precisely the
 * outcome this product exists to prevent. An unanswered field does block, but
 * only because the client has not yet said either way.
 */
export function readyToSubmit(draft: FacilityDraft): boolean {
  return FACILITY_FIELDS.every((spec) => draft[spec.id].state !== 'empty');
}

/** Fields still awaiting any answer at all. */
export function unansweredFields(draft: FacilityDraft): readonly FacilityFieldId[] {
  return Object.freeze(
    FACILITY_FIELDS.filter((spec) => draft[spec.id].state === 'empty').map((s) => s.id),
  );
}
