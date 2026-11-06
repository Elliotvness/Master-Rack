import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEW,
  HEADER_CONTROL_ORDER,
  STEPS,
  STEP_ORDER,
  VIEWS,
  stepForPath,
  viewByPath,
} from './nav.js';

/**
 * ADR-020 (2026-11-06): navigation follows the job. Until then this file pinned
 * the artifact's six tabs — plan, elevation, sheets, screening, bom, revisions —
 * as "the views blueprint §5.4 names". §5.4 names the eight §15.2 STEPS as the
 * route chunks; the six-tab order was the build plan's. The pin moved with the
 * decision, deliberately, and still fails on any reorder.
 */
describe('the job steps, in the order the job happens', () => {
  it('are exactly these, in this order', () => {
    expect(STEP_ORDER).toEqual(['facility', 'options', 'layout', 'takeoff', 'sheets', 'submit']);
  });

  it('give every routed view exactly one owning step', () => {
    for (const view of VIEWS) {
      const owners = STEPS.filter((s) => s.views.includes(view.path));
      expect(owners.map((s) => s.id), `${view.path} must belong to one step`).toHaveLength(1);
    }
  });

  it('name only views that are routed', () => {
    for (const step of STEPS) {
      for (const path of step.views) expect(viewByPath(path), `${step.id} → ${path}`).toBeDefined();
    }
  });

  it('put Facility and Options first — routed but unreachable from the chrome before ADR-020', () => {
    expect(STEPS[0]?.views).toEqual(['facility']);
    expect(STEPS[1]?.views).toEqual(['options']);
  });

  it('keep plan, elevation and the checks together in Layout', () => {
    expect(stepForPath('plan')?.id).toBe('layout');
    expect(stepForPath('elevation')?.id).toBe('layout');
    expect(stepForPath('screening')?.id).toBe('layout');
  });

  it('has a unique path per view and a label and description on each', () => {
    expect(new Set(VIEWS.map((v) => v.path)).size).toBe(VIEWS.length);
    for (const v of [...VIEWS, ...STEPS]) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it('defaults to a view that exists', () => {
    expect(viewByPath(DEFAULT_VIEW)).toBeDefined();
  });
});

describe('the artifact ids the 22 interaction checks address', () => {
  /**
   * S4 brings the prototype's interaction checks across by changing selectors
   * and nothing else. That only works if these ids survive the port.
   */
  it('keeps tab-plan, tab-elev and tab-sheet on the three views that had them', () => {
    expect(viewByPath('plan')?.artifactId).toBe('tab-plan');
    expect(viewByPath('elevation')?.artifactId).toBe('tab-elev');
    expect(viewByPath('sheets')?.artifactId).toBe('tab-sheet');
  });

  it('records an honest null for every view the artifact had no tab for', () => {
    for (const path of ['facility', 'options', 'screening', 'bom', 'revisions']) {
      expect(viewByPath(path)?.artifactId).toBeNull();
    }
  });
});

describe('header control order', () => {
  it('reaches job, steps and the active step\'s views before undo, save and theme', () => {
    expect(HEADER_CONTROL_ORDER).toEqual([
      'jobtag',
      'step-facility',
      'step-options',
      'step-layout',
      'step-takeoff',
      'step-sheets',
      'step-submit',
      'tab-plan',
      'tab-elevation',
      'tab-screening',
      'undobtn',
      'savebtn',
      'themebtn',
    ]);
  });

  it('lists every control exactly once', () => {
    expect(new Set(HEADER_CONTROL_ORDER).size).toBe(HEADER_CONTROL_ORDER.length);
  });
});

describe('lookups do not invent a view or a step', () => {
  it.each(['', 'PLAN', 'canvas', '../plan'])('viewByPath(%o) is undefined', (p) => {
    expect(viewByPath(p)).toBeUndefined();
  });

  it.each(['', 'login', 'invite', 'layout'])('stepForPath(%o) is undefined', (p) => {
    expect(stepForPath(p)).toBeUndefined();
  });
});
