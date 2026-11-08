import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';
import {
  countFindings,
  inchesForComparison,
  screeningFindingsForDocument,
  type ScreeningFindingRow,
} from './screening.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;
const codes = (rows: readonly ScreeningFindingRow[]): string[] =>
  rows.map((r) => `${r.code}:${r.severity}`);

describe('screeningFindingsForDocument on the continuity fixture', () => {
  const rows = screeningFindingsForDocument(doc());

  it('finds the seven rows the Checks view showed at 1f4762c', () => {
    expect(codes(rows)).toEqual([
      'RULE_PACK_AUTHORITY:PASS',
      'AISLE_CLEAR_SHORTFALL:BLOCKING',
      'AISLE_CLEAR_SHORTFALL:BLOCKING',
      'BEAM_CAPACITY_OK:MISSING_INPUT',
      'CLEAR_HEIGHT_UNVERIFIED:MISSING_INPUT',
      'COMMODITY_CLASS_MISSING:MISSING_SOURCE',
      'SEISMIC_SDC_MISSING:MISSING_SOURCE',
    ]);
  });

  it('counts every row exactly once', () => {
    const c = countFindings(rows);
    expect(c).toEqual({ blocking: 2, review: 0, missingInput: 2, missingSource: 2, pass: 1 });
    expect(c.blocking + c.review + c.missingInput + c.missingSource + c.pass).toBe(rows.length);
  });

  it('is pure: the same document gives the same rows', () => {
    expect(screeningFindingsForDocument(doc())).toEqual(rows);
  });
});

/**
 * F-68. The fixture's aisle clears 126" and the truck needs 126.3". Whole-inch
 * rounding printed both as 126 and the finding read as a contradiction.
 */
describe('a clearance finding never rounds its shortfall away (F-68)', () => {
  const rows = screeningFindingsForDocument(doc());

  it('states the requirement to the tenth when that is what decides it', () => {
    expect(rows.find((r) => r.code === 'AISLE_CLEAR_SHORTFALL')?.summary).toBe(
      'Clear between loads is 126"; the truck needs 126.3" (RAS + 60").',
    );
  });

  it('names aisles the way the plan does, not by geometry id', () => {
    expect(rows.filter((r) => r.code === 'AISLE_CLEAR_SHORTFALL').map((r) => r.subject)).toEqual([
      'Aisle 1',
      'Aisle 2',
    ]);
  });

  it.each([
    [IN(126), '126"'],
    [IN(126.3), '126.3"'],
    [IN(125.96), '126"'],
  ])('inchesForComparison(%d µm) is %s', (um, text) => {
    expect(inchesForComparison(um)).toBe(text);
  });
});

describe('every branch, each from one change to the fixture', () => {
  it('a DRAFT rule pack caps the authority row at REVIEW', () => {
    const d = doc();
    const draft = { ...d, packs: { ...d.packs, structural: 'mvp-2026-08' } };
    const row = screeningFindingsForDocument(draft)[0];
    expect(row?.severity).toBe('REVIEW');
    expect(row?.closureText).toMatch(/approved rule pack/);
  });

  it('an aisle that clears is MISSING_INPUT while the truck RAS is unverified, PASS once it is', () => {
    const d = doc();
    const narrowTruck = { ...d.equipment.truckRAS, value: IN(60) };
    const unverified = { ...d, equipment: { ...d.equipment, truckRAS: narrowTruck } };
    const ok = screeningFindingsForDocument(unverified).filter((r) => r.code === 'AISLE_CLEAR_OK');
    expect(ok.map((r) => r.severity)).toEqual(['MISSING_INPUT', 'MISSING_INPUT']);
    expect(ok[0]?.summary).toBe('Clear between loads is 126" (needs 120").');

    const verified = {
      ...d,
      equipment: { ...d.equipment, truckRAS: { ...narrowTruck, established: 'INPUT' as const } },
    };
    const passed = screeningFindingsForDocument(verified).filter((r) => r.code === 'AISLE_CLEAR_OK');
    expect(passed.map((r) => r.severity)).toEqual(['PASS', 'PASS']);
    expect(passed[0]?.closureText).toBe('Meets operational aisle target.');
  });

  it('an off-grid beam span is a REVIEW row naming its published brackets', () => {
    const d = doc();
    const bt = d.bayTypes[0]!;
    const offGrid = { ...d, bayTypes: [{ ...bt, beamLength: IN(110) }, ...d.bayTypes.slice(1)] };
    const row = screeningFindingsForDocument(offGrid).find((r) => r.code === 'BEAM_SPAN_OFF_GRID');
    expect(row?.severity).toBe('REVIEW');
    expect(row?.summary).toMatch(/110" is off-grid/);
  });

  it.each([
    [40, /brackets: min"–\d+"/],
    [200, /brackets: \d+"–max"/],
  ])('a %d" span outside the published range says which end has no bracket', (inches, pattern) => {
    const d = doc();
    const bt = d.bayTypes[0]!;
    const outside = { ...d, bayTypes: [{ ...bt, beamLength: IN(inches) }, ...d.bayTypes.slice(1)] };
    const row = screeningFindingsForDocument(outside).find((r) => r.code === 'BEAM_SPAN_OFF_GRID');
    expect(row?.summary).toMatch(pattern);
  });

  it('demand over the beam pair capacity is BLOCKING', () => {
    const d = doc();
    const heavy = { ...d, unitLoad: { ...d.unitLoad, weight: 100_000 } };
    expect(codes(screeningFindingsForDocument(heavy))).toContain('BEAM_CAPACITY_EXCEEDED:BLOCKING');
  });

  it('a verified capacity that covers demand is PASS', () => {
    const d = doc();
    const bt = d.bayTypes[0]!;
    const verified = {
      ...d,
      bayTypes: [
        { ...bt, beamPairCapacity: { ...bt.beamPairCapacity, established: 'INPUT' as const } },
        ...d.bayTypes.slice(1),
      ],
    };
    expect(codes(screeningFindingsForDocument(verified))).toContain('BEAM_CAPACITY_OK:PASS');
  });

  it('established building facts raise no missing-input or missing-source rows', () => {
    const d = doc();
    const known = {
      ...d,
      building: {
        ...d.building,
        clearHeight: { ...d.building.clearHeight, established: 'INPUT' as const },
        commodityClass: { ...d.building.commodityClass, value: 'Class II' },
        sdc: { ...d.building.sdc, value: 'SDC D' },
      },
    };
    const found = codes(screeningFindingsForDocument(known));
    expect(found).not.toContain('CLEAR_HEIGHT_UNVERIFIED:MISSING_INPUT');
    expect(found).not.toContain('COMMODITY_CLASS_MISSING:MISSING_SOURCE');
    expect(found).not.toContain('SEISMIC_SDC_MISSING:MISSING_SOURCE');
  });

  it('a height-to-depth overturning ratio above 6:1 emits OVERTURNING_RATIO_EXCEEDED with ANSI MH16.1 warning text', () => {
    const d = doc();
    const bt = d.bayTypes[0]!;
    const tall = {
      ...d,
      bayTypes: [
        {
          ...bt,
          frameHeight: { ...bt.frameHeight, value: IN(288) },
        },
        ...d.bayTypes.slice(1),
      ],
    };
    const row = screeningFindingsForDocument(tall).find(
      (r) => r.code === 'OVERTURNING_RATIO_EXCEEDED',
    );
    expect(row?.severity).toBe('REVIEW');
    expect(row?.summary).toBe(
      'Exceeds 6:1 — reinforced anchoring required. Overhead ties highly recommended for SDC D stability.',
    );
  });
});
