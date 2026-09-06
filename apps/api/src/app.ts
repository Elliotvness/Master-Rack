/**
 * The application, and the gate every request passes through (task **T-14a**).
 *
 * §8.3's first enforcement rule: *"Every route declares its policy, or the app
 * does not boot. A startup assertion walks the router and fails if any handler
 * lacks an annotation. This is the one control that survives 'someone added an
 * endpoint on a Friday'."*
 *
 * Until now that assertion walked `ROUTES` — the model, not the router — which
 * is F-02's shape one level up: an exhaustive check over the list under test
 * proves the list agrees with itself. `createApp` collects what Fastify
 * actually registered through an `onRoute` hook and compares the two sets **in
 * both directions**, so a mounted route absent from `ROUTES` and a `ROUTES`
 * entry nobody mounted are each a refusal to boot. AC-06 is enforced against
 * the router from here on.
 *
 * ## What this file does not do
 *
 * It owns no handler and no business logic. A route module pairs a
 * `RoutePolicy` with a handler; T-14b–e write those. What ships today is the
 * gate, the error envelope, the outbound guard, and a placeholder handler per
 * route — placeholders declared as DATA in `UNIMPLEMENTED`, not left to be
 * discovered, so "the app boots" can never be mistaken for "the app works".
 *
 * ## Deny-by-default, and what "every deny is an audit event" means here
 *
 * §8.3 requires an audit event for every deny. The line is drawn at whether a
 * PRINCIPAL exists, not at the status code, and the two are no longer the same
 * thing:
 *
 *   - An ANONYMOUS 401 is not audited. There is no tenant to scope the row to
 *     and no actor to name in it, so recording it would mean either a
 *     null-tenant row RLS cannot govern or attributing a request to an
 *     organization that did not make it. It is logged.
 *   - Every AUTHORIZATION denial is audited — 403 and 404 alike.
 *   - **An acceptance-session 401 IS audited**, and this is the revisit the
 *     earlier version of this paragraph promised "when T-14b introduces
 *     sessions". That request has a real principal in a real organization, so
 *     the stated reason for not auditing does not apply to it. The paragraph
 *     said flatly "a 401 is not audited" and went on saying it after the code
 *     stopped agreeing; review caught it.
 *
 * WHAT THE DENY EVENT DOES NOT CARRY, stated rather than discovered later:
 * §13.6's event schema includes `request_id`, a salted `session_id_hash`,
 * `source_ip` and `user_agent`, and `DenyRecorder` carries none of them. That
 * gap predates this file and every audited deny inherits it; the acceptance
 * denial is simply a new class of event inheriting it too. Recorded as a
 * finding rather than quietly widened.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { errorEnvelope, statusFor, type ErrorCode } from '@rms/contracts';
import { withTenant, type TenantContext } from '@rms/db';

import { appendAuditEvent } from './audit/chain.js';
import type { SessionPurpose } from './auth/policy.js';
import { authorize, type Action, type Actor } from './authz/authorize.js';
import { ROUTES, namespaceAllows, type RoutePolicy } from './authz/routes.js';
import { assertConfiguration } from './idempotency/idempotency.js';

/** The principal the session preHandler attaches. Absent until it does. */
export interface Principal extends Actor {
  readonly userId: string;
  readonly actorType: 'client' | 'staff' | 'service';
  /**
   * What the session behind this principal is FOR.
   *
   * REQUIRED, and the first draft had it optional. `Session.purpose` is
   * required, `app.session.purpose` is NOT NULL with no default, and
   * `createSession` refuses to be called without one — three layers all failing
   * closed, and then the principal made it optional and the gate tested for
   * equality with the DANGEROUS value. A preHandler that built a principal and
   * omitted one field would have compiled clean and handed every acceptance
   * session the whole client surface. Review demonstrated it.
   *
   * Migration 0015's own header makes the argument this field was ignoring:
   * "a default would make 'forgot to decide' mean 'full authority', which is
   * the wrong direction to fail." That was true in SQL and just as true here.
   */
  readonly purpose: SessionPurpose;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    /** Set by the gate so a handler cannot re-derive its own policy. */
    policy?: RoutePolicy;
  }
}

/**
 * Routes mounted with a placeholder rather than a handler, each naming the task
 * that fills it.
 *
 * Held as data for the same reason every exemption in this repository is: a
 * placeholder nobody wrote down is indistinguishable from a finished route that
 * happens to return 500. `assertRouterMatchesRegistry` refuses a route that is
 * neither implemented nor listed here, so this list can only shrink by someone
 * deleting an entry, never by someone forgetting one.
 */
export const UNIMPLEMENTED: ReadonlyMap<string, string> = new Map([
  ['POST /api/auth/invite/accept', 'T-14b'],
  // The §8.2 amendment of 2026-09-05 (F-46). Mounted and authorized from the
  // day the rows exist, answering 500 until their task fills them — the same
  // posture as every other row here, so "the inventory grew" can never be read
  // as "the product grew".
  ['POST /api/auth/session', 'T-14b'],
  ['DELETE /api/auth/session', 'T-14b'],
  ['GET /api/auth/oidc/start', 'T-14b'],
  ['GET /api/auth/oidc/callback', 'T-14b'],
  ['POST /api/internal/v1/projects', 'T-14c'],
  ['POST /api/internal/v1/projects/:id/revisions', 'T-14c'],
  ['POST /api/internal/v1/users/:id/deactivate', 'T-14e'],
  ['POST /api/internal/v1/invitations/:id/revoke', 'T-14e'],
  ['GET /api/client/v1/projects', 'T-14c'],
  ['GET /api/client/v1/projects/:id/revisions', 'T-14c'],
  ['POST /api/client/v1/revisions/:id/facility', 'T-14c'],
  ['POST /api/client/v1/revisions/:id/units', 'T-14c'],
  ['POST /api/client/v1/revisions/:id/options', 'T-14c'],
  ['GET /api/client/v1/revisions/:id/preview', 'T-14c'],
  ['GET /api/client/v1/revisions/:id/compare', 'T-14c'],
  ['POST /api/client/v1/revisions/:id/submit', 'T-14d'],
  ['POST /api/client/v1/revisions/:id/clone', 'T-14d'],
  ['GET /api/client/v1/submissions/:id', 'T-14d'],
  ['GET /api/client/v1/documents/:id', 'T-14d'],
  ['POST /api/client/v1/mfa/enroll', 'T-14b'],
  ['POST /api/client/v1/mfa/verify', 'T-14b'],
  ['POST /api/client/v1/invitations', 'T-14b'],
  ['GET /api/internal/v1/queue', 'T-14e'],
  ['GET /api/internal/v1/submissions/:id', 'T-14e'],
  ['GET /api/internal/v1/revisions/:id/bom', 'T-14e'],
  ['POST /api/internal/v1/submissions/:id/derive', 'T-14e'],
  ['POST /api/internal/v1/organizations', 'T-14b'],
  ['POST /api/internal/v1/invitations', 'T-14b'],
  ['POST /api/internal/v1/catalog/releases/:id/approve', 'T-14e'],
  ['POST /api/internal/v1/revisions/:id/notes', 'T-14e'],
  ['POST /api/internal/v1/idempotency-claims/:key/release', 'T-14e'],
]);

/**
 * The only routes an ACCEPTANCE session may reach.
 *
 * §14.3 reconciles its own two rows — *Transport*'s "exchange it for a
 * short-lived server-side session" and *No auto-login*'s "require an explicit
 * first sign-in" — exactly one way: acceptance opens a session so the invited
 * person has a principal to enroll a second factor under, and then they sign in
 * properly. §15.2 step 2 puts it in that order: "accepts, sets a credential,
 * enrolls a second factor, AND SIGNS IN".
 *
 * **That session is a client principal, and until this list existed it could
 * reach every client route** — projects, revisions, previews, submit — on the
 * strength of having clicked a link in an email. Nobody had decided otherwise
 * because, until §8.2 gained a sign-in route on 2026-09-05, there was no
 * acceptance session to decide about. The amendment created the question; this
 * is the answer.
 *
 * Held as DATA for the same reason `UNIMPLEMENTED` is: a list nobody wrote down
 * is a list nobody can review, and `routerCoverageProblems` refuses a key here
 * that names no real route, so it cannot rot into a permission for something
 * that no longer exists.
 *
 * Sign-IN is deliberately absent and its absence is not an oversight:
 * `POST /api/auth/session` is a public route, so the gate returns before any of
 * this runs and an acceptance session neither helps nor hinders it.
 *
 * THE OTHER HALF OF THE BOUND IS IN THE DATABASE. This decides what an
 * acceptance session may touch; migration 0015's CHECK constraint decides how
 * long it lasts — fifteen minutes, §14.3's number for "anything acting as a
 * login". Two mechanisms, and neither is undone by changing the other.
 */
export const ACCEPTANCE_REACHABLE: ReadonlySet<string> = new Set([
  // The two the acceptance session exists for.
  'POST /api/client/v1/mfa/enroll',
  'POST /api/client/v1/mfa/verify',
]);
// `DELETE /api/auth/session` is deliberately NOT here, and its absence is the
// finding rather than an oversight: it is a PUBLIC route, so the gate returns
// before the purpose check and abandoning a half-finished acceptance already
// works. Listing it granted nothing and read as though it did —
// `routerCoverageProblems` now refuses a public route in this set.

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export class RouterCoverageError extends Error {
  override readonly name = 'RouterCoverageError';
}

/**
 * The boot gate. Compares what the router registered against what the registry
 * declares, **both ways**, and refuses on any disagreement.
 *
 * Pure: it takes the two sets as data, so the self-test needs no HTTP server
 * and the failure modes can each be planted directly.
 */
export function routerCoverageProblems(
  registered: readonly string[],
  registry: readonly RoutePolicy[] = ROUTES,
  unimplemented: ReadonlyMap<string, string> = UNIMPLEMENTED,
  acceptanceReachable: ReadonlySet<string> = ACCEPTANCE_REACHABLE,
): string[] {
  const problems: string[] = [];
  const declared = new Set(registry.map((r) => routeKey(r.method, r.path)));
  const mounted = new Set(registered);

  // A scan that matched nothing reports success while enforcing nothing.
  if (registered.length === 0) {
    problems.push(
      'the router registered no routes at all — refusing to boot an application that would ' +
        'enforce a policy registry against nothing.',
    );
    return problems;
  }

  for (const key of mounted) {
    if (!declared.has(key)) {
      problems.push(
        `${key} is mounted on the router and absent from ROUTES. This is the Friday endpoint: ` +
          'it would serve traffic with no declared action, no audience and no response schema.',
      );
    }
  }
  for (const key of declared) {
    if (!mounted.has(key)) {
      problems.push(
        `${key} is declared in ROUTES and mounted on nothing. A policy for a route that does ` +
          'not exist is a promise nobody can keep.',
      );
    }
  }
  for (const key of unimplemented.keys()) {
    if (!declared.has(key)) {
      problems.push(
        `UNIMPLEMENTED names ${key}, which is not in ROUTES. A placeholder for a route that ` +
          'does not exist is a note nobody will delete.',
      );
    }
  }
  const policyOf = new Map(registry.map((r) => [routeKey(r.method, r.path), r] as const));
  for (const key of acceptanceReachable) {
    const route = policyOf.get(key);
    if (route === undefined) {
      problems.push(
        `ACCEPTANCE_REACHABLE names ${key}, which is not in ROUTES. A permission for a route ` +
          'that does not exist is one nobody will notice pointing at the wrong thing when a ' +
          'route is renamed.',
      );
      continue;
    }
    // A PUBLIC route is one the gate returns from before it ever reads the
    // purpose, so allowlisting one grants nothing and, worse, READS as though
    // it does. The first draft listed `DELETE /api/auth/session` here while its
    // own docstring explained two lines above why sign-IN could not be listed,
    // for exactly this reason. The test could not catch it either: "not 401" is
    // true of a route the check never runs on.
    if (route.action === null) {
      problems.push(
        `ACCEPTANCE_REACHABLE names ${key}, which is a PUBLIC route. The gate returns before ` +
          'the purpose check for those, so this entry grants nothing and misleads anyone ' +
          'reading the list to find out what an acceptance session can do.',
      );
    }
  }
  return problems;
}

/** Every deny that reaches a principal. Injected so a test needs no database. */
export type DenyRecorder = (event: {
  readonly actor: Principal;
  readonly action: Action;
  readonly resourceId: string | null;
  readonly reason: string;
  readonly occurredAt: string;
  readonly eventId: string;
}) => Promise<void>;

/**
 * The default recorder: an audit row naming the actor who was denied.
 *
 * **What governs visibility is the ROW, not the transaction.** An earlier
 * draft of this docstring said the deny "is written under the actor who was
 * denied — so it cannot be written into another organization", and that is not
 * what the schema does: `audit_event_insert` is `WITH CHECK (true)` — the
 * chain is append-only from any context, deliberately, because a deny by any
 * actor must be recordable — and `audit_event_select` keys on the row's own
 * `actor_organization_id`, not on the GUC. Pointing this function's tenant
 * context at a different organization changed nothing observable, three
 * plants running, which is how the overclaim was found.
 *
 * So the guarantee is narrower and worth stating exactly: the row carries the
 * denied actor's organization and actor type, and `audit_event_select` then
 * makes it readable by that organization's own client principals and by staff,
 * and by nobody else. `withTenant` is used because it is the only permitted way
 * to reach the database, not because it scopes this write.
 */
export function databaseDenyRecorder(): DenyRecorder {
  return async (event) => {
    const tenant: TenantContext = {
      organizationId: event.actor.organizationId,
      actorType: event.actor.actorType,
    };
    await withTenant(tenant, (tx) =>
      appendAuditEvent(tx, {
        eventId: event.eventId,
        recordedAt: event.occurredAt,
        content: {
          occurredAt: event.occurredAt,
          actorUserId: event.actor.userId,
          actorType: event.actor.actorType,
          actorOrganizationId: event.actor.organizationId,
          impersonatedBy: null,
          subjectOrganizationId: event.actor.organizationId,
          action: event.action,
          resourceType: 'route',
          resourceId: event.resourceId,
          outcome: 'denied',
          reasons: [event.reason],
        },
      }),
    );
  };
}

export interface AppDeps {
  /** Injected: a clock a test can hold still. */
  readonly now?: () => Date;
  /** Injected: an id source, for the same reason `submitEffects` injects one. */
  readonly newId?: () => string;
  readonly recordDeny?: DenyRecorder;
  /** Injected so a test can prove the config gate without touching process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function send(reply: FastifyReply, code: ErrorCode, message: string): FastifyReply {
  return reply.code(statusFor(code)).send(errorEnvelope(code, message));
}

/**
 * Build the application.
 *
 * Order matters and is the point: configuration is validated FIRST, because a
 * process that comes up healthy and fails on the first duplicate claim is worse
 * than one that refuses to start (F-40).
 */
export function createApp(deps: AppDeps = {}): FastifyInstance {
  assertConfiguration(deps.env);

  const app = Fastify({ logger: false });
  const now = deps.now ?? ((): Date => new Date());
  const newId = deps.newId ?? ((): string => crypto.randomUUID());
  const recordDeny = deps.recordDeny;

  const registered: string[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      registered.push(routeKey(m, route.url));
    }
  });

  const policyOf = new Map(ROUTES.map((r) => [routeKey(r.method, r.path), r] as const));

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = routeKey(request.method, request.routeOptions.url ?? '');
    const policy = policyOf.get(key);
    if (policy === undefined) {
      // Unreachable while the boot gate holds; a refusal rather than a throw so
      // the failure is a 500 with no internal detail rather than a stack.
      return send(reply, 'INTERNAL_ERROR', 'the request reached no declared policy');
    }
    request.policy = policy;

    // The FIVE public routes (§8.2's authentication band, less the two MFA
    // ones). No session exists to authorize, so the gate returns here — which
    // also means the purpose check below never runs for them, and an entry in
    // ACCEPTANCE_REACHABLE naming one would be inert.
    if (policy.action === null) return undefined;

    const principal = request.principal;
    if (principal === undefined) {
      // Not audited — see the module note. There is no tenant to scope the row
      // to and no actor to name in it.
      return send(reply, 'UNAUTHENTICATED', 'authentication required');
    }

    // Namespace before action: a client on an internal path must not learn
    // which internal actions exist, so this is 404 and not 403.
    if (!namespaceAllows(policy.namespace, principal.actorType)) {
      await audit(principal, policy.action, 'actor type may not reach this namespace');
      return send(reply, 'NOT_FOUND', 'not found');
    }

    // PURPOSE BEFORE ROLE. An acceptance session is a real principal with a
    // real role, so every role check below would pass it — which is exactly the
    // hole this closes. It is refused as UNAUTHENTICATED rather than forbidden
    // because the accurate statement is that authentication is not FINISHED:
    // §14.3 requires an explicit first sign-in, and the client app's correct
    // response is to send the person to it, not to tell them they lack a
    // permission they will have in thirty seconds.
    //
    // 404 would be wrong here for the same reason a 403 is wrong on a
    // cross-tenant object is right: there is nothing to hide. The route exists,
    // the caller's own organization owns it, and the only missing thing is a
    // step they are in the middle of.
    // `!== 'full'`, not `=== 'acceptance'`. The set of purposes will grow —
    // an impersonation session, a service-to-service one — and a new member
    // must arrive with NO authority until somebody decides what it has, rather
    // than with all of it until somebody remembers to add a case here.
    if (principal.purpose !== 'full' && !ACCEPTANCE_REACHABLE.has(key)) {
      await audit(principal, policy.action, 'acceptance session may not reach this route');
      return send(reply, 'UNAUTHENTICATED', 'authentication is not complete');
    }

    // THE GATE AUTHORIZES THE CAPABILITY. THE HANDLER AUTHORIZES THE OBJECT.
    //
    // `authorize` takes the resource, and the resource is the object the route
    // is about — which only the handler can fetch. Passing the principal's own
    // organization here asks exactly one question: *may this role perform this
    // action at all*. It is deliberately NOT the object check, and saying so
    // matters, because a rule like `clientOwnOrg` trivially allows when handed
    // the actor's own org, and a reader could take an `allow` here for more
    // than it is.
    //
    // The object half is §8.3's "scoped fetch, never fetch-then-check":
    // `currentOrg.revisions.find(id)` inside the handler, which fails closed
    // when a row belongs to another tenant, backed by RLS. T-14b–e write those
    // fetches; until they do, **no route serves an object, so there is no
    // object to leak** — every handler here is a placeholder. When a
    // `resourceLoader` lands on `RoutePolicy`, this call takes its result.
    const decision = authorize(principal, policy.action, {
      organizationId: principal.organizationId,
    });
    if (!decision.allow) {
      await audit(principal, policy.action, decision.reason);
      return decision.notFound
        ? send(reply, 'NOT_FOUND', 'not found')
        : send(reply, 'FORBIDDEN_CAPABILITY', decision.reason);
    }
    return undefined;
  });

  async function audit(actor: Principal, action: Action, reason: string): Promise<void> {
    if (recordDeny === undefined) return;
    await recordDeny({
      actor,
      action,
      resourceId: null,
      reason,
      occurredAt: now().toISOString(),
      eventId: newId(),
    });
  }

  for (const route of ROUTES) {
    const task = UNIMPLEMENTED.get(routeKey(route.method, route.path));
    app.route({
      method: route.method,
      url: route.path,
      handler: async (_request, reply) => {
        // A placeholder answers honestly. §8.3's status table has no 501, so
        // this is a 500 with a fixed message and no detail — and the route is
        // named in UNIMPLEMENTED so nobody has to guess which is which.
        // Whether §8.3 should gain a 501 row is a blueprint question, recorded
        // rather than answered here.
        return send(reply, 'INTERNAL_ERROR', `route not implemented (${task ?? 'unassigned'})`);
      },
    });
  }

  // THE CHECK RUNS AT `ready()`, NOT AT THE END OF THIS FUNCTION.
  //
  // Fastify applications are composed by registering route modules onto an
  // instance — `app.register(clientRoutes)` — which happens AFTER `createApp`
  // returns. A check that ran here would see only the routes this function
  // mounted itself, and every route module added later would walk straight
  // past the one control §8.3 says must survive "someone added an endpoint on
  // a Friday". The `onReady` hook is the last moment at which every route is
  // registered and none has served a request.
  app.addHook('onReady', async () => {
    const problems = routerCoverageProblems(registered);
    if (problems.length > 0) {
      throw new RouterCoverageError(
        `refusing to boot — the router and the policy registry disagree:\n  ${problems.join('\n  ')}`,
      );
    }
  });

  return app;
}
