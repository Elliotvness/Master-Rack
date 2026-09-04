import { describe, expect, it } from 'vitest';
import {
  KNOWN_ACTIONS,
  authorize,
  type Action,
  type Actor,
  type Resource,
  type Role,
} from '../index.js';

/**
 * The exhaustive authorization matrix.
 *
 * The companion suite in authorize.test.ts is example-based, and examples leave
 * holes: several actions had no test at all, which is exactly how a policy
 * regression ships. This asserts EVERY action against EVERY role, so adding an
 * action without deciding its policy for each role is impossible — the matrix
 * fails to compile, or fails to run.
 *
 * This is the control for R-02, the leakage risk that destroys the product's
 * reason to exist, so it is written as enumeration rather than as sampling.
 */

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const ROLES: readonly Role[] = [
  'CLIENT_USER',
  'CLIENT_ADMIN',
  'INTERNAL_SALES',
  'INTERNAL_ADMIN',
  'SERVICE_ENGINE',
];

function actorFor(role: Role, organizationId = ORG_A): Actor {
  const actorType =
    role === 'SERVICE_ENGINE' ? 'service' : role.startsWith('CLIENT') ? 'client' : 'staff';
  return { userId: 'u1', organizationId, actorType, role };
}

const ownResource: Resource = { organizationId: ORG_A };
const otherResource: Resource = { organizationId: ORG_B };
const internalResource: Resource = { organizationId: ORG_A, audience: 'internal' };

/**
 * The expected decision for every (action, role) pair on the actor's OWN
 * organization. Written out by hand rather than derived, because a table
 * derived from the implementation would agree with a bug.
 */
const EXPECTED_OWN_ORG: Readonly<Record<Action, Readonly<Record<Role, boolean>>>> = {
  'project.read': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'project.create': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'revision.read': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'revision.edit': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'revision.submit': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'revision.clone': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'revision.derive_internal': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'submission.read': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'bom.read': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'catalog.read': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'catalog.approve': {
    // Deliberately narrower than "staff": approving a release is the control
    // that keeps a wrong capacity out of a drawing.
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: false, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'audit.read': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  // Overriding a safety control sits with catalog approval, not with the staff
  // reads: INTERNAL_SALES may SEE a stuck submission and must escalate rather
  // than clear it.
  // The client's own watermarked PDF: same audience shape as revision.read.
  'document.read': {
    CLIENT_USER: true, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  // §9 makes an internal note a category a client must never see.
  'note.create': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'idempotency.release': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: false, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'invitation.create': {
    // A client ADMIN may invite into its own org; a client USER may not.
    CLIENT_USER: false, CLIENT_ADMIN: true, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'invitation.create_any_org': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
  'organization.create': {
    CLIENT_USER: false, CLIENT_ADMIN: false, INTERNAL_SALES: true, INTERNAL_ADMIN: true,
    SERVICE_ENGINE: false,
  },
};

describe('the table covers every action, so a new action cannot skip its policy', () => {
  it('has an expectation for every known action, and no extras', () => {
    // If someone adds an action to RULES without adding a row here, this fails
    // — which is the point. The matrix cannot silently fall behind the code.
    expect([...KNOWN_ACTIONS].sort()).toEqual(Object.keys(EXPECTED_OWN_ORG).sort());
  });

  it('states every role for every action', () => {
    for (const action of KNOWN_ACTIONS) {
      const row = EXPECTED_OWN_ORG[action];
      expect(Object.keys(row).sort()).toEqual([...ROLES].sort());
    }
  });
});

describe('every action x every role, on the actor\u2019s own organization', () => {
  for (const action of Object.keys(EXPECTED_OWN_ORG) as Action[]) {
    for (const role of ROLES) {
      const expected = EXPECTED_OWN_ORG[action][role];
      it(`${role} ${expected ? 'MAY' : 'may NOT'} ${action}`, () => {
        const decision = authorize(actorFor(role), action, ownResource);
        expect(decision.allow).toBe(expected);
        if (!decision.allow) {
          // Every denial states a reason. A denial with no reason cannot be
          // debugged, and cannot be audited.
          expect(decision.reason.trim()).not.toBe('');
        }
      });
    }
  }
});

describe('AC-03 \u2014 cross-organization access is denied for every action', () => {
  // A 403 confirms the object exists. Every cross-tenant denial is a 404.
  for (const action of Object.keys(EXPECTED_OWN_ORG) as Action[]) {
    for (const role of ['CLIENT_USER', 'CLIENT_ADMIN'] as Role[]) {
      it(`${role} is denied ${action} on another organization`, () => {
        const decision = authorize(actorFor(role), action, otherResource);
        expect(decision.allow).toBe(false);
      });
    }
  }

  it('reports cross-tenant denials as not-found, never as forbidden', () => {
    const decision = authorize(actorFor('CLIENT_USER'), 'project.read', otherResource);
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.notFound).toBe(true);
  });
});

describe('I-4 \u2014 a service principal holds no interactive authority', () => {
  it('is denied every action, on every resource, whatever role it carries', () => {
    // A service identity quietly handed a human's authority is the failure this
    // prevents. Asserted over the whole action set, not a sample.
    for (const action of KNOWN_ACTIONS) {
      for (const resource of [ownResource, otherResource, internalResource]) {
        const decision = authorize(actorFor('SERVICE_ENGINE'), action, resource);
        expect(decision.allow).toBe(false);
      }
    }
  });

  it('is denied even when carrying an internal admin role', () => {
    const impostor: Actor = {
      userId: 'svc',
      organizationId: 'internal',
      actorType: 'service',
      role: 'INTERNAL_ADMIN',
    };
    for (const action of KNOWN_ACTIONS) {
      expect(authorize(impostor, action, ownResource).allow).toBe(false);
    }
  });
});

describe('AC-02 \u2014 a client never learns an internal ARTIFACT exists', () => {
  /**
   * The distinction this block encodes, because getting it wrong in either
   * direction is a defect:
   *
   *   - Asking for an internal ARTIFACT (a BOM, an audit record, a catalog
   *     detail, another org's revision) must be a 404. A 403 would confirm the
   *     object exists, which is the leak AC-03 forbids.
   *
   *   - Attempting a staff-only CAPABILITY (create an organization, approve a
   *     release) is a plain denial. There is no object whose existence could
   *     leak: the client is asking to perform an act, not to read a thing. A
   *     404 there would be dishonest in the other direction, telling a client
   *     the endpoint does not exist when it plainly does.
   *
   * An earlier draft of this test asserted 404 for BOTH, which is wrong, and it
   * failed against correct code. The nine capability actions are listed
   * explicitly so the distinction is a decision on the record rather than an
   * accident of implementation.
   */
  const CAPABILITY_ACTIONS: readonly Action[] = [
    'project.create',
    'catalog.approve',
    'invitation.create',
    'invitation.create_any_org',
    'organization.create',
  ];

  const ARTIFACT_ACTIONS = KNOWN_ACTIONS.filter((a) => !CAPABILITY_ACTIONS.includes(a));

  it('denies every client role every ARTIFACT action on an internal resource, as 404', () => {
    for (const action of ARTIFACT_ACTIONS) {
      for (const role of ['CLIENT_USER', 'CLIENT_ADMIN'] as Role[]) {
        const decision = authorize(actorFor(role), action, internalResource);
        expect(decision.allow).toBe(false);
        if (!decision.allow) {
          expect(
            decision.notFound,
            `${action} / ${role} must be 404: a 403 confirms the artifact exists`,
          ).toBe(true);
        }
      }
    }
  });

  it('denies staff-only CAPABILITIES plainly, without pretending the endpoint is absent', () => {
    for (const action of CAPABILITY_ACTIONS) {
      const decision = authorize(actorFor('CLIENT_USER'), action, internalResource);
      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reason.trim()).not.toBe('');
      }
    }
  });

  it('covers every action between the two groups, with no action in both', () => {
    // If a new action is added, it lands in ARTIFACT_ACTIONS by default and the
    // 404 assertion applies to it — failing loudly if that is the wrong call.
    expect([...ARTIFACT_ACTIONS, ...CAPABILITY_ACTIONS].sort()).toEqual([...KNOWN_ACTIONS].sort());
  });
});

describe('the decision point fails closed', () => {
  it('denies an action that has no rule, rather than defaulting to allow', () => {
    // Unreachable while route coverage holds. It is asserted anyway, because
    // "unreachable" is a claim about today's code, and the cost of being wrong
    // here is an unauthorized action.
    const decision = authorize(actorFor('INTERNAL_ADMIN'), 'not.a.real.action' as Action, ownResource);
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toMatch(/no policy for action/);
  });
});
