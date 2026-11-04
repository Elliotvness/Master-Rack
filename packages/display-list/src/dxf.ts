/**
 * AutoCAD LT DXF Export & 13-Sheet Submittal Registry (Phase 2 Step 2.4 — I6, ADR-002, ADR-004).
 *
 * Emits layered AutoCAD LT R2000 (AC1015) DXF from a renderer-neutral DisplayList
 * across the 7 canonical CAD layers:
 * - `FP_UPRIGHT`
 * - `FP_BEAM`
 * - `FP_LOAD`
 * - `FP_FLUE`
 * - `FP_AISLE_CLEAR`
 * - `ANNO_DIM`
 * - `BB_BORDER`
 *
 * Every DXF and every submittal sheet carries the mandatory ADR-002 delegated-design
 * screening boundary notice (`DELEGATED DESIGN — SCREENING ONLY`).
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { DisplayItem, DisplayList, ItemKind } from './model.js';

export const DXF_LAYERS = Object.freeze([
  'FP_UPRIGHT',
  'FP_BEAM',
  'FP_LOAD',
  'FP_FLUE',
  'FP_AISLE_CLEAR',
  'ANNO_DIM',
  'BB_BORDER',
] as const);

export type DxfLayer = (typeof DXF_LAYERS)[number];

export type SubmittalSheetId =
  | 'R-001'
  | 'R-101'
  | 'R-102'
  | 'R-103'
  | 'R-104'
  | 'R-201'
  | 'R-202'
  | 'R-301'
  | 'R-302'
  | 'R-401'
  | 'R-501'
  | 'R-601'
  | 'R-602';

export interface SubmittalSheetSpec {
  readonly id: SubmittalSheetId;
  readonly title: string;
  readonly subtitle: string;
  readonly category: 'cover' | 'plan' | 'elevation' | 'detail' | 'plaque' | 'schedule' | 'audit';
}

/**
 * Reconciled 13-sheet submittal & commercial set (`I6`, `RackLayoutandCoordinationSet13SheetsRevised.pdf`).
 */
export const SUBMITTAL_13_SHEETS: readonly SubmittalSheetSpec[] = Object.freeze([
  {
    id: 'R-001',
    title: 'COVER SHEET, GENERAL NOTES & CODE SUMMARY',
    subtitle: 'Sheet index, authority pack pins, storage height chain, and delegated-design scope',
    category: 'cover',
  },
  {
    id: 'R-101',
    title: 'OVERALL RACK FLOOR PLAN',
    subtitle: 'Plan geometry, bay layout, and dual aisle datums',
    category: 'plan',
  },
  {
    id: 'R-102',
    title: 'ENLARGED AISLE & FLUE DIMENSION PLAN',
    subtitle: 'Operational aisle clearance, longitudinal flues, and transverse flue spacing',
    category: 'plan',
  },
  {
    id: 'R-103',
    title: 'COLUMN GRID, PROTECTION & STRADDLE PLAN',
    subtitle: 'Building column grid, guard envelopes (MS-4), and column-in-flue locations',
    category: 'plan',
  },
  {
    id: 'R-104',
    title: 'DOOR, DOCK & STAGING CLEARANCE PLAN',
    subtitle: 'Dock approach zones (MS-9), turning radii (MS-7), and perimeter wall clearances',
    category: 'plan',
  },
  {
    id: 'R-201',
    title: 'TYPICAL BAY ELEVATION & HbL PROFILE',
    subtitle: 'Beam levels from slab datum, unsupported span HbL, and overhead clearances',
    category: 'elevation',
  },
  {
    id: 'R-202',
    title: 'TUNNEL & SPECIAL BAY ELEVATIONS',
    subtitle: 'Cross-aisle tunnel bays (MS-1) and special clearance elevations',
    category: 'elevation',
  },
  {
    id: 'R-301',
    title: 'FRAME POST, BASEPLATE & BRACING DETAILS',
    subtitle: 'Upright post section, baseplate anchor layout, and row spacer schedule',
    category: 'detail',
  },
  {
    id: 'R-302',
    title: 'BEAM CONNECTOR, PISTON LOCK & DECKING DETAILS',
    subtitle: 'Step-beam connector engagement, drop-pin safety lock, and wire decking',
    category: 'detail',
  },
  {
    id: 'R-401',
    title: 'RMI LOAD PLAQUE ARTWORK (MIN. 50 SQ IN.)',
    subtitle: 'ANSI/RMI MH16.1 §1.4.2 load capacity plaque artwork and maximum unit load limits',
    category: 'plaque',
  },
  {
    id: 'R-501',
    title: 'EQUIPMENT & COMPONENT SCHEDULE',
    subtitle: 'Pinned catalog releases, bay schedule, and forklift planning assumptions',
    category: 'schedule',
  },
  {
    id: 'R-601',
    title: 'COMPLIANCE SCREENING AUDIT ATTACHMENT',
    subtitle: 'Full rule-by-rule screening findings, citation tiers, and missing-source schedule',
    category: 'audit',
  },
  {
    id: 'R-602',
    title: 'ATTRIBUTED BOM TAKEOFF SCHEDULE',
    subtitle: 'Provenanced component quantities and unresolved accessory register',
    category: 'schedule',
  },
]);

const MICROMETRES_PER_INCH = 25_400;

function toInches(um: number): string {
  return (um / MICROMETRES_PER_INCH).toFixed(4);
}

/**
 * Map a DisplayList `ItemKind` to its canonical AutoCAD LT DXF layer.
 */
export function dxfLayerForItemKind(kind: ItemKind): DxfLayer {
  switch (kind) {
    case 'upright':
      return 'FP_UPRIGHT';
    case 'beam':
      return 'FP_BEAM';
    case 'unit-load':
      return 'FP_LOAD';
    case 'flue':
      return 'FP_FLUE';
    case 'aisle':
      return 'FP_AISLE_CLEAR';
    case 'reference':
    case 'annotation':
      return 'ANNO_DIM';
    case 'obstruction':
    case 'no-rack-zone':
      return 'BB_BORDER';
  }
}

function dxfLine(layer: DxfLayer, x1Um: number, y1Um: number, x2Um: number, y2Um: number): string {
  return [
    '0',
    'LINE',
    '8',
    layer,
    '10',
    toInches(x1Um),
    '20',
    toInches(y1Um),
    '30',
    '0.0',
    '11',
    toInches(x2Um),
    '21',
    toInches(y2Um),
    '31',
    '0.0',
  ].join('\n');
}

function dxfText(layer: DxfLayer, xUm: number, yUm: number, heightIn: number, content: string): string {
  return [
    '0',
    'TEXT',
    '8',
    layer,
    '10',
    toInches(xUm),
    '20',
    toInches(yUm),
    '30',
    '0.0',
    '40',
    heightIn.toFixed(2),
    '1',
    content,
  ].join('\n');
}

function emitItemEntities(item: DisplayItem): readonly string[] {
  const layer = dxfLayerForItemKind(item.item);
  if (item.kind === 'rect') {
    const x0 = item.origin.x;
    const y0 = item.origin.y;
    const x1 = x0 + item.width;
    const y1 = y0 + item.height;
    const out = [
      dxfLine(layer, x0, y0, x1, y0),
      dxfLine(layer, x1, y0, x1, y1),
      dxfLine(layer, x1, y1, x0, y1),
      dxfLine(layer, x0, y1, x0, y0),
    ];
    if (item.label !== null) {
      out.push(dxfText('ANNO_DIM', x0 + Math.trunc(item.width / 2), y0 + Math.trunc(item.height / 2), 4.0, item.label.text));
    }
    return out;
  }
  if (item.kind === 'line') {
    return [dxfLine(layer, item.from.x, item.from.y, item.to.x, item.to.y)];
  }
  if (item.kind === 'dimension') {
    const midX = Math.trunc((item.from.x + item.to.x) / 2);
    const midY = Math.trunc((item.from.y + item.to.y) / 2);
    return [
      dxfLine('ANNO_DIM', item.from.x, item.from.y, item.to.x, item.to.y),
      dxfText('ANNO_DIM', midX, midY, 5.0, item.text.text),
    ];
  }
  return [dxfText('ANNO_DIM', item.at.x, item.at.y, 6.0, item.text.text)];
}

/**
 * Export a renderer-neutral `DisplayList` as a layered AutoCAD LT DXF string (ADR-004).
 */
export function exportDisplayListDxf(list: DisplayList, projectTitle = 'RACK STUDIO'): string {
  const sections: string[] = [
    '999',
    `RACK STUDIO DXF EXPORT - ${projectTitle} - ${list.revisionHash}`,
    '999',
    'DELEGATED DESIGN - SCREENING ONLY: DOES NOT REPLACE A LICENSED PE STAMP (ADR-002)',
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1015',
    '9',
    '$INSUNITS',
    '70',
    '1',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'TABLES',
    '0',
    'TABLE',
    '2',
    'LAYER',
    '70',
    String(DXF_LAYERS.length),
  ];

  for (const [idx, layerName] of DXF_LAYERS.entries()) {
    sections.push(
      '0',
      'LAYER',
      '2',
      layerName,
      '70',
      '0',
      '62',
      String((idx % 7) + 1),
      '6',
      'CONTINUOUS',
    );
  }

  sections.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');

  // Border box on BB_BORDER
  const w = Math.max(list.extent.width, 2_540_000);
  const h = Math.max(list.extent.height, 2_540_000);
  sections.push(
    dxfLine('BB_BORDER', 0, 0, w, 0),
    dxfLine('BB_BORDER', w, 0, w, h),
    dxfLine('BB_BORDER', w, h, 0, h),
    dxfLine('BB_BORDER', 0, h, 0, 0),
    dxfText(
      'BB_BORDER',
      0,
      -508_000,
      6.0,
      `DELEGATED DESIGN - SCREENING ONLY (NO PE SEAL) - ${projectTitle} [${list.revisionHash}]`,
    ),
  );

  for (const item of list.items) {
    sections.push(...emitItemEntities(item));
  }

  sections.push('0', 'ENDSEC', '0', 'EOF');
  return sections.join('\n');
}
