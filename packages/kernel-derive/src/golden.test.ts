import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { convert, each } from '@rms/kernel-units';

import { grossPositions, positionAccounting, type PositionLoss } from './index.js';

/**
 * The golden fixture, WIRED INTO THE TEST RUN.
 *
 * That phrase is the whole point of C-08. The reference project has golden
 * fixtures and nothing consumes them — a control that looks like a control,
 * survives every refactor, and has never once failed. This file is what stops
 * that defect being inherited.
 *
 * The fixture is the Carson Phase 4 as-built count: the only end-to-end
 * validation the engine has against a job that was actually installed.
 */

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/golden/carson-0005-01-r1.json', import.meta.url),
);

interface Fixture {
  readonly id: string;
  readonly source: {
    readonly artifact: string;
    readonly disregarded: readonly string[];
  };
  readonly established: {
    readonly bays: number;
    readonly gross_positions: number;
    readonly lost_positions: number;
    readonly net_positions: number;
    readonly picking_levels: number;
    readonly anchors_per_upright_frame: number;
  };
  readonly not_established: Readonly<Record<string, string>>;
  readonly cross_check: {
    readonly anchor_ratio: {
      readonly anchors: number;
      readonly frames: number;
      readonly ratio: number;
    };
  };
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('the golden fixture is actually consumed', () => {
  it('loads from disk, so a missing or malformed fixture fails the build', () => {
    // If the file is deleted or renamed, this throws at module load. That is
    // the difference between a fixture and a decorative JSON file.
    expect(fixture.id).toBe('carson-0005-01-r1');
    expect(fixture.source.artifact).toMatch(/0005-01 R-1/);
  });

  it('records which artifacts were considered and rejected', () => {
    // P0-004: the two quotes are reference material, disregarded. Keeping the
    // rejection in the fixture stops a future reader "restoring" a number that
    // was deliberately dropped.
    expect(fixture.source.disregarded).toHaveLength(2);
    expect(fixture.source.disregarded.join(' ')).toMatch(/Q-38857-1/);
    expect(fixture.source.disregarded.join(' ')).toMatch(/Q-38857-8/);
  });
});

describe('the as-built count reconciles against itself', () => {
  const { gross_positions, lost_positions, net_positions } = fixture.established;

  it('gross − lost = net, exactly', () => {
    // The property that made this artifact the authority over the two quotes,
    // neither of which reconciles.
    expect(gross_positions - lost_positions).toBe(net_positions);
    expect(net_positions).toBe(6824);
  });

  /**
   * The as-built gross, presented to the engine as a derived quantity.
   *
   * The drawing records the TOTAL and not the per-bay configuration, so the
   * gross cannot be re-derived from bays x levels here — see the
   * `not_established` section of the fixture and the test below that asserts
   * exactly that. Feeding the recorded total in is honest; inventing a level
   * count that happens to multiply to 6,980 would not be, and no integer count
   * does (6,980 / 916 = 7.6201).
   */
  function asBuiltGross() {
    return grossPositions({
      positionsPerBay: gross_positions,
      bayCount: 1,
      beamLevels: 0,
      floorStores: true,
    });
  }

  const AS_BUILT_LOSS: readonly PositionLoss[] = [
    {
      reason: 'as-built total (drawing 0005-01 R-1 does not break it down by reason)',
      count: each(lost_positions),
    },
  ];

  it('the ENGINE reproduces the relationship, not just the headline', () => {
    // This is the assertion that catches a wrong engine. An engine reaching
    // 6,824 by the wrong route — right total, wrong lost accounting — passes a
    // headline check and fails this one.
    const accounting = positionAccounting(asBuiltGross(), AS_BUILT_LOSS);

    expect(convert(accounting.gross, 'ea')).toBe(6980);
    expect(convert(accounting.lost, 'ea')).toBe(156);
    expect(convert(accounting.net, 'ea')).toBe(6824);
  });

  it('the engine\u2019s own invariants hold on real delivered numbers', () => {
    const a = positionAccounting(asBuiltGross(), AS_BUILT_LOSS);

    // net + lost = gross, and the breakdown sums to the total loss. Asserted
    // here against a real job rather than only against constructed inputs.
    expect(convert(a.net, 'ea') + convert(a.lost, 'ea')).toBe(convert(a.gross, 'ea'));
    const breakdown = a.byReason.reduce((sum, l) => sum + convert(l.count, 'ea'), 0);
    expect(breakdown).toBe(convert(a.lost, 'ea'));
  });

  it('refuses to lose more positions than the job contains', () => {
    // Guarding the fixture's own arithmetic: if a future edit inflated the loss
    // past the gross, the engine refuses rather than returning a negative net.
    expect(() =>
      positionAccounting(asBuiltGross(), [
        { reason: 'impossible', count: each(gross_positions + 1) },
      ]),
    ).toThrow(/cannot lose more positions than exist/);
  });

  it('carries a provenance tree naming the rule that produced it', () => {
    const a = positionAccounting(asBuiltGross(), AS_BUILT_LOSS);
    expect(a.provenance.kind).toBe('step');
    if (a.provenance.kind === 'step') {
      expect(a.provenance.ruleId).not.toBe('');
    }
  });
});

describe('the fixture refuses to assert what the drawing does not record', () => {
  it('names the per-bay level count as unestablished, with the arithmetic reason', () => {
    // 6,980 / 916 = 7.6201. No uniform level count reproduces the gross figure,
    // so Carson is a mixed configuration. A fixture asserting a per-bay level
    // count would be inventing one — the exact failure this product prevents.
    expect(fixture.not_established['beam_levels_per_bay']).toMatch(/7\.62/);
    expect(fixture.established.gross_positions % fixture.established.bays).not.toBe(0);
  });

  it('names the loss breakdown as unestablished', () => {
    // The drawing gives 156 as a total and does not say which positions were
    // lost or why, so the engine's per-reason breakdown cannot be checked
    // against this artifact. Recorded rather than quietly skipped.
    expect(fixture.not_established['loss_breakdown_by_reason']).toMatch(/NOT RECORDED/);
  });

  it('gives every unestablished entry a reason, never a bare marker', () => {
    for (const [key, reason] of Object.entries(fixture.not_established)) {
      expect(reason.length, `${key} must state WHY it is unestablished`).toBeGreaterThan(40);
    }
  });
});

describe('the independent cross-check', () => {
  it('confirms four anchors per upright frame against the delivered quantities', () => {
    // 3,812 / 953 = 4.000 exactly. Independent of the position count, and the
    // basis for the BOM's anchor rule — so the BOM rule and this fixture are
    // checked against the same delivered job from two directions.
    const { anchors, frames, ratio } = fixture.cross_check.anchor_ratio;
    expect(anchors / frames).toBe(ratio);
    expect(ratio).toBe(fixture.established.anchors_per_upright_frame);
  });
});
