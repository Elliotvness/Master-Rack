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
    // Fallbacks are the artifact's light-theme values. They matter in exactly
    // one case — a canvas drawn before the stylesheet applies — and a black
    // rectangle would read as a broken viewport rather than an unstyled one.
    background: v('--sunk', '#f2f1ee'),
    ink: v('--ink', '#14181f'),
    inkMuted: v('--ink-2', '#4a5261'),
    upright: v('--pen-upright', '#1f3864'),
    beam: v('--pen-beam', '#2f6b4f'),
    unitLoad: v('--pen-pallet', '#9aa3b2'),
    flue: v('--pen-flue', '#a9670a'),
    aisle: v('--pen-dim', '#7c8494'),
    reference: v('--pen-ref', '#7a5ea8'),
    obstruction: v('--pen-anno', '#a93226'),
    noRackZone: v('--pen-bldg', '#4a5261'),
    selection: v('--sel', '#1f3864'),
    unestablished: v('--warn', '#a9670a'),
  };
}
