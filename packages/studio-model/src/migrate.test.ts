import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, type V1Document } from './document.js';
import { MigrationError, migrate, migrateV1ToV2 } from './migrate.js';
import { MICROMETRES_PER_MIL } from './length.js';
import { counterOf } from './ids.js';

/**
 * The REAL v1 document, produced by `tools/make-continuity-fixture.mjs` from
 * the prototype kernel — not typed here.
 *
 * That is build-plan S0.2's stated acceptance and it is not pedantry: a
 * hand-written fixture is a second opinion authored by whoever already holds
 * the first one, and it would agree with the migration by construction.
 */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
    'utf8',
  ),
) as { source: { lengthUnit: string; schemaVersion: number }; document: V1Document };

const V1 = FIXTURE.document;

describe('the fixture is the prototype\'s, and says so', () => {
  it('is v1 in mil', () => {
    expect(FIXTURE.source.schemaVersion).toBe(1);
    expect(FIXTURE.source.lengthUnit).toBe('mil');
    expect(V1.schemaVersion).toBe(1);
  });

  it('carries the three default runs the prototype builds', () => {
    expect(V1.runs).toHaveLength(3);
    expect(V1.runs.every((r) => r.bays.length === 12)).toBe(true);
  });
});

describe('v1 → v2 converts every length exactly', () => {
  const { document } = migrateV1ToV2(V1);

  it('reports the new schema version', () => {
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
  });

  /**
   * The whole reason DEC-2 exists. Every length in the prototype comes from
   * IN() or FT() and is a multiple of 1,000 mil, so × 25.4 lands on a whole
   * micrometre for all of them — which is what makes this migration exact
   * rather than approximate. If a future fixture value breaks that, the
   * migration throws and this test says which field.
   */
  it.each([
    ['unitLoad.palletW', V1.unitLoad.palletW, () => document.unitLoad.palletW],
    ['unitLoad.palletD', V1.unitLoad.palletD, () => document.unitLoad.palletD],
    ['unitLoad.height', V1.unitLoad.height, () => document.unitLoad.height],
    ['building.clearHeight', V1.building.clearHeight, () => document.building.clearHeight.value],
    ['equipment.truckRAS', V1.equipment.truckRAS, () => document.equipment.truckRAS.value],
  ])('%s is mil × 25.4 exactly', (_name, mil, read) => {
    expect(read()).toBe(mil * MICROMETRES_PER_MIL);
    expect(Number.isSafeInteger(read())).toBe(true);
  });

  it('converts every bay-type length and beam level', () => {
    const t1 = V1.bayTypes[0] as V1Document['bayTypes'][number];
    const t2 = document.bayTypes[0] as (typeof document.bayTypes)[number];
    expect(t2.beamLength).toBe(t1.beamLength * MICROMETRES_PER_MIL);
    expect(t2.frameDepth).toBe(t1.frameDepth * MICROMETRES_PER_MIL);
    expect(t2.beamLevels).toEqual(t1.beamLevels.map((l) => l * MICROMETRES_PER_MIL));
  });

  it('leaves counts, weights and text alone', () => {
    expect(document.unitLoad.weight).toBe(V1.unitLoad.weight);
    expect(document.name).toBe(V1.name);
    expect(document.runs.map((r) => r.bays.length)).toEqual(V1.runs.map((r) => r.bays.length));
  });

  it('keeps every id, so the fixture and the migrated document address the same entities', () => {
    expect(document.runs.map((r) => r.id)).toEqual(V1.runs.map((r) => r.id));
    expect(document.bayTypes.map((t) => t.id)).toEqual(V1.bayTypes.map((t) => t.id));
  });
});

describe('an unverified v1 number does not become an established v2 one', () => {
  const { document } = migrateV1ToV2(V1);

  /**
   * The prototype ships `clearHeightVerified: false` next to a real-looking
   * 336,000 mil. Carrying that across as INPUT would launder an unverified
   * number into a trusted one at the moment it crossed a schema boundary —
   * and every drawing downstream would print it as a numeral rather than
   * VERIFY.
   */
  it('an unverified clear height is UNKNOWN, not INPUT', () => {
    expect(V1.building.clearHeightVerified).toBe(false);
    expect(document.building.clearHeight.established).toBe('UNKNOWN');
    expect(document.building.clearHeight.source).toMatch(/not verified/);
  });

  it('an unverified truck RAS is UNKNOWN', () => {
    expect(document.equipment.truckRAS.established).toBe('UNKNOWN');
  });

  it('an unverified beam-pair capacity is UNKNOWN', () => {
    expect(document.bayTypes[0]?.beamPairCapacity.established).toBe('UNKNOWN');
  });

  it('a verified value would be INPUT', () => {
    const verified = {
      ...V1,
      building: { ...V1.building, clearHeightVerified: true },
    } as V1Document;
    expect(migrateV1ToV2(verified).document.building.clearHeight.established).toBe('INPUT');
  });

  /** v1 encodes "no commodity class" as `''`, which sorts and renders like a value. */
  it('an empty commodity class is UNKNOWN, not an empty established string', () => {
    expect(V1.building.commodityClass).toBe('');
    expect(document.building.commodityClass.established).toBe('UNKNOWN');
  });

  it('an empty SDC is UNKNOWN', () => {
    expect(document.building.sdc.established).toBe('UNKNOWN');
  });
});

describe('an approximated frame height stays an approximation', () => {
  it('is UNKNOWN and says where the approximation came from', () => {
    const approximated = {
      ...V1,
      bayTypes: [{ ...(V1.bayTypes[0] as V1Document['bayTypes'][number]), frameHeightApproximated: true }],
    } as V1Document;
    const bt = migrateV1ToV2(approximated).document.bayTypes[0];
    expect(bt?.frameHeight.established).toBe('UNKNOWN');
    expect(bt?.frameHeight.source).toMatch(/approximated from the top beam/);
  });
});

describe('the id counter resumes past everything in the document', () => {
  it('will not mint an id that already exists', () => {
    const { document, counter } = migrateV1ToV2(V1);
    const present = [
      document.id,
      ...document.bayTypes.map((t) => t.id),
      ...document.runs.flatMap((r) => [r.id, ...r.bays.map((b) => b.id)]),
    ];
    const highest = Math.max(...present.map((id) => counterOf(id) ?? 0));
    expect(counter.next).toBe(highest);
  });
});

describe('migrate refuses rather than reading partially', () => {
  it('refuses a v0 document and says where to migrate it', () => {
    expect(() => migrate({ project: 'old', clearHeight: 1 })).toThrow(MigrationError);
    expect(() => migrate({ project: 'old' })).toThrow(/rack-studio-v1 prototype kernel/);
  });

  /**
   * The important refusal. Reading a v3 by ignoring what it does not recognise
   * gives a layout missing whatever v3 added, where every number still looks
   * right — worse than an error, because nothing appears wrong.
   */
  it('refuses a future schema version and names it', () => {
    expect(() => migrate({ schemaVersion: 3 })).toThrow(/Unsupported schemaVersion 3/);
    expect(() => migrate({ schemaVersion: 3 })).toThrow(/refused rather than read partially/);
  });

  it.each([null, undefined, 42, 'a document', []])('refuses %o', (bad) => {
    expect(() => migrate(bad)).toThrow(MigrationError);
  });

  it('passes a v2 document through and resumes its counter', () => {
    const { document } = migrateV1ToV2(V1);
    const again = migrate(document);
    expect(again.document).toEqual(document);
    expect(again.counter.next).toBeGreaterThan(0);
  });
});

describe('a mil value that does not land on a whole micrometre is refused', () => {
  it('names the field and refuses rather than rounding', () => {
    const odd = { ...V1, unitLoad: { ...V1.unitLoad, palletW: 1 } } as V1Document;
    expect(() => migrateV1ToV2(odd)).toThrow(/unitLoad.palletW/);
    expect(() => migrateV1ToV2(odd)).toThrow(/not a whole micrometre/);
  });
});

describe('an established v1 string survives as INPUT', () => {
  it('a stated commodity class is INPUT, not UNKNOWN', () => {
    const stated = { ...V1, building: { ...V1.building, commodityClass: 'III' } } as V1Document;
    const c = migrateV1ToV2(stated).document.building.commodityClass;
    expect(c).toEqual({ value: 'III', established: 'INPUT', source: 'v1 building.commodityClass' });
  });

  it('a stated SDC is INPUT', () => {
    const stated = { ...V1, building: { ...V1.building, sdc: 'D' } } as V1Document;
    expect(migrateV1ToV2(stated).document.building.sdc.established).toBe('INPUT');
  });
});

describe('migrateV1ToV2 refuses a document that is not v1', () => {
  it('names the version it was handed', () => {
    expect(() => migrateV1ToV2({ ...V1, schemaVersion: 2 } as unknown as V1Document)).toThrow(
      /expected a v1 document, got schemaVersion 2/,
    );
  });
});

describe('an inexact length is refused wherever it appears', () => {
  it.each([
    ['a bay-type beam length', (d: V1Document) => ({ ...d, bayTypes: [{ ...(d.bayTypes[0] as V1Document['bayTypes'][number]), beamLength: 3 }] })],
    ['a beam level', (d: V1Document) => ({ ...d, bayTypes: [{ ...(d.bayTypes[0] as V1Document['bayTypes'][number]), beamLevels: [3] }] })],
    ['a run x', (d: V1Document) => ({ ...d, runs: [{ ...(d.runs[0] as V1Document['runs'][number]), x: 7 }] })],
  ])('%s', (_name, mangle) => {
    expect(() => migrateV1ToV2(mangle(V1) as V1Document)).toThrow(/not a whole micrometre/);
  });
});

describe('migrate routes a v1 document through the converter', () => {
  it('accepts a v1 document by its schemaVersion', () => {
    const viaMigrate = migrate(V1);
    const direct = migrateV1ToV2(V1);
    expect(viaMigrate.document).toEqual(direct.document);
    expect(viaMigrate.counter).toEqual(direct.counter);
  });
});

describe('a v1 document missing a pack pin records an empty pin, not undefined', () => {
  /**
   * The pins are what every derived number traces to. A missing one must read
   * as "no pin", which a finding can see, rather than as `undefined`, which
   * serialises away and leaves the field looking absent by design.
   */
  it('fills each absent pin with an empty string', () => {
    const noPacks = { ...V1, packs: {} } as V1Document;
    expect(migrateV1ToV2(noPacks).document.packs).toEqual({
      rack: '',
      forklift: '',
      accessory: '',
      fire: '',
      structural: '',
    });
  });
});
