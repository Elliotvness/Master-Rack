import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BeamCatalog, loadBeamRows } from '@rms/kernel-catalog';
import { inches } from '@rms/kernel-units';

import {
  MAX_BEAM_LEVELS,
  MIN_BEAM_LEVELS,
  OptionBuilderError,
  blockingReasons,
  emptyOption,
  offGridExplanation,
  readyToPreview,
  selectBeamLevels,
  selectSpan,
  spanChoices,
} from './index.js';

// The REAL pinned catalog. The option builder must offer exactly what the
// manufacturer published and nothing else, so it is tested against the real
// grid rather than a convenient fixture.
const beamsPath = fileURLToPath(
  new URL('../../../data/catalog/interlake-2026-08/beams.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(beamsPath, 'utf8')) as { rows: unknown[] };
const catalog = new BeamCatalog(loadBeamRows(doc.rows));
const PUBLISHED = catalog.publishedSpans('27E', 'F3M');

describe('demo beat 5 \u2014 the single most important behaviour in the engine', () => {
  // "A client tries a 110-inch beam. The tool refuses, states that the
  //  published grid brackets it at 108 and 114, and explains that it does not
  //  interpolate."

  it('refuses 110 inches and names both brackets', () => {
    const result = selectSpan(PUBLISHED, 110);

    expect(result.state).toBe('refused');
    if (result.state === 'refused') {
      expect(result.lowerIn).toBe(108);
      expect(result.upperIn).toBe(114);
    }
  });

  it('explains WHY, in words that teach the engine\u2019s rule', () => {
    const result = selectSpan(PUBLISHED, 110);
    if (result.state === 'refused') {
      // Names what was asked for, so the client can see the tool understood
      // them. A refusal that does not repeat the request reads as if the
      // input was lost rather than considered.
      expect(result.explanation).toMatch(/110"/);
      expect(result.explanation).toMatch(/108"/);
      expect(result.explanation).toMatch(/114"/);
      expect(result.explanation).toMatch(/does not interpolate/);
      // "Not available" would teach nothing and produce a support call.
      expect(result.explanation.length).toBeGreaterThan(80);
      expect(result.explanation).not.toMatch(/^Not available/);
    }
  });

  it('names the requested value in every off-grid explanation', () => {
    // Asserted across the whole space rather than for 110 alone: a generic
    // head would otherwise pass while the bracket text carried the test.
    for (const requested of [24, 55, 110, 200]) {
      const result = selectSpan(PUBLISHED, requested);
      if (result.state === 'refused') {
        expect(
          result.explanation,
          `explanation for ${requested}" must repeat the requested value`,
        ).toMatch(new RegExp(`\\b${requested}"`));
      }
    }
  });

  it('produces NO capacity and NO span, so nothing downstream can use one', () => {
    const result = selectSpan(PUBLISHED, 110);
    expect(result).not.toHaveProperty('capacity');
    expect(result).not.toHaveProperty('spanIn');
  });

  it('does not nearest-match to 108, which is the tempting wrong answer', () => {
    // 110 is closer to 108 than to 114. A nearest-match would look helpful and
    // would silently hand the client a different beam from the one they asked
    // for, with a capacity that belongs to that other beam.
    const result = selectSpan(PUBLISHED, 110);
    expect(result.state).not.toBe('selected');
  });

  it('accepts a published span', () => {
    const result = selectSpan(PUBLISHED, 108);
    expect(result.state).toBe('selected');
    if (result.state === 'selected') expect(result.spanIn).toBe(108);
  });
});

describe('choices come ONLY from the pinned catalog', () => {
  it('offers exactly the published grid, in order', () => {
    const choices = spanChoices(PUBLISHED);
    expect(choices.map((c) => c.spanIn)).toEqual([...PUBLISHED].sort((a, b) => a - b));
    expect(choices).toHaveLength(21);
  });

  it('offers no value the catalog does not publish', () => {
    const offered = new Set(spanChoices(PUBLISHED).map((c) => c.spanIn));
    // 110 is the obvious near-miss; 100 and 116 are others a range control
    // would happily produce.
    for (const notPublished of [100, 110, 116, 121]) {
      expect(offered.has(notPublished)).toBe(false);
    }
  });

  it('exposes no min/max/step that would imply a continuous range', () => {
    // A stepped control implies every value in the range is orderable, and
    // most of them are not. Asserted as an absence on the choice objects.
    for (const choice of spanChoices(PUBLISHED)) {
      expect(Object.keys(choice).sort()).toEqual(['label', 'spanIn']);
    }
  });

  it('refuses to render an empty picker rather than implying free text', () => {
    // An empty dropdown invites someone to add a text box "temporarily".
    expect(() => spanChoices([])).toThrow(OptionBuilderError);
    expect(() => spanChoices([])).toThrow(/publishes no spans/);
  });

  it('labels every choice for a human, in inches', () => {
    for (const choice of spanChoices(PUBLISHED)) {
      expect(choice.label).toBe(`${choice.spanIn}"`);
    }
  });
});

describe('off-grid requests outside the published range', () => {
  it('names only the upper bracket below the shortest published span', () => {
    const result = selectSpan(PUBLISHED, 24);
    if (result.state === 'refused') {
      expect(result.lowerIn).toBeNull();
      expect(result.upperIn).toBe(48);
      expect(result.explanation).toMatch(/shortest published span is 48"/);
    }
  });

  it('names only the lower bracket above the longest published span', () => {
    const result = selectSpan(PUBLISHED, 200);
    if (result.state === 'refused') {
      expect(result.lowerIn).toBe(168);
      expect(result.upperIn).toBeNull();
      expect(result.explanation).toMatch(/longest published span is 168"/);
    }
  });

  it('still explains itself when there is no bracket at all', () => {
    // A single-span catalog: no brackets exist, but the rule still applies.
    const result = selectSpan([96], 110);
    if (result.state === 'refused') {
      expect(result.lowerIn).toBe(96);
      expect(result.upperIn).toBeNull();
    }
    expect(offGridExplanation(110, null, null)).toMatch(/does not interpolate/);
  });

  it('refuses a non-finite request as a programming error, not a client one', () => {
    expect(() => selectSpan(PUBLISHED, Number.NaN)).toThrow(OptionBuilderError);
  });
});

describe('level configuration is scoped, and says so', () => {
  it('accepts 2 through 6 beam levels', () => {
    for (let n = MIN_BEAM_LEVELS; n <= MAX_BEAM_LEVELS; n += 1) {
      const result = selectBeamLevels(n, true);
      expect(result.state).toBe('selected');
      if (result.state === 'selected') expect(result.beamLevels).toBe(n);
    }
  });

  it('REFUSES an out-of-scope count rather than clamping it', () => {
    // A clamp would accept "12" and quietly configure 6 — a different rack
    // from the one the client asked for, with no indication anything changed.
    const twelve = selectBeamLevels(12, true);
    expect(twelve.state).toBe('refused');
    if (twelve.state === 'refused') {
      expect(twelve.requested).toBe(12);
      expect(twelve.explanation).toMatch(/2 to 6 beam levels/);
      expect(twelve.explanation).toMatch(/needs a person to look at it/);
    }
    expect(selectBeamLevels(1, true).state).toBe('refused');
    expect(selectBeamLevels(0, true).state).toBe('refused');
  });

  it('refuses a fractional level count', () => {
    const result = selectBeamLevels(3.5, true);
    expect(result.state).toBe('refused');
    if (result.state === 'refused') expect(result.explanation).toMatch(/whole number/);
  });

  it('carries whether the floor stores, because it changes the position count', () => {
    const stores = selectBeamLevels(3, true);
    const walkway = selectBeamLevels(3, false);
    if (stores.state === 'selected' && walkway.state === 'selected') {
      expect(stores.floorStores).toBe(true);
      expect(walkway.floorStores).toBe(false);
    }
  });
});

describe('readiness to preview', () => {
  it('blocks a preview until a published span and a level count are chosen', () => {
    const draft = emptyOption();
    expect(readyToPreview(draft)).toBe(false);
    expect(blockingReasons(draft)).toHaveLength(2);
  });

  it('BLOCKS on a refused span, because there is no capacity to derive from', () => {
    // The one place the product refuses to proceed rather than proceeding with
    // a finding: the alternative is a drawing with no number behind it.
    const draft = {
      span: selectSpan(PUBLISHED, 110),
      levels: selectBeamLevels(3, true),
    };
    expect(readyToPreview(draft)).toBe(false);
    expect(blockingReasons(draft)[0]).toMatch(/does not interpolate/);
  });

  it('allows a preview once both are established', () => {
    const draft = {
      span: selectSpan(PUBLISHED, 96),
      levels: selectBeamLevels(3, true),
    };
    expect(readyToPreview(draft)).toBe(true);
    expect(blockingReasons(draft)).toEqual([]);
  });

  it('surfaces the refusal text itself, not a generic "invalid"', () => {
    const draft = {
      span: selectSpan(PUBLISHED, 110),
      levels: selectBeamLevels(99, true),
    };
    const reasons = blockingReasons(draft);
    expect(reasons).toHaveLength(2);
    expect(reasons.every((r) => r.length > 40)).toBe(true);
  });
});

describe('the published grid is the real one', () => {
  it('matches the catalog\u2019s own 21-span grid', () => {
    // Guards against the option builder being tested against a convenient
    // list that has drifted from the pinned data.
    expect(PUBLISHED).toEqual([
      48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156, 162, 168,
    ]);
  });

  it('agrees with the kernel lookup about what is off-grid', () => {
    // The screen and the engine must not disagree about which spans exist.
    const uiRefused = selectSpan(PUBLISHED, 110).state === 'refused';
    const engineResult = catalog.lookup({ family: '27E', series: 'F3M', span: inches(110) });
    expect(uiRefused).toBe(true);
    expect(engineResult.status).toBe('OFF_GRID');
  });
});
