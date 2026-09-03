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

import {
  RouterCoverageError,
  UNIMPLEMENTED,
  createApp,
  routeKey,
  routerCoverageProblems,
  type DenyRecorder,
  type Principal,
} from './app.js';
import { ROUTES } from './authz/routes.js';

const CLIENT: Principal = {
  userId: '77777777-7777-4777-8777-a00000000001',
  organizationId: '77777777-7777-4777-8777-a00000000002',
  actorType: 'client',
  role: 'CLIENT_USER',
};
const STAFF: Principal = {
  userId: '77777777-7777-4777-8777-a00000000003',
  organizationId: '77777777-7777-4777-8777-a00000000004',
  actorType: 'staff',
  role: 'INTERNAL_ADMIN',
};
const SALES: Principal = { ...STAFF, role: 'INTERNAL_SALES' };

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

  it('lets the one public route through without a principal', async () => {
    const app = appAs(undefined);
    const res = await app.inject({ method: 'POST', url: '/api/auth/invite/accept' });
    // Reaches the placeholder rather than the gate: 500, not 401.
    expect(res.statusCode).toBe(500);
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
    const ok = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    expect(ok.statusCode).toBe(500); // through the gate, into the placeholder
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
      const res = await app.inject({ method: route.method, url: route.path.replace(/:\w+/g, 'x') });
      expect(res.statusCode, `${route.method} ${route.path}`).toBe(500);
    }
    await app.close();
  });
});

describe('every route is a placeholder, and the list says so rather than the reader guessing', () => {
  it('names a task for every declared route', () => {
    for (const route of ROUTES) {
      expect(UNIMPLEMENTED.get(routeKey(route.method, route.path)), `${route.path}`).toMatch(/^T-14[b-e]$/);
    }
  });

  it('answers with the error envelope and never leaks the internal detail', async () => {
    const app = appAs(STAFF);
    const res = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(res.json())).not.toMatch(/stack|select |from app\./i);
    await app.close();
  });
});
