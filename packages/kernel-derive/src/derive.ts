/**
 * kernel-derive (C-02) — rack geometry and pallet-position counts.
 *
 * Everything the drawing shows that the document does not store: bay pitch, run
 * length, overhang allocation, aisle clear width, and gross/lost/net pallet
 * positions. It is pure arithmetic over `Quantity` values, and it never invents
 * a catalog or rule number — the clear span, the upright face, the overhang and
 * the face positions are all supplied by the caller from pinned data or client
 * input.
 *
 * Two rules carry most of the weight, and both are the reason a hand estimate
 * goes wrong:
 *   - a run of n bays has n+1 uprights, so its length is n pitches plus one
 *     closing upright face;
 *   - overhang is allocated front and rear, never halved, so the odd µm lands on
 *     a named side rather than disappearing into a rounding error.
 *
 * Every result carries a ProvenanceNode tree written in the words the sheet
 * prints, so a value's derivation is inspectable rather than a debug label. An
 * UNKNOWN input propagates to an UNKNOWN result: the module never launders an
 * unestablished value into an established one.
 *
 * Pure: no I/O, no clock, no RNG. tools/check-boundaries.mjs enforces it.
 */

import {
  add,
  allocateNamed,
  each,
  scale,
  subtract,
  type ProvenanceNode,
  type Quantity,
} from '@rms/kernel-units';

/** A refusal in the derivation. Every message names what and why. */
export class DerivationError extends Error {
  override readonly name: string = 'DerivationError';
}

/** A derived length or count, with the derivation that produced it. */
export interface Derived {
  readonly quantity: Quantity;
  readonly provenance: ProvenanceNode;
}

function assertPositiveInt(n: number, what: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new DerivationError(`${what} must be a positive integer, got ${n}.`);
  }
}

function assertNonNegativeInt(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new DerivationError(`${what} must be a non-negative integer, got ${n}.`);
  }
}

function leaf(label: string, quantity: Quantity): ProvenanceNode {
  return { kind: 'value', label, quantity };
}

/* ── bay pitch ─────────────────────────────────────────────────────────── */

/**
 * Centre-to-centre bay pitch: the beam clear span plus one upright face.
 *
 * The pitch is the repeating unit of a run. It is a clear span (what a pallet
 * sees) plus the face of the single upright shared between two adjacent bays.
 */
export function bayPitch(clearSpan: Quantity, uprightFace: Quantity): Derived {
  const quantity = add(clearSpan, uprightFace);
  return {
    quantity,
    provenance: {
      kind: 'step',
      label: 'bay pitch = clear span + upright face',
      ruleId: 'derive.bay_pitch',
      inputs: [leaf('beam clear span', clearSpan), leaf('upright face', uprightFace)],
    },
  };
}

/* ── run length ────────────────────────────────────────────────────────── */

/**
 * Run length: n bay pitches plus one closing upright face.
 *
 * A run of n bays has n+1 uprights. n pitches already account for n of them
 * (one per bay, shared on the near side); the closing face is the (n+1)th, on
 * the far end. Dropping it is a one-upright error that looks correct on paper.
 */
export function runLength(pitch: Quantity, bayCount: number, uprightFace: Quantity): Derived {
  assertPositiveInt(bayCount, 'bay count');
  const bays = scale(pitch, bayCount);
  const quantity = add(bays, uprightFace);
  return {
    quantity,
    provenance: {
      kind: 'step',
      label: `run length = ${bayCount} × bay pitch + closing upright face`,
      ruleId: 'derive.run_length',
      inputs: [leaf('bay pitch', pitch), leaf('closing upright face', uprightFace)],
    },
  };
}

/* ── overhang allocation ───────────────────────────────────────────────── */

/** A pallet overhang split into its front and rear shares. */
export interface OverhangSplit {
  readonly front: Quantity;
  readonly rear: Quantity;
  readonly provenance: ProvenanceNode;
}

/**
 * Split a pallet overhang front and rear.
 *
 * Allocated, never halved: an odd µm lands on the front (the aisle side, the
 * conservative one) rather than being lost to a rounding error. The two shares
 * sum to the original exactly.
 */
export function allocateOverhang(overhang: Quantity): OverhangSplit {
  if (overhang.value < 0) {
    throw new DerivationError(
      `pallet overhang cannot be negative, got ${overhang.value} ${overhang.unit}.`,
    );
  }
  const shares = allocateNamed(overhang, ['front', 'rear']);
  return {
    front: shares.front,
    rear: shares.rear,
    provenance: {
      kind: 'step',
      label: 'pallet overhang allocated front and rear (odd µm to the front)',
      ruleId: 'derive.overhang_allocation',
      inputs: [leaf('pallet overhang', overhang)],
    },
  };
}

/* ── aisle clear width ─────────────────────────────────────────────────── */

/**
 * Aisle clear width: the distance between two load faces.
 *
 * Measured face to face, never frame to frame — the ADR-006 datum. The lower
 * face position is subtracted from the higher one, so the argument order does
 * not matter and the result is never negative.
 */
export function aisleClearWidth(faceA: Quantity, faceB: Quantity): Derived {
  const [low, high] = faceA.value <= faceB.value ? [faceA, faceB] : [faceB, faceA];
  const quantity = subtract(high, low);
  return {
    quantity,
    provenance: {
      kind: 'step',
      label: 'aisle clear width = far load face − near load face',
      ruleId: 'derive.aisle_clear_width',
      inputs: [leaf('load face A', faceA), leaf('load face B', faceB)],
    },
  };
}

/* ── position counts ───────────────────────────────────────────────────── */

/** The inputs a gross-position count needs. */
export interface GrossPositionInput {
  readonly positionsPerBay: number;
  readonly bayCount: number;
  /** Beam levels above the floor. */
  readonly beamLevels: number;
  /** Whether the floor itself stores pallets, adding one storage level. */
  readonly floorStores: boolean;
}

/**
 * Gross pallet positions: positions per bay × bays × storage levels.
 *
 * Storage levels are the beam levels plus the floor, but only when the floor
 * actually stores pallets — a rack whose floor is a walkway has beamLevels
 * storage levels, not beamLevels + 1.
 */
export function grossPositions(input: GrossPositionInput): Derived {
  assertPositiveInt(input.positionsPerBay, 'positions per bay');
  assertPositiveInt(input.bayCount, 'bay count');
  assertNonNegativeInt(input.beamLevels, 'beam-level count');

  const storageLevels = input.beamLevels + (input.floorStores ? 1 : 0);
  const value = input.positionsPerBay * input.bayCount * storageLevels;
  const quantity = each(value, 'DERIVED');
  return {
    quantity,
    provenance: {
      kind: 'step',
      label:
        `gross positions = ${input.positionsPerBay} per bay × ${input.bayCount} bays ` +
        `× ${storageLevels} storage levels` +
        (input.floorStores ? ' (floor stores)' : ''),
      ruleId: 'derive.gross_positions',
      inputs: [
        leaf('positions per bay', each(input.positionsPerBay, 'DERIVED')),
        leaf('bay count', each(input.bayCount, 'DERIVED')),
        leaf('storage levels', each(storageLevels, 'DERIVED')),
      ],
    },
  };
}

/** One reason positions were lost, and how many. */
export interface PositionLoss {
  readonly reason: string;
  readonly count: Quantity;
}

/**
 * Gross, lost and net positions reported together, with the loss broken down by
 * reason. Two invariants a test asserts, so a defect cannot pass silently:
 *   - the per-reason breakdown sums exactly to the total lost;
 *   - net + lost = gross.
 *
 * Reporting net alone hides where the positions went; reporting lost alone
 * hides how many survived. The accounting always carries all three.
 */
export interface PositionAccounting {
  readonly gross: Quantity;
  readonly lost: Quantity;
  readonly net: Quantity;
  readonly byReason: readonly PositionLoss[];
  readonly provenance: ProvenanceNode;
}

export function positionAccounting(
  gross: Derived,
  losses: readonly PositionLoss[],
): PositionAccounting {
  let lostValue = 0;
  const byReason: PositionLoss[] = [];
  for (const loss of losses) {
    if (loss.reason.trim() === '') {
      throw new DerivationError('every position loss must carry a reason.');
    }
    if (loss.count.unit !== 'ea') {
      throw new DerivationError(
        `a position loss is a count and must be in 'ea', got '${loss.count.unit}' ` +
          `for "${loss.reason}".`,
      );
    }
    assertNonNegativeInt(loss.count.value, `positions lost to "${loss.reason}"`);
    lostValue += loss.count.value;
    byReason.push(loss);
  }

  if (lostValue > gross.quantity.value) {
    throw new DerivationError(
      `positions lost (${lostValue}) exceed gross (${gross.quantity.value}): ` +
        'cannot lose more positions than exist.',
    );
  }

  const lost = each(lostValue, 'DERIVED');
  const net = subtract(gross.quantity, lost);
  return {
    gross: gross.quantity,
    lost,
    net,
    byReason: Object.freeze([...byReason]),
    provenance: {
      kind: 'step',
      label: 'net positions = gross − Σ(lost by reason)',
      ruleId: 'derive.net_positions',
      inputs: [
        gross.provenance,
        leaf('positions lost', lost),
      ],
    },
  };
}
