import { describe, expect, it } from 'vitest';

import { inches, poundsPerPair } from '@rms/kernel-units';

import {
  REFERENCE_LABEL_SEPARATION_UM,
  buildElevation,
  narrowestGap,
  textEntries,
  unestablishedEntries,
  type DisplayItem,
  type ReferenceElevation,
} from './index.js';

const HASH = 'sha256:elevation';

function elevation(over: Partial<Parameters<typeof buildElevation>[0]> = {}) {
  return buildElevation({
    revisionHash: HASH,
    runId: 'run-1',
    frameHeight: inches(240),
    bayPitch: inches(99),
    levels: [
      { levelId: 'lvl-1', elevation: inches(60), load: poundsPerPair(5400) },
      { levelId: 'lvl-2', elevation: inches(120), load: poundsPerPair(5400) },
      { levelId: 'lvl-3', elevation: inches(180), load: null },
    ],
    ...over,
  });
}

/** Every `text` item, by id. */
function labels(list: ReturnType<typeof buildElevation>): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of list.items) {
    if (item.kind === 'text') out.set(item.id, item.text.text);
  }
  return out;
}

const REFERENCES: readonly ReferenceElevation[] = [
  { id: 'underside', label: 'UNDERSIDE OF STRUCTURE', elevation: inches(336) },
  { id: 'deflector', label: 'SPRINKLER DEFLECTOR', elevation: inches(320) },
  { id: 'top-of-storage', label: 'MAX TOP OF STORAGE', elevation: inches(322) },
];

describe('the frame dimension is witnessed from the slab', () => {
  it('spans zero to the frame height', () => {
    const dim = elevation().items.find((i) => i.id === 'run-1:dim:frame-height');
    expect(dim?.kind).toBe('dimension');
    if (dim?.kind !== 'dimension') throw new Error('unreachable');
    expect(dim.from.y).toBe(0);
    expect(dim.to.y).toBe(inches(240).value);
  });

  it('is drawn clear of the bay rather than through it', () => {
    const dim = elevation().items.find((i) => i.id === 'run-1:dim:frame-height');
    if (dim?.kind !== 'dimension') throw new Error('unreachable');
    expect(dim.from.x).toBeGreaterThan(inches(99).value);
  });
});

describe('floor storage', () => {
  it('is absent unless asked for', () => {
    expect(elevation().items.some((i) => i.id === 'run-1:floor-load')).toBe(false);
  });

  /**
   * A floor load occupies a level's worth of height and counts as a position.
   * Leaving it off the elevation understates what the layout holds, which is
   * the sort of omission a reader cannot detect from the drawing.
   */
  it('draws a load sitting on the slab, full bay width', () => {
    const list = elevation({ floorStorage: { height: inches(48), depth: inches(48) } });
    const load = list.items.find((i) => i.id === 'run-1:floor-load');
    expect(load?.kind).toBe('rect');
    if (load?.kind !== 'rect') throw new Error('unreachable');
    expect(load.origin.y).toBe(0);
    expect(load.height).toBe(inches(48).value);
    expect(load.width).toBe(inches(99).value);
    expect(load.item).toBe('unit-load');
  });
});

describe('reference elevations — the S3.3 acceptance criterion', () => {
  const list = elevation({ references: REFERENCES });

  it('draws a line for every established reference', () => {
    for (const id of ['underside', 'deflector', 'top-of-storage']) {
      const line = list.items.find((i) => i.id === `${id}:line`);
      expect(line, `${id}:line missing`).toBeDefined();
      expect(line?.item).toBe('reference');
    }
  });

  it('draws each line at its TRUE elevation, never at the displaced label', () => {
    const at = new Map(REFERENCES.map((r) => [r.id, r.elevation]));
    for (const [id, quantity] of at) {
      const line = list.items.find((i) => i.id === `${id}:line`);
      if (line?.kind !== 'line') throw new Error('unreachable');
      expect(line.from.y).toBe(quantity?.value);
      expect(line.to.y).toBe(quantity?.value);
    }
  });

  /**
   * THE criterion. 320, 322 and 336 in are within sixteen inches of each other;
   * at their true elevations two of the three labels overprint.
   */
  it('never overprints: labels are at least the stated separation apart', () => {
    const texts = list.items.filter(
      (i): i is Extract<DisplayItem, { kind: 'text' }> =>
        i.kind === 'text' && i.id.endsWith(':label'),
    );
    const placed = texts.map((t) => ({
      id: t.id,
      at: t.at.y,
      label: t.at.y,
      displaced: 0,
      payload: undefined,
    }));
    expect(narrowestGap(placed)).toBeGreaterThanOrEqual(REFERENCE_LABEL_SEPARATION_UM);
  });

  it('draws a leader only for a label that actually moved', () => {
    const leaders = list.items.filter((i) => i.id.endsWith(':leader'));
    const moved = leaders.map((l) => l.id.replace(':leader', ''));
    // The lowest of a crowded group is not displaced, so it gets no leader —
    // a zero-length leader would be a stray mark on every uncrowded sheet.
    expect(moved).not.toContain('deflector');
    expect(leaders.length).toBeGreaterThan(0);
    for (const leader of leaders) {
      if (leader.kind !== 'line') throw new Error('unreachable');
      expect(leader.from.y).not.toBe(leader.to.y);
    }
  });

  it('names each datum beside its value', () => {
    const text = labels(list);
    expect(text.get('deflector:label')).toMatch(/^SPRINKLER DEFLECTOR /);
    expect(text.get('underside:label')).toMatch(/^UNDERSIDE OF STRUCTURE /);
  });

  it('draws no reference items when none are given', () => {
    expect(elevation().items.every((i) => i.item !== 'reference')).toBe(true);
  });
});

describe('an unsurveyed reference reads VERIFY and draws no line', () => {
  const list = elevation({
    references: [
      { id: 'deflector', label: 'SPRINKLER DEFLECTOR', elevation: null },
      { id: 'underside', label: 'UNDERSIDE OF STRUCTURE', elevation: inches(336) },
    ],
  });

  /**
   * The governing criterion for this package (AC-07): a refusal in the engine
   * that leaks a number into the interface is not a refusal. An unsurveyed
   * deflector elevation must not print as a numeral.
   */
  it('prints VERIFY, not a number', () => {
    expect(labels(list).get('deflector:label')).toBe('SPRINKLER DEFLECTOR VERIFY');
  });

  it('marks the entry unestablished, so the sheet layer can see it', () => {
    const unestablished = unestablishedEntries(list).map((e) => e.text);
    expect(unestablished).toContain('SPRINKLER DEFLECTOR VERIFY');
  });

  it('draws no line, because there is no elevation to draw one at', () => {
    expect(list.items.some((i) => i.id === 'deflector:line')).toBe(false);
  });

  /**
   * The label still appears. An absent row would read as "not applicable",
   * which is a different statement from "expected and not known".
   */
  it('still shows the datum exists', () => {
    expect(labels(list).has('deflector:label')).toBe(true);
  });

  it('leaves the established reference unaffected', () => {
    expect(list.items.some((i) => i.id === 'underside:line')).toBe(true);
    expect(labels(list).get('underside:label')).not.toMatch(/VERIFY/);
  });
});

describe('a level with no stated load still prints VERIFY', () => {
  it('carries the existing behaviour forward', () => {
    const texts = textEntries(elevation()).map((e) => e.text);
    expect(texts).toContain('VERIFY');
  });
});
