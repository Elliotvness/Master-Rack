/**
 * Phase 3 — Spec-Sheet Intake (`store: false`, Human-Confirmed) & Command Bar (`Ctrl+K`).
 *
 * Strict AI Guardrails:
 * 1. **Never Auto-Fill:** Extracted or proposed values are never written directly
 *    into the `StudioDocument`. Every AI output lands in a staging confirmation
 *    table (`IntakeConfirmationRow[]`) or command preview card (`CommandPreviewCard`)
 *    requiring explicit human review and confirmation.
 * 2. **No Stored Interactions on Intake (`store: false`):** Every intake and
 *    command-bar request uses the Interactions API (`client.interactions.create`)
 *    with `model: 'gemini-3.8-flash'`, `store: false`, and structured output via
 *    `response_format: { type: 'text', mime_type: 'application/json', schema }`.
 *    Requests require a paid-tier API key (`billingTier === 'paid'`); `store: false`
 *    prevents server-side interaction persistence, though it is not a blanket
 *    claim of zero processing or logging.
 * 3. **Provenance & Verification:** Confirmed intake values enter the model via
 *    reversible `setField` commands carrying explicit provenance (`INPUT` or
 *    `CATALOG` citing the uploaded document filename and page).
 * 4. **Security:** The `GeminiInteractionsClient` and `GeminiBackendConfig` are
 *    injected from the isolated server/proxy environment — never hardcode API keys
 *    in front-end components.
 * 5. **Gemini API Mapping:** The internal `GeminiInteractionsCreateRequest` interface
 *    models an abstracted interaction contract. For the comprehensive mapping against the
 *    official Google Gemini API (`@google/genai`, `generateContent`, `responseSchema`,
 *    and data governance), see `docs/gemini-api-mapping.md`. Integrity mode: demo — no
 *    live API keys or network endpoints are connected in browser clients.
 *
 * Pure: no I/O, no clock, no RNG, no `process.env`, no `fetch`.
 */

import { lookupPublishedBeamSpan } from './catalog-options.js';
import { type Command } from './commands.js';
import { type StudioDocument } from './document.js';
import { IN } from './length.js';
import { planGeometry } from './plan.js';
import { dispatch, type Session } from './undo.js';

export const GEMINI_INTAKE_MODEL = 'gemini-3.8-flash' as const;

export type GeminiInteractionPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'inline_data';
      readonly mime_type: string;
      readonly data: string;
    };

export interface GeminiInteractionsCreateRequest {
  readonly model: typeof GEMINI_INTAKE_MODEL;
  readonly input: readonly GeminiInteractionPart[];
  readonly store: false;
  readonly response_format: {
    readonly type: 'text';
    readonly mime_type: 'application/json';
    readonly schema: Record<string, unknown>;
  };
}

export interface GeminiInteractionsClient {
  readonly interactions: {
    create(
      request: GeminiInteractionsCreateRequest,
    ): Promise<{ readonly output_text: string }>;
  };
}

export interface GeminiBackendConfig {
  readonly apiKey: string;
  readonly billingTier: 'paid' | 'free';
}

export type IntakeDocumentKind =
  | 'FORKLIFT_SPEC_SHEET'
  | 'SITE_SURVEY_CHECKLIST'
  | 'RACK_SUBMITTAL';

export type LengthUnit = 'in' | 'mm' | 'ft';

/** Convert a length value in any supported unit to integer micrometres. */
export function lengthToMicrometres(val: number, unit: LengthUnit): number {
  switch (unit) {
    case 'in':
      return Math.round(val * 25_400);
    case 'mm':
      return Math.round(val * 1_000);
    case 'ft':
      return Math.round(val * 304_800);
  }
}

// Authoritative commodity classes per NFPA 13 (Standard for the Installation of Sprinkler Systems, Chapters 5 and 20).
// Note: data/rules/studio-2026.09/rules.json FLUE-SPRINKLER-GEOMETRY is NOT_FOUND in repo rule pack.
export const ALLOWED_COMMODITY_CLASSES = [
  'Class I',
  'Class II',
  'Class III',
  'Class IV',
  'Group A Plastics',
  'Group B Plastics',
  'Group C Plastics',
] as const;
export type AllowedCommodityClass = (typeof ALLOWED_COMMODITY_CLASSES)[number];

export interface ExtractedField<T extends number | string> {
  readonly value: T;
  readonly sourcePage: number;
  readonly confidence: number;
}

export interface ExtractedLengthField {
  readonly value: number;
  readonly unit?: LengthUnit;
  readonly sourcePage: number;
  readonly confidence: number;
}

export interface IntakeExtractionPayload {
  readonly documentKind: IntakeDocumentKind;
  readonly truckType?: ExtractedField<string>;
  readonly truckRasIn?: ExtractedLengthField;
  readonly clearHeightIn?: ExtractedLengthField;
  readonly deflectorElevIn?: ExtractedLengthField;
  readonly commodityClass?: ExtractedField<string>;
  readonly sdc?: ExtractedField<string>;
  readonly frameHeightIn?: ExtractedLengthField;
  readonly beamPairCapacityLb?: ExtractedField<number>;
  readonly ratedLoadLb?: ExtractedField<number>;
}

export const INTAKE_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['documentKind'],
  properties: {
    documentKind: {
      type: 'string',
      enum: ['FORKLIFT_SPEC_SHEET', 'SITE_SURVEY_CHECKLIST', 'RACK_SUBMITTAL'],
    },
    truckType: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'string' },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    truckRasIn: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'unit', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        unit: { type: 'string', enum: ['in', 'mm', 'ft'] },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    clearHeightIn: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'unit', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        unit: { type: 'string', enum: ['in', 'mm', 'ft'] },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    deflectorElevIn: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'unit', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        unit: { type: 'string', enum: ['in', 'mm', 'ft'] },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    commodityClass: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'string', enum: [...ALLOWED_COMMODITY_CLASSES] },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    sdc: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'string' },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    frameHeightIn: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'unit', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        unit: { type: 'string', enum: ['in', 'mm', 'ft'] },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    beamPairCapacityLb: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    ratedLoadLb: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'sourcePage', 'confidence'],
      properties: {
        value: { type: 'number', exclusiveMinimum: 0 },
        sourcePage: { type: 'integer', minimum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

export interface IntakeConfirmationRow {
  readonly id: string;
  readonly fieldKey:
    | 'truckType'
    | 'truckRAS'
    | 'clearHeight'
    | 'deflectorElev'
    | 'commodityClass'
    | 'sdc'
    | 'frameHeight'
    | 'beamPairCapacity'
    | 'ratedLoad';
  readonly label: string;
  readonly currentDisplayValue: string;
  readonly extractedDisplayValue: string;
  readonly sourcePage: number;
  readonly confidence: number;
  readonly sourceCitation: string;
  readonly origin: 'INPUT' | 'CATALOG';
  readonly lowConfidence: boolean;
  readonly accepted: boolean;
  readonly command: Command;
  readonly sourceDocument?: StudioDocument;
}

export type BackendConfigCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Enforce paid-tier API key requirement before sending any customer document
 * or layout instruction to the Interactions API.
 */
export function validateGeminiBackendConfig(
  config: GeminiBackendConfig,
): BackendConfigCheck {
  if (config.apiKey.trim() === '') {
    return {
      ok: false,
      reason: 'GEMINI_API_KEY is missing in isolated backend configuration.',
    };
  }
  if (config.billingTier !== 'paid') {
    return {
      ok: false,
      reason:
        'Spec-sheet intake and command bar require a paid-tier Gemini API key (free-tier data terms differ).',
    };
  }
  return { ok: true };
}

/**
 * Build an Interactions API request for spec-sheet / submittal intake with
 * `model: 'gemini-3.8-flash'`, `store: false`, and `response_format`.
 */
export function buildSpecSheetIntakeRequest(
  documentKind: IntakeDocumentKind,
  fileName: string,
  mimeType: string,
  base64Data: string,
): GeminiInteractionsCreateRequest {
  return {
    model: GEMINI_INTAKE_MODEL,
    input: [
      {
        type: 'inline_data',
        mime_type: mimeType,
        data: base64Data,
      },
      {
        type: 'text',
        text:
          `Extract ${documentKind} parameters from ${fileName} as structured JSON. ` +
          'Include page numbers and confidence scores. Never invent missing fields.',
      },
    ],
    store: false,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: INTAKE_EXTRACTION_SCHEMA,
    },
  };
}

function isValidExtractedString(val: unknown): val is ExtractedField<string> {
  if (typeof val !== 'object' || val === null) return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec['value'] === 'string' &&
    rec['value'].trim() !== '' &&
    typeof rec['sourcePage'] === 'number' &&
    Number.isInteger(rec['sourcePage']) &&
    rec['sourcePage'] >= 1 &&
    typeof rec['confidence'] === 'number' &&
    rec['confidence'] >= 0 &&
    rec['confidence'] <= 1
  );
}

function isValidExtractedNumber(val: unknown): val is ExtractedField<number> {
  if (typeof val !== 'object' || val === null) return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec['value'] === 'number' &&
    Number.isFinite(rec['value']) &&
    rec['value'] > 0 &&
    typeof rec['sourcePage'] === 'number' &&
    Number.isInteger(rec['sourcePage']) &&
    rec['sourcePage'] >= 1 &&
    typeof rec['confidence'] === 'number' &&
    rec['confidence'] >= 0 &&
    rec['confidence'] <= 1
  );
}

const LENGTH_FIELD_KEYS = new Set<string>([
  'truckRasIn',
  'clearHeightIn',
  'deflectorElevIn',
  'frameHeightIn',
]);

/** Every optional extracted field and whether it carries a number or a string. */
const INTAKE_FIELD_KINDS: readonly (readonly [
  Exclude<keyof IntakeExtractionPayload, 'documentKind'>,
  'number' | 'string',
])[] = [
  ['truckType', 'string'],
  ['truckRasIn', 'number'],
  ['clearHeightIn', 'number'],
  ['deflectorElevIn', 'number'],
  ['commodityClass', 'string'],
  ['sdc', 'string'],
  ['frameHeightIn', 'number'],
  ['beamPairCapacityLb', 'number'],
  ['ratedLoadLb', 'number'],
];

export type ParseIntakeResult =
  | { readonly ok: true; readonly payload: IntakeExtractionPayload }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse `interaction.output_text` and validate it against `INTAKE_EXTRACTION_SCHEMA`.
 */
export function parseAndValidateIntakeOutput(rawOutputText: string): ParseIntakeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutputText);
  } catch {
    return { ok: false, reason: 'Interactions API output_text is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Interactions API output_text must be a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;
  const kind = obj['documentKind'];
  if (
    kind !== 'FORKLIFT_SPEC_SHEET' &&
    kind !== 'SITE_SURVEY_CHECKLIST' &&
    kind !== 'RACK_SUBMITTAL'
  ) {
    return {
      ok: false,
      reason: 'Invalid or missing documentKind in intake extraction payload.',
    };
  }

  const payload: Record<string, unknown> = { documentKind: kind };
  for (const [key, kindOf] of INTAKE_FIELD_KINDS) {
    const raw = obj[key];
    if (raw === undefined) continue;
    const valid =
      kindOf === 'number' ? isValidExtractedNumber(raw) : isValidExtractedString(raw);
    if (!valid) {
      return { ok: false, reason: `Invalid ${key} field in intake extraction.` };
    }
    if (LENGTH_FIELD_KEYS.has(key)) {
      const rec = raw as Record<string, unknown>;
      const unit = rec['unit'];
      if (unit !== 'in' && unit !== 'mm' && unit !== 'ft') {
        return {
          ok: false,
          reason: `${key} has missing or unknown unit '${String(unit)}'. Lengths must include an explicit unit ('in' | 'mm' | 'ft').`,
        };
      }
    }
    if (key === 'commodityClass') {
      const val = (raw as ExtractedField<string>).value;
      if (!ALLOWED_COMMODITY_CLASSES.includes(val as AllowedCommodityClass)) {
        return {
          ok: false,
          reason: `Unknown commodityClass '${val}'. Must be an authoritative NFPA 13 commodity class: ${ALLOWED_COMMODITY_CLASSES.join(', ')}.`,
        };
      }
    }
    if (key === 'sdc') {
      const letter = (raw as ExtractedField<string>).value.trim().toUpperCase();
      if (!/^[A-F]$/.test(letter)) {
        return { ok: false, reason: 'Invalid sdc field in intake extraction.' };
      }
      payload[key] = { ...(raw as ExtractedField<string>), value: letter };
    } else {
      payload[key] = raw;
    }
  }
  return { ok: true, payload: payload as unknown as IntakeExtractionPayload };
}

function formatIn(um: number): string {
  const inches = Math.round((um / 25_400) * 10) / 10;
  return `${inches} in`;
}

/** Rows below this confidence are flagged for extra scrutiny in the UI. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

function citation(fileName: string, page: number, confidence: number): string {
  const pct = Math.round(confidence * 100);
  return `Intake ${fileName} p.${page} (${pct}% confidence)`;
}

function resolveLengthUnit(f: ExtractedLengthField): LengthUnit {
  return f.unit ?? 'in';
}

/**
 * Build the staging Human Confirmation Table rows from a validated intake payload.
 *
 * **Never mutates `doc` and defaults `accepted: false` on every row** so a
 * human must explicitly review and check rows before any value enters the model.
 */
export function stageIntakeConfirmationTable(
  doc: StudioDocument,
  fileName: string,
  payload: IntakeExtractionPayload,
): readonly IntakeConfirmationRow[] {
  const rows: Omit<IntakeConfirmationRow, 'lowConfidence'>[] = [];
  const bt = doc.bayTypes[0];

  if (payload.truckType !== undefined) {
    const f = payload.truckType;
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-truckType',
      fieldKey: 'truckType',
      label: 'Lift truck type',
      currentDisplayValue: doc.equipment.truckType,
      extractedDisplayValue: f.value,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'CATALOG',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake lift truck type from ${cite}`,
        change: {
          section: 'equipment',
          patch: { truckType: f.value },
        },
      },
    });
  }

  if (payload.truckRasIn !== undefined) {
    const f = payload.truckRasIn;
    const unit = resolveLengthUnit(f);
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-truckRAS',
      fieldKey: 'truckRAS',
      label: 'Truck mfr min aisle (AST)',
      currentDisplayValue: formatIn(doc.equipment.truckRAS.value),
      extractedDisplayValue: `${f.value} ${unit}`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'CATALOG',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake truck AST from ${cite}`,
        change: {
          section: 'equipment',
          patch: {
            truckRAS: {
              value: lengthToMicrometres(f.value, unit),
              established: 'CATALOG',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.clearHeightIn !== undefined) {
    const f = payload.clearHeightIn;
    const unit = resolveLengthUnit(f);
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-clearHeight',
      fieldKey: 'clearHeight',
      label: 'Clear internal height',
      currentDisplayValue: formatIn(doc.building.clearHeight.value),
      extractedDisplayValue: `${f.value} ${unit}`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'INPUT',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake clear height from ${cite}`,
        change: {
          section: 'building',
          patch: {
            clearHeight: {
              value: lengthToMicrometres(f.value, unit),
              established: 'INPUT',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.deflectorElevIn !== undefined) {
    const f = payload.deflectorElevIn;
    const unit = resolveLengthUnit(f);
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-deflectorElev',
      fieldKey: 'deflectorElev',
      label: 'Sprinkler deflector elev.',
      currentDisplayValue: formatIn(doc.building.deflectorElev.value),
      extractedDisplayValue: `${f.value} ${unit}`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'INPUT',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake sprinkler deflector elevation from ${cite}`,
        change: {
          section: 'building',
          patch: {
            deflectorElev: {
              value: lengthToMicrometres(f.value, unit),
              established: 'INPUT',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.commodityClass !== undefined) {
    const f = payload.commodityClass;
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-commodityClass',
      fieldKey: 'commodityClass',
      label: 'Commodity class',
      currentDisplayValue: doc.building.commodityClass.value || 'VERIFY',
      extractedDisplayValue: f.value,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'INPUT',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake commodity class from ${cite}`,
        change: {
          section: 'building',
          patch: {
            commodityClass: {
              value: f.value,
              established: 'INPUT',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.sdc !== undefined) {
    const f = payload.sdc;
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-sdc',
      fieldKey: 'sdc',
      label: 'Seismic design category',
      currentDisplayValue: doc.building.sdc.value || 'VERIFY',
      extractedDisplayValue: f.value,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'INPUT',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake seismic design category from ${cite}`,
        change: {
          section: 'building',
          patch: {
            sdc: {
              value: f.value,
              established: 'INPUT',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.frameHeightIn !== undefined && bt !== undefined) {
    const f = payload.frameHeightIn;
    const unit = resolveLengthUnit(f);
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-frameHeight',
      fieldKey: 'frameHeight',
      label: 'Frame height',
      currentDisplayValue: formatIn(bt.frameHeight.value),
      extractedDisplayValue: `${f.value} ${unit}`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'CATALOG',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake frame height from ${cite}`,
        change: {
          section: 'bayType',
          bayTypeId: bt.id,
          patch: {
            frameHeight: {
              value: lengthToMicrometres(f.value, unit),
              established: 'CATALOG',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.beamPairCapacityLb !== undefined && bt !== undefined) {
    const f = payload.beamPairCapacityLb;
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-beamPairCapacity',
      fieldKey: 'beamPairCapacity',
      label: 'Beam pair capacity',
      currentDisplayValue: `${bt.beamPairCapacity.value} lb`,
      extractedDisplayValue: `${f.value} lb`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'CATALOG',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake beam pair capacity from ${cite}`,
        change: {
          section: 'bayType',
          bayTypeId: bt.id,
          patch: {
            beamPairCapacity: {
              value: f.value,
              established: 'CATALOG',
              source: cite,
            },
          },
        },
      },
    });
  }

  if (payload.ratedLoadLb !== undefined) {
    const f = payload.ratedLoadLb;
    const cite = citation(fileName, f.sourcePage, f.confidence);
    rows.push({
      id: 'intake-ratedLoad',
      fieldKey: 'ratedLoad',
      label: 'Rated unit load',
      currentDisplayValue: `${doc.unitLoad.weight} lb`,
      extractedDisplayValue: `${f.value} lb`,
      sourcePage: f.sourcePage,
      confidence: f.confidence,
      sourceCitation: cite,
      origin: 'INPUT',
      accepted: false,
      command: {
        type: 'setField',
        label: `Confirm intake rated load from ${cite}`,
        change: {
          section: 'unitLoad',
          patch: { weight: f.value },
        },
      },
    });
  }

  return rows.map((r) => ({
    ...r,
    lowConfidence: r.confidence < LOW_CONFIDENCE_THRESHOLD,
    sourceDocument: doc,
  }));
}

export const buildIntakeConfirmationRows = stageIntakeConfirmationTable;

export interface SpecSheetIntakeInput {
  readonly documentKind: IntakeDocumentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly base64Data: string;
}

export type SpecSheetIntakeResult =
  | {
      readonly ok: true;
      readonly request: GeminiInteractionsCreateRequest;
      readonly rows: readonly IntakeConfirmationRow[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Execute a spec-sheet intake request through the injected Interactions API
 * client (`gemini-3.8-flash`, `store: false`, paid-tier required) and return
 * staging rows for the Human Confirmation Table without mutating `doc`.
 */
export async function runSpecSheetIntake(
  client: GeminiInteractionsClient,
  config: GeminiBackendConfig,
  doc: StudioDocument,
  input: SpecSheetIntakeInput,
): Promise<SpecSheetIntakeResult> {
  const cfgCheck = validateGeminiBackendConfig(config);
  if (!cfgCheck.ok) return cfgCheck;

  const request = buildSpecSheetIntakeRequest(
    input.documentKind,
    input.fileName,
    input.mimeType,
    input.base64Data,
  );
  const response = await client.interactions.create(request);
  const parsed = parseAndValidateIntakeOutput(response.output_text);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    request,
    rows: stageIntakeConfirmationTable(doc, input.fileName, parsed.payload),
  };
}

/**
 * Toggle acceptance of a single row in the Human Confirmation Table.
 */
export function toggleIntakeRowAcceptance(
  rows: readonly IntakeConfirmationRow[],
  rowId: string,
): readonly IntakeConfirmationRow[] {
  return rows.map((row) =>
    row.id === rowId ? { ...row, accepted: !row.accepted } : row,
  );
}

/** True while the session still holds the exact document the intake rows were staged from. */
export function isIntakeCurrent(
  rows: readonly IntakeConfirmationRow[],
  session: Session,
): boolean {
  return rows.every((r) => r.sourceDocument === session.document);
}

/**
 * Commit ONLY the user-accepted (`accepted: true`) rows from the Human
 * Confirmation Table into `session` as undoable, provenance-cited commands.
 */
export function applyConfirmedIntakeRows(
  session: Session,
  rows: readonly IntakeConfirmationRow[],
): { readonly session: Session; readonly appliedCount: number; readonly refused?: string } {
  if (!isIntakeCurrent(rows, session)) {
    return {
      session,
      appliedCount: 0,
      refused: 'The document changed since intake staging. Intake rows are stale.',
    };
  }
  const accepted = rows.filter((r) => r.accepted);
  const res = dispatchAll(session, accepted.map((r) => r.command));
  if (!res.ok) return { session, appliedCount: 0, refused: res.msg };
  return { session: res.session, appliedCount: accepted.length };
}

/* ── Step 3.2: Deterministic Command Bar (Ctrl+K) ─────────────────────── */

export const COMMAND_BAR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['commands'],
  properties: {
    commands: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: [
              'setAisleAfter',
              'splitRun',
              'addRun',
              'setBeamSpan',
              'setClearHeight',
              'setTruckRas',
            ],
          },
          runIndex: { type: 'integer', minimum: 0 },
          bayIndex: { type: 'integer', minimum: 1 },
          inches: { type: 'number', exclusiveMinimum: 0 },
          beamFamily: { type: 'string' },
        },
      },
    },
  },
};

export interface CommandPreviewCard {
  readonly instruction: string;
  readonly commands: readonly Command[];
  readonly descriptions: readonly string[];
  readonly beforePositions: number;
  readonly afterPositions: number;
  readonly deltaPositions: number;
  readonly beforeBays: number;
  readonly afterBays: number;
  readonly beforeNarrowestAisleIn: number | null;
  readonly afterNarrowestAisleIn: number | null;
  /** Descriptions of commands that refused during the dry run. */
  readonly refused: readonly string[];
  /** The document the preview was computed against; Execute must refuse if it changed. */
  readonly sourceDocument: StudioDocument;
}

/** True while the session still holds the exact document the preview was built from. */
export function isPreviewCurrent(card: CommandPreviewCard, session: Session): boolean {
  return card.sourceDocument === session.document;
}

/**
 * Apply every command or none. Returns the final session, or the first refusal.
 */
export function dispatchAll(
  session: Session,
  commands: readonly Command[],
): { readonly ok: true; readonly session: Session } | { readonly ok: false; readonly msg: string } {
  if (commands.length === 0) {
    return { ok: true, session };
  }
  const res = dispatch(session, { type: 'batch', commands });
  if (!res.ok) return { ok: false, msg: res.msg };
  return { ok: true, session: res.session };
}

/**
 * Build an Interactions API request for the Deterministic Command Bar (`Ctrl+K`)
 * with `model: 'gemini-3.8-flash'`, `store: false`, and `COMMAND_BAR_SCHEMA`.
 */
export function buildCommandBarRequest(
  instruction: string,
  doc: StudioDocument,
): GeminiInteractionsCreateRequest {
  const runSummary = doc.runs
    .map((r, i) => `RunIndex ${i} (${r.name}, ${r.bays.length} bays)`)
    .join('; ');
  return {
    model: GEMINI_INTAKE_MODEL,
    input: [
      {
        type: 'text',
        text:
          `Translate layout instruction into structured studio commands. ` +
          `Current runs: ${runSummary}. Instruction: ${instruction}`,
      },
    ],
    store: false,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: COMMAND_BAR_SCHEMA,
    },
  };
}

export type ParseCommandBarResult =
  | {
      readonly ok: true;
      readonly commands: readonly Command[];
      readonly descriptions: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse and validate `interaction.output_text` from the Command Bar into a
 * typed array of `@rms/studio-model` `Command`s.
 */
export function parseAndValidateCommandBarOutput(
  rawOutputText: string,
  doc: StudioDocument,
): ParseCommandBarResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutputText);
  } catch {
    return { ok: false, reason: 'Command bar output_text is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Command bar output_text must be a JSON object.' };
  }
  const rawCommands = (parsed as Record<string, unknown>)['commands'];
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
    return {
      ok: false,
      reason: 'Command bar output_text must contain a non-empty commands array.',
    };
  }

  const commands: Command[] = [];
  const descriptions: string[] = [];
  const bt = doc.bayTypes[0];

  for (const item of rawCommands) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, reason: 'Command descriptor must be an object.' };
    }
    const rec = item as Record<string, unknown>;
    const action = rec['action'];

    switch (action) {
      case 'setAisleAfter': {
        const runIdx = typeof rec['runIndex'] === 'number' ? rec['runIndex'] : -1;
        const inchesVal = rec['inches'];
        const targetRun = doc.runs[runIdx];
        if (
          targetRun === undefined ||
          typeof inchesVal !== 'number' ||
          !Number.isFinite(inchesVal) ||
          inchesVal <= 0
        ) {
          return {
            ok: false,
            reason: 'Invalid runIndex or inches in setAisleAfter command.',
          };
        }
        commands.push({
          type: 'setAisleAfter',
          runId: targetRun.id,
          frameToFrame: IN(inchesVal),
        });
        descriptions.push(`Set aisle after ${targetRun.name} to ${inchesVal}"`);
        break;
      }
      case 'splitRun': {
        const runIdx = typeof rec['runIndex'] === 'number' ? rec['runIndex'] : -1;
        const bayIdx = typeof rec['bayIndex'] === 'number' ? rec['bayIndex'] : -1;
        const targetRun = doc.runs[runIdx];
        const targetBay = targetRun?.bays[bayIdx];
        if (targetRun === undefined || targetBay === undefined) {
          return {
            ok: false,
            reason: 'Invalid runIndex or bayIndex in splitRun command.',
          };
        }
        commands.push({
          type: 'splitRun',
          bayId: targetBay.id,
        });
        descriptions.push(`Split ${targetRun.name} at bay ${bayIdx + 1}`);
        break;
      }
      case 'addRun': {
        commands.push({ type: 'addRun' });
        descriptions.push('Append a new rack run');
        break;
      }
      case 'setBeamSpan': {
        const inchesVal = rec['inches'];
        const family =
          typeof rec['beamFamily'] === 'string' ? rec['beamFamily'].trim() : '';
        if (
          family === '' ||
          doc.packs.rack === '' ||
          bt === undefined ||
          typeof inchesVal !== 'number' ||
          !Number.isFinite(inchesVal) ||
          inchesVal <= 0
        ) {
          return {
            ok: false,
            reason:
              'setBeamSpan needs a positive span, an explicit beamFamily and a pinned rack pack.',
          };
        }
        const looked = lookupPublishedBeamSpan(family, inchesVal);
        const resolved =
          looked.status === 'OFF_GRID' && looked.upperSpanIn !== null
            ? lookupPublishedBeamSpan(family, looked.upperSpanIn)
            : looked;
        if (resolved.status !== 'ON_GRID') {
          return {
            ok: false,
            reason: `No published ${family} span at or above ${inchesVal}". Nothing is invented.`,
          };
        }
        const spanIn = resolved.spanIn;
        const capLb = resolved.capacityLb;
        const partLabel = resolved.beamPartLabel;
        const snapped = spanIn !== inchesVal;
        const packId = doc.packs.rack;
        commands.push({
          type: 'setField',
          label: `Command bar: set beam span to ${spanIn}" (${family})`,
          change: {
            section: 'bayType',
            bayTypeId: bt.id,
            patch: {
              beamPart: partLabel,
              beamLength: IN(spanIn),
              beamPairCapacity: {
                value: capLb,
                established: 'CATALOG',
                source: `Catalog ${packId} (${family}/${spanIn}")`,
              },
            },
          },
        });
        descriptions.push(
          snapped
            ? `Set beam span to ${spanIn}" (${partLabel}), snapped up from requested ${inchesVal}"`
            : `Set beam span to ${spanIn}" (${partLabel})`,
        );
        break;
      }
      case 'setClearHeight': {
        const inchesVal = rec['inches'];
        if (
          typeof inchesVal !== 'number' ||
          !Number.isFinite(inchesVal) ||
          inchesVal <= 0
        ) {
          return {
            ok: false,
            reason: 'Invalid inches in setClearHeight command.',
          };
        }
        commands.push({
          type: 'setField',
          label: `Command bar: set clear height to ${inchesVal}"`,
          change: {
            section: 'building',
            patch: {
              clearHeight: {
                value: IN(inchesVal),
                established: 'INPUT',
                source: 'Command bar user entry',
              },
            },
          },
        });
        descriptions.push(`Set clear internal height to ${inchesVal}"`);
        break;
      }
      case 'setTruckRas': {
        const inchesVal = rec['inches'];
        if (
          typeof inchesVal !== 'number' ||
          !Number.isFinite(inchesVal) ||
          inchesVal <= 0
        ) {
          return {
            ok: false,
            reason: 'Invalid inches in setTruckRas command.',
          };
        }
        commands.push({
          type: 'setField',
          label: `Command bar: set truck min aisle to ${inchesVal}"`,
          change: {
            section: 'equipment',
            patch: {
              truckRAS: {
                value: IN(inchesVal),
                established: 'INPUT',
                source: 'Command bar user entry',
              },
            },
          },
        });
        descriptions.push(`Set truck manufacturer min aisle to ${inchesVal}"`);
        break;
      }
      default:
        return {
          ok: false,
          reason: `Unsupported command bar action: ${String(action)}`,
        };
    }
  }

  return { ok: true, commands, descriptions };
}

/**
 * Compute a non-mutating **Command Preview Card** showing the exact sequence
 * of commands and their derived geometric delta before the user clicks Execute.
 */
export function previewCommandSequence(
  session: Session,
  instruction: string,
  commands: readonly Command[],
  descriptions: readonly string[],
): CommandPreviewCard {
  const beforePlan = planGeometry(session.document);
  const beforeNarrowest =
    beforePlan.aisles.length > 0
      ? Math.round(
          Math.min(...beforePlan.aisles.map((a) => a.clearBetweenLoads.value)) /
            25_400,
        )
      : null;

  let tempSession = session;
  const refused: string[] = [];
  commands.forEach((cmd, i) => {
    const res = dispatch(tempSession, cmd);
    if (res.ok) {
      tempSession = res.session;
    } else {
      refused.push(`${descriptions[i] ?? cmd.type}: ${res.msg}`);
    }
  });

  const afterPlan = planGeometry(tempSession.document);
  const afterNarrowest =
    afterPlan.aisles.length > 0
      ? Math.round(
          Math.min(...afterPlan.aisles.map((a) => a.clearBetweenLoads.value)) /
            25_400,
        )
      : null;

  return {
    instruction,
    commands,
    descriptions,
    beforePositions: beforePlan.totalPositions,
    afterPositions: afterPlan.totalPositions,
    deltaPositions: afterPlan.totalPositions - beforePlan.totalPositions,
    beforeBays: beforePlan.totalBays,
    afterBays: afterPlan.totalBays,
    beforeNarrowestAisleIn: beforeNarrowest,
    afterNarrowestAisleIn: afterNarrowest,
    refused,
    sourceDocument: session.document,
  };
}

export type CommandBarRunResult =
  | {
      readonly ok: true;
      readonly request: GeminiInteractionsCreateRequest;
      readonly preview: CommandPreviewCard;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Translate a natural-language layout instruction into a previewable command
 * sequence via `client.interactions.create` (`gemini-3.8-flash`, `store: false`).
 */
export async function runCommandBarInstruction(
  client: GeminiInteractionsClient,
  config: GeminiBackendConfig,
  session: Session,
  instruction: string,
): Promise<CommandBarRunResult> {
  const cfgCheck = validateGeminiBackendConfig(config);
  if (!cfgCheck.ok) return cfgCheck;

  const request = buildCommandBarRequest(instruction, session.document);
  const response = await client.interactions.create(request);
  const parsed = parseAndValidateCommandBarOutput(
    response.output_text,
    session.document,
  );
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    request,
    preview: previewCommandSequence(
      session,
      instruction,
      parsed.commands,
      parsed.descriptions,
    ),
  };
}
