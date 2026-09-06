/**
 * The three-state theme, carried from the artifact.
 *
 * Three states and not two, deliberately: `system` is not "light by default",
 * it is "whatever the operating system says, and keep following it if that
 * changes". Collapsing it to a boolean is how a toggle comes to fight the OS.
 *
 * The resolution and persistence rules are pure functions so they can be tested
 * without a DOM. Only `applyTheme` touches the document.
 */

export const THEMES = Object.freeze(['light', 'dark', 'system'] as const);
export type Theme = (typeof THEMES)[number];

/** What actually gets painted once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

export const STORAGE_KEY = 'rms.studio.theme';

/**
 * The two host objects this module touches, declared structurally rather than
 * taken from the DOM lib.
 *
 * That is not incidental. This module's whole claim is that the theme rules can
 * be tested without a DOM, and a module that needs `lib.dom` to COMPILE has
 * already broken that claim — it would force the DOM globals into
 * `tsconfig.tests.json` and hand every kernel test a `document` it must be
 * trusted not to use. Structural types keep the dependency at the call site,
 * where `main.tsx` passes the real `document.documentElement`.
 */
export interface ThemeRoot {
  readonly dataset: Record<string, string | undefined>;
}

export interface ThemeStorageReader {
  getItem(key: string): string | null;
}

export interface ThemeStorageWriter {
  setItem(key: string, value: string): void;
}

/** A stored value is trusted only if it is one of the three. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/**
 * What to paint.
 *
 * `system` defers to the media query. An explicit choice ignores it — in BOTH
 * directions, which is the case a single `prefers-color-scheme` block cannot
 * express and why `tokens.css` carries a `[data-theme]` rule as well.
 */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}

/**
 * The value for the root element's `data-theme` attribute, or `null` to remove
 * it.
 *
 * `system` REMOVES the attribute rather than stamping a resolved value. If it
 * stamped `dark`, the page would stop following the OS the moment it was
 * rendered — the user would have chosen "system" and got a snapshot of it.
 */
export function rootAttribute(theme: Theme): ResolvedTheme | null {
  return theme === 'system' ? null : theme;
}

/** The next theme in the cycle. Light → dark → system → light. */
export function nextTheme(theme: Theme): Theme {
  const i = THEMES.indexOf(theme);
  return THEMES[(i + 1) % THEMES.length] as Theme;
}

/** What the toggle announces to a screen reader. Never colour or icon alone. */
export function themeLabel(theme: Theme): string {
  switch (theme) {
    case 'light':
      return 'Theme: light';
    case 'dark':
      return 'Theme: dark';
    case 'system':
      return 'Theme: follow system';
  }
}

/**
 * Read the stored preference.
 *
 * Storage can throw outright — a private window, or a browser set to block site
 * data — so this never lets a storage failure stop the app rendering. An
 * unreadable preference is `system`, which is the honest answer: we do not know
 * what they chose, so follow the OS.
 */
export function readStoredTheme(storage: ThemeStorageReader | undefined): Theme {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the preference, tolerating storage that refuses to be written. */
export function writeStoredTheme(
  storage: ThemeStorageWriter | undefined,
  theme: Theme,
): void {
  try {
    storage?.setItem(STORAGE_KEY, theme);
  } catch {
    /* a preference that cannot be saved is not a reason to fail the page */
  }
}

/** The only function here that touches the document. */
export function applyTheme(root: ThemeRoot, theme: Theme): void {
  const attr = rootAttribute(theme);
  if (attr === null) delete root.dataset['theme'];
  else root.dataset['theme'] = attr;
}
