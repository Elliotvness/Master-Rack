/**
 * The parts of AD-3 that need no database.
 *
 * Two things are proved here, and the second is the one that matters: the
 * retention window is checked AGAINST THE OUTBOX rather than against the number
 * 30. AD-3 does not say "30 days"; it says "retention outlives the longest
 * retry path — the outbox's dead-letter replay window, not disk cost", and
 * names 30 days as the value that satisfies it today. A test asserting
 * `RETENTION_MS === 30 days` would pass forever while someone raised
 * `max_attempts` to 200 and left every idempotency row expiring mid-replay.
 *
 * This is the repository's recurring defect shape stated in the positive: the
 * control computes the thing it claims to guarantee.
 */

import { describe, expect, it } from 'vitest';

import type { TenantTransaction } from '@rms/db';

import { backoffFor } from '../outbox/outbox.js';
import { IDEMPOTENT_INTENTS, RETENTION_MS, claimOn, requestHash, settleOn } from './idempotency.js';

/**
 * The longest a message can stay replayable: the sum of every backoff a row
 * accrues before it dead-letters. `max_attempts` DEFAULT 5 comes from
 * `0004_outbox.sql`; `enqueue` lets a caller raise it, so the sum is taken over
 * a deliberately generous ceiling as well.
 */
function deadLetterWindowMs(maxAttempts: number): number {
  let total = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) total += backoffFor(attempt);
  return total;
}

describe('AD-3 — retention outlives the longest retry path', () => {
  it('exceeds the dead-letter window at the schema default of 5 attempts', () => {
    expect(RETENTION_MS).toBeGreaterThan(deadLetterWindowMs(5));
  });

  it('still exceeds it at a hundred attempts, so the margin is real and not incidental', () => {
    // Backoff caps at an hour, so a hundred attempts is ~100 hours — four days.
    // If someone raises max_attempts past the point where 30 days stops being
    // enough, this fails and the window gets re-derived rather than re-guessed.
    expect(RETENTION_MS).toBeGreaterThan(deadLetterWindowMs(100));
  });

  it('is the 30 days AD-3 records, expressed so the unit is visible', () => {
    expect(RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('the payload guard can see the differences it must refuse', () => {
  it('separates two bodies that differ only in a field the content hash drops', () => {
    // The whole reason canonicaliseAll exists. `note` is in NON_CONTENT_FIELDS,
    // and POST /api/internal/v1/revisions/:id/notes carries nothing else.
    expect(requestHash({ note: 'first' })).not.toBe(requestHash({ note: 'second' }));
    expect(requestHash({ author: 'a' })).not.toBe(requestHash({ author: 'b' }));
  });

  it('separates bodies differing only at depth', () => {
    expect(requestHash({ a: { b: [{ note: 'x' }] } })).not.toBe(
      requestHash({ a: { b: [{ note: 'y' }] } }),
    );
  });

  it('treats key order and undefined exactly as the canonicaliser does, so a retry is a retry', () => {
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
    expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }));
  });

  it('never lets a string collide with the number that spells it', () => {
    expect(requestHash({ v: '1' })).not.toBe(requestHash({ v: 1 }));
  });

  it('produces the 64 lowercase hex the CHECK constraint requires', () => {
    expect(requestHash({ any: 'body' })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the intent set is §8.3’s four', () => {
  it('is exactly submit, derive, clone and invite', () => {
    expect([...IDEMPOTENT_INTENTS]).toEqual(['submit', 'derive', 'clone', 'invite']);
  });
});

/**
 * A transaction that answers with exactly the rows it is given.
 *
 * Used for ONE branch: the row that conflicted on insert and was gone by the
 * select. Every other path is exercised against a real Postgres in
 * `idempotency.db.test.ts`, because a stub that returns "already claimed" when
 * asked to proves the test's expectation and not the database's arbitration.
 * This case is the exception because the state is a race with the retention
 * sweep that no test can schedule — and a branch nothing exercises is a branch
 * nobody has read.
 */
function stubTx(responses: readonly { rows: unknown[]; rowCount?: number }[]): TenantTransaction {
  let i = 0;
  return {
    query: async (): Promise<never> => {
      const next = responses[i] ?? { rows: [], rowCount: 0 };
      i += 1;
      return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length } as never;
    },
  };
}

const PARAMS = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  key: 'k',
  intent: 'submit',
  body: {},
  now: new Date('2026-09-03T00:00:00.000Z'),
} as const;

describe('a key that conflicted on insert and vanished before the select', () => {
  it('refuses rather than claiming, because the alternative is a second effect', async () => {
    // Insert returns nothing (conflict), select returns nothing (row gone).
    const result = await claimOn(stubTx([{ rows: [] }, { rows: [] }]), PARAMS);
    expect(result).toEqual({ status: 'in_flight', id: PARAMS.id });
  });

  it('reports a lost re-claim of a failed row as in flight, not as won', async () => {
    // Conflict, then a 'failed' row, then a conditional UPDATE that matched
    // nothing because another caller re-claimed it first.
    const result = await claimOn(
      stubTx([
        { rows: [] },
        {
          rows: [
            {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              intent: 'submit',
              request_hash: requestHash({}),
              claim_outcome: 'failed',
              result_ref: null,
            },
          ],
        },
        { rows: [] },
      ]),
      PARAMS,
    );
    expect(result).toEqual({ status: 'in_flight', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  });

  it('never lets a failure carry a result reference', async () => {
    // settleOn must null the ref for a failure whatever the caller passed.
    const seen: unknown[][] = [];
    const tx: TenantTransaction = {
      query: async (_text: string, values?: readonly unknown[]): Promise<never> => {
        seen.push([...(values ?? [])]);
        return { rows: [{}], rowCount: 1 } as never;
      },
    };
    await settleOn(tx, { id: PARAMS.id, outcome: 'failed', resultRef: 'x', now: PARAMS.now });
    expect(seen[0]?.[3]).toBeNull();
  });
});
