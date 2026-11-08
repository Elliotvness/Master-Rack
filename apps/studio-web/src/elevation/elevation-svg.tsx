/**
 * Inline SVG renderer for `buildElevation` display lists — build-plan **S3.3**.
 *
 * **One display list, three renderers (ADR-003):** this component consumes a
 * `DisplayList` produced by `buildElevation` and renders it as inline `<svg>`
 * with one uniform scale on both axes (`preserveAspectRatio="xMidYMid meet"`).
 *
 * It performs **no domain arithmetic and no number formatting** — every string
 * rendered on the drawing arrives as a `DisplayText` (`{ text, established }`)
 * from `@rms/display-list`, so any unestablished datum prints `VERIFY` (AC-07).
 */

import { buildElevation, type DisplayList } from '@rms/display-list';
import { poundsPerPair } from '@rms/kernel-units';
import {
  bayTypeForRun,
  length,
  runGeometry,
  witnessedQuantity,
  type StudioDocument,
} from '@rms/studio-model';
import { useMemo } from 'react';

const UM_PER_INCH = 25_400;

/**
 * Snap a raw elevation in inches to a valid roll-formed teardrop or structural
 * punch pitch (e.g., 2" or 3" increments).
 */
export function snapToPitchInches(rawInches: number, pitchInches = 2): number {
  const pitch = Number.isFinite(pitchInches) && pitchInches > 0 ? pitchInches : 2;
  const snapped = Math.round(rawInches / pitch) * pitch;
  return Math.max(pitch * 6, snapped);
}

/**
 * Resolve the physical beam profile face height (in inches) from the selected
 * beam part label (e.g., "B-40-96" -> 4.0", "IB55..." -> 5.5", default 4.0").
 */
export function beamFaceHeightInFromPart(beamPart: string): number {
  const m = /(?:IB|B-)(\d{2})\b/i.exec(beamPart);
  if (m !== null && m[1] !== undefined) {
    const code = Number(m[1]);
    if (Number.isFinite(code) && code >= 25 && code <= 80) {
      return code / 10;
    }
  }
  return 4.0;
}

export interface ElevationLevelClearance {
  readonly levelIndex: number; // -1 for slab, 0..N-1 for beam levels
  readonly levelId: string;
  readonly label: string;
  readonly tobInches: number;
  readonly tobUm: number;
  readonly beamBottomInches: number;
  readonly loadHeightInches: number;
  readonly loadTopInches: number;
  readonly nextObstacleBottomInches: number;
  readonly nextObstacleLabel: string;
  readonly liftOffClearanceInches: number;
  readonly minLiftOffInches: number;
  readonly isLiftOffClash: boolean;
  readonly isCeilingClash: boolean;
  readonly isDeflectorClash: boolean;
}

export function computeElevationClearances(
  doc: StudioDocument,
  options?: {
    readonly beamFaceIn?: number;
    readonly minLiftOffIn?: number;
  },
): readonly ElevationLevelClearance[] {
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];
  if (bt === undefined) return [];

  const beamFaceIn = options?.beamFaceIn ?? beamFaceHeightInFromPart(bt.beamPart);
  const minLiftOffIn = options?.minLiftOffIn ?? 4;
  const loadHeightIn = Math.round((doc.unitLoad.height / UM_PER_INCH) * 10) / 10;
  const clearHeightIn = Math.round((doc.building.clearHeight.value / UM_PER_INCH) * 10) / 10;
  const deflectorIn = Math.round((doc.building.deflectorElev.value / UM_PER_INCH) * 10) / 10;

  const results: ElevationLevelClearance[] = [];

  if (run?.floorStorage ?? true) {
    const firstBeamTobIn =
      bt.beamLevels[0] !== undefined
        ? Math.round((bt.beamLevels[0] / UM_PER_INCH) * 10) / 10
        : clearHeightIn;
    const nextBottomIn =
      bt.beamLevels[0] !== undefined ? firstBeamTobIn - beamFaceIn : clearHeightIn;
    const loadTopIn = loadHeightIn;
    const clearanceIn = Math.round((nextBottomIn - loadTopIn) * 10) / 10;

    results.push({
      levelIndex: -1,
      levelId: 'slab-L0',
      label: 'Slab (L0)',
      tobInches: 0,
      tobUm: 0,
      beamBottomInches: 0,
      loadHeightInches: loadHeightIn,
      loadTopInches: loadTopIn,
      nextObstacleBottomInches: nextBottomIn,
      nextObstacleLabel: bt.beamLevels[0] !== undefined ? 'L1 B.O.B.' : 'Clear Height',
      liftOffClearanceInches: clearanceIn,
      minLiftOffInches: minLiftOffIn,
      isLiftOffClash: clearanceIn < minLiftOffIn,
      isCeilingClash: loadTopIn > clearHeightIn,
      isDeflectorClash: loadTopIn > deflectorIn - 18,
    });
  }

  bt.beamLevels.forEach((elevUm, idx) => {
    const tobIn = Math.round((elevUm / UM_PER_INCH) * 10) / 10;
    const beamBottomIn = Math.round((tobIn - beamFaceIn) * 10) / 10;
    const loadTopIn = Math.round((tobIn + loadHeightIn) * 10) / 10;
    const nextBeamUm = bt.beamLevels[idx + 1];
    const nextBottomIn =
      nextBeamUm !== undefined
        ? Math.round((nextBeamUm / UM_PER_INCH - beamFaceIn) * 10) / 10
        : clearHeightIn;
    const nextLabel = nextBeamUm !== undefined ? `L${idx + 2} B.O.B.` : 'Clear Height';
    const clearanceIn = Math.round((nextBottomIn - loadTopIn) * 10) / 10;

    results.push({
      levelIndex: idx,
      levelId: `L${idx + 1}`,
      label: `L${idx + 1}`,
      tobInches: tobIn,
      tobUm: elevUm,
      beamBottomInches: beamBottomIn,
      loadHeightInches: loadHeightIn,
      loadTopInches: loadTopIn,
      nextObstacleBottomInches: nextBottomIn,
      nextObstacleLabel: nextLabel,
      liftOffClearanceInches: clearanceIn,
      minLiftOffInches: minLiftOffIn,
      isLiftOffClash: clearanceIn < minLiftOffIn,
      isCeilingClash: tobIn > clearHeightIn || loadTopIn > clearHeightIn,
      isDeflectorClash: loadTopIn > deflectorIn - 18,
    });
  });

  return results;
}

export function renderElevationCanvas(
  ctx: CanvasRenderingContext2D,
  doc: StudioDocument,
  options?: {
    readonly showLoads?: boolean;
    readonly beamFaceIn?: number;
    readonly minLiftOffIn?: number;
    readonly activeDragIndex?: number | null;
  },
): void {
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];
  if (bt === undefined) return;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);

  const clearHeightIn = doc.building.clearHeight.value / UM_PER_INCH;
  const deflectorIn = doc.building.deflectorElev.value / UM_PER_INCH;
  const frameHeightIn = bt.frameHeight.value / UM_PER_INCH;
  const bayWidthIn = bt.beamLength / UM_PER_INCH;
  const loadHeightIn = doc.unitLoad.height / UM_PER_INCH;
  const loadWidthIn = doc.unitLoad.palletW / UM_PER_INCH;
  const beamFaceIn = options?.beamFaceIn ?? beamFaceHeightInFromPart(bt.beamPart);
  const minLiftOffIn = options?.minLiftOffIn ?? 4;
  const showLoads = options?.showLoads ?? true;

  const maxVertIn = Math.max(clearHeightIn + 36, frameHeightIn + 60, 320);
  const floorY = height - 48;
  const scale = Math.max(1.1, (floorY - 36) / maxVertIn);
  const frameLeftX = 90;
  const frameWidth = Math.max(180, bayWidthIn * scale * 1.6);
  const frameRightX = frameLeftX + frameWidth;

  // 1. Concrete Slab
  ctx.fillStyle = '#3f3f46';
  ctx.fillRect(24, floorY, width - 48, 12);

  // 2. Ceiling Limit (Clear Height) & Sprinkler Deflector
  const ceilingY = floorY - clearHeightIn * scale;
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(24, ceilingY);
  ctx.lineTo(width - 24, ceilingY);
  ctx.stroke();

  const deflectorY = floorY - deflectorIn * scale;
  ctx.strokeStyle = '#dfa33f';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(24, deflectorY);
  ctx.lineTo(width - 24, deflectorY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Upright Diagonal Bracing (Lacing panels every 48")
  const panelHeightPx = 48 * scale;
  const numPanels = Math.max(1, Math.floor(frameHeightIn / 48));
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  const braceSpanPx = Math.min(28, frameWidth * 0.14);
  for (let i = 0; i < numPanels; i += 1) {
    const y1 = floorY - i * panelHeightPx;
    const y2 = floorY - (i + 1) * panelHeightPx;
    // Left column lacing
    ctx.moveTo(frameLeftX, y1);
    ctx.lineTo(frameLeftX + braceSpanPx, y2);
    ctx.moveTo(frameLeftX, y2);
    ctx.lineTo(frameLeftX + braceSpanPx, y2);
    // Right column lacing
    ctx.moveTo(frameRightX - braceSpanPx, y1);
    ctx.lineTo(frameRightX, y2);
    ctx.moveTo(frameRightX - braceSpanPx, y2);
    ctx.lineTo(frameRightX, y2);
  }
  ctx.stroke();

  // Main Upright Columns
  const frameTopY = floorY - frameHeightIn * scale;
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(frameLeftX, floorY);
  ctx.lineTo(frameLeftX, frameTopY);
  ctx.moveTo(frameRightX, floorY);
  ctx.lineTo(frameRightX, frameTopY);
  ctx.stroke();

  // 4. Beams with Physical Face Thickness + Ghosted Pallet Loads + Clash Detection
  const beamHeightPx = Math.max(4, beamFaceIn * scale);
  const palletsPerBay = Math.max(1, bt.palletsPerBay);
  const singleLoadW = Math.min(
    (frameWidth - (palletsPerBay + 1) * 10) / palletsPerBay,
    loadWidthIn * scale * 1.4,
  );
  const loadHeightPx = loadHeightIn * scale;

  bt.beamLevels.forEach((elevUm, idx) => {
    const elevIn = elevUm / UM_PER_INCH;
    const beamTopY = floorY - elevIn * scale;
    const isCeilingClash = elevIn > clearHeightIn || elevIn + loadHeightIn > clearHeightIn;

    ctx.fillStyle = isCeilingClash
      ? '#ef4444'
      : options?.activeDragIndex === idx
        ? '#f97316'
        : '#ea580c';
    ctx.fillRect(frameLeftX, beamTopY, frameWidth, beamHeightPx);

    if (showLoads) {
      const loadY = beamTopY - loadHeightPx;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = isCeilingClash ? '#ef4444' : '#52525b';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      for (let p = 0; p < palletsPerBay; p += 1) {
        const lx =
          frameLeftX +
          (frameWidth - palletsPerBay * singleLoadW) / (palletsPerBay + 1) * (p + 1) +
          p * singleLoadW;
        ctx.fillRect(lx, loadY, singleLoadW, loadHeightPx);
        ctx.strokeRect(lx, loadY, singleLoadW, loadHeightPx);
      }
      ctx.setLineDash([]);

      // Lift-off clash detection against next beam bottom or clear height
      const nextElevIn =
        bt.beamLevels[idx + 1] !== undefined
          ? bt.beamLevels[idx + 1]! / UM_PER_INCH - beamFaceIn
          : clearHeightIn;
      const actualClearanceIn = nextElevIn - (elevIn + loadHeightIn);
      if (actualClearanceIn < minLiftOffIn) {
        const gapHeightPx = Math.max(6, Math.abs(actualClearanceIn) * scale);
        ctx.fillStyle = 'rgba(234, 88, 12, 0.32)';
        ctx.fillRect(frameLeftX + 4, loadY - gapHeightPx, frameWidth - 8, gapHeightPx);
      }
    }
  });

  // 5. Professional CAD Dimension Chain & Extension Ticks
  const dimX = frameRightX + 42;
  ctx.strokeStyle = '#71717a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dimX, floorY);
  ctx.lineTo(dimX, ceilingY);
  ctx.stroke();

  bt.beamLevels.forEach((elevUm) => {
    const elevIn = elevUm / UM_PER_INCH;
    const beamTopY = floorY - elevIn * scale;
    ctx.beginPath();
    ctx.moveTo(frameRightX + 6, beamTopY);
    ctx.lineTo(dimX + 14, beamTopY);
    // 45-degree CAD architectural tick
    ctx.moveTo(dimX - 4, beamTopY + 4);
    ctx.lineTo(dimX + 4, beamTopY - 4);
    ctx.stroke();

    ctx.fillStyle = '#e4e4e7';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${elevIn.toFixed(2)}"`, dimX + 18, beamTopY - 2);
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '10px "Inter", sans-serif';
    ctx.fillText('T.O.B.', dimX + 68, beamTopY - 2);
  });
}

export function buildDocumentElevation(doc: StudioDocument): DisplayList {
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];
  if (run === undefined || bt === undefined) {
    return {
      view: 'elevation',
      extent: { width: 2_590_800, height: 6_096_000 },
      items: [],
      revisionHash: `doc:${doc.id}:${doc.revision}`,
    };
  }

  const g = runGeometry(doc, run);
  const loadQty =
    bt.beamPairCapacity.established === 'UNKNOWN'
      ? null
      : poundsPerPair(bt.beamPairCapacity.value, bt.beamPairCapacity.established);

  return buildElevation({
    revisionHash: `doc:${doc.id}:${doc.revision}`,
    runId: run.id,
    frameHeight: witnessedQuantity(bt.frameHeight),
    bayPitch: g.bayPitch,
    levels: bt.beamLevels.map((elevUm, idx) => ({
      levelId: `${run.id}:L${idx + 1}`,
      elevation: length(elevUm, 'INPUT'),
      load: loadQty,
    })),
    references: [
      {
        id: 'clear-height',
        label: 'Clear height',
        elevation:
          doc.building.clearHeight.established === 'UNKNOWN'
            ? null
            : witnessedQuantity(doc.building.clearHeight),
      },
      {
        id: 'deflector',
        label: 'Sprinkler deflector',
        elevation:
          doc.building.deflectorElev.established === 'UNKNOWN'
            ? null
            : witnessedQuantity(doc.building.deflectorElev),
      },
    ],
    floorStorage: run.floorStorage
      ? {
          height: length(doc.unitLoad.height, 'INPUT'),
          depth: length(doc.unitLoad.palletD, 'INPUT'),
        }
      : null,
  });
}

export function ElevationSvg({
  document: doc,
  id = 'elevsvg',
  showLoads = true,
  beamFaceIn,
  minLiftOffIn = 4,
  activeDragIndex = null,
  onBeamPointerDown,
  onDimensionLabelClick,
  onCeilingLabelClick,
}: {
  readonly document: StudioDocument;
  readonly id?: string;
  readonly showLoads?: boolean;
  readonly beamFaceIn?: number;
  readonly minLiftOffIn?: number;
  readonly activeDragIndex?: number | null;
  readonly onBeamPointerDown?: (index: number, e: React.PointerEvent<SVGElement>) => void;
  readonly onDimensionLabelClick?: (index: number) => void;
  readonly onCeilingLabelClick?: (datum: 'clear-height' | 'deflector') => void;
}): React.JSX.Element {
  const list = useMemo(() => buildDocumentElevation(doc), [doc]);
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];

  const resolvedBeamFaceIn = beamFaceIn ?? (bt !== undefined ? beamFaceHeightInFromPart(bt.beamPart) : 4);
  const beamFaceUm = Math.round(resolvedBeamFaceIn * UM_PER_INCH);
  const clearances = useMemo(
    () =>
      computeElevationClearances(doc, {
        beamFaceIn: resolvedBeamFaceIn,
        minLiftOffIn,
      }),
    [doc, resolvedBeamFaceIn, minLiftOffIn],
  );

  // Model coordinates are integer micrometres with y=0 at the slab.
  // SVG viewBox uses micrometres directly so X and Y share the exact same scale.
  const padLeft = 1_200_000;
  const padRight = 3_400_000;
  const padTop = 1_500_000;
  const padBottom = 750_000;

  const vbX = -padLeft;
  const vbY = -padTop;
  const vbW = list.extent.width + padLeft + padRight;
  const vbH = list.extent.height + padTop + padBottom;

  const flipY = (modelY: number): number => list.extent.height - modelY;
  const fontSize = 110_000;
  const strokeW = 22_000;

  const frameHeightUm = bt?.frameHeight.value ?? list.extent.height;
  const clearHeightUm = doc.building.clearHeight.value;
  const deflectorUm = doc.building.deflectorElev.value;
  const panelPitchUm = 48 * UM_PER_INCH;
  const bracePanelCount = Math.max(1, Math.floor(frameHeightUm / panelPitchUm));
  const postChannelWidthUm = Math.min(260_000, Math.round(list.extent.width * 0.1));
  const cadDimX = list.extent.width + 520_000;

  return (
    <svg
      id={id}
      className="elevation-svg"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Bay elevation drawing for ${doc.name}`}
    >
      {/* 1. Concrete Slab Block & Datum */}
      <rect
        id={`${id}-concrete-slab`}
        className="elev-slab-block"
        x={-padLeft / 2}
        y={flipY(0)}
        width={list.extent.width + padLeft / 2 + padRight / 2}
        height={180_000}
      />
      <line
        className="elev-slab"
        x1={-padLeft / 2}
        y1={flipY(0)}
        x2={list.extent.width + padRight / 2}
        y2={flipY(0)}
        strokeWidth={strokeW * 1.5}
      />
      <text
        className="elev-text elev-slab-label"
        x={-padLeft / 2 + 40_000}
        y={flipY(-320_000)}
        fontSize={fontSize * 0.85}
      >
        0.00&quot; SLAB DATUM (F.F.E.)
      </text>

      {/* 2. Ceiling Limit (Clear Height) & Sprinkler Deflector Dashed Lines */}
      <g id={`${id}-ceiling-group`} className="elev-ceiling-group">
        <line
          id={`${id}-ceiling-limit-line`}
          className="elev-ceiling-line"
          data-ceiling-elev-in={Math.round(clearHeightUm / UM_PER_INCH)}
          x1={-padLeft / 2}
          y1={flipY(clearHeightUm)}
          x2={list.extent.width + padRight / 2}
          y2={flipY(clearHeightUm)}
          strokeWidth={strokeW * 1.4}
          strokeDasharray={`${strokeW * 5} ${strokeW * 3}`}
        />
        <text
          className="elev-text elev-ceiling-label"
          x={-padLeft / 2 + 40_000}
          y={flipY(clearHeightUm) - 55_000}
          fontSize={fontSize * 0.85}
          onClick={() => onCeilingLabelClick?.('clear-height')}
        >
          CEILING LIMIT ({Math.round(clearHeightUm / UM_PER_INCH)}&quot; CLEAR HEIGHT{' '}
          {doc.building.clearHeight.established === 'UNKNOWN' ? '· VERIFY' : '· VERIFIED'})
        </text>

        <line
          id={`${id}-deflector-limit-line`}
          className="elev-deflector-line"
          data-deflector-elev-in={Math.round(deflectorUm / UM_PER_INCH)}
          x1={-padLeft / 2}
          y1={flipY(deflectorUm)}
          x2={list.extent.width + padRight / 2}
          y2={flipY(deflectorUm)}
          strokeWidth={strokeW}
          strokeDasharray={`${strokeW * 3} ${strokeW * 2}`}
        />
      </g>

      {/* 3. Upright Diagonal & Horizontal Bracing (Zig-Zag Lacing Struts) */}
      <g id={`${id}-upright-bracing`} className="elev-bracing-group" data-bracing="diagonal">
        <line
          className="elev-bracing-post-inner"
          x1={postChannelWidthUm}
          y1={flipY(0)}
          x2={postChannelWidthUm}
          y2={flipY(frameHeightUm)}
          strokeWidth={strokeW}
        />
        <line
          className="elev-bracing-post-inner"
          x1={list.extent.width - postChannelWidthUm}
          y1={flipY(0)}
          x2={list.extent.width - postChannelWidthUm}
          y2={flipY(frameHeightUm)}
          strokeWidth={strokeW}
        />
        {Array.from({ length: bracePanelCount }).map((_, pIdx) => {
          const yStart = pIdx * panelPitchUm;
          const yEnd = Math.min(frameHeightUm, (pIdx + 1) * panelPitchUm);
          const leftFromX = pIdx % 2 === 0 ? 0 : postChannelWidthUm;
          const leftToX = pIdx % 2 === 0 ? postChannelWidthUm : 0;
          const rightFromX =
            pIdx % 2 === 0 ? list.extent.width - postChannelWidthUm : list.extent.width;
          const rightToX =
            pIdx % 2 === 0 ? list.extent.width : list.extent.width - postChannelWidthUm;
          return (
            <g key={`brace-${pIdx}`}>
              <line
                className="elev-bracing-strut"
                data-bracing-strut={`left-${pIdx}`}
                x1={leftFromX}
                y1={flipY(yStart)}
                x2={leftToX}
                y2={flipY(yEnd)}
                strokeWidth={strokeW * 0.9}
              />
              <line
                className="elev-bracing-strut"
                x1={0}
                y1={flipY(yEnd)}
                x2={postChannelWidthUm}
                y2={flipY(yEnd)}
                strokeWidth={strokeW * 0.85}
              />
              <line
                className="elev-bracing-strut"
                data-bracing-strut={`right-${pIdx}`}
                x1={rightFromX}
                y1={flipY(yStart)}
                x2={rightToX}
                y2={flipY(yEnd)}
                strokeWidth={strokeW * 0.9}
              />
              <line
                className="elev-bracing-strut"
                x1={list.extent.width - postChannelWidthUm}
                y1={flipY(yEnd)}
                x2={list.extent.width}
                y2={flipY(yEnd)}
                strokeWidth={strokeW * 0.85}
              />
            </g>
          );
        })}
      </g>

      {/* 4. Physical Beam Face Thickness Rectangles + Ghosted Pallet Loads + Clash Detection */}
      {bt !== undefined &&
        bt.beamLevels.map((elevUm, idx) => {
          const levelClearance = clearances.find((c) => c.levelIndex === idx);
          const isLiftOffClash = levelClearance?.isLiftOffClash ?? false;
          const isCeilingClash = levelClearance?.isCeilingClash ?? false;
          const isDragging = activeDragIndex === idx;
          const palletsCount = Math.max(1, bt.palletsPerBay);
          const loadW = doc.unitLoad.palletW;
          const loadH = doc.unitLoad.height;
          const gapTotal = Math.max(
            0,
            list.extent.width - postChannelWidthUm * 2 - palletsCount * loadW,
          );
          const bayGap = gapTotal / (palletsCount + 1);
          const nextObstacleBottomUm =
            bt.beamLevels[idx + 1] !== undefined
              ? bt.beamLevels[idx + 1]! - beamFaceUm
              : clearHeightUm;
          const loadTopUm = elevUm + loadH;
          const clearanceUm = nextObstacleBottomUm - loadTopUm;

          return (
            <g key={`beam-assembly-${idx}`} data-beam-assembly={idx}>
              {/* Physical Step-Beam Face Rectangle (extends down from T.O.B. by beamFaceUm) */}
              <rect
                className={
                  isCeilingClash
                    ? 'elev-beam-face elev-beam-face-clash'
                    : isDragging
                      ? 'elev-beam-face elev-beam-face-dragging'
                      : 'elev-beam-face'
                }
                data-beam-face-index={idx}
                data-beam-face-in={resolvedBeamFaceIn}
                x={0}
                y={flipY(elevUm)}
                width={list.extent.width}
                height={beamFaceUm}
                onPointerDown={
                  onBeamPointerDown !== undefined ? (e) => onBeamPointerDown(idx, e) : undefined
                }
              />

              {/* Ghosted Pallet Loads sitting on T.O.B. */}
              {showLoads &&
                Array.from({ length: palletsCount }).map((_, pIdx) => {
                  const palletX =
                    postChannelWidthUm + bayGap * (pIdx + 1) + pIdx * loadW;
                  return (
                    <rect
                      key={`ghost-load-${idx}-${pIdx}`}
                      className={
                        isCeilingClash
                          ? 'elev-ghost-load elev-ghost-load-clash'
                          : 'elev-ghost-load'
                      }
                      data-ghost-load-level={idx}
                      x={palletX}
                      y={flipY(elevUm + loadH)}
                      width={loadW}
                      height={loadH}
                      strokeWidth={strokeW * 0.9}
                      strokeDasharray={`${strokeW * 3} ${strokeW * 2}`}
                    />
                  );
                })}

              {/* Dynamic Lift-Off Clearance Zone & Clash Highlight */}
              {showLoads && (
                <g
                  className="elev-liftoff-group"
                  data-liftoff-level={idx}
                  data-liftoff-clash={isLiftOffClash ? 'true' : 'false'}
                >
                  <rect
                    className={
                      isLiftOffClash ? 'elev-liftoff-clash-rect' : 'elev-liftoff-ok-rect'
                    }
                    x={postChannelWidthUm}
                    y={flipY(Math.max(loadTopUm, nextObstacleBottomUm))}
                    width={Math.max(200_000, list.extent.width - postChannelWidthUm * 2)}
                    height={Math.max(90_000, Math.abs(clearanceUm))}
                  />
                  <text
                    className={
                      isLiftOffClash
                        ? 'elev-text elev-liftoff-clash-text'
                        : 'elev-text elev-liftoff-ok-text'
                    }
                    x={list.extent.width / 2}
                    y={flipY((loadTopUm + nextObstacleBottomUm) / 2) + 32_000}
                    fontSize={fontSize * 0.78}
                    textAnchor="middle"
                  >
                    {isLiftOffClash
                      ? `CLASH: ${(levelClearance?.liftOffClearanceInches ?? 0).toFixed(1)}" LIFT-OFF (< ${minLiftOffIn}" MIN)`
                      : `${(levelClearance?.liftOffClearanceInches ?? 0).toFixed(1)}" LIFT-OFF CLEAR`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

      {/* 5. Professional CAD Vertical Dimension Chain, Extension Lines, Ticks & T.O.B. Labels */}
      {bt !== undefined && (
        <g id={`${id}-cad-dim-chain`} className="elev-cad-dim-chain">
          <line
            className="elev-cad-chain-line"
            x1={cadDimX}
            y1={flipY(0)}
            x2={cadDimX}
            y2={flipY(Math.max(frameHeightUm, clearHeightUm))}
            strokeWidth={strokeW * 0.9}
          />
          {/* Base slab tick */}
          <line
            className="elev-cad-tick"
            x1={cadDimX - 70_000}
            y1={flipY(0) + 70_000}
            x2={cadDimX + 70_000}
            y2={flipY(0) - 70_000}
            strokeWidth={strokeW}
          />
          {bt.beamLevels.map((elevUm, idx) => {
            const elevIn = elevUm / UM_PER_INCH;
            const ySvg = flipY(elevUm);
            return (
              <g
                key={`cad-tob-${idx}`}
                className="elev-cad-tob-callout"
                data-cad-tob-index={idx}
                onClick={
                  onDimensionLabelClick !== undefined
                    ? () => onDimensionLabelClick(idx)
                    : undefined
                }
              >
                {/* Extension line from upright to CAD dimension chain */}
                <line
                  className="elev-cad-ext-line"
                  x1={list.extent.width + 45_000}
                  y1={ySvg}
                  x2={cadDimX + 140_000}
                  y2={ySvg}
                  strokeWidth={strokeW * 0.8}
                />
                {/* 45-degree architectural tick at intersection */}
                <line
                  className="elev-cad-tick"
                  x1={cadDimX - 70_000}
                  y1={ySvg + 70_000}
                  x2={cadDimX + 70_000}
                  y2={ySvg - 70_000}
                  strokeWidth={strokeW * 1.1}
                />
                {/* Explicit T.O.B. Dimension Callout */}
                <text
                  className="elev-text elev-cad-tob-text"
                  x={cadDimX + 180_000}
                  y={ySvg - 35_000}
                  fontSize={fontSize * 0.9}
                >
                  {elevIn.toFixed(2)}&quot; T.O.B. (L{idx + 1})
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* 6. Canonical DisplayList Items (preserves ADR-003 & AC-07 VERIFY text) */}
      {list.items.map((item) => {
        if (item.kind === 'line') {
          return (
            <line
              key={item.id}
              data-item-id={item.id}
              data-item-kind={item.item}
              className={`elev-line elev-line-${item.item}`}
              x1={item.from.x}
              y1={flipY(item.from.y)}
              x2={item.to.x}
              y2={flipY(item.to.y)}
              strokeWidth={item.item === 'upright' || item.item === 'beam' ? strokeW * 2 : strokeW}
              strokeDasharray={item.item === 'reference' ? `${strokeW * 4} ${strokeW * 2}` : undefined}
            />
          );
        }

        if (item.kind === 'rect') {
          const topY = flipY(item.origin.y + item.height);
          return (
            <g key={item.id} data-item-id={item.id} data-item-kind={item.item}>
              <rect
                className={`elev-rect elev-rect-${item.item}`}
                x={item.origin.x}
                y={topY}
                width={item.width}
                height={item.height}
                strokeWidth={strokeW}
                strokeDasharray={
                  item.item === 'unit-load' ? `${strokeW * 3} ${strokeW * 2}` : undefined
                }
              />
              {item.label !== null && (
                <text
                  className={
                    item.label.established ? 'elev-text' : 'elev-text elev-text-unestablished'
                  }
                  data-established={item.label.established}
                  x={item.origin.x + item.width / 2}
                  y={topY + item.height / 2}
                  fontSize={fontSize}
                  textAnchor="middle"
                >
                  {item.label.text}
                </text>
              )}
            </g>
          );
        }

        if (item.kind === 'dimension') {
          const y1 = flipY(item.from.y);
          const y2 = flipY(item.to.y);
          const midY = (y1 + y2) / 2;
          return (
            <g
              key={item.id}
              data-item-id={item.id}
              data-item-kind="dimension"
              className="elev-dim"
            >
              <line
                className="elev-dim-line"
                x1={item.from.x}
                y1={y1}
                x2={item.to.x}
                y2={y2}
                strokeWidth={strokeW}
              />
              <text
                className={
                  item.text.established ? 'elev-text' : 'elev-text elev-text-unestablished'
                }
                data-established={item.text.established}
                x={item.to.x - strokeW * 3}
                y={midY}
                fontSize={fontSize}
                textAnchor="end"
              >
                {item.text.text}
              </text>
            </g>
          );
        }

        return (
          <text
            key={item.id}
            data-item-id={item.id}
            data-item-kind="text"
            className={item.text.established ? 'elev-text' : 'elev-text elev-text-unestablished'}
            data-established={item.text.established}
            x={item.at.x + strokeW * 2}
            y={flipY(item.at.y)}
            fontSize={fontSize}
          >
            {item.text.text}
          </text>
        );
      })}
    </svg>
  );
}
