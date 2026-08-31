import { describe, expect, it } from 'vitest';

import {
  CLOCK_NAMES,
  FORBIDDEN_STATUS_WORDING,
  SLA_BASELINE_SUBMISSIONS,
  STATUS_WORDING,
  StatusError,
  clientStatusFor,
  cloneToDraft,
  editable,
  forbiddenWordingIn,
  slaTargetsVisible,
  type InternalStatus,
  type Revision,
} from './index.js';

function frozen(over: Partial<Revision> = {}): Revision {
  return {
    id: 'rev-1',
    code: 'P',
    iteration: 1,
    frozen: true,
    contentHash: 'sha256:abc123',
    derivedFromRevisionId: null,
    ...over,
  };
}

describe('OD-12 \u2014 the client status vocabulary is coarse, deliberately', () => {
  it('collapses every mid-flight internal state into "submitted"', () => {
    // A client watching a submission move through seven internal stages learns
    // our process rather than their answer, and every transition becomes a
    // question we have to field.
    for (const internal of ['submitted', 'acknowledged', 'in_review', 'rfi_open'] as InternalStatus[]) {
      expect(clientStatusFor(internal)).toBe('submitted');
    }
  });

  it('shows only three states in total', () => {
    const all: InternalStatus[] = [
      'draft', 'submitted', 'acknowledged', 'in_review', 'rfi_open', 'quoted', 'declined',
    ];
    expect(new Set(all.map(clientStatusFor)).size).toBe(3);
  });

  it('treats quoted and declined alike as "answered"', () => {
    // Both mean the same thing to the client: we have come back to you.
    expect(clientStatusFor('quoted')).toBe('answered');
    expect(clientStatusFor('declined')).toBe('answered');
  });

  it('never leaks an internal state name to the client', () => {
    const all: InternalStatus[] = [
      'draft', 'submitted', 'acknowledged', 'in_review', 'rfi_open', 'quoted', 'declined',
    ];
    const internalOnly = ['acknowledged', 'in_review', 'rfi_open', 'quoted', 'declined'];
    for (const internal of all) {
      expect(internalOnly).not.toContain(clientStatusFor(internal));
    }
  });

  it('FAILS CLOSED on an unmapped internal state', () => {
    // Adding a lifecycle state without deciding what the client sees must be
    // an error, not a silent leak of the internal name.
    expect(() => clientStatusFor('in_legal_hold' as InternalStatus)).toThrow(StatusError);
    expect(() => clientStatusFor('in_legal_hold' as InternalStatus)).toThrow(
      /must not reach a client screen under its internal name/,
    );
  });

  it('gives every client status plain wording, with no internal vocabulary', () => {
    for (const [status, wording] of Object.entries(STATUS_WORDING)) {
      expect(wording.length).toBeGreaterThan(15);
      expect(forbiddenWordingIn(wording), `'${status}' wording must be clean`).toEqual([]);
    }
  });
});

describe('the clocks never claim an authority the product does not hold', () => {
  it('names them for what they deliver', () => {
    // Never "prelim turnaround" or "engineering review": the latter implies an
    // authority we do not hold, and it escapes into emails.
    expect(CLOCK_NAMES.acknowledgement).toBe('Acknowledgement');
    expect(CLOCK_NAMES.quoteDelivery).toBe('Quote delivery');
  });

  it('catches forbidden wording anywhere in a client string', () => {
    expect(forbiddenWordingIn('Your stamped engineering review is pending')).toContain(
      'engineering review',
    );
    expect(forbiddenWordingIn('Prelim turnaround: 1 day')).toContain('prelim turnaround');
    expect(forbiddenWordingIn('Certified by our engineer')).not.toEqual([]);
  });

  it('reports EVERY forbidden phrase, not just the first', () => {
    const problems = forbiddenWordingIn('stamped engineering review, certified');
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('passes clean wording', () => {
    expect(forbiddenWordingIn('With our team. We will come back to you.')).toEqual([]);
  });

  it('lists the phrases it forbids, so the list is reviewable', () => {
    expect(FORBIDDEN_STATUS_WORDING).toContain('engineering review');
    expect(FORBIDDEN_STATUS_WORDING).toContain('stamped');
  });
});

describe('OD-11 \u2014 SLA targets stay hidden until they are measured', () => {
  it('hides targets below the baseline', () => {
    // Showing a target before it is measured is a promise made from a guess.
    for (const n of [0, 1, 5, 9]) {
      expect(slaTargetsVisible(n)).toBe(false);
    }
  });

  it('shows them once ten live submissions have been measured', () => {
    expect(SLA_BASELINE_SUBMISSIONS).toBe(10);
    expect(slaTargetsVisible(10)).toBe(true);
    expect(slaTargetsVisible(50)).toBe(true);
  });
});

describe('cloning leaves the source byte-identical', () => {
  it('does not change the source content hash', () => {
    // The property that makes lineage checkable later. AC: "Clone leaves the
    // source content_hash byte-identical."
    const source = frozen();
    const before = source.contentHash;
    const { clone, source: after } = cloneToDraft(source, 'rev-2');

    expect(after.contentHash).toBe(before);
    expect(after.frozen).toBe(true);
    expect(after.id).toBe('rev-1');
    expect(clone.id).toBe('rev-2');
  });

  it('records what it was derived from', () => {
    const { clone } = cloneToDraft(frozen(), 'rev-2');
    expect(clone.derivedFromRevisionId).toBe('rev-1');
  });

  it('produces an EDITABLE draft with no content hash of its own', () => {
    // A new draft has not been frozen, so there is nothing to hash. Carrying
    // the source's hash would be a lie about what the draft contains.
    const { clone } = cloneToDraft(frozen(), 'rev-2');
    expect(clone.frozen).toBe(false);
    expect(clone.contentHash).toBeNull();
    expect(editable(clone)).toBe(true);
  });

  it('advances the iteration', () => {
    const { clone } = cloneToDraft(frozen({ iteration: 3 }), 'rev-2');
    expect(clone.iteration).toBe(4);
  });

  it('refuses to clone a draft', () => {
    // Two editable copies of the same unfinished work, with no way to say
    // which is current.
    expect(() => cloneToDraft(frozen({ frozen: false }), 'rev-2')).toThrow(
      /only a frozen revision may be cloned/,
    );
  });

  it('refuses a frozen revision with no content hash', () => {
    expect(() => cloneToDraft(frozen({ contentHash: null }), 'rev-2')).toThrow(
      /must carry a content hash/,
    );
    expect(() => cloneToDraft(frozen({ contentHash: '   ' }), 'rev-2')).toThrow(StatusError);
  });

  it('refuses to reuse the source id or to take an empty one', () => {
    expect(() => cloneToDraft(frozen(), 'rev-1')).toThrow(/must not reuse the source/);
    expect(() => cloneToDraft(frozen(), '  ')).toThrow(/needs an identifier/);
  });

  it('returns frozen objects, so a caller cannot mutate the record after the fact', () => {
    const { clone, source } = cloneToDraft(frozen(), 'rev-2');
    expect(Object.isFrozen(clone)).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
  });
});

describe('the UI does not offer an action the database will refuse', () => {
  it('reports a frozen revision as not editable', () => {
    // An action that always fails is worse than an absent one.
    expect(editable(frozen())).toBe(false);
    expect(editable(frozen({ frozen: false }))).toBe(true);
  });
});
