import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RulePack, loadRulePackManifest, loadRules } from '@rms/kernel-rules';
import {
  inches,
  poundsPerPair,
  quantity,
  type ProvenanceNode,
} from '@rms/kernel-units';

import {
  MVP_CHECKS,
  aisleClearance,
  beamCapacity,
  beamFrameFit,
  citationsBelowPrimary,
  derivedValuesEstablished,
  flueGeometry,
  levelElevations,
  palletOverhang,
  partPublished,
  runCheck,
  runChecks,
  silentChecks,
  siteUnknowns,
  topOfLoad,
  uncataloguedParts,
  type CheckInput,
  type LevelInput,
} from './index.js';

const rulesPath = fileURLToPath(
  new URL('../../../data/rules/mvp-2026-08/rules.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(rulesPath, 'utf8')) as { manifest: unknown; rules: unknown[] };
const pack = new RulePack(loadRulePackManifest(doc.manifest), loadRules(doc.rules));

function level(id: string, elevationIn: number, loadLbPr: number | null = 4000): LevelInput {
  return {
    id,
    elevation: inches(elevationIn),
    load: loadLbPr === null ? null : poundsPerPair(loadLbPr),
    stores: true,
  };
}

/** A configuration with nothing wrong with it. Each test breaks one thing. */
function baseInput(): CheckInput {
  return {
    runId: 'run-1',
    frameHeight: inches(240),
    levels: [level('L1', 6), level('L2', 60), level('L3', 120)],
    beamSpan: inches(96),
    beamCapacity: {
      status: 'ON_GRID',
      capacity: poundsPerPair(5400),
      lowerSpanIn: null,
      upperSpanIn: null,
    },
    beamFrameCompatible: true,
    clearHeight: inches(360),
    topOfLoad: inches(168),
    aisleClearWidth: inches(144),
    aisleRequired: inches(132),
    overhangFront: inches(2),
    overhangRear: inches(2),
    parts: [{ id: 'p1', description: 'IB59ET09600', partRevisionId: 'pr-1', discontinued: false }],
    derivedOutputs: [],
    columnGridResolved: true,
    commodityClassEstablished: true,
    transverseFlue: null,
  };
}

describe('a clean configuration produces no findings at all', () => {
  it('reports nothing when nothing is wrong', () => {
    // The baseline that makes every other test meaningful: if this were noisy,
    // a check firing below would prove nothing.
    expect(runChecks(MVP_CHECKS, pack, baseInput())).toEqual([]);
  });

  it('names every silent check rather than implying a pass', () => {
    const findings = runChecks(MVP_CHECKS, pack, baseInput());
    expect(silentChecks(MVP_CHECKS, findings).length).toBe(MVP_CHECKS.length);
  });
});

describe('check 1 \u2014 beam and frame compatibility', () => {
  it('blocks an incompatible pairing', () => {
    const [f] = runCheck(beamFrameFit, pack, { ...baseInput(), beamFrameCompatible: false });
    expect(f?.severity).toBe('BLOCKER');
    expect(f?.code).toBe('BEAM_FRAME_INCOMPATIBLE');
  });

  it('does not evaluate when the catalog publishes no compatibility statement', () => {
    // Absence of a published statement is not evidence of incompatibility.
    const [f] = runCheck(beamFrameFit, pack, { ...baseInput(), beamFrameCompatible: null });
    expect(f?.severity).toBe('NOT_EVALUATED');
    expect(f?.parameters[0]?.established).toBe(false);
  });
});

describe('check 2 \u2014 beam capacity, exact span only', () => {
  it('blocks a level load above the published capacity', () => {
    const input = { ...baseInput(), levels: [level('L1', 60, 9999)] };
    const [f] = runCheck(beamCapacity, pack, input);
    expect(f?.severity).toBe('BLOCKER');
    expect(f?.code).toBe('BEAM_CAPACITY_EXCEEDED');
  });

  it('passes a load exactly at the published capacity', () => {
    // The boundary belongs to the client: rated capacity is usable capacity.
    const input = { ...baseInput(), levels: [level('L1', 60, 5400)] };
    expect(runCheck(beamCapacity, pack, input)).toEqual([]);
  });

  it('AC-08 \u2014 an off-grid span yields NOT EVALUATED, both brackets, and no capacity', () => {
    // The single most important behaviour in the product.
    const input: CheckInput = {
      ...baseInput(),
      beamSpan: inches(110),
      beamCapacity: { status: 'OFF_GRID', capacity: null, lowerSpanIn: 108, upperSpanIn: 114 },
    };
    const [f] = runCheck(beamCapacity, pack, input);
    expect(f?.severity).toBe('NOT_EVALUATED');
    expect(f?.code).toBe('BEAM_CAPACITY_OFF_GRID');
    // The brackets are stated, and no capacity number is produced anywhere.
    const capacityParam = f?.parameters.find((p) => p.name === 'published capacity');
    expect(capacityParam?.established).toBe(false);
    expect(capacityParam?.value).toBeNull();
    expect(capacityParam?.established === false ? capacityParam.reason : '').toMatch(/108" and 114"/);
    expect(capacityParam?.established === false ? capacityParam.reason : '').toMatch(
      /does not interpolate/,
    );
  });

  it('reports a missing level load as a missing input, not as a pass', () => {
    const input = { ...baseInput(), levels: [level('L1', 60, null)] };
    const [f] = runCheck(beamCapacity, pack, input);
    expect(f?.severity).toBe('MISSING_INPUT');
  });

  it('ignores a level that does not store', () => {
    const input: CheckInput = {
      ...baseInput(),
      levels: [{ ...level('L1', 6, 99999), stores: false }],
    };
    expect(runCheck(beamCapacity, pack, input)).toEqual([]);
  });

  it('reports NOT_FOUND the same way as off-grid: no capacity, no guess', () => {
    const input: CheckInput = {
      ...baseInput(),
      beamCapacity: { status: 'NOT_FOUND', capacity: null, lowerSpanIn: null, upperSpanIn: null },
    };
    const [f] = runCheck(beamCapacity, pack, input);
    expect(f?.severity).toBe('NOT_EVALUATED');
    const p = f?.parameters.find((x) => x.name === 'published capacity');
    expect(p?.established === false ? p.reason : '').toMatch(/not published for this series/);
  });
});

describe('check 3 \u2014 level elevations', () => {
  it('blocks two levels at the same elevation', () => {
    const input = { ...baseInput(), levels: [level('L1', 60), level('L2', 60)] };
    const [f] = runCheck(levelElevations, pack, input);
    expect(f?.code).toBe('LEVEL_ELEVATION_DUPLICATE');
    expect(f?.severity).toBe('BLOCKER');
  });

  it('blocks levels that descend', () => {
    const input = { ...baseInput(), levels: [level('L1', 120), level('L2', 60)] };
    const [f] = runCheck(levelElevations, pack, input);
    expect(f?.code).toBe('LEVEL_ELEVATION_OUT_OF_ORDER');
  });

  it('blocks a level above the frame height', () => {
    const input = { ...baseInput(), levels: [level('L1', 300)] };
    const codes = runCheck(levelElevations, pack, input).map((f) => f.code);
    expect(codes).toContain('LEVEL_ABOVE_FRAME');
  });

  it('accepts a single level, and a level exactly at the frame height', () => {
    expect(runCheck(levelElevations, pack, { ...baseInput(), levels: [level('L1', 60)] })).toEqual([]);
    expect(runCheck(levelElevations, pack, { ...baseInput(), levels: [level('L1', 240)] })).toEqual([]);
  });
});

describe('check 4 \u2014 top of load within the clear height', () => {
  it('blocks a load taller than the room, and states the overrun', () => {
    const input = { ...baseInput(), topOfLoad: inches(400) };
    const [f] = runCheck(topOfLoad, pack, input);
    expect(f?.severity).toBe('BLOCKER');
    const overrun = f?.parameters.find((p) => p.name === 'overrun');
    expect(overrun?.established).toBe(true);
  });

  it('stays silent when the clear height is unknown, leaving that to check 9', () => {
    // Reporting it twice would give the client the same problem on one screen.
    expect(runCheck(topOfLoad, pack, { ...baseInput(), clearHeight: null })).toEqual([]);
    expect(runCheck(topOfLoad, pack, { ...baseInput(), topOfLoad: null })).toEqual([]);
  });

  it('accepts a load exactly at the clear height', () => {
    expect(runCheck(topOfLoad, pack, { ...baseInput(), topOfLoad: inches(360) })).toEqual([]);
  });
});

describe('check 5 \u2014 aisle clear width, capped by its SECONDARY rule', () => {
  it('caps a shortfall at engineering review, never a blocker', () => {
    // The check observes a BLOCKER. The convention has no located code basis,
    // so the framework is not entitled to let it stop a submission.
    const input = { ...baseInput(), aisleClearWidth: inches(100) };
    const [f] = runCheck(aisleClearance, pack, input);
    expect(f?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(f?.ceilingApplied).toEqual({ observed: 'BLOCKER', tier: 'SECONDARY' });
  });

  it('still asks the client for the equipment requirement', () => {
    const [f] = runCheck(aisleClearance, pack, { ...baseInput(), aisleRequired: null });
    expect(f?.severity).toBe('MISSING_INPUT');
    expect(f?.code).toBe('AISLE_REQUIREMENT_UNKNOWN');
  });

  it('accepts an aisle exactly at the requirement', () => {
    expect(runCheck(aisleClearance, pack, { ...baseInput(), aisleClearWidth: inches(132) })).toEqual(
      [],
    );
  });

  it('stays silent when the aisle width is not derivable', () => {
    expect(runCheck(aisleClearance, pack, { ...baseInput(), aisleClearWidth: null })).toEqual([]);
  });
});

describe('check 6 \u2014 pallet overhang', () => {
  it('blocks a pallet that does not fit', () => {
    const input = { ...baseInput(), overhangFront: inches(-1) };
    const [f] = runCheck(palletOverhang, pack, input);
    expect(f?.code).toBe('PALLET_DOES_NOT_FIT');
    expect(f?.severity).toBe('BLOCKER');
  });

  it('warns on an uneven split, without blocking', () => {
    const input = { ...baseInput(), overhangFront: inches(4), overhangRear: inches(1) };
    const [f] = runCheck(palletOverhang, pack, input);
    expect(f?.code).toBe('PALLET_OVERHANG_UNEVEN');
    expect(f?.severity).toBe('WARNING');
  });

  it('does not warn on the odd micrometre, which is the allocator working correctly', () => {
    // allocateOverhang puts the odd µm on the front. That is by design and must
    // not produce a finding, or every odd-width bay would raise one.
    const input: CheckInput = {
      ...baseInput(),
      overhangFront: quantity(50801, 'um', 'DERIVED'),
      overhangRear: quantity(50800, 'um', 'DERIVED'),
    };
    expect(runCheck(palletOverhang, pack, input)).toEqual([]);
  });

  it('stays silent when overhang was not derived', () => {
    expect(runCheck(palletOverhang, pack, { ...baseInput(), overhangFront: null })).toEqual([]);
  });
});

describe('check 7 \u2014 part published and current', () => {
  it('warns on a discontinued catalog part', () => {
    const input: CheckInput = {
      ...baseInput(),
      parts: [{ id: 'p1', description: 'old beam', partRevisionId: 'pr-1', discontinued: true }],
    };
    const [f] = runCheck(partPublished, pack, input);
    expect(f?.severity).toBe('WARNING');
    expect(f?.closedBy).toMatch(/old beam/);
  });

  it('ignores uncatalogued material, which is check 12\u2019s job', () => {
    const input: CheckInput = {
      ...baseInput(),
      parts: [{ id: 'p1', description: 'used beam', partRevisionId: null, discontinued: true }],
    };
    expect(runCheck(partPublished, pack, input)).toEqual([]);
  });
});

describe('check 8 \u2014 every displayed value is established', () => {
  it('names every unestablished input, not just the first', () => {
    const node: ProvenanceNode = {
      kind: 'step',
      label: 'bay pitch',
      ruleId: 'GEOM-BAY-PITCH',
      inputs: [
        { kind: 'value', label: 'clear span', quantity: quantity(0, 'um', 'UNKNOWN') },
        { kind: 'value', label: 'upright face', quantity: quantity(0, 'um', 'UNKNOWN') },
        { kind: 'value', label: 'known', quantity: inches(3) },
      ],
    };
    const input: CheckInput = {
      ...baseInput(),
      derivedOutputs: [{ label: 'bay pitch', node }],
    };
    const [f] = runCheck(derivedValuesEstablished, pack, input);
    expect(f?.severity).toBe('MISSING_INPUT');
    expect(f?.parameters).toHaveLength(2);
    expect(f?.parameters.every((p) => !p.established)).toBe(true);
  });

  it('stays silent when everything is established', () => {
    const node: ProvenanceNode = { kind: 'value', label: 'span', quantity: inches(96) };
    const input: CheckInput = { ...baseInput(), derivedOutputs: [{ label: 'span', node }] };
    expect(runCheck(derivedValuesEstablished, pack, input)).toEqual([]);
  });
});

describe('check 9 \u2014 site unknowns are the client\u2019s to fix', () => {
  it('names each unknown separately, with who can answer', () => {
    const input: CheckInput = {
      ...baseInput(),
      clearHeight: null,
      columnGridResolved: false,
      commodityClassEstablished: false,
    };
    const findings = runCheck(siteUnknowns, pack, input);
    expect(findings).toHaveLength(3);
    // All actionable by the client: never collapsed into engineering review.
    expect(findings.every((f) => f.severity === 'MISSING_INPUT')).toBe(true);
    expect(findings.map((f) => f.code)).toEqual([
      'CLEAR_HEIGHT_NOT_SURVEYED',
      'COLUMN_GRID_NOT_RESOLVED',
      'COMMODITY_CLASS_NOT_ESTABLISHED',
    ]);
  });
});

describe('check 10 \u2014 citations below primary are surfaced', () => {
  it('names the weak rules used in this evaluation', () => {
    const [f] = runCheck(citationsBelowPrimary, pack, {
      usedRules: [
        { ruleId: 'GEOM-LEVEL-DISTINCT', tier: 'PRIMARY' },
        { ruleId: 'AISLE-CLEAR-WIDTH', tier: 'SECONDARY' },
      ],
    });
    expect(f?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(f?.subjectObjectIds).toEqual(['AISLE-CLEAR-WIDTH']);
    // Client-facing wording never exposes the mechanism (R-15).
    expect(f?.closedBy).toMatch(/Our team will review/);
  });

  it('stays silent when every rule used was primary', () => {
    expect(
      runCheck(citationsBelowPrimary, pack, {
        usedRules: [{ ruleId: 'GEOM-LEVEL-DISTINCT', tier: 'PRIMARY' }],
      }),
    ).toEqual([]);
  });
});

describe('check 11 \u2014 flue geometry carries no verdict', () => {
  it('reports the measurement and cannot conclude anything about sprinklers', () => {
    const input = { ...baseInput(), transverseFlue: inches(6) };
    const [f] = runCheck(flueGeometry, pack, input);
    // The rule is NOT_FOUND, so the ceiling forces NOT EVALUATED. Even if this
    // check were rewritten to assert a blocker, no verdict could escape.
    expect(f?.severity).toBe('NOT_EVALUATED');
    expect(f?.parameters[0]?.established).toBe(true);
    expect(f?.closedBy).toMatch(/draws no sprinkler conclusion/);
  });

  it('stays silent when the flue is not derivable', () => {
    expect(runCheck(flueGeometry, pack, baseInput())).toEqual([]);
  });
});

describe('check 12 \u2014 uncatalogued material', () => {
  it('names the components and refuses to establish capacity from geometry', () => {
    const input: CheckInput = {
      ...baseInput(),
      parts: [
        { id: 'p1', description: 'used upright, unknown make', partRevisionId: null, discontinued: false },
        { id: 'p2', description: 'IB59ET09600', partRevisionId: 'pr-1', discontinued: false },
      ],
    };
    const [f] = runCheck(uncataloguedParts, pack, input);
    expect(f?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(f?.subjectObjectIds).toEqual(['p1']);
    expect(f?.parameters[0]?.established).toBe(false);
    expect(f?.closedBy).toMatch(/dimensional similarity to a published part is not evidence/);
  });

  it('carries no capacity and no table basis at all (AC-09)', () => {
    const input: CheckInput = {
      ...baseInput(),
      parts: [{ id: 'p1', description: 'used beam', partRevisionId: null, discontinued: false }],
    };
    const [f] = runCheck(uncataloguedParts, pack, input);
    // No parameter carries a value, and the citation names the product's own
    // scope constraint rather than a capacity table that was never read.
    expect(f?.parameters.every((p) => !p.established)).toBe(true);
    expect(f?.citation.standard).toBe('Product scope constraint');
  });
});
