import { describe, expect, it } from 'vitest';

import {
  TIER_ORDER,
  applyCeiling,
  blocksSubmission,
  isVerificationTier,
  permits,
  permittedSeverities,
  requiresAhjConfirmation,
  requiresCiteCheckStamp,
  type Severity,
  type VerificationTier,
} from './index.js';

const ALL_SEVERITIES: readonly Severity[] = [
  'PASS',
  'BLOCKER',
  'WARNING',
  'MISSING_INPUT',
  'ASSUMPTION',
  'ENGINEERING_REVIEW_REQUIRED',
  'NOT_EVALUATED',
];

describe('the tier ladder is the blueprint\u2019s, exactly', () => {
  it('has the five tiers in authority order', () => {
    expect(TIER_ORDER).toEqual([
      'PRIMARY',
      'REPRODUCED',
      'AHJ_INTERPRETATION',
      'SECONDARY',
      'NOT_FOUND',
    ]);
  });

  it('recognises exactly those five as tiers', () => {
    for (const t of TIER_ORDER) {
      expect(isVerificationTier(t)).toBe(true);
    }
    expect(isVerificationTier('PROBABLY')).toBe(false);
    expect(isVerificationTier('primary')).toBe(false);
    expect(isVerificationTier(undefined)).toBe(false);
    expect(isVerificationTier(3)).toBe(false);
  });

  it('reproduces \u00a711.2\u2019s ceiling table verbatim', () => {
    // These five lines ARE the blueprint's code block. If this test is edited,
    // the document and the engine have diverged and one of them is now lying.
    expect(applyCeiling('PRIMARY', 'PASS')).toBe('PASS');
    expect(applyCeiling('PRIMARY', 'BLOCKER')).toBe('BLOCKER');
    expect(applyCeiling('REPRODUCED', 'BLOCKER')).toBe('BLOCKER');
    expect(applyCeiling('AHJ_INTERPRETATION', 'BLOCKER')).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(applyCeiling('SECONDARY', 'BLOCKER')).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(applyCeiling('NOT_FOUND', 'BLOCKER')).toBe('NOT_EVALUATED');
  });
});

describe('AC-19 \u2014 a check cannot return PASS against a non-primary rule', () => {
  // The governing acceptance criterion, and the reason this package exists.
  // The Rev A review found 14 checks asserting a hard FAIL while their own
  // notes conceded the source had never been read. The fix is mechanical:
  // make the overstatement unrepresentable rather than merely discouraged.

  it('never lets PASS survive below PRIMARY tier, for any tier', () => {
    for (const tier of TIER_ORDER) {
      const outcome = applyCeiling(tier, 'PASS');
      if (tier === 'PRIMARY') {
        expect(outcome).toBe('PASS');
      } else {
        expect(outcome).not.toBe('PASS');
      }
    }
  });

  it('never lets a bare BLOCKER survive below REPRODUCED tier', () => {
    // PRIMARY and REPRODUCED may block. Nothing weaker may.
    expect(applyCeiling('PRIMARY', 'BLOCKER')).toBe('BLOCKER');
    expect(applyCeiling('REPRODUCED', 'BLOCKER')).toBe('BLOCKER');
    for (const tier of ['AHJ_INTERPRETATION', 'SECONDARY', 'NOT_FOUND'] as VerificationTier[]) {
      expect(blocksSubmission(applyCeiling(tier, 'BLOCKER'))).toBe(false);
    }
  });

  it('collapses EVERY severity to NOT EVALUATED at NOT_FOUND tier', () => {
    // "No source located" can conclude nothing at all. Exhaustive, because a
    // single leaking severity here would be a silent authority escalation.
    for (const s of ALL_SEVERITIES) {
      expect(applyCeiling('NOT_FOUND', s)).toBe('NOT_EVALUATED');
    }
  });

  it('is idempotent: applying the ceiling twice changes nothing', () => {
    // The framework must be safe to apply defensively at more than one layer.
    for (const tier of TIER_ORDER) {
      for (const s of ALL_SEVERITIES) {
        const once = applyCeiling(tier, s);
        expect(applyCeiling(tier, once)).toBe(once);
      }
    }
  });

  it('only ever weakens an outcome, never strengthens it', () => {
    // The ceiling is a cap. A tier may not UPGRADE a check's observation:
    // an unpermitted result must land on that tier's ceiling, and every
    // ceiling is itself permitted at its own tier.
    for (const tier of TIER_ORDER) {
      for (const s of ALL_SEVERITIES) {
        const outcome = applyCeiling(tier, s);
        expect(permits(tier, outcome)).toBe(true);
        if (permits(tier, s)) {
          expect(outcome).toBe(s);
        }
      }
    }
  });

  it('leaves the client-actionable states reachable at every tier except NOT_FOUND', () => {
    // MISSING INPUT must survive a weak tier. The client can fix a missing
    // field in thirty seconds regardless of how well-sourced the rule is, and
    // collapsing it into ENGINEERING REVIEW REQUIRED buries the one list the
    // client can actually act on. This is the §11.1 failure mode, asserted.
    for (const tier of ['PRIMARY', 'REPRODUCED', 'AHJ_INTERPRETATION', 'SECONDARY'] as const) {
      expect(applyCeiling(tier, 'MISSING_INPUT')).toBe('MISSING_INPUT');
      expect(applyCeiling(tier, 'ASSUMPTION')).toBe('ASSUMPTION');
    }
  });

  it('never invents an eighth state', () => {
    for (const tier of TIER_ORDER) {
      for (const s of ALL_SEVERITIES) {
        expect(ALL_SEVERITIES).toContain(applyCeiling(tier, s));
      }
    }
  });
});

describe('tiers carry their own qualifications', () => {
  it('stamps a REPRODUCED blocker as cite-checked, and only that case', () => {
    expect(requiresCiteCheckStamp('REPRODUCED', 'BLOCKER')).toBe(true);
    expect(requiresCiteCheckStamp('REPRODUCED', 'WARNING')).toBe(false);
    expect(requiresCiteCheckStamp('PRIMARY', 'BLOCKER')).toBe(false);
  });

  it('flags AHJ interpretations for confirmation', () => {
    expect(requiresAhjConfirmation('AHJ_INTERPRETATION')).toBe(true);
    for (const t of TIER_ORDER.filter((x) => x !== 'AHJ_INTERPRETATION')) {
      expect(requiresAhjConfirmation(t)).toBe(false);
    }
  });

  it('blocks submission on BLOCKER alone', () => {
    for (const s of ALL_SEVERITIES) {
      expect(blocksSubmission(s)).toBe(s === 'BLOCKER');
    }
  });

  it('exposes a frozen permitted-severity list per tier', () => {
    for (const tier of TIER_ORDER) {
      const list = permittedSeverities(tier);
      expect(Object.isFrozen(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) {
        expect(ALL_SEVERITIES).toContain(s);
      }
    }
    expect(permittedSeverities('NOT_FOUND')).toEqual(['NOT_EVALUATED']);
  });

  it('permits no more severities as authority weakens', () => {
    // Not merely different sets: each tier's permissions must be a SUBSET of
    // every stronger tier's. A weaker source may never conclude something a
    // stronger source could not.
    //
    // The relation is non-increasing rather than strictly decreasing, because
    // AHJ_INTERPRETATION and SECONDARY deliberately share a ceiling — both cap
    // at ENGINEERING REVIEW REQUIRED. They are distinct tiers because they are
    // flagged differently downstream, not because one may conclude more. That
    // distinction is asserted in the AHJ-confirmation test, which is where it
    // actually lives; asserting a strict size drop here would encode a
    // difference the blueprint does not make.
    for (let i = 1; i < TIER_ORDER.length; i += 1) {
      const stronger = permittedSeverities(TIER_ORDER[i - 1] as VerificationTier);
      const weaker = permittedSeverities(TIER_ORDER[i] as VerificationTier);
      for (const s of weaker) {
        expect(stronger).toContain(s);
      }
      expect(weaker.length).toBeLessThanOrEqual(stronger.length);
    }
    // The ladder must still weaken overall, or the tiers would be decorative.
    expect(permittedSeverities('NOT_FOUND').length).toBeLessThan(
      permittedSeverities('PRIMARY').length,
    );
  });
});
