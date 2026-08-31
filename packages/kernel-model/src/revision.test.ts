import { describe, expect, it } from 'vitest';
import {
  TransitionRefusedError,
  UndecidedAuthorityError,
  canTransition,
  cloneToDraft,
  contentHash,
  deepFreeze,
  freeze,
  mayWaive,
  transitionRefusals,
  type Revision,
} from './index.js';

const FROZEN_AT = '2026-08-31T12:00:00.000Z';

function draft(overrides: Partial<Revision> = {}): Revision {
  return {
    id: 'rev_1',
    revision_code: 'P01',
    iteration: 1,
    lifecycle_state: 'DRAFT',
    audience: 'client',
    parent_revision_id: null,
    derived_from_revision_id: null,
    catalog_release_id: 'interlake-2026-08',
    rule_pack_release_id: 'rules-2026-08',
    content: { levels: 4, beam_span_um: 2_438_400 },
    content_hash: null,
    frozen_at: null,
    ...overrides,
  };
}

describe('permitted transitions', () => {
  it('allows DRAFT to FROZEN', () => {
    expect(canTransition(draft(), 'FROZEN')).toBe(true);
  });

  it('allows a frozen revision to be superseded or withdrawn', () => {
    const f = draft({ lifecycle_state: 'FROZEN' });
    expect(canTransition(f, 'SUPERSEDED')).toBe(true);
    expect(canTransition(f, 'WITHDRAWN')).toBe(true);
  });

  it('refuses to re-freeze a frozen revision — nobody edits a submission', () => {
    const f = draft({ lifecycle_state: 'FROZEN' });
    expect(canTransition(f, 'FROZEN')).toBe(false);
    expect(transitionRefusals(f, 'FROZEN')).toContain('the revision is already FROZEN');
  });

  it('refuses to move back to DRAFT from any state', () => {
    for (const state of ['FROZEN', 'SUPERSEDED', 'WITHDRAWN'] as const) {
      expect(canTransition(draft({ lifecycle_state: state }), 'DRAFT')).toBe(false);
    }
  });

  it('names a terminal state as terminal', () => {
    const reasons = transitionRefusals(draft({ lifecycle_state: 'SUPERSEDED' }), 'WITHDRAWN');
    expect(reasons).toContain('SUPERSEDED is a terminal state and permits no transition');
  });

  it('names the states that are permitted when one is not', () => {
    const reasons = transitionRefusals(draft(), 'SUPERSEDED');
    expect(reasons).toContain('DRAFT may only move to FROZEN');
  });
});

describe('AC-10 — a refusal lists every reason, not the first', () => {
  it('reports all open blockers at once', () => {
    const reasons = transitionRefusals(draft(), 'FROZEN', [
      'TOP_OF_LOAD_EXCEEDS_CLEAR_HEIGHT',
      'AISLE_CLEAR_SHORTFALL',
      'BEAM_FRAME_INCOMPATIBLE',
    ]);
    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual([
      'blocker TOP_OF_LOAD_EXCEEDS_CLEAR_HEIGHT is open',
      'blocker AISLE_CLEAR_SHORTFALL is open',
      'blocker BEAM_FRAME_INCOMPATIBLE is open',
    ]);
  });

  it('reports blockers and missing pins together, not one at a time', () => {
    const reasons = transitionRefusals(
      draft({ catalog_release_id: '', rule_pack_release_id: '' }),
      'FROZEN',
      ['AISLE_CLEAR_SHORTFALL'],
    );
    expect(reasons).toHaveLength(3);
    expect(reasons).toContain('no catalog release is pinned');
    expect(reasons).toContain('no rule pack release is pinned');
  });

  it('throws with every reason in the message', () => {
    expect(() => freeze(draft(), FROZEN_AT, ['A', 'B'])).toThrow(TransitionRefusedError);
    try {
      freeze(draft(), FROZEN_AT, ['A', 'B']);
      expect.unreachable('freeze should have refused');
    } catch (error) {
      const refusal = error as TransitionRefusedError;
      expect(refusal.reasons).toHaveLength(2);
      expect(refusal.message).toContain('blocker A is open');
      expect(refusal.message).toContain('blocker B is open');
    }
  });
});

describe('a refusal is itself an audit event', () => {
  it('carries the audit record on the error', () => {
    try {
      freeze(draft(), FROZEN_AT, ['AISLE_CLEAR_SHORTFALL']);
      expect.unreachable('freeze should have refused');
    } catch (error) {
      const refusal = error as TransitionRefusedError;
      expect(refusal.audit).toEqual({
        action: 'revision.frozen_refused',
        resource_type: 'revision',
        resource_id: 'rev_1',
        outcome: 'denied',
        reasons: ['blocker AISLE_CLEAR_SHORTFALL is open'],
      });
    }
  });

  it('records a successful freeze as an audit event too', () => {
    const { audit } = freeze(draft(), FROZEN_AT);
    expect(audit.action).toBe('revision.frozen');
    expect(audit.outcome).toBe('success');
    expect(audit.resource_id).toBe('rev_1');
  });
});

describe('freezing', () => {
  it('sets the state, the timestamp and the content hash', () => {
    const { revision } = freeze(draft(), FROZEN_AT);
    expect(revision.lifecycle_state).toBe('FROZEN');
    expect(revision.frozen_at).toBe(FROZEN_AT);
    expect(revision.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('takes the timestamp from the caller, never from a clock', () => {
    // Determinism: freezing the same content twice with the same stated time
    // produces byte-identical results.
    const a = freeze(draft(), FROZEN_AT).revision;
    const b = freeze(draft(), FROZEN_AT).revision;
    expect(a).toEqual(b);
  });

  it('hashes the content only, so lineage and timestamps do not change it', () => {
    const { revision } = freeze(draft(), FROZEN_AT);
    expect(revision.content_hash).toBe(contentHash(draft().content));
  });

  it('gives two revisions with identical content identical hashes', () => {
    const a = freeze(draft({ id: 'rev_1', revision_code: 'P01' }), FROZEN_AT).revision;
    const b = freeze(
      draft({ id: 'rev_2', revision_code: 'P02', parent_revision_id: 'rev_1' }),
      '2027-01-01T00:00:00.000Z',
    ).revision;
    expect(a.content_hash).toBe(b.content_hash);
  });

  it('gives different content different hashes', () => {
    const a = freeze(draft(), FROZEN_AT).revision;
    const b = freeze(draft({ content: { levels: 5, beam_span_um: 2_438_400 } }), FROZEN_AT)
      .revision;
    expect(a.content_hash).not.toBe(b.content_hash);
  });
});

describe('AC-11 — a frozen revision cannot be mutated', () => {
  it('deep freezes, so a nested write is a TypeError rather than a silent change', () => {
    const { revision } = freeze(draft(), FROZEN_AT);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.content)).toBe(true);
    expect(() => {
      (revision as { lifecycle_state: string }).lifecycle_state = 'DRAFT';
    }).toThrow(TypeError);
    expect(() => {
      (revision.content as Record<string, unknown>)['levels'] = 99;
    }).toThrow(TypeError);
  });

  it('freezes arbitrarily nested structures', () => {
    const nested = deepFreeze({ a: { b: { c: [1, { d: 2 }] } } });
    expect(Object.isFrozen(nested.a.b.c)).toBe(true);
    expect(Object.isFrozen(nested.a.b.c[1])).toBe(true);
  });

  it('leaves primitives and already-frozen objects alone', () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBe(null);
    const already = Object.freeze({ a: 1 });
    expect(deepFreeze(already)).toBe(already);
  });
});

describe('AC-14 — deriving never alters the source', () => {
  it('leaves the source revision and its hash untouched', () => {
    const source = freeze(draft(), FROZEN_AT).revision;
    const hashBefore = source.content_hash;

    const child = cloneToDraft(source, 'rev_2', 'P02');

    expect(source.content_hash).toBe(hashBefore);
    expect(source.lifecycle_state).toBe('FROZEN');
    expect(child.id).toBe('rev_2');
    expect(child.lifecycle_state).toBe('DRAFT');
  });

  it('records the lineage on the child', () => {
    const source = freeze(draft(), FROZEN_AT).revision;
    const child = cloneToDraft(source, 'rev_2', 'P02');
    expect(child.derived_from_revision_id).toBe('rev_1');
    expect(child.parent_revision_id).toBe('rev_1');
  });

  it('clears the hash and frozen timestamp on the child', () => {
    const source = freeze(draft(), FROZEN_AT).revision;
    const child = cloneToDraft(source, 'rev_2', 'P02');
    expect(child.content_hash).toBeNull();
    expect(child.frozen_at).toBeNull();
    expect(child.iteration).toBe(1);
  });

  it('can fork a client submission into a separate internal lineage', () => {
    const source = freeze(draft(), FROZEN_AT).revision;
    const internal = cloneToDraft(source, 'rev_c1', 'C01', 'internal');
    expect(internal.audience).toBe('internal');
    expect(source.audience).toBe('client');
  });

  it('inherits the pins, so a catalog change cannot alter what was submitted', () => {
    const source = freeze(draft(), FROZEN_AT).revision;
    const child = cloneToDraft(source, 'rev_2', 'P02');
    expect(child.catalog_release_id).toBe('interlake-2026-08');
    expect(child.rule_pack_release_id).toBe('rules-2026-08');
  });
});

describe('OD-09 — waiver authority is undecided, and the code says so', () => {
  it('throws naming the open decision instead of defaulting to permissive', () => {
    expect(() => mayWaive()).toThrow(UndecidedAuthorityError);
    expect(() => mayWaive()).toThrow(/OD-09/);
  });

  it('does not return false, which would silently become policy', () => {
    let returned: unknown = 'not called';
    try {
      returned = mayWaive();
    } catch {
      returned = 'threw';
    }
    expect(returned).toBe('threw');
  });
});
