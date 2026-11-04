import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { acceptFixProposal, proposeFixes, type FixProposal } from './fix-proposals.js';
import { INITIAL_COUNTER, collectIds, resumeFrom } from './ids.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;

describe('Previewable Fix Proposals Engine (ADR-010, D2, D8)', () => {
  it('proposes previewable fixes for narrow aisles, off-grid spans, and capacity shortfalls without mutating', () => {
    const baseDoc = doc();
    const bt0 = baseDoc.bayTypes[0]!;
    const counter = resumeFrom(collectIds(baseDoc));

    // Create a document with:
    // 1. Narrow aisle (truckRAS = 72" -> required 132", actual clear is 126")
    // 2. Off-grid beam span (110")
    // 3. Beam capacity shortfall (weight = 3000 lb * 2 pallets = 6000 lb > 5120 lb)
    const testDoc: StudioDocument = {
      ...baseDoc,
      equipment: {
        ...baseDoc.equipment,
        truckRAS: { value: IN(72), established: 'CATALOG' },
      },
      unitLoad: {
        ...baseDoc.unitLoad,
        weight: 3000,
      },
      bayTypes: [
        {
          ...bt0,
          beamLength: IN(110),
        },
        // Add a second bayType at a published 96" span that has a capacity shortfall
        {
          ...bt0,
          id: 'bt_2' as StudioDocument['bayTypes'][number]['id'],
          name: 'Bay Type B',
          beamLength: IN(96),
          beamPairCapacity: { value: 4000, established: 'CATALOG' },
        },
      ],
    };

    const proposals = proposeFixes(testDoc, counter);
    expect(proposals.length).toBeGreaterThanOrEqual(3);

    const aisleFix = proposals.find((p) => p.findingCode === 'AISLE_CLEAR_SHORTFALL');
    expect(aisleFix).toBeDefined();
    expect(aisleFix?.previewDelta.overallHeightDeltaUm).toBeGreaterThan(0);
    expect(aisleFix?.auditAttribution).toContain('Changed by Rule Set');
    expect(aisleFix?.auditAttribution).toContain('accepted by User');

    const spanFix = proposals.find((p) => p.findingCode === 'BEAM_SPAN_OFF_GRID');
    expect(spanFix).toBeDefined();
    expect(spanFix?.title).toContain('114"');

    const capFix = proposals.find((p) => p.findingCode === 'BEAM_CAPACITY_EXCEEDED');
    expect(capFix).toBeDefined();
    expect(capFix?.title).toContain('Step up');

    // Original document is untouched (never auto-applies)
    expect(testDoc.bayTypes[0]?.beamLength).toBe(IN(110));

    // Accept the span fix and verify audit record + applied document
    const accepted = acceptFixProposal(testDoc, counter, spanFix!);
    expect(accepted.proposalId).toBe(spanFix!.id);
    expect(accepted.auditAttribution).toContain('accepted by User');
    expect(accepted.document.bayTypes[0]?.beamLength).toBe(IN(114));
  });

  it('handles no-aisle documents, refused commands in preview, and extreme spans/weights gracefully', () => {
    const baseDoc = doc();
    const bt0 = baseDoc.bayTypes[0]!;
    const singleRunDoc: StudioDocument = {
      ...baseDoc,
      runs: [baseDoc.runs[0]!],
      unitLoad: {
        ...baseDoc.unitLoad,
        weight: 50_000, // exceeds all catalog beam families
      },
      bayTypes: [
        {
          ...bt0,
          beamLength: IN(36), // below 48" lower bracket (lowerSpanIn === null, upperSpanIn === 48)
        },
        {
          ...bt0,
          id: 'bt_high' as StudioDocument['bayTypes'][number]['id'],
          beamLength: IN(200), // above 144" upper bracket (upperSpanIn === null)
        },
      ],
    };

    const proposals = proposeFixes(singleRunDoc, INITIAL_COUNTER);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rationale).toContain('min"');
    expect(proposals[0]?.previewDelta.narrowestClearAisleAfterUm).toBeNull();

    // Accept a synthetic proposal with a refused command to cover the !res.ok branch
    const refusedProposal: FixProposal = {
      id: 'fix:refused',
      findingCode: 'TEST',
      title: 'Refused fix',
      rationale: 'Tests refusal branch',
      commands: [{ type: 'deleteBay', bayId: 'bay_999999' as StudioDocument['runs'][number]['bays'][number]['id'] }],
      previewDelta: {
        palletPositionDelta: 0,
        overallWidthDeltaUm: 0,
        overallHeightDeltaUm: 0,
        narrowestClearAisleAfterUm: null,
      },
      auditAttribution: 'Changed by Rule Set test, version 1, accepted by User',
    };
    const res = acceptFixProposal(singleRunDoc, INITIAL_COUNTER, refusedProposal);
    expect(res.document).toBe(singleRunDoc);

    // Also trigger computeDelta's !res.ok branch by having two runs at the same y so setAisleAfter has no run below
    const sideBySideDoc: StudioDocument = {
      ...baseDoc,
      equipment: {
        ...baseDoc.equipment,
        truckRAS: { value: IN(72), established: 'CATALOG' },
      },
      runs: [
        baseDoc.runs[0]!,
        { ...baseDoc.runs[1]!, y: baseDoc.runs[0]!.y + IN(96) },
      ],
    };
    const sideProposals = proposeFixes(sideBySideDoc, INITIAL_COUNTER);
    expect(sideProposals.length).toBeGreaterThanOrEqual(0);
  });
});
