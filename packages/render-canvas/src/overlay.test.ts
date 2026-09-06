import { describe, expect, it } from 'vitest';

import type { Camera, Viewport } from './camera.js';
import type { Pens } from './draw.js';
import { chooseScale, drawOverlays } from './overlay.js';

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

/** The same recording context `draw.test.ts` uses — a recorder, not a mock. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };
  const setter = (op: string) => (v: unknown) => calls.push({ op, args: [v] });

  const ctx = {
    setTransform: record('setTransform'),
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    stroke: record('stroke'),
    fill: record('fill'),
    measureText: (t: string) => ({ width: t.length * 6 }),
    set fillStyle(v: unknown) {
      setter('set fillStyle')(v);
    },
    set strokeStyle(v: unknown) {
      setter('set strokeStyle')(v);
    },
    set lineWidth(v: unknown) {
      setter('set lineWidth')(v);
    },
    set font(v: unknown) {
      setter('set font')(v);
    },
    set textBaseline(v: unknown) {
      setter('set textBaseline')(v);
    },
    set textAlign(v: unknown) {
      setter('set textAlign')(v);
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

const PENS: Pens = {
  background: '#bg',
  ink: '#ink',
  inkMuted: '#muted',
  upright: '#upright',
  beam: '#beam',
  unitLoad: '#unitload',
  flue: '#flue',
  aisle: '#aisle',
  reference: 'reference',
  obstruction: '#obstruction',
  noRackZone: '#norack',
  selection: '#selection',
  unestablished: '#unestablished',
};

const VIEWPORT: Viewport = { width: 900, height: 600 };
const CAMERA: Camera = { centreX: 0, centreY: 0, scale: 1 / 10_000 };
const MICROMETRES_PER_FOOT = 304_800;

const printed = (calls: Call[]): unknown[] =>
  calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);

describe('chooseScale picks a round number of feet', () => {
  /**
   * The caption must be a number a person reads off a drawing. A fixed-width
   * bar labelled with whatever it happens to span produces "0.37 ft" and a
   * ruler nobody can use.
   */
  it.each([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000])('only ever chooses %i ft', (feet) => {
    const scale = 200 / (feet * MICROMETRES_PER_FOOT);
    const chosen = chooseScale(scale, 200);
    expect([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]).toContain(chosen?.feet);
  });

  it('stays between the minimum and the budget whenever it returns a bar', () => {
    for (const scale of [1 / 1000, 1 / 10_000, 1 / 100_000, 1 / 500_000]) {
      const chosen = chooseScale(scale, 180);
      if (chosen === null) continue;
      expect(chosen.pixels).toBeLessThanOrEqual(180);
      expect(chosen.pixels).toBeGreaterThanOrEqual(40);
    }
  });

  /**
   * The bug the first draft had: with only an upper bound, every step "fits" at
   * a tiny scale, so it chose 1000 ft and returned a bar 0.3 PIXELS long — a
   * ruler nobody can see, captioned with a distance it does not span.
   */
  it('refuses a bar too short to see rather than captioning 0.3 pixels', () => {
    const chosen = chooseScale(1 / 1_000_000_000, 180);
    expect(chosen).toBeNull();
  });

  it('takes the largest step that fits, not the smallest', () => {
    // At this scale 20 ft is 203 px and 10 ft is 101 px, so 10 must win.
    const scale = 10 / MICROMETRES_PER_FOOT;
    expect(chooseScale(scale, 180)?.feet).toBe(10);
  });

  it('the bar length matches the feet it claims', () => {
    const scale = 1 / 10_000;
    const chosen = chooseScale(scale, 180);
    expect(chosen?.pixels).toBeCloseTo((chosen?.feet ?? 0) * MICROMETRES_PER_FOOT * scale, 6);
  });

  /** Zoomed far in, even 1 ft overflows the budget, and nothing is drawn. */
  it('returns null when the smallest step overflows the budget', () => {
    expect(chooseScale(1 / 100, 180)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses the scale %o', (bad) => {
    expect(chooseScale(bad, 180)).toBeNull();
  });

  it('refuses a budget smaller than the minimum bar', () => {
    expect(chooseScale(1 / 10_000, 0)).toBeNull();
    expect(chooseScale(1 / 10_000, 39)).toBeNull();
  });
});

describe('drawOverlays', () => {
  it('resets to the device transform so it is not affected by the world draw', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 2 });
    expect(calls[0]).toEqual({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
  });

  it('prints every legend entry', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    const text = printed(calls);
    for (const label of [
      'Upright',
      'Beam',
      'Unit load',
      'Flue',
      'Clear between loads',
      'Dimension',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('draws each legend swatch in its own pen', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    const strokes = calls.filter((c) => c.op === 'set strokeStyle').map((c) => c.args[0]);
    for (const pen of ['#upright', '#beam', '#unitload', '#flue', '#aisle', '#muted']) {
      expect(strokes).toContain(pen);
    }
  });

  it('labels the scale bar with the feet it spans', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    expect(printed(calls).some((t) => typeof t === 'string' && / ft$/.test(t))).toBe(true);
    expect(printed(calls)).toContain('0');
  });

  it('omits the scale bar entirely when no round step fits', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, {
      camera: { ...CAMERA, scale: 1 / 100 },
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
    });
    expect(printed(calls).some((t) => typeof t === 'string' && / ft$/.test(t))).toBe(false);
  });

  it('draws a north arrow labelled N', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    expect(printed(calls)).toContain('N');
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
    expect(calls.some((c) => c.op === 'closePath')).toBe(true);
  });

  /**
   * "Click a bay or aisle to select" is deliberately absent: selection is S4 and
   * does not exist. A hint naming an interaction the build does not have is a
   * small false claim, and it is the kind that erodes trust in the rest.
   */
  it('names only the interactions that exist', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    const text = printed(calls);
    expect(text).toContain('DRAG TO PAN · SCROLL TO ZOOM');
    expect(text.some((t) => typeof t === 'string' && /SELECT/i.test(t))).toBe(false);
  });

  it('leaves the text alignment as it found it', () => {
    const { ctx, calls } = recorder();
    drawOverlays(ctx, { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    const aligns = calls.filter((c) => c.op === 'set textAlign').map((c) => c.args[0]);
    expect(aligns.at(-1)).toBe('left');
  });
});
