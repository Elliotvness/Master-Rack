/**
 * The undo ledger.
 *
 * **The command is the undo unit** (ADR-018 rule 2). One completed drag is one
 * entry, not one per pointer move, and undo replays inverses through the same
 * `apply` every edit goes through — so nothing can be undone by a path that
 * skips validation.
 *
 * The ledger holds *commands*, not document snapshots. That is what makes it
 * the same list as the audit log at a different altitude: a snapshot stack can
 * restore a state but cannot say what happened, and "what happened" is the
 * thing a revision history is for.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { StudioDocument } from './document.js';
import type { IdCounter } from './ids.js';
import { apply, type Command, type CommandResult } from './commands.js';

/** One reversible step. `redo` re-applies it; `undo` reverses it. */
export interface LedgerEntry {
  readonly label: string;
  readonly redo: Command;
  readonly undo: Command;
}

export interface Ledger {
  readonly entries: readonly LedgerEntry[];
  /** How many entries are currently applied. Undo moves it down, redo up. */
  readonly depth: number;
}

export const EMPTY_LEDGER: Ledger = Object.freeze({ entries: [], depth: 0 });

/** The whole editable state: a document, its id counter and its history. */
export interface Session {
  readonly document: StudioDocument;
  readonly counter: IdCounter;
  readonly ledger: Ledger;
}

export interface SessionRefused {
  readonly ok: false;
  readonly msg: string;
}

export interface SessionOk {
  readonly ok: true;
  readonly session: Session;
  readonly label: string;
}

export type SessionResult = SessionOk | SessionRefused;

export const canUndo = (l: Ledger): boolean => l.depth > 0;
export const canRedo = (l: Ledger): boolean => l.depth < l.entries.length;

/** What the undo control should say, or null when there is nothing to undo. */
export function undoLabel(l: Ledger): string | null {
  return canUndo(l) ? (l.entries[l.depth - 1] as LedgerEntry).label : null;
}

export function redoLabel(l: Ledger): string | null {
  return canRedo(l) ? (l.entries[l.depth] as LedgerEntry).label : null;
}

/**
 * Run a command and record it.
 *
 * A refusal records nothing. That matters: a ledger that holds failed attempts
 * makes undo ambiguous — the user presses it expecting the last thing that
 * *happened* to reverse, not the last thing they *tried*.
 *
 * A new command after an undo **discards the redo tail**, which is the standard
 * and the honest behaviour: the branch that was undone is no longer reachable
 * from the current document, and keeping it would offer a redo that could not
 * apply.
 */
export function dispatch(session: Session, command: Command): SessionResult {
  const result: CommandResult = apply(session.document, session.counter, command);
  if (!result.ok) return { ok: false, msg: result.msg };

  const kept = session.ledger.entries.slice(0, session.ledger.depth);
  const entry: LedgerEntry = { label: result.label, redo: command, undo: result.inverse };

  return {
    ok: true,
    label: result.label,
    session: {
      document: result.document,
      counter: result.counter,
      ledger: { entries: [...kept, entry], depth: kept.length + 1 },
    },
  };
}

/**
 * Undo one step.
 *
 * The inverse goes through `apply`, so an inverse that cannot apply refuses
 * loudly instead of corrupting the document. That should never happen — it
 * would mean an inverse and its command disagree — and the property test over
 * random command sequences is what makes "should never" mean something.
 */
export function undo(session: Session): SessionResult {
  if (!canUndo(session.ledger)) return { ok: false, msg: 'Nothing to undo.' };
  const entry = session.ledger.entries[session.ledger.depth - 1] as LedgerEntry;

  const result = apply(session.document, session.counter, entry.undo);
  if (!result.ok) {
    return {
      ok: false,
      msg:
        `Undo failed: ${result.msg} This is a defect, not a user error — an inverse that ` +
        `cannot apply means the command and its inverse disagree. The document is unchanged.`,
    };
  }

  return {
    ok: true,
    label: `Undo ${entry.label}`,
    session: {
      document: result.document,
      // The counter does NOT rewind. Ids already minted stay spent, so two
      // different entities can never share an id within one document's history
      // — which would leave the audit log describing both under one name.
      counter: result.counter,
      /**
       * The entry's `redo` is REPLACED by the inverse this undo just produced,
       * and that is what makes redo exact.
       *
       * Replaying the original *intent* does not work with a monotonic counter:
       * re-running `addRun` mints a fresh id, so the redone document is
       * structurally identical to the one before the undo and not equal to it,
       * and any selection or finding still naming the original run is left
       * dangling. Two tests caught precisely that.
       *
       * The inverse of the undo is not an intent, it is the recorded *effect* —
       * `replaceRuns` carrying the actual `Run`, ids and all — so replaying it
       * restores exactly what was there. Redo does the same for `undo` in the
       * other direction, so the pair stays symmetric however far the history is
       * walked.
       */
      ledger: {
        entries: session.ledger.entries.map((e, i) =>
          i === session.ledger.depth - 1 ? { ...e, redo: result.inverse } : e,
        ),
        depth: session.ledger.depth - 1,
      },
    },
  };
}

export function redo(session: Session): SessionResult {
  if (!canRedo(session.ledger)) return { ok: false, msg: 'Nothing to redo.' };
  const entry = session.ledger.entries[session.ledger.depth] as LedgerEntry;

  const result = apply(session.document, session.counter, entry.redo);
  if (!result.ok) return { ok: false, msg: `Redo failed: ${result.msg}` };

  return {
    ok: true,
    label: `Redo ${entry.label}`,
    session: {
      document: result.document,
      counter: result.counter,
      // The recorded inverse is replaced by the one this replay produced. They
      // should be identical; taking the fresh one means a redo whose ids differ
      // still has an inverse that names what actually happened.
      ledger: {
        entries: session.ledger.entries.map((e, i) =>
          i === session.ledger.depth ? { ...e, undo: result.inverse } : e,
        ),
        depth: session.ledger.depth + 1,
      },
    },
  };
}
