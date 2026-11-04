import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { StudioDocument, V1Document } from './document.js';
import { IN } from './length.js';
import { migrateV1ToV2 } from './migrate.js';
import {
  LOST_POSITION_REASONS,
  OBSTRUCTION_ENTITY_KINDS,
  buildSceneFaces,
  closureVector,
  lostPositionLedger,
  resolvePerimeterClosure,
  type WallSegment,
  type WarehouseShell,
} from './shell.js';

const V1 = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/continuity/rack-studio-v1.json', import.meta.url)),
      'utf8',
    ),
  ) as { document: V1Document }
).document;

const doc = (): StudioDocument => migrateV1ToV2(V1).document;

describe('Warehouse Shell, Obstruction-Face Registry (ADR-007), and Lost Positions', () => {
  it('computes instruction-form closure vectors with correct signs (D5)', () => {
    expect(closureVector([])).toEqual({
      closed: false,
      dxUm: 0,
      dyUm: 0,
      instruction: 'Add wall segments to sketch the building perimeter.',
    });

    // Overshot East by 16 in (1 ft 4 in) and South by 3 in -> must move West 1 ft 4 in and North 3 in to close
    const openLoop: readonly WallSegment[] = [
      { id: 'w1', direction: 'E', lengthUm: IN(116) },
      { id: 'w2', direction: 'S', lengthUm: IN(103) },
      { id: 'w3', direction: 'W', lengthUm: IN(100) },
      { id: 'w4', direction: 'N', lengthUm: IN(100) },
    ];
    const c = closureVector(openLoop);
    expect(c.closed).toBe(false);
    expect(c.dxUm).toBe(-IN(16));
    expect(c.dyUm).toBe(-IN(3));
    expect(c.instruction).toBe('Move 1 ft 4 in west and 3 in north to close');

    // Exact feet & opposite direction (east / south)
    const openUnder: readonly WallSegment[] = [
      { id: 'w1', direction: 'W', lengthUm: IN(24) },
      { id: 'w2', direction: 'N', lengthUm: IN(12) },
    ];
    const c2 = closureVector(openUnder);
    expect(c2.instruction).toBe('Move 2 ft east and 1 ft south to close');

    // Closed loop
    const closedLoop: readonly WallSegment[] = [
      { id: 'w1', direction: 'E', lengthUm: IN(100) },
      { id: 'w2', direction: 'S', lengthUm: IN(100) },
      { id: 'w3', direction: 'W', lengthUm: IN(100) },
      { id: 'w4', direction: 'N', lengthUm: IN(100) },
    ];
    const cClosed = closureVector(closedLoop);
    expect(cClosed.closed).toBe(true);
    expect(cClosed.instruction).toBe('Perimeter closed (0 in gap).');
  });

  it('supports all four closure resolution actions (F3)', () => {
    const openSegs: readonly WallSegment[] = [
      { id: 'w1', direction: 'E', lengthUm: IN(120) },
      { id: 'w2', direction: 'S', lengthUm: IN(100) },
      { id: 'w3', direction: 'W', lengthUm: IN(100) },
      { id: 'w4', direction: 'N', lengthUm: IN(90) },
    ];

    // 1. Add closing segment
    const added = resolvePerimeterClosure(openSegs, { action: 'add_closing_segment' });
    expect(added.openLoadingBay).toBe(false);
    expect(closureVector(added.segments).closed).toBe(true);

    // Also test east/south closing branches
    const underSegs: readonly WallSegment[] = [
      { id: 'w1', direction: 'W', lengthUm: IN(20) },
      { id: 'w2', direction: 'N', lengthUm: IN(10) },
    ];
    const addedUnder = resolvePerimeterClosure(underSegs, { action: 'add_closing_segment' });
    expect(closureVector(addedUnder.segments).closed).toBe(true);

    // 2. Adjust last segment (test N, S, E, W last segments)
    const adjN = resolvePerimeterClosure(openSegs, { action: 'adjust_last_segment' });
    expect(adjN.segments[3]?.lengthUm).toBe(IN(100));
    const adjE = resolvePerimeterClosure([{ id: 'w1', direction: 'E', lengthUm: IN(50) }], {
      action: 'adjust_last_segment',
    });
    expect(adjE.segments[0]?.lengthUm).toBe(IN(1));
    const adjW = resolvePerimeterClosure([{ id: 'w1', direction: 'W', lengthUm: IN(50) }], {
      action: 'adjust_last_segment',
    });
    expect(adjW.segments[0]?.lengthUm).toBe(IN(1));
    const adjS = resolvePerimeterClosure([{ id: 'w1', direction: 'S', lengthUm: IN(50) }], {
      action: 'adjust_last_segment',
    });
    expect(adjS.segments[0]?.lengthUm).toBe(IN(1));

    // 3. Distribute error across segments
    const dist = resolvePerimeterClosure(openSegs, { action: 'distribute_error' });
    expect(dist.segments.length).toBe(4);
    expect(closureVector(dist.segments).closed).toBe(true);
    // Distribute error with empty horizontal or vertical counts
    const distOnlyE = resolvePerimeterClosure([{ id: 'w1', direction: 'E', lengthUm: IN(40) }], {
      action: 'distribute_error',
    });
    expect(distOnlyE.segments[0]?.lengthUm).toBe(IN(1));
    const distOnlyS = resolvePerimeterClosure([{ id: 'w1', direction: 'S', lengthUm: IN(40) }], {
      action: 'distribute_error',
    });
    expect(distOnlyS.segments[0]?.lengthUm).toBe(IN(1));

    // 4. Mark open loading bay
    const openBay = resolvePerimeterClosure(openSegs, { action: 'mark_open_loading_bay' });
    expect(openBay.openLoadingBay).toBe(true);

    // Already closed / empty early return
    const emptyRes = resolvePerimeterClosure([], { action: 'mark_open_loading_bay' });
    expect(emptyRes.openLoadingBay).toBe(true);
  });

  it('enumerates and registers Face segments in ClearanceIndex for all 7 entity kinds (ADR-007)', () => {
    const shell: WarehouseShell = {
      walls: [
        { id: 'w1', direction: 'E', lengthUm: IN(600) },
        { id: 'w2', direction: 'S', lengthUm: IN(400) },
        { id: 'w3', direction: 'W', lengthUm: IN(600) },
        { id: 'w4', direction: 'N', lengthUm: IN(400) },
        { id: 'w_zero', direction: 'E', lengthUm: 0 },
      ],
      columns: [
        { id: 'c1', xUm: IN(120), yUm: IN(120), widthUm: IN(12), depthUm: IN(12), guardEnvelopeUm: IN(4) },
        { id: 'c2', xUm: IN(240), yUm: IN(120), widthUm: IN(12), depthUm: IN(12), guardEnvelopeUm: null },
      ],
      kBraces: [
        { id: 'kb1', columnId: 'c1', xUm: IN(120), yUm: IN(120), spanUm: IN(48), projectionUm: IN(12), side: 'E' },
        { id: 'kb2', columnId: 'c2', xUm: IN(240), yUm: IN(120), spanUm: IN(48), projectionUm: IN(12), side: null },
      ],
      doors: [
        {
          id: 'd1',
          xUm: IN(60),
          yUm: 0,
          widthUm: IN(108),
          depthUm: IN(120),
          minClearanceUm: IN(144),
          turningRadiusUm: IN(84),
        },
        {
          id: 'd2',
          xUm: IN(200),
          yUm: 0,
          widthUm: IN(108),
          depthUm: IN(120),
          minClearanceUm: null,
          turningRadiusUm: null,
        },
      ],
      noRackZones: [
        { id: 'z1', xUm: IN(300), yUm: IN(300), widthUm: IN(60), depthUm: IN(60) },
        { id: 'z_empty', xUm: IN(0), yUm: IN(0), widthUm: 0, depthUm: IN(60) },
      ],
    };

    const result = buildSceneFaces(doc(), shell);
    const registeredKinds = new Set(result.faces.map((f) => f.kind));

    // Enumerating assertion: every one of the 7 required entity kinds MUST be registered
    for (const kind of OBSTRUCTION_ENTITY_KINDS) {
      expect(registeredKinds.has(kind)).toBe(true);
    }
    expect(result.index.bucketCount).toBeGreaterThan(0);
    expect(result.missingSources).toEqual(['MS-12', 'MS-4', 'MS-7', 'MS-9']);
  });

  it('reconciles Gross - Lost (by 8 reasons) = Net Usable pallet positions', () => {
    expect(LOST_POSITION_REASONS.length).toBe(8);
    const ledger = lostPositionLedger({
      grossPositions: 1000,
      losses: {
        deleted_bay: 16,
        shortened_bay: 8,
        split_run: 12,
        tunnel: 24,
        column_straddle: 8,
        k_brace_conflict: 16,
        dock_door_clearance: 32,
        wall_perimeter_clearance: 8,
      },
    });
    expect(ledger.totalLostPositions).toBe(124);
    expect(ledger.netUsablePositions).toBe(876);
    expect(ledger.grossPositions - ledger.totalLostPositions).toBe(ledger.netUsablePositions);

    // Default empty losses
    const defaultLedger = lostPositionLedger({ grossPositions: 200 });
    expect(defaultLedger.totalLostPositions).toBe(0);
    expect(defaultLedger.netUsablePositions).toBe(200);
  });
});
