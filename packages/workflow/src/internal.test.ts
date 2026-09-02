import { describe, expect, it } from 'vitest';

import {
  DerivationError,
  deriveInternalRevision,
  internalNote,
  stripInternalRevisions,
  type SourceSubmission,
} from './index.js';

/**
 * T-08. These three suites were `apps/internal-web/src/queue.test.ts` until the
 * functions they exercise moved here. **AC-14's test is now pointed at the
 * server-side path**, which is the point of the acceptance criterion: a test
 * that kept asserting against the app bundle would keep passing while the rule
 * it names had moved somewhere it never looked.
 *
 * The bodies are unchanged from their previous location.
 */

function source(over: Partial<SourceSubmission> = {}): SourceSubmission {
  return {
    submissionId: 'sub-1',
    revisionId: 'rev-1',
    contentHash: 'sha256:abc123',
    waivers: [],
    ...over,
  };
}

describe('E-04 \u2014 deriving an internal revision', () => {
  it('leaves the source content hash unchanged', () => {
    const s = source();
    const { derived, source: after } = deriveInternalRevision(s, 'rev-2');
    expect(after.contentHash).toBe('sha256:abc123');
    expect(derived.derivedFromRevisionId).toBe('rev-1');
    expect(derived.derivedFromSubmissionId).toBe('sub-1');
  });

  it('forks into the C lineage, separate from the client P lineage', () => {
    const { derived } = deriveInternalRevision(source(), 'rev-2');
    expect(derived.code).toBe('C');
  });

  it('does NOT carry waivers over', () => {
    // A waiver is a judgement about one specific configuration. Carrying it
    // would apply a decision to a configuration nobody made it about.
    const { derived, source: after } = deriveInternalRevision(
      source({ waivers: ['aisle width waived by EL'] }),
      'rev-2',
    );
    expect(derived.waivers).toEqual([]);
    // And the source keeps its own.
    expect(after.waivers).toEqual(['aisle width waived by EL']);
  });

  it('marks the derived revision as never client-visible', () => {
    const { derived } = deriveInternalRevision(source(), 'rev-2');
    expect(derived.clientVisible).toBe(false);
  });

  it('refuses to reuse the source revision id, or an empty one', () => {
    expect(() => deriveInternalRevision(source(), 'rev-1')).toThrow(/must not reuse/);
    expect(() => deriveInternalRevision(source(), '  ')).toThrow(/needs an identifier/);
  });

  it('refuses a source with no content hash', () => {
    expect(() => deriveInternalRevision(source({ contentHash: '' }), 'rev-2')).toThrow(
      DerivationError,
    );
  });
});

describe('AC-14 \u2014 an internal revision is ABSENT from client responses, not locked', () => {
  it('removes internal items entirely', () => {
    // "Locked" tells a client something exists that they may not see, which is
    // itself information: it says we are working on a variant of their job.
    // The marker is OMITTED rather than set to `undefined`:
    // `stripInternalRevisions<T extends { readonly clientVisible?: boolean }>`
    // will not accept a present-but-undefined property under
    // `exactOptionalPropertyTypes`, though it handles that shape perfectly well
    // at runtime - and a row read back from Postgres with a NULL column is
    // exactly that shape. The signature should be `boolean | undefined`.
    // Filed for T-08, which moves this function to `packages/workflow`, rather
    // than changed here: T-08 is a pure move and its diff must stay one.
    const items = [
      { id: 'p1' },
      { id: 'c1', clientVisible: false as const },
      { id: 'p2' },
    ];
    const visible = stripInternalRevisions(items);
    expect(visible.map((i) => i.id)).toEqual(['p1', 'p2']);
  });

  it('leaves no trace of the internal item at all', () => {
    const { derived } = deriveInternalRevision(source(), 'rev-2');
    const visible = stripInternalRevisions([derived]);
    expect(visible).toEqual([]);
    expect(JSON.stringify(visible)).not.toMatch(/rev-2/);
  });

  it('keeps items that carry no visibility marker', () => {
    // The annotation is load-bearing, and it is the second half of the same
    // finding. `{ readonly clientVisible?: boolean }` is a WEAK TYPE - every
    // property optional - so TypeScript refuses an object literal that shares
    // no property with it. `stripInternalRevisions([{ id: 'p1' }])` does not
    // compile, which means the function cannot be called with the exact shape
    // this test is named for without an annotation or a cast. Filed for T-08.
    const items: readonly { readonly id: string; readonly clientVisible?: boolean }[] = [
      { id: 'p1' },
      { id: 'p2' },
    ];
    expect(stripInternalRevisions(items)).toHaveLength(2);
  });
});

describe('E-05 \u2014 an internal note is a DISTINCT ENTITY, not a flagged message', () => {
  it('is marked never client-visible by construction', () => {
    // Not the same table with a flag: a flag is one wrong default or one
    // SELECT * away from being published, and the failure is silent.
    const note = internalNote({
      id: 'n-1',
      submissionId: 'sub-1',
      authorId: 'staff-1',
      body: 'Client may accept a narrower aisle; confirm with ops.',
      createdAt: '2026-08-31T12:00:00Z',
    });
    expect(note.clientVisible).toBe(false);
  });

  it('is stripped from anything client-facing', () => {
    const note = internalNote({
      id: 'n-1',
      submissionId: 'sub-1',
      authorId: 'staff-1',
      body: 'internal only',
      createdAt: '2026-08-31T12:00:00Z',
    });
    expect(stripInternalRevisions([note])).toEqual([]);
  });

  it('refuses an empty note', () => {
    expect(() =>
      internalNote({
        id: 'n-1',
        submissionId: 'sub-1',
        authorId: 'staff-1',
        body: '   ',
        createdAt: '2026-08-31T12:00:00Z',
      }),
    ).toThrow(/must carry a body/);
  });
});
