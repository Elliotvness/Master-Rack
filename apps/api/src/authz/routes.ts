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
}

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
  { method: 'POST', path: '/api/auth/invite/accept', namespace: 'public', action: null },

  // Client surface.
  { method: 'GET', path: '/api/client/v1/projects', namespace: 'client', action: 'project.read' },
  { method: 'GET', path: '/api/client/v1/projects/:id/revisions', namespace: 'client', action: 'revision.read' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/facility', namespace: 'client', action: 'revision.edit' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/units', namespace: 'client', action: 'revision.edit' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/options', namespace: 'client', action: 'revision.edit' },
  { method: 'GET', path: '/api/client/v1/revisions/:id/preview', namespace: 'client', action: 'revision.read' },
  { method: 'GET', path: '/api/client/v1/revisions/:id/compare', namespace: 'client', action: 'revision.read' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/submit', namespace: 'client', action: 'revision.submit' },
  { method: 'POST', path: '/api/client/v1/revisions/:id/clone', namespace: 'client', action: 'revision.clone' },
  { method: 'GET', path: '/api/client/v1/submissions/:id', namespace: 'client', action: 'submission.read' },
  { method: 'POST', path: '/api/client/v1/invitations', namespace: 'client', action: 'invitation.create' },

  // Internal surface.
  { method: 'GET', path: '/api/internal/v1/queue', namespace: 'internal', action: 'submission.read' },
  { method: 'GET', path: '/api/internal/v1/submissions/:id', namespace: 'internal', action: 'submission.read' },
  { method: 'GET', path: '/api/internal/v1/revisions/:id/bom', namespace: 'internal', action: 'bom.read' },
  { method: 'POST', path: '/api/internal/v1/submissions/:id/derive', namespace: 'internal', action: 'revision.derive_internal' },
  { method: 'POST', path: '/api/internal/v1/organizations', namespace: 'internal', action: 'organization.create' },
  { method: 'POST', path: '/api/internal/v1/invitations', namespace: 'internal', action: 'invitation.create_any_org' },
  { method: 'POST', path: '/api/internal/v1/catalog/releases/:id/approve', namespace: 'internal', action: 'catalog.approve' },
  { method: 'GET', path: '/api/internal/v1/audit', namespace: 'internal', action: 'audit.read' },
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
export function assertRouteCoverage(routes: readonly RoutePolicy[] = ROUTES): void {
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
  'bom.read',
  'catalog.read',
  'catalog.approve',
  'audit.read',
  'revision.derive_internal',
  'organization.create',
  'invitation.create_any_org',
]);
