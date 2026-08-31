import { describe, expect, it } from 'vitest';

import {
  SUBMIT_STEPS,
  SubmitError,
  stepsInOrder,
  submit,
  submitRefusals,
  type ClientFinding,
  type Derivation,
  type SubmitEffects,
  type SubmitInput,
} from './index.js';

function finding(severity: ClientFinding['severity'], closedBy = 'fix it'): ClientFinding {
  return { code: 'X', severity, closedBy, subjectObjectIds: [] };
}

function derivation(over: Partial<Derivation> = {}): Derivation {
  return {
    findings: [],
    assumptions: [],
    manifestJson: '{"schema_version":1}',
    ...over,
  };
}

function input(over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    revisionId: 'rev-1',
    submittedBy: 'user-1',
    submittedAt: '2026-08-31T12:00:00Z',
    assumptionsAcknowledged: true,
    disclaimerVersionId: 'disc-1',
    ...over,
  };
}

/** Records the exact order effects were invoked in. */
function recorder(over: Partial<SubmitEffects> = {}, d: Derivation = derivation()) {
  const calls: string[] = [];
  const effects: SubmitEffects = {
    rederive: async () => {
      calls.push('rederive');
      return d;
    },
    hash: async () => {
      calls.push('hash');
      return 'sha256:manifest';
    },
    freezeRevision: async () => {
      calls.push('freezeRevision');
    },
    persistDerived: async () => {
      calls.push('persistDerived');
    },
    createSubmission: async () => {
      calls.push('createSubmission');
      return 'sha256:submission';
    },
    writeAudit: async () => {
      calls.push('writeAudit');
    },
    enqueueOutbox: async () => {
      calls.push('enqueueOutbox');
    },
    ...over,
  };
  return { effects, calls };
}

describe('the submit transaction follows the published order', () => {
  it('performs all nine steps, in order', async () => {
    const { effects } = recorder();
    const result = await submit(input(), effects);
    expect(result.stepsCompleted).toEqual([...SUBMIT_STEPS]);
    expect(stepsInOrder(result.stepsCompleted)).toBe(true);
  });

  it('RE-DERIVES before it refuses, so it never checks a stale finding set', async () => {
    // Checking cached findings would let a revision submit against results
    // that no longer match its inputs — internally inconsistent from the
    // moment it froze.
    const { effects, calls } = recorder();
    await submit(input(), effects);
    expect(calls[0]).toBe('rederive');
  });

  it('FREEZES before persisting derived rows, because the rows are keyed to the hash', async () => {
    // Persisting first would key the rows to a hash that could still change.
    const { effects, calls } = recorder();
    await submit(input(), effects);
    expect(calls.indexOf('freezeRevision')).toBeLessThan(calls.indexOf('persistDerived'));
  });

  it('hashes the manifest BEFORE freezing, since the hash is what gets frozen', async () => {
    const { effects, calls } = recorder();
    await submit(input(), effects);
    expect(calls.indexOf('hash')).toBeLessThan(calls.indexOf('freezeRevision'));
  });

  it('enqueues the outbox LAST, so nothing is sent for a rolled-back transaction', async () => {
    const { effects, calls } = recorder();
    await submit(input(), effects);
    expect(calls[calls.length - 1]).toBe('enqueueOutbox');
  });

  it('writes audit events before enqueueing, in the same transaction as the change', async () => {
    const { effects, calls } = recorder();
    await submit(input(), effects);
    expect(calls.indexOf('writeAudit')).toBeLessThan(calls.indexOf('enqueueOutbox'));
  });

  it('returns both hashes for the caller to record', async () => {
    const { effects } = recorder();
    const result = await submit(input(), effects);
    expect(result.manifestHash).toBe('sha256:manifest');
    expect(result.submissionHash).toBe('sha256:submission');
  });
});

describe('AC-10 \u2014 a refusal lists EVERY reason, not the first', () => {
  it('reports every open blocker at once', () => {
    const reasons = submitRefusals(
      input(),
      derivation({
        findings: [
          finding('BLOCKER', 'Reduce the level load.'),
          finding('BLOCKER', 'Widen the aisle.'),
          finding('BLOCKER', 'Lower the top beam.'),
        ],
      }),
    );
    expect(reasons).toHaveLength(3);
  });

  it('reports blockers AND a missing acknowledgement together', () => {
    // Fixing the tick box only to discover three blockers is the round-trip
    // this ordering avoids.
    const reasons = submitRefusals(
      input({ assumptionsAcknowledged: false }),
      derivation({ findings: [finding('BLOCKER')], assumptions: ['pallet size assumed'] }),
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toBe('fix it');
    expect(reasons[1]).toMatch(/Acknowledge the assumptions/);
  });

  it('does not block on warnings, reviews, assumptions or missing inputs', () => {
    // Only a BLOCKER stops a submit. A review item is what the submission is
    // FOR; blocking on one would strand most jobs.
    expect(
      submitRefusals(
        input(),
        derivation({
          findings: [
            finding('WARNING'),
            finding('ENGINEERING_REVIEW_REQUIRED'),
            finding('MISSING_INPUT'),
            finding('ASSUMPTION'),
            finding('NOT_EVALUATED'),
            finding('PASS'),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('requires an acknowledgement only when there ARE assumptions', () => {
    expect(
      submitRefusals(input({ assumptionsAcknowledged: false }), derivation({ assumptions: [] })),
    ).toEqual([]);
  });

  it('requires the disclaimer version to be recorded', () => {
    const reasons = submitRefusals(input({ disclaimerVersionId: '  ' }), derivation());
    expect(reasons.join(' ')).toMatch(/version of the disclaimer/);
  });
});

describe('a refused submission does nothing at all', () => {
  it('stops at the refusal step and performs no effect beyond re-deriving', async () => {
    const { effects, calls } = recorder({}, derivation({ findings: [finding('BLOCKER')] }));

    await expect(submit(input(), effects)).rejects.toThrow(SubmitError);

    // It re-derived (it must, to know), and then did nothing else. No freeze,
    // no persist, no submission, no audit, no outbox.
    expect(calls).toEqual(['rederive']);
  });

  it('names the step it refused at, and carries every reason', async () => {
    const { effects } = recorder(
      {},
      derivation({ findings: [finding('BLOCKER', 'a'), finding('BLOCKER', 'b')] }),
    );
    try {
      await submit(input(), effects);
      expect.unreachable('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(SubmitError);
      expect((e as SubmitError).step).toBe('refuse_on_blockers');
      expect((e as SubmitError).reasons).toEqual(['a', 'b']);
    }
  });

  it('does not enqueue outbox work when a later step throws', async () => {
    // "If any step fails, nothing happened." A notification for a submission
    // that did not complete is the exact failure the outbox exists to prevent.
    const { effects, calls } = recorder({
      createSubmission: async () => {
        throw new Error('database refused');
      },
    });

    await expect(submit(input(), effects)).rejects.toThrow(/database refused/);
    expect(calls).not.toContain('enqueueOutbox');
    expect(calls).not.toContain('writeAudit');
  });

  it('refuses an empty manifest hash rather than freezing against nothing', async () => {
    const { effects, calls } = recorder({ hash: async () => '   ' });
    await expect(submit(input(), effects)).rejects.toThrow(/manifest hash was empty/);
    expect(calls).not.toContain('freezeRevision');
  });
});

describe('the step order is observable, so it can be defended', () => {
  it('accepts the published order', () => {
    expect(stepsInOrder([...SUBMIT_STEPS])).toBe(true);
  });

  it('accepts a prefix, which is what a refused submission produces', () => {
    expect(stepsInOrder(['rederive'])).toBe(true);
    expect(stepsInOrder(['rederive', 'refuse_on_blockers'])).toBe(true);
  });

  it('REJECTS a swapped pair', () => {
    expect(stepsInOrder(['persist_derived', 'freeze_revision'])).toBe(false);
    expect(stepsInOrder(['enqueue_outbox', 'write_audit'])).toBe(false);
  });

  it('rejects a repeated step', () => {
    expect(stepsInOrder(['freeze_revision', 'freeze_revision'])).toBe(false);
  });

  it('accepts an empty list, which is a submission that never started', () => {
    expect(stepsInOrder([])).toBe(true);
  });

  it('publishes exactly the nine steps of \u00a713.1', () => {
    expect(SUBMIT_STEPS).toHaveLength(9);
    expect(SUBMIT_STEPS[0]).toBe('rederive');
    expect(SUBMIT_STEPS[SUBMIT_STEPS.length - 1]).toBe('enqueue_outbox');
  });
});
