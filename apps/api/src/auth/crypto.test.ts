import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCode,
  generateToken,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from '../index.js';

describe('high-entropy tokens', () => {
  it('generates a 256-bit base64url token', () => {
    const token = generateToken();
    // 32 bytes base64url is 43 chars, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateToken());
    expect(seen.size).toBe(1000);
  });

  it('hashes a token to 64 hex chars and is deterministic', () => {
    const token = generateToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('gives different tokens different hashes', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});

describe('constant-time comparison', () => {
  it('is true for equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });

  it('is false for different content of the same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
    expect(safeEqual('a', '')).toBe(false);
  });
});

describe('password hashing', () => {
  it('produces an algorithm-tagged string', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('salts, so the same password hashes differently every time', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a).not.toBe(b);
  });

  it('verifies a correct password', () => {
    const hash = hashPassword('s3cret-passphrase-value');
    expect(verifyPassword('s3cret-passphrase-value', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('s3cret-passphrase-value');
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword('s3cret-passphrase-valuE', hash)).toBe(false);
  });

  it('returns false for a malformed stored hash rather than throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$8$1$onlyfiveparts')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(false);
    expect(verifyPassword('x', 'scrypt$notanumber$8$1$c2FsdA$aGFzaA')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$8$1$c2FsdA$')).toBe(false);
  });

  it('survives stored PARAMETERS that make scrypt itself throw', () => {
    // A corrupted row can carry integers that parse fine and then blow up
    // inside scrypt — N not a power of two, N zero or negative, r or p zero,
    // or values large enough to exceed the memory limit. Each must return
    // false on the login path rather than crashing it: a corrupted credential
    // row is a data problem, not an availability problem, and a 500 here is
    // both an outage and an oracle telling an attacker the row is unusual.
    const corrupted = [
      'scrypt$0$8$1$c2FsdA$aGFzaA',
      'scrypt$-1$8$1$c2FsdA$aGFzaA',
      'scrypt$3$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$0$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$0$c2FsdA$aGFzaA',
      'scrypt$1073741824$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$999999$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$999999$c2FsdA$aGFzaA',
    ];
    for (const stored of corrupted) {
      expect(() => verifyPassword('x', stored)).not.toThrow();
      expect(verifyPassword('x', stored)).toBe(false);
    }
  });

  it('never returns true for an empty expected hash', () => {
    // A zero-length expected value would make timingSafeEqual trivially agree
    // if the length check were removed. Asserted so that check cannot be
    // dropped as redundant.
    expect(verifyPassword('', 'scrypt$16384$8$1$c2FsdA$')).toBe(false);
  });
});

describe('recovery codes', () => {
  it('is a six-digit numeric code', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRecoveryCode()).toMatch(/^[0-9]{6}$/);
    }
  });
});
