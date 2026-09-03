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
 * It is NOT yet the MVP-1 surface from blueprint §8.2, and saying so would be
 * false in both directions. §8.2 lists 23 rows, two marked phase 2, so the
 * MVP-1 surface is 21. This table carries 20: it omits two MVP-1 routes —
 * `GET /api/client/v1/documents/:id` and `POST /api/internal/v1/revisions/:id/notes`
 * (neither has an Action in authorize.ts either) — and it carries the phase-2
 * `GET /api/internal/v1/audit`. Coverage against §8.2 is 19 of 21. T-14 closes
 * the gap by adding the routes, never by editing the target down.
 *
 * Nothing mounts this table yet; no HTTP router exists. AC-06 is therefore
 * still enforced against a model, which is what T-15 converts.
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
  { method: 'POST', path: '/api/client/v1/invitations', namespace: 'client', action: 'invitation.create', response: 'Invitation' },

  // Internal surface.
  { method: 'GET', path: '/api/internal/v1/queue', namespace: 'internal', action: 'submission.read', response: 'QueueEntry' },
  { method: 'GET', path: '/api/internal/v1/submissions/:id', namespace: 'internal', action: 'submission.read', response: 'SubmissionPackage' },
  { method: 'GET', path: '/api/internal/v1/revisions/:id/bom', namespace: 'internal', action: 'bom.read', response: 'BomLine' },
  { method: 'POST', path: '/api/internal/v1/submissions/:id/derive', namespace: 'internal', action: 'revision.derive_internal', response: 'Revision' },
  { method: 'POST', path: '/api/internal/v1/organizations', namespace: 'internal', action: 'organization.create', response: 'Organization' },
  { method: 'POST', path: '/api/internal/v1/invitations', namespace: 'internal', action: 'invitation.create_any_org', response: 'Invitation' },
  { method: 'POST', path: '/api/internal/v1/catalog/releases/:id/approve', namespace: 'internal', action: 'catalog.approve', response: 'CatalogRelease' },
  { method: 'GET', path: '/api/internal/v1/audit', namespace: 'internal', action: 'audit.read', response: 'AuditEvent' },
  { method: 'POST', path: '/api/internal/v1/idempotency-claims/:key/release', namespace: 'internal', action: 'idempotency.release', response: 'AuditEvent' },
];

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
  'bom.read',
  'catalog.read',
  'catalog.approve',
  'audit.read',
  'revision.derive_internal',
  'organization.create',
  'invitation.create_any_org',
]);
