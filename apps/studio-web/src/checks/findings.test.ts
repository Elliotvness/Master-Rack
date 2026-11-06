import { migrate, planGeometry } from '@rms/studio-model';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../fixtures/continuity/rack-studio-v1.json';
import { countFindings, deriveScreeningFindings, inchesForComparison } from './findings.js';

const doc = migrate(fixture.document).document;
const rows = deriveScreeningFindings(doc, planGeometry(doc));

describe('deriveScreeningFindings on the continuity fixture', () => {
  it('finds the seven rows the Checks view showed before the extraction', () => {
    expect(rows.map((r) => `${r.code}:${r.severity}`)).toEqual([
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
    expect(deriveScreeningFindings(doc, planGeometry(doc))).toEqual(rows);
  });
});

/**
 * F-68. The fixture's aisle clears 126" and the truck needs 126.3". Whole-inch
 * rounding printed both as 126 and the finding read as a contradiction.
 */
describe('a clearance finding never rounds its shortfall away (F-68)', () => {
  const aisle = rows.find((r) => r.code === 'AISLE_CLEAR_SHORTFALL');

  it('states the requirement to the tenth when that is what decides it', () => {
    expect(aisle?.summary).toBe('Clear between loads is 126"; the truck needs 126.3" (RAS + 60").');
  });

  it('names the aisle the way the plan does, not by geometry id', () => {
    expect(rows.filter((r) => r.code === 'AISLE_CLEAR_SHORTFALL').map((r) => r.subject)).toEqual([
      'Aisle 1',
      'Aisle 2',
    ]);
  });

  it.each([
    [126 * 25_400, '126"'],
    [126.3 * 25_400, '126.3"'],
    [125.96 * 25_400, '126"'],
  ])('inchesForComparison(%d µm) is %s', (um, text) => {
    expect(inchesForComparison(um)).toBe(text);
  });
});

