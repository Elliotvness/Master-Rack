import { describe, expect, it } from 'vitest';

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitExtent,
  panByScreen,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
  zoomAbout,
  type Camera,
} from './camera.js';

const VIEW = { width: 800, height: 600 };
const CAM: Camera = { centreX: 1_000_000, centreY: 500_000, scale: 1 / 10_000 };
const IN = (n: number): number => n * 25_400;

describe('world and screen are exact inverses', () => {
  it('a round trip returns the same world point', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 1_000_000, y: 500_000 },
      { x: -250_000, y: 3_000_000 },
    ]) {
      const back = screenToWorld(CAM, VIEW, worldToScreen(CAM, VIEW, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('the camera centre lands at the viewport centre', () => {
    const s = worldToScreen(CAM, VIEW, { x: CAM.centreX, y: CAM.centreY });
    expect(s.x).toBeCloseTo(VIEW.width / 2, 9);
    expect(s.y).toBeCloseTo(VIEW.height / 2, 9);
  });

  /**
   * Y is down in BOTH spaces. A plan drawn y-up disagrees with every pointer
   * event the browser reports, and flipping in the renderer instead would put
   * the flip somewhere a hit test can forget it.
   */
  it('y increases downward in screen space as it does in world space', () => {
    const a = worldToScreen(CAM, VIEW, { x: 0, y: 0 });
    const b = worldToScreen(CAM, VIEW, { x: 0, y: 100_000 });
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe('panByScreen moves the world under the pointer by the pointer delta', () => {
  it('dragging right moves the content right', () => {
    const moved = panByScreen(CAM, 100, 0);
    const before = worldToScreen(CAM, VIEW, { x: 0, y: 0 });
    const after = worldToScreen(moved, VIEW, { x: 0, y: 0 });
    expect(after.x - before.x).toBeCloseTo(100, 6);
  });

  it('is exactly reversible', () => {
    const there = panByScreen(CAM, 37, -19);
    const back = panByScreen(there, -37, 19);
    expect(back.centreX).toBeCloseTo(CAM.centreX, 6);
    expect(back.centreY).toBeCloseTo(CAM.centreY, 6);
  });

  it('does not change the scale', () => {
    expect(panByScreen(CAM, 50, 50).scale).toBe(CAM.scale);
  });
});

describe('zoomAbout keeps the world point under the cursor', () => {
  /**
   * The property that makes a viewport feel right, and the one most first
   * drafts get wrong: zooming about the viewport centre makes the thing being
   * examined slide away exactly when the user leans in.
   */
  it.each([
    ['top left', { x: 0, y: 0 }],
    ['off centre', { x: 137, y: 451 }],
    ['bottom right', { x: 800, y: 600 }],
  ])('%s stays put', (_name, anchor) => {
    const before = screenToWorld(CAM, VIEW, anchor);
    const zoomed = zoomAbout(CAM, VIEW, anchor, 1.5);
    const after = screenToWorld(zoomed, VIEW, anchor);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it('zooming in then out by the reciprocal returns the camera', () => {
    const anchor = { x: 200, y: 150 };
    const round = zoomAbout(zoomAbout(CAM, VIEW, anchor, 1.25), VIEW, anchor, 1 / 1.25);
    expect(round.scale).toBeCloseTo(CAM.scale, 12);
    expect(round.centreX).toBeCloseTo(CAM.centreX, 3);
    expect(round.centreY).toBeCloseTo(CAM.centreY, 3);
  });

  it('respects the scale bounds', () => {
    const anchor = { x: 400, y: 300 };
    expect(zoomAbout(CAM, VIEW, anchor, 1e9).scale).toBe(MAX_SCALE);
    expect(zoomAbout(CAM, VIEW, anchor, 1e-9).scale).toBe(MIN_SCALE);
  });
});

describe('clampScale', () => {
  it.each([
    [1e9, MAX_SCALE],
    [1e-12, MIN_SCALE],
  ])('clamps %o', (input, expected) => {
    expect(clampScale(input)).toBe(expected);
  });

  it('leaves a scale inside the range alone', () => {
    expect(clampScale(1 / 10_000)).toBe(1 / 10_000);
  });
});

describe('fitExtent', () => {
  const extent = { width: IN(1200), height: IN(400) };

  it('centres on the extent', () => {
    const cam = fitExtent(VIEW, extent);
    expect(cam.centreX).toBe(extent.width / 2);
    expect(cam.centreY).toBe(extent.height / 2);
  });

  it('fits the whole extent inside the viewport', () => {
    const cam = fitExtent(VIEW, extent);
    const tl = worldToScreen(cam, VIEW, { x: 0, y: 0 });
    const br = worldToScreen(cam, VIEW, { x: extent.width, y: extent.height });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(VIEW.width);
    expect(br.y).toBeLessThanOrEqual(VIEW.height);
  });

  it('takes the tighter of the two axes', () => {
    // A wide, short extent is bounded by width; a tall, narrow one by height.
    const wide = fitExtent(VIEW, { width: IN(10_000), height: IN(10) });
    const tall = fitExtent(VIEW, { width: IN(10), height: IN(10_000) });
    expect(wide.scale).toBeLessThan(fitExtent(VIEW, { width: IN(10), height: IN(10) }).scale);
    expect(tall.scale).toBeLessThan(fitExtent(VIEW, { width: IN(10), height: IN(10) }).scale);
  });

  /**
   * A camera that cannot be described is worse than one showing nothing useful.
   * An empty document must not produce Infinity or NaN.
   */
  it.each([
    ['both zero', { width: 0, height: 0 }],
    ['zero width', { width: 0, height: IN(100) }],
    ['zero height', { width: IN(100), height: 0 }],
  ])('produces a finite camera for an extent with %s', (_name, e) => {
    const cam = fitExtent(VIEW, e);
    expect(Number.isFinite(cam.scale)).toBe(true);
    expect(Number.isFinite(cam.centreX)).toBe(true);
    expect(Number.isFinite(cam.centreY)).toBe(true);
    expect(cam.scale).toBeGreaterThan(0);
  });
});

describe('visibleWorldBounds', () => {
  it('spans the viewport corners', () => {
    const b = visibleWorldBounds(CAM, VIEW);
    const tl = screenToWorld(CAM, VIEW, { x: 0, y: 0 });
    const br = screenToWorld(CAM, VIEW, { x: VIEW.width, y: VIEW.height });
    expect(b.minX).toBeCloseTo(tl.x, 6);
    expect(b.maxY).toBeCloseTo(br.y, 6);
  });

  it('contains the camera centre', () => {
    const b = visibleWorldBounds(CAM, VIEW);
    expect(CAM.centreX).toBeGreaterThan(b.minX);
    expect(CAM.centreX).toBeLessThan(b.maxX);
    expect(CAM.centreY).toBeGreaterThan(b.minY);
    expect(CAM.centreY).toBeLessThan(b.maxY);
  });

  it('widens as the camera zooms out', () => {
    const wide = visibleWorldBounds({ ...CAM, scale: CAM.scale / 2 }, VIEW);
    const near = visibleWorldBounds(CAM, VIEW);
    expect(wide.maxX - wide.minX).toBeGreaterThan(near.maxX - near.minX);
  });
});
