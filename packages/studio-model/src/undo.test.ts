import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { V1Document } from './document.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';
import {
  EMPTY_LEDGER,
  canRedo,
  canUndo,
  dispatch,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type Session,
  type SessionOk,
} from './undo.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

function session(): Session {
  const { document, counter } = migrateV1ToV2(V1);
  return { document, counter, ledger: EMPTY_LEDGER };
}

/** Dispatch and assert it landed, so a test cannot pass by refusing. */
function step(s: Session, command: Parameters<typeof dispatch>[1]): Session {
  const r = dispatch(s, command);
  if (!r.ok) throw new Error(`expected ${command.type} to land: ${r.msg}`);
  return r.session;
}

describe('a fresh session', () => {
  it('can neither undo nor redo, and says so', () => {
    const s = session();
    expect(canUndo(s.ledger)).toBe(false);
    expect(canRedo(s.ledger)).toBe(false);
    expect(undoLabel(s.ledger)).toBeNull();
    expect(redoLabel(s.ledger)).toBeNull();
    expect(undo(s).ok).toBe(false);
    expect(redo(s).ok).toBe(false);
  });
});

describe('one command, one ledger entry', () => {
  it('records the command with a readable label', () => {
    const s = step(session(), { type: 'addRun' });
    expect(s.ledger.entries).toHaveLength(1);
    expect(s.ledger.depth).toBe(1);
    expect(undoLabel(s.ledger)).toBe('Add Run 4');
  });

  /**
   * A ledger holding failed attempts makes undo ambiguous: the user presses it
   * expecting the last thing that HAPPENED to reverse, not the last thing they
   * tried.
   */
  it('records nothing for a refusal', () => {
    const s = session();
    const r = dispatch(s, { type: 'deleteBay', bayId: 'bay_nope' });
    expect(r.ok).toBe(false);
    expect(s.ledger.entries).toHaveLength(0);
  });
});

describe('undo and redo return to the same documents', () => {
  it('undo restores the previous document exactly', () => {
    const s0 = session();
    const before = JSON.stringify(s0.document);
    const s1 = step(s0, { type: 'addRun' });
    const back = undo(s1) as SessionOk;
    expect(back.ok).toBe(true);
    expect(JSON.stringify(back.session.document)).toBe(before);
  });

  it('redo re-applies it exactly', () => {
    const s1 = step(session(), { type: 'addRun' });
    const after = JSON.stringify(s1.document);
    const back = (undo(s1) as SessionOk).session;
    const forward = (redo(back) as SessionOk).session;
    expect(JSON.stringify(forward.document)).toBe(after);
  });

  it('walks a multi-step history back to the start and forward again', () => {
    const s0 = session();
    const start = JSON.stringify(s0.document);
    let s = s0;
    s = step(s, { type: 'addRun' });
    s = step(s, { type: 'appendBay', runId: s.document.runs[0]!.id });
    s = step(s, { type: 'toggleLock', bayId: s.document.runs[0]!.bays[0]!.id });
    const end = JSON.stringify(s.document);

    for (let i = 0; i < 3; i += 1) s = (undo(s) as SessionOk).session;
    expect(JSON.stringify(s.document)).toBe(start);
    expect(canUndo(s.ledger)).toBe(false);

    for (let i = 0; i < 3; i += 1) s = (redo(s) as SessionOk).session;
    expect(JSON.stringify(s.document)).toBe(end);
    expect(canRedo(s.ledger)).toBe(false);
  });

  it('labels the undo and redo with the command they reverse or repeat', () => {
    const s = step(session(), { type: 'addRun' });
    expect((undo(s) as SessionOk).label).toBe('Undo Add Run 4');
    const back = (undo(s) as SessionOk).session;
    expect(redoLabel(back.ledger)).toBe('Add Run 4');
  });
});

describe('the counter does not rewind on undo', () => {
  /**
   * A rewound counter would let a redo hand an id that was already minted to a
   * new entity, while a reference to the original could still be live in a
   * selection, a finding or an audit event.
   */
  it('an id spent by an undone command stays spent', () => {
    const s0 = session();
    const s1 = step(s0, { type: 'appendBay', runId: s0.document.runs[0]!.id });
    const back = (undo(s1) as SessionOk).session;
    expect(back.counter.next).toBeGreaterThanOrEqual(s1.counter.next);

    const again = step(back, { type: 'appendBay', runId: back.document.runs[0]!.id });
    const first = s1.document.runs[0]!.bays.at(-1)!.id;
    const second = again.document.runs[0]!.bays.at(-1)!.id;
    expect(second).not.toBe(first);
  });
});

describe('a new command after an undo discards the redo tail', () => {
  it('drops the branch that is no longer reachable', () => {
    const s0 = session();
    let s = step(s0, { type: 'addRun' });
    s = (undo(s) as SessionOk).session;
    expect(canRedo(s.ledger)).toBe(true);

    s = step(s, { type: 'appendBay', runId: s.document.runs[0]!.id });
    expect(canRedo(s.ledger)).toBe(false);
    expect(s.ledger.entries).toHaveLength(1);
    expect(undoLabel(s.ledger)).toMatch(/Add bay/);
  });
});

describe('a split and its undo leave no orphan', () => {
  /**
   * The bug the property test found. `splitRun` makes two runs from one, so its
   * inverse must remove BOTH; an inverse that removed only the head restored
   * the parent and left the tail behind, and the run count came back wrong.
   */
  it('restores the run count and the parent run', () => {
    const s0 = session();
    const runsBefore = s0.document.runs.length;
    const s1 = step(s0, { type: 'splitRun', bayId: s0.document.runs[0]!.bays[5]!.id });
    expect(s1.document.runs).toHaveLength(runsBefore + 1);

    const back = (undo(s1) as SessionOk).session;
    expect(back.document.runs).toHaveLength(runsBefore);
    expect(JSON.stringify(back.document)).toBe(JSON.stringify(s0.document));
  });
});

describe('an aisle change moves several runs and undoes all of them', () => {
  it('restores every y it moved', () => {
    const s0 = session();
    const ys = s0.document.runs.map((r) => r.y);
    const s1 = step(s0, {
      type: 'setAisleAfter',
      runId: s0.document.runs[0]!.id,
      frameToFrame: IN(200),
    });
    expect(s1.document.runs.map((r) => r.y)).not.toEqual(ys);
    const back = (undo(s1) as SessionOk).session;
    expect(back.document.runs.map((r) => r.y)).toEqual(ys);
  });
});

describe('undo goes through apply, so a bad inverse refuses rather than corrupting', () => {
  it('reports a defect in words when an inverse cannot apply', () => {
    const s0 = session();
    const s1 = step(s0, { type: 'addRun' });
    // Forge a ledger whose inverse cannot apply, which is what a command and
    // its inverse disagreeing would look like from the outside.
    const broken: Session = {
      ...s1,
      ledger: {
        ...s1.ledger,
        entries: [
          {
            ...(s1.ledger.entries[0] as (typeof s1.ledger.entries)[number]),
            undo: { type: 'deleteRun', runId: 'run_nope' },
          },
        ],
      },
    };
    const r = undo(broken);
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/This is a defect, not a user error/);
    expect((r as { msg: string }).msg).toMatch(/document is unchanged/);
  });
});

describe('a redo that cannot apply refuses rather than corrupting', () => {
  it('reports the refusal', () => {
    const s0 = session();
    const s1 = step(s0, { type: 'addRun' });
    const back = (undo(s1) as SessionOk).session;
    const broken: Session = {
      ...back,
      ledger: {
        ...back.ledger,
        entries: [
          {
            ...(back.ledger.entries[0] as (typeof back.ledger.entries)[number]),
            redo: { type: 'deleteRun', runId: 'run_nope' },
          },
        ],
      },
    };
    const r = redo(broken);
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/Redo failed/);
  });
});
