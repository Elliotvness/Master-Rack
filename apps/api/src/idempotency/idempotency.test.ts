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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { TenantTransaction } from '@rms/db';

import { backoffFor } from '../outbox/outbox.js';
import {
  IDEMPOTENT_INTENTS,
  RETENTION_MS,
  DEFAULT_CLAIM_LEASE_MINUTES,
  claimLeaseMs,
  claimOn,
  errorCodeFor,
  requestHash,
  settleOn,
  tryRequestHash,
} from './idempotency.js';

/**
 * The schema's own `max_attempts` default, READ FROM THE MIGRATION.
 *
 * The first draft of this file hardcoded 5 and 100, and adversarial review
 * planted `DEFAULT 5000` in `0004_outbox.sql` — a ~208-day window against a
 * 30-day retention — and watched all three assertions stay green. A control
 * that names a variable and then hardcodes it is this repository's recurring
 * defect wearing the docstring of its own remedy.
 */
function schemaMaxAttempts(): number {
  const sql = readFileSync(
    fileURLToPath(new URL('../../../../packages/db/migrations/0004_outbox.sql', import.meta.url)),
    'utf8',
  );
  const match = /max_attempts\s+integer\s+NOT NULL\s+DEFAULT\s+(\d+)/i.exec(sql);
  if (match?.[1] === undefined) {
    // A migration this cannot parse must fail the test, never silently score
    // the default it hoped for. A skip is a pass.
    throw new Error('could not read max_attempts from 0004_outbox.sql');
  }
  return Number(match[1]);
}

/**
 * The longest a message can stay replayable: the sum of every backoff a row
 * accrues before it dead-letters. Both inputs come from the code under
 * guarantee — `backoffFor` from the outbox module, `maxAttempts` from the
 * migration — so raising either one moves this number.
 */
function deadLetterWindowMs(maxAttempts: number): number {
  let total = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) total += backoffFor(attempt);
  return total;
}

describe('AD-3 — retention outlives the longest retry path', () => {
  it('exceeds the dead-letter window at whatever the schema currently defaults to', () => {
    expect(RETENTION_MS).toBeGreaterThan(deadLetterWindowMs(schemaMaxAttempts()));
  });

  it('exceeds it with an order of magnitude of headroom, so the margin is not incidental', () => {
    // A caller may raise max_attempts per message; `enqueue` allows it. Ten
    // times the schema default is the headroom this retention window buys, and
    // when it stops being enough this fails rather than quietly under-retaining.
    expect(RETENTION_MS).toBeGreaterThan(deadLetterWindowMs(schemaMaxAttempts() * 10));
  });

  it('reads a real number out of the migration rather than falling back to one', () => {
    expect(schemaMaxAttempts()).toBeGreaterThan(0);
  });

  it('is the 30 days AD-3 records, expressed so the unit is visible', () => {
    expect(RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  /**
   * Stated rather than left for the next reader to discover: `backoffFor` caps
   * at one hour, so the window grows linearly past attempt 7 and this
   * guarantee breaks at roughly 726 attempts. The first assertion is what
   * notices — it is not a bound anyone has to remember.
   *
   * Also honest about the quantity: nothing in the outbox replays a `dead`
   * message today, so "dead-letter replay window" is measured as time-to-dead,
   * which is the conservative direction.
   */
  it('breaks, and says so, once the attempt count outruns the window', () => {
    expect(RETENTION_MS).toBeLessThan(deadLetterWindowMs(1000));
  });
});

describe('every outcome carries the status code the acceptance criteria name', () => {
  it('maps the two refusals onto AD-2’s codes and lets the two successes through', () => {
    expect(errorCodeFor('mismatch')).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(errorCodeFor('in_flight')).toBe('IDEMPOTENCY_IN_FLIGHT');
    expect(errorCodeFor('unhashable')).toBe('MALFORMED_REQUEST');
    expect(errorCodeFor('claimed')).toBeNull();
    expect(errorCodeFor('settled')).toBeNull();
  });
});

describe('a body the canonicaliser refuses is a refusal, not a 500', () => {
  it('reports negative zero instead of throwing out of the guard', async () => {
    // -0 survives JSON.parse and a numeric DTO, so this is one character in a
    // client-controlled field. Review turned it into an unhandled 500.
    const result = await claimOn(stubTx([]), { ...PARAMS, body: JSON.parse('{"qty":-0}') });
    expect(result.status).toBe('unhashable');
  });

  it('reports a body nested past the canonical depth bound', async () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i += 1) deep = { deep };
    const result = await claimOn(stubTx([]), { ...PARAMS, body: deep });
    expect(result.status).toBe('unhashable');
  });

  it('never swallows an error that is not the canonicaliser’s', () => {
    const exploding = {
      get boom(): never {
        throw new TypeError('not a canonical error');
      },
    };
    expect(() => tryRequestHash(exploding)).toThrow(TypeError);
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
    await settleOn(tx, { id: PARAMS.id, epoch: 1, outcome: 'failed', resultRef: 'x', now: PARAMS.now });
    expect(seen[0]?.[3]).toBeNull();
  });
});

describe('CLAIM_LEASE_MINUTES — configurable, and it refuses rather than falls back', () => {
  it('defaults to the ten minutes EL chose when unset or blank', () => {
    expect(claimLeaseMs({})).toBe(DEFAULT_CLAIM_LEASE_MINUTES * 60_000);
    expect(claimLeaseMs({ CLAIM_LEASE_MINUTES: '' })).toBe(10 * 60_000);
    expect(claimLeaseMs({ CLAIM_LEASE_MINUTES: '   ' })).toBe(10 * 60_000);
  });

  it('takes a positive whole number of minutes', () => {
    expect(claimLeaseMs({ CLAIM_LEASE_MINUTES: '30' })).toBe(30 * 60_000);
    expect(claimLeaseMs({ CLAIM_LEASE_MINUTES: '1' })).toBe(60_000);
  });

  it('THROWS on anything else rather than quietly running a lease nobody chose', () => {
    // The point of the whole rule: a setting that ignores what it was given is
    // a control that says it is configurable and is not.
    for (const bad of ['ten', '0', '-5', '2.5', 'NaN', 'Infinity', '10min']) {
      expect(() => claimLeaseMs({ CLAIM_LEASE_MINUTES: bad })).toThrow(RangeError);
    }
  });

  it('names the offending value, so the failure is actionable at startup', () => {
    expect(() => claimLeaseMs({ CLAIM_LEASE_MINUTES: 'ten' })).toThrow(/'ten'/);
  });
});
