/**
 * The bridge: a studio document becomes provenanced quantities.
 *
 * Build-plan **S2.3**. One direction only — `toKernel` exists and `fromKernel`
 * deliberately does not. A quantity that could be written back into the document
 * would let a derived number become an input on the next save, and the
 * provenance chain would close into a loop that says every value came from
 * itself.
 *
 * **What the origins mean here**, and they are the whole point of the bridge:
 *
 *   `INPUT`    a person entered it and it is established
 *   `CATALOG`  it came from a pinned catalog release
 *   `RULE`     it came from a pinned rule pack
 *   `UNKNOWN`  it has not been established — renders VERIFY, never a numeral
 *
 * A `Witnessed<T>` in the document carries exactly those four states, so the
 * mapping is total and no value acquires an origin by default. That matters at
 * this boundary more than anywhere: `kernel-units` will happily do arithmetic
 * on an `UNKNOWN`, and `display-list` is what refuses to print the result — so
 * an origin lost here is a VERIFY that silently becomes a number on a drawing.
 *
 * Geometry is **derived, never read**. Bay pitch and run length come from
 * `kernel-derive`, which is the only place that arithmetic lives. This module
 * assembles inputs and hands them over; it computes nothing itself.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { bayPitch, runLength } from '@rms/kernel-derive';
import { um, type Origin, type Quantity } from '@rms/kernel-units';

import {
  bayTypeForRun,
  type BayType,
  type Run,
  type StudioDocument,
  type Witnessed,
} from './document.js';
import type { Micrometres } from './length.js';

export class BridgeError extends Error {
  override readonly name = 'BridgeError';
}

/**
 * A length the document holds as a plain integer.
 *
 * These are `INPUT` because that is what an unwitnessed length in the document
 * IS — a value someone entered. The witnessed ones go through
 * `witnessedQuantity`, which can say otherwise.
 */
export function length(value: Micrometres, origin: Origin = 'INPUT'): Quantity {
  if (!Number.isSafeInteger(value)) {
    throw new BridgeError(
      `a stored length must be a whole number of micrometres, got ${String(value)}. ` +
        'The document is the wrong shape; this is not a rounding to paper over.',
    );
  }
  return um(value, origin);
}

/** A witnessed length keeps the origin the document recorded for it. */
export function witnessedQuantity(w: Witnessed<Micrometres>): Quantity {
  return length(w.value, w.established);
}

/** One run, in the shape `@rms/display-list`'s `buildPlan` consumes. */
export interface RunGeometry {
  readonly runId: string;
  readonly offsetX: Quantity;
  readonly offsetY: Quantity;
  readonly bays: number;
  readonly bayPitch: Quantity;
  readonly runLength: Quantity;
  readonly frameDepth: Quantity;
  readonly uprightFace: Quantity;
}

/**
 * Derive one run's plan geometry.
 *
 * The beam length in the document is the **clear span** between uprights, so
 * pitch is span + one upright face and a run of n bays closes with one more
 * face — the n+1-upright rule, which `kernel-derive.runLength` owns.
 *
 * A back-to-back run is drawn at twice the frame depth plus its row spacer.
 * Reading that off the run rather than assuming single-depth is the difference
 * between an aisle measured to the right face and one measured to the wrong one.
 */
export function runGeometry(doc: StudioDocument, run: Run): RunGeometry {
  const bt: BayType | undefined = bayTypeForRun(doc, run);
  if (bt === undefined) {
    throw new BridgeError(
      `run ${run.id} (${run.name}) references bay type ${run.bayTypeId}, which is not in this ` +
        'document. Refusing rather than falling back to the first bay type: every dimension ' +
        'derived from the wrong type would be real, traceable and about a different rack.',
    );
  }
  if (run.bays.length === 0) {
    throw new BridgeError(`run ${run.id} (${run.name}) has no bays, so it has no geometry.`);
  }

  const uprightFace = length(bt.uprightWidth);
  const pitch = bayPitch(length(bt.beamLength), uprightFace);
  const total = runLength(pitch.quantity, run.bays.length, uprightFace);

  const depth = run.backToBack
    ? length(bt.frameDepth * 2 + run.rowSpacer)
    : length(bt.frameDepth);

  return {
    runId: run.id,
    offsetX: length(run.x),
    offsetY: length(run.y),
    bays: run.bays.length,
    bayPitch: pitch.quantity,
    runLength: total.quantity,
    frameDepth: depth,
    uprightFace,
  };
}

/** One aisle, in `buildPlan`'s shape. `clearWidth` is null when not derivable. */
export interface AisleGeometry {
  readonly aisleId: string;
  readonly offsetX: Quantity;
  readonly offsetY: Quantity;
  readonly length: Quantity;
  readonly clearWidth: Quantity | null;
}

export interface KernelScene {
  readonly runs: readonly RunGeometry[];
  readonly aisles: readonly AisleGeometry[];
  readonly extent: { readonly width: Quantity; readonly height: Quantity };
}

/**
 * The whole document as plan geometry.
 *
 * Aisles are derived between vertically adjacent runs, measured **frame face to
 * frame face**. ADR-006's datum is load face to load face, and this is not that
 * — the pallet envelope is not modelled yet, so a load-face aisle cannot be
 * derived without inventing an overhang. Reporting the frame-to-frame gap under
 * a name that says `frameToFrame` is honest; reporting it as the ADR-006 clear
 * width would be a number that looks like a compliance answer and is not one.
 *
 * `clearWidth` is therefore **null** on every aisle here, which is what makes
 * `display-list` print VERIFY rather than a numeral. That is deliberate and it
 * is the correct state until pallet envelopes land.
 */
export function toKernel(doc: StudioDocument): KernelScene {
  const runs = doc.runs.map((r) => runGeometry(doc, r));

  const ordered = [...runs].sort((a, b) => a.offsetY.value - b.offsetY.value);
  const aisles: AisleGeometry[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const above = ordered[i] as RunGeometry;
    const below = ordered[i + 1] as RunGeometry;
    const gapStart = above.offsetY.value + above.frameDepth.value;
    const gap = below.offsetY.value - gapStart;
    // A split sibling sits beside its parent at the same y, not across an
    // aisle from it. A non-positive gap is not an aisle and is not reported as
    // one — least of all as a negative width, which is what defect D-B produced.
    if (gap <= 0) continue;
    aisles.push({
      aisleId: `aisle:${above.runId}->${below.runId}`,
      offsetX: length(Math.min(above.offsetX.value, below.offsetX.value)),
      offsetY: length(gapStart),
      length: length(Math.max(above.runLength.value, below.runLength.value)),
      clearWidth: null,
    });
  }

  const width = runs.reduce((m, r) => Math.max(m, r.offsetX.value + r.runLength.value), 0);
  const height = runs.reduce((m, r) => Math.max(m, r.offsetY.value + r.frameDepth.value), 0);

  return { runs, aisles, extent: { width: length(width), height: length(height) } };
}
