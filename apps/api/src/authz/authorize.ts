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
  | 'document.read'
  | 'note.create'
  | 'idempotency.release'
  | 'organization.create'
  // Added 2026-09-05 with the §8.2 amendment (F-46). Each is a route the
  // inventory did not carry and an MVP-1 requirement needed.
  | 'credential.enroll_factor'
  | 'credential.verify_factor'
  | 'project.create_revision'
  | 'user.deactivate'
  | 'invitation.revoke';

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

  // A signed URL for the client's OWN watermarked PDF. Same shape as
  // `revision.read`: scoped to the caller's organization, and a cross-tenant
  // miss is 404 because a 403 would confirm another client's document exists.
  // Staff may read one too — an internal reviewer looking at what the client
  // was sent.
  'document.read': (actor, resource) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : clientOwnOrg(actor, resource),

  // An internal reviewer's note on a revision (E-05). Internal-only in the
  // strongest sense: §9 makes internal notes a category a client must never
  // see, so this is 404 to a client rather than 403.
  'note.create': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('internal notes are internal-only', true),

  // Releasing a stranded idempotency claim overrides a safety control, so it
  // sits with catalog approval at INTERNAL_ADMIN rather than with the staff
  // reads — INTERNAL_SALES may see a stuck submission and must escalate rather
  // than clear it. `notFound: true` because to a client the route does not
  // exist at all: this is an internal ARTIFACT, and a 403 would confirm the
  // key.
  'idempotency.release': (actor) =>
    actor.role === 'INTERNAL_ADMIN'
      ? ALLOW
      : deny('only an internal admin releases a stranded claim', true),

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

  // --- Added with the §8.2 amendment of 2026-09-05 (F-46) ---

  // Enrolling one's OWN second factor. A client role only: §14.4 puts staff on
  // Entra ID with phishing-resistant MFA held by the IdP, so a staff principal
  // reaching this route would be enrolling a factor this system does not
  // authenticate against. Staff are denied rather than allowed-and-ignored,
  // because a factor that exists and decides nothing is worse than none.
  //
  // WHICH user's factor is not decided here. At the GATE, `resource` is the
  // caller's own organization, so `clientOwnOrg` can only allow — this rule
  // answers "may this role enroll a factor at all", and the handler enrolls the
  // factor of the PRINCIPAL, taking no user id from anywhere. That is the
  // object half, and the reason this cannot become an account-takeover route.
  //
  // `clientOwnOrg` is NOT dead weight, and review's first read that it was a
  // tautology is wrong in one place that matters: `matrix.test.ts`'s AC-03
  // sweep calls every action with ANOTHER organization's resource, and this
  // rule has to deny there. It is also what will hold when a `resourceLoader`
  // lands on `RoutePolicy` and the gate starts passing the real object.
  'credential.enroll_factor': (actor, resource) =>
    CLIENT_ROLES.has(actor.role)
      ? clientOwnOrg(actor, resource)
      : deny('staff second factors are held by the identity provider (§14.4)'),

  // Completing the enrollment by proving possession. A SEPARATE action from
  // beginning it, with the same rule body today, and the separation is the
  // point: two routes sharing one action means one matrix row for two
  // operations, so any future narrowing of enrollment — "only under an
  // acceptance session", say — would silently narrow verification too, and a
  // narrowing of verification would silently widen nothing anyone noticed. The
  // cost of keeping them apart is three lines; the cost of merging them is a
  // policy change nobody can see.
  'credential.verify_factor': (actor, resource) =>
    CLIENT_ROLES.has(actor.role)
      ? clientOwnOrg(actor, resource)
      : deny('staff second factors are held by the identity provider (§14.4)'),

  // Creating the first draft revision on a project. Staff only, and 404 to a
  // client rather than 403: OD-04 settles internal-created projects for MVP-1,
  // so the route does not exist as far as a client is concerned. A client's
  // own new drafts come from `revision.clone`, which it does have.
  //
  // No `notFound`: the namespace gate refuses a client before this rule is
  // reached, so the flag could only ever be observed by a SERVICE_ENGINE, which
  // `authorize` short-circuits above. `organization.create` and
  // `catalog.approve` — the closest neighbours — are plain denials for the same
  // reason, and a flag that cannot fire reads as a control that does.
  'project.create_revision': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff create the first revision'),

  // AC-17. Deactivation ends every session at once and revokes every pending
  // invitation, which is the strongest thing any route in this system does to
  // an account — so it sits at INTERNAL_ADMIN with catalog approval and the
  // idempotency release, not with the staff reads. INTERNAL_SALES may see that
  // an account should go and must escalate rather than pull it.
  'user.deactivate': (actor) =>
    actor.role === 'INTERNAL_ADMIN' ? ALLOW : deny('only an internal admin deactivates a user'),

  // Revoking a pending invitation. Staff, for the §8.2 row the amendment adds.
  // A client_admin revoking an invitation it issued is a real requirement and
  // is deliberately NOT granted here: §8.2 carries no client-namespace revoke
  // route, and inventing the authority before the route would be the mistake
  // F-46 is about, in reverse.
  'invitation.revoke': (actor) =>
    STAFF_ROLES.has(actor.role) ? ALLOW : deny('only staff revoke invitations'),
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
