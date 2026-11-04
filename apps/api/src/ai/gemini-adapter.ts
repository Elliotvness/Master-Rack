/**
 * Server-side adapter from `@rms/studio-model`'s internal Gemini contract
 * (`GeminiInteractionsClient`) to the official `@google/genai` SDK
 * (`ai.models.generateContent`). See `docs/gemini-api-mapping.md` §2-§3.
 *
 * WHY THIS LIVES IN `apps/api`: the API key is read from the server's
 * environment and never leaves this process (mapping doc §5). The HTTP route
 * `POST /api/client/v1/intake` declared in blueprint §8.2 calls
 * `extractSpecSheetViaGemini` below.
 *
 * Translation, per the mapping matrix:
 *   - `model`             internal placeholder tag -> configured real model id
 *   - `input[]`           `{type:'text'}` / `{type:'inline_data', mime_type}`
 *                         -> one `user` Content with `{text}` / `{inlineData:{mimeType}}`
 *   - `response_format`   -> `config.responseMimeType` + `config.responseJsonSchema`
 *   - `store: false`      no request-level equivalent; enforced instead by
 *                         refusing to build a client unless billingTier is 'paid'
 *   - `{output_text}`     <- `response.text`
 */
import type {
  GeminiBackendConfig,
  GeminiInteractionPart,
  GeminiInteractionsClient,
  GeminiInteractionsCreateRequest,
  ParseIntakeResult,
  SpecSheetIntakeInput,
} from '@rms/studio-model';
import {
  buildSpecSheetIntakeRequest,
  parseAndValidateIntakeOutput,
  validateGeminiBackendConfig,
} from '@rms/studio-model';

/** The default production model; the internal tag is a placeholder (mapping doc §2). */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** The subset of `GenerateContentParameters` this adapter sends. */
export interface GenerateContentRequest {
  readonly model: string;
  readonly contents: readonly {
    readonly role: 'user';
    readonly parts: readonly (
      | { readonly text: string }
      | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
    )[];
  }[];
  readonly config: {
    readonly responseMimeType: 'application/json';
    readonly responseJsonSchema: Record<string, unknown>;
  };
}

/** The subset of the SDK's `ai.models` this adapter calls. Injected so tests need no network. */
export interface GenerateContentFn {
  (request: GenerateContentRequest): Promise<{ readonly text?: string | undefined }>;
}

export interface GeminiServerConfig extends GeminiBackendConfig {
  readonly model: string;
}

export type GeminiConfigResult =
  | { readonly ok: true; readonly config: GeminiServerConfig }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the backend configuration from the server environment. Refuses rather
 * than defaulting: a missing key or a non-paid tier is a configuration error,
 * not a reason to fall back to the free tier's data terms.
 */
export function readGeminiConfig(
  env: Readonly<Record<string, string | undefined>>,
): GeminiConfigResult {
  const tier = env['GEMINI_BILLING_TIER'];
  if (tier !== 'paid' && tier !== 'free') {
    return {
      ok: false,
      reason: 'GEMINI_BILLING_TIER must be set to "paid" (or "free", which is then refused).',
    };
  }
  const config: GeminiServerConfig = {
    apiKey: env['GEMINI_API_KEY'] ?? '',
    billingTier: tier,
    model: (env['GEMINI_MODEL'] ?? '').trim() || DEFAULT_GEMINI_MODEL,
  };
  const check = validateGeminiBackendConfig(config);
  return check.ok ? { ok: true, config } : check;
}

function toSdkPart(
  part: GeminiInteractionPart,
): GenerateContentRequest['contents'][number]['parts'][number] {
  return part.type === 'text'
    ? { text: part.text }
    : { inlineData: { mimeType: part.mime_type, data: part.data } };
}

/** Pure translation of one internal request to SDK parameters. */
export function toGenerateContentRequest(
  request: GeminiInteractionsCreateRequest,
  model: string,
): GenerateContentRequest {
  return {
    model,
    contents: [{ role: 'user', parts: request.input.map(toSdkPart) }],
    config: {
      responseMimeType: request.response_format.mime_type,
      responseJsonSchema: request.response_format.schema,
    },
  };
}

export class GeminiEmptyResponseError extends Error {
  override readonly name = 'GeminiEmptyResponseError';
}

/**
 * Build a `GeminiInteractionsClient` over an injected `generateContent`.
 * An empty response throws rather than returning `''`, so the parser never
 * sees an absent answer dressed up as a malformed one.
 */
export function createGeminiInteractionsClient(
  generateContent: GenerateContentFn,
  config: GeminiServerConfig,
): GeminiInteractionsClient {
  return {
    interactions: {
      async create(request) {
        const response = await generateContent(toGenerateContentRequest(request, config.model));
        const text = response.text;
        if (text === undefined || text.trim() === '') {
          throw new GeminiEmptyResponseError('Gemini returned no text for the request.');
        }
        return { output_text: text };
      },
    },
  };
}

/**
 * Production wiring: the real SDK, imported lazily so that loading this module
 * (and every test of it) neither requires the SDK's network stack nor a key.
 */
export async function createLiveGeminiClient(
  config: GeminiServerConfig,
): Promise<GeminiInteractionsClient> {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  return createGeminiInteractionsClient(
    (req) =>
      ai.models.generateContent({
        model: req.model,
        contents: req.contents.map((c) => ({ role: c.role, parts: [...c.parts] })),
        config: { ...req.config },
      }),
    config,
  );
}

/**
 * Execute a spec-sheet extraction over the configured server-side Gemini client
 * (`GEMINI_BILLING_TIER === 'paid'`, `store: false` data-governance posture) and
 * validate the JSON response against `INTAKE_EXTRACTION_SCHEMA`.
 */
export async function extractSpecSheetViaGemini(
  input: SpecSheetIntakeInput,
  env: Readonly<Record<string, string | undefined>>,
  injectedClient?: GeminiInteractionsClient,
): Promise<ParseIntakeResult> {
  const cfg = readGeminiConfig(env);
  if (!cfg.ok) return cfg;
  const client = injectedClient ?? (await createLiveGeminiClient(cfg.config));
  const request = buildSpecSheetIntakeRequest(
    input.documentKind,
    input.fileName,
    input.mimeType,
    input.base64Data,
  );
  const response = await client.interactions.create(request);
  return parseAndValidateIntakeOutput(response.output_text);
}
