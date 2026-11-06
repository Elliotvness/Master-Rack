import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { migrateV1ToV2 } from './migrate.js';
import {
  COLUMN_GUARD_REASON,
  DEFAULT_PRICING_RATES,
  DRAFT_TAKEOFF_WATERMARK,
  TUNNEL_TIE_REASON,
  bomForDocument,
  exportBomCsv,
  exportBomJson,
  exportLegacyTakeoffXlsx,
  pricingForDocument,
  quoteReadinessForDocument,
  runScopeLabelForLine,
  takeoffRunsForDocument,
  takeoffSummary,
  umToFeet,
} from './bom.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;

describe('BOM and Takeoff Pricing Bridge', () => {
  it('converts micrometres to feet correctly', () => {
    // 12 inches = 304,800 um = 1 foot
    expect(umToFeet(304_800)).toBeCloseTo(1.0, 5);
    // 240 inches (20 ft) = 6,096,000 um
    expect(umToFeet(6_096_000)).toBeCloseTo(20.0, 5);
  });

  it('assembles RunTakeoff entities from document runs', () => {
    const document = doc();
    const runs = takeoffRunsForDocument(document);

    expect(runs.length).toBe(document.runs.length);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      const orig = document.runs[i]!;
      expect(r.runId).toBe(orig.id);
      expect(r.bays).toBe(orig.bays.length);
      expect(r.rows).toBe(orig.backToBack ? 2 : 1);
      expect(r.beamLevels).toBeGreaterThan(0);
      expect(r.frameRef.kind).toBe('uncatalogued');
      expect(r.beamRef.kind).toBe('uncatalogued');
    }
  });

  it('derives provenanced BOM lines for the document', () => {
    const document = doc();
    const lines = bomForDocument(document);

    expect(lines.length).toBeGreaterThan(0);

    const categories = new Set(lines.map((l) => l.category));
    expect(categories.has('FRAME')).toBe(true);
    expect(categories.has('BEAM')).toBe(true);
    expect(categories.has('ANCHOR')).toBe(true);

    const resolvedFrames = lines.filter((l) => l.category === 'FRAME' && l.resolved);
    expect(resolvedFrames.length).toBeGreaterThan(0);
    for (const f of resolvedFrames) {
      if (f.resolved) {
        expect(f.qty.value).toBeGreaterThan(0);
        expect(f.ruleText).toContain('(bays + 1) x rows');
      }
    }

    // Run scope labels distinguish per-run lines (Run 1, Run 2, Run 3) from job-wide accessory lines
    expect(resolvedFrames.map((f) => runScopeLabelForLine(f, document))).toEqual([
      'Run 1',
      'Run 2',
      'Run 3',
    ]);
    const accessoryLine = lines.find((l) => l.category === 'ACCESSORY')!;
    expect(runScopeLabelForLine(accessoryLine, document)).toBe(
      'All runs (Run 1, Run 2, Run 3)',
    );
    expect(
      runScopeLabelForLine({ ...accessoryLine, sourceObjectIds: ['run_unknown'] }, document),
    ).toBe('run_unknown');
  });

  it('produces an accurate takeoff summary', () => {
    const document = doc();
    const lines = bomForDocument(document);
    const summary = takeoffSummary(lines, document);

    expect(summary.totalFrames).toBeGreaterThan(0);
    expect(summary.totalBeamPairs).toBeGreaterThan(0);
    expect(summary.totalAnchors).toBeGreaterThan(0);
    expect(summary.totalPalletPositions).toBeGreaterThan(0);
    expect(summary.resolvedCount).toBeGreaterThan(0);
    expect(summary.unresolvedCount).toBeGreaterThan(0);
  });

  it('calculates component-level takeoff pricing with default rates', () => {
    const document = doc();
    const estimate = pricingForDocument(document);

    expect(estimate.frameCost).toBeGreaterThan(0);
    expect(estimate.beamCost).toBeGreaterThan(0);
    expect(estimate.materialsSubtotal).toBeGreaterThan(0);
    expect(estimate.freight).toBeCloseTo(
      estimate.materialsSubtotal * DEFAULT_PRICING_RATES.freightRate,
      2,
    );
    expect(estimate.installation).toBeCloseTo(
      estimate.materialsSubtotal * DEFAULT_PRICING_RATES.installRate,
      2,
    );
    expect(estimate.salesTax).toBeCloseTo(
      estimate.materialsSubtotal * DEFAULT_PRICING_RATES.taxRate,
      2,
    );
    expect(estimate.subtotalBeforeMargin).toBeCloseTo(
      estimate.materialsSubtotal + estimate.freight + estimate.installation + estimate.salesTax,
      2,
    );
    expect(estimate.totalPrice).toBeGreaterThan(estimate.subtotalBeforeMargin);
    expect(estimate.targetMargin).toBeCloseTo(
      estimate.totalPrice - estimate.subtotalBeforeMargin,
      2,
    );
    expect(estimate.pricePerPosition).toBeGreaterThan(0);
  });

  it('accepts custom rates and recalibrates pricing', () => {
    const document = doc();
    const base = pricingForDocument(document);
    const customized = pricingForDocument(document, {
      framePerFt: 15.0, // higher steel rate
      marginRate: 0.25, // higher margin
    });

    expect(customized.frameCost).toBeGreaterThan(base.frameCost);
    expect(customized.totalPrice).toBeGreaterThan(base.totalPrice);
  });

  it('handles single-row runs, no floor storage, wide 144" beams, >20ft frames, and resolved deck/spacer lines', () => {
    const baseDoc = doc();
    const bt0 = baseDoc.bayTypes[0]!;
    const customDoc: StudioDocument = {
      ...baseDoc,
      bayTypes: [
        {
          ...bt0,
          beamLength: 144 * 25_400, // 12 ft > 10 ft (3 decks per level)
          frameHeight: { ...bt0.frameHeight, value: 288 * 25_400 }, // 24 ft > 20 ft (3 spacers per pair)
        },
      ],
      runs: [
        { ...baseDoc.runs[0]!, backToBack: false, floorStorage: false },
        { ...baseDoc.runs[1]!, backToBack: true, floorStorage: true },
      ],
    };

    const runs = takeoffRunsForDocument(customDoc);
    expect(runs[0]?.rows).toBe(1);
    expect(runs[1]?.rows).toBe(2);

    const baseLines = bomForDocument(customDoc);
    const resolvedSample = baseLines.find((l) => l.resolved)!;
    const syntheticLines = [
      ...baseLines,
      { ...resolvedSample, category: 'DECK' as const },
      { ...resolvedSample, category: 'SPACER' as const },
      { ...resolvedSample, category: 'FOOTPLATE' as const },
    ];
    const summary = takeoffSummary(syntheticLines, customDoc);
    expect(summary.totalDecks).toBeGreaterThan(0);
    expect(summary.totalSpacers).toBeGreaterThan(0);

    const est = pricingForDocument(customDoc);
    expect(est.deckCost).toBeGreaterThan(0);
    expect(est.spacerCost).toBeGreaterThan(0);

    // Empty runs -> 0 positions -> pricePerPosition === 0
    const emptyEst = pricingForDocument({ ...customDoc, runs: [] });
    expect(emptyEst.pricePerPosition).toBe(0);
  });

  it('throws BridgeError when a run references a missing bayTypeId', () => {
    const baseDoc = doc();
    const brokenDoc: StudioDocument = {
      ...baseDoc,
      runs: [{ ...baseDoc.runs[0]!, bayTypeId: 'bt_missing' as StudioDocument['runs'][number]['bayTypeId'] }],
    };
    expect(() => takeoffRunsForDocument(brokenDoc)).toThrow(/references missing bay type/);
    expect(() => takeoffSummary([], brokenDoc)).toThrow(/references missing bay type/);
    expect(() => pricingForDocument(brokenDoc)).toThrow(/references missing bay type/);
  });

  it('includes UNRESOLVED column guard (MS-4) and tunnel tie (MS-1, D7) accessory lines', () => {
    const document = doc();
    const lines = bomForDocument(document);
    const guardLine = lines.find(
      (l) => l.partRef.kind === 'uncatalogued' && l.partRef.uncataloguedPartId === 'guard-column',
    );
    const tieLine = lines.find(
      (l) =>
        l.partRef.kind === 'uncatalogued' &&
        l.partRef.uncataloguedPartId === 'tie-tunnel-cross-aisle',
    );
    expect(guardLine?.resolved).toBe(false);
    expect(guardLine?.unresolvedReason).toBe(COLUMN_GUARD_REASON);
    expect(tieLine?.resolved).toBe(false);
    expect(tieLine?.unresolvedReason).toBe(TUNNEL_TIE_REASON);

    // Empty runs -> no accessory lines
    expect(bomForDocument({ ...document, runs: [] })).toEqual([]);
  });

  it('evaluates quoteReadinessForDocument and watermarks draft takeoffs when unverified fields exist', () => {
    const document = doc();
    const readiness = quoteReadinessForDocument(document);
    expect(readiness.isQuoteReady).toBe(false);
    expect(readiness.watermark).toBe(DRAFT_TAKEOFF_WATERMARK);
    expect(readiness.blockingReasons.length).toBeGreaterThan(0);

    // Also test all unverified branches and fully verified document
    const bt0 = document.bayTypes[0]!;
    const unverifiedDoc: StudioDocument = {
      ...document,
      building: {
        ...document.building,
        clearHeight: { value: document.building.clearHeight.value, established: 'UNKNOWN' },
        deflectorElev: { value: document.building.deflectorElev.value, established: 'UNKNOWN' },
        commodityClass: { value: '', established: 'UNKNOWN' },
        sdc: { value: '', established: 'UNKNOWN' },
      },
      equipment: {
        ...document.equipment,
        truckRAS: { value: document.equipment.truckRAS.value, established: 'UNKNOWN' },
      },
      bayTypes: [
        {
          ...bt0,
          frameHeight: { value: bt0.frameHeight.value, established: 'UNKNOWN' },
          beamPairCapacity: { value: bt0.beamPairCapacity.value, established: 'UNKNOWN' },
        },
      ],
    };
    const rUnverified = quoteReadinessForDocument(unverifiedDoc);
    expect(rUnverified.isQuoteReady).toBe(false);
    expect(rUnverified.blockingReasons.length).toBe(7);

    const verifiedDoc: StudioDocument = {
      ...document,
      building: {
        ...document.building,
        clearHeight: { value: document.building.clearHeight.value, established: 'INPUT' },
        deflectorElev: { value: document.building.deflectorElev.value, established: 'INPUT' },
        commodityClass: { value: 'Class III', established: 'INPUT' },
        sdc: { value: 'D', established: 'INPUT' },
      },
      equipment: {
        ...document.equipment,
        truckRAS: { value: document.equipment.truckRAS.value, established: 'CATALOG' },
      },
      bayTypes: [
        {
          ...bt0,
          frameHeight: { value: bt0.frameHeight.value, established: 'CATALOG' },
          beamPairCapacity: { value: bt0.beamPairCapacity.value, established: 'CATALOG' },
        },
      ],
    };
    const rVerified = quoteReadinessForDocument(verifiedDoc);
    expect(rVerified.isQuoteReady).toBe(true);
    expect(rVerified.watermark).toBeNull();
    expect(rVerified.blockingReasons).toEqual([]);

    const csvVerified = exportBomCsv(bomForDocument(verifiedDoc), verifiedDoc);
    expect(csvVerified).toContain('VALID FOR QUOTE');
  });

  it('exports canonical CSV and JSON and gates legacy Takeoff .xlsx on MS-13', () => {
    const document = doc();
    const baseLines = bomForDocument(document);
    // Include a catalog PartRef line and quotes in ruleText to cover all CSV branches
    const lines = [
      ...baseLines,
      {
        ...baseLines[0]!,
        partRef: { kind: 'catalog' as const, partRevisionId: 'cat-rev-1' },
        ruleText: 'rule with "quotes", commas',
      },
    ];
    const csv = exportBomCsv(lines, document);
    expect(csv).toContain(DRAFT_TAKEOFF_WATERMARK);
    expect(csv).toContain('cat-rev-1');
    expect(csv).toContain('"rule with ""quotes"", commas"');

    const jsonStr = exportBomJson(lines, document);
    const parsed = JSON.parse(jsonStr) as { quoteReadiness: { isQuoteReady: boolean } };
    expect(parsed.quoteReadiness.isQuoteReady).toBe(false);

    const legacy = exportLegacyTakeoffXlsx();
    expect(legacy.ok).toBe(false);
    expect(legacy.missingSourceId).toBe('MS-13');
    expect(legacy.reason).toContain('MS-13');
  });
});
