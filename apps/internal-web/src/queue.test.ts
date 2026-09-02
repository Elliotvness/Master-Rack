import { describe, expect, it } from 'vitest';

import {
  QueueError,
  acknowledgementClock,
  ageHours,
  orderQueue,
  organizationsInQueue,
  quoteDeliveryClock,
  type QueueEntry,
} from './index.js';

function entry(over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    submissionId: 'sub-1',
    organizationId: 'org-a',
    organizationName: 'Harbor Logistics',
    projectNumber: 'P-1001',
    status: 'submitted',
    submittedAt: '2026-08-31T08:00:00Z',
    acknowledgedAt: null,
    quotedAt: null,
    blockerCount: 0,
    reviewCount: 1,
    ...over,
  };
}


describe('E-01/E-02 \u2014 the queue spans every organization', () => {
  // The client app is org-scoped by RLS; the internal app is not. That
  // asymmetry is the reason the two are separate bundles.

  it('carries submissions from more than one organization', () => {
    const entries = [
      entry({ submissionId: 'a', organizationId: 'org-a' }),
      entry({ submissionId: 'b', organizationId: 'org-b' }),
      entry({ submissionId: 'c', organizationId: 'org-c' }),
    ];
    expect(organizationsInQueue(entries)).toEqual(['org-a', 'org-b', 'org-c']);
  });

  it('orders oldest first, because the queue exists to stop things being forgotten', () => {
    const ordered = orderQueue([
      entry({ submissionId: 'new', submittedAt: '2026-08-31T12:00:00Z' }),
      entry({ submissionId: 'old', submittedAt: '2026-08-29T09:00:00Z' }),
      entry({ submissionId: 'mid', submittedAt: '2026-08-30T09:00:00Z' }),
    ]);
    expect(ordered.map((e) => e.submissionId)).toEqual(['old', 'mid', 'new']);
  });

  it('breaks ties deterministically, so a re-render never reshuffles rows', () => {
    const same = '2026-08-31T08:00:00Z';
    const ordered = orderQueue([
      entry({ submissionId: 'z', submittedAt: same }),
      entry({ submissionId: 'a', submittedAt: same }),
      entry({ submissionId: 'm', submittedAt: same }),
    ]);
    expect(ordered.map((e) => e.submissionId)).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate the caller\u2019s array', () => {
    const entries = [entry({ submissionId: 'b' }), entry({ submissionId: 'a' })];
    orderQueue(entries);
    expect(entries[0]?.submissionId).toBe('b');
  });
});

describe('the two clocks, per OD-11', () => {
  const now = '2026-08-31T20:00:00Z';

  it('runs the acknowledgement clock until a human picks it up', () => {
    const running = acknowledgementClock(entry(), now);
    expect(running.running).toBe(true);
    expect(running.hours).toBe(12);
  });

  it('STOPS the clock at the acknowledgement, not at now', () => {
    // A stopped clock that keeps counting is just wrong.
    const stopped = acknowledgementClock(
      entry({ acknowledgedAt: '2026-08-31T10:00:00Z' }),
      now,
    );
    expect(stopped.running).toBe(false);
    expect(stopped.hours).toBe(2);
  });

  it('measures quote delivery from submission, not from acknowledgement', () => {
    const clock = quoteDeliveryClock(
      entry({ acknowledgedAt: '2026-08-31T10:00:00Z', quotedAt: '2026-08-31T18:00:00Z' }),
      now,
    );
    expect(clock.hours).toBe(10);
    expect(clock.running).toBe(false);
  });

  it('runs the quote clock against NOW while no quote has been returned', () => {
    // The counterpart of the stopped case: an unquoted submission must keep
    // counting, or an item could sit forgotten while its clock reads zero.
    const running = quoteDeliveryClock(entry(), now);
    expect(running.running).toBe(true);
    expect(running.hours).toBe(12);
  });

  it('runs the acknowledgement clock even after a quote exists, if never acknowledged', () => {
    // The two clocks are independent. Quoting without acknowledging is a
    // process failure worth still being able to see.
    const clock = acknowledgementClock(
      entry({ quotedAt: '2026-08-31T18:00:00Z' }),
      now,
    );
    expect(clock.running).toBe(true);
  });

  it('computes age from SUPPLIED instants, never a clock read', () => {
    // Rendering the queue twice from the same data must be identical.
    expect(ageHours('2026-08-31T08:00:00Z', '2026-08-31T20:00:00Z')).toBe(12);
    expect(ageHours('2026-08-31T08:00:00Z', '2026-08-31T08:59:00Z')).toBe(0);
  });

  it('refuses unparseable or out-of-order instants', () => {
    expect(() => ageHours('not-a-date', '2026-08-31T08:00:00Z')).toThrow(QueueError);
    expect(() => ageHours('2026-08-31T20:00:00Z', '2026-08-31T08:00:00Z')).toThrow(
      /cannot be negative/,
    );
  });
});
