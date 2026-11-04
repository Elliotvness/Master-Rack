/**
 * Cascading catalog options for the studio parameter panel (Phase 1 Item 1 — I1 / MS-2).
 *
 * Backed by the reconciled `interlake-2026-09` PSG 2025 release (16 beam families,
 * 3 connector series, 21 published spans, 3 frame tables) and the 8-row
 * `forklift-planning-2026.09` planning seed pack (`isPlanningValue: true`,
 * `missingSources: ['MS-6', 'MS-14']`).
 *
 * Enforces:
 *   1. Zero interpolation on beam spans: an off-grid span returns both
 *      bracketing published spans (`lowerSpanIn`, `upperSpanIn`) and `capacityLb: null`.
 *   2. Unapproved / retired release refusal unless an explicit override is passed.
 *   3. Exact micrometre conversion for all catalog dimensions (`uprightWidthUm`,
 *      `frameDepthUm`, `spanUm`, `planningAstUm`).
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { IN, type Micrometres } from './length.js';

export interface CatalogReleaseOption {
  readonly id: string;
  readonly label: string;
  readonly status: 'APPROVED' | 'DRAFT' | 'SUPERSEDED' | 'RETIRED';
}

export const PUBLISHED_CATALOG_RELEASES: readonly CatalogReleaseOption[] = Object.freeze([
  {
    id: 'interlake-2026-09',
    label: 'Interlake Mecalux PSG 2025 (interlake-2026-09 · APPROVED)',
    status: 'APPROVED',
  },
  {
    id: 'interlake-2026-08',
    label: 'Interlake Mecalux 2026-08 (DRAFT · Superseded)',
    status: 'DRAFT',
  },
]);

export function canUseCatalogRelease(
  releaseId: string,
  allowUnapprovedOverride = false,
): { readonly allowed: boolean; readonly reason: string | null } {
  const found = PUBLISHED_CATALOG_RELEASES.find((r) => r.id === releaseId);
  if (found === undefined) {
    return {
      allowed: false,
      reason: `Catalog release '${releaseId}' is not in the authority registry.`,
    };
  }
  if (found.status !== 'APPROVED' && !allowUnapprovedOverride) {
    return {
      allowed: false,
      reason: `Catalog release '${releaseId}' has status ${found.status} and cannot be pinned without an explicit override.`,
    };
  }
  return { allowed: true, reason: null };
}

export interface FrameOption {
  readonly id: string;
  readonly tableId: 'cap_bolted_frames' | 'cap_bolted_reinforced_frames' | 'cap_welded_frames';
  readonly model: string;
  readonly post: string;
  readonly label: string;
  readonly uprightWidthIn: 3 | 4;
  readonly uprightWidthUm: Micrometres;
}

export const PUBLISHED_FRAME_OPTIONS: readonly FrameOption[] = Object.freeze([
  {
    id: '3x3 ROLL-FORMED',
    tableId: 'cap_bolted_frames',
    model: '2.314',
    post: 'TD U314',
    label: 'Bolted 2.314 (TD U314 · 14 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: '3x1.625 ROLL-FORMED',
    tableId: 'cap_bolted_frames',
    model: '2.313',
    post: 'TD U313',
    label: 'Bolted 2.313 (TD U313 · 13 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'BOLTED 2.312 (TD U312)',
    tableId: 'cap_bolted_frames',
    model: '2.312',
    post: 'TD U312',
    label: 'Bolted 2.312 (TD U312 · 12 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'BOLTED 2.101 (TD U101)',
    tableId: 'cap_bolted_frames',
    model: '2.101',
    post: 'TD U101',
    label: 'Bolted 2.101 (TD U101 · 13 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'BOLTED 2.102 (TD U102)',
    tableId: 'cap_bolted_frames',
    model: '2.102',
    post: 'TD U102',
    label: 'Bolted 2.102 (TD U102 · 12 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'REINFORCED 314+314',
    tableId: 'cap_bolted_reinforced_frames',
    model: '314+314',
    post: 'TD 314+314',
    label: 'Reinforced Bolted 314+314 (14 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'REINFORCED 312+312',
    tableId: 'cap_bolted_reinforced_frames',
    model: '312+312',
    post: 'TD 312+312',
    label: 'Reinforced Bolted 312+312 (12 ga · 3" face)',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'WELDED FR.2.70F (3x3)',
    tableId: 'cap_welded_frames',
    model: 'FR.2.70F',
    post: 'IE070F',
    label: 'Welded FR.2.70F (IE070F · 14 ga · 3"×3")',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: 'WELDED FR.2.75F (3x3)',
    tableId: 'cap_welded_frames',
    model: 'FR.2.75F',
    post: 'IE075F',
    label: 'Welded FR.2.75F (IE075F · 13 ga · 3"×3")',
    uprightWidthIn: 3,
    uprightWidthUm: IN(3),
  },
  {
    id: '4x3 STRUCTURAL',
    tableId: 'cap_welded_frames',
    model: 'FR.2.95F',
    post: 'IE095F',
    label: 'Welded FR.2.95F (IE095F · 13 ga · 4"×3" face)',
    uprightWidthIn: 4,
    uprightWidthUm: IN(4),
  },
  {
    id: 'WELDED FR.2.99F (4x3)',
    tableId: 'cap_welded_frames',
    model: 'FR.2.99F',
    post: 'IE099F',
    label: 'Welded FR.2.99F (IE099F · 11 ga · 4"×3" face)',
    uprightWidthIn: 4,
    uprightWidthUm: IN(4),
  },
]);

export function lookupFrameOption(idOrModel: string): FrameOption | undefined {
  return PUBLISHED_FRAME_OPTIONS.find((f) => f.id === idOrModel || f.model === idOrModel);
}

export interface FrameDepthOption {
  readonly depthIn: 36 | 42 | 48;
  readonly depthUm: Micrometres;
  readonly label: string;
}

export const PUBLISHED_FRAME_DEPTHS_IN = Object.freeze([36, 42, 48] as const);

export const PUBLISHED_FRAME_DEPTH_OPTIONS: readonly FrameDepthOption[] = Object.freeze([
  { depthIn: 36, depthUm: IN(36), label: '36 in (Standard 40" pallet w/ 2" overhang)' },
  { depthIn: 42, depthUm: IN(42), label: '42 in (Standard 48" GMA pallet w/ 3" overhang)' },
  { depthIn: 48, depthUm: IN(48), label: '48 in (Flush 48" pallet)' },
]);

export type BeamConnectorSeries = 'F3M' | 'F4M' | 'F5M';

export interface BeamFamilyOption {
  readonly family: string;
  readonly baseFamily: '27E' | '36E' | '40E' | '45E' | '50E' | '59E' | '65E' | '65Q';
  readonly series: BeamConnectorSeries;
  readonly faceHeightIn: number;
  readonly slotted: boolean;
  readonly label: string;
}

export const PUBLISHED_BEAM_SPANS_IN = Object.freeze([
  48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156, 162, 168,
] as const);

const BASE_COLUMNS = Object.freeze([
  '27E',
  '36E',
  '40E',
  '45E',
  '50E',
  '59E',
  '65E',
  '65Q',
] as const);

/** PSG 2025 p.88 capacity chart in lb/pair (21 spans × 8 base family columns). */
const PSG_CAPACITY_CHART: readonly (readonly number[])[] = Object.freeze([
  [5610, 8050, 9810, 11090, 12880, 16910, 17115, 27940], // 48"
  [5080, 7230, 8830, 9950, 11530, 15140, 17110, 24940], // 54"
  [4640, 6570, 8040, 9050, 10460, 13720, 15850, 22540], // 60"
  [4290, 6030, 7390, 8300, 9580, 12560, 14480, 20570], // 66"
  [3990, 5590, 6850, 7680, 8850, 11590, 13360, 18940], // 72"
  [3510, 5210, 6390, 7150, 8220, 10780, 12400, 17550], // 78"
  [3080, 4880, 6010, 6700, 7690, 10080, 11580, 16370], // 84"
  [2630, 4510, 5560, 6190, 7090, 9280, 10650, 15030], // 92"
  [2440, 4170, 5370, 5960, 6820, 8940, 10240, 14430], // 96"
  [2200, 3740, 4870, 5650, 6470, 8460, 9690, 13640], // 102"
  [1990, 3370, 4390, 5380, 6150, 8040, 9190, 12920], // 108"
  [1810, 3050, 3990, 5040, 5870, 7660, 8760, 12300], // 114"
  [1660, 2780, 3640, 4590, 5610, 7330, 8370, 11730], // 120"
  [1530, 2550, 3340, 4210, 5230, 7020, 8000, 11210], // 126"
  [1410, 2350, 3080, 3870, 4800, 6740, 7680, 10750], // 132"
  [1310, 2170, 2850, 3570, 4420, 6490, 7380, 10310], // 138"
  [1220, 2010, 2650, 3310, 4100, 6250, 7110, 9920], // 144"
  [1140, 1870, 2470, 3080, 3800, 5820, 6850, 9560], // 150"
  [1070, 1740, 2300, 2870, 3540, 5420, 6630, 9040], // 156"
  [1000, 1630, 2160, 2690, 3310, 5060, 6250, 8420], // 162"
  [940, 1530, 2030, 2520, 3100, 4740, 5840, 7870], // 168"
]);

export const PUBLISHED_BEAM_FAMILIES: readonly BeamFamilyOption[] = Object.freeze([
  { family: '27E', baseFamily: '27E', series: 'F3M', faceHeightIn: 2.75, slotted: false, label: '27E · F3M (2.75" face)' },
  { family: '27ER', baseFamily: '27E', series: 'F3M', faceHeightIn: 2.75, slotted: true, label: '27ER Slotted · F3M (2.75" face)' },
  { family: '36E', baseFamily: '36E', series: 'F3M', faceHeightIn: 3.65625, slotted: false, label: '36E · F3M (3 21/32" face)' },
  { family: '36ER', baseFamily: '36E', series: 'F3M', faceHeightIn: 3.65625, slotted: true, label: '36ER Slotted · F3M (3 21/32" face)' },
  { family: '40E', baseFamily: '40E', series: 'F4M', faceHeightIn: 4, slotted: false, label: '40E · F4M (4.0" face)' },
  { family: '40ER', baseFamily: '40E', series: 'F4M', faceHeightIn: 4, slotted: true, label: '40ER Slotted · F4M (4.0" face)' },
  { family: '45E', baseFamily: '45E', series: 'F4M', faceHeightIn: 4.5, slotted: false, label: '45E · F4M (4.5" face)' },
  { family: '45ER', baseFamily: '45E', series: 'F4M', faceHeightIn: 4.5, slotted: true, label: '45ER Slotted · F4M (4.5" face)' },
  { family: '50E', baseFamily: '50E', series: 'F4M', faceHeightIn: 5, slotted: false, label: '50E · F4M (5.0" face)' },
  { family: '50ER', baseFamily: '50E', series: 'F4M', faceHeightIn: 5, slotted: true, label: '50ER Slotted · F4M (5.0" face)' },
  { family: '59E', baseFamily: '59E', series: 'F5M', faceHeightIn: 5.9375, slotted: false, label: '59E · F5M (5 15/16" face)' },
  { family: '59ER', baseFamily: '59E', series: 'F5M', faceHeightIn: 5.9375, slotted: true, label: '59ER Slotted · F5M (5 15/16" face)' },
  { family: '65E', baseFamily: '65E', series: 'F5M', faceHeightIn: 6.5625, slotted: false, label: '65E · F5M (6 9/16" face)' },
  { family: '65ER', baseFamily: '65E', series: 'F5M', faceHeightIn: 6.5625, slotted: true, label: '65ER Slotted · F5M (6 9/16" face)' },
  { family: '65Q', baseFamily: '65Q', series: 'F5M', faceHeightIn: 6.5625, slotted: false, label: '65Q Box · F5M (6 9/16" face)' },
  { family: '65QR', baseFamily: '65Q', series: 'F5M', faceHeightIn: 6.5625, slotted: true, label: '65QR Slotted Box · F5M (6 9/16" face)' },
]);

export type PublishedBeamSpanResult =
  | {
      readonly status: 'ON_GRID';
      readonly family: string;
      readonly series: BeamConnectorSeries;
      readonly spanIn: number;
      readonly spanUm: Micrometres;
      readonly capacityLb: number;
      readonly faceHeightIn: number;
      readonly beamPartLabel: string;
    }
  | {
      readonly status: 'OFF_GRID';
      readonly family: string;
      readonly series: BeamConnectorSeries;
      readonly requestedSpanIn: number;
      readonly lowerSpanIn: number | null;
      readonly upperSpanIn: number | null;
      readonly capacityLb: null;
    }
  | {
      readonly status: 'NOT_FOUND';
      readonly reason: string;
    };

/**
 * Look up a beam family and span in `interlake-2026-09` with zero interpolation.
 *
 * If `spanIn` is not one of the 21 published spans, returns `OFF_GRID` with the
 * immediate lower and upper published spans and `capacityLb: null`.
 */
export function lookupPublishedBeamSpan(
  family: string,
  spanIn: number,
): PublishedBeamSpanResult {
  const fam = PUBLISHED_BEAM_FAMILIES.find((f) => f.family === family);
  if (fam === undefined) {
    return {
      status: 'NOT_FOUND',
      reason: `Beam family '${family}' is not published in interlake-2026-09.`,
    };
  }

  const colIdx = BASE_COLUMNS.indexOf(fam.baseFamily);
  const rowIdx = PUBLISHED_BEAM_SPANS_IN.indexOf(
    spanIn as (typeof PUBLISHED_BEAM_SPANS_IN)[number],
  );
  if (rowIdx >= 0) {
    const capacityLb = PSG_CAPACITY_CHART[rowIdx]?.[colIdx] as number;
    return {
      status: 'ON_GRID',
      family: fam.family,
      series: fam.series,
      spanIn,
      spanUm: IN(spanIn),
      capacityLb,
      faceHeightIn: fam.faceHeightIn,
      beamPartLabel: `${spanIn}" ${fam.family} (${fam.series}) STEP BEAM`,
    };
  }

  let lowerSpanIn: number | null = null;
  let upperSpanIn: number | null = null;
  for (const s of PUBLISHED_BEAM_SPANS_IN) {
    if (s < spanIn) lowerSpanIn = s;
    if (s > spanIn && upperSpanIn === null) upperSpanIn = s;
  }

  return {
    status: 'OFF_GRID',
    family: fam.family,
    series: fam.series,
    requestedSpanIn: spanIn,
    lowerSpanIn,
    upperSpanIn,
    capacityLb: null,
  };
}

/**
 * Parse a `BayType.beamPart` string (e.g. `'96" 45E (F4M) STEP BEAM'` or legacy `'96" STEP BEAM'`)
 * back to its published family, falling back to `'45E'` when legacy strings omit the family.
 */
export function beamFamilyFromPartLabel(beamPart: string): string {
  for (const fam of PUBLISHED_BEAM_FAMILIES) {
    const pattern = new RegExp(`\\b${fam.family}\\b`);
    if (pattern.test(beamPart)) return fam.family;
  }
  return '45E';
}

export interface ForkliftPlanningOption {
  readonly id: string;
  readonly truckType: string;
  readonly manufacturerBand: string;
  readonly planningAstIn: number;
  readonly planningAstUm: Micrometres;
  readonly planningTurningRadiusIn: number;
  readonly isPlanningValue: true;
  readonly missingSources: readonly ['MS-6', 'MS-14'];
}

export const FORKLIFT_PLANNING_OPTIONS: readonly ForkliftPlanningOption[] = Object.freeze([
  {
    id: 'sitdown-cb-4wheel',
    truckType: 'Sit-down counterbalance',
    manufacturerBand: 'Toyota 8FGCU25 / Crown C-5 (4-Wheel Sit-Down CB)',
    planningAstIn: 144,
    planningAstUm: IN(144),
    planningTurningRadiusIn: 84,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'sitdown-cb-3wheel',
    truckType: '3-Wheel sit-down counterbalance',
    manufacturerBand: 'Toyota 8FBE15U / Crown SC (3-Wheel Sit-Down CB)',
    planningAstIn: 132,
    planningAstUm: IN(132),
    planningTurningRadiusIn: 63,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'standup-counterbalance',
    truckType: 'Stand-up counterbalance',
    manufacturerBand: 'Crown RC 5700 / Raymond 4250 (Stand-Up CB)',
    planningAstIn: 126,
    planningAstUm: IN(126),
    planningTurningRadiusIn: 61,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'standup-reach',
    truckType: 'Stand-up reach',
    manufacturerBand: 'Raymond 7500 / Crown RM 6000 (Single-Reach)',
    planningAstIn: 108,
    planningAstUm: IN(108),
    planningTurningRadiusIn: 71,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'deep-reach',
    truckType: 'Deep reach',
    manufacturerBand: 'Raymond 7520 / Crown RD 5700 (Pantograph Deep-Reach)',
    planningAstIn: 126,
    planningAstUm: IN(126),
    planningTurningRadiusIn: 81,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'straddle-reach',
    truckType: 'Straddle reach',
    manufacturerBand: 'Crown RS / Raymond 7300 (Moving-Mast Straddle)',
    planningAstIn: 102,
    planningAstUm: IN(102),
    planningTurningRadiusIn: 68,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'articulated-narrow',
    truckType: 'Articulated narrow-aisle',
    manufacturerBand: 'Aisle-Master 20SE / Narrow-Aisle Flexi',
    planningAstIn: 78,
    planningAstUm: IN(78),
    planningTurningRadiusIn: 76,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
  {
    id: 'turret-vna',
    truckType: 'Turret / VNA',
    manufacturerBand: 'Raymond 9600 / Crown TSP (Man-Up Turret VNA)',
    planningAstIn: 66,
    planningAstUm: IN(66),
    planningTurningRadiusIn: 96,
    isPlanningValue: true,
    missingSources: ['MS-6', 'MS-14'],
  },
]);

export function lookupForkliftPlanningOption(
  truckTypeOrId: string,
): ForkliftPlanningOption | undefined {
  return FORKLIFT_PLANNING_OPTIONS.find(
    (f) => f.truckType === truckTypeOrId || f.id === truckTypeOrId,
  );
}
