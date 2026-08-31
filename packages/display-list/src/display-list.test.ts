import { describe, expect, it } from 'vitest';

import { VERIFY, displayText, inches, poundsPerPair, quantity } from '@rms/kernel-units';

import {
  DisplayListError,
  buildElevation,
  buildPlan,
  dimension,
  displayList,
  itemsOfKind,
  line,
  point,
  rect,
  text,
  textEntries,
  unestablishedEntries,
  type AisleGeometry,
  type RunGeometry,
} from './index.js';

const HASH = 'sha256:abc123';

function run(over: Partial<RunGeometry> = {}): RunGeometry {
  return {
    runId: 'run-1',
    offsetX: inches(0),
    offsetY: inches(0),
    bays: 3,
    bayPitch: inches(102),
    runLength: inches(312),
    frameDepth: inches(42),
    uprightFace: inches(3),
    ...over,
  };
}

function aisle(over: Partial<AisleGeometry> = {}): AisleGeometry {
  return {
    aisleId: 'aisle-1',
    offsetX: inches(0),
    offsetY: inches(42),
    length: inches(312),
    clearWidth: inches(144),
    ...over,
  };
}

const extent = { width: inches(600), height: inches(600) };

describe('AC-07 \u2014 an unestablished value never renders as a numeral', () => {
  // The governing criterion for this package: "A refusal in the engine that
  // leaks a number into the interface is not a refusal."

  it('prints VERIFY for an aisle whose clear width is not established', () => {
    const list = buildPlan({
      revisionHash: HASH,
      runs: [run()],
      aisles: [aisle({ clearWidth: null })],
      extent,
    });
    const unestablished = unestablishedEntries(list);
    expect(unestablished.length).toBeGreaterThan(0);
    for (const e of unestablished) {
      expect(e.text).toBe(VERIFY);
      // The decisive assertion: no digit anywhere in an unestablished entry.
      expect(e.text).not.toMatch(/\d/);
    }
  });

  it('still DRAWS the dimension it cannot state, rather than omitting it', () => {
    // An absent dimension reads as "not applicable", which is a different claim
    // from "not known". The witness lines are drawn; only the number is refused.
    const list = buildPlan({
      revisionHash: HASH,
      runs: [run()],
      aisles: [aisle({ clearWidth: null })],
      extent,
    });
    const dim = list.items.find((i) => i.id === 'aisle-1:dim:clear');
    expect(dim).toBeDefined();
    expect(dim?.kind).toBe('dimension');
    expect(dim?.kind === 'dimension' ? dim.text.established : true).toBe(false);
  });

  it('propagates an UNKNOWN origin from the model into VERIFY on the drawing', () => {
    // The value exists and is numerically 0, but its origin is UNKNOWN. The
    // drawing must not print 0" — that would be a claim the model never made.
    const unknown = quantity(0, 'um', 'UNKNOWN');
    const list = buildPlan({
      revisionHash: HASH,
      runs: [run({ runLength: unknown })],
      aisles: [],
      extent,
    });
    const label = list.items.find((i) => i.id === 'run-1:body');
    expect(label?.kind === 'rect' ? label.label?.established : true).toBe(false);
    expect(label?.kind === 'rect' ? label.label?.text : '').toBe(VERIFY);
  });

  it('prints VERIFY for a level with no stated load', () => {
    const list = buildElevation({
      revisionHash: HASH,
      runId: 'run-1',
      frameHeight: inches(240),
      bayPitch: inches(102),
      levels: [{ levelId: 'L1', elevation: inches(60), load: null }],
    });
    const load = list.items.find((i) => i.id === 'L1:load');
    expect(load?.kind === 'text' ? load.text.text : '').toBe(VERIFY);
    expect(load?.kind === 'text' ? load.text.established : true).toBe(false);
  });

  it('reports nothing unestablished when every value is known', () => {
    // The baseline that makes the tests above meaningful.
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [aisle()], extent });
    expect(unestablishedEntries(list)).toEqual([]);
  });

  it('carries {text, established} on every text entry, never a bare string', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [aisle()], extent });
    const entries = textEntries(list);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.text).toBe('string');
      expect(typeof e.established).toBe('boolean');
    }
  });
});

describe('the model refuses geometry that has already left model space', () => {
  it('refuses a fractional coordinate, which means someone converted to pixels early', () => {
    expect(() => point(1.5, 0)).toThrow(DisplayListError);
    expect(() => point(0, Number.NaN)).toThrow(/integer micrometre/);
  });

  it('refuses a negative rectangle dimension', () => {
    expect(() =>
      rect({ item: 'upright', id: 'r', origin: point(0, 0), width: -1, height: 10 }),
    ).toThrow(/negative dimension/);
  });

  it('refuses a display list that does not name its revision', () => {
    // A renderer pairing a display list with another revision's numbers is a
    // bug worth making detectable rather than possible.
    expect(() =>
      displayList({ view: 'plan', extent: { width: 10, height: 10 }, items: [], revisionHash: '  ' }),
    ).toThrow(/must name the revision/);
  });

  it('refuses duplicate item ids', () => {
    const a = line({ item: 'beam', id: 'dup', from: point(0, 0), to: point(1, 1) });
    expect(() =>
      displayList({ view: 'plan', extent: { width: 10, height: 10 }, items: [a, a], revisionHash: HASH }),
    ).toThrow(/duplicate display item id 'dup'/);
  });

  it('refuses a fractional extent', () => {
    expect(() =>
      displayList({ view: 'plan', extent: { width: 1.5, height: 10 }, items: [], revisionHash: HASH }),
    ).toThrow(DisplayListError);
  });

  it('refuses a quantity of the wrong dimension reaching the builder', () => {
    // A load where a length belongs. kernel-units refuses the conversion rather
    // than coercing, so the drawing layer cannot silently plot a weight as a
    // distance. (A fractional micrometre is NOT tested here because it cannot
    // exist: lengths are stored as integer micrometres and µm has scale 1.)
    expect(() =>
      buildPlan({
        revisionHash: HASH,
        runs: [run({ offsetX: poundsPerPair(5400) })],
        aisles: [],
        extent,
      }),
    ).toThrow();
  });

  it('treats an omitted label as explicitly absent, never undefined', () => {
    // A renderer switching on `label !== null` must not also have to handle
    // undefined. One absent representation, not two.
    const bare = rect({ item: 'upright', id: 'r', origin: point(0, 0), width: 10, height: 10 });
    expect(bare.kind === 'rect' ? bare.label : undefined).toBeNull();

    const labelled = rect({
      item: 'upright',
      id: 'r2',
      origin: point(0, 0),
      width: 10,
      height: 10,
      label: displayText(inches(1)),
    });
    expect(labelled.kind === 'rect' ? labelled.label?.established : false).toBe(true);
  });

  it('validates dimension and text coordinates too', () => {
    expect(() =>
      dimension({ id: 'd', from: point(0, 0), to: { x: 1.5, y: 0 }, text: displayText(inches(1)) }),
    ).toThrow(DisplayListError);
    expect(() =>
      text({ id: 't', at: { x: 0, y: 0.5 }, text: displayText(inches(1)) }),
    ).toThrow(DisplayListError);
  });
});

describe('the plan view', () => {
  it('draws n+1 uprights for n bays, not n', () => {
    // kernel-derive's rule showing up at the drawing layer. The off-by-one that
    // looks correct is the one worth asserting where a person can see it.
    const list = buildPlan({ revisionHash: HASH, runs: [run({ bays: 3 })], aisles: [], extent });
    const uprights = list.items.filter((i) => i.id.startsWith('run-1:upright:'));
    expect(uprights).toHaveLength(4);
  });

  it('scales the upright count with the bay count', () => {
    for (const bays of [1, 2, 5, 20]) {
      const list = buildPlan({ revisionHash: HASH, runs: [run({ bays })], aisles: [], extent });
      expect(list.items.filter((i) => i.id.startsWith('run-1:upright:'))).toHaveLength(bays + 1);
    }
  });

  it('carries model-space micrometres, never pixels', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [], extent });
    const body = list.items.find((i) => i.id === 'run-1:body');
    // 312" = 7,924,800 µm exactly. A renderer applies its own transform.
    expect(body?.kind === 'rect' ? body.width : 0).toBe(7_924_800);
  });

  it('groups items by kind for a renderer', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [aisle()], extent });
    expect(itemsOfKind(list, 'aisle').length).toBeGreaterThan(0);
    expect(itemsOfKind(list, 'upright').length).toBeGreaterThan(0);
    expect(itemsOfKind(list, 'no-rack-zone')).toEqual([]);
  });

  it('handles an empty layout without inventing items', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [], aisles: [], extent });
    expect(list.items).toEqual([]);
    expect(list.view).toBe('plan');
  });
});

describe('the elevation view', () => {
  it('witnesses every level from the floor datum, not from the level below', () => {
    // A chain of relative dimensions accumulates the reader's error; the
    // elevation that matters is always from the slab.
    const list = buildElevation({
      revisionHash: HASH,
      runId: 'run-1',
      frameHeight: inches(240),
      bayPitch: inches(102),
      levels: [
        { levelId: 'L1', elevation: inches(60), load: poundsPerPair(5400) },
        { levelId: 'L2', elevation: inches(120), load: poundsPerPair(5400) },
      ],
    });
    for (const id of ['L1:dim:elevation', 'L2:dim:elevation']) {
      const dim = list.items.find((i) => i.id === id);
      expect(dim?.kind === 'dimension' ? dim.from.y : -1).toBe(0);
    }
  });

  it('draws both uprights and a beam line per level', () => {
    const list = buildElevation({
      revisionHash: HASH,
      runId: 'run-1',
      frameHeight: inches(240),
      bayPitch: inches(102),
      levels: [
        { levelId: 'L1', elevation: inches(60), load: null },
        { levelId: 'L2', elevation: inches(120), load: null },
      ],
    });
    expect(list.items.filter((i) => i.item === 'beam')).toHaveLength(2);
    expect(list.items.filter((i) => i.item === 'upright')).toHaveLength(2);
    expect(list.view).toBe('elevation');
  });

  it('uses one unit on both axes, which is what lets a renderer use one scale', () => {
    const list = buildElevation({
      revisionHash: HASH,
      runId: 'run-1',
      frameHeight: inches(240),
      bayPitch: inches(102),
      levels: [],
    });
    expect(list.extent.height).toBe(6_096_000); // 240"
    expect(list.extent.width).toBe(2_590_800); // 102"
  });
});

describe('one display list, three renderers \u2014 the property that makes it worth having', () => {
  it('gives every renderer identical text, so a print cannot differ from a screen', () => {
    // A renderer consumes; it does not recompute. Two consumers of the same
    // list therefore cannot disagree about a number — asserted by consuming
    // the same list twice and comparing what a renderer would draw.
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [aisle()], extent });

    const renderA = textEntries(list).map((e) => e.text);
    const renderB = textEntries(list).map((e) => e.text);
    expect(renderA).toEqual(renderB);

    // And the numbers a renderer draws come only from the list, never from
    // measuring the items: the extent is supplied, not inferred.
    expect(list.extent.width).toBe(15_240_000); // 600"
  });

  it('is frozen, so a renderer cannot mutate what another renderer will draw', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [], extent });
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.items)).toBe(true);
    expect(Object.isFrozen(list.items[0])).toBe(true);
  });

  it('names the revision it was derived from', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [], aisles: [], extent });
    expect(list.revisionHash).toBe(HASH);
  });

  it('prints US Customary primary with metric in parentheses on dimensions', () => {
    const list = buildPlan({ revisionHash: HASH, runs: [run()], aisles: [], extent });
    const dim = list.items.find((i) => i.id === 'run-1:dim:length');
    expect(dim?.kind === 'dimension' ? dim.text.text : '').toMatch(/^312" \(7924\.8 mm\)$/);
  });
});
