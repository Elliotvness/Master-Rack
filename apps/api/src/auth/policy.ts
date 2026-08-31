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

export function lifetimeFor(actorType: ActorType): SessionLifetime {
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

export function sessionCookieOptions(actorType: ActorType): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAgeMs: lifetimeFor(actorType).absoluteMs,
  };
}

/** Invitation tokens expire in 72 hours; anything acting as a login, 15 minutes. */
export const INVITATION_TTL_MS = 72 * HOUR;
export const LOGIN_TOKEN_TTL_MS = 15 * MINUTE;
