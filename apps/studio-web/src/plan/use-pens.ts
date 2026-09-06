import type { Pens } from '@rms/render-canvas';

/**
 * Resolve the drawing pens from the theme's CSS custom properties.
 *
 * The renderer takes colours as arguments rather than reading the DOM, so this
 * is the one place the two meet. Reading the computed value means the canvas
 * follows the theme toggle and `prefers-color-scheme` for free, instead of
 * carrying a second palette that has to be kept in step with `tokens.css` — the
 * duplication the contrast gate exists to make impossible.
 */
export function readPens(root: Element): Pens {
  const style = getComputedStyle(root);
  const v = (name: string, fallback: string): string => {
    const raw = style.getPropertyValue(name).trim();
    return raw === '' ? fallback : raw;
  };

  return {
    // Fallbacks are the light-theme token values. They matter in exactly one
    // case — a canvas drawn before the stylesheet has applied — and a black
    // rectangle would read as a broken viewport rather than an unstyled one.
    background: v('--bg', '#f7f8fa'),
    ink: v('--ink', '#16202e'),
    inkMuted: v('--ink-muted', '#4a5568'),
    upright: v('--chrome', '#1f3864'),
    beam: v('--accent', '#1f3864'),
    aisle: v('--ink-muted', '#4a5568'),
    obstruction: v('--status-danger', '#b3261e'),
    noRackZone: v('--status-warning', '#8a5a00'),
    selection: v('--focus', '#0b57d0'),
    unestablished: v('--status-warning', '#8a5a00'),
  };
}
