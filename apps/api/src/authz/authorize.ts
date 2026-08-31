/**
 * authorize(actor, action, resource) — one pure function, table-driven.
 *
 * Blueprint §14.5. Deliberately NOT an external policy engine: for five roles
 * and one relationship chain, OPA/Cedar/OpenFGA add a network hop and a
 * tuple-consistency problem for a policy set that fits in one file. Revisit at
 * ~50 rules or when a customer demands custom roles.
 *
 * Two orthogonal axes decide every request, and conflating them is the classic
 * way a product like this leaks:
 *   - organization_id  (which ROWS) — a client sees only its own organization.
 *   - actor_type       (which TABLES and FIELDS) — a client never sees internal
 *     data even on its OWN organization's project. Its margin legitimately
 *     belongs to its organization; it is still none of its business.
 *
 * A denial to a client is served as 404, never 403: a 403 confirms the object
 * exists.
 */

export type ActorType = 'client' | 'staff' | 'service';

export type Role =
  | 'CLIENT_USER'
  | 'CLIENT_ADMIN'
  | 'INTERNAL_SALES'
  | 'INTERNAL_ADMIN'
  | 'SERVICE_ENGINE';

export interface Actor {
  readonly userId: string;
  readonly organizationId: string;
  readonly actorType: ActorType;
  readonly role: Role;
}

/**
 * The resource an action touches. `organizationId` is the OWNING organization;
 * `audience` marks internal-only artifacts a client must never see exist.
 */
export interface Resource {
  readonly organizationId: string;
  readonly audience?: 'client' | 'internal';
}

/** Every action the system authorizes. A closed set; adding a route adds one. */
export type Action =
  | 'project.read'
  | 'project.create'
  | 'revision.read'
  | 'revision.edit'
  | 'revision.submit'
  | 'revision.clone'
  | 'revision.derive_internal'
  | 'submission.read'
  | 'bom.read'
  | 'catalog.read'
  | 'catalog.approve'
  | 'invitation.create'
  | 'invitation.create_any_org'
  | 'audit.read'
  | 'organization.create';

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string; readonly notFound: boolean };

const ALLOW: Decision = { allow: true };

function deny(reason: string, notFound = false): Decision {
  return { allow: false, reason, notFound };
}

const CLIENT_ROLES: ReadonlySet<Role> = new Set(['CLIENT_USER', 'CLIENT_ADMIN']);
const STAFF_ROLES: ReadonlySet<Role> = new Set(['INTERNAL_SALES', 'INTERNAL_ADMIN']);

/**
 * One rule per action. Each returns a decision from the actor and resource.
 * Kept as data so a test can assert every action has a rule and none is
 * reachable without one.
 */
type Rule = (actor: Actor, resource: Resource) => Decision;

/** A client may act only within its own organization, and never on internal artifacts. */
function clientOwnOrg(actor: Actor, resource: Resource): Decision {
  if (resource.audience === 'internal') {
    // Not "visible but locked" — a client must not learn it exists. 404.
    return deny('internal artifact is not visible to a client', true);
  }
  if (actor.organizationId !== resource.organizationId) {
    return deny('cross-organization access', true);
  }
  return ALLOW;
}

const RULES: Readonly<Record<Action, Rule>> = {
  'project.read': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not read projects');
  },
  'project.create': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff create projects'),

  'revision.read': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not read revisions');
  },
  'revision.edit': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not edit revisions');
  },
  'revision.submit': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not submit');
  },
  'revision.clone': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not clone');
  },
  'revision.derive_internal': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff derive internal revisions', true),

  'submission.read': (actor, resource) => {
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    if (CLIENT_ROLES.has(actor.role)) return clientOwnOrg(actor, resource);
    return deny('role may not read submissions');
  },

  // Internal-only surfaces. A client reaching these is a 404, never a 403.
  'bom.read': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('BOM is internal-only', true),
  'catalog.read': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('catalog detail is internal-only', true),
  'catalog.approve': (actor) =>
    actor.role === 'INTERNAL_ADMIN' ? ALLOW : deny('only an internal admin approves a release'),
  'audit.read': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('audit log is internal-only', true),

  'invitation.create': (actor, resource) => {
    // A client admin may invite into its OWN organization only.
    if (actor.role === 'CLIENT_ADMIN') return clientOwnOrg(actor, resource);
    if (STAFF_ROLES.has(actor.role)) return ALLOW;
    return deny('role may not invite');
  },
  'invitation.create_any_org': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff invite into another organization'),

  'organization.create': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff create organizations'),
};

/** Every action that has a rule. Used by the boot-time coverage assertion. */
export const KNOWN_ACTIONS: readonly Action[] = Object.keys(RULES) as Action[];

/**
 * The one authorization decision point.
 *
 * A SERVICE_ENGINE principal is denied everything here: it writes derived
 * outputs and audit events through a separate, non-authorizing path, and must
 * never approve, waive, release or grant. Making that explicit stops a service
 * identity from being quietly handed a human's authority.
 */
export function authorize(actor: Actor, action: Action, resource: Resource): Decision {
  if (actor.actorType === 'service') {
    return deny('service principals hold no interactive authority');
  }
  const rule = RULES[action];
  // Unreachable if KNOWN_ACTIONS coverage holds, but fail closed regardless.
  if (rule === undefined) {
    return deny(`no policy for action ${action}`);
  }
  return rule(actor, resource);
}
