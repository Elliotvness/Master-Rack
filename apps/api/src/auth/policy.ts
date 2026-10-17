/**
 * Session and cookie policy constants.
 *
 * Values from blueprint NFR-SEC-04. Held as data in one place so the two apps,
 * the tests and any future audit read the same numbers rather than
 * rediscovering them.
 */

import type { ActorType } from '@rms/db';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Invitation tokens expire in 72 hours; anything acting as a login, 15 minutes. */
export const INVITATION_TTL_MS = 72 * HOUR;
export const LOGIN_TOKEN_TTL_MS = 15 * MINUTE;

/**
 * How long the acceptance session lasts. **PROVISIONAL, and EL's to set.**
 *
 * §14.3 states no acceptance-session lifetime. The first version of this took
 * §14.3's "15 minutes for anything that acts as a login" and put it in a
 * database CHECK, and adversarial review refused it on two grounds worth
 * keeping in front of whoever picks the real number:
 *
 *   - **It cannot be §14.3's login number.** The reason the gate bounds what an
 *     acceptance session may reach is that it is NOT a login. Borrowing the
 *     login rule for its lifetime argues the opposite of the allowlist.
 *   - **Whatever the number, running out of it strands the person.** The
 *     acceptance POST spends the single-use token, and both revocation and
 *     §14.3's self-service resend require an unaccepted invitation. So a person
 *     who does not finish — sets a password, cannot find their authenticator,
 *     comes back in an hour — has a spent invitation and no way in. That is a
 *     product gap, not a constant, and it is recorded rather than tuned away.
 *
 * Thirty minutes is a working default: long enough to set a password and enrol
 * a factor without hurrying, short enough that an abandoned browser tab is not
 * a standing credential. It is deliberately NOT `LOGIN_TOKEN_TTL_MS`, so
 * changing one does not silently change the other, and deliberately not in a
 * CHECK constraint, so an operator can extend a session rather than watch
 * somebody be locked out by a cliff.
 */
export const ACCEPTANCE_SESSION_TTL_MS = 30 * MINUTE;

export interface SessionLifetime {
  /** Hard cap from creation, regardless of activity. */
  readonly absoluteMs: number;
  /** Cap from last activity; each request slides it forward. */
  readonly idleMs: number;
}

/**
 * Staff sessions are shorter, because a staff account sees every client's data.
 * Service principals do not hold interactive sessions at all.
 */
const LIFETIMES: Readonly<Record<ActorType, SessionLifetime>> = {
  staff: { absoluteMs: 8 * HOUR, idleMs: 30 * MINUTE },
  client: { absoluteMs: 24 * HOUR, idleMs: 2 * HOUR },
  // A service principal authenticates per-call and never carries a session.
  service: { absoluteMs: 0, idleMs: 0 },
};

/**
 * What a session is FOR, and therefore how long it lasts and what it may reach.
 *
 * `acceptance` is §14.3's *Transport* row: the short-lived session the
 * acceptance POST is exchanged for, which exists so the invited person has a
 * principal to enroll a second factor under. It is NOT a login — §14.3's next
 * row forbids that in terms — and the gate refuses it on every route but the
 * handful `ACCEPTANCE_REACHABLE` names.
 */
export type SessionPurpose = 'acceptance' | 'full';

export function lifetimeFor(
  actorType: ActorType,
  purpose: SessionPurpose = 'full',
): SessionLifetime {
  // Absolute and idle alike: sliding an idle window on a session this short
  // would just be a slower version of the long one, and the point is that an
  // abandoned enrolment stops being a credential.
  if (purpose === 'acceptance') {
    return { absoluteMs: ACCEPTANCE_SESSION_TTL_MS, idleMs: ACCEPTANCE_SESSION_TTL_MS };
  }
  return LIFETIMES[actorType];
}

/**
 * The cookie the session token rides in.
 *
 * `__Host-` prefix REQUIRES Secure, no Domain, and Path=/, and the browser
 * enforces it — which is exactly the hardening we want and cannot forget.
 * HttpOnly keeps it out of JavaScript; SameSite=Lax survives a normal
 * top-level navigation while blocking cross-site POST. The token is never in
 * localStorage, ever.
 */
export const SESSION_COOKIE_NAME = '__Host-rms_session';

export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: 'lax' | 'strict';
  readonly path: '/';
  readonly maxAgeMs: number;
}

/**
 * `purpose` is not optional decoration here. `lifetimeFor` gained the parameter
 * and every caller was updated except this one — the caller that decides how
 * long the BROWSER keeps the token. An acceptance session died server-side at
 * its cap while its cookie sat in the browser for 24 hours: not an escalation,
 * because `resolveSession` still refuses it, but a bearer token outliving the
 * thing it bears by two orders of magnitude for no reason anybody chose.
 */
export function sessionCookieOptions(
  actorType: ActorType,
  purpose: SessionPurpose = 'full',
): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAgeMs: lifetimeFor(actorType, purpose).absoluteMs,
  };
}
