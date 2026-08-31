import { describe, expect, it } from 'vitest';

import { each } from '@rms/kernel-units';

import {
  BomError,
  FOOTPLATE_REASON,
  ROW_SPACER_REASON,
  WIRE_DECK_REASON,
  anchorQty,
  beamQty,
  canonicalBom,
  categoryTotal,
  deriveBom,
  deriveRunBom,
  frameQty,
  resolvedLine,
  uncataloguedLines,
  unconfirmedLines,
  unresolvedLine,
  unresolvedLines,
  type PartRef,
  type RunTakeoff,
} from './index.js';

const catalogRef: PartRef = { kind: 'catalog', partRevisionId: 'pr-1' };
const usedRef: PartRef = {
  kind: 'uncatalogued',
  uncataloguedPartId: 'u-1',
  measuredGeometry: '3" x 1.625" step beam, 96" long',
};

function run(over: Partial<RunTakeoff> = {}): RunTakeoff {
  return {
    runId: 'run-1',
    bays: 10,
    rows: 2,
    beamLevels: 3,
    frameRef: catalogRef,
    beamRef: catalogRef,
    anchorRef: catalogRef,
    deckRef: catalogRef,
    spacerRef: catalogRef,
    footplateRef: catalogRef,
    ...over,
  };
}

describe('AC-13 \u2014 a line is a quantity or a reason, never both and never neither', () => {
  it('makes the third state unrepresentable, not merely refused', () => {
    // The discriminated union is the control. A resolved line has a quantity
    // and a null reason; an unresolved line has the reverse. There is no way to
    // construct an object with both, or with neither, that the type accepts.
    const r = resolvedLine({
      category: 'FRAME',
      partRef: catalogRef,
      qty: each(22),
      uom: 'EA',
      ruleText: 'frames = (bays + 1) x rows',
      ruleId: 'BOM-FRAME-COUNT',
      confirmed: true,
      sourceObjectIds: ['run-1'],
    });
    expect(r.resolved).toBe(true);
    expect(r.qty).not.toBeNull();
    expect(r.unresolvedReason).toBeNull();

    const u = unresolvedLine({
      category: 'DECK',
      partRef: catalogRef,
      uom: 'EA',
      ruleText: 'wire deck count',
      ruleId: null,
      sourceObjectIds: ['run-1'],
      reason: WIRE_DECK_REASON,
    });
    expect(u.resolved).toBe(false);
    expect(u.qty).toBeNull();
    expect(u.unresolvedReason).not.toBeNull();
  });

  it('refuses an unresolved line with no reason', () => {
    expect(() =>
      unresolvedLine({
        category: 'DECK',
        partRef: catalogRef,
        uom: 'EA',
        ruleText: 'deck count',
        ruleId: null,
        sourceObjectIds: [],
        reason: '   ',
      }),
    ).toThrow(/must state WHY the quantity could not be established/);
  });

  it('refuses any line that cannot name the rule that produced it', () => {
    expect(() =>
      resolvedLine({
        category: 'FRAME',
        partRef: catalogRef,
        qty: each(1),
        uom: 'EA',
        ruleText: '  ',
        ruleId: null,
        confirmed: true,
        sourceObjectIds: [],
      }),
    ).toThrow(/must carry the rule that produced it/);
    expect(() =>
      unresolvedLine({
        category: 'DECK',
        partRef: catalogRef,
        uom: 'EA',
        ruleText: '',
        ruleId: null,
        sourceObjectIds: [],
        reason: 'because',
      }),
    ).toThrow(/must carry the rule that produced it/);
  });

  it('refuses a negative quantity', () => {
    expect(() =>
      resolvedLine({
        category: 'FRAME',
        partRef: catalogRef,
        qty: each(-1),
        uom: 'EA',
        ruleText: 'frames',
        ruleId: null,
        confirmed: true,
        sourceObjectIds: [],
      }),
    ).toThrow(BomError);
  });

  it('never marks an unresolved line as confirmed', () => {
    // There is no established rule behind it — that is why it is unresolved.
    const u = unresolvedLine({
      category: 'SPACER',
      partRef: catalogRef,
      uom: 'EA',
      ruleText: 'row spacers',
      ruleId: null,
      sourceObjectIds: [],
      reason: ROW_SPACER_REASON,
    });
    expect(u.confirmed).toBe(false);
  });
});

describe('the three established quantity rules', () => {
  it('counts frames as (bays + 1) x rows \u2014 back-to-back rows do NOT share frames', () => {
    // The +1 is where estimates go wrong, and the non-sharing is the piece of
    // institutional knowledge that exists nowhere else in the reference trees.
    expect(frameQty(10, 1)).toBe(11);
    expect(frameQty(10, 2)).toBe(22); // NOT 21: two rows back-to-back is 11 + 11
    expect(frameQty(1, 1)).toBe(2);
  });

  it('asserts the n+1 property from both ends, not just by example', () => {
    for (const bays of [1, 2, 5, 20, 82]) {
      for (const rows of [1, 2, 4]) {
        expect(frameQty(bays, rows) - bays * rows).toBe(rows);
      }
    }
  });

  it('counts a pair of beams per level', () => {
    expect(beamQty(10, 3, 2)).toBe(120);
    expect(beamQty(10, 3, 1)).toBe(60);
    // A run with no beam levels has no beams, and that is not an error.
    expect(beamQty(10, 0, 2)).toBe(0);
  });

  it('counts four anchors per frame, as verified against a delivered job', () => {
    // 3,812 / 953 = 4.000 exactly.
    expect(anchorQty(953)).toBe(3812);
    expect(anchorQty(0)).toBe(0);
  });

  it('treats an empty run as empty rather than as one frame', () => {
    expect(frameQty(0, 2)).toBe(0);
    expect(frameQty(10, 0)).toBe(0);
  });

  it('refuses a fractional or negative count rather than rounding it', () => {
    expect(() => frameQty(1.5, 1)).toThrow(BomError);
    expect(() => frameQty(-1, 1)).toThrow(/non-negative integer/);
    expect(() => beamQty(1, -1, 1)).toThrow(BomError);
    expect(() => anchorQty(2.5)).toThrow(BomError);
  });
});

describe('the unresolved register is a feature, not a gap', () => {
  it('emits wire decks UNRESOLVED and adopts none of the three formulas', () => {
    const lines = deriveRunBom(run());
    const deck = lines.find((l) => l.category === 'DECK');
    expect(deck?.resolved).toBe(false);
    expect(deck?.qty).toBeNull();
    // All three conflicting formulas are NAMED, so a future reader cannot
    // "restore" one believing it was lost by accident.
    expect(deck?.unresolvedReason).toMatch(/len >= 132/);
    expect(deck?.unresolvedReason).toMatch(/ceil\(len\/60\)/);
    expect(deck?.unresolvedReason).toMatch(/1\.14 per bay/);
    // And the reason says what would resolve it: a register, not a complaint.
    expect(deck?.unresolvedReason).toMatch(/Resolved by/);
  });

  it('emits row spacers and footplates UNRESOLVED with what would close them', () => {
    const lines = deriveRunBom(run());
    for (const category of ['SPACER', 'FOOTPLATE']) {
      const line = lines.find((l) => l.category === category);
      expect(line?.resolved).toBe(false);
      expect(line?.unresolvedReason).toMatch(/Resolved by/);
    }
    expect(ROW_SPACER_REASON).toMatch(/live defect/);
    expect(FOOTPLATE_REASON).toMatch(/slab condition/);
  });

  it('lists every unresolved line for the register', () => {
    const lines = deriveRunBom(run());
    const unresolved = unresolvedLines(lines);
    expect(unresolved.map((l) => l.category)).toEqual(['DECK', 'SPACER', 'FOOTPLATE']);
  });

  it('contributes nothing to a category total rather than counting as zero', () => {
    const lines = deriveRunBom(run());
    // Frames resolve, so they total. Decks do not resolve, so there is no
    // total at all — null, never 0, which would read as "none required".
    expect(categoryTotal(lines, 'FRAME')?.value).toBe(22);
    expect(categoryTotal(lines, 'DECK')).toBeNull();
    expect(categoryTotal(lines, 'ACCESSORY')).toBeNull();
  });
});

describe('uncatalogued material yields a quantity but never a capacity', () => {
  it('counts uncatalogued frames exactly as it counts catalog ones', () => {
    // The COUNT is geometry and is as reliable either way. This is a normal
    // output, not a degraded one.
    const lines = deriveRunBom(run({ frameRef: usedRef }));
    const frame = lines.find((l) => l.category === 'FRAME');
    expect(frame?.resolved).toBe(true);
    expect(frame?.qty?.value).toBe(22);
    expect(frame?.partRef.kind).toBe('uncatalogued');
  });

  it('carries measured geometry and has no capacity field at all', () => {
    const lines = deriveRunBom(run({ frameRef: usedRef }));
    const [uncat] = uncataloguedLines(lines);
    expect(uncat?.partRef.kind === 'uncatalogued' ? uncat.partRef.measuredGeometry : '').toMatch(
      /step beam/,
    );
    // Absent by schema, not blank by convention: no code path can populate it.
    expect(Object.keys(uncat?.partRef ?? {})).not.toContain('capacity');
  });

  it('reports lines resting on an unestablished rule separately', () => {
    const line = resolvedLine({
      category: 'ACCESSORY',
      partRef: catalogRef,
      qty: each(4),
      uom: 'EA',
      ruleText: 'observed on one job',
      ruleId: null,
      confirmed: false,
      sourceObjectIds: ['run-1'],
    });
    expect(unconfirmedLines([line])).toHaveLength(1);
    expect(unconfirmedLines(deriveRunBom(run()))).toHaveLength(0);
  });
});

describe('AC-12 \u2014 the BOM regenerates byte-identically from the revision alone', () => {
  it('produces identical bytes on repeated derivation', () => {
    expect(canonicalBom(deriveBom([run()]))).toBe(canonicalBom(deriveBom([run()])));
  });

  it('does not depend on the order the caller listed source objects', () => {
    // Source ids are sorted, so a caller walking its own structures in a
    // different order cannot change a stored hash.
    const a = resolvedLine({
      category: 'FRAME',
      partRef: catalogRef,
      qty: each(1),
      uom: 'EA',
      ruleText: 'r',
      ruleId: null,
      confirmed: true,
      sourceObjectIds: ['b', 'a', 'c'],
    });
    const b = resolvedLine({
      category: 'FRAME',
      partRef: catalogRef,
      qty: each(1),
      uom: 'EA',
      ruleText: 'r',
      ruleId: null,
      confirmed: true,
      sourceObjectIds: ['c', 'b', 'a'],
    });
    expect(canonicalBom([a])).toBe(canonicalBom([b]));
    expect(a.sourceObjectIds).toEqual(['a', 'b', 'c']);
  });

  it('changes the bytes when a quantity changes, so the guarantee is not vacuous', () => {
    expect(canonicalBom(deriveBom([run({ bays: 10 })]))).not.toBe(
      canonicalBom(deriveBom([run({ bays: 11 })])),
    );
  });

  it('distinguishes an unresolved line from a resolved one in the canonical form', () => {
    const lines = deriveBom([run()]);
    expect(canonicalBom(lines)).toMatch(/UNRESOLVED:/);
  });

  it('preserves run order across a multi-run revision', () => {
    const lines = deriveBom([run({ runId: 'A' }), run({ runId: 'B' })]);
    expect(lines).toHaveLength(12);
    expect(lines[0]?.sourceObjectIds).toEqual(['A']);
    expect(lines[6]?.sourceObjectIds).toEqual(['B']);
  });

  it('refuses a duplicate run id rather than silently double-counting', () => {
    expect(() => deriveBom([run({ runId: 'A' }), run({ runId: 'A' })])).toThrow(
      /duplicate run id 'A'/,
    );
  });

  it('serialises an uncatalogued reference distinctly from a catalog one', () => {
    const withUsed = canonicalBom(deriveBom([run({ frameRef: usedRef })]));
    const withCatalog = canonicalBom(deriveBom([run()]));
    expect(withUsed).toMatch(/uncatalogued:u-1/);
    expect(withUsed).not.toBe(withCatalog);
  });
});

describe('the derived run BOM as a whole', () => {
  it('produces the six MVP categories in a fixed order', () => {
    expect(deriveRunBom(run()).map((l) => l.category)).toEqual([
      'FRAME',
      'BEAM',
      'ANCHOR',
      'DECK',
      'SPACER',
      'FOOTPLATE',
    ]);
  });

  it('derives the delivered-job arithmetic end to end', () => {
    // 10 bays, 2 rows, 3 levels: 22 frames, 120 beams, 88 anchors.
    const lines = deriveRunBom(run());
    expect(categoryTotal(lines, 'FRAME')?.value).toBe(22);
    expect(categoryTotal(lines, 'BEAM')?.value).toBe(120);
    expect(categoryTotal(lines, 'ANCHOR')?.value).toBe(88);
  });

  it('carries the rule text every line was produced by', () => {
    for (const line of deriveRunBom(run())) {
      expect(line.ruleText.trim()).not.toBe('');
    }
  });

  it('refuses a malformed run outright', () => {
    expect(() => deriveRunBom(run({ bays: -1 }))).toThrow(BomError);
    expect(() => deriveRunBom(run({ beamLevels: 1.5 }))).toThrow(BomError);
    expect(() => deriveRunBom(run({ rows: -2 }))).toThrow(BomError);
  });

  it('handles an empty revision without inventing lines', () => {
    expect(deriveBom([])).toEqual([]);
    expect(canonicalBom([])).toBe('');
  });

  it('freezes what it returns', () => {
    const lines = deriveRunBom(run());
    expect(Object.isFrozen(lines)).toBe(true);
    expect(Object.isFrozen(lines[0])).toBe(true);
  });
});
