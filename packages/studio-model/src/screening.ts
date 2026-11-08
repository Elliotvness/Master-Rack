/**
 * Screening findings for one document — the rows the studio's Checks view and
 * its Layout checks drawer show (ADR-020).
 *
 * WHY THIS IS HERE AND NOT IN THE STUDIO (F-70). Until 2026-11-06 this logic
 * ran inline in a `useMemo` inside `apps/studio-web/src/routes/screening.tsx`.
 * `check-app-boundaries` forbids the studio bundle from binding a `derive*`
 * name because "a studio that re-derives its own geometry is a second kernel"
 * (ADR-016) — and an unnamed closure has no name to forbid, so the rule never
 * saw it. Extracting it for the drawer gave it a name and the checker refused
 * it. The remedy is not a new name in the studio: it is this package, the pure
 * layer the studio already calls for `planGeometry`, `proposeFixes` and
 * `quoteReadinessForDocument`, which the server can load unchanged.
 *
 * What this does NOT settle, and F-70 records: whether findings should reach the
 * studio from `@rms/kernel-checks` via the server instead. The S5 slice owns that.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { beamFamilyFromPartLabel, lookupPublishedBeamSpan } from './catalog-options.js';
import type { StudioDocument } from './document.js';
import { MICROMETRES_PER_INCH } from './length.js';
import { planGeometry } from './plan.js';

export type FindingSeverity = 'BLOCKING' | 'REVIEW' | 'MISSING_INPUT' | 'MISSING_SOURCE' | 'PASS';

export interface ScreeningFindingRow {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly subject: string;
  readonly summary: string;
  readonly closureText: string;
}

function umToIn(um: number): number {
  return Math.round(um / MICROMETRES_PER_INCH);
}

/**
 * Inches for a CLEARANCE message, to a tenth when a whole number would lie.
 *
 * F-68: the fixture's aisle clears 126" and the truck needs 126.3" (66.3" RAS +
 * 60"). Rounded to whole inches both read 126, so the finding said "126" vs
 * required 126"" and called that BLOCKING — a true result reported as a
 * contradiction. A comparison is made on micrometres; the words must not undo it.
 */
export function inchesForComparison(um: number): string {
  const tenths = Math.round((um / MICROMETRES_PER_INCH) * 10) / 10;
  return Number.isInteger(tenths) ? `${tenths}"` : `${tenths.toFixed(1)}"`;
}

export function screeningFindingsForDocument(doc: StudioDocument): readonly ScreeningFindingRow[] {
  const plan = planGeometry(doc);
  const rows: ScreeningFindingRow[] = [];

  // 1. Draft rule-pack ceiling check
  const isDraftRulePack = doc.packs.structural.includes('mvp-2026-08');
  rows.push({
    code: 'RULE_PACK_AUTHORITY',
    severity: isDraftRulePack ? 'REVIEW' : 'PASS',
    subject: `Pack ${doc.packs.structural}`,
    summary: isDraftRulePack
      ? `Rule pack ${doc.packs.structural} is DRAFT; all PASS outcomes are capped at REVIEW.`
      : `Rule pack ${doc.packs.structural} is two-person APPROVED (DEC-DF active).`,
    closureText: isDraftRulePack
      ? 'Pin an approved rule pack (studio-2026.09) to unlock PASS outcomes.'
      : 'Two-person approval verified.',
  });

  // 2. Aisle clearance checks
  const requiredClearUm = doc.equipment.truckRAS.value + 60 * MICROMETRES_PER_INCH;
  plan.aisles.forEach((aisle, index) => {
    const clearIn = inchesForComparison(aisle.clearBetweenLoads.value);
    const reqIn = inchesForComparison(requiredClearUm);
    // People read "Aisle 1", not the geometry id; aisles are numbered in plan order.
    const name = `Aisle ${index + 1}`;
    if (aisle.clearBetweenLoads.value < requiredClearUm) {
      rows.push({
        code: 'AISLE_CLEAR_SHORTFALL',
        severity: 'BLOCKING',
        subject: name,
        summary: `Clear between loads is ${clearIn}; the truck needs ${reqIn} (RAS + 60").`,
        closureText: `Widen frame-to-frame spacing or select a narrower reach truck.`,
      });
    } else {
      rows.push({
        code: 'AISLE_CLEAR_OK',
        severity: doc.equipment.truckRAS.established === 'UNKNOWN' ? 'MISSING_INPUT' : 'PASS',
        subject: name,
        summary: `Clear between loads is ${clearIn} (needs ${reqIn}).`,
        closureText:
          doc.equipment.truckRAS.established === 'UNKNOWN'
            ? 'Verify forklift right-angle stack (RAS) from OEM spec sheet.'
            : 'Meets operational aisle target.',
      });
    }
  });

  // 3. Bay-type beam span & capacity checks
  for (const bt of doc.bayTypes) {
    const family = beamFamilyFromPartLabel(bt.beamPart);
    const spanIn = umToIn(bt.beamLength);
    const spanLookup = lookupPublishedBeamSpan(family, spanIn);
    if (spanLookup.status === 'OFF_GRID') {
      rows.push({
        code: 'BEAM_SPAN_OFF_GRID',
        severity: 'REVIEW',
        subject: bt.name,
        summary: `Beam span ${spanIn}" is off-grid for ${family} (brackets: ${spanLookup.lowerSpanIn ?? 'min'}"–${spanLookup.upperSpanIn ?? 'max'}").`,
        closureText: 'Snap to a published span or obtain manufacturer engineering approval.',
      });
    }

    const demandLb = doc.unitLoad.weight * bt.palletsPerBay * doc.loadDistributionFactor;
    if (bt.beamPairCapacity.value < demandLb) {
      rows.push({
        code: 'BEAM_CAPACITY_EXCEEDED',
        severity: 'BLOCKING',
        subject: bt.name,
        summary: `Beam pair capacity ${bt.beamPairCapacity.value.toLocaleString()} lb < demand ${Math.round(demandLb).toLocaleString()} lb.`,
        closureText: 'Step up beam family or reduce unit load weight.',
      });
    } else {
      rows.push({
        code: 'BEAM_CAPACITY_OK',
        severity: bt.beamPairCapacity.established === 'UNKNOWN' ? 'MISSING_INPUT' : 'PASS',
        subject: bt.name,
        summary: `Beam pair capacity ${bt.beamPairCapacity.value.toLocaleString()} lb >= demand ${Math.round(demandLb).toLocaleString()} lb.`,
        closureText: 'Published catalog pair capacity satisfied.',
      });
    }

    if (bt.frameDepth > 0 && bt.frameHeight.value / bt.frameDepth > 6) {
      const ratio = (bt.frameHeight.value / bt.frameDepth).toFixed(1);
      rows.push({
        code: 'OVERTURNING_RATIO_EXCEEDED',
        severity: 'REVIEW',
        subject: bt.name,
        summary: 'Exceeds 6:1 — reinforced anchoring required. Overhead ties highly recommended for SDC D stability.',
        closureText: `Height-to-depth ratio is ${ratio}:1 (ANSI MH16.1 §1.4.7: >6:1 requires baseplates & anchors designed for 350 lb lateral forklift impact; overhead row ties mandated above 8:1).`,
      });
    }
  }

  // 4. Unestablished building & fire protection fields (MS-1..MS-18)
  if (doc.building.clearHeight.established === 'UNKNOWN') {
    rows.push({
      code: 'CLEAR_HEIGHT_UNVERIFIED',
      severity: 'MISSING_INPUT',
      subject: 'Building clear height',
      summary: `Clear height (${umToIn(doc.building.clearHeight.value)}") is marked VERIFY.`,
      closureText: 'Confirm clear height from field laser measurement or architectural section.',
    });
  }
  if (doc.building.commodityClass.value.trim() === '') {
    rows.push({
      code: 'COMMODITY_CLASS_MISSING',
      severity: 'MISSING_SOURCE',
      subject: 'Fire protection (MS-15)',
      summary: 'NFPA 13 / FM Global commodity classification has not been established.',
      closureText: 'Provide owner fire-protection letter naming commodity class.',
    });
  }
  if (doc.building.sdc.value.trim() === '') {
    rows.push({
      code: 'SEISMIC_SDC_MISSING',
      severity: 'MISSING_SOURCE',
      subject: 'Seismic design category (MS-18)',
      summary: 'ASCE 7 / RMI Seismic Design Category (SDC) has not been established.',
      closureText: 'Provide site geotechnical / structural criteria naming SDC.',
    });
  }

  return rows;
}

/** Counts by severity, in the order a reader acts on them. */
export interface FindingCounts {
  readonly blocking: number;
  readonly review: number;
  readonly missingInput: number;
  readonly missingSource: number;
  readonly pass: number;
}

export function countFindings(rows: readonly ScreeningFindingRow[]): FindingCounts {
  const n = (s: FindingSeverity): number => rows.filter((r) => r.severity === s).length;
  return {
    blocking: n('BLOCKING'),
    review: n('REVIEW'),
    missingInput: n('MISSING_INPUT'),
    missingSource: n('MISSING_SOURCE'),
    pass: n('PASS'),
  };
}
