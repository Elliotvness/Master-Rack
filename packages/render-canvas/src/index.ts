/**
 * @rms/render-canvas
 *
 * Display list to Canvas 2D (ADR-003, T-17). Draws what it is given and derives
 * nothing; never formats a number, so an unestablished value renders VERIFY.
 *
 * The camera is pure arithmetic and testable with no browser. `draw` needs a
 * CanvasRenderingContext2D and is exercised through the studio's own tests.
 */

export {
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
  type ScreenPoint,
  type Viewport,
  type WorldPoint,
} from './camera.js';

export { draw, label, type DrawOptions, type DrawResult, type Pens } from './draw.js';
