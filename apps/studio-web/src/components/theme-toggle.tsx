import { useCallback, useEffect, useState } from 'react';

import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  themeLabel,
  writeStoredTheme,
  type Theme,
} from '../theme/theme.js';

/** The glyph for each state. Decoration — the label carries the meaning. */
/*
 * Drawn, not typed: the old glyphs (☀ ☾ ◐) are not in Barlow, and ◐ rendered
 * as a stray "‹" in the running app on 2026-11-06. An inline stroke icon has no
 * font to fall back on.
 */
const ICON: Record<Theme, React.JSX.Element> = {
  light: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  ),
  system: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </svg>
  ),
};

/**
 * The three-state theme control.
 *
 * The button's accessible name is the full label ("Theme: follow system"), not
 * the glyph. ADR-019 rule 5 is about badges, but the principle is the same
 * everywhere in this application: never state anything by appearance alone.
 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readStoredTheme(typeof localStorage === 'undefined' ? undefined : localStorage);
    return stored === 'system' ? 'dark' : stored;
  });

  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      writeStoredTheme(typeof localStorage === 'undefined' ? undefined : localStorage, next);
      return next;
    });
  }, []);

  return (
    <button
      id="themebtn"
      type="button"
      className="chrome-btn"
      onClick={cycle}
      aria-label={themeLabel(theme)}
      title={themeLabel(theme)}
    >
      <span aria-hidden="true" className="theme-icon">{ICON[theme]}</span>
    </button>
  );
}
