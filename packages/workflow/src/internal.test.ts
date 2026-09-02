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
    // The omitted-marker shape. F-27 is fixed, so the annotation these three
    // literals once needed is gone - see the two cases above, which cover the
    // present-but-undefined and wholly-absent shapes without a cast.
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

  /**
   * F-27, written before the fix. Both shapes below are what real callers hold,
   * and NEITHER compiled against the original signature:
   *
   *   - present-but-undefined is refused under `exactOptionalPropertyTypes`,
   *     and is exactly what a row read back from Postgres with a NULL column is;
   *   - an object literal with no `clientVisible` at all is refused because
   *     `{ readonly clientVisible?: boolean }` is a WEAK TYPE - every property
   *     optional - so TypeScript rejects a literal sharing no property with it.
   *
   * The failure mode is not the type error. It is what a caller does about the
   * type error: reach for a cast. A cast around the function that decides what
   * a client may see is how AC-14 silently stops applying, and nothing goes red.
   *
   * These cases carry NO annotation and NO cast on purpose. If either is ever
   * re-added to make this file compile, the finding has been re-introduced.
   */
  it('accepts a row whose marker is present but undefined, as a NULL column is', () => {
    const rows = [
      { id: 'p1', clientVisible: undefined },
      { id: 'c1', clientVisible: false as const },
    ];
    expect(stripInternalRevisions(rows).map((r) => r.id)).toEqual(['p1']);
  });

  it('accepts an object literal with no marker at all, uncast and unannotated', () => {
    expect(stripInternalRevisions([{ id: 'p1' }, { id: 'p2' }])).toHaveLength(2);
  });

  it('keeps items that carry no visibility marker', () => {
    // The annotation is kept deliberately, and it now proves the opposite of
    // what it used to. Before F-27 it was load-bearing: without it the call did
    // not compile. Now it is optional - the case above makes the same call bare
    // - and this one stays to prove the ANNOTATED form still works, so the fix
    // widened the signature without narrowing what it already accepted.
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
