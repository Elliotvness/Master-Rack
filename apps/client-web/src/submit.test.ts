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
    contentJson: '{"schema_version":1,"units":"mm"}',
    manifestJson: '{"schema_version":1,"units":"mm","author":"u","at":"t"}',
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
    // Since D-03 there are two hashes, so this names which one. An empty
    // CONTENT hash has its own case in the D-03 block below.
    const { effects, calls } = recorder({
      hash: async (json) => (json.includes('author') ? '   ' : 'sha256:content'),
    });
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

describe('D-03 — the content hash and the manifest hash are two hashes with two jobs', () => {
  /**
   * A hash that depends on its input's CONTENT, not its length.
   *
   * A length-based stub passed the first draft of the second test below while
   * hashing two different manifests identically — the stub reproduced the very
   * defect under test. A test double has to be at least as discriminating as
   * the thing it stands in for.
   */
  const digest = async (json: string): Promise<string> => {
    let h = 2166136261;
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `sha256:${(h >>> 0).toString(16)}`;
  };

  it('freezes the revision with the CONTENT hash and puts the MANIFEST hash on the submission', async () => {
    const seen: Record<string, string> = {};
    const { effects } = recorder({
      hash: digest,
      freezeRevision: async (_id, h) => {
        seen.frozenWith = h;
      },
      persistDerived: async (h) => {
        seen.derivedWith = h;
      },
      createSubmission: async (i) => {
        seen.submissionWith = i.manifestHash;
        return 'sha256:submission';
      },
    });

    const result = await submit(input(), effects);

    // §7.4's content hash answers "did this edit change anything?"; §13.2's
    // manifest hash deliberately covers lineage, actor and time. Conflating
    // them is D-03, and every test passed while it was conflated because the
    // WRONG value was computed reproducibly.
    expect(result.contentHash).not.toBe(result.manifestHash);
    expect(seen.frozenWith).toBe(result.contentHash);
    expect(seen.derivedWith).toBe(result.contentHash);
    expect(seen.submissionWith).toBe(result.manifestHash);
  });

  it('gives two revisions with identical content the SAME content hash and DIFFERENT manifest hashes', async () => {
    // The test that would have caught this. Same configuration, saved by two
    // people at two times: the same thing, recorded twice.
    const content = '{"schema_version":1,"units":"mm","bays":12}';
    const run = async (author: string, at: string) => {
      const { effects } = recorder(
        { hash: digest },
        derivation({
          contentJson: content,
          manifestJson: `{"content":${content},"author":"${author}","at":"${at}"}`,
        }),
      );
      return submit(input({ submittedBy: author, submittedAt: at }), effects);
    };

    const a = await run('user-1', '2026-08-31T12:00:00Z');
    const b = await run('user-2', '2026-09-01T09:30:00Z');

    expect(a.contentHash).toBe(b.contentHash);
    expect(a.manifestHash).not.toBe(b.manifestHash);
  });

  it('refuses an empty content hash as loudly as an empty manifest hash', async () => {
    const { effects } = recorder({ hash: async (json) => (json.includes('author') ? 'sha256:m' : '   ') });
    await expect(submit(input(), effects)).rejects.toThrow(SubmitError);
  });
});
