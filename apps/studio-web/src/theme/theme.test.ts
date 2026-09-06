import { describe, expect, it, vi } from 'vitest';

import {
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
  type Theme,
  type ThemeRoot,
} from './theme.js';

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('%s with systemPrefersDark=%o resolves to %s', (theme, dark, expected) => {
    expect(resolveTheme(theme, dark)).toBe(expected);
  });

  /**
   * The case a single `prefers-color-scheme` block cannot express, and the
   * reason tokens.css carries a `[data-theme]` rule too: an explicit LIGHT
   * choice must win on a machine set to dark.
   */
  it('an explicit choice beats the system in both directions', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('rootAttribute — system removes the attribute, never stamps a snapshot', () => {
  it('returns null for system', () => {
    expect(rootAttribute('system')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('returns %s for an explicit choice', (t) => {
    expect(rootAttribute(t)).toBe(t);
  });
});

describe('applyTheme', () => {
  it('stamps the attribute for an explicit choice', () => {
    const root: ThemeRoot = { dataset: {} };
    applyTheme(root, 'dark');
    expect(root.dataset['theme']).toBe('dark');
  });

  /**
   * The bug this prevents: choosing "system" after "dark" leaving
   * data-theme="dark" behind, so the page silently stops following the OS while
   * the toggle says it is following it.
   */
  it('removes a previously stamped attribute when moving to system', () => {
    const root: ThemeRoot = { dataset: { theme: 'dark' } };
    applyTheme(root, 'system');
    expect(root.dataset['theme']).toBeUndefined();
  });
});

describe('nextTheme cycles through all three and returns', () => {
  it('light → dark → system → light', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });

  it('visits every theme in one cycle', () => {
    const seen = new Set<Theme>();
    let t: Theme = 'light';
    for (let i = 0; i < THEMES.length; i += 1) {
      seen.add(t);
      t = nextTheme(t);
    }
    expect(seen.size).toBe(THEMES.length);
    expect(t).toBe('light');
  });
});

describe('themeLabel — the state is words, never an icon alone', () => {
  it.each(THEMES)('%s has a non-empty label naming the state', (t) => {
    expect(themeLabel(t)).toMatch(/light|dark|system/);
  });

  it('gives every theme a distinct label', () => {
    expect(new Set(THEMES.map(themeLabel)).size).toBe(THEMES.length);
  });
});

describe('isTheme refuses anything else', () => {
  it.each(THEMES)('accepts %s', (t) => expect(isTheme(t)).toBe(true));
  it.each([null, undefined, 0, 'Dark', 'DARK', '', 'auto', {}])('rejects %o', (v) => {
    expect(isTheme(v)).toBe(false);
  });
});

describe('storage never stops the page rendering', () => {
  it('reads a stored theme', () => {
    const storage = { getItem: () => 'dark' };
    expect(readStoredTheme(storage)).toBe('dark');
  });

  it('falls back to system for an unrecognised value', () => {
    expect(readStoredTheme({ getItem: () => 'chartreuse' })).toBe('system');
  });

  it('falls back to system when there is no storage at all', () => {
    expect(readStoredTheme(undefined)).toBe('system');
  });

  /**
   * A private window, or a browser set to block site data, throws on ACCESS —
   * it does not return null. An unguarded read takes the whole app down before
   * the first paint.
   */
  it('falls back to system when reading throws', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(readStoredTheme(storage)).toBe('system');
  });

  it('writes under the stated key', () => {
    const setItem = vi.fn();
    writeStoredTheme({ setItem }, 'light');
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'light');
  });

  it('does not throw when writing is refused', () => {
    const storage = {
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(() => writeStoredTheme(storage, 'dark')).not.toThrow();
  });

  it('tolerates no storage when writing', () => {
    expect(() => writeStoredTheme(undefined, 'dark')).not.toThrow();
  });
});
