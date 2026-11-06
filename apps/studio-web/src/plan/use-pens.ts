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
    // Fallbacks are tokens.css's light-theme values (pinned by use-pens.test.ts). They matter in exactly
    // one case — a canvas drawn before the stylesheet applies — and a black
    // rectangle would read as a broken viewport rather than an unstyled one.
    background: v('--sunk', '#e9e9ea'),
    ink: v('--ink', '#1d1f20'),
    inkMuted: v('--ink-2', '#5d5d60'),
    upright: v('--pen-upright', '#2c455d'),
    beam: v('--pen-beam', '#416180'),
    unitLoad: v('--pen-pallet', '#9aa9bb'),
    flue: v('--pen-flue', '#a9670a'),
    aisle: v('--pen-dim', '#5d5d60'),
    reference: v('--pen-ref', '#7a5ea8'),
    obstruction: v('--pen-anno', '#a93226'),
    noRackZone: v('--pen-bldg', '#424244'),
    selection: v('--sel', '#416180'),
    unestablished: v('--warn', '#8a5300'),
  };
}
