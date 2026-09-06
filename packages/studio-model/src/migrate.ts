/**
 * The forward-only migration chain: v0 → v1 → v2.
 *
 * Forward only, and a document from the future is **refused with its version
 * named**. A build that reads a v3 document by ignoring what it does not
 * recognise produces a layout missing whatever v3 added, and every number on it
 * is real — which is worse than an error, because nothing looks wrong.
 *
 * Published revisions are never migrated in place. A clone is migrated and the
 * original is read through a view; that rule is the prototype's and it survives
 * because ADR-014 makes an issued revision immutable.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { StudioDocument, V1Document, Witnessed } from './document.js';
import { SCHEMA_VERSION } from './document.js';
import { collectIds, resumeFrom, type IdCounter } from './ids.js';
import { milToMicrometres } from './length.js';

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/** What a migration produces: the document and the id counter to continue from. */
export interface Migrated {
  readonly document: StudioDocument;
  readonly counter: IdCounter;
}

/**
 * A v1 boolean pair becomes a witnessed value.
 *
 * `verified === false` becomes `UNKNOWN`, not `INPUT`. The prototype's default
 * document ships `clearHeightVerified: false` beside a real-looking 336,000 mil,
 * and carrying that across as an established input would launder an unverified
 * number into a trusted one at the exact moment it crossed a schema boundary.
 */
function witnessed<T>(value: T, verified: boolean, source: string): Witnessed<T> {
  return verified
    ? { value, established: 'INPUT', source }
    : { value, established: 'UNKNOWN', source: `${source} — not verified in v1` };
}

/**
 * A v1 string field that uses `''` to mean "not established".
 *
 * v1 encodes an unknown commodity class and an unknown SDC as empty strings.
 * v2 says so explicitly, because `''` sorts, compares and renders like a value.
 */
function witnessedString(value: string, source: string): Witnessed<string> {
  return value === ''
    ? { value: '', established: 'UNKNOWN', source: `${source} — v1 carried no value` }
    : { value, established: 'INPUT', source };
}

/** Every length in a v1 document, converted or refused. Never rounded. */
function um(mil: number, what: string): number {
  try {
    return milToMicrometres(mil);
  } catch (error) {
    throw new MigrationError(`${what}: ${(error as Error).message}`);
  }
}

export function migrateV1ToV2(v1: V1Document): Migrated {
  if (v1.schemaVersion !== 1) {
    throw new MigrationError(`expected a v1 document, got schemaVersion ${String(v1.schemaVersion)}`);
  }

  const document: StudioDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: v1.id,
    name: v1.name,
    client: v1.client,
    revision: v1.revision,
    packs: {
      rack: v1.packs['rack'] ?? '',
      forklift: v1.packs['forklift'] ?? '',
      accessory: v1.packs['accessory'] ?? '',
      fire: v1.packs['fire'] ?? '',
      structural: v1.packs['structural'] ?? '',
    },
    building: {
      clearHeight: witnessed(
        um(v1.building.clearHeight, 'building.clearHeight'),
        v1.building.clearHeightVerified,
        'v1 building.clearHeight',
      ),
      deflectorElev: witnessed(
        um(v1.building.deflectorElev, 'building.deflectorElev'),
        v1.building.deflectorVerified,
        'v1 building.deflectorElev',
      ),
      sprinklered: v1.building.sprinklered,
      insurer: v1.building.insurer,
      commodityClass: witnessedString(v1.building.commodityClass, 'v1 building.commodityClass'),
      sdc: witnessedString(v1.building.sdc, 'v1 building.sdc'),
    },
    equipment: {
      truckType: v1.equipment.truckType,
      truckRAS: witnessed(
        um(v1.equipment.truckRAS, 'equipment.truckRAS'),
        v1.equipment.rasVerified,
        'v1 equipment.truckRAS',
      ),
    },
    unitLoad: {
      palletW: um(v1.unitLoad.palletW, 'unitLoad.palletW'),
      palletD: um(v1.unitLoad.palletD, 'unitLoad.palletD'),
      height: um(v1.unitLoad.height, 'unitLoad.height'),
      weight: v1.unitLoad.weight,
    },
    loadDistributionFactor: v1.loadDistributionFactor,
    bayTypes: v1.bayTypes.map((t) => ({
      id: t.id,
      name: t.name,
      uprightPart: t.uprightPart,
      uprightWidth: um(t.uprightWidth, `bayType ${t.id} uprightWidth`),
      frameDepth: um(t.frameDepth, `bayType ${t.id} frameDepth`),
      /**
       * v0 had no frame height and the v0→v1 migration approximated it from the
       * top beam, flagging it. That flag becomes an origin here: an approximated
       * height is not an input, it is a derivation nobody has confirmed.
       */
      frameHeight: t.frameHeightApproximated === true
        ? {
            value: um(t.frameHeight, `bayType ${t.id} frameHeight`),
            established: 'UNKNOWN' as const,
            source: 'approximated from the top beam level by the v0 to v1 migration',
          }
        : {
            value: um(t.frameHeight, `bayType ${t.id} frameHeight`),
            established: 'INPUT' as const,
            source: 'v1 bayType.frameHeight',
          },
      beamPart: t.beamPart,
      beamLength: um(t.beamLength, `bayType ${t.id} beamLength`),
      beamLevels: t.beamLevels.map((l, i) => um(l, `bayType ${t.id} beamLevels[${i}]`)),
      palletsPerBay: t.palletsPerBay,
      beamPairCapacity: witnessed(
        t.beamPairCapacity,
        t.capacityVerified,
        `v1 bayType ${t.id} beamPairCapacity`,
      ),
    })),
    runs: v1.runs.map((r) => ({
      id: r.id,
      name: r.name,
      bayTypeId: r.bayTypeId,
      x: um(r.x, `run ${r.id} x`),
      y: um(r.y, `run ${r.id} y`),
      backToBack: r.backToBack,
      rowSpacer: um(r.rowSpacer, `run ${r.id} rowSpacer`),
      floorStorage: r.floorStorage,
      bays: r.bays.map((b) => ({ id: b.id, locked: b.locked })),
    })),
  };

  return { document, counter: resumeFrom(collectIds(document)) };
}

/**
 * Read anything and produce a v2 document, or refuse and say why.
 *
 * A v0 document is the archived foundation prototype's flat parameter object
 * and carries no `schemaVersion` at all. **This build does not migrate v0.**
 * The v0→v1 step lives in the prototype's own kernel, was written when v0
 * documents existed to migrate, and porting it would mean re-deriving an
 * approximation from a shape nothing in this repository can produce or test
 * against. If a v0 document is ever presented, the honest move is to run it
 * through the prototype first — which is what the refusal below says.
 */
export function migrate(input: unknown): Migrated {
  if (input === null || typeof input !== 'object') {
    throw new MigrationError('not a document: expected an object');
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;

  if (version === undefined) {
    throw new MigrationError(
      'this looks like a v0 document (no schemaVersion). This build reads v1 and v2. ' +
        'Migrate it to v1 with the rack-studio-v1 prototype kernel first — its v0 rules ' +
        'approximate a frame height that is not reconstructible here, and guessing it would ' +
        'put an invented dimension into the model.',
    );
  }

  if (version === 1) return migrateV1ToV2(input as V1Document);

  if (version === SCHEMA_VERSION) {
    const document = input as StudioDocument;
    return { document, counter: resumeFrom(collectIds(document)) };
  }

  throw new MigrationError(
    `Unsupported schemaVersion ${String(version)}; this build reads 1 and ${SCHEMA_VERSION}. ` +
      'A newer document is refused rather than read partially: ignoring fields this build does ' +
      'not recognise produces a layout missing whatever they described, and every number on it ' +
      'would still look right.',
  );
}
