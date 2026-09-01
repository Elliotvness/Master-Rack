/**
 * The workload blueprint §5.4's first two budgets are measured against.
 *
 * §5.4 sets five budgets and states how each is measured. Two say "synthetic
 * benchmark in CI on a fixed fixture" and "same fixture, server path". Neither
 * the benchmark nor the fixture existed, so neither budget had ever been
 * measured — and the only figures the blueprint quotes come from rack-studio
 * spikes under software rasterization in a cloud container, which it correctly
 * calls "a floor rather than a measurement".
 *
 * Budgets 3-5 (submission, queue load at 5,000, PDF generation) need the server
 * and the job queue. They are not measured here and are not claimed.
 *
 * The workload is driven entirely by `fixtures/perf/unit-300-bay.json`, so
 * changing the shape is a data edit and shows up as one in a diff.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { deriveBom, canonicalBom, type RunTakeoff, type PartRef } from '@rms/kernel-bom';
import { aisleClearWidth, bayPitch, grossPositions, positionAccounting, runLength } from '@rms/kernel-derive';
import { buildElevation, buildPlan, type DisplayList } from '@rms/display-list';
import { each, fromUnit } from '@rms/kernel-units';

interface Fixture {
  readonly id: string;
  readonly shape: {
    readonly runs: number;
    readonly baysPerRun: number;
    readonly totalBays: number;
    readonly aisles: number;
    readonly rowsPerRun: number;
    readonly beamLevels: number;
    readonly floorStores: boolean;
    readonly positionsPerBay: number;
  };
  readonly dimensions_mm: Readonly<Record<string, number>>;
  readonly budgets_ms_p95: Readonly<Record<string, number>>;
  readonly ratchet_ms_p50: Readonly<Record<string, number>>;
}

export const FIXTURE: Fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/perf/unit-300-bay.json', import.meta.url)),
    'utf8',
  ),
) as Fixture;

const S = FIXTURE.shape;
const D = FIXTURE.dimensions_mm;
/**
 * Millimetres in, micrometres stored — `fromUnit` is the only exact door.
 * `quantity(n, 'mm', …)` is refused outright: lengths are held in um, and the
 * fixture's dimensions are whole millimetres precisely so this conversion is
 * exact and the benchmark cannot fail for a rounding reason unrelated to speed.
 */
const mm = (n: number): ReturnType<typeof fromUnit> => fromUnit(n, 'mm', 'INPUT');
const part = (id: string): PartRef => ({ kind: 'catalog', partRevisionId: id });

export interface PreviewResult {
  readonly plan: DisplayList;
  readonly elevations: readonly DisplayList[];
}

/**
 * The interactive path: everything recomputed when a parameter changes, up to
 * the display lists a renderer consumes. This is the one a person waits on,
 * which is why its budget (120 ms p95) is the tightest of the five.
 */
export function preview(): PreviewResult {
  const pitch = bayPitch(mm(D['clearSpan'] ?? 0), mm(D['uprightFace'] ?? 0));
  const length = runLength(pitch.quantity, S.baysPerRun, mm(D['uprightFace'] ?? 0));

  const runs = Array.from({ length: S.runs }, (_, i) => ({
    runId: `run-${i}`,
    offsetX: mm(0),
    offsetY: mm(i * (D['runSpacing'] ?? 0)),
    bays: S.baysPerRun,
    bayPitch: pitch.quantity,
    runLength: length.quantity,
    frameDepth: mm(D['frameDepth'] ?? 0),
    uprightFace: mm(D['uprightFace'] ?? 0),
  }));

  const aisles = Array.from({ length: S.aisles }, (_, i) => ({
    aisleId: `aisle-${i}`,
    offsetX: mm(0),
    offsetY: mm(i * (D['runSpacing'] ?? 0) * 2 + (D['frameDepth'] ?? 0)),
    length: length.quantity,
    clearWidth: aisleClearWidth(mm(D['aisleWidth'] ?? 0), mm(D['uprightFace'] ?? 0)).quantity,
  }));

  const plan = buildPlan({
    revisionHash: 'bench',
    runs,
    aisles,
    extent: { width: length.quantity, height: mm(S.runs * (D['runSpacing'] ?? 0)) },
  });

  // One elevation per run — what a reviewer flips through, and the view §6
  // identifies as benefiting most from batching.
  const elevations = runs.map((run) =>
    buildElevation({
      revisionHash: 'bench',
      runId: run.runId,
      frameHeight: mm(D['frameHeight'] ?? 0),
      bayPitch: pitch.quantity,
      levels: Array.from({ length: S.beamLevels }, (_, l) => ({
        levelId: `${run.runId}:L${l + 1}`,
        elevation: mm((l + 1) * (D['levelPitch'] ?? 0)),
        load: null,
      })),
    }),
  );

  return { plan, elevations };
}

/** Layout + validation + BOM, in §5.4's own words. */
export function fullDerivation(): {
  readonly preview: PreviewResult;
  readonly bomLines: number;
  readonly canonicalBytes: number;
} {
  const p = preview();

  const gross = grossPositions({
    positionsPerBay: S.positionsPerBay,
    bayCount: S.totalBays,
    beamLevels: S.beamLevels,
    floorStores: S.floorStores,
  });
  positionAccounting(gross, [
    { reason: 'bench: obstruction', count: each(12, 'DERIVED') },
  ]);

  const takeoff: readonly RunTakeoff[] = Array.from({ length: S.runs }, (_, i) => ({
    runId: `run-${i}`,
    bays: S.baysPerRun,
    rows: S.rowsPerRun,
    beamLevels: S.beamLevels,
    frameRef: part('frame-rev'),
    beamRef: part('beam-rev'),
    anchorRef: part('anchor-rev'),
    deckRef: part('deck-rev'),
    spacerRef: part('spacer-rev'),
    footplateRef: part('footplate-rev'),
  }));

  const lines = deriveBom(takeoff);
  // The canonical serialisation is part of the derivation — it is what the
  // content hash is taken over — so leaving it out would measure a path
  // nothing actually uses.
  const canonical = canonicalBom(lines);

  return { preview: p, bomLines: lines.length, canonicalBytes: canonical.length };
}
