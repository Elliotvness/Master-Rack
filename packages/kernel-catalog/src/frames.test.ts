import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { convert, inches, pounds } from '@rms/kernel-units';

import {
  FrameCatalog,
  FrameCatalogError,
  FRAME_HEIGHT_BAND_BOUNDARY_IN,
  bandFor,
  governingHbl,
  loadFrameTables,
} from './index.js';

// The REAL extracted data. 435 cells, double-extraction verified.
const framesPath = fileURLToPath(
  new URL('../../../data/catalog/interlake-2026-08/frames.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(framesPath, 'utf8')) as {
  status: string;
  verification_path: { cells: number };
  quarantined_not_extracted: string[];
  tables: unknown[];
};
const tables = loadFrameTables(doc);
const catalog = new FrameCatalog(tables);

describe('the real frame data loads complete', () => {
  it('carries all three published tables and exactly 435 cells', () => {
    // The verification record says 435/435 cells reconciled. If the extract
    // dropped a row or a column this count moves, and a short row would
    // otherwise shift every capacity one column to the left.
    expect(catalog.tableCount).toBe(3);
    expect(catalog.cellCount).toBe(435);
    expect(doc.verification_path.cells).toBe(435);
  });

  it('publishes the 15-row HbL axis in 6-inch steps, 36 to 120', () => {
    // The reference project's quarantined tables were indexed 96-360 on 12-24
    // inch steps. This axis is the published one.
    expect(catalog.publishedHbl('2.314')).toEqual([
      36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96, 102, 108, 114, 120,
    ]);
  });

  it('arrives as DRAFT, awaiting approval in the new system', () => {
    expect(doc.status).toBe('DRAFT');
  });

  it('records the quarantined tables it deliberately did NOT extract', () => {
    // Recording the refusal is what stops someone "restoring" them later.
    expect(doc.quarantined_not_extracted.length).toBeGreaterThan(0);
    expect(doc.quarantined_not_extracted.join(' ')).toMatch(/72\.4%/);
    expect(doc.quarantined_not_extracted.join(' ')).toMatch(/cap_legacy_frames/);
  });
});

describe('the two-variable key \u2014 the defect the reference project shipped', () => {
  // A lookup keyed on HbL alone cannot reproduce the published table. Models
  // 2.314 / 2.313 / 2.312 carry two strut patterns and two capacity columns.

  it('returns a DIFFERENT capacity for the same HbL in different height bands', () => {
    const under = catalog.lookup({
      model: '2.314',
      hbl: inches(36),
      overallHeight: inches(240), // 20 ft
    });
    const over = catalog.lookup({
      model: '2.314',
      hbl: inches(36),
      overallHeight: inches(300), // 25 ft
    });

    expect(under.status).toBe('ON_GRID');
    expect(over.status).toBe('ON_GRID');
    if (under.status === 'ON_GRID' && over.status === 'ON_GRID') {
      // Published: 24,571 at <=21ft and 25,847 at >21ft.
      expect(convert(under.capacity, 'lb')).toBe(24571);
      expect(convert(over.capacity, 'lb')).toBe(25847);
      // The whole point: they differ. A one-variable lookup returns one of
      // these for both, and is wrong half the time.
      expect(convert(under.capacity, 'lb')).not.toBe(convert(over.capacity, 'lb'));
    }
  });

  it('puts exactly 21 ft in the LOWER band, because the column reads \u2264 21\u2032', () => {
    // An off-by-one here silently selects the more generous column, which is
    // the direction that hurts.
    expect(FRAME_HEIGHT_BAND_BOUNDARY_IN).toBe(252);
    expect(bandFor(inches(252))).toBe('lte21ft');
    expect(bandFor(inches(253))).toBe('gt21ft');
    expect(bandFor(inches(251))).toBe('lte21ft');
  });

  it('ignores the band for a model with a single strut pattern', () => {
    // 2.101 / 2.102 / 2.122 / UA10 publish one column each.
    const a = catalog.lookup({ model: '2.101', hbl: inches(36), overallHeight: inches(240) });
    const b = catalog.lookup({ model: '2.101', hbl: inches(36), overallHeight: inches(400) });
    expect(a.status).toBe('ON_GRID');
    if (a.status === 'ON_GRID' && b.status === 'ON_GRID') {
      expect(convert(a.capacity, 'lb')).toBe(convert(b.capacity, 'lb'));
      expect(a.band).toBeNull();
    }
  });

  it('names the published column it read', () => {
    const r = catalog.lookup({ model: '2.313', hbl: inches(48), overallHeight: inches(300) });
    if (r.status === 'ON_GRID') {
      expect(r.column).toBe('2.313@>21ft');
      expect(r.band).toBe('gt21ft');
    }
  });
});

describe('the quarantined values are NOT what this catalog returns', () => {
  // The strongest possible regression test for B-03: assert that the published
  // numbers are returned and the proven-wrong ones are not. The quarantined
  // table claimed 10,400 lb at HbL 96 and 8,600 at HbL 120 for B2314G.

  it('returns the published 96-inch capacity, not the quarantined 10,400', () => {
    const r = catalog.lookup({ model: '2.314', hbl: inches(96), overallHeight: inches(240) });
    if (r.status === 'ON_GRID') {
      expect(convert(r.capacity, 'lb')).toBe(7597);
      expect(convert(r.capacity, 'lb')).not.toBe(10400);
    }
  });

  it('returns the published 120-inch capacity, not the quarantined 8,600', () => {
    // This is the +72.4% overstatement. A frame loaded to 8,600 lb at HbL 120
    // would have been reported OK against a published capacity of 4,989.
    const r = catalog.lookup({ model: '2.314', hbl: inches(120), overallHeight: inches(240) });
    if (r.status === 'ON_GRID') {
      expect(convert(r.capacity, 'lb')).toBe(4989);
      expect(convert(r.capacity, 'lb')).toBeLessThan(8600);
    }
  });

  it('has no HbL row above 120 inches, because the chart has none', () => {
    // The quarantined tables carried rows to 360 in with no published
    // counterpart at all.
    for (const model of catalog.models()) {
      const axis = catalog.publishedHbl(model);
      if (axis.length > 0) expect(Math.max(...axis)).toBe(120);
    }
  });
});

describe('AC-08 \u2014 an off-grid HbL returns both brackets and no capacity', () => {
  it('brackets an unpublished HbL and states no value', () => {
    const r = catalog.lookup({ model: '2.314', hbl: inches(99), overallHeight: inches(240) });
    expect(r.status).toBe('OFF_GRID');
    if (r.status === 'OFF_GRID') {
      expect(r.lowerHblIn).toBe(96);
      expect(r.upperHblIn).toBe(102);
      expect(r.publishedHblIn).toHaveLength(15);
      expect(r).not.toHaveProperty('capacity');
    }
  });

  it('has no upper bracket above the published maximum', () => {
    const r = catalog.lookup({ model: '2.314', hbl: inches(140), overallHeight: inches(240) });
    if (r.status === 'OFF_GRID') {
      expect(r.lowerHblIn).toBe(120);
      expect(r.upperHblIn).toBeNull();
    }
  });

  it('has no lower bracket below the published minimum', () => {
    const r = catalog.lookup({ model: '2.314', hbl: inches(24), overallHeight: inches(240) });
    if (r.status === 'OFF_GRID') {
      expect(r.lowerHblIn).toBeNull();
      expect(r.upperHblIn).toBe(36);
    }
  });

  it('refuses an unpublished model by name rather than guessing', () => {
    const r = catalog.lookup({ model: 'UL_U77', hbl: inches(36), overallHeight: inches(240) });
    expect(r.status).toBe('NOT_FOUND');
    if (r.status === 'NOT_FOUND') expect(r.reason).toMatch(/not published/);
  });

  it('reports an empty HbL axis for a model it does not publish', () => {
    // publishedHbl is what a UI would call to offer valid choices. For an
    // unknown model it must return nothing rather than another model's axis,
    // which would present a grid the client cannot actually order against.
    expect(catalog.publishedHbl('UL_U80')).toEqual([]);
  });

  it('refuses a variant whose published column is missing from the table', () => {
    // A variant declared banded whose >21ft column was dropped in extraction.
    // Returning a NOT_FOUND naming the column beats silently reading column 0,
    // which would attribute one model's capacity to another.
    const broken = new FrameCatalog(
      loadFrameTables({
        tables: [
          {
            table_id: 'partial',
            page_ref: 'p.0',
            load_basis: 'test',
            column_order: ['m@<=21ft'],
            variants: [{ model: 'm', banded: true }],
            rows: { '36': [1000] },
          },
        ],
      }),
    );
    const r = broken.lookup({ model: 'm', hbl: inches(36), overallHeight: inches(300) });
    expect(r.status).toBe('NOT_FOUND');
    if (r.status === 'NOT_FOUND') expect(r.reason).toMatch(/no published column 'm@>21ft'/);
    // And the band that IS published still resolves.
    const ok = broken.lookup({ model: 'm', hbl: inches(36), overallHeight: inches(240) });
    expect(ok.status).toBe('ON_GRID');
  });
});

describe('governing HbL follows the PUBLISHED definition', () => {
  // "The maximum beam spacing OR the distance between the floor and the top of
  // the first beam, WHICHEVER IS GREATER." The floor gap is included by
  // definition. This was previously filed as an interpretation decision; it is
  // published basis.

  it('includes the floor-to-first-beam gap', () => {
    // Floor gap 60, then even 48 spacings. The floor gap governs.
    const hbl = governingHbl([inches(60), inches(108), inches(156)]);
    expect(convert(hbl, 'in')).toBe(60);
  });

  it('takes the largest inter-level gap when that is greater', () => {
    const hbl = governingHbl([inches(40), inches(88), inches(160)]);
    expect(convert(hbl, 'in')).toBe(72);
  });

  it('handles a single level as the floor gap alone', () => {
    expect(convert(governingHbl([inches(48)]), 'in')).toBe(48);
  });

  it('refuses descending elevations rather than returning a negative gap', () => {
    expect(() => governingHbl([inches(100), inches(60)])).toThrow(FrameCatalogError);
  });

  it('refuses an empty level list', () => {
    expect(() => governingHbl([])).toThrow(/at least one beam level/);
  });
});

describe('the loader refuses data that would silently shift a column', () => {
  const base = {
    table_id: 't',
    page_ref: 'p.8',
    load_basis: 'basis',
    column_order: ['a', 'b'],
    variants: [{ model: 'm', banded: false }],
    rows: { '36': [1, 2] },
  };

  it('refuses a short row, which would shift every capacity left', () => {
    expect(() => loadFrameTables({ tables: [{ ...base, rows: { '36': [1] } }] })).toThrow(
      /has 1 values but 2 columns/,
    );
  });

  it('refuses a non-integer or non-positive capacity', () => {
    expect(() => loadFrameTables({ tables: [{ ...base, rows: { '36': [1, 0] } }] })).toThrow(
      /non-positive-integer capacity/,
    );
    expect(() => loadFrameTables({ tables: [{ ...base, rows: { '36': [1, 2.5] } }] })).toThrow(
      /non-positive-integer capacity/,
    );
  });

  it('refuses a malformed HbL key', () => {
    expect(() => loadFrameTables({ tables: [{ ...base, rows: { abc: [1, 2] } }] })).toThrow(
      /is not a positive integer/,
    );
  });

  it('refuses missing structure outright', () => {
    expect(() => loadFrameTables(null)).toThrow(/must be an object/);
    expect(() => loadFrameTables({})).toThrow(/non-empty `tables`/);
    expect(() => loadFrameTables({ tables: [null] })).toThrow(/not an object/);
    expect(() => loadFrameTables({ tables: [{ ...base, table_id: '' }] })).toThrow(/table_id/);
    expect(() => loadFrameTables({ tables: [{ ...base, column_order: [] }] })).toThrow(
      /column_order/,
    );
    expect(() => loadFrameTables({ tables: [{ ...base, variants: [] }] })).toThrow(/variants/);
    expect(() => loadFrameTables({ tables: [{ ...base, variants: [null] }] })).toThrow(
      /variant 0 is not an object/,
    );
    expect(() => loadFrameTables({ tables: [{ ...base, rows: null }] })).toThrow(/rows/);
    expect(() => loadFrameTables({ tables: [{ ...base, rows: { '36': 5 } }] })).toThrow(
      /not an array of capacities/,
    );
  });
});

describe('capacity is basis-bound, as published', () => {
  it('is a pound value that carries its catalog origin', () => {
    const r = catalog.lookup({ model: '2.314', hbl: inches(36), overallHeight: inches(240) });
    if (r.status === 'ON_GRID') {
      expect(r.capacity.origin).toBe('CATALOG');
      expect(r.capacity.unit).toBe(pounds(1).unit);
    }
  });
});
