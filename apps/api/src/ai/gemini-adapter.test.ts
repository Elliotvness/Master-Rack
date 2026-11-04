import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../../fixtures/continuity/rack-studio-v1.json';
import {
  EMPTY_LEDGER,
  buildCommandBarRequest,
  buildSpecSheetIntakeRequest,
  migrate,
  runSpecSheetIntake,
  type Session,
} from '@rms/studio-model';
import {
  DEFAULT_GEMINI_MODEL,
  GeminiEmptyResponseError,
  createGeminiInteractionsClient,
  createLiveGeminiClient,
  extractSpecSheetViaGemini,
  readGeminiConfig,
  toGenerateContentRequest,
  type GenerateContentRequest,
  type GeminiServerConfig,
} from './gemini-adapter.js';

const generateContentMock = vi.fn();
const constructorArgs: unknown[] = [];
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    readonly models = { generateContent: generateContentMock };
    constructor(opts: unknown) {
      constructorArgs.push(opts);
    }
  },
}));

const CONFIG: GeminiServerConfig = { apiKey: 'k', billingTier: 'paid', model: 'gemini-2.5-flash' };

function session(): Session {
  const m = migrate(fixture.document);
  return { document: m.document, counter: m.counter, ledger: EMPTY_LEDGER };
}

describe('readGeminiConfig', () => {
  it('accepts a paid key and defaults the model', () => {
    expect(readGeminiConfig({ GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'paid' })).toEqual({
      ok: true,
      config: { apiKey: 'k', billingTier: 'paid', model: DEFAULT_GEMINI_MODEL },
    });
  });
  it('honours an explicit model and ignores a blank one', () => {
    const env = { GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'paid' };
    const named = readGeminiConfig({ ...env, GEMINI_MODEL: 'gemini-2.5-pro' });
    expect(named.ok && named.config.model).toBe('gemini-2.5-pro');
    const blank = readGeminiConfig({ ...env, GEMINI_MODEL: '  ' });
    expect(blank.ok && blank.config.model).toBe(DEFAULT_GEMINI_MODEL);
  });
  it.each([
    [{ GEMINI_API_KEY: 'k' }, /GEMINI_BILLING_TIER/],
    [{ GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'enterprise' }, /GEMINI_BILLING_TIER/],
    [{ GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'free' }, /paid-tier/],
    [{ GEMINI_BILLING_TIER: 'paid' }, /GEMINI_API_KEY is missing/],
  ])('refuses %j', (env, reason) => {
    const r = readGeminiConfig(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});

describe('toGenerateContentRequest', () => {
  it('maps inline_data + text parts and response_format to the SDK shape', () => {
    const req = buildSpecSheetIntakeRequest('FORKLIFT_SPEC_SHEET', 'a.pdf', 'application/pdf', 'JVBERi0=');
    const out = toGenerateContentRequest(req, 'gemini-2.5-flash');
    expect(out.model).toBe('gemini-2.5-flash');
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0]?.role).toBe('user');
    expect(out.contents[0]?.parts[0]).toEqual({
      inlineData: { mimeType: 'application/pdf', data: 'JVBERi0=' },
    });
    expect(out.contents[0]?.parts[1]).toHaveProperty('text');
    expect(out.config).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: req.response_format.schema,
    });
    // Internal-only fields never reach the SDK.
    expect(JSON.stringify(out)).not.toMatch(/"store"|"mime_type"|"type":"inline_data"/);
  });
  it('maps a text-only command bar request', () => {
    const out = toGenerateContentRequest(buildCommandBarRequest('Add a run', session().document), 'm');
    expect(out.contents[0]?.parts).toHaveLength(1);
    expect(Object.keys(out.contents[0]?.parts[0] ?? {})).toEqual(['text']);
  });
});

describe('createGeminiInteractionsClient', () => {
  it('drives runSpecSheetIntake end to end through the SDK shape', async () => {
    const sent: GenerateContentRequest[] = [];
    const client = createGeminiInteractionsClient(async (r) => {
      sent.push(r);
      return {
        text: JSON.stringify({
          documentKind: 'FORKLIFT_SPEC_SHEET',
          truckRasIn: { value: 108, unit: 'in', sourcePage: 2, confidence: 0.96 },
        }),
      };
    }, CONFIG);
    const s = session();
    const res = await runSpecSheetIntake(client, CONFIG, s.document, {
      documentKind: 'FORKLIFT_SPEC_SHEET',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      base64Data: 'JVBERi0=',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.model).toBe('gemini-2.5-flash');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rows.every((r) => !r.accepted)).toBe(true);
  });
  it.each([[undefined], [''], ['   ']])('throws on an empty response (%j)', async (text) => {
    const client = createGeminiInteractionsClient(async () => ({ text }), CONFIG);
    await expect(
      client.interactions.create(buildCommandBarRequest('x', session().document)),
    ).rejects.toBeInstanceOf(GeminiEmptyResponseError);
  });
});

describe('createLiveGeminiClient', () => {
  it('constructs the SDK with the server key and calls models.generateContent', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '{"commands":[]}' });
    const client = await createLiveGeminiClient(CONFIG);
    const out = await client.interactions.create(buildCommandBarRequest('x', session().document));
    expect(out.output_text).toBe('{"commands":[]}');
    expect(constructorArgs).toEqual([{ apiKey: 'k' }]);
    const arg = generateContentMock.mock.calls[0]?.[0] as GenerateContentRequest;
    expect(arg.model).toBe('gemini-2.5-flash');
    expect(arg.config.responseMimeType).toBe('application/json');
  });
});

describe('extractSpecSheetViaGemini', () => {
  const INPUT = {
    documentKind: 'FORKLIFT_SPEC_SHEET' as const,
    fileName: 'Raymond-7500.pdf',
    mimeType: 'application/pdf',
    base64Data: 'JVBERi0=',
  };

  it('refuses when server Gemini configuration is missing or non-paid', async () => {
    const res = await extractSpecSheetViaGemini(INPUT, { GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'free' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/paid-tier/);
  });

  it('extracts and validates via an injected client or live SDK client', async () => {
    const injected = createGeminiInteractionsClient(
      async () => ({
        text: JSON.stringify({
          documentKind: 'FORKLIFT_SPEC_SHEET',
          truckRasIn: { value: 108, unit: 'in', sourcePage: 2, confidence: 0.96 },
        }),
      }),
      CONFIG,
    );
    const r1 = await extractSpecSheetViaGemini(
      INPUT,
      { GEMINI_API_KEY: 'k', GEMINI_BILLING_TIER: 'paid' },
      injected,
    );
    expect(r1.ok).toBe(true);

    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        documentKind: 'FORKLIFT_SPEC_SHEET',
        clearHeightIn: { value: 384, unit: 'in', sourcePage: 1, confidence: 0.95 },
      }),
    });
    const r2 = await extractSpecSheetViaGemini(INPUT, {
      GEMINI_API_KEY: 'k',
      GEMINI_BILLING_TIER: 'paid',
    });
    expect(r2.ok).toBe(true);
  });
});
