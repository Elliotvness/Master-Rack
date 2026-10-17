import { migrate, planGeometry } from '@rms/studio-model';
import { describe, expect, it } from 'vitest';

import fixture from '../../../../fixtures/continuity/rack-studio-v1.json';
import { hitTestPlan } from './hit-test.js';

describe('hitTestPlan (S4.1)', () => {
  const doc = migrate(fixture.document).document;
  const plan = planGeometry(doc);
  const scale = 1 / 10_000;

  it('hits a bay when the point lies inside its clear span', () => {
    const run = plan.runs[0]!;
    const bay = run.bays[1]!;
    const cx = bay.x + Math.floor(bay.width / 2);
    const cy = run.y + Math.floor(run.rowBlockFrames.value / 2);

    const hit = hitTestPlan(plan, cx, cy, scale);
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe('bay');
    if (hit?.kind === 'bay') {
      expect(hit.runId).toBe(run.runId);
      expect(hit.bayId).toBe(bay.bayId);
      expect(hit.bayIndex).toBe(1);
    }
  });

  it('hits the run when the point lies on the leftmost upright face outside a bay clear span', () => {
    const run = plan.runs[0]!;
    const ux = run.x + Math.floor(run.uprightFace / 2);
    const uy = run.y + Math.floor(run.rowBlockFrames.value / 2);

    const hit = hitTestPlan(plan, ux, uy, scale);
    expect(hit?.kind).toBe('run');
    if (hit?.kind === 'run') {
      expect(hit.runId).toBe(run.runId);
    }
  });

  it('hits an aisle when the point lies inside the gap between two runs', () => {
    const aisle = plan.aisles[0]!;
    const ax = aisle.x + Math.floor(aisle.length / 2);
    const ay = aisle.y + Math.floor(aisle.frameToFrame.value / 2);

    const hit = hitTestPlan(plan, ax, ay, scale);
    expect(hit?.kind).toBe('aisle');
    if (hit?.kind === 'aisle') {
      expect(hit.aisleId).toBe(aisle.aisleId);
    }
  });

  it('returns null when the point is on empty slab far from all entities', () => {
    expect(hitTestPlan(plan, -5_000_000, -5_000_000, scale)).toBeNull();
    expect(hitTestPlan(plan, -5_000_000, -5_000_000, 0)).toBeNull();
  });
});
