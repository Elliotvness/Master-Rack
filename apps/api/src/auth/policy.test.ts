import { describe, expect, it } from 'vitest';

import {
  INVITATION_TTL_MS,
  LOGIN_TOKEN_TTL_MS,
  SESSION_COOKIE_NAME,
  lifetimeFor,
  sessionCookieOptions,
} from '../index.js';

/**
 * Session and cookie policy (NFR-SEC-04).
 *
 * These are constants, and it is tempting to leave them untested on the grounds
 * that a constant cannot be wrong. But these particular constants ARE the
 * security posture: a cookie that loses `Secure`, or a staff session that
 * quietly gains a day, is a real weakening that no other test would notice.
 * Asserting them makes a change deliberate rather than incidental.
 */

describe('session lifetimes', () => {
  it('gives staff a SHORTER session than clients, because staff see every org', () => {
    // The direction matters more than the numbers. If a future edit made staff
    // sessions the longer of the two, that is a security regression and this
    // states it as one.
    expect(lifetimeFor('staff').absoluteMs).toBeLessThan(lifetimeFor('client').absoluteMs);
    expect(lifetimeFor('staff').idleMs).toBeLessThan(lifetimeFor('client').idleMs);
  });

  it('pins the published values', () => {
    expect(lifetimeFor('staff')).toEqual({ absoluteMs: 8 * 3_600_000, idleMs: 30 * 60_000 });
    expect(lifetimeFor('client')).toEqual({ absoluteMs: 24 * 3_600_000, idleMs: 2 * 3_600_000 });
  });

  it('gives a service principal no session at all', () => {
    // A service principal authenticates per call. A non-zero lifetime here
    // would mean a service identity could hold an interactive session, which
    // is the thing authorize() refuses at the other end.
    expect(lifetimeFor('service')).toEqual({ absoluteMs: 0, idleMs: 0 });
  });

  it('always expires idle before absolute, or the idle cap would be dead code', () => {
    for (const t of ['staff', 'client'] as const) {
      expect(lifetimeFor(t).idleMs).toBeLessThanOrEqual(lifetimeFor(t).absoluteMs);
    }
  });
});

describe('the session cookie', () => {
  it('uses the __Host- prefix, which the BROWSER enforces', () => {
    // __Host- requires Secure, no Domain, and Path=/. The value of the prefix
    // is that it is enforced by the browser rather than by our discipline.
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
  });

  it('is HttpOnly, Secure, SameSite and rooted at /, for every actor type', () => {
    for (const t of ['staff', 'client', 'service'] as const) {
      const c = sessionCookieOptions(t);
      expect(c.httpOnly).toBe(true);
      expect(c.secure).toBe(true);
      expect(c.path).toBe('/');
      // Lax survives a normal top-level navigation while blocking cross-site
      // POST. Strict would also be acceptable; None would not.
      expect(['lax', 'strict']).toContain(c.sameSite);
    }
  });

  it('carries the actor\u2019s own absolute lifetime, not a shared default', () => {
    expect(sessionCookieOptions('staff').maxAgeMs).toBe(lifetimeFor('staff').absoluteMs);
    expect(sessionCookieOptions('client').maxAgeMs).toBe(lifetimeFor('client').absoluteMs);
    expect(sessionCookieOptions('staff').maxAgeMs).not.toBe(
      sessionCookieOptions('client').maxAgeMs,
    );
  });
});

describe('token lifetimes', () => {
  it('gives an invitation 72 hours and anything acting as a login 15 minutes', () => {
    expect(INVITATION_TTL_MS).toBe(72 * 3_600_000);
    expect(LOGIN_TOKEN_TTL_MS).toBe(15 * 60_000);
  });

  it('never lets a login-equivalent token outlive an invitation', () => {
    // A login token is the more dangerous of the two, so it must be the shorter.
    expect(LOGIN_TOKEN_TTL_MS).toBeLessThan(INVITATION_TTL_MS);
  });
});
