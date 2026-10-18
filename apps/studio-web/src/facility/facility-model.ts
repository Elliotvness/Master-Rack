/**
 * Facility and unit entry model (Blueprint §15.2 Step 3, §15.3 D-02, FR-CP-01..03).
 *
 * Core architectural tenets:
 *   1. Zero Refusal: Measurements <= 0 (inches, feet, lbs) are strictly refused
 *      at entry. A zero clear height or zero pallet weight is not a measurement —
 *      it is a blank disguised as a number.
 *   2. Explicit "Not Known": Every field can be marked "Not Known", recording
 *      the fact that the client has looked and the answer is unavailable.
 *   3. Empty vs Not Known:
 *      - Empty is an unanswered field; it blocks submission readiness.
 *      - Not Known is a recorded fact; it produces an actionable finding naming
 *        who can answer, and DOES NOT block submission readiness.
 *   4. Multi-Unit: Facilities can hold one or more independent handling units
 *      (FR-CP-02, FR-CP-03).
 *
 * Pure: no I/O, no clock, no random.
 */

export type FieldValue<T> =
  | { readonly state: 'known'; readonly value: T }
  | { readonly state: 'not_known'; readonly note: string }
  | { readonly state: 'empty' };

export class MeasurementRefusalError extends Error {
  override readonly name = 'MeasurementRefusalError';
}

export interface FieldSpec<K extends string = string> {
  readonly id: K;
  readonly label: string;
  readonly help: string;
  readonly whoCanAnswer: string;
  readonly unit?: string;
  readonly type: 'number' | 'text' | 'boolean';
}

/* ── Facility Fields (FR-CP-01) ────────────────────────────────────────── */

export type FacilityFieldKey =
  | 'facilityName'
  | 'facilityAddress'
  | 'clearHeightIn'
  | 'envelopeWidthFt'
  | 'envelopeDepthFt'
  | 'columnGridXIn'
  | 'columnGridYIn'
  | 'dockCount'
  | 'forkliftModel'
  | 'forkliftAisleIn'
  | 'sprinklered'
  | 'slabThicknessIn';

export const FACILITY_FIELD_SPECS: readonly FieldSpec<FacilityFieldKey>[] = Object.freeze([
  Object.freeze({
    id: 'facilityName' as const,
    label: 'Facility name',
    help: 'Descriptive name of the building or warehouse facility.',
    whoCanAnswer: 'Your project management team or client corporate records.',
    type: 'text' as const,
  }),
  Object.freeze({
    id: 'facilityAddress' as const,
    label: 'Facility address',
    help: 'Physical street address, city, state, and zip code.',
    whoCanAnswer: 'Lease documentation, property deed, or facilities manager.',
    type: 'text' as const,
  }),
  Object.freeze({
    id: 'clearHeightIn' as const,
    label: 'Building clear height',
    help: 'Finished floor to lowest overhead obstruction (joist, HVAC duct, lighting, or sprinkler pipe).',
    whoCanAnswer: 'Facilities manager, architectural drawings, or on-site laser distance measurement.',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'envelopeWidthFt' as const,
    label: 'Envelope width',
    help: 'Overall building or bay area interior width across the main aisle axis.',
    whoCanAnswer: 'Architectural shell drawings, building lease agreement, or surveyor floor plan.',
    unit: 'ft',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'envelopeDepthFt' as const,
    label: 'Envelope depth',
    help: 'Overall building or bay area interior depth along the main aisle axis.',
    whoCanAnswer: 'Architectural shell drawings, building lease agreement, or surveyor floor plan.',
    unit: 'ft',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'columnGridXIn' as const,
    label: 'Column grid spacing (across)',
    help: 'Centre-to-centre distance between building columns across the aisle direction.',
    whoCanAnswer: 'Structural drawings, general contractor, or site measurement between column centers.',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'columnGridYIn' as const,
    label: 'Column grid spacing (along)',
    help: 'Centre-to-centre distance between building columns along the aisle direction.',
    whoCanAnswer: 'Structural drawings, general contractor, or site measurement between column centers.',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'dockCount' as const,
    label: 'Dock door count',
    help: 'Number of truck loading dock doors along the staging wall.',
    whoCanAnswer: 'Warehouse operations manager or visual site survey.',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'forkliftModel' as const,
    label: 'Forklift model / type',
    help: 'Make, model, or class of handling equipment (e.g. Stand-up Reach, Counterbalance, Turret).',
    whoCanAnswer: 'Fleet operations manager, equipment lease supplier, or OEM specification sheet.',
    type: 'text' as const,
  }),
  Object.freeze({
    id: 'forkliftAisleIn' as const,
    label: 'Required aisle clearance',
    help: 'Minimum aisle clear width required for the stated forklift model to place and retrieve loads.',
    whoCanAnswer: 'Forklift manufacturer specification data sheet (right-angle stack clearance).',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'sprinklered' as const,
    label: 'Sprinkler fire protection',
    help: 'Whether the building is equipped with ceiling or in-rack fire suppression sprinklers.',
    whoCanAnswer: 'Building life-safety inspection certificate, landlord, or fire protection engineer.',
    type: 'boolean' as const,
  }),
  Object.freeze({
    id: 'slabThicknessIn' as const,
    label: 'Slab thickness',
    help: 'Reinforced concrete floor slab thickness. Required to verify baseplate anchoring capacity.',
    whoCanAnswer: 'Building structural drawings, civil engineer, or concrete core test report.',
    unit: 'in',
    type: 'number' as const,
  }),
]);

export type FacilityDraft = Readonly<{
  facilityName: FieldValue<string>;
  facilityAddress: FieldValue<string>;
  clearHeightIn: FieldValue<number>;
  envelopeWidthFt: FieldValue<number>;
  envelopeDepthFt: FieldValue<number>;
  columnGridXIn: FieldValue<number>;
  columnGridYIn: FieldValue<number>;
  dockCount: FieldValue<number>;
  forkliftModel: FieldValue<string>;
  forkliftAisleIn: FieldValue<number>;
  sprinklered: FieldValue<boolean>;
  slabThicknessIn: FieldValue<number>;
}>;

export function emptyFacilityDraft(): FacilityDraft {
  return Object.freeze({
    facilityName: { state: 'empty' as const },
    facilityAddress: { state: 'empty' as const },
    clearHeightIn: { state: 'empty' as const },
    envelopeWidthFt: { state: 'empty' as const },
    envelopeDepthFt: { state: 'empty' as const },
    columnGridXIn: { state: 'empty' as const },
    columnGridYIn: { state: 'empty' as const },
    dockCount: { state: 'empty' as const },
    forkliftModel: { state: 'empty' as const },
    forkliftAisleIn: { state: 'empty' as const },
    sprinklered: { state: 'empty' as const },
    slabThicknessIn: { state: 'empty' as const },
  });
}

/* ── Unit Fields (FR-CP-02, FR-CP-03) ──────────────────────────────────── */

export type UnitFieldKey =
  | 'unitName'
  | 'palletWidthIn'
  | 'palletDepthIn'
  | 'palletHeightIn'
  | 'palletWeightLb'
  | 'palletOverhangIn'
  | 'palletsPerBay'
  | 'targetLevels'
  | 'commodityClass';

export const UNIT_FIELD_SPECS: readonly FieldSpec<UnitFieldKey>[] = Object.freeze([
  Object.freeze({
    id: 'unitName' as const,
    label: 'Unit load description',
    help: 'Identifying name for this handling unit (e.g. "Standard GMA Pallet", "Half Pallet", "Drum Skid").',
    whoCanAnswer: 'Inventory control or warehouse operations supervisor.',
    type: 'text' as const,
  }),
  Object.freeze({
    id: 'palletWidthIn' as const,
    label: 'Pallet width (across bay)',
    help: 'Width of the pallet footprint along the rack beam direction.',
    whoCanAnswer: 'Packaging engineer, receiving department, or pallet vendor (GMA standard is 40" or 48").',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'palletDepthIn' as const,
    label: 'Pallet depth (into rack)',
    help: 'Depth of the pallet footprint into the rack frame direction.',
    whoCanAnswer: 'Packaging engineer, receiving department, or pallet vendor (GMA standard is 48").',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'palletHeightIn' as const,
    label: 'Pallet gross height',
    help: 'Total unit load height from floor to top of load, including pallet base.',
    whoCanAnswer: 'Receiving manifest, inventory unitization specification, or sample physical measurement.',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'palletWeightLb' as const,
    label: 'Pallet gross weight',
    help: 'Maximum gross load weight per pallet including goods, packaging, and the pallet itself.',
    whoCanAnswer: 'Bill of lading, shipping weight scales, product specification sheet, or warehouse WMS.',
    unit: 'lb',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'palletOverhangIn' as const,
    label: 'Pallet overhang',
    help: 'Intended pallet overhang beyond front and rear beam edges (standard planning default is 2").',
    whoCanAnswer: 'Storage rack safety guidelines or internal warehousing standards.',
    unit: 'in',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'palletsPerBay' as const,
    label: 'Pallets per bay',
    help: 'Number of pallet positions across one beam span (commonly 2 or 3).',
    whoCanAnswer: 'Warehouse storage design team or operational density requirement.',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'targetLevels' as const,
    label: 'Target beam levels',
    help: 'Desired number of beam storage levels, or desired positions per stack.',
    whoCanAnswer: 'Operations inventory capacity planning or vertical storage goals.',
    type: 'number' as const,
  }),
  Object.freeze({
    id: 'commodityClass' as const,
    label: 'Commodity fire class',
    help: 'NFPA 13 commodity classification (Class I, II, III, IV, or Group A Plastics).',
    whoCanAnswer: 'Fire protection consultant, commercial insurer, or building life safety engineer.',
    type: 'text' as const,
  }),
]);

export interface UnitDraft {
  readonly unitId: string;
  readonly unitName: FieldValue<string>;
  readonly palletWidthIn: FieldValue<number>;
  readonly palletDepthIn: FieldValue<number>;
  readonly palletHeightIn: FieldValue<number>;
  readonly palletWeightLb: FieldValue<number>;
  readonly palletOverhangIn: FieldValue<number>;
  readonly palletsPerBay: FieldValue<number>;
  readonly targetLevels: FieldValue<number>;
  readonly commodityClass: FieldValue<string>;
}

export function createUnitDraft(unitId: string, defaultName = 'Unit 1'): UnitDraft {
  return Object.freeze({
    unitId,
    unitName: { state: 'known' as const, value: defaultName },
    palletWidthIn: { state: 'empty' as const },
    palletDepthIn: { state: 'empty' as const },
    palletHeightIn: { state: 'empty' as const },
    palletWeightLb: { state: 'empty' as const },
    palletOverhangIn: { state: 'empty' as const },
    palletsPerBay: { state: 'empty' as const },
    targetLevels: { state: 'empty' as const },
    commodityClass: { state: 'empty' as const },
  });
}

/* ── Validation & Manipulation Helpers ──────────────────────────────────── */

const POSITIVE_MEASUREMENT_KEYS = new Set<string>([
  'clearHeightIn',
  'envelopeWidthFt',
  'envelopeDepthFt',
  'columnGridXIn',
  'columnGridYIn',
  'dockCount',
  'forkliftAisleIn',
  'slabThicknessIn',
  'palletWidthIn',
  'palletDepthIn',
  'palletHeightIn',
  'palletWeightLb',
  'palletsPerBay',
  'targetLevels',
]);

const NON_NEGATIVE_KEYS = new Set<string>(['palletOverhangIn', 'dockCount']);

export function validateNumericEntry(fieldId: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new MeasurementRefusalError(`${fieldId}: a measurement must be a finite number.`);
  }
  if (NON_NEGATIVE_KEYS.has(fieldId)) {
    if (value < 0) {
      throw new MeasurementRefusalError(
        `${fieldId}: a measurement must be non-negative (>= 0). If the value is not available, mark the field NOT KNOWN.`,
      );
    }
    return;
  }
  if (POSITIVE_MEASUREMENT_KEYS.has(fieldId) && value <= 0) {
    throw new MeasurementRefusalError(
      `${fieldId}: a measurement must be greater than zero. If the value is not available, mark the field NOT KNOWN rather than entering a zero.`,
    );
  }
}

export function setFacilityKnown<K extends FacilityFieldKey>(
  draft: FacilityDraft,
  key: K,
  val: FacilityDraft[K] extends FieldValue<infer T> ? T : never,
): FacilityDraft {
  if (typeof val === 'number') {
    validateNumericEntry(key, val);
  }
  return Object.freeze({
    ...draft,
    [key]: { state: 'known' as const, value: val },
  });
}

export function setFacilityNotKnown<K extends FacilityFieldKey>(
  draft: FacilityDraft,
  key: K,
  note = '',
): FacilityDraft {
  const trimmed = note.trim();
  return Object.freeze({
    ...draft,
    [key]: {
      state: 'not_known' as const,
      note: trimmed === '' ? 'Marked not known by the client; no further detail supplied.' : trimmed,
    },
  });
}

export function clearFacilityField<K extends FacilityFieldKey>(
  draft: FacilityDraft,
  key: K,
): FacilityDraft {
  return Object.freeze({
    ...draft,
    [key]: { state: 'empty' as const },
  });
}

export function setUnitKnown<K extends UnitFieldKey>(
  unit: UnitDraft,
  key: K,
  val: UnitDraft[K] extends FieldValue<infer T> ? T : never,
): UnitDraft {
  if (typeof val === 'number') {
    validateNumericEntry(key, val);
  }
  return Object.freeze({
    ...unit,
    [key]: { state: 'known' as const, value: val },
  });
}

export function setUnitNotKnown<K extends UnitFieldKey>(
  unit: UnitDraft,
  key: K,
  note = '',
): UnitDraft {
  const trimmed = note.trim();
  return Object.freeze({
    ...unit,
    [key]: {
      state: 'not_known' as const,
      note: trimmed === '' ? 'Marked not known by the client; no further detail supplied.' : trimmed,
    },
  });
}

export function clearUnitField<K extends UnitFieldKey>(unit: UnitDraft, key: K): UnitDraft {
  return Object.freeze({
    ...unit,
    [key]: { state: 'empty' as const },
  });
}

/* ── Actionable Findings & Submission Readiness ─────────────────────────── */

export interface FacilityFinding {
  readonly id: string;
  readonly scope: 'facility' | 'unit';
  readonly unitId?: string | undefined;
  readonly fieldKey: string;
  readonly label: string;
  readonly kind: 'not_known' | 'not_answered';
  readonly note?: string | undefined;
  readonly whoCanAnswer: string;
}

/**
 * Computes actionable findings for facility envelope and all configured units.
 * Distinguishes not_known (recorded facts) from not_answered (empty).
 */
export function collectFindings(
  facility: FacilityDraft,
  units: readonly UnitDraft[],
): readonly FacilityFinding[] {
  const findings: FacilityFinding[] = [];

  for (const spec of FACILITY_FIELD_SPECS) {
    const val = facility[spec.id];
    if (val.state === 'known') continue;
    findings.push({
      id: `facility.${spec.id}`,
      scope: 'facility',
      fieldKey: spec.id,
      label: spec.label,
      kind: val.state === 'not_known' ? 'not_known' : 'not_answered',
      note: val.state === 'not_known' ? val.note : undefined,
      whoCanAnswer: spec.whoCanAnswer,
    });
  }

  for (const unit of units) {
    const unitLabel = unit.unitName.state === 'known' ? unit.unitName.value : unit.unitId;
    for (const spec of UNIT_FIELD_SPECS) {
      const val = unit[spec.id];
      if (val.state === 'known') continue;
      findings.push({
        id: `unit.${unit.unitId}.${spec.id}`,
        scope: 'unit',
        unitId: unit.unitId,
        fieldKey: spec.id,
        label: `${unitLabel}: ${spec.label}`,
        kind: val.state === 'not_known' ? 'not_known' : 'not_answered',
        note: val.state === 'not_known' ? val.note : undefined,
        whoCanAnswer: spec.whoCanAnswer,
      });
    }
  }

  return Object.freeze(findings);
}

/**
 * Whether the facility and all units are ready to proceed.
 * Every field must be either `known` or `not_known`. Any `empty` field blocks.
 */
export function readyToSubmit(facility: FacilityDraft, units: readonly UnitDraft[]): boolean {
  if (units.length === 0) return false;

  const facilityReady = FACILITY_FIELD_SPECS.every(
    (spec) => facility[spec.id].state !== 'empty',
  );
  if (!facilityReady) return false;

  return units.every((unit) =>
    UNIT_FIELD_SPECS.every((spec) => unit[spec.id].state !== 'empty'),
  );
}

/* ── API Serialization ─────────────────────────────────────────────────── */

const UM_PER_INCH = 25_400;
const UM_PER_FOOT = 304_800;

export function toFacilityApiPayload(facility: FacilityDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (facility.facilityName.state === 'known') {
    payload['name'] = facility.facilityName.value;
  }
  if (facility.facilityAddress.state === 'known') {
    payload['address'] = facility.facilityAddress.value;
  }
  if (facility.clearHeightIn.state === 'known') {
    payload['clear_height_um'] = Math.round(facility.clearHeightIn.value * UM_PER_INCH);
  } else if (facility.clearHeightIn.state === 'not_known') {
    payload['clear_height_um'] = null;
  }
  if (facility.envelopeWidthFt.state === 'known') {
    payload['width_um'] = Math.round(facility.envelopeWidthFt.value * UM_PER_FOOT);
  } else if (facility.envelopeWidthFt.state === 'not_known') {
    payload['width_um'] = null;
  }
  if (facility.envelopeDepthFt.state === 'known') {
    payload['depth_um'] = Math.round(facility.envelopeDepthFt.value * UM_PER_FOOT);
  } else if (facility.envelopeDepthFt.state === 'not_known') {
    payload['depth_um'] = null;
  }

  if (
    facility.columnGridXIn.state === 'known' &&
    facility.columnGridYIn.state === 'known'
  ) {
    payload['column_grid'] = {
      pitch_x_um: Math.round(facility.columnGridXIn.value * UM_PER_INCH),
      pitch_y_um: Math.round(facility.columnGridYIn.value * UM_PER_INCH),
    };
  } else if (
    facility.columnGridXIn.state === 'not_known' ||
    facility.columnGridYIn.state === 'not_known'
  ) {
    payload['column_grid'] = null;
  }

  if (facility.forkliftModel.state === 'known') {
    const requiredAisleUm =
      facility.forkliftAisleIn.state === 'known'
        ? Math.round(facility.forkliftAisleIn.value * UM_PER_INCH)
        : null;
    payload['forklift'] = {
      model_stated: true,
      ...(requiredAisleUm !== null ? { required_aisle_um: requiredAisleUm } : {}),
    };
  } else if (
    facility.forkliftModel.state === 'not_known' ||
    facility.forkliftAisleIn.state === 'not_known'
  ) {
    payload['forklift'] = { model_stated: false };
  }

  if (facility.dockCount.state === 'known') {
    payload['dock_count'] = Math.round(facility.dockCount.value);
  } else if (facility.dockCount.state === 'not_known') {
    payload['dock_count'] = null;
  }

  return payload;
}

export function toUnitsApiPayload(units: readonly UnitDraft[]): { readonly units: readonly Record<string, unknown>[] } {
  return {
    units: units.map((u) => {
      const entry: Record<string, unknown> = { unit_id: u.unitId };
      if (u.unitName.state === 'known') entry['name'] = u.unitName.value;
      if (u.palletWidthIn.state === 'known') {
        entry['width_um'] = Math.round(u.palletWidthIn.value * UM_PER_INCH);
      } else if (u.palletWidthIn.state === 'not_known') {
        entry['width_um'] = null;
      }
      if (u.palletDepthIn.state === 'known') {
        entry['depth_um'] = Math.round(u.palletDepthIn.value * UM_PER_INCH);
      } else if (u.palletDepthIn.state === 'not_known') {
        entry['depth_um'] = null;
      }
      if (u.palletHeightIn.state === 'known') {
        entry['height_um'] = Math.round(u.palletHeightIn.value * UM_PER_INCH);
      } else if (u.palletHeightIn.state === 'not_known') {
        entry['height_um'] = null;
      }
      if (u.palletWeightLb.state === 'known') {
        entry['weight_lb'] = Math.round(u.palletWeightLb.value);
      } else if (u.palletWeightLb.state === 'not_known') {
        entry['weight_lb'] = null;
      }
      if (u.palletOverhangIn.state === 'known') {
        entry['overhang_um'] = Math.round(u.palletOverhangIn.value * UM_PER_INCH);
      } else if (u.palletOverhangIn.state === 'not_known') {
        entry['overhang_um'] = null;
      }
      if (u.palletsPerBay.state === 'known') {
        entry['pallets_per_bay'] = Math.round(u.palletsPerBay.value);
      }
      if (u.targetLevels.state === 'known') {
        entry['target_levels'] = Math.round(u.targetLevels.value);
      }
      if (u.commodityClass.state === 'known') {
        entry['commodity_class'] = u.commodityClass.value;
      }
      return entry;
    }),
  };
}
