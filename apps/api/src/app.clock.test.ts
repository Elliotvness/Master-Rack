/**
 * The production clock, which until now no test had ever called.
 *
 * `createApp` takes an injected clock so a test can hold time still:
 * `const now = deps.now ?? ((): Date => new Date())`. Every existing call site
 * injects one, so the `??` fallback — the arrow the SERVER runs, since
 * `server.ts` calls `createApp()` with no `deps` — was constructed on every
 * boot and invoked by nothing. Nine functions in `app.ts`, eight covered:
 * 88.88%, under the file's own 90% floor.
 *
 * The floor caught it the first time coverage could run after `T-14b`…`T-14e`
 * grew the file — eleven commits landed with no machine able to compile them
 * (F-64). Found by the gate, not by review (**F-65**).
 *
 * Not a coverage errand. The audit row's `occurredAt` is the only place the
 * gate's clock reaches a persisted record, and the assertions below are about
 * the TIMESTAMP rather than about the arrow having been entered.
 *
 * **`Date.now()` is banned repo-wide** (§12.2 determinism) and this file does
 * not spell its way around the ban: there is no "now" to compare against here.
 * The clock is pinned by four properties no broken clock holds at once —
 * ISO-8601 UTC to the millisecond, inside a fixed era window, and ADVANCING
 * across a real `setTimeout`. Proven red on four planted fallbacks: a frozen
 * constant, the epoch, seconds read as milliseconds, and microseconds read as
 * milliseconds.
 */

import { describe, expect, it } from 'vitest';

import { createApp, type DenyRecorder, type Principal } from './app.js';

const CLIENT: Principal = {
  userId: '77777777-7777-4777-8777-a00000000001',
  organizationId: '77777777-7777-4777-8777-a00000000002',
  actorType: 'client',
  role: 'CLIENT_USER',
  purpose: 'full',
};

const ENV = { CLAIM_LEASE_MINUTES: '10' };

/**
 * The era window. The lower bound is a date already past when this test was
 * written, so the epoch (1970), seconds-as-milliseconds (also 1970) and a
 * frozen constant from before it all fall outside; the upper bound catches a
 * clock reading microseconds or nanoseconds as milliseconds, which lands tens
 * of thousands of years out. Fixed values, deliberately — reading the real
 * clock to bound the real clock would prove nothing and would need the banned
 * syntax to do it.
 */
const ERA_START = Date.parse('2026-10-26T00:00:00.000Z');
const ERA_END = Date.parse('2100-01-01T00:00:00.000Z');

const ISO_MILLISECONDS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('the default clock — createApp with no injected `now`', () => {
  it('stamps each deny with a real, current-era clock that advances', async () => {
    const denies: { occurredAt: string }[] = [];
    const recordDeny: DenyRecorder = async (event) => {
      denies.push({ occurredAt: event.occurredAt });
    };

    // No `now`. This is the shape `server.ts` boots: a dependency the process
    // does not supply falls through to the production default.
    const app = createApp({ env: ENV, recordDeny });
    app.addHook('onRequest', async (request) => {
      request.principal = CLIENT;
    });

    // A client on an internal path: 404, and one audited deny (T-14a).
    const first = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    // A real timer, not a fake one — the point is that the real clock moved.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await app.inject({ method: 'GET', url: '/api/internal/v1/queue' });
    await app.close();

    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(404);
    expect(denies).toHaveLength(2);

    const stamps = denies.map((d) => d.occurredAt);
    for (const stamp of stamps) {
      expect(stamp).toMatch(ISO_MILLISECONDS_UTC);
      const parsed = Date.parse(stamp);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(parsed).toBeGreaterThan(ERA_START);
      expect(parsed).toBeLessThan(ERA_END);
    }

    // A frozen clock satisfies every property above and fails here.
    expect(Date.parse(stamps[1] ?? '')).toBeGreaterThan(Date.parse(stamps[0] ?? ''));
  });
});
