/**
 * Takeoff BOM bridge and pricing calculation for Studio Documents.
 *
 * Connects the studio document to @rms/kernel-bom's deriveBom, providing:
 * 1. takeoffRunsForDocument: maps runs and bay types to RunTakeoff entities.
 * 2. bomForDocument: produces the byte-stable, provenanced BomLine list.
 * 3. takeoffSummary: rolls up resolved counts and highlights unresolved lines.
 * 4. pricingForDocument: component-level estimating based on rack-takeoff rates.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import {
  type BomLine,
  type RunTakeoff,
  anchorQty as computeAnchorQty,
  beamQty as computeBeamQty,
  deriveBom,
  frameQty as computeFrameQty,
} from '@rms/kernel-bom';
import { MICROMETRES_PER_INCH } from './length.js';
import { bayTypeForRun, type StudioDocument } from './document.js';
import { BridgeError } from './to-kernel.js';

export interface TakeoffSummary {
  readonly totalFrames: number;
  readonly totalBeamPairs: number;
  readonly totalAnchors: number;
  readonly totalDecks: number;
  readonly totalSpacers: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly totalPalletPositions: number;
}

export interface PricingRates {
  readonly framePerFt: number;
  readonly beamPerFt: number;
  readonly deckEach: number;
  readonly spacerEach: number;
  readonly anchorEach: number;
  readonly guardEach: number;
  readonly freightRate: number;
  readonly installRate: number;
  readonly taxRate: number;
  readonly marginRate: number;
}

export const DEFAULT_PRICING_RATES: PricingRates = Object.freeze({
  framePerFt: 9.5,
  beamPerFt: 3.6,
  deckEach: 19.0,
  spacerEach: 9.0,
  anchorEach: 3.25,
  guardEach: 42.0,
  freightRate: 0.04,
  installRate: 0.35,
  taxRate: 0.1025,
  marginRate: 0.2,
});

export interface TakeoffEstimate {
  readonly frameCost: number;
  readonly beamCost: number;
  readonly deckCost: number;
  readonly spacerCost: number;
  readonly anchorCost: number;
  readonly materialsSubtotal: number;
  readonly freight: number;
  readonly installation: number;
  readonly salesTax: number;
  readonly subtotalBeforeMargin: number;
  readonly targetMargin: number;
  readonly totalPrice: number;
  readonly pricePerPosition: number;
}

/** Convert micrometres to fractional feet. */
export function umToFeet(um: number): number {
  return um / (MICROMETRES_PER_INCH * 12);
}

/**
 * Assemble RunTakeoff inputs from the studio document without performing
 * any calculation outside of @rms/kernel-bom.
 */
export function takeoffRunsForDocument(doc: StudioDocument): readonly RunTakeoff[] {
  return doc.runs.map((run) => {
    const bayType = bayTypeForRun(doc, run);
    if (!bayType) {
      throw new BridgeError(`run ${run.id} (${run.name}) references missing bay type ${run.bayTypeId}`);
    }
    const rows = run.backToBack ? 2 : 1;
    const bays = run.bays.length;
    const beamLevels = bayType.beamLevels.length;

    return {
      runId: run.id,
      bays,
      rows,
      beamLevels,
      frameRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: bayType.uprightPart,
        measuredGeometry: `${bayType.frameHeight.value}um`,
      },
      beamRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: bayType.beamPart,
        measuredGeometry: `${bayType.beamLength}um`,
      },
      anchorRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: 'anchor-standard',
        measuredGeometry: 'standard',
      },
      deckRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: 'deck-wire',
        measuredGeometry: 'standard',
      },
      spacerRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: 'spacer-row',
        measuredGeometry: `${run.rowSpacer}um`,
      },
      footplateRef: {
        kind: 'uncatalogued',
        uncataloguedPartId: 'footplate-standard',
        measuredGeometry: 'standard',
      },
    };
  });
}

/**
 * Generate the provenanced BOM line items for a studio document using the
 * established counting rules in @rms/kernel-bom.
 */
export function bomForDocument(doc: StudioDocument): readonly BomLine[] {
  const takeoffs = takeoffRunsForDocument(doc);
  return deriveBom(takeoffs);
}

/**
 * Summarize resolved quantities and count unresolved lines.
 */
export function takeoffSummary(lines: readonly BomLine[], doc: StudioDocument): TakeoffSummary {
  let totalFrames = 0;
  let totalBeamPairs = 0;
  let totalAnchors = 0;
  let totalDecks = 0;
  let totalSpacers = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const line of lines) {
    if (line.resolved) {
      resolvedCount++;
      switch (line.category) {
        case 'FRAME':
          totalFrames += line.qty.value;
          break;
        case 'BEAM':
          totalBeamPairs += line.qty.value;
          break;
        case 'ANCHOR':
          totalAnchors += line.qty.value;
          break;
        case 'DECK':
          totalDecks += line.qty.value;
          break;
        case 'SPACER':
          totalSpacers += line.qty.value;
          break;
      }
    } else {
      unresolvedCount++;
    }
  }

  // Calculate gross positions: bays * rows * (beamLevels + (floorStorage ? 1 : 0)) * palletsPerBay
  let totalPalletPositions = 0;
  for (const run of doc.runs) {
    const bayType = bayTypeForRun(doc, run);
    if (!bayType) {
      throw new BridgeError(`run ${run.id} (${run.name}) references missing bay type ${run.bayTypeId}`);
    }
    const rows = run.backToBack ? 2 : 1;
    const levels = bayType.beamLevels.length + (run.floorStorage ? 1 : 0);
    totalPalletPositions += run.bays.length * rows * levels * bayType.palletsPerBay;
  }

  return {
    totalFrames,
    totalBeamPairs,
    totalAnchors,
    totalDecks,
    totalSpacers,
    resolvedCount,
    unresolvedCount,
    totalPalletPositions,
  };
}

/**
 * Calculate component-level takeoff pricing and gross margins based on
 * the material quantities and rates.
 */
export function pricingForDocument(
  doc: StudioDocument,
  customRates?: Partial<PricingRates>,
): TakeoffEstimate {
  const rates: PricingRates = { ...DEFAULT_PRICING_RATES, ...customRates };

  let frameCost = 0;
  let beamCost = 0;
  let deckCost = 0;
  let spacerCost = 0;
  let anchorCost = 0;
  let totalPositions = 0;

  for (const run of doc.runs) {
    const bayType = bayTypeForRun(doc, run);
    if (!bayType) {
      throw new BridgeError(`run ${run.id} (${run.name}) references missing bay type ${run.bayTypeId}`);
    }
    const rows = run.backToBack ? 2 : 1;
    const bays = run.bays.length;
    const beamLevels = bayType.beamLevels.length;

    // Upright frames: (bays + 1) * rows
    const frames = computeFrameQty(bays, rows);
    const frameHeightFt = umToFeet(bayType.frameHeight.value);
    frameCost += frames * frameHeightFt * rates.framePerFt;

    // Load beams: bays * rows * beamLevels (pair count)
    const beamPairs = computeBeamQty(bays, rows, beamLevels);
    const beamLengthFt = umToFeet(bayType.beamLength);
    // 2 beams per pair
    beamCost += beamPairs * 2 * beamLengthFt * rates.beamPerFt;

    // Wire decking: 2 panels per standard 96"/108" bay level, 3 panels per 144"
    const decksPerLevel = beamLengthFt > 10 ? 3 : 2;
    const decks = bays * rows * beamLevels * decksPerLevel;
    deckCost += decks * rates.deckEach;

    // Row spacers: 2 per back-to-back frame pair up to 20 ft
    if (run.backToBack) {
      const spacersPerPair = frameHeightFt > 20 ? 3 : 2;
      const spacerQty = (bays + 1) * spacersPerPair;
      spacerCost += spacerQty * rates.spacerEach;
    }

    // Floor anchors: 4 per frame column
    const anchors = computeAnchorQty(frames);
    anchorCost += anchors * rates.anchorEach;

    const levels = beamLevels + (run.floorStorage ? 1 : 0);
    totalPositions += bays * rows * levels * bayType.palletsPerBay;
  }

  const materialsSubtotal = frameCost + beamCost + deckCost + spacerCost + anchorCost;
  const freight = materialsSubtotal * rates.freightRate;
  const installation = materialsSubtotal * rates.installRate;
  const salesTax = materialsSubtotal * rates.taxRate;
  const subtotalBeforeMargin = materialsSubtotal + freight + installation + salesTax;

  // Margin calculation: Price = Cost / (1 - marginRate)
  const divisor = Math.max(0.01, 1 - rates.marginRate);
  const totalPrice = subtotalBeforeMargin / divisor;
  const targetMargin = totalPrice - subtotalBeforeMargin;
  const pricePerPosition = totalPositions > 0 ? totalPrice / totalPositions : 0;

  return {
    frameCost,
    beamCost,
    deckCost,
    spacerCost,
    anchorCost,
    materialsSubtotal,
    freight,
    installation,
    salesTax,
    subtotalBeforeMargin,
    targetMargin,
    totalPrice,
    pricePerPosition,
  };
}
