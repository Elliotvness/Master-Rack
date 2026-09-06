/**
 * The commands. The only way a document changes.
 *
 * Three differences from the prototype's `commands` object, each deliberate.
 *
 * **They are pure.** The prototype mutates `doc` in place and returns
 * `{ok, label}`. Here a command takes a document and returns a *new* one, so
 * the previous document is still intact for the undo ledger and a React store
 * can compare by reference. ADR-018 rule 4 makes the document read-only to
 * components; a mutating command makes that unenforceable.
 *
 * **Ids are threaded, not global.** The prototype's `makeId` reads module
 * state, so the ids a command mints depend on how many documents the process
 * has built. Here the counter goes in and comes out, and the same inputs always
 * produce the same ids.
 *
 * **Four of them did not exist as commands.** `setBeamLevel`, `addBeamLevel`,
 * `deleteBeamLevel` and `setField` were DOM handlers assigning straight into
 * `DOC` — `DOC.bayTypes[0].beamLevels[+t.dataset.lvl] = IN(v)`. That is exactly
 * what ADR-018 rule 1 forbids: an event handler may dispatch a command, it may
 * not compute a new document. Promoting them is what makes the undo ledger
 * complete rather than mostly complete.
 *
 * Every command returns `{ok: true, ...}` or `{ok: false, msg}`. A refusal
 * always says what would resolve it, because a refusal a user cannot act on is
 * a dead end.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import {
  bayTypeForRun,
  locateBay,
  runOf,
  type Bay,
  type BayType,
  type Run,
  type StudioDocument,
} from './document.js';
import { mintId, mintIds, type EntityId, type IdCounter } from './ids.js';
import { IN, type Micrometres } from './length.js';

/** A command that changed something. `inverse` undoes exactly this. */
export interface CommandOk {
  readonly ok: true;
  readonly document: StudioDocument;
  readonly counter: IdCounter;
  /** Human-readable, shown in the undo menu and written to the audit log. */
  readonly label: string;
  /** Applying this to `document` restores the input document. */
  readonly inverse: Command;
}

/** A command that refused. The document is unchanged — there is no partial edit. */
export interface CommandRefused {
  readonly ok: false;
  readonly msg: string;
}

export type CommandResult = CommandOk | CommandRefused;

/** A command is a named, serialisable intent. Serialisable so it can be audited. */
export type Command =
  | { readonly type: 'deleteBay'; readonly bayId: EntityId }
  | { readonly type: 'insertBayAfter'; readonly bayId: EntityId }
  | { readonly type: 'appendBay'; readonly runId: EntityId }
  | { readonly type: 'restoreBay'; readonly runId: EntityId; readonly index: number; readonly bay: Bay }
  | { readonly type: 'removeBayAt'; readonly runId: EntityId; readonly index: number }
  | { readonly type: 'toggleLock'; readonly bayId: EntityId }
  | { readonly type: 'splitRun'; readonly bayId: EntityId }
  | { readonly type: 'addRun' }
  | { readonly type: 'deleteRun'; readonly runId: EntityId }
  | {
      /**
       * Remove some runs and insert others at one index, as a single step.
       *
       * The general primitive, and it is its own inverse. It exists because a
       * `restoreRun` that only removed the run it was putting back was WRONG for
       * `splitRun`: a split makes TWO runs from one, so undoing it has to take
       * both away. The property test caught exactly that — after a split and its
       * undo, the head was restored and the orphaned tail was still in the
       * document.
       */
      readonly type: 'replaceRuns';
      readonly index: number;
      readonly remove: readonly EntityId[];
      readonly insert: readonly Run[];
    }
  | { readonly type: 'setAisleAfter'; readonly runId: EntityId; readonly frameToFrame: Micrometres }
  | { readonly type: 'setRunPositions'; readonly positions: readonly { readonly runId: EntityId; readonly y: Micrometres }[] }
  | { readonly type: 'setBeamLevel'; readonly bayTypeId: EntityId; readonly index: number; readonly top: Micrometres }
  | { readonly type: 'addBeamLevel'; readonly bayTypeId: EntityId; readonly top: Micrometres }
  | { readonly type: 'deleteBeamLevel'; readonly bayTypeId: EntityId; readonly index: number }
  | { readonly type: 'setBeamLevels'; readonly bayTypeId: EntityId; readonly levels: readonly Micrometres[] };

const refuse = (msg: string): CommandRefused => ({ ok: false, msg });

/** Replace one run, keeping order. */
function withRun(doc: StudioDocument, runId: EntityId, next: Run): StudioDocument {
  return { ...doc, runs: doc.runs.map((r) => (r.id === runId ? next : r)) };
}

/** Replace one bay type, keeping order. */
function withBayType(doc: StudioDocument, id: EntityId, next: BayType): StudioDocument {
  return { ...doc, bayTypes: doc.bayTypes.map((t) => (t.id === id ? next : t)) };
}

/* ── bays ──────────────────────────────────────────────────────────────── */

function deleteBay(doc: StudioDocument, counter: IdCounter, bayId: EntityId): CommandResult {
  const found = locateBay(doc, bayId);
  if (found === undefined) return refuse('Bay not found.');
  const { run, index } = found;

  if (run.bays.length === 1) {
    return refuse('A run must keep at least one bay. Delete the run instead.');
  }
  const bay = run.bays[index] as Bay;
  if (bay.locked) return refuse('That bay is locked. Unlock it first.');

  const bays = run.bays.filter((_, i) => i !== index);
  return {
    ok: true,
    document: withRun(doc, run.id, { ...run, bays }),
    counter,
    label: `Delete bay ${index + 1} of ${run.name}`,
    // The inverse carries the bay ITSELF, not a request to make a new one — an
    // undo that mints a fresh id would break every reference to the old one.
    inverse: { type: 'restoreBay', runId: run.id, index, bay },
  };
}

function restoreBay(
  doc: StudioDocument,
  counter: IdCounter,
  runId: EntityId,
  index: number,
  bay: Bay,
): CommandResult {
  const run = runOf(doc, runId);
  if (run === undefined) return refuse('Run not found.');
  if (index < 0 || index > run.bays.length) return refuse('That position is outside the run.');
  const bays = [...run.bays.slice(0, index), bay, ...run.bays.slice(index)];
  return {
    ok: true,
    document: withRun(doc, runId, { ...run, bays }),
    counter,
    label: `Restore bay ${index + 1} of ${run.name}`,
    inverse: { type: 'removeBayAt', runId, index },
  };
}

/** Positional removal, used only as an inverse. No lock check: undo is not an edit. */
function removeBayAt(
  doc: StudioDocument,
  counter: IdCounter,
  runId: EntityId,
  index: number,
): CommandResult {
  const run = runOf(doc, runId);
  if (run === undefined) return refuse('Run not found.');
  const bay = run.bays[index];
  if (bay === undefined) return refuse('That position is outside the run.');
  return {
    ok: true,
    document: withRun(doc, runId, { ...run, bays: run.bays.filter((_, i) => i !== index) }),
    counter,
    label: `Remove bay ${index + 1} of ${run.name}`,
    inverse: { type: 'restoreBay', runId, index, bay },
  };
}

function insertBayAfter(doc: StudioDocument, counter: IdCounter, bayId: EntityId): CommandResult {
  const found = locateBay(doc, bayId);
  if (found === undefined) return refuse('Bay not found.');
  const { run, index } = found;
  const minted = mintId(counter, 'bay');
  const bay: Bay = { id: minted.id, locked: false };
  const bays = [...run.bays.slice(0, index + 1), bay, ...run.bays.slice(index + 1)];
  return {
    ok: true,
    document: withRun(doc, run.id, { ...run, bays }),
    counter: minted.counter,
    label: `Insert bay after ${index + 1} of ${run.name}`,
    inverse: { type: 'removeBayAt', runId: run.id, index: index + 1 },
  };
}

function appendBay(doc: StudioDocument, counter: IdCounter, runId: EntityId): CommandResult {
  const run = runOf(doc, runId);
  if (run === undefined) return refuse('Run not found.');
  const minted = mintId(counter, 'bay');
  return {
    ok: true,
    document: withRun(doc, runId, { ...run, bays: [...run.bays, { id: minted.id, locked: false }] }),
    counter: minted.counter,
    label: `Add bay to ${run.name}`,
    inverse: { type: 'removeBayAt', runId, index: run.bays.length },
  };
}

function toggleLock(doc: StudioDocument, counter: IdCounter, bayId: EntityId): CommandResult {
  const found = locateBay(doc, bayId);
  if (found === undefined) return refuse('Bay not found.');
  const { run, index } = found;
  const bay = run.bays[index] as Bay;
  const bays = run.bays.map((b, i) => (i === index ? { ...b, locked: !b.locked } : b));
  return {
    ok: true,
    document: withRun(doc, run.id, { ...run, bays }),
    counter,
    label: `${bay.locked ? 'Unlock' : 'Lock'} bay in ${run.name}`,
    inverse: { type: 'toggleLock', bayId },
  };
}

/* ── runs ──────────────────────────────────────────────────────────────── */

function splitRun(doc: StudioDocument, counter: IdCounter, bayId: EntityId): CommandResult {
  const found = locateBay(doc, bayId);
  if (found === undefined) return refuse('Bay not found.');
  const { run, index } = found;
  const runIndex = doc.runs.indexOf(run);

  if (index === 0 || index === run.bays.length - 1) {
    return refuse('Split at an interior bay — a split needs bays on both sides.');
  }
  const bt = bayTypeForRun(doc, run);
  if (bt === undefined) {
    return refuse(
      `Run ${run.name} references bay type ${run.bayTypeId}, which is not in this document. ` +
        'Fix the reference before splitting.',
    );
  }

  const minted = mintId(counter, 'run');
  const head: Run = { ...run, name: `${run.name}A`, bays: run.bays.slice(0, index) };
  const tail: Run = {
    ...run,
    id: minted.id,
    name: `${run.name}B`,
    // Placed at the split, not at the parent's origin. D-B in the as-built
    // artifact put the tail at `run.x + i * 0`, so the two overlapped and the
    // aisle derivation reported a negative frame-to-frame gap.
    x: run.x + index * (bt.beamLength + bt.uprightWidth),
    bays: run.bays.slice(index),
  };

  const runs = [...doc.runs.slice(0, runIndex), head, tail, ...doc.runs.slice(runIndex + 1)];
  return {
    ok: true,
    document: { ...doc, runs },
    counter: minted.counter,
    label: `Split ${run.name} at bay ${index + 1}`,
    // Both halves go. The head kept the parent's id and the tail has a new
    // one; naming only the head leaves the tail orphaned in the document.
    inverse: {
      type: 'replaceRuns',
      index: runIndex,
      remove: [head.id, tail.id],
      insert: [run],
    },
  };
}

function addRun(doc: StudioDocument, counter: IdCounter): CommandResult {
  const bt = doc.bayTypes[0];
  if (bt === undefined) return refuse('This document has no bay type to build a run from.');

  const minted = mintId(counter, 'run');
  const bays = mintIds(minted.counter, 'bay', 12);
  const blockDepth = bt.frameDepth * 2 + IN(12);
  const lastY = doc.runs.reduce((m, r) => Math.max(m, r.y), 0);

  const run: Run = {
    id: minted.id,
    name: `Run ${doc.runs.length + 1}`,
    bayTypeId: bt.id,
    x: 0,
    y: doc.runs.length === 0 ? 0 : lastY + blockDepth + IN(132),
    backToBack: true,
    rowSpacer: IN(12),
    floorStorage: true,
    bays: bays.ids.map((id) => ({ id, locked: false })),
  };

  return {
    ok: true,
    document: { ...doc, runs: [...doc.runs, run] },
    counter: bays.counter,
    label: `Add ${run.name}`,
    inverse: { type: 'deleteRun', runId: run.id },
  };
}

function deleteRun(doc: StudioDocument, counter: IdCounter, runId: EntityId): CommandResult {
  const index = doc.runs.findIndex((r) => r.id === runId);
  if (index < 0) return refuse('Run not found.');
  if (doc.runs.length === 1) return refuse('The layout must keep at least one run.');
  const run = doc.runs[index] as Run;
  if (run.bays.some((b) => b.locked)) {
    return refuse('That run contains locked bays. Unlock them first.');
  }
  return {
    ok: true,
    document: { ...doc, runs: doc.runs.filter((_, i) => i !== index) },
    counter,
    label: `Delete ${run.name}`,
    inverse: { type: 'replaceRuns', index, remove: [], insert: [run] },
  };
}

function replaceRuns(
  doc: StudioDocument,
  counter: IdCounter,
  index: number,
  remove: readonly EntityId[],
  insert: readonly Run[],
): CommandResult {
  const removing = new Set(remove);
  const removed = doc.runs.filter((r) => removing.has(r.id));
  if (removed.length !== removing.size) {
    return refuse('One of the runs to replace is not in this document.');
  }
  const without = doc.runs.filter((r) => !removing.has(r.id));
  if (index < 0 || index > without.length) {
    return refuse('That position is outside the layout.');
  }
  const runs = [...without.slice(0, index), ...insert, ...without.slice(index)];

  return {
    ok: true,
    document: { ...doc, runs },
    counter,
    label:
      insert.length === 1 && remove.length === 0
        ? `Restore ${(insert[0] as Run).name}`
        : `Replace ${remove.length} run(s) with ${insert.length}`,
    // Its own inverse, with the two lists swapped. That symmetry is what makes
    // it correct for both `deleteRun` (remove nothing, insert one) and
    // `splitRun` (remove two, insert one).
    inverse: {
      type: 'replaceRuns',
      index,
      remove: insert.map((r) => r.id),
      insert: removed,
    },
  };
}

/**
 * Set the clear frame-to-frame aisle after a run, shifting every later run.
 *
 * The inverse is not "set it back to the old width" — the shift touches several
 * runs and re-deriving it backwards would depend on the same geometry the edit
 * just changed. It restores the y of every run that moved, which is exact.
 */
function setAisleAfter(
  doc: StudioDocument,
  counter: IdCounter,
  runId: EntityId,
  frameToFrame: Micrometres,
): CommandResult {
  const run = runOf(doc, runId);
  if (run === undefined) return refuse('Run not found.');
  if (!Number.isSafeInteger(frameToFrame) || frameToFrame < 0) {
    return refuse('An aisle width must be a whole, non-negative number of micrometres.');
  }
  const bt = bayTypeForRun(doc, run);
  if (bt === undefined) {
    return refuse(
      `Run ${run.name} references bay type ${run.bayTypeId}, which is not in this document.`,
    );
  }

  const depth = run.backToBack ? bt.frameDepth * 2 + run.rowSpacer : bt.frameDepth;
  const yEnd = run.y + depth;
  // A split sibling at the same y is beside this run, not across an aisle.
  const below = doc.runs.filter((r) => r.y >= yEnd && r.id !== run.id);
  if (below.length === 0) return refuse('No aisle after that run.');

  const nextY = Math.min(...below.map((r) => r.y));
  const delta = yEnd + frameToFrame - nextY;
  if (delta === 0) {
    return refuse(`The aisle after ${run.name} is already that width.`);
  }

  const moved = doc.runs.filter((r) => r.y >= nextY);
  const runs = doc.runs.map((r) => (r.y >= nextY ? { ...r, y: r.y + delta } : r));

  return {
    ok: true,
    document: { ...doc, runs },
    counter,
    label: `Set aisle after ${run.name}`,
    inverse: {
      type: 'setRunPositions',
      positions: moved.map((r) => ({ runId: r.id, y: r.y })),
    },
  };
}

function setRunPositions(
  doc: StudioDocument,
  counter: IdCounter,
  positions: readonly { readonly runId: EntityId; readonly y: Micrometres }[],
): CommandResult {
  const byId = new Map(positions.map((p) => [p.runId, p.y]));
  for (const id of byId.keys()) {
    if (runOf(doc, id) === undefined) return refuse(`Run ${id} not found.`);
  }
  const previous = doc.runs
    .filter((r) => byId.has(r.id))
    .map((r) => ({ runId: r.id, y: r.y }));
  const runs = doc.runs.map((r) => (byId.has(r.id) ? { ...r, y: byId.get(r.id) as number } : r));
  return {
    ok: true,
    document: { ...doc, runs },
    counter,
    label: `Move ${positions.length} run${positions.length === 1 ? '' : 's'}`,
    inverse: { type: 'setRunPositions', positions: previous },
  };
}

/* ── beam levels — promoted from DOM handlers to commands ──────────────── */

/** Levels are top-of-beam and must ascend. The invariant is checked, not assumed. */
function validLevels(levels: readonly Micrometres[]): string | null {
  for (const [i, l] of levels.entries()) {
    if (!Number.isSafeInteger(l) || l <= 0) {
      return `Level ${i + 1} must be a whole, positive number of micrometres.`;
    }
  }
  for (let i = 1; i < levels.length; i += 1) {
    if ((levels[i] as number) <= (levels[i - 1] as number)) {
      return 'Beam levels must ascend, and two levels may not share an elevation.';
    }
  }
  return null;
}

function setBeamLevels(
  doc: StudioDocument,
  counter: IdCounter,
  bayTypeId: EntityId,
  levels: readonly Micrometres[],
  label?: string,
): CommandResult {
  const bt = doc.bayTypes.find((t) => t.id === bayTypeId);
  if (bt === undefined) return refuse('Bay type not found.');
  const problem = validLevels(levels);
  if (problem !== null) return refuse(problem);
  return {
    ok: true,
    document: withBayType(doc, bayTypeId, { ...bt, beamLevels: [...levels] }),
    counter,
    label: label ?? `Set beam levels on ${bt.name}`,
    inverse: { type: 'setBeamLevels', bayTypeId, levels: bt.beamLevels },
  };
}

function setBeamLevel(
  doc: StudioDocument,
  counter: IdCounter,
  bayTypeId: EntityId,
  index: number,
  top: Micrometres,
): CommandResult {
  const bt = doc.bayTypes.find((t) => t.id === bayTypeId);
  if (bt === undefined) return refuse('Bay type not found.');
  if (bt.beamLevels[index] === undefined) return refuse('There is no beam level at that position.');
  const levels = bt.beamLevels.map((l, i) => (i === index ? top : l));
  return setBeamLevels(doc, counter, bayTypeId, levels, `Set beam level ${index + 1} on ${bt.name}`);
}

function addBeamLevel(
  doc: StudioDocument,
  counter: IdCounter,
  bayTypeId: EntityId,
  top: Micrometres,
): CommandResult {
  const bt = doc.bayTypes.find((t) => t.id === bayTypeId);
  if (bt === undefined) return refuse('Bay type not found.');
  // Inserted in order rather than appended: the ascending invariant is the
  // model's, so the command upholds it instead of refusing a reasonable edit.
  const levels = [...bt.beamLevels, top].sort((a, b) => a - b);
  return setBeamLevels(doc, counter, bayTypeId, levels, `Add a beam level to ${bt.name}`);
}

function deleteBeamLevel(
  doc: StudioDocument,
  counter: IdCounter,
  bayTypeId: EntityId,
  index: number,
): CommandResult {
  const bt = doc.bayTypes.find((t) => t.id === bayTypeId);
  if (bt === undefined) return refuse('Bay type not found.');
  if (bt.beamLevels[index] === undefined) return refuse('There is no beam level at that position.');
  if (bt.beamLevels.length === 1) {
    return refuse('A bay type must keep at least one beam level.');
  }
  const levels = bt.beamLevels.filter((_, i) => i !== index);
  return setBeamLevels(doc, counter, bayTypeId, levels, `Delete beam level ${index + 1} on ${bt.name}`);
}

/* ── the one entry point ───────────────────────────────────────────────── */

/**
 * Apply a command.
 *
 * One function rather than an object of methods, so that a command is data all
 * the way to the point it takes effect: it can be logged, replayed, sent to the
 * server and compared, and there is exactly one place that turns an intent into
 * a document.
 */
export function apply(
  doc: StudioDocument,
  counter: IdCounter,
  command: Command,
): CommandResult {
  switch (command.type) {
    case 'deleteBay':
      return deleteBay(doc, counter, command.bayId);
    case 'restoreBay':
      return restoreBay(doc, counter, command.runId, command.index, command.bay);
    case 'removeBayAt':
      return removeBayAt(doc, counter, command.runId, command.index);
    case 'insertBayAfter':
      return insertBayAfter(doc, counter, command.bayId);
    case 'appendBay':
      return appendBay(doc, counter, command.runId);
    case 'toggleLock':
      return toggleLock(doc, counter, command.bayId);
    case 'splitRun':
      return splitRun(doc, counter, command.bayId);
    case 'addRun':
      return addRun(doc, counter);
    case 'deleteRun':
      return deleteRun(doc, counter, command.runId);
    case 'replaceRuns':
      return replaceRuns(doc, counter, command.index, command.remove, command.insert);
    case 'setAisleAfter':
      return setAisleAfter(doc, counter, command.runId, command.frameToFrame);
    case 'setRunPositions':
      return setRunPositions(doc, counter, command.positions);
    case 'setBeamLevel':
      return setBeamLevel(doc, counter, command.bayTypeId, command.index, command.top);
    case 'addBeamLevel':
      return addBeamLevel(doc, counter, command.bayTypeId, command.top);
    case 'deleteBeamLevel':
      return deleteBeamLevel(doc, counter, command.bayTypeId, command.index);
    case 'setBeamLevels':
      return setBeamLevels(doc, counter, command.bayTypeId, command.levels);
  }
}
