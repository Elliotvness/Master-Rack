/**
 * Pure remediation engine — Previewable Fix Proposals (Phase 2 Step 2.3 — ADR-010, D2, D8).
 *
 * Computes concrete candidate fixes for layout compliance issues (narrow aisles,
 * off-grid beam spans, beam capacity shortfalls, row spacer flues), previews the
 * resulting geometry/position delta, NEVER auto-applies, and records an explicit
 * audit trail (`"Changed by Rule Set X, version Y, accepted by User"`, D8) when
 * accepted.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import {
  PUBLISHED_BEAM_FAMILIES,
  beamFamilyFromPartLabel,
  lookupPublishedBeamSpan,
} from './catalog-options.js';
import { apply, type Command } from './commands.js';
import type { StudioDocument } from './document.js';
import type { EntityId, IdCounter } from './ids.js';
import { IN, MICROMETRES_PER_INCH } from './length.js';
import { planGeometry } from './plan.js';
import { inchesForComparison } from './screening.js';

export interface FixPreviewDelta {
  readonly palletPositionDelta: number;
  readonly overallWidthDeltaUm: number;
  readonly overallHeightDeltaUm: number;
  readonly narrowestClearAisleAfterUm: number | null;
}

export interface FixProposal {
  readonly id: string;
  readonly findingCode: string;
  readonly title: string;
  readonly rationale: string;
  readonly commands: readonly Command[];
  readonly previewDelta: FixPreviewDelta;
  /** D8 audit attribution format: `"Changed by Rule Set X, version Y, accepted by User"` */
  readonly auditAttribution: string;
}

export interface AcceptedFixAuditRecord {
  readonly proposalId: string;
  readonly auditAttribution: string;
  readonly appliedCommands: readonly Command[];
  readonly document: StudioDocument;
  readonly counter: IdCounter;
}

function buildAuditAttribution(doc: StudioDocument): string {
  return `Changed by Rule Set ${doc.packs.structural}, version ${doc.packs.rack}, accepted by User`;
}

function applyProposalCommands(
  doc: StudioDocument,
  counter: IdCounter,
  commands: readonly Command[],
): { readonly document: StudioDocument; readonly counter: IdCounter } {
  let curDoc = doc;
  let curCounter = counter;
  for (const cmd of commands) {
    const res = apply(curDoc, curCounter, cmd);
    if (res.ok) {
      curDoc = res.document;
      curCounter = res.counter;
    }
  }
  return { document: curDoc, counter: curCounter };
}

function computeDelta(
  beforeDoc: StudioDocument,
  counter: IdCounter,
  commands: readonly Command[],
): FixPreviewDelta {
  const beforePlan = planGeometry(beforeDoc);
  const { document: curDoc } = applyProposalCommands(beforeDoc, counter, commands);
  const afterPlan = planGeometry(curDoc);
  return Object.freeze({
    palletPositionDelta: afterPlan.totalPositions - beforePlan.totalPositions,
    overallWidthDeltaUm: afterPlan.extent.width.value - beforePlan.extent.width.value,
    overallHeightDeltaUm: afterPlan.extent.height.value - beforePlan.extent.height.value,
    narrowestClearAisleAfterUm: afterPlan.narrowestClearAisle?.value ?? null,
  });
}

/**
 * Propose previewable candidate fixes for a studio document (ADR-010, D2, D8).
 * Never mutates `doc` or auto-applies any command.
 */
export function proposeFixes(doc: StudioDocument, counter: IdCounter): readonly FixProposal[] {
  const proposals: FixProposal[] = [];
  const plan = planGeometry(doc);
  const attribution = buildAuditAttribution(doc);

  // 1. Narrow aisle fix proposal: widen any aisle whose clear width is below truckRAS + 60 in
  const requiredClearUm = doc.equipment.truckRAS.value + IN(60);
  plan.aisles.forEach((aisle, index) => {
    if (aisle.clearBetweenLoads.value < requiredClearUm) {
      const shortfallUm = requiredClearUm - aisle.clearBetweenLoads.value;
      const targetFrameToFrameUm = aisle.frameToFrame.value + shortfallUm;
      // Extract upstream run id from `gap_<runA>_<runB>`
      const parts = aisle.aisleId.split('_');
      const runAId = `${parts[1]}_${parts[2]}` as EntityId;
      const cmd: Command = {
        type: 'setAisleAfter',
        runId: runAId,
        frameToFrame: targetFrameToFrameUm,
      };
      const name = `Aisle ${index + 1}`;
      const targetFrameIn = inchesForComparison(targetFrameToFrameUm);
      const reqClearIn = inchesForComparison(requiredClearUm);
      proposals.push(
        Object.freeze({
          id: `fix:aisle:${aisle.aisleId}`,
          findingCode: 'AISLE_CLEAR_SHORTFALL',
          title: `Widen ${name} frame-to-frame to ${targetFrameIn}`,
          rationale: `Increases clear distance between loads to meet ${reqClearIn} operational target.`,
          commands: Object.freeze([cmd]),
          previewDelta: computeDelta(doc, counter, [cmd]),
          auditAttribution: attribution,
        }),
      );
    }
  });

  // 2. Bay-type fixes: off-grid beam span bracket & beam capacity step-up
  for (const bt of doc.bayTypes) {
    const family = beamFamilyFromPartLabel(bt.beamPart);
    const spanIn = Math.round(bt.beamLength / MICROMETRES_PER_INCH);
    const lookup = lookupPublishedBeamSpan(family, spanIn);

    if (lookup.status === 'OFF_GRID' && lookup.upperSpanIn !== null) {
      const bracketRow = lookupPublishedBeamSpan(family, lookup.upperSpanIn) as Extract<
        ReturnType<typeof lookupPublishedBeamSpan>,
        { readonly status: 'ON_GRID' }
      >;
      const cmd: Command = {
        type: 'setField',
        label: `Snap ${bt.name} span to published ${bracketRow.spanIn}" bracket`,
        change: {
          section: 'bayType',
          bayTypeId: bt.id,
          patch: {
            beamPart: bracketRow.beamPartLabel,
            beamLength: bracketRow.spanUm,
            beamPairCapacity: {
              value: bracketRow.capacityLb,
              established: 'CATALOG',
              source: `Catalog ${doc.packs.rack} (${bracketRow.beamPartLabel})`,
            },
          },
        },
      };
      proposals.push(
        Object.freeze({
          id: `fix:span:${bt.id}`,
          findingCode: 'BEAM_SPAN_OFF_GRID',
          title: `Snap ${bt.name} beam span from ${spanIn}" to published ${bracketRow.spanIn}"`,
          rationale: `Off-grid span ${spanIn}" falls between published ${lookup.lowerSpanIn ?? 'min'}" and ${lookup.upperSpanIn}" spans.`,
          commands: Object.freeze([cmd]),
          previewDelta: computeDelta(doc, counter, [cmd]),
          auditAttribution: attribution,
        }),
      );
    }

    // 3. Beam pair capacity shortfall: step up to next stronger beam family at same span
    const requiredPairCapacityLb =
      doc.unitLoad.weight * bt.palletsPerBay * doc.loadDistributionFactor;
    if (bt.beamPairCapacity.value < requiredPairCapacityLb) {
      const candidateFamily = PUBLISHED_BEAM_FAMILIES.find((fam) => {
        const candidateSpan = lookupPublishedBeamSpan(fam.family, spanIn);
        return candidateSpan.status === 'ON_GRID' && candidateSpan.capacityLb >= requiredPairCapacityLb;
      });
      if (candidateFamily) {
        const stepped = lookupPublishedBeamSpan(candidateFamily.family, spanIn) as Extract<
          ReturnType<typeof lookupPublishedBeamSpan>,
          { readonly status: 'ON_GRID' }
        >;
        const cmd: Command = {
          type: 'setField',
          label: `Step up ${bt.name} beam to ${stepped.beamPartLabel} (${stepped.capacityLb} lb/pair)`,
          change: {
            section: 'bayType',
            bayTypeId: bt.id,
            patch: {
              beamPart: stepped.beamPartLabel,
              beamPairCapacity: {
                value: stepped.capacityLb,
                established: 'CATALOG',
                source: `Catalog ${doc.packs.rack} (${stepped.beamPartLabel})`,
              },
            },
          },
        };
        proposals.push(
          Object.freeze({
            id: `fix:beamcap:${bt.id}`,
            findingCode: 'BEAM_CAPACITY_EXCEEDED',
            title: `Step up ${bt.name} beam family to ${stepped.beamPartLabel} (${stepped.capacityLb.toLocaleString()} lb/pair)`,
            rationale: `Demand is ${Math.round(requiredPairCapacityLb).toLocaleString()} lb/pair vs current ${bt.beamPairCapacity.value.toLocaleString()} lb/pair.`,
            commands: Object.freeze([cmd]),
            previewDelta: computeDelta(doc, counter, [cmd]),
            auditAttribution: attribution,
          }),
        );
      }
    }
  }

  return Object.freeze(proposals);
}

/**
 * Accept a previewed fix proposal explicitly (D8), returning the updated
 * document and its audit record.
 */
export function acceptFixProposal(
  doc: StudioDocument,
  counter: IdCounter,
  proposal: FixProposal,
): AcceptedFixAuditRecord {
  const { document: curDoc, counter: curCounter } = applyProposalCommands(
    doc,
    counter,
    proposal.commands,
  );
  return Object.freeze({
    proposalId: proposal.id,
    auditAttribution: proposal.auditAttribution,
    appliedCommands: proposal.commands,
    document: curDoc,
    counter: curCounter,
  });
}
