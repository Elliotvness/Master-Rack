/**
 * The gate (task **T-14a**), tested through the real Fastify instance.
 *
 * `app.inject()` drives the actual router — the same matching, the same hooks,
 * the same serialization — without a socket. That matters here more than
 * usual: the whole point of this task is that AC-06 stops being enforced
 * against a model, so a test that asserted against `ROUTES` instead of against
 * a registered router would reintroduce exactly the defect it closes.
 */

import { describe, expect, it } from 'vitest';
import { findForbiddenFields } from '@rms/contracts';

import {
  ACCEPTANCE_REACHABLE,
  RouterCoverageError,
  UNIMPLEMENTED,
  createApp,
  routeKey,
  routerCoverageProblems,
  type DenyRecorder,
  type OutboundViolation,
  type Principal,
} from './app.js';
import { ROUTES } from './authz/routes.js';
import {
  DOCUMENT_URL_TTL_MS,
  signDocumentUrl,
  verifySignedDocumentUrl,
} from './revisions/routes.js';

const CLIENT: Principal = {
  userId: '77777777-7777-4777-8777-a00000000001',
  organizationId: '77777777-7777-4777-8777-a00000000002',
  actorType: 'client',
  role: 'CLIENT_USER',
  purpose: 'full',
};
const STAFF: Principal = {
  userId: '77777777-7777-4777-8777-a00000000003',
  organizationId: '77777777-7777-4777-8777-a00000000004',
  actorType: 'staff',
  role: 'INTERNAL_ADMIN',
  purpose: 'full',
};
const SALES: Principal = { ...STAFF, role: 'INTERNAL_SALES' };
/** The same person, mid-acceptance: a real client principal, not yet signed in. */
const ACCEPTING: Principal = { ...CLIENT, purpose: 'acceptance' };

const ENV = { CLAIM_LEASE_MINUTES: '10' };

/** Build the app with a principal pinned onto every request. */
function appAs(principal: Principal | undefined, denies: unknown[] = []) {
  const recordDeny: DenyRecorder = async (event) => {
    denies.push(event);
  };
  const app = createApp({ env: ENV, recordDeny, now: () => new Date('2026-09-03T00:00:00Z') });
  app.addHook('onRequest', async (request) => {
    if (principal !== undefined) request.principal = principal;
  });
  return app;
}

describe('AC-06 — the boot assertion walks the ROUTER, not the table', () => {
  it('boots when every declared route is mounted and every mounted route is declared', async () => {
    const app = appAs(undefined);
    await app.ready();
    await app.close();
  });

  it('refuses to boot on a route mounted with no ROUTES entry — the Friday endpoint', async () => {
    // The task's own stated proof, and it is run against the REAL router: the
    // route is registered on the instance the way a route module would be,
    // AFTER createApp returned, and `ready()` must reject.
    const app = appAs(undefined);
    app.get('/api/client/v1/secret', async () => ({ ok: true }));
    await expect(app.ready()).rejects.toThrow(RouterCoverageError);
    await expect(app.ready()).rejects.toThrow(/GET \/api\/client\/v1\/secret/);
    await app.close();
  });

  it('refuses a route added after createApp returned, which is how route modules arrive', async () => {
    // The hole this closes: a check that ran at the end of createApp would see
    // only what createApp itself mounted, and `app.register(routeModule)` runs
    // later. Every real route module would have walked past the gate.
    const app = appAs(undefined);
    await app.register(async (instance) => {
      instance.post('/api/internal/v1/backdoor', async () => ({ ok: true }));
    });
    await expect(app.ready()).rejects.toThrow(/POST \/api\/internal\/v1\/backdoor/);
    await app.close();
  });

  it('refuses to boot on a ROUTES entry nobody mounted', async () => {
    const short = ROUTES.slice(1).map((r) => routeKey(r.method, r.path));
    const problems = routerCoverageProblems(short);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('mounted on nothing');
  });

  it('refuses a router that registered nothing, rather than passing vacuously', () => {
    const problems = routerCoverageProblems([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('registered no routes at all');
  });

  it('refuses a placeholder naming a route that does not exist', () => {
    const problems = routerCoverageProblems(
      ROUTES.map((r) => routeKey(r.method, r.path)),
      ROUTES,
      new Map([['GET /api/client/v1/gone', 'T-99']]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('nobody will delete');
  });

  it('throws RouterCoverageError from createApp, not a generic Error', () => {
    // Proven by construction elsewhere; here we pin the type so a caller can
    // distinguish a boot refusal from any other startup failure.
    expect(new RouterCoverageError('x')).toBeInstanceOf(Error);
    expect(new RouterCoverageError('x').name).toBe('RouterCoverageError');
  });
});

describe('the configuration gate runs BEFORE the server exists', () => {
  it('refuses to build the app at all on a malformed CLAIM_LEASE_MINUTES', () => {
    // F-40's second blocker: the value used to be read lazily, so a typo'd
    // deploy came up healthy and threw at the first duplicate claim. This is
    // the boot refusal that claim needed.
    expect(() => createApp({ env: { CLAIM_LEASE_MINUTES: 'ten' } })).toThrow(RangeError);
    expect(() => createApp({ env: { CLAIM_LEASE_MINUTES: '0' } })).toThrow(/positive whole number/);
  });

  it('builds with the variable unset, because ten minutes is the documented default', async () => {
    const app = createApp({ env: {} });
    await app.ready();
    await app.close();
  });
});

describe('deny-by-default', () => {
  it('refuses an unauthenticated request to every non-public route', async () => {
    const app = appAs(undefined);
    for (const route of ROUTES) {
      if (route.action === null) continue;
      const res = await app.inject({ method: route.method, url: route.path.replace(/:\w+/g, 'x') });
      expect(res.statusCode, `${route.method} ${route.path}`).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
    await app.close();
  });

  it('lets the public acceptance route through the gate without a principal', async () => {
    const app = appAs(undefined);
    const res = await app.inject({ method: 'POST', url: '/api/auth/invite/accept' });
    // Reaches the handler's input DTO validation (400), not the gate (401).
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('answers 404 — never 403 — to a client on any internal path, and audits it', async () => {
    // The task's stated proof. 403 would confirm the internal action exists.
    const denies: unknown[] = [];
    const app = appAs(CLIENT, denies);
    const internal = ROUTES.filter((r) => r.namespace === 'internal');
    expect(internal.length).toBeGreaterThan(0);
    for (const route of internal) {
      const res = await app.inject({ method: route.method, url: route.path.replace(/:\w+/g, 'x') });
      expect(res.statusCode, `${route.method} ${route.path}`).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'not found' } });
    }
    expect(denies).toHaveLength(internal.length);
    await app.close();
  });

  it('writes one audit event per deny, naming the action and the reason', async () => {
    const denies: { action: string; reason: string; actor: Principal }[] = [];
    const app = appAs(CLIENT, denies as unknown[]);
    await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    expect(denies).toHaveLength(1);
    expect(denies[0]).toMatchObject({ action: 'submission.read' });
    expect(denies[0]?.actor.userId).toBe(CLIENT.userId);
    expect(denies[0]?.reason).toContain('namespace');
    await app.close();
  });

  it('denies a staff capability the role does not hold, as 404 for an artifact', async () => {
    // INTERNAL_SALES may see the queue but may not release a stranded claim.
    const denies: unknown[] = [];
    const app = appAs(SALES, denies);
    const ok = await app.inject({ method: 'GET', url: '/api/internal/v1/queue?page=0' });
    expect(ok.statusCode).toBe(400); // through the gate, into the handler
    const no = await app.inject({
      method: 'POST',
      url: '/api/internal/v1/idempotency-claims/abc/release',
    });
    expect(no.statusCode).toBe(404);
    expect(denies).toHaveLength(1);
    await app.close();
  });

  it('lets an internal admin through the gate on every internal route', async () => {
    const app = appAs(STAFF);
    for (const route of ROUTES.filter((r) => r.namespace === 'internal')) {
      const key = routeKey(route.method, route.path);
      const url =
        route.path === '/api/internal/v1/queue'
          ? '/api/internal/v1/queue?page=0'
          : route.path.replace(/:\w+/g, 'x');
      const res = await app.inject({ method: route.method, url });
      expect(res.statusCode, key).toBe(400);
    }
    await app.close();
  });
});

describe('every MVP-1 route is implemented (0 UNIMPLEMENTED placeholders)', () => {
  it('carries zero UNIMPLEMENTED entries across all 32 ROUTES', () => {
    expect(UNIMPLEMENTED.size).toBe(0);
    for (const route of ROUTES) {
      const key = routeKey(route.method, route.path);
      expect(UNIMPLEMENTED.has(key), key).toBe(false);
    }
  });

  it('answers with the error envelope and never leaks the internal detail when an unhandled error occurs', async () => {
    const app = appAs(STAFF);
    const res = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(res.json())).not.toMatch(/stack|select |from app\./i);
    await app.close();
  });
});

describe('the acceptance session reaches what it is for, and nothing else', () => {
  /**
   * THE QUESTION THE §8.2 AMENDMENT CREATED. §14.3's *Transport* row opens a
   * short-lived session at acceptance; its *No auto-login* row forbids that
   * session being the login. So the invited person holds a real client
   * principal before they have ever signed in — and until this block existed,
   * that principal could reach every client route on the strength of an email
   * link.
   *
   * `ACCEPTING` differs from `CLIENT` by one field. Every case below is that
   * one field deciding the outcome, which is the only way to show the control
   * is about purpose rather than about the route.
   */

  it('refuses a client route it has no business reaching, as 401, with an audit event', async () => {
    const denies: unknown[] = [];
    const app = appAs(ACCEPTING, denies);
    const res = await app.inject({ method: 'GET', url: '/api/client/v1/projects' });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'authentication is not complete' },
    });
    // Not 403 and not 404: the route exists, the caller's own organization owns
    // it, and the only missing thing is a step they are in the middle of.
    expect(denies).toHaveLength(1);
    expect(denies[0]).toMatchObject({
      action: 'project.read',
      reason: 'acceptance session may not reach this route',
      actor: { userId: CLIENT.userId, organizationId: CLIENT.organizationId },
    });
  });

  it('is the PURPOSE being refused, not the route — the same principal without it gets through', async () => {
    const app = appAs(CLIENT);
    const res = await app.inject({ method: 'GET', url: '/api/client/v1/projects' });
    await app.close();
    // 500 is the UNIMPLEMENTED placeholder: it passed the gate.
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });

  it('reaches every route ACCEPTANCE_REACHABLE names, and each is a real one', async () => {
    for (const key of ACCEPTANCE_REACHABLE) {
      const [method, url] = key.split(' ') as [string, string];
      const app = appAs(ACCEPTING);
      const res = await app.inject({ method: method as 'GET', url });
      await app.close();
      // Anything but 401 means the gate let it through to the placeholder.
      expect(res.statusCode, `${key} was refused to an acceptance session`).not.toBe(401);
    }
    expect(ACCEPTANCE_REACHABLE.size).toBeGreaterThanOrEqual(2);
  });

  it('refuses EVERY other route in the registry, derived rather than sampled', async () => {
    // The list of what it may reach is short and reviewable; the list of what it
    // may not is the rest of the surface and must not be written by hand.
    let refused = 0;
    for (const route of ROUTES) {
      if (route.action === null) continue; // public: the gate returns first
      const key = routeKey(route.method, route.path);
      if (ACCEPTANCE_REACHABLE.has(key)) continue;
      if (route.namespace === 'internal') continue; // 404 by namespace, before purpose
      const app = appAs(ACCEPTING);
      const res = await app.inject({ method: route.method, url: route.path });
      await app.close();
      expect(res.statusCode, `${key} was NOT refused to an acceptance session`).toBe(401);
      refused += 1;
    }
    expect(refused).toBeGreaterThanOrEqual(12);
  });

  it('an internal route stays 404 to an acceptance session, not 401', async () => {
    // Namespace is checked BEFORE purpose, deliberately: a client principal
    // must not learn which internal routes exist, and "your authentication is
    // incomplete" would confirm one does.
    const app = appAs(ACCEPTING);
    const res = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('an unknown purpose is refused, not waved through — the check tests for the SAFE value', async () => {
    // `!== 'full'`, not `=== 'acceptance'`. The first draft tested for the
    // dangerous value, so a purpose nobody had thought about yet would have
    // arrived with full authority. This is that inversion, asserted.
    const future = { ...CLIENT, purpose: 'impersonation' as unknown as 'full' };
    const app = appAs(future);
    const res = await app.inject({ method: 'GET', url: '/api/client/v1/projects' });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('refuses to boot if ACCEPTANCE_REACHABLE names a PUBLIC route, which grants nothing', () => {
    // The first draft listed `DELETE /api/auth/session`, a public route, two
    // lines below its own docstring explaining why sign-IN could not be listed
    // — for exactly this reason. The gate returns before the purpose check for
    // a public route, so the entry granted nothing and read as though it did,
    // and the test for it ("not 401") passed vacuously.
    const problems = routerCoverageProblems(
      ROUTES.map((r) => routeKey(r.method, r.path)),
      ROUTES,
      UNIMPLEMENTED,
      new Set(['DELETE /api/auth/session']),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/is a PUBLIC route/);
  });

  it('the boot assertion is wired to the REAL set, not only to one a test passes in', () => {
    // Review emptied the default and every case stayed green: each one passed
    // its own set, so the wiring was untested. This omits the argument.
    const renamed = ROUTES.map((r) =>
      r.path === '/api/client/v1/mfa/enroll' ? { ...r, path: '/api/client/v1/mfa/enrol' } : r,
    );
    const problems = routerCoverageProblems(
      renamed.map((r) => routeKey(r.method, r.path)),
      renamed,
      new Map([...UNIMPLEMENTED].filter(([k]) => k !== 'POST /api/client/v1/mfa/enroll')),
    );
    expect(problems.some((p) => p.includes('ACCEPTANCE_REACHABLE names POST /api/client/v1/mfa/enroll'))).toBe(true);
  });

  it('refuses to boot if ACCEPTANCE_REACHABLE names a route that does not exist', () => {
    // Same posture as UNIMPLEMENTED: a permission for a route nobody mounted is
    // one that will quietly point at the wrong thing after a rename.
    const problems = routerCoverageProblems(
      ROUTES.map((r) => routeKey(r.method, r.path)),
      ROUTES,
      UNIMPLEMENTED,
      new Set(['POST /api/client/v1/mfa/enrol']), // one l — the rename that happens
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ACCEPTANCE_REACHABLE names POST \/api\/client\/v1\/mfa\/enrol,/);
  });
});

describe('T-14c request validation gates (unit)', () => {
  const VALID_ID = '00000000-0000-4000-8000-000000000099';

  it('refuses unknown or server-owned fields on client drafting bodies (T-13c)', async () => {
    const app = appAs(CLIENT);

    const withOrgId = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 10_000_000,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
        organization_id: VALID_ID,
      },
    });
    expect(withOrgId.statusCode).toBe(400);
    expect(withOrgId.json().error.code).toBe('VALIDATION_ERROR');
    expect(withOrgId.json().error.details).toEqual({
      fields: [{ kind: 'undeclared', path: 'organization_id' }],
    });

    const withAudience = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/units`,
      payload: {
        units: [{ unit_id: 'u1', width_um: 1, depth_um: 1, height_um: 1, weight_lb: 1 }],
        audience: 'internal',
      },
    });
    expect(withAudience.statusCode).toBe(400);
    expect(withAudience.json().error.details).toEqual({
      fields: [{ kind: 'undeclared', path: 'audience' }],
    });

    await app.close();
  });

  it('validates facility, units, options, pagination, and UUID path params before touching the DB', async () => {
    const app = appAs(CLIENT);

    const badPage = await app.inject({
      method: 'GET',
      url: '/api/client/v1/projects?page=0',
    });
    expect(badPage.statusCode).toBe(400);

    const badProjectId = await app.inject({
      method: 'GET',
      url: '/api/client/v1/projects/not-a-uuid/revisions',
    });
    expect(badProjectId.statusCode).toBe(400);

    const badRevisionsPage = await app.inject({
      method: 'GET',
      url: `/api/client/v1/projects/${VALID_ID}/revisions?pageSize=999`,
    });
    expect(badRevisionsPage.statusCode).toBe(400);

    const unstatedForkliftWithAisle = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 10_000_000,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
        forklift: { model_stated: false, required_aisle_um: 3_000_000 },
      },
    });
    expect(unstatedForkliftWithAisle.statusCode).toBe(400);

    const statedForkliftMissingAisle = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 10_000_000,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
        forklift: { model_stated: true },
      },
    });
    expect(statedForkliftMissingAisle.statusCode).toBe(400);

    const negFacility = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 0,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
      },
    });
    expect(negFacility.statusCode).toBe(400);

    const negGrid = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 10_000_000,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
        column_grid: { pitch_x_um: 0, pitch_y_um: 1000 },
      },
    });
    expect(negGrid.statusCode).toBe(400);

    const negDock = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/facility`,
      payload: {
        width_um: 10_000_000,
        depth_um: 10_000_000,
        clear_height_um: 6_000_000,
        dock_count: -1,
      },
    });
    expect(negDock.statusCode).toBe(400);

    const emptyUnits = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/units`,
      payload: { units: [] },
    });
    expect(emptyUnits.statusCode).toBe(400);

    const dupUnits = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/units`,
      payload: {
        units: [
          { unit_id: 'u1', width_um: 100, depth_um: 100, height_um: 100, weight_lb: 100 },
          { unit_id: 'u1', width_um: 100, depth_um: 100, height_um: 100, weight_lb: 100 },
        ],
      },
    });
    expect(dupUnits.statusCode).toBe(400);

    const negUnit = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/units`,
      payload: {
        units: [{ unit_id: 'u1', width_um: 0, depth_um: 100, height_um: 100, weight_lb: 100 }],
      },
    });
    expect(negUnit.statusCode).toBe(400);

    const negOverhang = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/units`,
      payload: {
        units: [
          {
            unit_id: 'u1',
            width_um: 100,
            depth_um: 100,
            height_um: 100,
            weight_lb: 100,
            overhang_um: -1,
          },
        ],
      },
    });
    expect(negOverhang.statusCode).toBe(400);

    const emptyOptions = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/options`,
      payload: { options: [] },
    });
    expect(emptyOptions.statusCode).toBe(400);

    const badActiveOption = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/options`,
      payload: {
        options: [
          {
            option_id: 'opt-a',
            label: 'Option A',
            aisle_width_um: 3_048_000,
            runs: [
              {
                run_id: 'r1',
                unit_id: 'u1',
                x_um: 0,
                y_um: 0,
                bays: [{ bay_id: 'b1', length_um: 2_438_400, levels: 3 }],
              },
            ],
          },
        ],
        active_option_id: 'opt-missing',
      },
    });
    expect(badActiveOption.statusCode).toBe(400);

    const badCompareQuery = await app.inject({
      method: 'GET',
      url: `/api/client/v1/revisions/${VALID_ID}/compare?options=only-one`,
    });
    expect(badCompareQuery.statusCode).toBe(400);

    const badPreviewId = await app.inject({
      method: 'GET',
      url: '/api/client/v1/revisions/not-a-uuid/preview',
    });
    expect(badPreviewId.statusCode).toBe(400);

    const badCompareId = await app.inject({
      method: 'GET',
      url: '/api/client/v1/revisions/not-a-uuid/compare',
    });
    expect(badCompareId.statusCode).toBe(400);

    await app.close();

    const staffApp = appAs(STAFF);
    const badOrgProject = await staffApp.inject({
      method: 'POST',
      url: '/api/internal/v1/projects',
      payload: { organization_id: 'not-a-uuid', number: 'P-1', name: 'Test' },
    });
    expect(badOrgProject.statusCode).toBe(400);

    const emptyNumProject = await staffApp.inject({
      method: 'POST',
      url: '/api/internal/v1/projects',
      payload: { organization_id: VALID_ID, number: '   ', name: 'Test' },
    });
    expect(emptyNumProject.statusCode).toBe(400);

    const emptyNameProject = await staffApp.inject({
      method: 'POST',
      url: '/api/internal/v1/projects',
      payload: { organization_id: VALID_ID, number: 'P-1', name: '   ' },
    });
    expect(emptyNameProject.statusCode).toBe(400);

    const badCatRevision = await staffApp.inject({
      method: 'POST',
      url: `/api/internal/v1/projects/${VALID_ID}/revisions`,
      payload: { catalog_release_id: 'bad', rule_pack_release_id: VALID_ID },
    });
    expect(badCatRevision.statusCode).toBe(400);

    const badRuleRevision = await staffApp.inject({
      method: 'POST',
      url: `/api/internal/v1/projects/${VALID_ID}/revisions`,
      payload: { catalog_release_id: VALID_ID, rule_pack_release_id: 'bad' },
    });
    expect(badRuleRevision.statusCode).toBe(400);

    await staffApp.close();
  });

  it('T-14d: validates UUID params, body schemas, Idempotency-Key headers, and signed document URL expiry', async () => {
    const app = appAs(CLIENT);

    const badSubmitId = await app.inject({
      method: 'POST',
      url: '/api/client/v1/revisions/not-a-uuid/submit',
      headers: { 'idempotency-key': 'k-1' },
      payload: { assumptions_acknowledged: true, disclaimer_version_id: 'd-1' },
    });
    expect(badSubmitId.statusCode).toBe(400);

    const missingSubmitKey = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/submit`,
      payload: { assumptions_acknowledged: true, disclaimer_version_id: 'd-1' },
    });
    expect(missingSubmitKey.statusCode).toBe(400);
    expect(missingSubmitKey.json().error.message).toMatch(/Idempotency-Key/);

    const badSubmitBody = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/submit`,
      headers: { 'idempotency-key': 'k-1' },
      payload: {
        assumptions_acknowledged: true,
        disclaimer_version_id: 'd-1',
        organization_id: VALID_ID,
      },
    });
    expect(badSubmitBody.statusCode).toBe(400);

    const badCloneId = await app.inject({
      method: 'POST',
      url: '/api/client/v1/revisions/not-a-uuid/clone',
      headers: { 'idempotency-key': 'k-2' },
    });
    expect(badCloneId.statusCode).toBe(400);

    const missingCloneKey = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/clone`,
    });
    expect(missingCloneKey.statusCode).toBe(400);
    expect(missingCloneKey.json().error.message).toMatch(/Idempotency-Key/);

    const badCloneBody = await app.inject({
      method: 'POST',
      url: `/api/client/v1/revisions/${VALID_ID}/clone`,
      headers: { 'idempotency-key': 'k-2' },
      payload: { lifecycle_state: 'FROZEN' },
    });
    expect(badCloneBody.statusCode).toBe(400);

    const badSubmissionId = await app.inject({
      method: 'GET',
      url: '/api/client/v1/submissions/not-a-uuid',
    });
    expect(badSubmissionId.statusCode).toBe(400);

    const badDocumentId = await app.inject({
      method: 'GET',
      url: '/api/client/v1/documents/not-a-uuid',
    });
    expect(badDocumentId.statusCode).toBe(400);

    await app.close();

    // Signed preliminary PDF URL verification & expiry (OD-10 / FR-DC-03)
    const issuedAt = new Date('2026-09-06T12:00:00.000Z');
    const expiresAtMs = issuedAt.getTime() + DOCUMENT_URL_TTL_MS;
    const url = signDocumentUrl({
      submissionId: VALID_ID,
      manifestHash: 'a'.repeat(64),
      expiresAtMs,
    });
    expect(verifySignedDocumentUrl(url, issuedAt)).toBe(true);
    expect(
      verifySignedDocumentUrl(url, new Date(issuedAt.getTime() + DOCUMENT_URL_TTL_MS - 1_000)),
    ).toBe(true);
    // At or past expires_at -> expired (false)
    expect(
      verifySignedDocumentUrl(url, new Date(issuedAt.getTime() + DOCUMENT_URL_TTL_MS)),
    ).toBe(false);
    // Tampered signature or path -> false
    expect(verifySignedDocumentUrl(url.replace(/sig=[0-9a-f]{4}/, 'sig=ffff'), issuedAt)).toBe(
      false,
    );
    expect(verifySignedDocumentUrl('not-a-url', issuedAt)).toBe(false);
  });

  it('validates T-14e internal and OIDC route inputs before database access', async () => {
    const denies: unknown[] = [];
    const app = appAs(STAFF, denies);
    const VALID_ID = '00000000-0000-4000-8000-000000000001';

    // OIDC start redirects 302 and sets state cookie
    const oidcStart = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
    expect(oidcStart.statusCode).toBe(302);
    expect(oidcStart.headers['location']).toContain('response_type=code');
    expect(oidcStart.headers['set-cookie']).toContain('rms_oidc_state=');

    // OIDC callback validation & state mismatch
    const oidcMissingParams = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback' });
    expect(oidcMissingParams.statusCode).toBe(400);

    const oidcBadState = await app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?state=wrong&code=abc',
      headers: { cookie: 'rms_oidc_state=deadbeef' },
    });
    expect(oidcBadState.statusCode).toBe(401);

    // Queue validation
    const badQueuePage = await app.inject({
      method: 'GET',
      url: '/api/internal/v1/queue?page=0',
    });
    expect(badQueuePage.statusCode).toBe(400);

    const badQueueStatus = await app.inject({
      method: 'GET',
      url: '/api/internal/v1/queue?status=DRAFT',
    });
    expect(badQueueStatus.statusCode).toBe(400);

    // Internal submission package validation
    const badSubPkgId = await app.inject({
      method: 'GET',
      url: '/api/internal/v1/submissions/not-a-uuid',
    });
    expect(badSubPkgId.statusCode).toBe(400);

    // BOM validation
    const badBomId = await app.inject({
      method: 'GET',
      url: '/api/internal/v1/revisions/not-a-uuid/bom',
    });
    expect(badBomId.statusCode).toBe(400);

    const badBomPage = await app.inject({
      method: 'GET',
      url: `/api/internal/v1/revisions/${VALID_ID}/bom?page=0`,
    });
    expect(badBomPage.statusCode).toBe(400);

    // Derive validation
    const badDeriveId = await app.inject({
      method: 'POST',
      url: '/api/internal/v1/submissions/not-a-uuid/derive',
      headers: { 'idempotency-key': 'k-d1' },
    });
    expect(badDeriveId.statusCode).toBe(400);

    const missingDeriveKey = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/submissions/${VALID_ID}/derive`,
    });
    expect(missingDeriveKey.statusCode).toBe(400);

    const badDeriveBody = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/submissions/${VALID_ID}/derive`,
      headers: { 'idempotency-key': 'k-d1' },
      payload: { audience: 'internal' },
    });
    expect(badDeriveBody.statusCode).toBe(400);

    // Notes validation
    const badNoteRevId = await app.inject({
      method: 'POST',
      url: '/api/internal/v1/revisions/not-a-uuid/notes',
      payload: { body: 'hello' },
    });
    expect(badNoteRevId.statusCode).toBe(400);

    const emptyNoteBody = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/revisions/${VALID_ID}/notes`,
      payload: { body: '   ' },
    });
    expect(emptyNoteBody.statusCode).toBe(400);

    const badNoteSubId = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/revisions/${VALID_ID}/notes`,
      payload: { body: 'valid note', submission_id: 'not-a-uuid' },
    });
    expect(badNoteSubId.statusCode).toBe(400);

    // Catalog release approve validation & re-authentication check
    const badApproveId = await app.inject({
      method: 'POST',
      url: '/api/internal/v1/catalog/releases/not-a-uuid/approve',
      payload: {},
    });
    expect(badApproveId.statusCode).toBe(400);

    const unauthApprove = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/catalog/releases/${VALID_ID}/approve`,
      payload: {
        reauthenticated: false,
        verification_paths: [],
        human_spot_checks: [],
        dataset_cells: [],
      },
    });
    expect(unauthApprove.statusCode).toBe(401);
    expect(denies.length).toBeGreaterThanOrEqual(1);

    // User deactivate, invitation revoke, idempotency release validation
    const badDeactivateBody = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/users/${VALID_ID}/deactivate`,
      payload: { status: 'inactive' },
    });
    expect(badDeactivateBody.statusCode).toBe(400);

    const badRevokeBody = await app.inject({
      method: 'POST',
      url: `/api/internal/v1/invitations/${VALID_ID}/revoke`,
      payload: { revoked_at: '2026-09-06T00:00:00Z' },
    });
    expect(badRevokeBody.statusCode).toBe(400);

    const badReleaseOrg = await app.inject({
      method: 'POST',
      url: '/api/internal/v1/idempotency-claims/stuck-key/release',
      payload: { organization_id: 'not-a-uuid', reason: 'operator release' },
    });
    expect(badReleaseOrg.statusCode).toBe(400);

    await app.close();
  });
});

describe('T-15 — AC-02, AC-03 and AC-06 re-asserted against the live router', () => {
  it('enumerates all 32 mounted routes from the real Fastify router, calls each as a client principal, and asserts 404 on every internal route and zero forbidden fields (AC-02, AC-06)', async () => {
    const denies: { action: string; reason: string; actor: Principal }[] = [];
    const clientAdmin: Principal = { ...CLIENT, role: 'CLIENT_ADMIN' };
    const app = appAs(clientAdmin, denies as unknown[]);
    await app.ready();

    // Enumerate directly from the live router (app.mountedRoutes populated via Fastify onRoute),
    // not by iterating the ROUTES table alone.
    const mounted = [...app.mountedRoutes];
    expect(mounted).toHaveLength(ROUTES.length);
    expect(mounted).toHaveLength(32);
    expect(new Set(mounted)).toEqual(new Set(ROUTES.map((r) => routeKey(r.method, r.path))));

    let internalCount = 0;
    let clientCount = 0;
    let publicCount = 0;

    for (const key of mounted) {
      const [method, rawPath] = key.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
      const url = rawPath.replace(/:\w+/g, '00000000-0000-4000-8000-000000000099');
      const res =
        method === 'POST'
          ? await app.inject({ method, url, payload: {} })
          : await app.inject({ method, url });

      if (rawPath.startsWith('/api/internal/')) {
        internalCount += 1;
        expect(res.statusCode, `${key} must return 404 to a client principal`).toBe(404);
        expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'not found' } });
      } else if (rawPath.startsWith('/api/client/')) {
        clientCount += 1;
        const body = res.json() as unknown;
        expect(
          findForbiddenFields(body),
          `${key} leaked forbidden client fields`,
        ).toEqual([]);
      } else {
        publicCount += 1;
      }
    }

    expect(internalCount).toBe(13);
    expect(clientCount).toBe(14);
    expect(publicCount).toBe(5);
    expect(denies.length).toBeGreaterThanOrEqual(internalCount);

    await app.close();
  });

  it('catches a planted forbidden field at top level or nested depth on a client route and refuses with 500 INTERNAL_ERROR (AC-02 verification)', async () => {
    const violations: OutboundViolation[] = [];
    const app = createApp({
      env: ENV,
      now: () => new Date('2026-09-03T00:00:00Z'),
      onOutboundViolation: (v) => {
        violations.push(v);
      },
    });
    app.addHook('onRequest', async (request) => {
      request.principal = CLIENT;
    });
    // Plant a forbidden field at both top level and nested depth inside the client response
    app.addHook('preSerialization', async (_request, _reply, payload) => {
      return {
        ...(payload as Record<string, unknown>),
        cost: 99.95,
        nested: {
          items: [{ ok: true }, { mpn: 'IM-UPR-42' }],
          rule_id: 'RULE-AISLE-01',
        },
      };
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/client/v1/projects?page=0',
    });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'internal server error' },
    });
    expect(findForbiddenFields(res.json())).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.route).toBe('GET /api/client/v1/projects');
    expect([...(violations[0]?.fields ?? [])].sort()).toEqual(
      ['cost', 'nested.items[1].mpn', 'nested.rule_id'].sort(),
    );

    // Also verify the guard refuses cleanly when onOutboundViolation is omitted
    const appWithoutCallback = createApp({
      env: ENV,
      now: () => new Date('2026-09-03T00:00:00Z'),
    });
    appWithoutCallback.addHook('onRequest', async (request) => {
      request.principal = CLIENT;
    });
    appWithoutCallback.addHook('preSerialization', async (_request, _reply, payload) => ({
      ...(payload as Record<string, unknown>),
      internal_note: 'secret estimator remark',
    }));

    const res2 = await appWithoutCallback.inject({
      method: 'GET',
      url: '/api/client/v1/projects?page=0',
    });
    await appWithoutCallback.close();

    expect(res2.statusCode).toBe(500);
    expect(res2.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'internal server error' },
    });
    expect(findForbiddenFields(res2.json())).toEqual([]);
  });
});


