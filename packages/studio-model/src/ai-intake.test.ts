import { describe, expect, it } from 'vitest';

import fixture from '../../../fixtures/continuity/rack-studio-v1.json';
import {
  COMMAND_BAR_SCHEMA,
  GEMINI_INTAKE_MODEL,
  INTAKE_EXTRACTION_SCHEMA,
  applyConfirmedIntakeRows,
  buildCommandBarRequest,
  buildSpecSheetIntakeRequest,
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
import { EMPTY_LEDGER, type Session } from './undo.js';
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
              truckRasIn: { value: 108, sourcePage: 2, confidence: 0.96 },
              clearHeightIn: { value: 384, sourcePage: 1, confidence: 0.95 },
              deflectorElevIn: { value: 366, sourcePage: 1, confidence: 0.94 },
              commodityClass: { value: 'Class III', sourcePage: 3, confidence: 0.91 },
              sdc: { value: 'D', sourcePage: 3, confidence: 0.92 },
              frameHeightIn: { value: 288, sourcePage: 4, confidence: 0.97 },
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
      frameHeightIn: { value: 240, sourcePage: 2, confidence: 0.95 },
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
      accepted: true,
      command: {
        type: 'setField' as const,
        label: '   ', // empty label refuses in setField
        change: { section: 'project' as const, patch: { name: 'X' } },
      },
    };
    const applied = applyConfirmedIntakeRows(s, [refusedRow]);
    expect(applied.appliedCount).toBe(0);
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
                { action: 'setBeamSpan', inches: 100 }, // off-grid -> snaps to 102"
                { action: 'setBeamSpan', inches: 96, beamFamily: 'UNKNOWN_FAM' },
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
      expect(res.preview.commands.length).toBe(8);
      expect(res.preview.descriptions.length).toBe(8);
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
    expect(parsedEmptyRack.ok).toBe(true);

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
});
