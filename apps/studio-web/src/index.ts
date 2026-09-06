/**
 * The package entry point.
 *
 * Deliberately narrow: the pure modules only. The React tree is reached through
 * `main.tsx`, which Vite owns, and is not re-exported — an app's barrel is what
 * `check-app-boundaries` reads, and widening it to include components would make
 * every component's symbols part of a boundary surface for no benefit.
 *
 * EVERY EXPORT IS NAMED, and `export *` is not used. The first draft of this
 * file used it and `check-app-boundaries` refused, correctly: a star re-export
 * is invisible to a symbol-level scan, so the checker cannot tell whether a
 * server authority just crossed the boundary. It is the same hole a namespace
 * import opens, which that checker's own docstring records an adversarial review
 * finding — `import * as wf` then `export const drive = wf.submit`, green in
 * both the scan and `tsc`. A barrel that hides what it exports is a barrel
 * nothing can police.
 */

export {
  DEFAULT_VIEW,
  HEADER_CONTROL_ORDER,
  TAB_ORDER,
  VIEWS,
  viewByPath,
  type StudioView,
} from './nav.js';

export {
  STORAGE_KEY,
  THEMES,
  applyTheme,
  isTheme,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  rootAttribute,
  themeLabel,
  writeStoredTheme,
  type ResolvedTheme,
  type Theme,
  type ThemeRoot,
  type ThemeStorageReader,
  type ThemeStorageWriter,
} from './theme/theme.js';

export {
  AA_NON_TEXT,
  AA_TEXT,
  ColorError,
  contrastRatio,
  parseHex,
  relativeLuminance,
} from './theme/contrast.js';

export { CONTRAST_PAIRS, type ContrastPair } from './theme/pairs.js';
