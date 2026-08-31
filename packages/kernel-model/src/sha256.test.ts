/**
 * SHA-256 against published vectors.
 *
 * A hand-written hash is worth exactly as much as its test vectors. These are
 * the FIPS 180-4 / NIST examples plus the standard empty-string digest, the
 * multi-block case, and a UTF-8 case — because a wrong UTF-8 encoder produces a
 * confidently wrong digest that looks completely normal.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256.js';

describe('published test vectors', () => {
  it('hashes the empty string', () => {
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc" — FIPS 180-4 one-block example', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 448-bit two-block example', () => {
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes the 896-bit example', () => {
    expect(
      sha256(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn' +
          'hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      ),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });

  it('hashes a million "a" characters', () => {
    expect(sha256('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('length and block boundaries', () => {
  // The padding rule changes at 55/56 bytes and again at 63/64. These are the
  // lengths a hand-written implementation gets wrong.
  const boundaries: ReadonlyArray<readonly [number, string]> = [
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [63, '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    [65, '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'],
  ];

  for (const [length, expected] of boundaries) {
    it(`hashes ${length} bytes correctly across the padding boundary`, () => {
      expect(sha256('a'.repeat(length))).toBe(expected);
    });
  }
});

describe('UTF-8 encoding', () => {
  // Pinned against an independent reference implementation. A digest that is
  // only compared to another call of the same function proves nothing: a broken
  // encoder agrees with itself perfectly.
  it('encodes a two-byte character', () => {
    expect(sha256('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
    expect(sha256('\u00e9')).toBe(sha256('é'));
  });

  it('encodes a three-byte character', () => {
    expect(sha256('€')).toBe(
      'c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d',
    );
  });

  it('encodes a surrogate pair as one four-byte code point', () => {
    // U+1F600. Encoding the surrogates separately gives a different digest.
    expect(sha256('😀')).toBe(
      'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9',
    );
    expect(sha256('\u{1F600}')).toBe(sha256('😀'));
  });

  it('produces a different digest for different characters', () => {
    expect(sha256('e')).toBe(
      '3f79bb7b435b05321651daefd374cdc681dc06faa65e374e38337b88ca046dea',
    );
    expect(sha256('E')).toBe(
      'a9f51566bd6705f7ea6ad54bb9deb449f795582d6529a0e22207b8981233ec58',
    );
    expect(sha256('é')).not.toBe(sha256('e'));
  });

  it('handles an unpaired surrogate without hanging or throwing', () => {
    // Malformed input still has to produce a stable answer.
    expect(sha256('\ud83d')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('\ud83d')).toBe(sha256('\ud83d'));
  });
});

describe('shape', () => {
  it('always returns 64 lowercase hex characters', () => {
    for (const input of ['', 'a', 'abc', 'x'.repeat(200)]) {
      expect(sha256(input)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is deterministic across repeated calls', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
  });
});
