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
 * **This IS the MVP-1 surface now (T-14a).** §8.2 lists 23 rows and marks two
 * phase 2, so the MVP-1 surface is 21, and this table carries all 21. Drift 4
 * — open since session 3 — is closed the way it always had to be, by adding
 * the two missing routes rather than editing 21 down to 20:
 *
 *   - `GET /api/client/v1/documents/:id`  the signed watermarked-PDF URL that
 *     §15.2 step 6, E-08 and AC-16 depend on. Its absence also kept the one
 *     client route that hands out a document URL outside AC-02's leakage walk.
 *   - `POST /api/internal/v1/revisions/:id/notes` (E-05)
 *
 * Both now have an `Action` in `authorize.ts`, which neither had before.
 *
 * The phase-2 rows live in `PHASE_2_ROUTES` below, so the registry and §8.2
 * agree row for row instead of agreeing on a total that happened to match.
 *
 * EL amended §8.2 on 2026-09-03 to carry `POST /api/internal/v1/idempotency-claims/:key/release`,
 * so the blueprint now lists **24** rows, two marked phase 2, and this table
 * carries all **22** MVP-1 ones. `PENDING_AMENDMENT` is empty, which is the
 * healthy state.
 *
 * **And the agreement is now a control rather than a count.**
 * `tools/check-route-surface.mjs` parses §8.2 out of the built blueprint and
 * diffs it against these two lists in both directions. Drift 4 lived for five
 * sessions because every session that noticed it noticed it by hand; a number
 * in a document is not a control, and this is the control.
 */
export const ROUTES: readonly RoutePolicy[] = [
  // Public — no session required, single-use token instead.
  { method: 'POST', path: '/api/auth/invite/accept', namespace: 'public', action: null, response: null },

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
  { method: 'POST', path: '/api/client/v1/invitations', namespace: 'client', action: 'invitation.create', response: 'Invitation' },

  // Internal surface.
  { method: 'GET', path: '/api/internal/v1/queue', namespace: 'internal', action: 'submission.read', response: 'QueueEntry' },
  { method: 'GET', path: '/api/internal/v1/submissions/:id', namespace: 'internal', action: 'submission.read', response: 'SubmissionPackage' },
  { method: 'GET', path: '/api/internal/v1/revisions/:id/bom', namespace: 'internal', action: 'bom.read', response: 'BomLine' },
  { method: 'POST', path: '/api/internal/v1/submissions/:id/derive', namespace: 'internal', action: 'revision.derive_internal', response: 'Revision' },
  { method: 'POST', path: '/api/internal/v1/organizations', namespace: 'internal', action: 'organization.create', response: 'Organization' },
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

/** Actions that must never appear on a client-namespace route. */
const INTERNAL_ONLY_ACTIONS: ReadonlySet<Action> = new Set<Action>([
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
]);
