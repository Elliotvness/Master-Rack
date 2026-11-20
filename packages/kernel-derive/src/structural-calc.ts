/**
 * Pure cold-formed thin-walled section integration & RMI MH16.1 / AISI S100
 * structural capacity evaluation for pallet rack uprights, step beams, and frames.
 *
 * Pure: no I/O, no clock, no RNG — enforced by tools/check-boundaries.mjs.
 */

import { DerivationError } from './derive.js';

export type RackShapeType = 'c-lips' | 'closed-tube' | 'step-beam' | 'c-channel' | 'hat';
export type FrameBracingStyle = 'z-pattern' | 'x-pattern' | 'k-pattern' | 'd-pattern';
export type FrameLegStyle = 'standard' | 'setback' | 'slant-leg';

export const STEEL_GAGE_TABLE: Readonly<Record<string, number>> = Object.freeze({
  '10ga': 0.1345,
  '11ga': 0.1196,
  '12ga': 0.1046,
  '13ga': 0.0897,
  '14ga': 0.0747,
  '15ga': 0.0673,
  '16ga': 0.0598,
  '18ga': 0.0478,
});

export interface SectionProperties {
  readonly shapeType: RackShapeType;
  readonly H: number;
  readonly W: number;
  readonly L: number;
  readonly t: number;
  readonly hw: number;
  readonly ri: number;
  readonly rOut: number;
  readonly A: number;
  readonly Anet: number;
  readonly xc: number;
  readonly yc: number;
  readonly Ix: number;
  readonly Sx: number;
  readonly rx: number;
  readonly Iy: number;
  readonly Syl: number;
  readonly Syr: number;
  readonly ry: number;
  readonly J: number;
  readonly Cw: number;
  readonly xo: number;
  readonly ro: number;
  readonly beta: number;
  readonly weightPerFt: number;
}

export interface BeamCheckInput {
  readonly loadLb: number;
  readonly spanIn: number;
  readonly fixityKipInPerRad: number;
  readonly heightIn: number;
  readonly thicknessIn: number;
  readonly riIn: number;
  readonly agIn2: number;
  readonly ixIn4: number;
  readonly sxIn3: number;
  readonly fyKsi: number;
  readonly fuKsi: number;
}

export interface BeamCheckResult {
  readonly selfWtLb: number;
  readonly rm: number;
  readonly MuMidKipIn: number;
  readonly MuEndKipIn: number;
  readonly VuKip: number;
  readonly FyaKsi: number;
  readonly phiMnKipIn: number;
  readonly phiVnKip: number;
  readonly utilBending: number;
  readonly utilShear: number;
  readonly deltaIn: number;
  readonly deflAllowIn: number;
  readonly deflRatio: number;
  readonly controllingRatio: number;
  readonly passes: boolean;
}

export interface ColumnCheckInput {
  readonly PuKip: number;
  readonly MuYKipIn: number;
  readonly LxIn: number;
  readonly LyIn: number;
  readonly LtIn: number;
  readonly Kx: number;
  readonly Ky: number;
  readonly Kt: number;
  readonly section: SectionProperties;
  readonly fyKsi: number;
}

export interface ColumnCheckResult {
  readonly PuKip: number;
  readonly FexKsi: number;
  readonly FeyKsi: number;
  readonly FezKsi: number;
  readonly FeKsi: number;
  readonly FnKsi: number;
  readonly AeIn2: number;
  readonly phiPnKip: number;
  readonly alphaX: number;
  readonly ratio1: number;
  readonly ratio2: number;
  readonly controllingRatio: number;
  readonly passes: boolean;
}

export interface RackBayEvaluationInput {
  readonly bayWidthIn: number;
  readonly frameDepthIn: number;
  readonly frameHeightIn: number;
  readonly bracePitchIn: number;
  readonly levelElevationsIn: readonly number[];
  readonly levelLoadLb: number;
  readonly columnSection: SectionProperties;
  readonly beamSection: SectionProperties;
  readonly columnFyKsi?: number;
  readonly beamFyKsi?: number;
  readonly beamFuKsi?: number;
  readonly fixityKipInPerRad?: number;
  readonly Kx?: number;
  readonly Ky?: number;
  readonly Kt?: number;
  readonly bracingStyle?: FrameBracingStyle;
  readonly frameStyle?: FrameLegStyle;
  readonly tunnelBay?: boolean;
}

export interface RackBayEvaluationResult {
  readonly beamCheck: BeamCheckResult;
  readonly bottomColumnCheck: ColumnCheckResult;
  readonly maxColumnRatio: number;
  readonly maxBeamRatio: number;
  readonly stabilityB2: number;
  readonly stabilityRatio: number;
  readonly overallControllingRatio: number;
  readonly estimatedBayWeightLb: number;
  readonly passesAll: boolean;
}

export interface SmartSolveCandidate {
  readonly label: string;
  readonly gage: string;
  readonly H: number;
  readonly W: number;
  readonly L: number;
  readonly t: number;
  readonly section: SectionProperties;
  readonly maxColumnRatio: number;
  readonly estimatedBayWeightLb: number;
  readonly passes: boolean;
}

const DEFAULT_E_KSI = 29_500;
const DEFAULT_G_KSI = 11_300;
const STEEL_DENSITY_LB_IN3 = 0.2836;

function assertFiniteRange(val: number, name: string, min: number, max: number): void {
  if (!Number.isFinite(val) || val < min || val > max) {
    throw new DerivationError(`${name} must be within [${min}, ${max}], got ${val}.`);
  }
}

function buildSectionPolyline(
  H: number,
  W: number,
  L: number,
  t: number,
  ri: number,
  shapeType: RackShapeType,
): readonly [number, number][] {
  const r = ri + t / 2;
  const pts: [number, number][] = [];
  const h = H - t;
  const w = W - t;
  const l = L > 0 ? Math.max(L - t / 2, r + 1e-4) : 0;

  const addArc = (cx: number, cy: number, a0: number, a1: number): void => {
    const n = 12;
    for (let i = 0; i <= n; i += 1) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };

  if (shapeType === 'closed-tube') {
    addArc(w - r, h - r, 0, Math.PI / 2);
    addArc(r, h - r, Math.PI / 2, Math.PI);
    addArc(r, r, Math.PI, 1.5 * Math.PI);
    addArc(w - r, r, 1.5 * Math.PI, 2 * Math.PI);
    pts.push([w, h - r]);
    return pts;
  }

  if (shapeType === 'step-beam') {
    const stepD = Math.min(h * 0.35, 1.625);
    const stepW = Math.min(w * 0.4, 0.875);
    pts.push([w, 0]);
    pts.push([0, 0]);
    pts.push([0, h]);
    pts.push([w - stepW, h]);
    pts.push([w - stepW, h - stepD]);
    pts.push([w, h - stepD]);
    pts.push([w, 0]);
    return pts;
  }

  if (shapeType === 'hat') {
    pts.push([w + l, h]);
    pts.push([w, h]);
    addArc(r, h - r, Math.PI / 2, Math.PI);
    addArc(r, r, Math.PI, 1.5 * Math.PI);
    pts.push([w, 0]);
    pts.push([w + l, 0]);
    return pts;
  }

  if (L > 0 && shapeType !== 'c-channel') {
    pts.push([w, h - l]);
    addArc(w - r, h - r, 0, Math.PI / 2);
    addArc(r, h - r, Math.PI / 2, Math.PI);
    addArc(r, r, Math.PI, 1.5 * Math.PI);
    addArc(w - r, r, 1.5 * Math.PI, 2 * Math.PI);
    pts.push([w, l]);
  } else {
    pts.push([w, h]);
    addArc(r, h - r, Math.PI / 2, Math.PI);
    addArc(r, r, Math.PI, 1.5 * Math.PI);
    pts.push([w, 0]);
  }
  return pts;
}

function cwSquare(H: number, W: number, L: number, t: number): number {
  const a = H - t;
  const b = W - t;
  const c = Math.max(0, L - t / 2);
  const n =
    2 * a ** 3 * b +
    3 * a * a * b * b +
    48 * c ** 4 +
    112 * b * c ** 3 +
    8 * a * c ** 3 +
    48 * a * b * c * c +
    12 * a * a * c * c +
    12 * a * a * b * c +
    6 * a ** 3 * c;
  const d = 6 * a * a * b + (a + 2 * c) ** 3 - 24 * a * c * c;
  return (((t * a * a * b * b) / 12) * n) / d;
}

/**
 * Compute thin-walled open or closed section properties (AISI S100).
 */
export function computeSectionProperties(
  H: number,
  W: number,
  L: number,
  t: number,
  hw = 0.75,
  ri: number = 2 * t,
  shapeType: RackShapeType = 'c-lips',
): SectionProperties {
  assertFiniteRange(H, 'Section depth H', 0.75, 24);
  assertFiniteRange(W, 'Section flange W', 0.5, 16);
  assertFiniteRange(L, 'Section lip L', 0, H / 2);
  assertFiniteRange(t, 'Section thickness t', 0.02, 0.75);
  assertFiniteRange(hw, 'Web hole width hw', 0, H * 0.45);

  const isClosed = shapeType === 'closed-tube' || shapeType === 'step-beam';
  const effL = shapeType === 'c-channel' || shapeType === 'closed-tube' ? 0 : L;
  const pts = buildSectionPolyline(H, W, effL, t, ri, shapeType);

  let A = 0;
  let Sx0 = 0;
  let Sy0 = 0;
  const seg: [number, number, number, number, number][] = [];

  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    seg.push([x1, y1, x2, y2, segLen]);
    A += segLen * t;
    Sx0 += segLen * t * ((y1 + y2) / 2);
    Sy0 += segLen * t * ((x1 + x2) / 2);
  }

  const xc = Sy0 / A;
  const yc = Sx0 / A;
  let Ix = 0;
  let Iy = 0;
  let Ixy = 0;
  let J = 0;

  for (const [x1, y1, x2, y2, segLen] of seg) {
    const a = x1 - xc;
    const b = y1 - yc;
    const c = x2 - xc;
    const d = y2 - yc;
    Ix += (t * segLen * (b * b + b * d + d * d)) / 3;
    Iy += (t * segLen * (a * a + a * c + c * c)) / 3;
    Ixy += (t * segLen * (2 * a * b + a * d + c * b + 2 * c * d)) / 6;
    J += (segLen * t ** 3) / 3;
  }

  if (isClosed) {
    let twiceAm = 0;
    let perim = 0;
    for (const [x1, y1, x2, y2, segLen] of seg) {
      twiceAm += (x1 - xc) * (y2 - yc) - (x2 - xc) * (y1 - yc);
      perim += segLen;
    }
    const Am = Math.abs(twiceAm) / 2;
    J = (4 * Am * Am * t) / perim;
  }

  const w0: number[] = [0];
  for (const [x1, y1, x2, y2] of seg) {
    w0.push(w0[w0.length - 1]! + ((x1 - xc) * (y2 - yc) - (x2 - xc) * (y1 - yc)));
  }

  let Iwx = 0;
  let Iwy = 0;
  seg.forEach(([x1, y1, x2, y2, segLen], i) => {
    const a = x1 - xc;
    const b = y1 - yc;
    const c = x2 - xc;
    const d = y2 - yc;
    const p = w0[i]!;
    const q = w0[i + 1]!;
    Iwx += (t * segLen * (2 * p * b + p * d + q * b + 2 * q * d)) / 6;
    Iwy += (t * segLen * (2 * p * a + p * c + q * a + 2 * q * c)) / 6;
  });

  const den = Ix * Iy - Ixy * Ixy;
  const xs = isClosed ? 0 : (Iy * Iwx - Ixy * Iwy) / den;
  const ys = isClosed ? 0 : -(Ix * Iwy - Ixy * Iwx) / den;

  const wn: number[] = [0];
  for (const [x1, y1, x2, y2] of seg) {
    wn.push(
      wn[wn.length - 1]! + ((x1 - xc - xs) * (y2 - yc - ys) - (x2 - xc - xs) * (y1 - yc - ys)),
    );
  }

  let m = 0;
  seg.forEach(([, , , , segLen], i) => {
    m += (t * segLen * (wn[i]! + wn[i + 1]!)) / 2;
  });
  m /= A;

  let Cw = 0;
  seg.forEach(([, , , , segLen], i) => {
    const p = wn[i]! - m;
    const q = wn[i + 1]! - m;
    Cw += (t * segLen * (p * p + p * q + q * q)) / 3;
  });

  if (shapeType === 'c-lips' || shapeType === 'c-channel') {
    Cw = cwSquare(H, W, effL, t);
  }

  const yMax = Math.max(...pts.map((p) => p[1])) - yc + t / 2;
  const xMax = Math.max(...pts.map((p) => p[0])) - xc + t / 2;
  const xMin = xc + t / 2;

  const xo = xs;
  const rx = Math.sqrt(Ix / A);
  const ry = Math.sqrt(Iy / A);
  const ro = Math.sqrt(rx * rx + ry * ry + xo * xo);
  const beta = 1 - (xo / ro) ** 2;
  const Sx = Ix / yMax;
  const Syl = Iy / xMin;
  const Syr = Iy / xMax;
  const Anet = Math.max(0.05 * A, A - 2 * hw * t);

  return {
    shapeType,
    H,
    W,
    L: effL,
    t,
    hw,
    ri,
    rOut: ri + t,
    A,
    Anet,
    xc,
    yc,
    Ix,
    Sx,
    rx,
    Iy,
    Syl,
    Syr,
    ry,
    J,
    Cw,
    xo,
    ro,
    beta,
    weightPerFt: A * STEEL_DENSITY_LB_IN3 * 12,
  };
}

/**
 * Cold-work yield strength amplification Fya (AISI S100 A3.3.2).
 */
export function coldWorkFya(
  riIn: number,
  tIn: number,
  fyKsi: number,
  fuKsi: number,
  cornerRatioC: number,
): number {
  const ratio = riIn / tIn;
  if (ratio > 7 || fuKsi <= fyKsi) return fyKsi;
  const Bc = 3.69 * (fuKsi / fyKsi) - 0.819 * (fuKsi / fyKsi) ** 2 - 1.79;
  const m = 0.192 * (fuKsi / fyKsi) - 0.068;
  const Fyc = (Bc * fyKsi) / ratio ** m;
  return cornerRatioC * Fyc + (1 - cornerRatioC) * fyKsi;
}

/**
 * Evaluate shelf step-beam under LRFD 1.2D + 1.4P + Impact (RMI MH16.1 Sec. 5).
 */
export function evaluateBeamCheck(input: BeamCheckInput): BeamCheckResult {
  const selfWtLb = input.agIn2 * input.spanIn * STEEL_DENSITY_LB_IN3;
  const perBeam = input.loadLb / 2;
  const palletPerBeam = perBeam / 2;
  const Wu = (1.4 * (perBeam + 0.25 * palletPerBeam) + 1.2 * selfWtLb) / 1000;
  const Wserv = perBeam / 1000;

  const E = DEFAULT_E_KSI;
  const F = input.fixityKipInPerRad;
  const L = input.spanIn;
  const Ix = input.ixIn4;

  const rm = 1 - (2 * F * L) / (6 * E * Ix + 3 * F * L);
  const M0 = (Wu * L) / 8;
  const MuMidKipIn = M0 * rm;
  const MuEndKipIn = M0 * (1 - rm);
  const VuKip = Wu / 2;

  const arcLen = 0.5 * Math.PI * (input.riIn + input.thicknessIn / 2);
  const C = Math.min(0.45, (4 * arcLen) / (input.agIn2 / input.thicknessIn));
  const FyaKsi = coldWorkFya(input.riIn, input.thicknessIn, input.fyKsi, input.fuKsi, C);
  const phiMnKipIn = 0.9 * input.sxIn3 * FyaKsi;

  const hFlat = Math.max(0.5, input.heightIn - 2 * (input.riIn + input.thicknessIn));
  const Aw = hFlat * input.thicknessIn;
  const kv = 5.34;
  const slend = hFlat / input.thicknessIn;
  const lim1 = Math.sqrt((E * kv) / input.fyKsi);
  const lim2 = 1.51 * lim1;
  const Fv =
    slend <= lim1
      ? 0.6 * input.fyKsi
      : slend <= lim2
        ? (0.6 * Math.sqrt(E * kv * input.fyKsi)) / slend
        : (Math.PI ** 2 * E * kv) / (12 * (1 - 0.3 ** 2) * slend ** 2);
  const phiVnKip = 0.95 * Aw * Fv;

  const utilBending = MuMidKipIn / phiMnKipIn;
  const utilShear = VuKip / phiVnKip;

  const deltaSimple = (5 * Wserv * L ** 3) / (384 * E * Ix);
  const rd = 1 - (4 * F * L) / (5 * F * L + 10 * E * Ix);
  const deltaIn = deltaSimple * rd;
  const deflAllowIn = L / 180;
  const deflRatio = deltaIn / deflAllowIn;
  const controllingRatio = Math.max(utilBending, utilShear, deflRatio);

  return {
    selfWtLb,
    rm,
    MuMidKipIn,
    MuEndKipIn,
    VuKip,
    FyaKsi,
    phiMnKipIn,
    phiVnKip,
    utilBending,
    utilShear,
    deltaIn,
    deflAllowIn,
    deflRatio,
    controllingRatio,
    passes: controllingRatio <= 1.0,
  };
}

/**
 * Evaluate perforated upright column segment under axial + bending interaction (AISI S100 C4/C5).
 */
export function evaluateColumnCheck(input: ColumnCheckInput): ColumnCheckResult {
  const s = input.section;
  const E = DEFAULT_E_KSI;
  const G = DEFAULT_G_KSI;
  const KLx = Math.max(6, input.Kx * input.LxIn);
  const KLy = Math.max(6, input.Ky * input.LyIn);
  const KLt = Math.max(6, input.Kt * input.LtIn);

  const FexKsi = (Math.PI ** 2 * E) / (KLx / s.rx) ** 2;
  const FeyKsi = (Math.PI ** 2 * E) / (KLy / s.ry) ** 2;
  const FezKsi = (G * s.J + (Math.PI ** 2 * E * s.Cw) / KLt ** 2) / (s.A * s.ro ** 2);

  const sumFT = FexKsi + FezKsi;
  const disc = Math.max(0, sumFT ** 2 - 4 * s.beta * FexKsi * FezKsi);
  const FeFT = (sumFT - Math.sqrt(disc)) / (2 * s.beta);
  const FeKsi = Math.min(FeyKsi, FeFT);

  const lambdaC = Math.sqrt(input.fyKsi / FeKsi);
  const FnKsi =
    lambdaC <= 1.5 ? 0.658 ** (lambdaC ** 2) * input.fyKsi : (0.877 / lambdaC ** 2) * input.fyKsi;

  const qFactor = s.Anet / s.A;
  const AeIn2 = (1 - (1 - qFactor) * (FnKsi / input.fyKsi) ** qFactor) * s.Anet;
  const phiPnKip = 0.85 * AeIn2 * FnKsi;
  const phiPnYield = 0.85 * AeIn2 * input.fyKsi;

  const Pex = (Math.PI ** 2 * E * s.Ix) / KLx ** 2;
  const alphaX = Math.max(0.1, 1 - input.PuKip / Pex);
  const phiMny = 0.9 * Math.min(s.Syl, s.Syr) * input.fyKsi;
  const bendRatioY = input.MuYKipIn > 0 ? input.MuYKipIn / phiMny : 0;

  const ratio1 = input.PuKip / phiPnKip + bendRatioY;
  const ratio2 = input.PuKip / phiPnYield + bendRatioY;
  const controllingRatio = Math.max(ratio1, ratio2);

  return {
    PuKip: input.PuKip,
    FexKsi,
    FeyKsi,
    FezKsi,
    FeKsi,
    FnKsi,
    AeIn2,
    phiPnKip,
    alphaX,
    ratio1,
    ratio2,
    controllingRatio,
    passes: controllingRatio <= 1.0,
  };
}

/**
 * Evaluate a full rack bay configuration across all shelf levels and upright column segments.
 */
export function evaluateRackBay(input: RackBayEvaluationInput): RackBayEvaluationResult {
  const beamFy = input.beamFyKsi ?? 50;
  const beamFu = input.beamFuKsi ?? 65;
  const colFy = input.columnFyKsi ?? 55;
  const fixity = input.fixityKipInPerRad ?? 300;
  const Kx = input.Kx ?? 1.7;
  const Ky = input.Ky ?? 1.0;
  const Kt = input.Kt ?? 0.8;
  const bracingStyle = input.bracingStyle ?? 'z-pattern';
  const frameStyle = input.frameStyle ?? 'standard';
  const isTunnel = input.tunnelBay ?? false;

  const beamCheck = evaluateBeamCheck({
    loadLb: input.levelLoadLb,
    spanIn: input.bayWidthIn,
    fixityKipInPerRad: fixity,
    heightIn: input.beamSection.H,
    thicknessIn: input.beamSection.t,
    riIn: input.beamSection.ri,
    agIn2: input.beamSection.A,
    ixIn4: input.beamSection.Ix,
    sxIn3: input.beamSection.Sx,
    fyKsi: beamFy,
    fuKsi: beamFu,
  });

  const sortedElevs = [...input.levelElevationsIn].sort((a, b) => a - b);
  const numLevels = Math.max(1, sortedElevs.length);
  const firstElevIn = sortedElevs[0] ?? 56;
  const bottomSpanIn = Math.max(18, firstElevIn - input.beamSection.H / 2);
  const effectiveBottomLx = isTunnel ? bottomSpanIn * 1.35 : bottomSpanIn;

  const braceMult =
    bracingStyle === 'x-pattern'
      ? 0.85
      : bracingStyle === 'k-pattern'
        ? 0.9
        : bracingStyle === 'd-pattern'
          ? 1.08
          : 1.0;
  const LyIn = Math.min(bottomSpanIn, input.bracePitchIn) * braceMult;
  const LtIn = Math.min(bottomSpanIn, input.bracePitchIn) * braceMult;

  const colDeadLb = input.columnSection.A * input.frameHeightIn * STEEL_DENSITY_LB_IN3;
  const PuKip =
    (numLevels * (1.4 * (input.levelLoadLb / 2) + 1.2 * beamCheck.selfWtLb) + 1.2 * colDeadLb) /
    1000;
  const MuYKipIn = frameStyle === 'standard' ? 0 : PuKip * 0.72;

  const bottomColumnCheck = evaluateColumnCheck({
    PuKip,
    MuYKipIn,
    LxIn: effectiveBottomLx,
    LyIn,
    LtIn,
    Kx,
    Ky,
    Kt,
    section: input.columnSection,
    fyKsi: colFy,
  });

  const maxColumnRatio = bottomColumnCheck.controllingRatio;
  const maxBeamRatio = beamCheck.controllingRatio;
  const stabilityB2 = Math.min(2.5, 1 / Math.max(0.4, bottomColumnCheck.alphaX));
  const stabilityRatio = stabilityB2 / 1.7;
  const overallControllingRatio = Math.max(maxColumnRatio, maxBeamRatio, stabilityRatio);

  const frameWeightLb = 2 * colDeadLb + 42;
  const beamsWeightLb = numLevels * 2 * beamCheck.selfWtLb;
  const estimatedBayWeightLb = frameWeightLb + beamsWeightLb;

  return {
    beamCheck,
    bottomColumnCheck,
    maxColumnRatio,
    maxBeamRatio,
    stabilityB2,
    stabilityRatio,
    overallControllingRatio,
    estimatedBayWeightLb,
    passesAll: overallControllingRatio <= 1.0,
  };
}

/**
 * Rank candidate upright column sections by lightest steel weight and return the
 * lightest section that passes all RMI MH16.1 / AISI S100 checks.
 */
export function smartSolveRackBay(
  input: Omit<RackBayEvaluationInput, 'columnSection'>,
): {
  readonly recommended: SmartSolveCandidate;
  readonly candidates: readonly SmartSolveCandidate[];
} {
  const candidateSpecs: readonly {
    readonly label: string;
    readonly gage: string;
    readonly H: number;
    readonly W: number;
    readonly L: number;
    readonly t: number;
  }[] = [
    { label: '3.0×3.0×16ga Teardrop', gage: '16ga', H: 3.0, W: 3.0, L: 0.75, t: 0.0598 },
    { label: '3.0×3.0×14ga Teardrop', gage: '14ga', H: 3.0, W: 3.0, L: 0.75, t: 0.0747 },
    { label: '3.0×3.0×13ga Teardrop', gage: '13ga', H: 3.0, W: 3.0, L: 0.75, t: 0.0897 },
    { label: '3.0×3.0×12ga Teardrop', gage: '12ga', H: 3.0, W: 3.0, L: 0.75, t: 0.1046 },
    { label: '3.0×4.0×12ga Heavy', gage: '12ga', H: 3.0, W: 4.0, L: 0.75, t: 0.1046 },
    { label: '4.0×4.0×10ga Super-Duty', gage: '10ga', H: 4.0, W: 4.0, L: 0.875, t: 0.1345 },
  ];

  const evaluated: SmartSolveCandidate[] = candidateSpecs.map((spec) => {
    const sec = computeSectionProperties(spec.H, spec.W, spec.L, spec.t, 0.75, 2 * spec.t, 'c-lips');
    const res = evaluateRackBay({
      ...input,
      columnSection: sec,
    });
    return {
      ...spec,
      section: sec,
      maxColumnRatio: res.maxColumnRatio,
      estimatedBayWeightLb: res.estimatedBayWeightLb,
      passes: res.maxColumnRatio <= 0.98 && res.passesAll,
    };
  });

  const firstPassing = evaluated.find((c) => c.passes) ?? evaluated[evaluated.length - 1]!;
  return {
    recommended: firstPassing,
    candidates: evaluated,
  };
}
