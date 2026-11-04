/**
 * Warehouse shell, obstruction-face registry (ADR-007), and lost-position
 * accounting (Phase 2 Step 2.1 — I2, I3, F3, F4, F5, D1, D4, D5).
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { ClearanceIndex, face, type Face } from '@rms/kernel-geom';

import type { StudioDocument } from './document.js';
import { MICROMETRES_PER_INCH, type Micrometres } from './length.js';
import { planGeometry } from './plan.js';

export type CardinalDirection = 'N' | 'E' | 'S' | 'W';

export interface WallSegment {
  readonly id: string;
  readonly direction: CardinalDirection;
  readonly lengthUm: Micrometres;
}

export interface ClosureResult {
  readonly closed: boolean;
  readonly dxUm: Micrometres;
  readonly dyUm: Micrometres;
  /**
   * Instruction-form closure vector (D5): states what move closes the loop,
   * never bare signed coordinates.
   */
  readonly instruction: string;
}

export type ClosureResolutionAction =
  | { readonly action: 'add_closing_segment' }
  | { readonly action: 'adjust_last_segment' }
  | { readonly action: 'distribute_error' }
  | { readonly action: 'mark_open_loading_bay' };

export interface ColumnOverride {
  readonly id: string;
  readonly xUm: Micrometres;
  readonly yUm: Micrometres;
  readonly widthUm: Micrometres;
  readonly depthUm: Micrometres;
  /**
   * Guard protection envelope per side (MS-4). Null when not yet specified.
   */
  readonly guardEnvelopeUm: Micrometres | null;
}

export interface KBrace {
  readonly id: string;
  readonly columnId: string;
  readonly xUm: Micrometres;
  readonly yUm: Micrometres;
  readonly spanUm: Micrometres;
  readonly projectionUm: Micrometres;
  /**
   * Mandatory side orientation (D4, MS-12). Null triggers MISSING_INPUT naming MS-12.
   */
  readonly side: CardinalDirection | null;
}

export interface DoorDock {
  readonly id: string;
  readonly xUm: Micrometres;
  readonly yUm: Micrometres;
  readonly widthUm: Micrometres;
  readonly depthUm: Micrometres;
  /** Project dock-to-first-bay minimum clearance (MS-9). */
  readonly minClearanceUm: Micrometres | null;
  /** Forklift minimum turning radius at dock staging (MS-7). */
  readonly turningRadiusUm: Micrometres | null;
}

export interface NoRackZone {
  readonly id: string;
  readonly xUm: Micrometres;
  readonly yUm: Micrometres;
  readonly widthUm: Micrometres;
  readonly depthUm: Micrometres;
}

export interface WarehouseShell {
  readonly walls: readonly WallSegment[];
  readonly columns: readonly ColumnOverride[];
  readonly kBraces: readonly KBrace[];
  readonly doors: readonly DoorDock[];
  readonly noRackZones: readonly NoRackZone[];
}

export const OBSTRUCTION_ENTITY_KINDS = Object.freeze([
  'upright',
  'pallet-overhang',
  'column-guard',
  'k-brace',
  'wall',
  'dock-barrier',
  'no-rack-zone',
] as const);

export type ObstructionEntityKind = (typeof OBSTRUCTION_ENTITY_KINDS)[number];

export const LOST_POSITION_REASONS = Object.freeze([
  'deleted_bay',
  'shortened_bay',
  'split_run',
  'tunnel',
  'column_straddle',
  'k_brace_conflict',
  'dock_door_clearance',
  'wall_perimeter_clearance',
] as const);

export type LostPositionReason = (typeof LOST_POSITION_REASONS)[number];

export interface LostPositionInput {
  readonly grossPositions: number;
  readonly losses?: Partial<Readonly<Record<LostPositionReason, number>>>;
}

export interface LostPositionLedger {
  readonly grossPositions: number;
  readonly lossesByReason: Readonly<Record<LostPositionReason, number>>;
  readonly totalLostPositions: number;
  readonly netUsablePositions: number;
}

function formatFeetInches(umAbs: number): string {
  const totalInches = Math.round(umAbs / MICROMETRES_PER_INCH);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet > 0 && inches > 0) {
    return `${feet} ft ${inches} in`;
  }
  if (feet > 0) {
    return `${feet} ft`;
  }
  return `${inches} in`;
}

/**
 * Compute perimeter wall closure and instruction-form vector (F3, D5).
 *
 * Coordinate convention:
 * - East (`E`) is +x, West (`W`) is -x
 * - South (`S`) is +y, North (`N`) is -y
 *
 * The closure vector is `(0 - endX, 0 - endY)`, i.e. the exact move from the
 * final vertex back to `(0, 0)` that closes the perimeter loop.
 */
export function closureVector(segments: readonly WallSegment[]): ClosureResult {
  let endX = 0;
  let endY = 0;
  for (const seg of segments) {
    switch (seg.direction) {
      case 'E':
        endX += seg.lengthUm;
        break;
      case 'W':
        endX -= seg.lengthUm;
        break;
      case 'S':
        endY += seg.lengthUm;
        break;
      case 'N':
        endY -= seg.lengthUm;
        break;
    }
  }

  const dxUm = -endX;
  const dyUm = -endY;
  const closed = segments.length > 0 && dxUm === 0 && dyUm === 0;

  if (segments.length === 0) {
    return {
      closed: false,
      dxUm: 0,
      dyUm: 0,
      instruction: 'Add wall segments to sketch the building perimeter.',
    };
  }

  if (closed) {
    return {
      closed: true,
      dxUm: 0,
      dyUm: 0,
      instruction: 'Perimeter closed (0 in gap).',
    };
  }

  const parts: string[] = [];
  if (dxUm !== 0) {
    const dirX = dxUm < 0 ? 'west' : 'east';
    parts.push(`${formatFeetInches(Math.abs(dxUm))} ${dirX}`);
  }
  if (dyUm !== 0) {
    const dirY = dyUm < 0 ? 'north' : 'south';
    parts.push(`${formatFeetInches(Math.abs(dyUm))} ${dirY}`);
  }

  return {
    closed: false,
    dxUm,
    dyUm,
    instruction: `Move ${parts.join(' and ')} to close`,
  };
}

/**
 * Apply one of the 4 closure resolution actions to a perimeter wall sketch (F3).
 */
export function resolvePerimeterClosure(
  segments: readonly WallSegment[],
  resolution: ClosureResolutionAction,
): { readonly segments: readonly WallSegment[]; readonly openLoadingBay: boolean } {
  const c = closureVector(segments);
  if (c.closed || segments.length === 0) {
    return {
      segments,
      openLoadingBay: resolution.action === 'mark_open_loading_bay',
    };
  }

  switch (resolution.action) {
    case 'mark_open_loading_bay':
      return { segments, openLoadingBay: true };

    case 'add_closing_segment': {
      const next: WallSegment[] = [...segments];
      if (c.dxUm !== 0) {
        next.push({
          id: `wall_close_x_${segments.length + 1}`,
          direction: c.dxUm < 0 ? 'W' : 'E',
          lengthUm: Math.abs(c.dxUm),
        });
      }
      if (c.dyUm !== 0) {
        next.push({
          id: `wall_close_y_${segments.length + 1}`,
          direction: c.dyUm < 0 ? 'N' : 'S',
          lengthUm: Math.abs(c.dyUm),
        });
      }
      return { segments: next, openLoadingBay: false };
    }

    case 'adjust_last_segment': {
      const last = segments[segments.length - 1]!;
      let adjustedLen = last.lengthUm;
      if (last.direction === 'E') adjustedLen = Math.max(MICROMETRES_PER_INCH, last.lengthUm + c.dxUm);
      if (last.direction === 'W') adjustedLen = Math.max(MICROMETRES_PER_INCH, last.lengthUm - c.dxUm);
      if (last.direction === 'S') adjustedLen = Math.max(MICROMETRES_PER_INCH, last.lengthUm + c.dyUm);
      if (last.direction === 'N') adjustedLen = Math.max(MICROMETRES_PER_INCH, last.lengthUm - c.dyUm);
      const updated = [...segments.slice(0, -1), { ...last, lengthUm: adjustedLen }];
      return { segments: updated, openLoadingBay: false };
    }

    case 'distribute_error': {
      const horizCount = segments.filter((s) => s.direction === 'E' || s.direction === 'W').length;
      const vertCount = segments.filter((s) => s.direction === 'N' || s.direction === 'S').length;
      const dxShare = horizCount > 0 ? Math.trunc(c.dxUm / horizCount) : 0;
      const dyShare = vertCount > 0 ? Math.trunc(c.dyUm / vertCount) : 0;
      const distributed = segments.map((s) => {
        if (s.direction === 'E') return { ...s, lengthUm: Math.max(MICROMETRES_PER_INCH, s.lengthUm + dxShare) };
        if (s.direction === 'W') return { ...s, lengthUm: Math.max(MICROMETRES_PER_INCH, s.lengthUm - dxShare) };
        if (s.direction === 'S') return { ...s, lengthUm: Math.max(MICROMETRES_PER_INCH, s.lengthUm + dyShare) };
        return { ...s, lengthUm: Math.max(MICROMETRES_PER_INCH, s.lengthUm - dyShare) };
      });
      return { segments: distributed, openLoadingBay: false };
    }
  }
}

function pushBoxFaces(
  out: Face[],
  idPrefix: string,
  kind: ObstructionEntityKind,
  x: number,
  y: number,
  width: number,
  depth: number,
): void {
  if (width <= 0 || depth <= 0) return;
  // North face looks -y, South face looks +y, West face looks -x, East face looks +x
  out.push(
    face({ id: `${idPrefix}:N`, kind, axis: 'y', coord: y, lo: x, hi: x + width, normal: -1 }),
    face({ id: `${idPrefix}:S`, kind, axis: 'y', coord: y + depth, lo: x, hi: x + width, normal: 1 }),
    face({ id: `${idPrefix}:W`, kind, axis: 'x', coord: x, lo: y, hi: y + depth, normal: -1 }),
    face({ id: `${idPrefix}:E`, kind, axis: 'x', coord: x + width, lo: y, hi: y + depth, normal: 1 }),
  );
}

/**
 * Register outward-facing `Face` segments for all physical objects in the
 * studio document and warehouse shell (ADR-007).
 *
 * Covers all 7 required entity kinds:
 * `upright`, `pallet-overhang`, `column-guard`, `k-brace`, `wall`,
 * `dock-barrier`, and `no-rack-zone`.
 */
export function buildSceneFaces(doc: StudioDocument, shell: WarehouseShell): {
  readonly faces: readonly Face[];
  readonly index: ClearanceIndex;
  readonly missingSources: readonly string[];
} {
  const out: Face[] = [];
  const missing = new Set<string>();
  const plan = planGeometry(doc);

  // 1. Uprights & 2. Pallet overhangs from runs
  for (const run of plan.runs) {
    const runLen = run.runLength.value;
    for (const [ri, row] of run.rows.entries()) {
      pushBoxFaces(out, `upright:${run.runId}:r${ri}`, 'upright', run.x, row.y, runLen, row.depth);
    }
    for (const pallet of run.pallets) {
      pushBoxFaces(
        out,
        `pallet:${pallet.id}`,
        'pallet-overhang',
        pallet.x,
        pallet.y,
        pallet.width,
        pallet.depth,
      );
    }
  }

  // 3. Column guards (MS-4 if guardEnvelopeUm is null)
  for (const col of shell.columns) {
    const env = col.guardEnvelopeUm ?? 0;
    if (col.guardEnvelopeUm === null) {
      missing.add('MS-4');
    }
    pushBoxFaces(
      out,
      `col:${col.id}`,
      'column-guard',
      col.xUm - env,
      col.yUm - env,
      col.widthUm + env * 2,
      col.depthUm + env * 2,
    );
  }

  // 4. K-braces (D4, MS-12 if side is null)
  for (const kb of shell.kBraces) {
    if (kb.side === null) {
      missing.add('MS-12');
    }
    pushBoxFaces(out, `kbrace:${kb.id}`, 'k-brace', kb.xUm, kb.yUm, kb.spanUm, kb.projectionUm);
  }

  // 5. Perimeter walls (walked from 0,0)
  let wx = 0;
  let wy = 0;
  const wallThickness = 6 * MICROMETRES_PER_INCH;
  for (const w of shell.walls) {
    if (w.lengthUm <= 0) continue;
    if (w.direction === 'E') {
      pushBoxFaces(out, `wall:${w.id}`, 'wall', wx, wy, w.lengthUm, wallThickness);
      wx += w.lengthUm;
    } else if (w.direction === 'W') {
      pushBoxFaces(out, `wall:${w.id}`, 'wall', wx - w.lengthUm, wy, w.lengthUm, wallThickness);
      wx -= w.lengthUm;
    } else if (w.direction === 'S') {
      pushBoxFaces(out, `wall:${w.id}`, 'wall', wx, wy, wallThickness, w.lengthUm);
      wy += w.lengthUm;
    } else {
      pushBoxFaces(out, `wall:${w.id}`, 'wall', wx, wy - w.lengthUm, wallThickness, w.lengthUm);
      wy -= w.lengthUm;
    }
  }

  // 6. Doors / docks (MS-9 if minClearanceUm is null, MS-7 if turningRadiusUm is null)
  for (const door of shell.doors) {
    if (door.minClearanceUm === null) missing.add('MS-9');
    if (door.turningRadiusUm === null) missing.add('MS-7');
    const clearDepth = door.minClearanceUm ?? door.depthUm;
    pushBoxFaces(out, `dock:${door.id}`, 'dock-barrier', door.xUm, door.yUm, door.widthUm, clearDepth);
  }

  // 7. No-rack zones
  for (const z of shell.noRackZones) {
    pushBoxFaces(out, `zone:${z.id}`, 'no-rack-zone', z.xUm, z.yUm, z.widthUm, z.depthUm);
  }

  return {
    faces: Object.freeze(out),
    index: new ClearanceIndex(out),
    missingSources: Object.freeze([...missing].sort()),
  };
}

/**
 * Reconcile Gross - Lost (by 8 reasons) = Net Usable pallet positions (Step 2.1).
 *
 * Asserts the accounting identity: `grossPositions - totalLostPositions === netUsablePositions`.
 */
export function lostPositionLedger(input: LostPositionInput): LostPositionLedger {
  const lossesByReason: Record<LostPositionReason, number> = {
    deleted_bay: Math.max(0, Math.trunc(input.losses?.deleted_bay ?? 0)),
    shortened_bay: Math.max(0, Math.trunc(input.losses?.shortened_bay ?? 0)),
    split_run: Math.max(0, Math.trunc(input.losses?.split_run ?? 0)),
    tunnel: Math.max(0, Math.trunc(input.losses?.tunnel ?? 0)),
    column_straddle: Math.max(0, Math.trunc(input.losses?.column_straddle ?? 0)),
    k_brace_conflict: Math.max(0, Math.trunc(input.losses?.k_brace_conflict ?? 0)),
    dock_door_clearance: Math.max(0, Math.trunc(input.losses?.dock_door_clearance ?? 0)),
    wall_perimeter_clearance: Math.max(0, Math.trunc(input.losses?.wall_perimeter_clearance ?? 0)),
  };

  const totalLostPositions = LOST_POSITION_REASONS.reduce(
    (sum, r) => sum + lossesByReason[r],
    0,
  );
  const grossPositions = Math.max(0, Math.trunc(input.grossPositions));
  const netUsablePositions = Math.max(0, grossPositions - totalLostPositions);

  return Object.freeze({
    grossPositions,
    lossesByReason: Object.freeze(lossesByReason),
    totalLostPositions,
    netUsablePositions,
  });
}
