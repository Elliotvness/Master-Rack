import { describe, expect, it } from 'vitest';

import { sha256 } from '@rms/kernel-model';

import {
  RETENTION_DAYS_7_YEARS,
  WormError,
  anchorKey,
  manifestKey,
  modeRefusals,
  prepareManifest,
  writeRefusals,
} from './store.js';
import { InMemoryWormStore } from './memory-store.js';
import {
  anchorClaim,
  anchorDigest,
  anchorGaps,
  anchorRefusals,
  prepareAnchor,
  type DailyAnchor,
} from './anchor.js';

const NOW = '2026-09-01T00:00:00.000Z';
const FUTURE = '2033-09-01T00:00:00.000Z';
const HASH = 'a'.repeat(64);

function anchor(overrides: Partial<DailyAnchor> = {}): DailyAnchor {
  const day = overrides.day ?? '2026-09-01';
  const headHash = overrides.headHash ?? HASH;
  const eventCount = overrides.eventCount ?? 12;
  return {
    day,
    headHash,
    eventCount,
    token: {
      digest: anchorDigest(day, headHash, eventCount),
      timestampedAt: '2026-09-01T23:59:00.000Z',
      authority: 'FreeTSA',
      tokenBase64: 'MIIB...',
    },
    ...overrides,
  };
}

describe('E-07 — WORM keys are content-addressed', () => {
  it('puts the full digest in the manifest key', () => {
    expect(manifestKey('sub-1', HASH)).toBe(`manifests/sub-1/${HASH}.json`);
  });

  it('refuses a truncated hash, which would let two manifests collide', () => {
    expect(() => manifestKey('sub-1', 'abc123')).toThrow(WormError);
    expect(() => manifestKey('sub-1', 'abc123')).toThrow(/full SHA-256/);
  });

  it('refuses an uppercase digest, so one manifest has exactly one key', () => {
    expect(() => manifestKey('sub-1', 'A'.repeat(64))).toThrow(WormError);
  });

  it('refuses a missing submission id', () => {
    expect(() => manifestKey('   ', HASH)).toThrow(/submission id/);
  });

  it('anchor keys are one per calendar day', () => {
    expect(anchorKey('2026-09-01')).toBe('anchors/2026-09-01.json');
    expect(() => anchorKey('01-09-2026')).toThrow(WormError);
  });
});

describe('E-07 — the digest is computed, never accepted', () => {
  it('hashes the bytes being stored', () => {
    const json = '{"a":1}';
    const object = prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: json,
      retainUntil: FUTURE,
      mode: 'COMPLIANCE',
    });
    expect(object.sha256).toBe(sha256(json));
    expect(object.key).toContain(object.sha256);
  });

  it('refuses an empty manifest rather than storing a hash of nothing', () => {
    expect(() =>
      prepareManifest({
        submissionId: 'sub-1',
        canonicalJson: '   ',
        retainUntil: FUTURE,
        mode: 'COMPLIANCE',
      }),
    ).toThrow(/empty manifest/);
  });

  it('catches a digest that does not describe its own bytes', () => {
    const reasons = writeRefusals(
      { key: 'k', body: '{"a":1}', sha256: HASH, mode: 'COMPLIANCE', retainUntil: FUTURE },
      { alreadyExists: false, now: NOW },
    );
    expect(reasons.some((r) => r.includes('misdescribes'))).toBe(true);
  });
});

describe('E-07 — a write is refused, never silently applied', () => {
  it('refuses to overwrite an existing key', () => {
    const object = prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: '{"a":1}',
      retainUntil: FUTURE,
      mode: 'COMPLIANCE',
    });
    const reasons = writeRefusals(object, { alreadyExists: true, now: NOW });
    expect(reasons.some((r) => r.includes('never overwrites'))).toBe(true);
  });

  it('refuses a retention date that is not in the future', () => {
    const object = prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: '{"a":1}',
      retainUntil: '2020-01-01T00:00:00.000Z',
      mode: 'COMPLIANCE',
    });
    const reasons = writeRefusals(object, { alreadyExists: false, now: NOW });
    expect(reasons.some((r) => r.includes('decorative'))).toBe(true);
  });

  it('reports every reason at once, not the first', () => {
    const reasons = writeRefusals(
      { key: 'k', body: 'x', sha256: HASH, mode: 'COMPLIANCE', retainUntil: '2020-01-01T00:00:00Z' },
      { alreadyExists: true, now: NOW },
    );
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses unparsable timestamps rather than treating them as zero', () => {
    const object = prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: '{"a":1}',
      retainUntil: 'whenever',
      mode: 'COMPLIANCE',
    });
    expect(writeRefusals(object, { alreadyExists: false, now: NOW })[0]).toContain('not a parsable');
    const good = prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: '{"a":1}',
      retainUntil: FUTURE,
      mode: 'COMPLIANCE',
    });
    expect(writeRefusals(good, { alreadyExists: false, now: 'soon' })[0]).toContain('not a parsable');
  });
});

describe('E-07 — the staged Governance to Compliance rollout is enforced', () => {
  it('allows Governance in staging, where the overwrite test is run', () => {
    expect(modeRefusals('GOVERNANCE', 'staging')).toEqual([]);
  });

  it('refuses Governance in production', () => {
    const reasons = modeRefusals('GOVERNANCE', 'production');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('COMPLIANCE');
  });

  it('allows Compliance in both', () => {
    expect(modeRefusals('COMPLIANCE', 'production')).toEqual([]);
    expect(modeRefusals('COMPLIANCE', 'staging')).toEqual([]);
  });

  it('retains for seven years, rounded up rather than down', () => {
    // 7 x 365 = 2555, plus two leap days. Retention that expires early is a
    // silent failure of the guarantee, so the arithmetic errs long.
    expect(RETENTION_DAYS_7_YEARS).toBe(2557);
    expect(RETENTION_DAYS_7_YEARS).toBeGreaterThan(7 * 365);
  });
});

describe('E-07 — the in-memory store enforces the contract it stands in for', () => {
  const store = (now = NOW): InMemoryWormStore => new InMemoryWormStore(() => now);

  const manifest = (json = '{"a":1}') =>
    prepareManifest({
      submissionId: 'sub-1',
      canonicalJson: json,
      retainUntil: FUTURE,
      mode: 'COMPLIANCE',
    });

  it('stores an object and reads it back', async () => {
    const s = store();
    const m = manifest();
    await s.put(m);
    expect(await s.get(m.key)).toEqual(m);
    expect(await s.has(m.key)).toBe(true);
    expect(s.size).toBe(1);
  });

  it('THROWS on a second write to the same key', async () => {
    const s = store();
    const m = manifest();
    await s.put(m);
    await expect(s.put(m)).rejects.toThrow(WormError);
    expect(s.refusals.some((r) => r.includes('never overwrites'))).toBe(true);
  });

  it('a different body cannot take an existing key', async () => {
    // Different bytes produce a different key, so this is really a check that
    // content addressing makes silent replacement impossible by construction.
    const s = store();
    const a = manifest('{"a":1}');
    const b = manifest('{"a":2}');
    await s.put(a);
    await s.put(b);
    expect(a.key).not.toBe(b.key);
    expect(s.size).toBe(2);
  });

  it('refuses deletion before retention expires, naming the mode', async () => {
    const s = store();
    const m = manifest();
    await s.put(m);
    const result = await s.attemptDelete(m.key);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('including the account root');
    expect(await s.has(m.key)).toBe(true);
  });

  it('says something WEAKER about governance mode, because it is weaker', async () => {
    const s = store();
    const m = prepareManifest({
      submissionId: 'sub-2',
      canonicalJson: '{"g":1}',
      retainUntil: FUTURE,
      mode: 'GOVERNANCE',
    });
    await s.put(m);
    const result = await s.attemptDelete(m.key);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('can be overridden');
    expect(result.reason).not.toContain('including the account root');
  });

  it('allows deletion once retention has expired', async () => {
    /**
     * The clock is a constructor argument precisely so this boundary can be
     * crossed without waiting seven years. A mutable `now` is used rather than
     * two stores: the object must be WRITTEN while its retention is still in
     * the future (a store refuses a write whose lock has already lapsed, which
     * is asserted above), and then examined after time has passed. Two separate
     * stores could not express that, because the second would refuse the write.
     */
    let now = NOW;
    const s = new InMemoryWormStore(() => now);
    const m = prepareManifest({
      submissionId: 'sub-3',
      canonicalJson: '{"old":1}',
      retainUntil: '2033-09-01T00:00:00.000Z',
      mode: 'COMPLIANCE',
    });
    await s.put(m);
    expect((await s.attemptDelete(m.key)).deleted).toBe(false);

    now = '2040-01-01T00:00:00.000Z';
    expect((await s.attemptDelete(m.key)).deleted).toBe(true);
    expect(await s.has(m.key)).toBe(false);
  });

  it('reports nothing to delete for an unknown key', async () => {
    expect(await store().attemptDelete('nope')).toEqual({
      deleted: false,
      reason: "no object at 'nope'",
    });
  });

  it('returns null for a key it does not hold', async () => {
    expect(await store().get('missing')).toBeNull();
    expect(await store().has('missing')).toBe(false);
  });
});

describe('E-07 — the daily anchor attests what it claims', () => {
  it('the claim carries day, head and event count in a fixed order', () => {
    expect(anchorClaim('2026-09-01', HASH, 12)).toBe(
      `day=2026-09-01\u0000head=${HASH}\u0000events=12`,
    );
  });

  it('refuses a truncated head hash', () => {
    expect(() => anchorClaim('2026-09-01', 'abc', 1)).toThrow(/full SHA-256/);
  });

  it('refuses a malformed day and a negative count', () => {
    expect(() => anchorClaim('2026-9-1', HASH, 1)).toThrow(WormError);
    expect(() => anchorClaim('2026-09-01', HASH, -1)).toThrow(/non-negative/);
    expect(() => anchorClaim('2026-09-01', HASH, 1.5)).toThrow(/non-negative/);
  });

  it('accepts a sound anchor', () => {
    expect(anchorRefusals(anchor())).toEqual([]);
  });

  it('catches a token that attests a DIFFERENT digest', () => {
    const bad = anchor();
    const reasons = anchorRefusals({
      ...bad,
      token: { ...bad.token, digest: 'b'.repeat(64) },
    });
    expect(reasons.some((r) => r.includes('evidence about something else'))).toBe(true);
  });

  it('catches an anchor with no token at all', () => {
    const bad = anchor();
    const reasons = anchorRefusals({ ...bad, token: { ...bad.token, tokenBase64: '  ' } });
    expect(reasons.some((r) => r.includes('no external attestation'))).toBe(true);
  });

  it('catches an unnamed authority and an unparsable time', () => {
    const bad = anchor();
    expect(
      anchorRefusals({ ...bad, token: { ...bad.token, authority: ' ' } }).some((r) =>
        r.includes('does not name the authority'),
      ),
    ).toBe(true);
    expect(
      anchorRefusals({ ...bad, token: { ...bad.token, timestampedAt: 'yesterday' } }).some((r) =>
        r.includes('not parsable'),
      ),
    ).toBe(true);
  });

  it('refuses to package an unsound anchor', () => {
    const bad = anchor();
    expect(() =>
      prepareAnchor({ ...bad, token: { ...bad.token, tokenBase64: '' } }, FUTURE, 'COMPLIANCE'),
    ).toThrow(/unsound anchor/);
  });

  it('packages a sound anchor with its own digest', () => {
    const object = prepareAnchor(anchor(), FUTURE, 'COMPLIANCE');
    expect(object.key).toBe('anchors/2026-09-01.json');
    expect(object.sha256).toBe(sha256(object.body));
    expect(object.mode).toBe('COMPLIANCE');
  });
});

describe('E-07 — a missing anchor is the signature of a rewrite', () => {
  it('finds no gap in consecutive days', () => {
    expect(
      anchorGaps([anchor({ day: '2026-09-01' }), anchor({ day: '2026-09-02' })]),
    ).toEqual([]);
  });

  it('finds a missing day', () => {
    const gaps = anchorGaps([anchor({ day: '2026-09-01' }), anchor({ day: '2026-09-03' })]);
    expect(gaps).toEqual(['no anchor between 2026-09-01 and 2026-09-03']);
  });

  it('crosses a month boundary without a false gap', () => {
    expect(anchorGaps([anchor({ day: '2026-08-31' }), anchor({ day: '2026-09-01' })])).toEqual([]);
  });

  it('crosses a leap day without a false gap', () => {
    // 2028 is a leap year: 28 Feb is followed by 29 Feb, not 1 March.
    expect(anchorGaps([anchor({ day: '2028-02-28' }), anchor({ day: '2028-02-29' })])).toEqual([]);
    const gaps = anchorGaps([anchor({ day: '2028-02-28' }), anchor({ day: '2028-03-01' })]);
    expect(gaps).toHaveLength(1);
  });

  it('crosses a year boundary without a false gap', () => {
    expect(anchorGaps([anchor({ day: '2026-12-31' }), anchor({ day: '2027-01-01' })])).toEqual([]);
  });

  it('catches the same day anchored twice', () => {
    const gaps = anchorGaps([anchor({ day: '2026-09-01' }), anchor({ day: '2026-09-01' })]);
    expect(gaps[0]).toContain('anchored twice');
  });

  it('sorts before comparing, so input order is not a false gap', () => {
    expect(
      anchorGaps([anchor({ day: '2026-09-03' }), anchor({ day: '2026-09-02' }), anchor({ day: '2026-09-01' })]),
    ).toEqual([]);
  });

  it('reports no gap for fewer than two anchors', () => {
    expect(anchorGaps([])).toEqual([]);
    expect(anchorGaps([anchor()])).toEqual([]);
  });
});
