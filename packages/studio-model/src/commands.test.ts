import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { apply, type Command } from './commands.js';
import { bayTypeForRun, locateBay, runOf, type StudioDocument, type V1Document } from './document.js';
import { counterOf, type IdCounter } from './ids.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

function start(): { doc: StudioDocument; counter: IdCounter } {
  const { document, counter } = migrateV1ToV2(V1);
  return { doc: document, counter };
}

/** Apply and assert success, so a test that meant to edit cannot pass by refusing. */
function must(doc: StudioDocument, counter: IdCounter, command: Command) {
  const r = apply(doc, counter, command);
  if (!r.ok) throw new Error(`expected ${command.type} to succeed, got: ${r.msg}`);
  return r;
}

describe('a command never mutates the document it is given', () => {
  it('leaves the input untouched on success', () => {
    const { doc, counter } = start();
    const before = JSON.stringify(doc);
    must(doc, counter, { type: 'addRun' });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('leaves the input untouched on refusal', () => {
    const { doc, counter } = start();
    const before = JSON.stringify(doc);
    const r = apply(doc, counter, { type: 'deleteBay', bayId: 'bay_nope' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('deleteBay', () => {
  it('removes one bay', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const r = must(doc, counter, { type: 'deleteBay', bayId: run.bays[3]!.id });
    expect(runOf(r.document, run.id)!.bays).toHaveLength(run.bays.length - 1);
  });

  it('refuses the last bay in a run and says what to do instead', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    let d = doc;
    let c = counter;
    // Down to one bay.
    for (let i = 0; i < 11; i += 1) {
      const only = runOf(d, run.id)!.bays[0]!;
      const r = must(d, c, { type: 'deleteBay', bayId: only.id });
      d = r.document;
      c = r.counter;
    }
    const last = runOf(d, run.id)!.bays[0]!;
    const r = apply(d, c, { type: 'deleteBay', bayId: last.id });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/Delete the run instead/);
  });

  it('refuses a locked bay and says to unlock it', () => {
    const { doc, counter } = start();
    const bayId = doc.runs[0]!.bays[2]!.id;
    const locked = must(doc, counter, { type: 'toggleLock', bayId });
    const r = apply(locked.document, locked.counter, { type: 'deleteBay', bayId });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/Unlock it first/);
  });
});

describe('insertBayAfter and appendBay mint fresh ids', () => {
  it('inserts directly after the named bay', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const r = must(doc, counter, { type: 'insertBayAfter', bayId: run.bays[0]!.id });
    const bays = runOf(r.document, run.id)!.bays;
    expect(bays).toHaveLength(13);
    expect(bays[0]!.id).toBe(run.bays[0]!.id);
    expect(bays[1]!.id).not.toBe(run.bays[1]!.id);
  });

  it('never reuses an id already in the document', () => {
    const { doc, counter } = start();
    const existing = new Set(doc.runs.flatMap((r) => r.bays.map((b) => b.id)));
    const r = must(doc, counter, { type: 'appendBay', runId: doc.runs[0]!.id });
    const added = runOf(r.document, doc.runs[0]!.id)!.bays.at(-1)!;
    expect(existing.has(added.id)).toBe(false);
    expect(counterOf(added.id)).toBeGreaterThan(counter.next);
  });

  it('advances the counter it returns', () => {
    const { doc, counter } = start();
    const r = must(doc, counter, { type: 'appendBay', runId: doc.runs[0]!.id });
    expect(r.counter.next).toBe(counter.next + 1);
  });
});

describe('splitRun', () => {
  it('refuses at the first and last bay', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    for (const bayId of [run.bays[0]!.id, run.bays.at(-1)!.id]) {
      const r = apply(doc, counter, { type: 'splitRun', bayId });
      expect(r.ok).toBe(false);
      expect((r as { msg: string }).msg).toMatch(/interior bay/);
    }
  });

  it('splits into two runs whose bays sum to the original', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const r = must(doc, counter, { type: 'splitRun', bayId: run.bays[5]!.id });
    expect(r.document.runs).toHaveLength(4);
    const [a, b] = [r.document.runs[0]!, r.document.runs[1]!];
    expect(a.bays.length + b.bays.length).toBe(run.bays.length);
    expect(a.name).toBe('Run 1A');
    expect(b.name).toBe('Run 1B');
  });

  /**
   * D-B in the as-built artifact: the tail was placed at `run.x + i * 0`, so
   * both halves sat on top of each other and the aisle derivation reported a
   * negative frame-to-frame gap.
   */
  it('places the tail at the split, not on top of the parent (D-B)', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const bt = bayTypeForRun(doc, run)!;
    const r = must(doc, counter, { type: 'splitRun', bayId: run.bays[5]!.id });
    const tail = r.document.runs[1]!;
    expect(tail.x).toBe(run.x + 5 * (bt.beamLength + bt.uprightWidth));
    expect(tail.x).toBeGreaterThan(r.document.runs[0]!.x);
  });

  it('refuses when the run references a bay type that is not present', () => {
    const { doc, counter } = start();
    const broken = { ...doc, runs: doc.runs.map((r) => ({ ...r, bayTypeId: 'bt_gone' })) };
    const r = apply(broken, counter, { type: 'splitRun', bayId: doc.runs[0]!.bays[5]!.id });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/not in this document/);
  });
});

describe('deleteRun', () => {
  it('refuses the last run', () => {
    let { doc, counter } = start();
    for (const id of doc.runs.slice(1).map((r) => r.id)) {
      const r = must(doc, counter, { type: 'deleteRun', runId: id });
      doc = r.document;
      counter = r.counter;
    }
    const r = apply(doc, counter, { type: 'deleteRun', runId: doc.runs[0]!.id });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/at least one run/);
  });

  it('refuses a run containing a locked bay', () => {
    const { doc, counter } = start();
    const run = doc.runs[1]!;
    const locked = must(doc, counter, { type: 'toggleLock', bayId: run.bays[0]!.id });
    const r = apply(locked.document, locked.counter, { type: 'deleteRun', runId: run.id });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/locked bays/);
  });
});

describe('setAisleAfter', () => {
  it('moves the runs below and leaves the named run where it is', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const r = must(doc, counter, { type: 'setAisleAfter', runId: run.id, frameToFrame: IN(150) });
    expect(runOf(r.document, run.id)!.y).toBe(run.y);
    expect(runOf(r.document, doc.runs[1]!.id)!.y).not.toBe(doc.runs[1]!.y);
  });

  it('produces exactly the requested clear gap', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const bt = bayTypeForRun(doc, run)!;
    const want = IN(150);
    const r = must(doc, counter, { type: 'setAisleAfter', runId: run.id, frameToFrame: want });
    const depth = run.backToBack ? bt.frameDepth * 2 + run.rowSpacer : bt.frameDepth;
    expect(runOf(r.document, doc.runs[1]!.id)!.y - (run.y + depth)).toBe(want);
  });

  it('refuses when there is no run below', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'setAisleAfter', runId: doc.runs.at(-1)!.id, frameToFrame: IN(150) });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/No aisle after/);
  });

  it('refuses a negative or fractional width rather than clamping', () => {
    const { doc, counter } = start();
    for (const bad of [-1, 1.5]) {
      const r = apply(doc, counter, { type: 'setAisleAfter', runId: doc.runs[0]!.id, frameToFrame: bad });
      expect(r.ok).toBe(false);
    }
  });
});

describe('beam levels — the four the prototype edited straight into DOC', () => {
  it('sets one level', () => {
    const { doc, counter } = start();
    const bt = doc.bayTypes[0]!;
    const r = must(doc, counter, { type: 'setBeamLevel', bayTypeId: bt.id, index: 0, top: IN(55) });
    expect(r.document.bayTypes[0]!.beamLevels[0]).toBe(IN(55));
  });

  it('refuses a level that would break the ascending order', () => {
    const { doc, counter } = start();
    const bt = doc.bayTypes[0]!;
    const r = apply(doc, counter, { type: 'setBeamLevel', bayTypeId: bt.id, index: 0, top: IN(200) });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/must ascend/);
  });

  it('refuses two levels at the same elevation', () => {
    const { doc, counter } = start();
    const bt = doc.bayTypes[0]!;
    const r = apply(doc, counter, {
      type: 'setBeamLevels',
      bayTypeId: bt.id,
      levels: [IN(60), IN(60)],
    });
    expect(r.ok).toBe(false);
  });

  it('adds a level in order rather than appending out of order', () => {
    const { doc, counter } = start();
    const bt = doc.bayTypes[0]!;
    const r = must(doc, counter, { type: 'addBeamLevel', bayTypeId: bt.id, top: IN(90) });
    const levels = r.document.bayTypes[0]!.beamLevels;
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels).toContain(IN(90));
  });

  it('refuses to delete the only level', () => {
    const { doc, counter } = start();
    const bt = doc.bayTypes[0]!;
    const one = must(doc, counter, { type: 'setBeamLevels', bayTypeId: bt.id, levels: [IN(60)] });
    const r = apply(one.document, one.counter, { type: 'deleteBeamLevel', bayTypeId: bt.id, index: 0 });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/at least one beam level/);
  });

  it('refuses an unknown bay type', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'addBeamLevel', bayTypeId: 'bt_nope', top: IN(90) });
    expect(r.ok).toBe(false);
  });
});

/* ── the property: every command's inverse restores the document ───────── */

/**
 * An arbitrary command that makes sense for the document it is applied to.
 *
 * Generated from the LIVE document rather than from a fixed list, so the
 * sequence explores states no hand-written case would reach — a run that has
 * already been split, a bay that was inserted three commands ago.
 */
function arbitraryCommand(doc: StudioDocument): fc.Arbitrary<Command> {
  const bayIds = doc.runs.flatMap((r) => r.bays.map((b) => b.id));
  const runIds = doc.runs.map((r) => r.id);
  const btIds = doc.bayTypes.map((t) => t.id);

  return fc.oneof(
    fc.constantFrom(...bayIds).map((bayId): Command => ({ type: 'deleteBay', bayId })),
    fc.constantFrom(...bayIds).map((bayId): Command => ({ type: 'insertBayAfter', bayId })),
    fc.constantFrom(...bayIds).map((bayId): Command => ({ type: 'toggleLock', bayId })),
    fc.constantFrom(...bayIds).map((bayId): Command => ({ type: 'splitRun', bayId })),
    fc.constantFrom(...runIds).map((runId): Command => ({ type: 'appendBay', runId })),
    fc.constantFrom(...runIds).map((runId): Command => ({ type: 'deleteRun', runId })),
    fc.constant<Command>({ type: 'addRun' }),
    fc
      .tuple(fc.constantFrom(...runIds), fc.integer({ min: 60, max: 240 }))
      .map(([runId, inches]): Command => ({ type: 'setAisleAfter', runId, frameToFrame: IN(inches) })),
    fc
      .tuple(fc.constantFrom(...btIds), fc.integer({ min: 6, max: 300 }))
      .map(([bayTypeId, inches]): Command => ({ type: 'addBeamLevel', bayTypeId, top: IN(inches) })),
  );
}

describe('every applied command is invertible', () => {
  /**
   * The acceptance criterion from build-plan S2.2, as a property rather than a
   * handful of examples: apply a random sequence, then walk the inverses back,
   * and the document must be exactly what it started as.
   *
   * Refusals are skipped rather than counted as failures — a refusal changes
   * nothing, so it has nothing to invert. What is asserted is that at least
   * some commands land, so a run where everything refused cannot pass silently.
   */
  it('a random sequence of commands undoes to the starting document', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 12 }), fc.nat(), (seeds, salt) => {
        const { doc: initial, counter: c0 } = start();
        const before = JSON.stringify(initial);

        let doc = initial;
        let counter = c0;
        const inverses: Command[] = [];
        let applied = 0;

        for (const seed of seeds) {
          const command = fc.sample(arbitraryCommand(doc), { numRuns: 1, seed: seed + salt })[0]!;
          const r = apply(doc, counter, command);
          if (!r.ok) continue;
          doc = r.document;
          counter = r.counter;
          inverses.push(r.inverse);
          applied += 1;
        }

        if (applied === 0) return true;

        for (const inverse of [...inverses].reverse()) {
          const r = apply(doc, counter, inverse);
          expect(r.ok, `inverse ${inverse.type} refused: ${(r as { msg?: string }).msg ?? ''}`).toBe(
            true,
          );
          if (!r.ok) return false;
          doc = r.document;
          counter = r.counter;
        }

        expect(JSON.stringify(doc)).toBe(before);
        return true;
      }),
      { numRuns: 120 },
    );
  });

  it('the property is not vacuous — the generator does produce applicable commands', () => {
    const { doc, counter } = start();
    const commands = fc.sample(arbitraryCommand(doc), { numRuns: 40, seed: 7 });
    const ok = commands.filter((c) => apply(doc, counter, c).ok).length;
    expect(ok).toBeGreaterThan(10);
  });
});

describe('locateBay and runOf do not fall back to a plausible wrong answer', () => {
  it('a dangling bay type returns undefined rather than bayTypes[0]', () => {
    const { doc } = start();
    const broken = { ...doc, runs: [{ ...doc.runs[0]!, bayTypeId: 'bt_gone' }] };
    expect(bayTypeForRun(broken, broken.runs[0]!)).toBeUndefined();
  });

  it('an unknown bay id locates nothing', () => {
    const { doc } = start();
    expect(locateBay(doc, 'bay_nope')).toBeUndefined();
  });
});

describe('beam-level validation refuses every bad shape', () => {
  it.each([
    ['zero', 0],
    ['negative', -1000],
    ['fractional', 1500.5],
  ])('refuses a %s elevation', (_name, bad) => {
    const { doc, counter } = start();
    const r = apply(doc, counter, {
      type: 'setBeamLevels',
      bayTypeId: doc.bayTypes[0]!.id,
      levels: [bad],
    });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/whole, positive/);
  });

  it('names which level is wrong', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, {
      type: 'setBeamLevels',
      bayTypeId: doc.bayTypes[0]!.id,
      levels: [IN(60), -5],
    });
    expect((r as { msg: string }).msg).toMatch(/Level 2/);
  });

  it('a delete that would break the invariant surfaces the refusal, not a stale label', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'deleteBeamLevel', bayTypeId: 'bt_nope', index: 0 });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toBe('Bay type not found.');
  });

  it('refuses setBeamLevel and deleteBeamLevel at a position that does not exist', () => {
    const { doc, counter } = start();
    const id = doc.bayTypes[0]!.id;
    for (const command of [
      { type: 'setBeamLevel' as const, bayTypeId: id, index: 99, top: IN(60) },
      { type: 'deleteBeamLevel' as const, bayTypeId: id, index: 99 },
    ]) {
      const r = apply(doc, counter, command);
      expect(r.ok).toBe(false);
      expect((r as { msg: string }).msg).toMatch(/no beam level at that position/);
    }
  });

  it('deletes a level when more than one remains', () => {
    const { doc, counter } = start();
    const id = doc.bayTypes[0]!.id;
    const r = must(doc, counter, { type: 'deleteBeamLevel', bayTypeId: id, index: 1 });
    expect(r.document.bayTypes[0]!.beamLevels).toHaveLength(2);
    expect(r.label).toMatch(/Delete beam level 2/);
  });

  it('setBeamLevel refuses an unknown bay type', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'setBeamLevel', bayTypeId: 'bt_nope', index: 0, top: IN(60) });
    expect(r.ok).toBe(false);
  });

  it('setBeamLevels refuses an unknown bay type', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'setBeamLevels', bayTypeId: 'bt_nope', levels: [IN(60)] });
    expect(r.ok).toBe(false);
  });
});

describe('the remaining refusals', () => {
  it('restoreBay and removeBayAt refuse an unknown run', () => {
    const { doc, counter } = start();
    const bay = doc.runs[0]!.bays[0]!;
    for (const command of [
      { type: 'restoreBay' as const, runId: 'run_nope', index: 0, bay },
      { type: 'removeBayAt' as const, runId: 'run_nope', index: 0 },
    ]) {
      expect(apply(doc, counter, command).ok).toBe(false);
    }
  });

  it('restoreBay and removeBayAt refuse a position outside the run', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    expect(apply(doc, counter, { type: 'restoreBay', runId: run.id, index: 999, bay: run.bays[0]! }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'removeBayAt', runId: run.id, index: 999 }).ok).toBe(false);
  });

  it('appendBay, insertBayAfter and toggleLock refuse what they cannot find', () => {
    const { doc, counter } = start();
    expect(apply(doc, counter, { type: 'appendBay', runId: 'run_nope' }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'insertBayAfter', bayId: 'bay_nope' }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'toggleLock', bayId: 'bay_nope' }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'splitRun', bayId: 'bay_nope' }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'deleteRun', runId: 'run_nope' }).ok).toBe(false);
  });

  it('addRun refuses a document with no bay type rather than inventing one', () => {
    const { doc, counter } = start();
    const r = apply({ ...doc, bayTypes: [] }, counter, { type: 'addRun' });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/no bay type/);
  });

  it('addRun on an empty layout places the first run at the origin', () => {
    const { doc, counter } = start();
    const r = must({ ...doc, runs: [] }, counter, { type: 'addRun' });
    expect(r.document.runs[0]!.y).toBe(0);
    expect(r.document.runs[0]!.name).toBe('Run 1');
  });

  it('setAisleAfter refuses an unknown run and a dangling bay type', () => {
    const { doc, counter } = start();
    expect(apply(doc, counter, { type: 'setAisleAfter', runId: 'run_nope', frameToFrame: IN(150) }).ok).toBe(false);
    const broken = { ...doc, runs: doc.runs.map((r) => ({ ...r, bayTypeId: 'bt_gone' })) };
    expect(apply(broken, counter, { type: 'setAisleAfter', runId: doc.runs[0]!.id, frameToFrame: IN(150) }).ok).toBe(false);
  });

  it('setAisleAfter refuses a no-op rather than recording an empty edit', () => {
    const { doc, counter } = start();
    const run = doc.runs[0]!;
    const bt = bayTypeForRun(doc, run)!;
    const current = doc.runs[1]!.y - (run.y + bt.frameDepth * 2 + run.rowSpacer);
    const r = apply(doc, counter, { type: 'setAisleAfter', runId: run.id, frameToFrame: current });
    expect(r.ok).toBe(false);
    expect((r as { msg: string }).msg).toMatch(/already that width/);
  });

  it('setRunPositions refuses an unknown run', () => {
    const { doc, counter } = start();
    const r = apply(doc, counter, { type: 'setRunPositions', positions: [{ runId: 'run_nope', y: 0 }] });
    expect(r.ok).toBe(false);
  });

  it('replaceRuns refuses a run it cannot find and a position outside the layout', () => {
    const { doc, counter } = start();
    expect(apply(doc, counter, { type: 'replaceRuns', index: 0, remove: ['run_nope'], insert: [] }).ok).toBe(false);
    expect(apply(doc, counter, { type: 'replaceRuns', index: 99, remove: [], insert: [] }).ok).toBe(false);
  });

  it('replaceRuns is its own inverse', () => {
    const { doc, counter } = start();
    const before = JSON.stringify(doc);
    const removed = doc.runs[1]!;
    const r = must(doc, counter, { type: 'replaceRuns', index: 1, remove: [removed.id], insert: [] });
    expect(r.document.runs).toHaveLength(2);
    const back = must(r.document, r.counter, r.inverse);
    expect(JSON.stringify(back.document)).toBe(before);
  });
});

describe('the shapes the default fixture does not contain', () => {
  it('edits the named bay type when a document has several', () => {
    const { doc, counter } = start();
    const first = doc.bayTypes[0]!;
    const second = { ...first, id: 'bt_zz01', name: 'Type B' };
    const two = { ...doc, bayTypes: [first, second] };
    const r = must(two, counter, { type: 'addBeamLevel', bayTypeId: second.id, top: IN(90) });
    expect(r.document.bayTypes[0]!.beamLevels).toEqual(first.beamLevels);
    expect(r.document.bayTypes[1]!.beamLevels).toContain(IN(90));
  });

  /**
   * Every run in the fixture is back-to-back, so the single-row depth — frame
   * depth alone, with no row spacer — was never exercised. An aisle measured
   * against the wrong depth is off by a whole second frame.
   */
  it('measures a single-row run by one frame depth, not two plus a spacer', () => {
    const { doc, counter } = start();
    const single = { ...doc, runs: doc.runs.map((r) => ({ ...r, backToBack: false })) };
    const run = single.runs[0]!;
    const bt = bayTypeForRun(single, run)!;
    const want = IN(150);
    const r = must(single, counter, { type: 'setAisleAfter', runId: run.id, frameToFrame: want });
    expect(runOf(r.document, single.runs[1]!.id)!.y - (run.y + bt.frameDepth)).toBe(want);
  });
});
