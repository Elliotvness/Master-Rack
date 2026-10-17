/**
 * Spatial hit-testing for the plan canvas — build-plan **S4.1**.
 *
 * Hit-testing runs in world micrometres with a screen-space tolerance (`5 px /
 * camera.scale`) so that bays, runs, and aisles remain clickable across the
 * zoom range without baking pixel dimensions into the model.
 *
 * Priority order from most specific to broadest:
 *   1. **Bay** — inside a bay's clear span along a run and within the run's
 *      pallet footprint in Y.
 *   2. **Run** — anywhere inside the run's overall pallet footprint.
 *   3. **Aisle** — inside an aisle's frame-to-frame gap between two runs.
 *   4. `null` — empty slab.
 */

import type { AislePlan, BayRect, PlanGeometry, RunPlan } from '@rms/studio-model';

export type PlanHit =
  | {
      readonly kind: 'bay';
      readonly runId: string;
      readonly bayId: string;
      readonly bayIndex: number;
      readonly locked: boolean;
      readonly run: RunPlan;
      readonly bay: BayRect;
    }
  | {
      readonly kind: 'run';
      readonly runId: string;
      readonly run: RunPlan;
    }
  | {
      readonly kind: 'aisle';
      readonly aisleId: string;
      readonly aisle: AislePlan;
    };

export const SCREEN_HIT_TOLERANCE_PX = 5;

function inRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  tolUm: number,
): boolean {
  return px >= x - tolUm && px <= x + w + tolUm && py >= y - tolUm && py <= y + h + tolUm;
}

/**
 * Test a world-space point `(worldX, worldY)` in micrometres against `plan`.
 *
 * `scale` is CSS pixels per micrometre (`camera.scale`), used only to translate
 * the 5 px screen tolerance into micrometres.
 */
export function hitTestPlan(
  plan: PlanGeometry,
  worldX: number,
  worldY: number,
  scale: number,
): PlanHit | null {
  const tolUm = scale > 0 ? Math.round(SCREEN_HIT_TOLERANCE_PX / scale) : 0;

  for (const run of plan.runs) {
    const overhangUm = Math.max(0, run.overhang.value);
    const runTop = run.y - overhangUm;
    const runHeight = run.rowBlockPallets.value;
    const runWidth = run.runLength.value;

    if (!inRect(worldX, worldY, run.x, runTop, runWidth, runHeight, tolUm)) {
      continue;
    }

    for (const bay of run.bays) {
      if (inRect(worldX, worldY, bay.x, runTop, bay.width, runHeight, 0)) {
        return {
          kind: 'bay',
          runId: run.runId,
          bayId: bay.bayId,
          bayIndex: bay.index,
          locked: bay.locked,
          run,
          bay,
        };
      }
    }

    return {
      kind: 'run',
      runId: run.runId,
      run,
    };
  }

  for (const aisle of plan.aisles) {
    if (
      inRect(
        worldX,
        worldY,
        aisle.x,
        aisle.y,
        aisle.length,
        aisle.frameToFrame.value,
        tolUm,
      )
    ) {
      return {
        kind: 'aisle',
        aisleId: aisle.aisleId,
        aisle,
      };
    }
  }

  return null;
}
