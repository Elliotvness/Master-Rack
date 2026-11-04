import { describe, expect, it } from 'vitest';

import {
  DXF_LAYERS,
  SUBMITTAL_13_SHEETS,
  dxfLayerForItemKind,
  exportDisplayListDxf,
} from './dxf.js';
import { dimension, displayList, line, point, rect, text } from './model.js';

describe('AutoCAD LT DXF Export & 13-Sheet Submittal Registry (I6, ADR-002, ADR-004)', () => {
  it('defines all 13 submittal sheets reconciled against the reference submittal set', () => {
    expect(SUBMITTAL_13_SHEETS).toHaveLength(13);
    expect(SUBMITTAL_13_SHEETS.map((s) => s.id)).toEqual([
      'R-001',
      'R-101',
      'R-102',
      'R-103',
      'R-104',
      'R-201',
      'R-202',
      'R-301',
      'R-302',
      'R-401',
      'R-501',
      'R-601',
      'R-602',
    ]);
  });

  it('maps every ItemKind to one of the 7 canonical DXF layers', () => {
    expect(dxfLayerForItemKind('upright')).toBe('FP_UPRIGHT');
    expect(dxfLayerForItemKind('beam')).toBe('FP_BEAM');
    expect(dxfLayerForItemKind('unit-load')).toBe('FP_LOAD');
    expect(dxfLayerForItemKind('flue')).toBe('FP_FLUE');
    expect(dxfLayerForItemKind('aisle')).toBe('FP_AISLE_CLEAR');
    expect(dxfLayerForItemKind('reference')).toBe('ANNO_DIM');
    expect(dxfLayerForItemKind('annotation')).toBe('ANNO_DIM');
    expect(dxfLayerForItemKind('obstruction')).toBe('BB_BORDER');
    expect(dxfLayerForItemKind('no-rack-zone')).toBe('BB_BORDER');
  });

  it('exports valid AC1015 DXF with all 7 layers, border, and ADR-002 screening notice', () => {
    const list = displayList({
      view: 'plan',
      extent: { width: 5_080_000, height: 5_080_000 },
      revisionHash: 'rev-hash-1',
      items: [
        rect({
          item: 'upright',
          id: 'u1',
          origin: point(0, 0),
          width: 2_438_400,
          height: 1_066_800,
          label: null,
        }),
        rect({
          item: 'flue',
          id: 'f1',
          origin: point(0, 1_066_800),
          width: 2_438_400,
          height: 152_400,
          label: { text: '0\'-6"', established: true },
        }),
        line({
          item: 'beam',
          id: 'b1',
          from: point(0, 0),
          to: point(2_438_400, 0),
        }),
        dimension({
          id: 'd1',
          from: point(0, 2_000_000),
          to: point(2_438_400, 2_000_000),
          text: { text: '8\'-0"', established: true },
        }),
        text({
          id: 't1',
          at: point(0, -254_000),
          text: { text: 'Run 1', established: true },
        }),
      ],
    });

    const dxf = exportDisplayListDxf(list);
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('DELEGATED DESIGN - SCREENING ONLY');
    for (const layerName of DXF_LAYERS) {
      expect(dxf).toContain(`\n2\n${layerName}\n`);
    }
    expect(dxf).toContain('0\nEOF');
  });
});
