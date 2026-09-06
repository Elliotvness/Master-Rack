import { describe, expect, it } from 'vitest';

import {
  DatabaseRequiredError,
  REQUIRE_DB_VAR,
  databaseRequired,
  requireDatabase,
  unavailableMessage,
  type EnvLike,
} from './require-db.js';

const URL_ = 'postgresql://app_user@127.0.0.1:55432/rms';

function collect(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (m) => void messages.push(m), messages };
}

describe('databaseRequired — exactly "1", and nothing else', () => {
  it('is true only for "1"', () => {
    expect(databaseRequired({ [REQUIRE_DB_VAR]: '1' })).toBe(true);
  });

  /**
   * The case this rule exists for. `'0'` is a non-empty string, so any
   * truthiness test would read "off" as "on" — and somebody who writes
   * RMS_REQUIRE_DB=0 has said what they mean and deserves to be obeyed.
   */
  it.each(['0', 'true', 'yes', 'TRUE', '', ' 1', '1 '])('is false for %o', (value) => {
    expect(databaseRequired({ [REQUIRE_DB_VAR]: value })).toBe(false);
  });

  it('is false when the variable is absent', () => {
    expect(databaseRequired({})).toBe(false);
  });
});

describe('requireDatabase — an available database is a no-op in both modes', () => {
  it.each([{}, { [REQUIRE_DB_VAR]: '1' }])('returns silently for env %o', (env: EnvLike) => {
    const { warn, messages } = collect();
    expect(() => requireDatabase(true, 'tenancy', URL_, env, warn)).not.toThrow();
    expect(messages).toEqual([]);
  });
});

describe('requireDatabase — unavailable and NOT required: the existing skip survives', () => {
  it('warns once and does not throw', () => {
    const { warn, messages } = collect();
    expect(() => requireDatabase(false, 'tenancy', URL_, {}, warn)).not.toThrow();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('SKIPPING tenancy tests');
  });

  /**
   * The warning has to name the switch. A skip that does not say how to turn
   * itself into a failure is how F-29 survived three sessions.
   */
  it('names RMS_REQUIRE_DB in the warning', () => {
    const { warn, messages } = collect();
    requireDatabase(false, 'tenancy', URL_, {}, warn);
    expect(messages[0]).toContain(REQUIRE_DB_VAR);
  });
});

describe('requireDatabase — unavailable and required: red, not green', () => {
  it('throws DatabaseRequiredError', () => {
    const { warn } = collect();
    expect(() => requireDatabase(false, 'tenancy', URL_, { [REQUIRE_DB_VAR]: '1' }, warn)).toThrow(
      DatabaseRequiredError,
    );
  });

  it('does not warn instead of throwing', () => {
    const { warn, messages } = collect();
    try {
      requireDatabase(false, 'audit', URL_, { [REQUIRE_DB_VAR]: '1' }, warn);
    } catch {
      /* expected */
    }
    expect(messages).toEqual([]);
  });

  it('names the suite, the URL and F-29 in the message', () => {
    let message = '';
    try {
      requireDatabase(false, 'outbox', URL_, { [REQUIRE_DB_VAR]: '1' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('outbox');
    expect(message).toContain(URL_);
    expect(message).toContain('F-29');
  });
});

describe('unavailableMessage — the two modes describe one condition', () => {
  it('both name the database and how to get one', () => {
    for (const required of [true, false]) {
      const m = unavailableMessage('tenancy', URL_, required);
      expect(m).toContain(URL_);
      expect(m).toContain('pnpm db:up && pnpm migrate');
    }
  });

  it('only the required form says the tests were required', () => {
    expect(unavailableMessage('tenancy', URL_, true)).toContain('REQUIRED');
    expect(unavailableMessage('tenancy', URL_, false)).not.toContain('REQUIRED');
  });
});
