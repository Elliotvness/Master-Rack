import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW, HEADER_CONTROL_ORDER, TAB_ORDER, VIEWS, viewByPath } from './nav.js';

describe('the six views blueprint §5.4 and the build plan name', () => {
  it('are exactly these, in this order', () => {
    expect(TAB_ORDER).toEqual(['plan', 'elevation', 'sheets', 'screening', 'bom', 'revisions']);
  });

  it('has a unique path per view', () => {
    expect(new Set(TAB_ORDER).size).toBe(VIEWS.length);
  });

  it('gives every view a label and a description', () => {
    for (const v of VIEWS) {
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

  it('records an honest null for the three the artifact had no tab for', () => {
    for (const path of ['screening', 'bom', 'revisions']) {
      expect(viewByPath(path)?.artifactId).toBeNull();
    }
  });
});

describe('header control order', () => {
  it('reaches the tabs before undo, save and theme', () => {
    expect(HEADER_CONTROL_ORDER).toEqual([
      'jobtag',
      'tab-plan',
      'tab-elevation',
      'tab-sheets',
      'tab-screening',
      'tab-bom',
      'tab-revisions',
      'undobtn',
      'savebtn',
      'themebtn',
    ]);
  });

  it('lists every control exactly once', () => {
    expect(new Set(HEADER_CONTROL_ORDER).size).toBe(HEADER_CONTROL_ORDER.length);
  });
});

describe('viewByPath does not invent a view', () => {
  it.each(['', 'PLAN', 'canvas', '../plan'])('returns undefined for %o', (p) => {
    expect(viewByPath(p)).toBeUndefined();
  });
});
