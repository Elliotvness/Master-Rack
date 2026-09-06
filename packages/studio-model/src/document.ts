/**
 * The studio document.
 *
 * Two shapes live here. **v1** is the prototype's, in mil, typed exactly as the
 * continuity fixture holds it — it exists to be migrated from and is never
 * constructed by this build. **v2** is the studio's own: micrometres (ADR-005,
 * DEC-2), the entity fields ADR-008 asks for, and the pack pins made explicit.
 *
 * ADR-008 governs the shape: **a bay references a bay type; geometry is derived,
 * never stored.** A bay carries an id and whether it is locked, and nothing
 * else. Its width, its position and its capacity are all functions of the bay
 * type and the run — asking a bay where it is would create a second place for a
 * dimension to live, which is the defect the whole architecture is arranged to
 * prevent.
 *
 * Every field is `readonly`. Commands return new documents rather than editing
 * these in place, so an undo can hold the previous one without defensive
 * copying and a React store can compare by reference.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { EntityId } from './ids.js';
import type { Micrometres, Mil } from './length.js';

/* ── v1 — the prototype's document, in mil ─────────────────────────────── */

export interface V1BayType {
  readonly id: EntityId;
  readonly name: string;
  readonly uprightPart: string;
  readonly uprightWidth: Mil;
  readonly frameDepth: Mil;
  readonly frameHeight: Mil;
  readonly frameHeightApproximated?: boolean;
  readonly beamPart: string;
  readonly beamLength: Mil;
  readonly beamLevels: readonly Mil[];
  readonly palletsPerBay: number;
  readonly beamPairCapacity: number;
  readonly capacityVerified: boolean;
}

export interface V1Bay {
  readonly id: EntityId;
  readonly locked: boolean;
}

export interface V1Run {
  readonly id: EntityId;
  readonly name: string;
  readonly bayTypeId: EntityId;
  readonly x: Mil;
  readonly y: Mil;
  readonly backToBack: boolean;
  readonly rowSpacer: Mil;
  readonly floorStorage: boolean;
  readonly bays: readonly V1Bay[];
}

export interface V1Document {
  readonly schemaVersion: 1;
  readonly id: EntityId;
  readonly name: string;
  readonly client: string;
  readonly revision: string;
  readonly packs: Readonly<Record<string, string>>;
  readonly building: {
    readonly clearHeight: Mil;
    readonly clearHeightVerified: boolean;
    readonly deflectorElev: Mil;
    readonly deflectorVerified: boolean;
    readonly sprinklered: boolean;
    readonly insurer: string;
    readonly commodityClass: string;
    readonly sdc: string;
  };
  readonly equipment: {
    readonly truckType: string;
    readonly truckRAS: Mil;
    readonly rasVerified: boolean;
  };
  readonly unitLoad: {
    readonly palletW: Mil;
    readonly palletD: Mil;
    readonly height: Mil;
    readonly weight: number;
  };
  readonly loadDistributionFactor: number;
  readonly bayTypes: readonly V1BayType[];
  readonly runs: readonly V1Run[];
}

/* ── v2 — the studio's document, in micrometres ────────────────────────── */

export const SCHEMA_VERSION = 2;

/**
 * Whether a value was established, and how.
 *
 * v1 carried this as loose `xVerified` booleans beside each field. v2 makes it
 * one shape so the display layer has a single rule — an unestablished value
 * renders as VERIFY, never as a numeral (ADR-003's amendment) — instead of
 * remembering which boolean guards which number.
 *
 * `UNKNOWN` is a real state and not an absence: it means the value has not been
 * established, and the document is required to say so rather than omit it.
 */
export type Established = 'INPUT' | 'CATALOG' | 'RULE' | 'UNKNOWN';

export interface Witnessed<T> {
  readonly value: T;
  readonly established: Established;
  /** Where it came from, in words. Free text, shown in the provenance popover. */
  readonly source?: string;
}

/** Pinned release identifiers. Every derived number traces to one of these. */
export interface PackPins {
  readonly rack: string;
  readonly forklift: string;
  readonly accessory: string;
  readonly fire: string;
  readonly structural: string;
}

export interface BayType {
  readonly id: EntityId;
  readonly name: string;
  readonly uprightPart: string;
  readonly uprightWidth: Micrometres;
  readonly frameDepth: Micrometres;
  readonly frameHeight: Witnessed<Micrometres>;
  readonly beamPart: string;
  readonly beamLength: Micrometres;
  /** Top of beam, ascending. Order is an invariant, not a convention. */
  readonly beamLevels: readonly Micrometres[];
  readonly palletsPerBay: number;
  readonly beamPairCapacity: Witnessed<number>;
}

/** ADR-008: a bay is a thing in a building. It has an id and a lock, and that is all. */
export interface Bay {
  readonly id: EntityId;
  readonly locked: boolean;
}

export interface Run {
  readonly id: EntityId;
  readonly name: string;
  readonly bayTypeId: EntityId;
  readonly x: Micrometres;
  readonly y: Micrometres;
  readonly backToBack: boolean;
  readonly rowSpacer: Micrometres;
  readonly floorStorage: boolean;
  readonly bays: readonly Bay[];
}

export interface StudioDocument {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: EntityId;
  readonly name: string;
  readonly client: string;
  readonly revision: string;
  readonly packs: PackPins;
  readonly building: {
    readonly clearHeight: Witnessed<Micrometres>;
    readonly deflectorElev: Witnessed<Micrometres>;
    readonly sprinklered: boolean;
    readonly insurer: string;
    /** Empty string is NOT a class. It is the absence of one, and it produces a finding. */
    readonly commodityClass: Witnessed<string>;
    readonly sdc: Witnessed<string>;
  };
  readonly equipment: {
    readonly truckType: string;
    readonly truckRAS: Witnessed<Micrometres>;
  };
  readonly unitLoad: {
    readonly palletW: Micrometres;
    readonly palletD: Micrometres;
    readonly height: Micrometres;
    readonly weight: number;
  };
  readonly loadDistributionFactor: number;
  readonly bayTypes: readonly BayType[];
  readonly runs: readonly Run[];
}

/* ── lookups ───────────────────────────────────────────────────────────── */

export function runOf(doc: StudioDocument, runId: EntityId): Run | undefined {
  return doc.runs.find((r) => r.id === runId);
}

export function bayTypeOf(doc: StudioDocument, bayTypeId: EntityId): BayType | undefined {
  return doc.bayTypes.find((t) => t.id === bayTypeId);
}

/** The run holding a bay, and the bay's index in it. */
export function locateBay(
  doc: StudioDocument,
  bayId: EntityId,
): { readonly run: Run; readonly index: number } | undefined {
  for (const run of doc.runs) {
    const index = run.bays.findIndex((b) => b.id === bayId);
    if (index >= 0) return { run, index };
  }
  return undefined;
}

/**
 * The bay type a run uses.
 *
 * Returns `undefined` when the reference is dangling rather than silently
 * falling back to `bayTypes[0]`, which is what the prototype does
 * (`... || doc.bayTypes[0]`). That fallback turns a broken reference into a
 * plausible wrong answer — every dimension derived from it would be real,
 * traceable, and about a different bay type.
 */
export function bayTypeForRun(doc: StudioDocument, run: Run): BayType | undefined {
  return bayTypeOf(doc, run.bayTypeId);
}
