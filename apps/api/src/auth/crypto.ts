/**
 * Tokens and password hashing.
 *
 * Two different jobs with two different correct answers, and getting them the
 * wrong way round is a classic mistake:
 *
 *   - A session or invitation token is HIGH-ENTROPY (256 bits from a CSPRNG).
 *     A fast hash is correct here: there is nothing to brute-force, and the
 *     only job is to make a database dump non-replayable. SHA-256 it is.
 *
 *   - A password is LOW-ENTROPY. It needs a SLOW, salted, memory-hard KDF so an
 *     offline attacker with the dump cannot grind it. scrypt, tuned, with a
 *     per-password random salt, stored in an algorithm-tagged string so the
 *     parameters travel with the hash and can be raised later without breaking
 *     existing rows.
 *
 * This module lives in the api layer, not the kernel: it uses node:crypto,
 * which the kernel is forbidden. Timing-safe comparison throughout, because a
 * token or hash comparison that short-circuits on the first wrong byte leaks
 * its contents one measurement at a time.
 */

import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

/** 256 bits, base64url. Not UUIDv4 — that is 122 bits and often a non-CSPRNG. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of a high-entropy token, hex. Store this; never the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time string comparison. Length is compared first, in constant time. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which itself leaks length. Pad
  // to a common length and fold the length check into the boolean instead.
  const length = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const equalContent = timingSafeEqual(paddedA, paddedB);
  return equalContent && bufA.length === bufB.length;
}

const SCRYPT_N = 16384; // CPU/memory cost. Raise over time; the tag records it.
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

/**
 * Hash a password into an algorithm-tagged string:
 *   scrypt$N$r$p$<salt-base64url>$<hash-base64url>
 * The parameters travel with the hash, so they can be raised later without
 * invalidating existing rows.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against a stored hash, in constant time relative to the
 * stored parameters. A malformed stored hash returns false rather than
 * throwing, so a corrupted row cannot become a crash on the login path.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, 'base64url');
    expected = Buffer.from(parts[5] as string, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A short numeric out-of-band code, for break-glass recovery only — never a
 * standing second factor. Uses randomInt (rejection sampling) rather than
 * randomBytes % 10^6, which is biased.
 */
export function generateRecoveryCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
