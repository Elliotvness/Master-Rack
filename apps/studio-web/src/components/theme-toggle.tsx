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
const GLYPH: Record<Theme, string> = { light: '☀', dark: '☾', system: '◐' };

/**
 * The three-state theme control.
 *
 * The button's accessible name is the full label ("Theme: follow system"), not
 * the glyph. ADR-019 rule 5 is about badges, but the principle is the same
 * everywhere in this application: never state anything by appearance alone.
 */
export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() =>
    readStoredTheme(typeof localStorage === 'undefined' ? undefined : localStorage),
  );

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
      <span aria-hidden="true">{GLYPH[theme]}</span>
    </button>
  );
}
