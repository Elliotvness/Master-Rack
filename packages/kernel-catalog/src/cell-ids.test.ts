import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CELL_ID_DATASETS,
  CellIdError,
  cellIdsOf,
  distinctPublishedCount,
  publishedKeyOf,
} from './index.js';

const CATALOG = fileURLToPath(new URL('../../../data/catalog/', import.meta.url));
const read = (f: string): unknown =>
  JSON.parse(readFileSync(`${CATALOG}interlake-2026-09/${f}`, 'utf8'));

describe('cell ids are stable, findable and complete', () => {
  it('names a beam row the way the published chart does', () => {
    const ids = cellIdsOf('beams', read('beams.json'));
    expect(ids[0]).toBe('27E/F3M/48in');
    expect(ids).toHaveLength(336);
  });

  it('names a frame cell by table, height and column', () => {
    const ids = cellIdsOf('frames', read('frames.json'));
    expect(ids[0]).toMatch(/^cap_bolted_frames\/HbL\d+\/col\d+$/);
    expect(ids).toHaveLength(435);
  });

  it('every id is unique — a repeat would let one reading stand for two cells', () => {
    for (const dataset of CELL_ID_DATASETS) {
      const ids = cellIdsOf(dataset, read(`${dataset}.json`));
      expect(new Set(ids).size, `${dataset} has a repeated id`).toBe(ids.length);
    }
  });

  it('is a pure function of the document — same input, same ids', () => {
    const doc = read('beams.json');
    expect(cellIdsOf('beams', doc)).toEqual(cellIdsOf('beams', doc));
  });

  it('refuses an unknown dataset rather than returning nothing', () => {
    // An empty list would make the gate's sample comparison vacuous, which is
    // the failure this module exists to prevent.
    expect(() => cellIdsOf('anchors', { rows: [] })).toThrow(CellIdError);
    expect(() => cellIdsOf('anchors', { rows: [] })).toThrow(/no cell-id derivation/);
  });

  it('names the field and the index when a document is malformed', () => {
    expect(() => cellIdsOf('beams', {})).toThrow(/expected an object with a 'rows' array/);
    expect(() => cellIdsOf('beams', { rows: [{ family: 'x', series: 'y' }] })).toThrow(
      /rows\[0\] needs family, series and span_in/,
    );
    expect(() => cellIdsOf('beams', { rows: ['nope'] })).toThrow(/rows\[0\] is not an object/);
    expect(() => cellIdsOf('frames', {})).toThrow(/expected an object with a 'tables' array/);
    expect(() => cellIdsOf('frames', { tables: [{}] })).toThrow(/needs a string table_id/);
    expect(() => cellIdsOf('frames', { tables: [{ table_id: 't' }] })).toThrow(
      /t needs a rows object/,
    );
    expect(() => cellIdsOf('frames', { tables: [{ table_id: 't', rows: { 36: 5 } }] })).toThrow(
      /t\/HbL36 is not an array/,
    );
    expect(() => cellIdsOf('frames', { tables: ['nope'] })).toThrow(/tables\[0\] is not an object/);
  });
});

describe('publishedKeyOf — which rows are one printed reading', () => {
  it('collapses an R-suffixed beam family onto its base', () => {
    // p.88 prints one column headed `59E / 59ER`.
    expect(publishedKeyOf('beams', '59ER/F5M/120in')).toBe('59E/F5M/120in');
    expect(publishedKeyOf('beams', '59E/F5M/120in')).toBe('59E/F5M/120in');
    expect(publishedKeyOf('beams', '65QR/F5M/54in')).toBe('65Q/F5M/54in');
  });

  it('leaves a frame cell alone — a table/HbL/column triple is one printed cell', () => {
    expect(publishedKeyOf('frames', 'cap_bolted_frames/HbL42/col3')).toBe(
      'cap_bolted_frames/HbL42/col3',
    );
  });

  it('refuses a malformed beam id and an unknown dataset', () => {
    expect(() => publishedKeyOf('beams', 'nope')).toThrow(/not a family\/series\/span cell id/);
    expect(() => publishedKeyOf('anchors', 'x/y/z')).toThrow(/no published-key rule/);
  });

  it('counts the whole extract as half its rows', () => {
    // 336 beam rows, 168 published values, every R row identical to its base.
    const ids = cellIdsOf('beams', read('beams.json'));
    expect(ids).toHaveLength(336);
    expect(distinctPublishedCount('beams', ids)).toBe(168);

    const frames = cellIdsOf('frames', read('frames.json'));
    expect(distinctPublishedCount('frames', frames)).toBe(frames.length);
  });
});
