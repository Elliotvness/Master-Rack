/**
 * The plan camera: model micrometres to CSS pixels and back.
 *
 * Pure arithmetic, no canvas, no DOM — so pan, zoom and pointer-to-world can be
 * tested without a browser, which is most of what goes wrong in a viewport.
 *
 * **World coordinates stay in integer micrometres.** The camera converts at the
 * boundary and nowhere else; `display-list` refuses a fractional model
 * coordinate outright, with the comment that one "means someone converted to
 * pixels early". This module is the only place the conversion happens.
 *
 * Y is **down** in both spaces. A plan drawn with y-up would disagree with every
 * pointer event the browser reports, and flipping in the renderer instead of
 * here would put the flip somewhere a hit test could forget it.
 */

export interface Camera {
  /** World point at the centre of the viewport, in micrometres. */
  readonly centreX: number;
  readonly centreY: number;
  /** CSS pixels per micrometre. Small: 1 in = 25,400 µm. */
  readonly scale: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Zoom bounds, in CSS pixels per micrometre.
 *
 * The lower bound is not decoration: at very small scales a 300-bay layout
 * collapses into a line and every hit test answers with whatever is topmost.
 * The upper bound stops a scroll gesture leaving the model behind entirely.
 */
export const MIN_SCALE = 1 / 200_000;
export const MAX_SCALE = 1 / 200;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function worldToScreen(camera: Camera, view: Viewport, p: WorldPoint): ScreenPoint {
  return {
    x: (p.x - camera.centreX) * camera.scale + view.width / 2,
    y: (p.y - camera.centreY) * camera.scale + view.height / 2,
  };
}

export function screenToWorld(camera: Camera, view: Viewport, p: ScreenPoint): WorldPoint {
  return {
    x: (p.x - view.width / 2) / camera.scale + camera.centreX,
    y: (p.y - view.height / 2) / camera.scale + camera.centreY,
  };
}

/** Pan by a screen-space delta — the drag case, where the pointer moves in pixels. */
export function panByScreen(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, centreX: camera.centreX - dx / camera.scale, centreY: camera.centreY - dy / camera.scale };
}

/**
 * Zoom about a screen point, so the world point under the cursor stays under it.
 *
 * This is the property that makes a viewport feel right, and the one that is
 * wrong in most first drafts: zooming about the viewport centre instead makes
 * the thing being examined slide away exactly when the user leans in.
 */
export function zoomAbout(
  camera: Camera,
  view: Viewport,
  anchor: ScreenPoint,
  factor: number,
): Camera {
  const before = screenToWorld(camera, view, anchor);
  const scale = clampScale(camera.scale * factor);
  const after = screenToWorld({ ...camera, scale }, view, anchor);
  return { centreX: camera.centreX + (before.x - after.x), centreY: camera.centreY + (before.y - after.y), scale };
}

/** A camera showing the whole extent with a margin. `F` in the keymap. */
export function fitExtent(
  view: Viewport,
  extent: { readonly width: number; readonly height: number },
  marginFraction = 0.08,
): Camera {
  const usableW = view.width * (1 - marginFraction * 2);
  const usableH = view.height * (1 - marginFraction * 2);
  // An empty or degenerate extent must not produce Infinity or NaN. A camera
  // that cannot be described is worse than one showing nothing useful.
  const w = extent.width > 0 ? usableW / extent.width : MAX_SCALE;
  const h = extent.height > 0 ? usableH / extent.height : MAX_SCALE;
  return {
    centreX: extent.width / 2,
    centreY: extent.height / 2,
    scale: clampScale(Math.min(w, h)),
  };
}

/** The world rectangle currently visible. Used for culling. */
export function visibleWorldBounds(
  camera: Camera,
  view: Viewport,
): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const tl = screenToWorld(camera, view, { x: 0, y: 0 });
  const br = screenToWorld(camera, view, { x: view.width, y: view.height });
  return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
}
