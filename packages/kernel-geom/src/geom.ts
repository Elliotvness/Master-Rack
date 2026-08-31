/**
 * kernel-geom (C-03) — obstruction faces and the clearance index.
 *
 * ADR-006 fixed the datum: an aisle's clear width is the distance between two
 * physical faces, never between drawn centrelines. ADR-007 generalised it — any
 * of a wall, upright, pallet overhang, column guard, K-brace envelope, dock
 * barrier or no-rack zone can be the nearest thing bounding an aisle, so
 * `clear = frameToFrame − 2 × overhang` becomes one case of a nearest-opposing-
 * face query.
 *
 * The Task 0.4 benchmark then fixed the *implementation*: a full-scene sweep is
 * 63.79 ms p95 brute force (four times a frame budget) and 1.34 ms with a
 * span-bucketed index, so the index is required, not an optimisation to reach
 * for later. Faces are bucketed by (axis, normal, span bucket) with each bucket
 * sorted by coordinate; a query walks only the buckets its span touches and
 * scans forward from its own coordinate.
 *
 * A face is axis-aligned: an axis, a coordinate on that axis, a span on the
 * other axis, and a normal saying which way the obstruction looks. Two faces
 * can see each other only if they share an axis, oppose in normal, face toward
 * each other, and overlap in span; the clearance is the coordinate difference.
 *
 * Everything is integer µm — the storage base of `kernel-units` — so there is no
 * float anywhere in the query and a clearance is exact. The brute-force method
 * is kept as the correctness oracle the index is asserted against: a faster
 * wrong answer is not a result.
 *
 * Pure: no I/O, no clock, no RNG. tools/check-boundaries.mjs enforces it.
 */

import { um, type Origin, type Quantity } from '@rms/kernel-units';

/** A refusal in the geometry layer. Every message names what and why. */
export class GeomError extends Error {
  override readonly name: string = 'GeomError';
}

/** The axis a face's coordinate lives on. */
export type Axis = 'x' | 'y';

/**
 * Which way a face looks along its axis: +1 faces increasing coordinate, −1
 * faces decreasing. Two faces oppose when their normals differ.
 */
export type Normal = 1 | -1;

/**
 * An axis-aligned obstruction face.
 *
 * `coord`, `lo` and `hi` are integer µm. `lo`/`hi` are the span on the *other*
 * axis: an 'x' face at coord=c spans y ∈ [lo, hi]. `kind` is free-form data, not
 * a hard-coded enum — ADR-007 requires that adding a new obstructing object type
 * not mean editing this module.
 */
export interface Face {
  readonly id: string;
  readonly kind: string;
  readonly axis: Axis;
  readonly coord: number;
  readonly lo: number;
  readonly hi: number;
  readonly normal: Normal;
}

/**
 * Build a face, validating it. A face whose span is empty (`lo >= hi`) or whose
 * coordinates are not integers is a data error, not something to measure
 * against silently.
 */
export function face(spec: {
  id: string;
  kind: string;
  axis: Axis;
  coord: number;
  lo: number;
  hi: number;
  normal: Normal;
}): Face {
  if (spec.id.trim() === '') {
    throw new GeomError('a face must carry an id.');
  }
  for (const [name, v] of [
    ['coord', spec.coord],
    ['lo', spec.lo],
    ['hi', spec.hi],
  ] as const) {
    if (!Number.isSafeInteger(v)) {
      throw new GeomError(
        `face "${spec.id}" ${name} must be an integer µm, got ${v}.`,
      );
    }
  }
  if (spec.lo >= spec.hi) {
    throw new GeomError(
      `face "${spec.id}" has an empty span: lo (${spec.lo}) must be below hi (${spec.hi}).`,
    );
  }
  return Object.freeze({
    id: spec.id,
    kind: spec.kind,
    axis: spec.axis,
    coord: spec.coord,
    lo: spec.lo,
    hi: spec.hi,
    normal: spec.normal,
  });
}

/**
 * Do two faces oppose and overlap so one can bound a clearance from the other?
 * They must share an axis, differ in normal, and overlap on the span axis.
 * Whether they actually *face* each other (the coordinate difference has the
 * right sign) is decided per query, because it depends on the direction.
 */
function spanOverlaps(a: Face, b: Face): boolean {
  return b.hi > a.lo && b.lo < a.hi;
}

/**
 * The signed clearance from face `a` to face `b` in a's facing direction: a
 * positive value means `b` sits ahead of `a`. A non-positive value means `b` is
 * behind or on `a` and cannot bound it.
 */
function facingDistance(a: Face, b: Face): number {
  return a.normal > 0 ? b.coord - a.coord : a.coord - b.coord;
}

/**
 * Brute-force nearest opposing face. Kept as the correctness oracle: it is
 * obviously correct and the index is asserted to agree with it everywhere.
 * Returns `null` when nothing opposes the face in its facing direction.
 */
export function minClearanceBrute(faces: readonly Face[], i: number): number | null {
  const a = faces[i];
  if (a === undefined) {
    throw new GeomError(`no face at index ${i}.`);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j < faces.length; j += 1) {
    if (j === i) continue;
    const b = faces[j] as Face;
    if (b.axis !== a.axis || b.normal === a.normal) continue;
    if (!spanOverlaps(a, b)) continue;
    const d = facingDistance(a, b);
    if (d > 0 && d < best) best = d;
  }
  return best === Number.POSITIVE_INFINITY ? null : best;
}

/**
 * A span-bucketed clearance index over a fixed face set (ADR-007's required
 * implementation). Faces are bucketed by (axis, normal, span bucket) and each
 * bucket is sorted by coordinate, so a query walks only the buckets its span
 * touches and scans forward from its own coordinate.
 *
 * The index is immutable once built. The benchmark showed a full rebuild is
 * 1.87 ms, cheap enough that incremental invalidation is deliberately not built
 * for v1 — rebuild on a geometry change instead.
 */
export class ClearanceIndex {
  /** Bucket width on the span axis, in µm. 120 in — the benchmark's value. */
  static readonly BUCKET_UM = 3_048_000;

  private readonly faces: readonly Face[];
  private readonly buckets: Map<string, number[]>;

  constructor(faces: readonly Face[]) {
    this.faces = faces;
    this.buckets = new Map();
    for (let i = 0; i < faces.length; i += 1) {
      const f = faces[i] as Face;
      const b0 = Math.floor(f.lo / ClearanceIndex.BUCKET_UM);
      const b1 = Math.floor((f.hi - 1) / ClearanceIndex.BUCKET_UM);
      for (let b = b0; b <= b1; b += 1) {
        const k = ClearanceIndex.key(f.axis, f.normal, b);
        const arr = this.buckets.get(k);
        if (arr === undefined) {
          this.buckets.set(k, [i]);
        } else {
          arr.push(i);
        }
      }
    }
    for (const arr of this.buckets.values()) {
      arr.sort((p, q) => (this.faces[p] as Face).coord - (this.faces[q] as Face).coord);
    }
  }

  private static key(axis: Axis, normal: Normal, bucket: number): string {
    return `${axis}\u0000${normal}\u0000${bucket}`;
  }

  /** Number of buckets, for tests and diagnostics. */
  get bucketCount(): number {
    return this.buckets.size;
  }

  /**
   * Nearest opposing face to `faces[i]`, walking only the touched buckets. Must
   * return exactly what `minClearanceBrute` would; that equivalence is the
   * property the tests assert across a whole scene.
   */
  minClearance(i: number): number | null {
    const a = this.faces[i];
    if (a === undefined) {
      throw new GeomError(`no face at index ${i}.`);
    }
    const want: Normal = a.normal > 0 ? -1 : 1;
    let best = Number.POSITIVE_INFINITY;
    const b0 = Math.floor(a.lo / ClearanceIndex.BUCKET_UM);
    const b1 = Math.floor((a.hi - 1) / ClearanceIndex.BUCKET_UM);

    for (let b = b0; b <= b1; b += 1) {
      const arr = this.buckets.get(ClearanceIndex.key(a.axis, want, b));
      if (arr === undefined) continue;

      // Binary-search to the first face with coord > a.coord.
      let loI = 0;
      let hiI = arr.length;
      while (loI < hiI) {
        const m = (loI + hiI) >> 1;
        if ((this.faces[arr[m] as number] as Face).coord <= a.coord) loI = m + 1;
        else hiI = m;
      }

      if (a.normal > 0) {
        // Faces ahead are those with larger coord: scan forward.
        for (let k = loI; k < arr.length; k += 1) {
          const b2 = this.faces[arr[k] as number] as Face;
          const d = b2.coord - a.coord;
          if (d >= best) break;
          if (spanOverlaps(a, b2) && d > 0) {
            best = d;
            break;
          }
        }
      } else {
        // Faces ahead are those with smaller coord: scan backward.
        for (let k = loI - 1; k >= 0; k -= 1) {
          const b2 = this.faces[arr[k] as number] as Face;
          const d = a.coord - b2.coord;
          if (d >= best) break;
          if (spanOverlaps(a, b2) && d > 0) {
            best = d;
            break;
          }
        }
      }
    }

    return best === Number.POSITIVE_INFINITY ? null : best;
  }

  /**
   * Nearest opposing face as a length `Quantity`, or `null` when nothing
   * opposes. The origin is the caller's to state: a clearance derived from
   * established faces is DERIVED, but the caller may pass UNKNOWN to mark a scene
   * built partly from unsurveyed positions.
   */
  minClearanceQuantity(i: number, origin: Origin = 'DERIVED'): Quantity | null {
    const d = this.minClearance(i);
    return d === null ? null : um(d, origin);
  }
}
