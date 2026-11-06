import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `readPens` falls back to literal colours when the stylesheet has not applied.
 * Those literals are a second copy of the light palette, and a second copy is
 * what drifts: when the palette changed to the blueprint system (ADR-020) the
 * first draft of the new fallbacks disagreed with `tokens.css` on three pens.
 *
 * So every `v('--token', '#hex')` call is pinned to the value `tokens.css`
 * declares for that token on bare `:root`. Read from source, not by calling the
 * function: the fallback branch only runs without a stylesheet, which is the
 * state a test environment has to fake, and faking it would test the fake.
 */
const SRC = readFileSync(fileURLToPath(new URL('./use-pens.ts', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('../theme/tokens.css', import.meta.url)), 'utf8');

function lightTokens(): Record<string, string> {
  const open = CSS.indexOf('{', CSS.indexOf(':root {'));
  const body = CSS.slice(open + 1, CSS.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

const FALLBACKS = [...SRC.matchAll(/v\('(--[a-z0-9-]+)',\s*'(#[0-9a-fA-F]{6})'\)/g)].map((m) => ({
  token: m[1] as string,
  fallback: (m[2] as string).toLowerCase(),
}));

describe('readPens fallbacks are the light palette, not a second copy of it', () => {
  it('found the fallbacks, so a pass is not vacuous', () => {
    expect(FALLBACKS.length).toBeGreaterThanOrEqual(10);
  });

  const tokens = lightTokens();
  it.each(FALLBACKS)('$token falls back to tokens.css :root ($fallback)', ({ token, fallback }) => {
    expect(tokens[token], `${token} is not defined on :root in tokens.css`).toBeDefined();
    expect(fallback).toBe((tokens[token] as string).toLowerCase());
  });
});
