/**
 * Client API dispatcher for Options Builder (Slice 4 / T-18c).
 *
 * Dispatches to:
 *   - POST /api/client/v1/revisions/:id/options
 *   - GET  /api/client/v1/revisions/:id/preview
 *
 * Immutability refusal (422) and validation errors (400)
 * are surfaced cleanly without leaking internal structures.
 */

import type { OptionsApiPayload } from './options-model.js';

export class OptionsApiError extends Error {
  override readonly name = 'OptionsApiError';
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface SaveOptionsResult {
  readonly id: string;
  readonly code: string;
  readonly iteration: number;
  readonly frozen: boolean;
}

export async function saveOptionsDraft(
  revisionId: string,
  payload: OptionsApiPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveOptionsResult> {
  const res = await fetchImpl(`/api/client/v1/revisions/${encodeURIComponent(revisionId)}/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = (body['error'] as Record<string, unknown>) ?? {};
    const code = typeof err['code'] === 'string' ? err['code'] : 'ERROR';
    const message =
      typeof err['message'] === 'string' ? err['message'] : `Request failed with status ${res.status}`;
    throw new OptionsApiError(message, res.status, code, err['details']);
  }

  return body as unknown as SaveOptionsResult;
}

export async function fetchRevisionPreview(
  revisionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(`/api/client/v1/revisions/${encodeURIComponent(revisionId)}/preview`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new OptionsApiError(`Failed to fetch preview for revision '${revisionId}'`, res.status, 'FETCH_ERROR');
  }

  return (await res.json()) as Record<string, unknown>;
}
