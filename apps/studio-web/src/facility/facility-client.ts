/**
 * Client API for facility and unit configuration (Slice 3 / T-18b).
 *
 * Dispatches to:
 *   - POST /api/client/v1/revisions/:id/facility
 *   - POST /api/client/v1/revisions/:id/units
 *   - GET  /api/client/v1/revisions/:id/preview
 *
 * Immutability refusal (422 UNPROCESSABLE) and validation errors (400)
 * are surfaced cleanly without leaking internal structures.
 */

export class FacilityApiError extends Error {
  override readonly name = 'FacilityApiError';
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

export interface SaveFacilityResult {
  readonly id: string;
  readonly code: string;
  readonly iteration: number;
  readonly frozen: boolean;
}

export async function saveFacilityDraft(
  revisionId: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveFacilityResult> {
  const res = await fetchImpl(`/api/client/v1/revisions/${encodeURIComponent(revisionId)}/facility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = (body['error'] as Record<string, unknown>) ?? {};
    const code = typeof err['code'] === 'string' ? err['code'] : 'ERROR';
    const message = typeof err['message'] === 'string' ? err['message'] : `Request failed with status ${res.status}`;
    throw new FacilityApiError(message, res.status, code, err['details']);
  }

  return body as unknown as SaveFacilityResult;
}

export async function saveUnitsDraft(
  revisionId: string,
  payload: { readonly units: readonly Record<string, unknown>[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SaveFacilityResult> {
  const res = await fetchImpl(`/api/client/v1/revisions/${encodeURIComponent(revisionId)}/units`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = (body['error'] as Record<string, unknown>) ?? {};
    const code = typeof err['code'] === 'string' ? err['code'] : 'ERROR';
    const message = typeof err['message'] === 'string' ? err['message'] : `Request failed with status ${res.status}`;
    throw new FacilityApiError(message, res.status, code, err['details']);
  }

  return body as unknown as SaveFacilityResult;
}

export async function fetchRevisionPreview(
  revisionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(`/api/client/v1/revisions/${encodeURIComponent(revisionId)}/preview`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = (body['error'] as Record<string, unknown>) ?? {};
    const code = typeof err['code'] === 'string' ? err['code'] : 'ERROR';
    const message = typeof err['message'] === 'string' ? err['message'] : `Request failed with status ${res.status}`;
    throw new FacilityApiError(message, res.status, code, err['details']);
  }

  return body;
}
