import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';
import { BridgeError, length, runGeometry, toKernel, witnessedQuantity } from './to-kernel.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;

describe('length carries an origin and refuses a fractional micrometre', () => {
  it('defaults to INPUT, because that is what a stored length is', () => {
    expect(length(IN(96))).toMatchObject({ value: 2_438_400, unit: 'um', origin: 'INPUT' });
  });

  it('takes the origin it is given', () => {
    expect(length(IN(96), 'CATALOG').origin).toBe('CATALOG');
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %o', (bad) => {
    expect(() => length(bad)).toThrow(BridgeError);
  });

  it('says the document is the wrong shape, not that it rounded', () => {
    expect(() => length(1.5)).toThrow(/not a rounding to paper over/);
  });
});

describe('a witnessed value keeps the origin the document recorded', () => {
  /**
   * The whole point of the bridge. `kernel-units` will do arithmetic on an
   * UNKNOWN quite happily; `display-list` is what refuses to print the result.
   * So an origin dropped here is a VERIFY that silently becomes a numeral on a
   * drawing.
   */
  it('an unverified clear height stays UNKNOWN', () => {
    const q = witnessedQuantity(doc().building.clearHeight);
    expect(q.origin).toBe('UNKNOWN');
  });

  it.each(['INPUT', 'CATALOG', 'RULE', 'UNKNOWN'] as const)('carries %s through', (established) => {
    expect(witnessedQuantity({ value: IN(10), established }).origin).toBe(established);
  });
});

describe('runGeometry derives rather than reads', () => {
  const d = doc();
  const run = d.runs[0] as StudioDocument['runs'][number];
  const bt = d.bayTypes[0] as StudioDocument['bayTypes'][number];

  it('bay pitch is clear span plus one upright face', () => {
    expect(runGeometry(d, run).bayPitch.value).toBe(bt.beamLength + bt.uprightWidth);
  });

  /** The n+1-upright rule: n bays close with one more face. */
  it('run length is bays × pitch + a closing upright face', () => {
    const g = runGeometry(d, run);
    expect(g.runLength.value).toBe(run.bays.length * g.bayPitch.value + bt.uprightWidth);
  });

  it('a back-to-back run is two frame depths plus its row spacer', () => {
    expect(run.backToBack).toBe(true);
    expect(runGeometry(d, run).frameDepth.value).toBe(bt.frameDepth * 2 + run.rowSpacer);
  });

  /**
   * Every run in the fixture is back-to-back, so single-row depth would go
   * unexercised — and an aisle measured against the wrong depth is out by a
   * whole second frame.
   */
  it('a single-row run is one frame depth', () => {
    const single = { ...run, backToBack: false };
    expect(runGeometry({ ...d, runs: [single] }, single).frameDepth.value).toBe(bt.frameDepth);
  });

  it('refuses a dangling bay type rather than using the first one', () => {
    const broken = { ...run, bayTypeId: 'bt_gone' };
    expect(() => runGeometry({ ...d, runs: [broken] }, broken)).toThrow(BridgeError);
    expect(() => runGeometry({ ...d, runs: [broken] }, broken)).toThrow(/about a different rack/);
  });

  it('refuses a run with no bays', () => {
    const empty = { ...run, bays: [] };
    expect(() => runGeometry({ ...d, runs: [empty] }, empty)).toThrow(/no bays/);
  });
});

describe('toKernel assembles the whole plan', () => {
  const scene = toKernel(doc());

  it('produces one geometry per run', () => {
    expect(scene.runs).toHaveLength(3);
  });

  it('derives an aisle between each vertically adjacent pair', () => {
    expect(scene.aisles).toHaveLength(2);
  });

  /**
   * ADR-006's datum is load face to load face. The pallet envelope is not
   * modelled yet, so a load-face clear width cannot be derived without
   * inventing an overhang — and `null` is what makes `display-list` print
   * VERIFY instead of a number that would look like a compliance answer.
   */
  it('reports every clear width as null, not as a frame-to-frame number', () => {
    expect(scene.aisles.every((a) => a.clearWidth === null)).toBe(true);
  });

  it('places each aisle at the end of the run above it', () => {
    const first = scene.runs[0]!;
    expect(scene.aisles[0]!.offsetY.value).toBe(first.offsetY.value + first.frameDepth.value);
  });

  it('the extent covers every run', () => {
    for (const r of scene.runs) {
      expect(scene.extent.width.value).toBeGreaterThanOrEqual(r.offsetX.value + r.runLength.value);
      expect(scene.extent.height.value).toBeGreaterThanOrEqual(r.offsetY.value + r.frameDepth.value);
    }
  });

  /**
   * Defect D-B produced overlapping runs and a NEGATIVE frame-to-frame gap. A
   * non-positive gap is not an aisle and must not be reported as one — a split
   * sibling sits beside its parent, not across an aisle from it.
   */
  it('reports no aisle between two runs at the same y', () => {
    const d = doc();
    const [a, b] = [d.runs[0]!, d.runs[1]!];
    const overlapping = { ...d, runs: [a, { ...b, y: a.y }] };
    expect(toKernel(overlapping).aisles).toHaveLength(0);
  });

  it('handles a document with a single run', () => {
    const d = doc();
    const one = { ...d, runs: [d.runs[0]!] };
    const s = toKernel(one);
    expect(s.runs).toHaveLength(1);
    expect(s.aisles).toHaveLength(0);
  });

  it('handles a document with no runs at all', () => {
    const s = toKernel({ ...doc(), runs: [] });
    expect(s.runs).toEqual([]);
    expect(s.extent.width.value).toBe(0);
  });

  it('orders aisles top to bottom regardless of the runs array order', () => {
    const d = doc();
    const reversed = { ...d, runs: [...d.runs].reverse() };
    const a = toKernel(d).aisles.map((x) => x.offsetY.value);
    const b = toKernel(reversed).aisles.map((x) => x.offsetY.value);
    expect(b).toEqual(a);
  });
});
