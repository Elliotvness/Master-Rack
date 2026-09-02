import { describe, expect, it } from 'vitest';

import {
  ApiError,
  CLIENT_NAMESPACE,
  FACILITY_FIELDS,
  FacilityEntryError,
  INVITATION_REFUSED_MESSAGE,
  MIN_PASSWORD_LENGTH,
  NamespaceViolationError,
  acceptInvitation,
  checkInvitation,
  clearField,
  emptyFacility,
  facilityFindings,
  passwordProblems,
  readyToSubmit,
  request,
  setKnown,
  setNotKnown,
  unansweredFields,
} from './index.js';

/** A fetch stand-in that records what it was asked for. */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: Error;
}): { fetch: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (response.throws) throw response.throws;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe('the client bundle cannot reach the internal namespace', () => {
  // Two applications and two namespaces is the cheapest structural guarantee
  // against leakage: it makes an internal call a ROUTING bug (loud, greppable)
  // rather than a serialization bug (invisible in review).

  it('refuses an internal path outright', async () => {
    const { fetch: f, calls } = stubFetch({});
    await expect(request('/api/internal/v1/queue', {}, f)).rejects.toThrow(
      NamespaceViolationError,
    );
    // And it refuses BEFORE issuing the request — no internal URL is ever hit.
    expect(calls).toHaveLength(0);
  });

  it('refuses a path that merely mentions the client namespace', async () => {
    // '/api/internal/v1/x?next=/api/client/v1' must not slip through a
    // substring check. The prefix is anchored.
    const { fetch: f } = stubFetch({});
    await expect(
      request(`/api/internal/v1/x?next=${CLIENT_NAMESPACE}`, {}, f),
    ).rejects.toThrow(NamespaceViolationError);
  });

  it('refuses a lookalike prefix', async () => {
    const { fetch: f } = stubFetch({});
    await expect(request('/api/client/v10/projects', {}, f)).rejects.toThrow(
      NamespaceViolationError,
    );
  });

  it('allows a genuine client path', async () => {
    const { fetch: f, calls } = stubFetch({ body: { ok: true } });
    await request(`${CLIENT_NAMESPACE}/projects`, {}, f);
    expect(calls[0]?.url).toBe('/api/client/v1/projects');
  });

  it('sends the session cookie same-origin only, and never reads it', () => {
    // The token is HttpOnly, so this code CANNOT read it — which is what stops
    // an XSS from exfiltrating a session. Asserted as an absence: no token
    // handling exists in the request path.
    const { fetch: f, calls } = stubFetch({ body: {} });
    void request(`${CLIENT_NAMESPACE}/projects`, {}, f);
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect(JSON.stringify(calls[0]?.init?.headers)).not.toMatch(/authorization/i);
  });

  it('passes an abort signal through, so a stale request can be cancelled', () => {
    // The preview screen re-derives on every parameter change. Without a way
    // to cancel, a slow earlier response can land after a fast later one and
    // render a stale drawing — which is exactly the "nothing displays from a
    // stale computation" rule the client app must honour.
    const controller = new AbortController();
    const { fetch: f, calls } = stubFetch({ body: {} });
    void request(`${CLIENT_NAMESPACE}/projects`, { signal: controller.signal }, f);
    expect(calls[0]?.init?.signal).toBe(controller.signal);
  });

  it('sends a JSON body only when there is one', () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    void request(`${CLIENT_NAMESPACE}/projects`, {}, f);
    expect(calls[0]?.init?.body).toBeUndefined();

    void request(`${CLIENT_NAMESPACE}/projects`, { method: 'POST', body: { a: 1 } }, f);
    expect(calls[1]?.init?.body).toBe('{"a":1}');
  });

  it('surfaces every reason a refusal carried, not just the first', async () => {
    // AC-10: a refusal lists every reason at once, so one round of correction
    // surfaces all the work.
    const { fetch: f } = stubFetch({
      ok: false,
      status: 422,
      body: { message: 'Cannot submit', reasons: ['aisle too narrow', 'clear height unknown'] },
    });
    try {
      await request(`${CLIENT_NAMESPACE}/revisions/1/submit`, { method: 'POST' }, f);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).reasons).toHaveLength(2);
    }
  });

  it('does not mask a status behind an unparseable error body', async () => {
    // `throws` and `body` are omitted rather than passed as `undefined`:
    // under `exactOptionalPropertyTypes` an optional property may be absent but
    // not explicitly undefined, and omission is what the stub already reads.
    const { fetch: f } = stubFetch({
      ok: false,
      status: 500,
    });
    const bad = (async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    await expect(request(`${CLIENT_NAMESPACE}/x`, {}, bad)).rejects.toThrow(/status 503/);
    void f;
  });
});

describe('AC-01 \u2014 every unusable invitation renders identically', () => {
  // Expired, revoked, used and never-issued must be indistinguishable. If they
  // differ, the page is an oracle: "expired" confirms the token was real.

  it('gives the SAME message for every failure mode', async () => {
    const failures = [
      stubFetch({ ok: false, status: 404, body: { message: 'no such invitation' } }),
      stubFetch({ ok: false, status: 410, body: { message: 'expired' } }),
      stubFetch({ ok: false, status: 409, body: { message: 'already accepted' } }),
      stubFetch({ ok: false, status: 403, body: { message: 'revoked' } }),
      stubFetch({ throws: new Error('network down') }),
    ];

    const results = [];
    for (const f of failures) {
      results.push(await checkInvitation('some-token', f.fetch));
    }

    for (const r of results) {
      expect(r.status).toBe('refused');
      if (r.status === 'refused') expect(r.message).toBe(INVITATION_REFUSED_MESSAGE);
    }
    // Every message identical — asserted as a set of one.
    const distinct = new Set(results.map((r) => (r.status === 'refused' ? r.message : 'x')));
    expect(distinct.size).toBe(1);
  });

  it('carries no reason code that a future switch could branch on', async () => {
    // The distinction is not available to render, so it cannot be rendered.
    // This is what stops someone reintroducing the oracle while "improving"
    // the error message.
    //
    // Note what is NOT asserted: that the word "expired" is absent. The
    // standing message deliberately says the link "may have expired, already
    // been used, or been withdrawn" — naming all three possibilities without
    // confirming any is honest AND non-revealing. The oracle would be a
    // machine-readable field, so that is what is asserted absent.
    const { fetch: f } = stubFetch({ ok: false, status: 410, body: { message: 'expired' } });
    const result = await checkInvitation('t', f);

    expect(result).not.toHaveProperty('reason');
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('status_code');

    // And the server's own wording never reaches the page.
    if (result.status === 'refused') {
      expect(result.message).toBe(INVITATION_REFUSED_MESSAGE);
    }
    expect(Object.keys(result).sort()).toEqual(['message', 'status']);
  });

  it('shows the same shape for every failure, not merely the same text', async () => {
    // Two refusals must be structurally identical: an extra key present on one
    // and absent on another is an oracle even when both messages match.
    const shapes = [];
    for (const f of [
      stubFetch({ ok: false, status: 404, body: { message: 'nope' } }),
      stubFetch({ ok: false, status: 410, body: { message: 'expired' } }),
      stubFetch({ throws: new Error('offline') }),
    ]) {
      shapes.push(JSON.stringify(await checkInvitation('t', f.fetch)));
    }
    expect(new Set(shapes).size).toBe(1);
  });

  it('refuses an empty token without a round trip', async () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    const result = await checkInvitation('   ', f);
    expect(result.status).toBe('refused');
    expect(calls).toHaveLength(0);
  });

  it('accepts a valid token and names the organization', async () => {
    const { fetch: f } = stubFetch({
      body: { organizationName: 'Harbor Logistics', invitedEmail: 'new@harbor.invalid' },
    });
    const result = await checkInvitation('good-token', f);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') expect(result.organizationName).toBe('Harbor Logistics');
  });
});

describe('accepting an invitation', () => {
  it('does not auto-login, so a forwarded link is not an account takeover', async () => {
    // Auto-login turns a single-use token into a session-granting token.
    const { fetch: f } = stubFetch({ body: { accepted: true } });
    const result = await acceptInvitation(
      { token: 't', displayName: 'Ada', password: 'a-long-enough-passphrase' },
      f,
    );
    expect(result.ok).toBe(true);
    // No session, no token, nothing but success.
    expect(JSON.stringify(result)).not.toMatch(/token|session/i);
  });

  it('requires a name and a long password, and says so at the field', async () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    const noName = await acceptInvitation(
      { token: 't', displayName: '  ', password: 'a-long-enough-passphrase' },
      f,
    );
    expect(noName.ok).toBe(false);
    const shortPw = await acceptInvitation(
      { token: 't', displayName: 'Ada', password: 'short' },
      f,
    );
    expect(shortPw.ok).toBe(false);
    // Neither reached the network: the client is told before a round trip.
    expect(calls).toHaveLength(0);
  });

  it('measures password strength by LENGTH, not composition', () => {
    // Composition rules push people toward Password1! and away from length.
    expect(passwordProblems('x'.repeat(MIN_PASSWORD_LENGTH))).toEqual([]);
    expect(passwordProblems('correct horse battery staple')).toEqual([]);
    expect(passwordProblems('Sh0rt!')).toHaveLength(1);
  });

  it('collapses a lost redemption race into the standard refusal', async () => {
    // Two tabs, one token. The loser must not learn it lost.
    const { fetch: f } = stubFetch({ ok: false, status: 409, body: { message: 'already used' } });
    const result = await acceptInvitation(
      { token: 't', displayName: 'Ada', password: 'a-long-enough-passphrase' },
      f,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(INVITATION_REFUSED_MESSAGE);
  });
});

describe('D-02 \u2014 every facility field is individually markable NOT KNOWN', () => {
  it('starts with every field empty, assuming nothing', () => {
    const draft = emptyFacility();
    expect(unansweredFields(draft)).toHaveLength(FACILITY_FIELDS.length);
    expect(readyToSubmit(draft)).toBe(false);
  });

  it('REFUSES a zero rather than accepting it as a measurement', () => {
    // A zero clear height is not a measurement. It is a blank wearing a
    // number's clothes, and it would sail through every downstream check.
    const draft = emptyFacility();
    expect(() => setKnown(draft, 'clearHeightIn', 0)).toThrow(FacilityEntryError);
    expect(() => setKnown(draft, 'clearHeightIn', 0)).toThrow(/mark the field NOT KNOWN/);
    expect(() => setKnown(draft, 'clearHeightIn', -5)).toThrow(FacilityEntryError);
    expect(() => setKnown(draft, 'clearHeightIn', Number.NaN)).toThrow(/finite number/);
  });

  it('lets a client say "not known" and still submit', () => {
    // Refusing to accept "I do not know" pushes the client into inventing a
    // number, which is the outcome this product exists to prevent.
    let draft = emptyFacility();
    for (const spec of FACILITY_FIELDS) {
      draft = setNotKnown(draft, spec.id, '');
    }
    expect(readyToSubmit(draft)).toBe(true);
    expect(facilityFindings(draft)).toHaveLength(FACILITY_FIELDS.length);
  });

  it('distinguishes NOT KNOWN from NOT ANSWERED, because they are different facts', () => {
    let draft = emptyFacility();
    draft = setNotKnown(draft, 'slabThicknessIn', 'No drawings; landlord unresponsive.');
    const findings = facilityFindings(draft);

    const slab = findings.find((f) => f.fieldId === 'slabThicknessIn');
    const clear = findings.find((f) => f.fieldId === 'clearHeightIn');
    expect(slab?.kind).toBe('not_known');
    expect(clear?.kind).toBe('not_answered');
  });

  it('never produces a finding with no route to an answer', () => {
    // A MISSING INPUT finding that does not say who to ask is a dead end, and
    // dead ends become support calls (R-15).
    const draft = emptyFacility();
    for (const finding of facilityFindings(draft)) {
      expect(finding.whoCanAnswer.length).toBeGreaterThan(10);
      expect(finding.label).not.toBe('');
    }
  });

  it('gives an unexplained "not known" a standing reason rather than a blank', () => {
    const draft = setNotKnown(emptyFacility(), 'dockSetbackIn', '   ');
    const field = draft.dockSetbackIn;
    expect(field.state).toBe('not_known');
    if (field.state === 'not_known') expect(field.note).toMatch(/Marked not known/);
  });

  it('stops reporting a field once it is answered', () => {
    let draft = emptyFacility();
    draft = setKnown(draft, 'clearHeightIn', 384);
    expect(facilityFindings(draft).some((f) => f.fieldId === 'clearHeightIn')).toBe(false);
  });

  it('can clear a field back to unanswered, distinct from not known', () => {
    let draft = setKnown(emptyFacility(), 'clearHeightIn', 384);
    draft = clearField(draft, 'clearHeightIn');
    expect(draft.clearHeightIn.state).toBe('empty');
    expect(readyToSubmit(draft)).toBe(false);
  });

  it('never mutates the draft it was given', () => {
    // The form binds to this; an in-place mutation would make a re-render show
    // a value the model never committed.
    const draft = emptyFacility();
    const next = setKnown(draft, 'clearHeightIn', 384);
    expect(draft.clearHeightIn.state).toBe('empty');
    expect(next.clearHeightIn.state).toBe('known');
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('gives every field a label, help text and a route to an answer', () => {
    for (const spec of FACILITY_FIELDS) {
      expect(spec.label).not.toBe('');
      expect(spec.help.length).toBeGreaterThan(20);
      expect(spec.whoCanAnswer.length).toBeGreaterThan(10);
      expect(spec.unit).toBe('in');
    }
  });
});
