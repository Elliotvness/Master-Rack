import { describe, expect, it } from 'vitest';
import {
  KNOWN_ACTIONS,
  ROUTES,
  RouteCoverageError,
  assertRouteCoverage,
  authorize,
  namespaceAllows,
  type Action,
  type Actor,
  type Resource,
  type RoutePolicy,
} from '../index.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1',
    organizationId: ORG_A,
    actorType: 'client',
    role: 'CLIENT_USER',
    ...overrides,
  };
}

const staff = (): Actor =>
  actor({ actorType: 'staff', role: 'INTERNAL_SALES', organizationId: 'internal' });
const admin = (): Actor =>
  actor({ actorType: 'staff', role: 'INTERNAL_ADMIN', organizationId: 'internal' });
const ownProject: Resource = { organizationId: ORG_A };
const otherProject: Resource = { organizationId: ORG_B };

describe('organization scoping (which rows)', () => {
  it('lets a client read its own project', () => {
    expect(authorize(actor(), 'project.read', ownProject).allow).toBe(true);
  });

  it('denies a client another organization, as a 404', () => {
    const d = authorize(actor(), 'project.read', otherProject);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.notFound).toBe(true);
  });

  it('lets staff read any organization', () => {
    expect(authorize(staff(), 'project.read', otherProject).allow).toBe(true);
  });
});

describe('actor_type scoping (which tables and fields)', () => {
  it('denies a client the BOM even on its OWN organization, as a 404', () => {
    const d = authorize(actor(), 'bom.read', ownProject);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.notFound).toBe(true);
  });

  it('denies a client catalog detail and the audit log', () => {
    expect(authorize(actor(), 'catalog.read', ownProject).allow).toBe(false);
    expect(authorize(actor(), 'audit.read', ownProject).allow).toBe(false);
  });

  it('lets staff read the BOM', () => {
    expect(authorize(staff(), 'bom.read', ownProject).allow).toBe(true);
  });

  it('never shows a client an internal-audience artifact, as a 404', () => {
    const internalRevision: Resource = { organizationId: ORG_A, audience: 'internal' };
    const d = authorize(actor(), 'revision.read', internalRevision);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.notFound).toBe(true);
  });
});

describe('role gates', () => {
  it('only an internal admin approves a catalog release', () => {
    expect(authorize(staff(), 'catalog.approve', ownProject).allow).toBe(false);
    expect(authorize(admin(), 'catalog.approve', ownProject).allow).toBe(true);
  });

  it('only staff create organizations and projects', () => {
    expect(authorize(actor(), 'organization.create', ownProject).allow).toBe(false);
    expect(authorize(actor(), 'project.create', ownProject).allow).toBe(false);
    expect(authorize(staff(), 'organization.create', ownProject).allow).toBe(true);
  });

  it('a client admin may invite into its own org but not another', () => {
    const clientAdmin = actor({ role: 'CLIENT_ADMIN' });
    expect(authorize(clientAdmin, 'invitation.create', ownProject).allow).toBe(true);
    expect(authorize(clientAdmin, 'invitation.create', otherProject).allow).toBe(false);
    // Only staff may use the any-org invite.
    expect(authorize(clientAdmin, 'invitation.create_any_org', otherProject).allow).toBe(false);
    expect(authorize(staff(), 'invitation.create_any_org', otherProject).allow).toBe(true);
  });
});

describe('SERVICE_ENGINE holds no interactive authority', () => {
  it('is denied every action', () => {
    const service = actor({ actorType: 'service', role: 'SERVICE_ENGINE' });
    for (const action of KNOWN_ACTIONS) {
      expect(authorize(service, action, ownProject).allow).toBe(false);
    }
  });
});

describe('I-4 — SERVICE_ENGINE may never approve, waive, release or grant', () => {
  it('cannot approve a catalog release even with an admin role attached', () => {
    const service = actor({ actorType: 'service', role: 'INTERNAL_ADMIN' });
    expect(authorize(service, 'catalog.approve', ownProject).allow).toBe(false);
  });
});

describe('AC-06 — boot-time route coverage', () => {
  it('passes for the real route table', () => {
    expect(() => assertRouteCoverage()).not.toThrow();
  });

  it('every declared route action has a rule in authorize()', () => {
    const known = new Set<Action>(KNOWN_ACTIONS);
    for (const route of ROUTES) {
      if (route.action !== null) {
        expect(known.has(route.action)).toBe(true);
      }
    }
  });

  it('fails to start if a route omits its action declaration', () => {
    const broken = [
      { method: 'GET', path: '/api/client/v1/oops', namespace: 'client' },
    ] as unknown as RoutePolicy[];
    expect(() => assertRouteCoverage(broken)).toThrow(RouteCoverageError);
  });

  it('fails if a route names an action with no rule', () => {
    const broken: RoutePolicy[] = [
      { method: 'GET', path: '/api/client/v1/x', namespace: 'client', action: 'nope' as Action },
    ];
    expect(() => assertRouteCoverage(broken)).toThrow(/no rule/);
  });

  it('fails if an internal-only action is filed on a client route', () => {
    const broken: RoutePolicy[] = [
      { method: 'GET', path: '/api/client/v1/bom', namespace: 'client', action: 'bom.read' },
    ];
    expect(() => assertRouteCoverage(broken)).toThrow(/internal-only/);
  });

  it('fails on a duplicate route', () => {
    const broken: RoutePolicy[] = [
      { method: 'GET', path: '/dup', namespace: 'internal', action: 'audit.read' },
      { method: 'GET', path: '/dup', namespace: 'internal', action: 'audit.read' },
    ];
    expect(() => assertRouteCoverage(broken)).toThrow(/more than once/);
  });

  it('refuses to report coverage of an empty table', () => {
    expect(() => assertRouteCoverage([])).toThrow(/empty/);
  });

  it('permits a null action only on a public route', () => {
    const good: RoutePolicy[] = [
      { method: 'POST', path: '/api/auth/x', namespace: 'public', action: null },
    ];
    expect(() => assertRouteCoverage(good)).not.toThrow();

    const bad: RoutePolicy[] = [
      { method: 'POST', path: '/api/client/v1/x', namespace: 'client', action: null },
    ];
    expect(() => assertRouteCoverage(bad)).toThrow(/only a public route/);
  });
});

describe('namespace hard separation by actor type', () => {
  it('a client can reach no internal route', () => {
    expect(namespaceAllows('internal', 'client')).toBe(false);
    expect(namespaceAllows('client', 'client')).toBe(true);
  });

  it('staff reach internal routes', () => {
    expect(namespaceAllows('internal', 'staff')).toBe(true);
  });

  it('every internal route is in the internal namespace, and vice versa', () => {
    for (const route of ROUTES) {
      if (route.path.startsWith('/api/internal')) {
        expect(route.namespace).toBe('internal');
      }
      if (route.namespace === 'client') {
        expect(route.path.startsWith('/api/client')).toBe(true);
      }
    }
  });
});
