import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { convert, inches } from '@rms/kernel-units';
import { BeamCatalog, loadBeamRows, CatalogDataError } from './index.js';

// Load the REAL extracted catalog data. These assertions are against published
// values transcribed verbatim from the manufacturer's chart — the golden data.
const beamsPath = fileURLToPath(
  new URL('../../../data/catalog/interlake-2026-08/beams.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(beamsPath, 'utf8')) as { rows: unknown[] };
const rows = loadBeamRows(doc.rows);
const catalog = new BeamCatalog(rows);

describe('the real Interlake data loads', () => {
  it('has 378 rows', () => {
    expect(rows).toHaveLength(378);
    expect(catalog.size).toBe(378);
  });

  it('publishes the 21-span grid for a known family/series', () => {
    const spans = catalog.publishedSpans('27E', 'F3M');
    expect(spans).toEqual([
      48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156,
      162, 168,
    ]);
  });

  it('returns an empty span list for an unknown family/series', () => {
    expect(catalog.publishedSpans('NOPE', 'F3M')).toEqual([]);
  });
});

describe('on-grid lookup returns the published capacity, per pair', () => {
  it('27E F3M at 48in is 5620 lb/pr — a verification-sample value', () => {
    const result = catalog.lookup({ family: '27E', series: 'F3M', span: inches(48) });
    expect(result.status).toBe('ON_GRID');
    if (result.status === 'ON_GRID') {
      expect(result.capacity.unit).toBe('lb/pr');
      expect(convert(result.capacity, 'lb/pr')).toBe(5620);
      expect(result.partNumber).toBe('U0200310');
    }
  });

  it('distinguishes the same family across two series — 40E differs by series', () => {
    // The published data: 40E F3M 48in -> 9450, 40E F4M 48in -> 9815.
    const f3m = catalog.lookup({ family: '40E', series: 'F3M', span: inches(48) });
    const f4m = catalog.lookup({ family: '40E', series: 'F4M', span: inches(48) });
    expect(f3m.status).toBe('ON_GRID');
    expect(f4m.status).toBe('ON_GRID');
    if (f3m.status === 'ON_GRID' && f4m.status === 'ON_GRID') {
      expect(convert(f3m.capacity, 'lb/pr')).toBe(9450);
      expect(convert(f4m.capacity, 'lb/pr')).toBe(9815);
    }
  });

  it('a capacity is per pair and refuses conversion to per-beam pounds', () => {
    const result = catalog.lookup({ family: '65Q', series: 'F5M', span: inches(48) });
    expect(result.status).toBe('ON_GRID');
    if (result.status === 'ON_GRID') {
      expect(convert(result.capacity, 'lb/pr')).toBe(27745);
      expect(() => convert(result.capacity, 'lb')).toThrow();
    }
  });
});

describe('AC-08 — an off-grid span returns both brackets and no capacity', () => {
  it('110in is off grid; returns 108 and 114, no value', () => {
    // The demo scenario: a client tries a 110" beam.
    const result = catalog.lookup({ family: '27E', series: 'F3M', span: inches(110) });
    expect(result.status).toBe('OFF_GRID');
    if (result.status === 'OFF_GRID') {
      expect(result.lowerSpan).not.toBeNull();
      expect(result.upperSpan).not.toBeNull();
      expect(convert(result.lowerSpan!, 'in')).toBe(108);
      expect(convert(result.upperSpan!, 'in')).toBe(114);
      // There is NO capacity field on an off-grid result at all.
      expect('capacity' in result).toBe(false);
    }
  });

  it('a span below the smallest published returns no lower bracket', () => {
    const result = catalog.lookup({ family: '27E', series: 'F3M', span: inches(36) });
    expect(result.status).toBe('OFF_GRID');
    if (result.status === 'OFF_GRID') {
      expect(result.lowerSpan).toBeNull();
      expect(convert(result.upperSpan!, 'in')).toBe(48);
    }
  });

  it('a span above the largest published returns no upper bracket', () => {
    const result = catalog.lookup({ family: '27E', series: 'F3M', span: inches(200) });
    expect(result.status).toBe('OFF_GRID');
    if (result.status === 'OFF_GRID') {
      expect(convert(result.lowerSpan!, 'in')).toBe(168);
      expect(result.upperSpan).toBeNull();
    }
  });

  it('never interpolates — an off-grid result carries no number', () => {
    const result = catalog.lookup({ family: '27E', series: 'F3M', span: inches(51) });
    expect(result.status).toBe('OFF_GRID');
    expect(JSON.stringify(result)).not.toContain('capacity');
  });
});

describe('never nearest-matches a part', () => {
  it('an unknown family is NOT_FOUND, not the closest thing', () => {
    const result = catalog.lookup({ family: 'NOPE', series: 'F3M', span: inches(48) });
    expect(result.status).toBe('NOT_FOUND');
  });

  it('an unknown series for a real family is NOT_FOUND', () => {
    const result = catalog.lookup({ family: '27E', series: 'F9Z', span: inches(48) });
    expect(result.status).toBe('NOT_FOUND');
  });
});

describe('the storage base justifies itself against the real span grid', () => {
  it('preserves all 21 real published spans under micrometres', () => {
    const spans = catalog.publishedSpans('27E', 'F3M');
    const exact = spans.filter((s) => convert(inches(s), 'in') === s);
    expect(exact).toHaveLength(21);
  });

  it('loses exactly 18 of the 21 under integer millimetres', () => {
    // The blueprint's headline claim, now asserted against the REAL published
    // span list rather than a reconstruction. This is why length is stored in
    // micrometres and not millimetres.
    const spans = catalog.publishedSpans('27E', 'F3M');
    const lost = spans.filter((s) => Math.round(s * 25.4) / 25.4 !== s);
    expect(lost).toHaveLength(18);
  });
});

describe('data validation refuses malformed rows', () => {
  it('rejects an empty array', () => {
    expect(() => loadBeamRows([])).toThrow(CatalogDataError);
  });

  it('rejects a non-array', () => {
    expect(() => loadBeamRows('nope' as unknown as unknown[])).toThrow(CatalogDataError);
  });

  it('rejects a null row', () => {
    expect(() => loadBeamRows([null])).toThrow(/not an object/);
  });

  it('rejects a row with a non-string family', () => {
    expect(() =>
      loadBeamRows([
        {
          family: 42,
          series: 'F3M',
          face_height_in: 2.75,
          span_in: 48,
          part_number: 'X',
          code_18: 'Y',
          capacity_lbs: 5620,
        },
      ]),
    ).toThrow(/'family' must be a non-empty string/);
  });

  it('rejects a row with a non-finite face height', () => {
    expect(() =>
      loadBeamRows([
        {
          family: '27E',
          series: 'F3M',
          face_height_in: Number.NaN,
          span_in: 48,
          part_number: 'X',
          code_18: 'Y',
          capacity_lbs: 5620,
        },
      ]),
    ).toThrow(/'face_height_in' must be a finite number/);
  });

  it('rejects a row missing a field', () => {
    expect(() => loadBeamRows([{ family: '27E', series: 'F3M' }])).toThrow(CatalogDataError);
  });

  it('rejects a non-integer span', () => {
    expect(() =>
      loadBeamRows([
        {
          family: '27E',
          series: 'F3M',
          face_height_in: 2.75,
          span_in: 48.5,
          part_number: 'X',
          code_18: 'Y',
          capacity_lbs: 5620,
        },
      ]),
    ).toThrow(CatalogDataError);
  });

  it('rejects a non-finite capacity', () => {
    expect(() =>
      loadBeamRows([
        {
          family: '27E',
          series: 'F3M',
          face_height_in: 2.75,
          span_in: 48,
          part_number: 'X',
          code_18: 'Y',
          capacity_lbs: Number.POSITIVE_INFINITY,
        },
      ]),
    ).toThrow(CatalogDataError);
  });
});

describe('P0-005 — the 59E face-height discrepancy is parked, not laundered', () => {
  // Three readings exist for one dimension: 5.92 on all 42 transcribed rows,
  // 5.928 in a documentation table, and 5.93 read from the source chart by EL
  // on 2026-08-31. None carries a page reference, so none is promoted to fact.
  //
  // These tests exist so the parking decision is ENFORCED rather than merely
  // written down. Two things must stay true until a page reference arrives.

  it('keeps all 42 rows at the value as published, never silently corrected', () => {
    const faces = rows.filter((r) => r.family.startsWith('59E'));
    expect(faces).toHaveLength(42);
    // If someone "fixes" these to 5.928 or 5.93, the extract stops reconciling
    // against its own source and the provenance claim becomes false.
    for (const r of faces) {
      expect(r.faceHeightIn).toBe(5.92);
    }
  });

  it('does not let face height reach a lookup result, so the discrepancy cannot change a capacity', () => {
    // The key is family + series + span. Face height is carried as descriptive
    // data only. This asserts the property that makes P0-005 non-blocking: two
    // rows differing ONLY in face height are unreachable through lookup(),
    // because lookup never reads it.
    const before = catalog.lookup({ family: '59E', series: 'F5M', span: inches(96) });

    const perturbed = new BeamCatalog(
      rows.map((r) => (r.family.startsWith('59E') ? { ...r, faceHeightIn: 5.93 } : r)),
    );
    const after = perturbed.lookup({ family: '59E', series: 'F5M', span: inches(96) });

    // Changing the contested number changes no lookup outcome at all.
    expect(after).toEqual(before);
  });
});
