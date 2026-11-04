import { describe, expect, it } from 'vitest';

import fixture from '../../../fixtures/continuity/rack-studio-v1.json';
import {
  ALLOWED_COMMODITY_CLASSES,
  COMMAND_BAR_SCHEMA,
  GEMINI_INTAKE_MODEL,
  INTAKE_EXTRACTION_SCHEMA,
  applyConfirmedIntakeRows,
  buildCommandBarRequest,
  buildIntakeConfirmationRows,
  buildSpecSheetIntakeRequest,
  dispatchAll,
  isIntakeCurrent,
  isPreviewCurrent,
  lengthToMicrometres,
  parseAndValidateCommandBarOutput,
  parseAndValidateIntakeOutput,
  previewCommandSequence,
  runCommandBarInstruction,
  runSpecSheetIntake,
  stageIntakeConfirmationTable,
  toggleIntakeRowAcceptance,
  validateGeminiBackendConfig,
  type GeminiBackendConfig,
  type GeminiInteractionsClient,
  type GeminiInteractionsCreateRequest,
} from './ai-intake.js';
import { EMPTY_LEDGER, redo, undo, type Session } from './undo.js';
import { IN } from './length.js';
import { migrate } from './migrate.js';

function baseSession(): Session {
  const migrated = migrate(fixture.document);
  return {
    document: migrated.document,
    counter: migrated.counter,
    ledger: EMPTY_LEDGER,
  };
}

const PAID_CONFIG: GeminiBackendConfig = {
  apiKey: 'test-paid-gemini-api-key',
  billingTier: 'paid',
};

describe('Phase 3 — Spec-Sheet Intake & Command Bar (gemini-3.8-flash, store: false)', () => {
  it('enforces paid-tier API key requirement before calling Interactions API', async () => {
    const s = baseSession();
    let called = false;
    const client: GeminiInteractionsClient = {
      interactions: {
        async create() {
          called = true;
          return { output_text: '{}' };
        },
      },
    };

    expect(
      validateGeminiBackendConfig({ apiKey: '   ', billingTier: 'paid' }).ok,
    ).toBe(false);
    expect(
      validateGeminiBackendConfig({ apiKey: 'key', billingTier: 'free' }).ok,
    ).toBe(false);
    expect(validateGeminiBackendConfig(PAID_CONFIG).ok).toBe(true);

    const freeIntake = await runSpecSheetIntake(
      client,
      { apiKey: 'key', billingTier: 'free' },
      s.document,
      {
        documentKind: 'FORKLIFT_SPEC_SHEET',
        fileName: 'raymond.pdf',
        mimeType: 'application/pdf',
        base64Data: 'JVBERi0=',
      },
    );
    expect(freeIntake.ok).toBe(false);
    expect(called).toBe(false);

    const freeCmd = await runCommandBarInstruction(
      client,
      { apiKey: '', billingTier: 'paid' },
      s,
      'Add a run',
    );
    expect(freeCmd.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('sends store: false, model: gemini-3.8-flash, and response_format on every intake request', async () => {
    const s = baseSession();
    const captured: GeminiInteractionsCreateRequest[] = [];
    const client: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          captured.push(req);
          return {
            output_text: JSON.stringify({
              documentKind: 'FORKLIFT_SPEC_SHEET',
              truckType: { value: 'Stand-up reach', sourcePage: 2, confidence: 0.98 },
              truckRasIn: { value: 108, unit: 'in', sourcePage: 2, confidence: 0.96 },
              clearHeightIn: { value: 384, unit: 'in', sourcePage: 1, confidence: 0.95 },
              deflectorElevIn: { value: 366, unit: 'in', sourcePage: 1, confidence: 0.94 },
              commodityClass: { value: 'Class III', sourcePage: 3, confidence: 0.91 },
              sdc: { value: 'D', sourcePage: 3, confidence: 0.92 },
              frameHeightIn: { value: 288, unit: 'in', sourcePage: 4, confidence: 0.97 },
              beamPairCapacityLb: { value: 5710, sourcePage: 4, confidence: 0.99 },
              ratedLoadLb: { value: 2400, sourcePage: 4, confidence: 0.93 },
            }),
          };
        },
      },
    };

    const req = buildSpecSheetIntakeRequest(
      'FORKLIFT_SPEC_SHEET',
      'Raymond-7500.pdf',
      'application/pdf',
      'JVBERi0=',
    );
    expect(req.model).toBe(GEMINI_INTAKE_MODEL);
    expect(req.store).toBe(false);
    expect(req.response_format).toEqual({
      type: 'text',
      mime_type: 'application/json',
      schema: INTAKE_EXTRACTION_SCHEMA,
    });

    const result = await runSpecSheetIntake(client, PAID_CONFIG, s.document, {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      fileName: 'Raymond-7500.pdf',
      mimeType: 'application/pdf',
      base64Data: 'JVBERi0=',
    });

    expect(result.ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]?.store).toBe(false);
    expect(captured[0]?.model).toBe('gemini-3.8-flash');

    if (result.ok) {
      expect(result.rows.length).toBe(9);
      // Every staged row defaults to accepted: false (never auto-fills)
      expect(result.rows.every((r) => r.accepted === false)).toBe(true);
      expect(s.document.equipment.truckRAS.established).toBe('UNKNOWN');

      // Check 2 rows in the Human Confirmation Table and commit
      let rows = toggleIntakeRowAcceptance(result.rows, 'intake-truckRAS');
      rows = toggleIntakeRowAcceptance(rows, 'intake-clearHeight');
      const applied = applyConfirmedIntakeRows(s, rows);
      expect(applied.appliedCount).toBe(2);
      expect(applied.session.document.equipment.truckRAS.value).toBe(IN(108));
      expect(applied.session.document.equipment.truckRAS.established).toBe('CATALOG');
      expect(applied.session.document.equipment.truckRAS.source).toContain(
        'Raymond-7500.pdf p.2',
      );
      expect(applied.session.document.building.clearHeight.value).toBe(IN(384));
      expect(applied.session.document.building.clearHeight.established).toBe('INPUT');
    }
  });

  it('handles stageIntakeConfirmationTable when bayTypes is empty or fields are already set', () => {
    const s = baseSession();
    const docWithNoBayTypes = {
      ...s.document,
      bayTypes: [],
      building: {
        ...s.document.building,
        commodityClass: { value: 'Class II', established: 'INPUT' as const },
        sdc: { value: 'C', established: 'INPUT' as const },
      },
    };
    const rows = stageIntakeConfirmationTable(docWithNoBayTypes, 'survey.pdf', {
      documentKind: 'SITE_SURVEY_CHECKLIST',
      commodityClass: { value: 'Class IV', sourcePage: 1, confidence: 0.9 },
      sdc: { value: 'D', sourcePage: 1, confidence: 0.9 },
      frameHeightIn: { value: 240, unit: 'in', sourcePage: 2, confidence: 0.95 },
      beamPairCapacityLb: { value: 5000, sourcePage: 2, confidence: 0.95 },
    });
    expect(rows.length).toBe(2);
    expect(rows[0]?.currentDisplayValue).toBe('Class II');
    expect(rows[1]?.currentDisplayValue).toBe('C');
  });

  it('rejects malformed or out-of-schema intake output_text payloads', () => {
    expect(parseAndValidateIntakeOutput('not-json').ok).toBe(false);
    expect(parseAndValidateIntakeOutput('[]').ok).toBe(false);
    expect(parseAndValidateIntakeOutput('null').ok).toBe(false);
    expect(parseAndValidateIntakeOutput('{"documentKind":"UNKNOWN"}').ok).toBe(false);

    const invalidCases: Record<string, unknown>[] = [
      { documentKind: 'FORKLIFT_SPEC_SHEET', truckType: null },
      {
        documentKind: 'FORKLIFT_SPEC_SHEET',
        truckType: { value: '', sourcePage: 1, confidence: 0.5 },
      },
      {
        documentKind: 'FORKLIFT_SPEC_SHEET',
        truckRasIn: null,
      },
      {
        documentKind: 'FORKLIFT_SPEC_SHEET',
        truckRasIn: { value: -10, sourcePage: 1, confidence: 0.5 },
      },
      {
        documentKind: 'SITE_SURVEY_CHECKLIST',
        clearHeightIn: { value: 300, sourcePage: 0, confidence: 0.5 },
      },
      {
        documentKind: 'SITE_SURVEY_CHECKLIST',
        deflectorElevIn: { value: 300, sourcePage: 1, confidence: 1.5 },
      },
      {
        documentKind: 'SITE_SURVEY_CHECKLIST',
        commodityClass: { value: '   ', sourcePage: 1, confidence: 0.8 },
      },
      {
        documentKind: 'SITE_SURVEY_CHECKLIST',
        sdc: { value: '', sourcePage: 1, confidence: 0.8 },
      },
      {
        documentKind: 'RACK_SUBMITTAL',
        frameHeightIn: { value: 0, sourcePage: 1, confidence: 0.8 },
      },
      {
        documentKind: 'RACK_SUBMITTAL',
        beamPairCapacityLb: { value: -1, sourcePage: 1, confidence: 0.8 },
      },
      {
        documentKind: 'RACK_SUBMITTAL',
        ratedLoadLb: { value: 0, sourcePage: 1, confidence: 0.8 },
      },
    ];

    for (const bad of invalidCases) {
      expect(parseAndValidateIntakeOutput(JSON.stringify(bad)).ok).toBe(false);
    }

    const minimalOk = parseAndValidateIntakeOutput(
      JSON.stringify({ documentKind: 'RACK_SUBMITTAL' }),
    );
    expect(minimalOk.ok).toBe(true);
  });

  it('propagates parse errors from runSpecSheetIntake and handles refused commands on apply', async () => {
    const s = baseSession();
    const badClient: GeminiInteractionsClient = {
      interactions: {
        async create() {
          return { output_text: 'invalid-json' };
        },
      },
    };
    const res = await runSpecSheetIntake(badClient, PAID_CONFIG, s.document, {
      documentKind: 'RACK_SUBMITTAL',
      fileName: 'bad.pdf',
      mimeType: 'application/pdf',
      base64Data: 'AAAA',
    });
    expect(res.ok).toBe(false);

    // A row whose command is refused does not increment appliedCount
    const refusedRow = {
      id: 'bad-row',
      fieldKey: 'truckType' as const,
      label: 'Bad',
      currentDisplayValue: 'a',
      extractedDisplayValue: 'b',
      sourcePage: 1,
      confidence: 0.9,
      sourceCitation: 'bad.pdf p.1',
      origin: 'INPUT' as const,
      lowConfidence: false,
      accepted: true,
      sourceDocument: s.document,
      command: {
        type: 'setField' as const,
        label: '   ', // empty label refuses in setField
        change: { section: 'project' as const, patch: { name: 'X' } },
      },
    };
    const applied = applyConfirmedIntakeRows(s, [refusedRow]);
    expect(applied.appliedCount).toBe(0);
    expect(applied.refused).toBeDefined();
    expect(applied.session).toBe(s);
  });

  it('applies confirmed intake rows all-or-nothing', () => {
    const s = baseSession();
    const rows = stageIntakeConfirmationTable(s.document, 'spec.pdf', {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      truckType: { value: 'Reach', sourcePage: 1, confidence: 0.5 },
    }).map((r) => ({ ...r, accepted: true }));
    expect(rows[0]?.lowConfidence).toBe(true);
    const bad = { ...rows[0]!, id: 'bad', command: { type: 'setField' as const, label: ' ', change: { section: 'project' as const, patch: { name: 'X' } } } };
    const res = applyConfirmedIntakeRows(s, [...rows, bad]);
    expect(res.appliedCount).toBe(0);
    expect(res.session).toBe(s);
  });

  it('rejects invalid SDC and refuses unresolved or unpinned beam spans', () => {
    const s = baseSession();
    expect(
      parseAndValidateIntakeOutput(
        JSON.stringify({ documentKind: 'SITE_SURVEY_CHECKLIST', sdc: { value: 'Z', sourcePage: 1, confidence: 0.9 } }),
      ).ok,
    ).toBe(false);
    const okSdc = parseAndValidateIntakeOutput(
      JSON.stringify({ documentKind: 'SITE_SURVEY_CHECKLIST', sdc: { value: ' d ', sourcePage: 1, confidence: 0.9 } }),
    );
    expect(okSdc.ok && okSdc.payload.sdc?.value).toBe('D');
    const parse = (c: Record<string, unknown>, doc = s.document) =>
      parseAndValidateCommandBarOutput(JSON.stringify({ commands: [c] }), doc).ok;
    expect(parse({ action: 'setBeamSpan', inches: 96 })).toBe(false);
    expect(parse({ action: 'setBeamSpan', inches: 96, beamFamily: 'UNKNOWN_FAM' })).toBe(false);
    expect(
      parse({ action: 'setBeamSpan', inches: 96, beamFamily: '50ER' }, {
        ...s.document,
        packs: { ...s.document.packs, rack: '' },
      }),
    ).toBe(false);
    expect(parse({ action: 'setAisleAfter', inches: 120 })).toBe(false);
  });

  it('translates Command Bar instructions with store: false and previews geometric delta', async () => {
    const s = baseSession();
    const captured: GeminiInteractionsCreateRequest[] = [];
    const client: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          captured.push(req);
          return {
            output_text: JSON.stringify({
              commands: [
                { action: 'splitRun', runIndex: 0, bayIndex: 3 },
                { action: 'setAisleAfter', runIndex: 0, inches: 138 },
                { action: 'addRun' },
                { action: 'setBeamSpan', inches: 108, beamFamily: '50ER' },
                { action: 'setBeamSpan', inches: 100, beamFamily: '50ER' }, // off-grid -> snaps to 102"
                { action: 'setClearHeight', inches: 400 },
                { action: 'setTruckRas', inches: 114 },
              ],
            }),
          };
        },
      },
    };

    const req = buildCommandBarRequest(
      'Split Run 1 at Bay 4 and widen aisle to 138 in',
      s.document,
    );
    expect(req.model).toBe(GEMINI_INTAKE_MODEL);
    expect(req.store).toBe(false);
    expect(req.response_format).toEqual({
      type: 'text',
      mime_type: 'application/json',
      schema: COMMAND_BAR_SCHEMA,
    });

    const res = await runCommandBarInstruction(
      client,
      PAID_CONFIG,
      s,
      'Split Run 1 at Bay 4 and widen aisle to 138 in',
    );
    expect(res.ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]?.store).toBe(false);

    if (res.ok) {
      expect(res.preview.commands.length).toBe(7);
      expect(res.preview.descriptions.length).toBe(7);
      expect(res.preview.descriptions.some((d) => d.includes('snapped up'))).toBe(true);
      expect(res.preview.refused).toEqual([]);
      expect(isPreviewCurrent(res.preview, s)).toBe(true);
      expect(res.preview.afterBays).toBeGreaterThan(res.preview.beforeBays);
      expect(res.preview.deltaPositions).toBe(
        res.preview.afterPositions - res.preview.beforePositions,
      );
      // Original session document is untouched until user clicks Execute
      expect(s.document.runs.length).toBe(3);
    }
  });

  it('handles previewCommandSequence when a document has a single run (no aisles) or a command refuses', () => {
    const s = baseSession();
    const docEmptyRackPack = {
      ...s.document,
      packs: { ...s.document.packs, rack: '' },
    };
    const parsedEmptyRack = parseAndValidateCommandBarOutput(
      JSON.stringify({ commands: [{ action: 'setBeamSpan', inches: 96, beamFamily: '50ER' }] }),
      docEmptyRackPack,
    );
    expect(parsedEmptyRack.ok).toBe(false);

    const singleRunSession: Session = {
      ...s,
      document: {
        ...s.document,
        runs: s.document.runs.slice(0, 1),
      },
    };
    const preview = previewCommandSequence(
      singleRunSession,
      'Try invalid split',
      [{ type: 'splitRun', bayId: 'non-existent-bay' as never }],
      ['Try invalid split'],
    );
    expect(preview.beforeNarrowestAisleIn).toBeNull();
    expect(preview.afterNarrowestAisleIn).toBeNull();
    expect(preview.refused.length).toBe(1);

    // A refused command with no matching description falls back to its type
    const noDesc = previewCommandSequence(
      singleRunSession,
      'No description',
      [{ type: 'splitRun', bayId: 'non-existent-bay' as never }],
      [],
    );
    expect(noDesc.refused[0]).toMatch(/^splitRun: /);
  });

  it('rejects malformed or invalid Command Bar output_text payloads', async () => {
    const s = baseSession();
    expect(parseAndValidateCommandBarOutput('bad-json', s.document).ok).toBe(false);
    expect(parseAndValidateCommandBarOutput('[]', s.document).ok).toBe(false);
    expect(parseAndValidateCommandBarOutput('{}', s.document).ok).toBe(false);
    expect(
      parseAndValidateCommandBarOutput('{"commands":[]}', s.document).ok,
    ).toBe(false);
    expect(
      parseAndValidateCommandBarOutput('{"commands":[null]}', s.document).ok,
    ).toBe(false);

    const badCommands: Record<string, unknown>[] = [
      { action: 'setAisleAfter', runIndex: 99, inches: 120 },
      { action: 'setAisleAfter', inches: -5 },
      { action: 'splitRun', runIndex: 0, bayIndex: 99 },
      { action: 'splitRun', runIndex: 99, bayIndex: 1 },
      { action: 'splitRun' },
      { action: 'setBeamSpan', inches: 0 },
      { action: 'setClearHeight', inches: 0 },
      { action: 'setTruckRas', inches: -1 },
      { action: 'unknownAction' },
    ];

    for (const cmd of badCommands) {
      expect(
        parseAndValidateCommandBarOutput(
          JSON.stringify({ commands: [cmd] }),
          s.document,
        ).ok,
      ).toBe(false);
    }

    const badClient: GeminiInteractionsClient = {
      interactions: {
        async create() {
          return { output_text: '{"commands":[]}' };
        },
      },
    };
    const failedRun = await runCommandBarInstruction(
      badClient,
      PAID_CONFIG,
      s,
      'Invalid',
    );
    expect(failedRun.ok).toBe(false);
  });

  it('converts lengths to integer micrometres across in, mm, and ft', () => {
    expect(lengthToMicrometres(1, 'in')).toBe(25_400);
    expect(lengthToMicrometres(108, 'in')).toBe(2_743_200);
    expect(lengthToMicrometres(1, 'mm')).toBe(1_000);
    expect(lengthToMicrometres(2743, 'mm')).toBe(2_743_000);
    expect(lengthToMicrometres(1, 'ft')).toBe(304_800);
    expect(lengthToMicrometres(9, 'ft')).toBe(2_743_200);
  });

  it('rejects length fields with missing or unknown units in intake output', () => {
    const lengthFields = ['truckRasIn', 'clearHeightIn', 'deflectorElevIn', 'frameHeightIn'] as const;

    for (const field of lengthFields) {
      // Missing unit
      const missing = parseAndValidateIntakeOutput(
        JSON.stringify({
          documentKind: 'FORKLIFT_SPEC_SHEET',
          [field]: { value: 108, sourcePage: 1, confidence: 0.95 },
        }),
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.reason).toBe(
          `${field} has missing or unknown unit 'undefined'. Lengths must include an explicit unit ('in' | 'mm' | 'ft').`,
        );
      }

      // Unknown unit
      const unknownUnit = parseAndValidateIntakeOutput(
        JSON.stringify({
          documentKind: 'FORKLIFT_SPEC_SHEET',
          [field]: { value: 108, unit: 'meters', sourcePage: 1, confidence: 0.95 },
        }),
      );
      expect(unknownUnit.ok).toBe(false);
      if (!unknownUnit.ok) {
        expect(unknownUnit.reason).toBe(
          `${field} has missing or unknown unit 'meters'. Lengths must include an explicit unit ('in' | 'mm' | 'ft').`,
        );
      }

      // Valid units pass
      for (const validUnit of ['in', 'mm', 'ft'] as const) {
        const okRes = parseAndValidateIntakeOutput(
          JSON.stringify({
            documentKind: 'FORKLIFT_SPEC_SHEET',
            [field]: { value: 108, unit: validUnit, sourcePage: 1, confidence: 0.95 },
          }),
        );
        expect(okRes.ok).toBe(true);
      }
    }
  });

  it('validates commodityClass strictly against authoritative NFPA 13 classes', () => {
    // All 7 authoritative classes pass
    for (const validClass of ALLOWED_COMMODITY_CLASSES) {
      const ok = parseAndValidateIntakeOutput(
        JSON.stringify({
          documentKind: 'SITE_SURVEY_CHECKLIST',
          commodityClass: { value: validClass, sourcePage: 1, confidence: 0.9 },
        }),
      );
      expect(ok.ok).toBe(true);
    }

    // Invalid classes rejected citing NFPA 13
    const badClasses = ['Class V', 'Flammables', 'Hazardous', 'Group D Plastics', 'General'];
    for (const bad of badClasses) {
      const res = parseAndValidateIntakeOutput(
        JSON.stringify({
          documentKind: 'SITE_SURVEY_CHECKLIST',
          commodityClass: { value: bad, sourcePage: 1, confidence: 0.9 },
        }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('Unknown commodityClass');
        expect(res.reason).toContain('NFPA 13');
        expect(res.reason).toContain(ALLOWED_COMMODITY_CLASSES.join(', '));
      }
    }
  });

  it('stages confirmation rows with explicit units, exact micrometre conversions, and attached sourceDocument', () => {
    const s = baseSession();
    const rows = stageIntakeConfirmationTable(s.document, 'metric-submittal.pdf', {
      documentKind: 'RACK_SUBMITTAL',
      truckRasIn: { value: 2743, unit: 'mm', sourcePage: 1, confidence: 0.95 },
      clearHeightIn: { value: 32, unit: 'ft', sourcePage: 2, confidence: 0.92 },
      frameHeightIn: { value: 24, unit: 'ft', sourcePage: 3, confidence: 0.98 },
    });

    expect(buildIntakeConfirmationRows).toBe(stageIntakeConfirmationTable);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.sourceDocument === s.document)).toBe(true);

    const rasRow = rows.find((r) => r.fieldKey === 'truckRAS');
    expect(rasRow?.extractedDisplayValue).toBe('2743 mm');
    expect(rasRow?.command).toEqual({
      type: 'setField',
      label: expect.stringContaining('metric-submittal.pdf p.1'),
      change: {
        section: 'equipment',
        patch: {
          truckRAS: {
            value: 2_743_000,
            established: 'CATALOG',
            source: expect.stringContaining('metric-submittal.pdf p.1'),
          },
        },
      },
    });

    const clearRow = rows.find((r) => r.fieldKey === 'clearHeight');
    expect(clearRow?.extractedDisplayValue).toBe('32 ft');
    expect(clearRow?.command).toEqual({
      type: 'setField',
      label: expect.stringContaining('metric-submittal.pdf p.2'),
      change: {
        section: 'building',
        patch: {
          clearHeight: {
            value: 32 * 304_800,
            established: 'INPUT',
            source: expect.stringContaining('metric-submittal.pdf p.2'),
          },
        },
      },
    });

    // Tests resolveLengthUnit default when unit is omitted
    const legacyRows = stageIntakeConfirmationTable(s.document, 'legacy.pdf', {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      truckRasIn: { value: 108, sourcePage: 1, confidence: 0.95 },
    });
    expect(legacyRows[0]?.extractedDisplayValue).toBe('108 in');
    expect(legacyRows[0]?.command).toEqual({
      type: 'setField',
      label: expect.stringContaining('legacy.pdf p.1'),
      change: {
        section: 'equipment',
        patch: {
          truckRAS: {
            value: 108 * 25_400,
            established: 'CATALOG',
            source: expect.stringContaining('legacy.pdf p.1'),
          },
        },
      },
    });
  });

  it('isIntakeCurrent correctly detects freshness and stale document changes', () => {
    const s = baseSession();
    expect(isIntakeCurrent([], s)).toBe(true);

    const rows = stageIntakeConfirmationTable(s.document, 'spec.pdf', {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      truckType: { value: 'Counterbalance', sourcePage: 1, confidence: 0.9 },
    });
    expect(isIntakeCurrent(rows, s)).toBe(true);

    // Modify document in session
    const modifiedSession: Session = {
      ...s,
      document: {
        ...s.document,
        name: 'Modified Job',
      },
    };
    expect(isIntakeCurrent(rows, modifiedSession)).toBe(false);

    // Applying stale rows refuses and leaves session untouched
    const staleResult = applyConfirmedIntakeRows(modifiedSession, [
      { ...rows[0]!, accepted: true },
    ]);
    expect(staleResult.appliedCount).toBe(0);
    expect(staleResult.refused).toBe(
      'The document changed since intake staging. Intake rows are stale.',
    );
    expect(staleResult.session).toBe(modifiedSession);
  });

  it('dispatches confirmed intake rows as a single batch command with single-step undo and redo', () => {
    const s0 = baseSession();
    const rows = stageIntakeConfirmationTable(s0.document, 'spec.pdf', {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      truckType: { value: 'Stand-up reach', sourcePage: 1, confidence: 0.95 },
      truckRasIn: { value: 108, unit: 'in', sourcePage: 1, confidence: 0.95 },
    }).map((r) => ({ ...r, accepted: true }));

    const applied = applyConfirmedIntakeRows(s0, rows);
    expect(applied.appliedCount).toBe(2);
    expect(applied.refused).toBeUndefined();

    // Exactly one ledger entry for the entire intake apply
    expect(applied.session.ledger.entries).toHaveLength(1);
    expect(applied.session.ledger.depth).toBe(1);

    // Single-step undo reverts both fields
    const undone = undo(applied.session);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.session.ledger.depth).toBe(0);
    expect(undone.session.document.equipment.truckType).toBe(s0.document.equipment.truckType);
    expect(undone.session.document.equipment.truckRAS.value).toBe(s0.document.equipment.truckRAS.value);

    // Single-step redo re-applies both fields
    const redone = redo(undone.session);
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(redone.session.ledger.depth).toBe(1);
    expect(redone.session.document.equipment.truckType).toBe('Stand-up reach');
    expect(redone.session.document.equipment.truckRAS.value).toBe(IN(108));
  });

  it('dispatchAll returns ok on empty commands without modifying session ledger', () => {
    const s = baseSession();
    const res = dispatchAll(s, []);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.session).toBe(s);
      expect(res.session.ledger.entries).toHaveLength(0);
    }
  });
});
