# Gemini API Request Format & Architecture Mapping

**Document Version:** 1.0.0  
**Associated Package:** `@rms/studio-model` (`packages/studio-model/src/ai-intake.ts`)  
**Application Scope:** Spec-Sheet Intake & Natural Language Command Bar  
**Integrity Mode:** DEMO (No live API connections or credentials in browser clients)  
**Date:** 2026-11-04  

---

## 1. Executive Summary & Purpose

This document provides the formal architectural mapping between the repository's internal AI interaction interface (`GeminiInteractionsCreateRequest` defined in `@rms/studio-model`) and the official **Google Gemini Developer API** / **Google Gen AI SDK** (`@google/genai`).

Per **Requirement R4** and the system's strict integrity mandates:
- The internal schema represents an abstracted model contract designed for pure unit testing, deterministic validation, and human-confirmed review.
- **No live API keys, network calls, or third-party SDK dependencies are bundled into client-side browser applications** (`apps/studio-web`).
- The interactive studio runs in **demo mode** utilizing static, authenticated fixture data (`SAMPLE_FORKLIFT_EXTRACTION`) and pure translation parsers.
- Any future production connection to Gemini services must be routed through an isolated server-side proxy (`apps/api`), preventing credential leakage and enforcing tenancy boundaries.

---

## 2. Interface Comparison Matrix

The table below contrasts the repo's internal interface definitions against the official Google Gemini API reference specifications:

| Dimension / Parameter | Repository Internal Interface (`@rms/studio-model`) | Official Google Gemini API (`@google/genai` / REST) | Status & Compatibility Assessment |
| :--- | :--- | :--- | :--- |
| **API Method / Operation** | `client.interactions.create(request)` | `ai.models.generateContent({ model, contents, config })` (SDK) or `POST /v1beta/models/{model}:generateContent` (REST) | **Differs.** The public Google Gemini API does not provide an "Interactions API" or `client.interactions.create`. It uses `generateContent` or `generateContentStream`. |
| **Model Naming** | `'gemini-3.8-flash'` (`GEMINI_INTAKE_MODEL`) | `'gemini-2.5-flash'`, `'gemini-2.5-pro'`, `'gemini-2.0-flash'`, `'gemini-1.5-flash'`, `'gemini-1.5-pro'` | **Differs.** `'gemini-3.8-flash'` is a synthetic/future placeholder version tag. Production deployments target standard supported model identifiers (e.g. `gemini-2.5-flash`). |
| **Top-Level Input Structure** | `input: readonly GeminiInteractionPart[]` | `contents: Content[]` (or string / Part array in SDK) | **Differs.** Google Gemini uses `contents`, which encloses `role` ('user', 'model') and `parts: Part[]`. |
| **Multimodal Content Parts** | `{ type: 'text', text: string }`<br/>`{ type: 'inline_data', mime_type: string, data: string }` | `{ text: string }`<br/>`{ inlineData: { mimeType: string, data: string } }`<br/>`{ fileData: { mimeType: string, fileUri: string } }` | **Differs.** Google API does not use a top-level `type` discriminator; instead, union discrimination is key-based (`text` vs. `inlineData` vs. `fileData`). Additionally, Google uses camelCase (`mimeType`) rather than snake_case (`mime_type`). |
| **Structured Output Schema** | `response_format: { type: 'text', mime_type: 'application/json', schema: Record<string, unknown> }` | Configured under `generationConfig` (REST) or `config` (SDK):<br/>`{ responseMimeType: "application/json", responseSchema: { ... } }` | **Differs.** The repo's `response_format` pattern derives from OpenAI-style schema configurations. Google Gemini expects `responseMimeType: "application/json"` and `responseSchema` adhering to OpenAPI 3.0 schema definitions. |
| **Persistence / Retention Flag** | `store: false` | Governed by API billing tier and Terms of Service. No request-level `store` parameter exists in the Google Gemini API. | **Differs.** `store: false` is an OpenAI API parameter (introduced Oct 2024 to disable dashboard logging). On Google Gemini, data privacy is tier-governed: paid-tier API calls never use customer data for model training. |
| **Response Format** | `{ output_text: string }` | `{ candidates: [{ content: { parts: [{ text: string }] }, finishReason: "STOP" }], usageMetadata: { ... } }` or `response.text` via SDK helper | **Differs.** Google API returns candidates containing parts and safety/finish annotations. |

---

## 3. Structural Code Comparison

### 3.1 Repository Internal Contract (`ai-intake.ts`)

```typescript
// packages/studio-model/src/ai-intake.ts
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
```

### 3.2 Official Google Gen AI SDK Implementation (`@google/genai`)

When implementing a live server-side integration (in `apps/api`), the translation layer adapts internal requests to the official `@google/genai` SDK:

```typescript
import { GoogleGenAI, Type } from '@google/genai';

// Initialize with isolated server-side environment variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Official generateContent call with structured outputs
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [
    {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64PdfBuffer,
          },
        },
        {
          text: intakePromptText,
        },
      ],
    },
  ],
  config: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        documentKind: {
          type: Type.STRING,
          enum: ['FORKLIFT_SPEC_SHEET', 'SITE_SURVEY_CHECKLIST', 'RACK_SUBMITTAL'],
        },
        truckType: {
          type: Type.OBJECT,
          properties: {
            value: { type: Type.STRING },
            sourcePage: { type: Type.INTEGER },
            confidence: { type: Type.NUMBER },
          },
          required: ['value', 'sourcePage', 'confidence'],
        },
        truckRasIn: {
          type: Type.OBJECT,
          properties: {
            value: { type: Type.NUMBER },
            unit: { type: Type.STRING, enum: ['in', 'mm', 'ft'] },
            sourcePage: { type: Type.INTEGER },
            confidence: { type: Type.NUMBER },
          },
          required: ['value', 'unit', 'sourcePage', 'confidence'],
        },
        commodityClass: {
          type: Type.OBJECT,
          properties: {
            value: {
              type: Type.STRING,
              enum: [
                'Class I',
                'Class II',
                'Class III',
                'Class IV',
                'Group A Plastics',
                'Group B Plastics',
                'Group C Plastics',
              ],
            },
            sourcePage: { type: Type.INTEGER },
            confidence: { type: Type.NUMBER },
          },
          required: ['value', 'sourcePage', 'confidence'],
        },
      },
      required: ['documentKind'],
    },
  },
});

const outputText = response.text;
```

---

## 4. Privacy, Data Governance & `store: false` Analysis

The repository specifies `store: false` on intake requests to declare the requirement that customer spec sheets, proprietary warehouse prints, and layout instructions must not be retained or used for foundation model training.

### Comparison of Retention Mechanisms:

1. **OpenAI API Standard:**  
   OpenAI provides an explicit request parameter `store: false` to disable logging prompts and completions to the organization's API dashboard or eval logs.
2. **Google Gemini API Standard:**  
   Google does **not** expose a request-level `store` parameter. Instead, data governance is strictly controlled at the account and project billing level:
   - **Paid Billing Tier (Google AI Studio / Vertex AI):** Under Google's Terms of Service for paid enterprise accounts, Google does not log prompt content, inspect customer data, or use customer prompts/completions to train or fine-tune Google models.
   - **Free Billing Tier:** Under the free tier, Google terms permit the logging and potential human review of prompts and responses for service improvement.
   - **Architectural Policy:** In `@rms/studio-model`, `GeminiBackendConfig.billingTier === 'paid'` is explicitly modeled to document the prerequisite that only paid-tier enterprise credentials may be used for processing commercial documents.

---

## 5. Security & Architectural Boundaries

1. **Zero Credential Exposure:**  
   In compliance with Google Antigravity custom rules and ADR-012/ADR-013, API keys are never stored in browser memory, bundled in static assets, or exposed in local client storage.
2. **Server-Side Proxy Architecture (`apps/api`):**  
   All outbound requests to Google Gemini must execute from backend services where credentials reside in secure environment variables or secret vaults. The client communicates solely via authenticated Fastify endpoints protected by tenant isolation (`withTenant`) and rate limiting.
3. **Integrity Mode: Demo:**  
   The front-end interactive studio operates in demo mode. The Human Confirmation Table (`#intake-confirm-table`) displays clear indicators that the AI backend is not connected and that extraction data originates from static demo fixtures.
4. **Mandatory Human Confirmation:**  
   No AI inference directly mutates a `StudioDocument`. Every proposal (intake row or command sequence) must be explicitly inspected, verified, and confirmed by a human operator before entering the immutable command dispatch ledger.

---

## 6. Official Documentation Citations & References

The following official documentation resources govern Google Gemini API integration and structured outputs:

- **Google Gemini API Overview:**  
  [https://ai.google.dev/gemini-api/docs](https://ai.google.dev/gemini-api/docs)
- **Google Gemini generateContent Reference:**  
  [https://ai.google.dev/api/generate-content](https://ai.google.dev/api/generate-content)
- **Structured Outputs with responseSchema:**  
  [https://ai.google.dev/gemini-api/docs/structured-output](https://ai.google.dev/gemini-api/docs/structured-output)
- **Multimodal Prompting & Media Understanding:**  
  [https://ai.google.dev/gemini-api/docs/prompting-with-media](https://ai.google.dev/gemini-api/docs/prompting-with-media)
- **Google Gemini Models Guide:**  
  [https://ai.google.dev/gemini-api/docs/models/gemini](https://ai.google.dev/gemini-api/docs/models/gemini)
- **Google Gen AI JavaScript/TypeScript SDK (`@google/genai`):**  
  [https://github.com/googleapis/genai-js](https://github.com/googleapis/genai-js)
- **Google AI Studio Terms of Service & Data Governance:**  
  [https://ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms)
