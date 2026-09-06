/**
 * The route policy registry and the boot-time coverage assertion.
 *
 * The one control that survives someone adding an endpoint on a Friday: a route
 * with no declared authorization policy prevents the application from STARTING,
 * not from serving a request. A missing check that fails at boot is found by
 * the person who added the route; a missing check that fails at request time is
 * found by whoever it leaks to.
 *
 * Every route also declares its namespace. The client and internal namespaces
 * are hard-separated by actor_type: a client principal can reach no
 * `/api/internal` route, which makes leakage a routing bug (loud, greppable)
 * rather than a serialization bug (invisible in review).
 */

import type { ResponseSchema } from '@rms/contracts';

import { CLIENT_SCHEMAS } from '../dto/client.js';
import { INTERNAL_SCHEMAS } from '../dto/internal.js';
import { KNOWN_ACTIONS, type Action, type ActorType } from './authorize.js';

export type Namespace = 'client' | 'internal' | 'public';

export interface RoutePolicy {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly namespace: Namespace;
  /**
   * The action this route authorizes, or null ONLY for an explicitly public
   * route (invitation acceptance). Null is a deliberate declaration, never an
   * omission — a route with no `action` key at all fails the assertion.
   */
  readonly action: Action | null;
  /**
   * The response schema this route answers with, by name in its namespace's
   * registry (`CLIENT_SCHEMAS` / `INTERNAL_SCHEMAS`), or null ONLY for a
   * public route. T-13b: this is how "one DTO per (entity × audience)" is
   * measured rather than listed — the assertion below refuses a name the
   * registry does not hold, and T-14's outbound hook reads it.
   */
  readonly response: string | null;
}

/** The schema registries the assertion checks `response` against. */
export interface ResponseRegistries {
  readonly client: Readonly<Record<string, ResponseSchema>>;
  readonly internal: Readonly<Record<string, ResponseSchema>>;
}

const REGISTRIES: ResponseRegistries = Object.freeze({ client: CLIENT_SCHEMAS, internal: INTERNAL_SCHEMAS });

/** Which actor types may reach each namespace. */
const NAMESPACE_ACTORS: Readonly<Record<Namespace, ReadonlySet<ActorType>>> = {
  public: new Set<ActorType>(['client', 'staff']),
  client: new Set<ActorType>(['client']),
  internal: new Set<ActorType>(['staff']),
};

export function namespaceAllows(namespace: Namespace, actorType: ActorType): boolean {
  return NAMESPACE_ACTORS[namespace].has(actorType);
}

/**
 * The route table: the A-08/A-09 policy registry. Each entry is a promise that
 * the route is covered; the assertion below proves the promise is kept.
 *
 * **THIS IS THE MVP-1 SURFACE, and it is 32 rows as of 2026-09-05.** §8.2 lists
 * **34**, two marked phase 2 (held in `PHASE_2_ROUTES` below), so the MVP-1
 * surface is 32 and this table carries all 32. `tools/check-route-surface.mjs`
 * derives those numbers on every run; this paragraph is the only place they are
 * written in prose, which is itself a hazard — review found the previous
 * version of it still describing a 23-row §8.2 and a 21-row registry, two
 * amendments out of date.
 *
 * TWO AMENDMENTS GOT IT HERE, and the lineage is the argument for the checker:
 *
 *   - **2026-09-03**, EL: the operator release route,
 *     `POST /api/internal/v1/idempotency-claims/:key/release`. Before it, T-14a
 *     closed **drift 4** the way it always had to be closed — by adding the two
 *     routes §8.2 listed and the registry lacked (`GET .../documents/:id` and
 *     `POST .../revisions/:id/notes`), never by editing 21 down to 20. Session
 *     2's proposed remedy would have hidden two missing MVP-1 routes by moving
 *     the target to meet the code.
 *   - **2026-09-05**, EL: ten routes, after **F-46** found the inventory
 *     declared no way for ANYONE to sign in — one `/api/auth/*` route in the
 *     whole blueprint, no second-factor enrollment, no OIDC callback — so no
 *     client principal could reach §15.2 steps 3–7 and no staff principal could
 *     exist at all for steps 1 and 8. The same shape as drift 4 one level up,
 *     and the code could not be written first: `check-route-surface` and
 *     `createApp`'s boot gate both refuse a route §8.2 does not carry. That is
 *     the control working, not obstructing.
 *
 * `PENDING_AMENDMENT` is empty, which is the healthy state.
 *
 * **And the agreement is a control rather than a count.** `check-route-surface`
 * parses §8.2 out of the built blueprint and diffs it against these two lists
 * in both directions, and since the second amendment it also checks each row is
 * filed under the BAND its path belongs to — the amendment put two
 * `/api/client` rows under "Internal surface", where a reader deciding an
 * authorization question would have read the opposite of what this file says.
 */
export const ROUTES: readonly RoutePolicy[] = [
  // ------------------------------------------------------------------------
  // Authentication surface (§8.2 amended 2026-09-05 — F-46).
  //
  // FOUR of these are `public`, where there was one, and that is a real
  // widening of the surface the gate does not authorize — so it is stated
  // rather than left to be noticed. A `public` route means only "no session
  // exists yet to authorize", and every one of the four is a route whose whole
  // job is to CREATE or DESTROY that session:
  //
  //   invite/accept   holds a single-use token instead of a session
  //   POST session    presents a credential and a second factor instead
  //   DELETE session  ends the caller's own session; with none it is a no-op,
  //                   so there is nothing to authorize and nothing to leak
  //   oidc/start      begins a redirect to the identity provider
  //   oidc/callback   carries the IdP's signed response instead
  //
  // Each therefore authenticates by its OWN evidence, and none of them may
  // ever read a tenant row on the strength of being public. The two MFA routes
  // are deliberately NOT here: enrollment happens under the short-lived
  // acceptance session §14.3's Transport row describes, so a principal exists,
  // and they sit at `/api/client/v1/mfa/*` in the client namespace — which
  // keeps the property `authorize.test.ts` asserts, that a client-namespace
  // route is always a `/api/client` path. Namespace follows the path, so a
  // leak stays a routing bug (loud, greppable) rather than one.
  // ------------------------------------------------------------------------
  { method: 'POST', path: '/api/auth/invite/accept', namespace: 'public', action: null, response: null },
  { method: 'POST', path: '/api/auth/session', namespace: 'public', action: null, response: null },
  { method: 'DELETE', path: '/api/auth/session', namespace: 'public', action: null, response: null },
  { method: 'GET', path: '/api/auth/oidc/start', namespace: 'public', action: null, response: null },
  { method: 'GET', path: '/api/auth/oidc/callback', namespace: 'public', action: null, response: null },

  // Client surface. A list route names its ITEM schema; the pagination
  // envelope around it is `@rms/contracts`' and is T-14's to apply.
  { method: 'GET', path: '/api/client/v1/projects', namespace: 'client', action: 'project.read', response: 'Project' },
  { method: 'GET', path: '/api/client/v1/projects/:id/revisions', namespace: 'client', action: 'revision.read', response: 'Revision' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/facility', namespace: 'client', action: 'revision.edit', response: 'Revision' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/units', namespace: 'client', action: 'revision.edit', response: 'Revision' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/options', namespace: 'client', action: 'revision.edit', response: 'Revision' },
  { method: 'GET', path: '/api/client/v1/revisions/:id/preview', namespace: 'client', action: 'revision.read', response: 'Preview' },
  { method: 'GET', path: '/api/client/v1/revisions/:id/compare', namespace: 'client', action: 'revision.read', response: 'Comparison' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/submit', namespace: 'client', action: 'revision.submit', response: 'Submission' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/clone', namespace: 'client', action: 'revision.clone', response: 'Revision' },
  { method: 'GET', path: '/api/client/v1/submissions/:id', namespace: 'client', action: 'submission.read', response: 'Submission' },
  { method: 'GET', path: '/api/client/v1/documents/:id', namespace: 'client', action: 'document.read', response: 'Document' },
  { method: 'POST', path: '/api/client/v1/mfa/enroll', namespace: 'client', action: 'credential.enroll_factor', response: 'MfaEnrollment' },
  { method: 'POST', path: '/api/client/v1/mfa/verify', namespace: 'client', action: 'credential.verify_factor', response: 'MfaFactor' },
  { method: 'POST', path: '/api/client/v1/invitations', namespace: 'client', action: 'invitation.create', response: 'Invitation' },

  // Internal surface.
  { method: 'GET', path: '/api/internal/v1/queue', namespace: 'internal', action: 'submission.read', response: 'QueueEntry' },
  { method: 'GET', path: '/api/internal/v1/submissions/:id', namespace: 'internal', action: 'submission.read', response: 'SubmissionPackage' },
  { method: 'GET', path: '/api/internal/v1/revisions/:id/bom', namespace: 'internal', action: 'bom.read', response: 'BomLine' },
  { method: 'POST', path: '/api/internal/v1/submissions/:id/derive', namespace: 'internal', action: 'revision.derive_internal', response: 'Revision' },
  { method: 'POST', path: '/api/internal/v1/organizations', namespace: 'internal', action: 'organization.create', response: 'Organization' },
  { method: 'POST', path: '/api/internal/v1/projects', namespace: 'internal', action: 'project.create', response: 'Project' },
  { method: 'POST', path: '/api/internal/v1/projects/:id/revisions', namespace: 'internal', action: 'project.create_revision', response: 'Revision' },
  { method: 'POST', path: '/api/internal/v1/users/:id/deactivate', namespace: 'internal', action: 'user.deactivate', response: 'Deactivation' },
  { method: 'POST', path: '/api/internal/v1/invitations/:id/revoke', namespace: 'internal', action: 'invitation.revoke', response: 'Invitation' },
  { method: 'POST', path: '/api/internal/v1/invitations', namespace: 'internal', action: 'invitation.create_any_org', response: 'Invitation' },
  { method: 'POST', path: '/api/internal/v1/catalog/releases/:id/approve', namespace: 'internal', action: 'catalog.approve', response: 'CatalogRelease' },
  { method: 'POST', path: '/api/internal/v1/revisions/:id/notes', namespace: 'internal', action: 'note.create', response: 'InternalNote' },
  { method: 'POST', path: '/api/internal/v1/idempotency-claims/:key/release', namespace: 'internal', action: 'idempotency.release', response: 'AuditEvent' },
];

/**
 * §8.2's rows the blueprint itself marks phase 2. Held as data rather than
 * left out, so "the registry is short two routes" and "the registry carries a
 * phase-2 route" cannot both be true again without something saying so.
 */
export const PHASE_2_ROUTES: readonly RoutePolicy[] = [
  { method: 'GET', path: '/api/internal/v1/audit', namespace: 'internal', action: 'audit.read', response: 'AuditEvent' },
  // `POST /api/internal/v1/submissions/:id/status` is §8.2's other phase-2 row
  // and has no Action yet; it arrives with the status vocabulary F-38 is about.
];

/**
 * Rows in ROUTES that §8.2 does not carry, each with the amendment it waits on.
 *
 * **Empty, and that is the healthy state.** It held the operator release for
 * one afternoon; EL amended §8.2 and confirmed both substitutions — the path
 * (there is no `/admin` namespace) and `INTERNAL_ADMIN` for "operator role" —
 * so the entry is gone rather than left as a note about something that already
 * happened. `check-route-surface` fails on any row this list would have to
 * describe, so the list can no longer be the only thing standing between the
 * registry and the blueprint.
 */
export const PENDING_AMENDMENT: readonly { readonly path: string; readonly why: string }[] = [];

export class RouteCoverageError extends Error {
  override readonly name = 'RouteCoverageError';
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `The application cannot start: ${problems.length} route policy problem(s).\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.problems = Object.freeze([...problems]);
  }
}

/**
 * Assert every route declares a policy, and every non-public route names a
 * known action. Call this at application boot. It THROWS rather than warning,
 * because a warning at boot is a warning nobody reads.
 */
export function assertRouteCoverage(
  routes: readonly RoutePolicy[] = ROUTES,
  registries: ResponseRegistries = REGISTRIES,
): void {
  const problems: string[] = [];
  const known = new Set<Action>(KNOWN_ACTIONS);
  const seen = new Set<string>();

  for (const route of routes) {
    const id = `${route.method} ${route.path}`;

    if (seen.has(id)) problems.push(`${id}: declared more than once`);
    seen.add(id);

    // `action` must be present as a key. undefined (missing key) is the failure
    // the whole mechanism exists to catch; null is an explicit public route.
    if (!('action' in route)) {
      problems.push(`${id}: no 'action' declared — every route must state its policy`);
      continue;
    }

    // Same discipline for the response: the key must be present, null only
    // on a public route, and a name must exist in the namespace's registry —
    // a route that answers with a shape nobody declared is a route the
    // outbound guard cannot judge.
    if (!('response' in route)) {
      problems.push(`${id}: no 'response' declared — every route must name the schema it answers with`);
    } else if (route.response === null) {
      if (route.namespace !== 'public') problems.push(`${id}: only a public route may have a null response`);
    } else if (route.namespace === 'public') {
      problems.push(`${id}: a public route answers with no registered schema — declare null`);
    } else if (!Object.hasOwn(registries[route.namespace], route.response)) {
      problems.push(`${id}: response schema '${route.response}' is not in the ${route.namespace} registry`);
    }

    if (route.action === null) {
      if (route.namespace !== 'public') {
        problems.push(`${id}: only a public route may have a null action`);
      }
      continue;
    }

    if (!known.has(route.action)) {
      problems.push(`${id}: action '${route.action}' has no rule in authorize()`);
    }

    // A client-namespace route must not authorize an internal-only action, and
    // vice versa. This catches a route filed under the wrong namespace.
    if (route.namespace === 'client' && INTERNAL_ONLY_ACTIONS.has(route.action)) {
      problems.push(`${id}: internal-only action '${route.action}' on a client route`);
    }
  }

  // Guard against a vacuous pass.
  if (routes.length === 0) {
    problems.push('the route table is empty — refusing to report coverage of nothing');
  }

  if (problems.length > 0) {
    throw new RouteCoverageError(problems);
  }
}

/**
 * Actions that must never appear on a client-namespace route.
 *
 * **KEPT IN STEP BY A TEST, not by memory.** The §8.2 amendment of 2026-09-05
 * added four actions and put none of them here — the identical omission this
 * list's own note below records catching for `idempotency.release`, repeated by
 * the change that read the note. `matrix.test.ts` now derives the membership:
 * every action whose rule denies BOTH client roles must be in this set, so the
 * next one cannot be forgotten either.
 */
export const INTERNAL_ONLY_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  // Releasing a stranded claim overrides a safety control; it may never appear
  // on a client route. Review found it absent from this set while every
  // comparable action was in it — the assertion would have waved it through.
  'idempotency.release',
  'note.create',
  'bom.read',
  'catalog.read',
  'catalog.approve',
  'audit.read',
  'revision.derive_internal',
  'organization.create',
  'invitation.create_any_org',
  // Added 2026-09-05 with the §8.2 amendment. `project.create` is here for the
  // first time because the amendment gave it its first route; the other three
  // arrived with it. `credential.enroll_factor` and `credential.verify_factor`
  // are deliberately absent — clients may do those and staff may not, which is
  // the one inversion in the whole table.
  'project.create',
  'project.create_revision',
  'user.deactivate',
  'invitation.revoke',
]);
