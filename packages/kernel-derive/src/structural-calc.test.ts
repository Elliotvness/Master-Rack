import { describe, expect, it } from 'vitest';

import {
  DerivationError,
  STEEL_GAGE_TABLE,
  coldWorkFya,
  computeSectionProperties,
  evaluateBeamCheck,
  evaluateColumnCheck,
  evaluateRackBay,
  smartSolveRackBay,
} from './index.js';

describe('computeSectionProperties & STEEL_GAGE_TABLE', () => {
  it('computes open c-lips section properties matching Design 61128 3x3x0.75x14ga', () => {
    const t14 = STEEL_GAGE_TABLE['14ga']!;
    expect(t14).toBeCloseTo(0.0747, 4);

    const sec = computeSectionProperties(3.0, 3.0, 0.75, t14, 0.75, 2 * t14, 'c-lips');
    expect(sec.A).toBeGreaterThan(0.68);
    expect(sec.A).toBeLessThan(0.76);
    expect(sec.Anet).toBeLessThan(sec.A);
    expect(sec.Ix).toBeGreaterThan(1.0);
    expect(sec.Iy).toBeGreaterThan(0.7);
    expect(sec.Cw).toBeGreaterThan(1.5);
    expect(sec.xo).toBeLessThan(0);
    expect(sec.beta).toBeCloseTo(0.2577, 3);
    expect(sec.weightPerFt).toBeGreaterThan(2.3);
  });

  it('supports closed-tube, step-beam, c-channel, and hat shapes', () => {
    const tube = computeSectionProperties(4.5, 2.5, 0, 0.0747, 0.5, 0.1494, 'closed-tube');
    expect(tube.xo).toBe(0);
    expect(tube.beta).toBe(1);

    const step = computeSectionProperties(4.5, 2.5, 0.5, 0.0598, 0, 0.1196, 'step-beam');
    expect(step.xo).toBe(0);
    expect(step.Ix).toBeGreaterThan(1.5);

    const unlip = computeSectionProperties(3.0, 2.0, 0, 0.0747, 0.5, 0.1494, 'c-channel');
    expect(unlip.L).toBe(0);
    expect(unlip.A).toBeGreaterThan(0.4);

    const hat = computeSectionProperties(3.0, 3.0, 0.75, 0.0897, 0.5, 0.1794, 'hat');
    expect(hat.shapeType).toBe('hat');
    expect(hat.Cw).toBeGreaterThan(0.5);
  });

  it('rejects out-of-range section dimensions with DerivationError', () => {
    expect(() => computeSectionProperties(0.2, 3, 0.75, 0.0747)).toThrow(DerivationError);
    expect(() => computeSectionProperties(3, 0.1, 0.75, 0.0747)).toThrow(DerivationError);
    expect(() => computeSectionProperties(3, 3, -1, 0.0747)).toThrow(DerivationError);
    expect(() => computeSectionProperties(3, 3, 0.75, 0.001)).toThrow(DerivationError);
    expect(() => computeSectionProperties(3, 3, 0.75, 0.0747, 3.5)).toThrow(DerivationError);
  });
});

describe('coldWorkFya & evaluateBeamCheck', () => {
  it('computes cold-work yield strength and returns Fy when ri/t > 7 or Fu <= Fy', () => {
    const fya = coldWorkFya(0.12, 0.06, 50, 65, 0.25);
    expect(fya).toBeGreaterThan(50);

    expect(coldWorkFya(0.9, 0.06, 50, 65, 0.25)).toBe(50);
    expect(coldWorkFya(0.12, 0.06, 55, 55, 0.25)).toBe(55);
  });

  it('evaluates beam flexure, deflection, and all three web shear slenderness regimes', () => {
    // Stocky web (slend <= lim1)
    const stocky = evaluateBeamCheck({
      loadLb: 4000,
      spanIn: 108,
      fixityKipInPerRad: 300,
      heightIn: 4.5,
      thicknessIn: 0.1046,
      riIn: 0.2,
      agIn2: 1.1,
      ixIn4: 2.6,
      sxIn3: 1.15,
      fyKsi: 50,
      fuKsi: 65,
    });
    expect(stocky.passes).toBe(true);
    expect(stocky.utilBending).toBeLessThan(1.0);

    // Intermediate web (lim1 < slend <= lim2)
    const medium = evaluateBeamCheck({
      loadLb: 4000,
      spanIn: 108,
      fixityKipInPerRad: 300,
      heightIn: 4.5,
      thicknessIn: 0.055,
      riIn: 0.11,
      agIn2: 0.79,
      ixIn4: 1.89,
      sxIn3: 0.84,
      fyKsi: 55,
      fuKsi: 70,
    });
    expect(medium.VuKip).toBeGreaterThan(1.0);

    // Slender web (slend > lim2)
    const slender = evaluateBeamCheck({
      loadLb: 9000,
      spanIn: 144,
      fixityKipInPerRad: 150,
      heightIn: 8.0,
      thicknessIn: 0.0478,
      riIn: 0.09,
      agIn2: 0.85,
      ixIn4: 2.1,
      sxIn3: 0.75,
      fyKsi: 60,
      fuKsi: 75,
    });
    expect(slender.passes).toBe(false);
    expect(slender.controllingRatio).toBeGreaterThan(1.0);
  });
});

describe('evaluateColumnCheck, evaluateRackBay & smartSolveRackBay', () => {
  it('covers inelastic (lambdaC <= 1.5) and elastic (lambdaC > 1.5) column buckling', () => {
    const col14 = computeSectionProperties(3.0, 3.0, 0.75, 0.0747, 0.75, 0.1494, 'c-lips');

    const inelastic = evaluateColumnCheck({
      PuKip: 12.0,
      MuYKipIn: 0,
      LxIn: 48,
      LyIn: 48,
      LtIn: 48,
      Kx: 1.2,
      Ky: 1.0,
      Kt: 0.8,
      section: col14,
      fyKsi: 55,
    });
    expect(inelastic.FnKsi).toBeGreaterThan(25);
    expect(inelastic.passes).toBe(true);

    const elastic = evaluateColumnCheck({
      PuKip: 18.0,
      MuYKipIn: 2.5,
      LxIn: 120,
      LyIn: 96,
      LtIn: 96,
      Kx: 2.0,
      Ky: 1.0,
      Kt: 1.0,
      section: col14,
      fyKsi: 55,
    });
    expect(elastic.passes).toBe(false);
    expect(elastic.controllingRatio).toBeGreaterThan(1.0);
  });

  it('evaluates full rack bay across bracing styles, leg profiles, and tunnel bay options', () => {
    const col14 = computeSectionProperties(3.0, 3.0, 0.75, 0.0747, 0.75, 0.1494, 'c-lips');
    const beam16 = computeSectionProperties(4.5, 2.5, 0.5, 0.0598, 0, 0.1196, 'step-beam');

    const stdEval = evaluateRackBay({
      bayWidthIn: 108,
      frameDepthIn: 36,
      frameHeightIn: 384,
      bracePitchIn: 48,
      levelElevationsIn: [56, 112, 168, 224, 280, 336],
      levelLoadLb: 4000,
      columnSection: col14,
      beamSection: beam16,
    });
    expect(stdEval.maxColumnRatio).toBeGreaterThan(1.0);
    expect(stdEval.passesAll).toBe(false);

    const xBraced = evaluateRackBay({
      bayWidthIn: 108,
      frameDepthIn: 36,
      frameHeightIn: 384,
      bracePitchIn: 48,
      levelElevationsIn: [56, 112, 168],
      levelLoadLb: 2500,
      columnSection: col14,
      beamSection: beam16,
      bracingStyle: 'x-pattern',
      frameStyle: 'setback',
      tunnelBay: true,
    });
    expect(xBraced.estimatedBayWeightLb).toBeGreaterThan(100);

    const kBraced = evaluateRackBay({
      bayWidthIn: 96,
      frameDepthIn: 42,
      frameHeightIn: 240,
      bracePitchIn: 48,
      levelElevationsIn: [],
      levelLoadLb: 2000,
      columnSection: col14,
      beamSection: beam16,
      bracingStyle: 'k-pattern',
      frameStyle: 'slant-leg',
      tunnelBay: false,
    });
    expect(kBraced.stabilityB2).toBeGreaterThan(1.0);

    const dBraced = evaluateRackBay({
      bayWidthIn: 96,
      frameDepthIn: 42,
      frameHeightIn: 240,
      bracePitchIn: 48,
      levelElevationsIn: [60, 120],
      levelLoadLb: 2000,
      columnSection: col14,
      beamSection: beam16,
      bracingStyle: 'd-pattern',
    });
    expect(dBraced.passesAll).toBe(true);
  });

  it('smartSolveRackBay selects the lightest passing column and falls back when extreme', () => {
    const beam14 = computeSectionProperties(5.0, 2.5, 0.5, 0.0747, 0, 0.1494, 'step-beam');
    const solved = smartSolveRackBay({
      bayWidthIn: 108,
      frameDepthIn: 36,
      frameHeightIn: 384,
      bracePitchIn: 48,
      levelElevationsIn: [56, 112, 168, 224, 280, 336],
      levelLoadLb: 4000,
      beamSection: beam14,
    });
    expect(solved.candidates.length).toBe(6);
    expect(solved.recommended.passes).toBe(true);
    expect(solved.recommended.gage).toBe('12ga');

    // Extreme load triggers fallback to heaviest candidate
    const extreme = smartSolveRackBay({
      bayWidthIn: 144,
      frameDepthIn: 48,
      frameHeightIn: 480,
      bracePitchIn: 72,
      levelElevationsIn: [72, 144, 216, 288, 360, 432],
      levelLoadLb: 25000,
      beamSection: beam14,
    });
    expect(extreme.recommended.gage).toBe('10ga');
  });
});
