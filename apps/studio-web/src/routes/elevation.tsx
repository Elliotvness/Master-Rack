import {
  STEEL_GAGE_TABLE,
  computeSectionProperties,
  evaluateRackBay,
  smartSolveRackBay,
  type FrameBracingStyle,
  type FrameLegStyle,
} from '@rms/kernel-derive';
import { bayTypeForRun, type Command } from '@rms/studio-model';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ElevationSvg,
  beamFaceHeightInFromPart,
  computeElevationClearances,
  getElevationVerticalMetrics,
  renderElevationCanvas,
  snapToPitchInches,
  type ColumnSegmentEvaluation,
  type SelectedElevationMember,
} from '../elevation/elevation-svg.js';
import { useStudioSession } from '../session-context.js';

const UM_PER_INCH = 25_400;

interface EditingElevationTarget {
  readonly kind: 'beam' | 'clear-height' | 'deflector';
  readonly beamIndex?: number;
  readonly valueIn: number;
  readonly topPct: number;
}

/**
 * The elevation view — build-plan **S3.3** redesigned with the RackCraft Studio
 * dual-view CAD blueprint workspace:
 * - Left/Center: Blueprint-grid Dual Front + Side B2B Elevation SVG viewport + Bottom Member Telemetry Dock
 * - Right Sidebar: SmartSolve Optimizer, Workflow Status, Structural Members, Frame Arrangements,
 *   60fps Live Geometry Sliders, and Per-Level Elevation & Load Schedule.
 */
export default function ElevationView(): React.JSX.Element {
  const { session, runCommand } = useStudioSession();
  const doc = session.document;
  const [selectedRunIndex, setSelectedRunIndex] = useState<number>(0);
  const [selectedBayIndex, setSelectedBayIndex] = useState<number>(0);
  const run = doc.runs[selectedRunIndex] ?? doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];
  const bayCountInRun = run !== undefined ? Math.max(1, run.bays.length) : 12;

  const defaultBeamFaceIn = bt !== undefined ? beamFaceHeightInFromPart(bt.beamPart) : 4.0;
  const [pitchIn, setPitchIn] = useState<number>(2);
  const [beamFaceIn, setBeamFaceIn] = useState<number>(defaultBeamFaceIn);
  const [showLoads, setShowLoads] = useState<boolean>(true);
  const [minLiftOffIn, setMinLiftOffIn] = useState<number>(4);
  const [bracingStyle, setBracingStyle] = useState<FrameBracingStyle>('z-pattern');
  const [frameStyle, setFrameStyle] = useState<FrameLegStyle>('standard');
  const [colGage, setColGage] = useState<string>('13ga');
  const [tunnelBay, setTunnelBay] = useState<boolean>(false);
  const [showBananaScale, setShowBananaScale] = useState<boolean>(true);
  const [backToBack, setBackToBack] = useState<boolean>(run?.backToBack ?? true);
  const [flueSpaceIn, setFlueSpaceIn] = useState<number>(12);
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [selectedMember, setSelectedMember] = useState<SelectedElevationMember>({
    type: 'column',
    index: 0,
  });
  const [draggingBeamIdx, setDraggingBeamIdx] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState<EditingElevationTarget | null>(null);
  const [editingInputVal, setEditingInputVal] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (bt !== undefined) {
      setBeamFaceIn(beamFaceHeightInFromPart(bt.beamPart));
    }
  }, [bt?.beamPart]);

  const clearances = useMemo(
    () =>
      computeElevationClearances(doc, {
        beamFaceIn,
        minLiftOffIn,
      }),
    [doc, beamFaceIn, minLiftOffIn],
  );

  const beamClearances = useMemo(
    () => clearances.filter((c) => c.levelIndex >= 0),
    [clearances],
  );

  const clashItems = useMemo(
    () => clearances.filter((c) => c.isLiftOffClash || c.isCeilingClash),
    [clearances],
  );

  const clearHeightIn = Math.round(doc.building.clearHeight.value / UM_PER_INCH);
  const deflectorIn = Math.round(doc.building.deflectorElev.value / UM_PER_INCH);
  const frameHeightIn = bt !== undefined ? Math.round(bt.frameHeight.value / UM_PER_INCH) : 240;
  const maxVertIn = Math.max(clearHeightIn + 24, frameHeightIn + 48, 300);

  const bayWidthIn = bt !== undefined ? Math.round(bt.beamLength / UM_PER_INCH) : 96;
  const frameDepthIn = bt !== undefined ? Math.round(bt.frameDepth / UM_PER_INCH) : 42;
  const uprightWidthIn =
    bt !== undefined ? Math.round((bt.uprightWidth / UM_PER_INCH) * 10) / 10 : 3.0;
  const beamElevationsIn = useMemo(
    () =>
      bt !== undefined && bt.beamLevels.length > 0
        ? bt.beamLevels.map((u) => Math.round(u / UM_PER_INCH))
        : [60, 120, 180],
    [bt],
  );
  const levelLoadLb = useMemo(() => {
    if (bt === undefined) return 5000;
    return bt.beamPairCapacity.value > 0 ? bt.beamPairCapacity.value : 5000;
  }, [bt]);

  const colThicknessIn = STEEL_GAGE_TABLE[colGage] ?? 0.0897;

  const columnSectionProps = useMemo(
    () =>
      computeSectionProperties(
        Math.max(3.0, uprightWidthIn),
        3.0,
        0.75,
        colThicknessIn,
        0.65,
        2 * colThicknessIn,
        'c-lips',
      ),
    [uprightWidthIn, colThicknessIn],
  );

  const beamSectionProps = useMemo(
    () =>
      computeSectionProperties(
        beamFaceIn,
        1.625,
        0.625,
        STEEL_GAGE_TABLE['14ga'] ?? 0.0747,
        0,
        2 * (STEEL_GAGE_TABLE['14ga'] ?? 0.0747),
        'step-beam',
      ),
    [beamFaceIn],
  );

  const structuralCheck = useMemo(
    () =>
      evaluateRackBay({
        bayWidthIn,
        frameDepthIn,
        frameHeightIn,
        bracePitchIn: 48,
        levelElevationsIn: beamElevationsIn,
        levelLoadLb,
        columnSection: columnSectionProps,
        beamSection: beamSectionProps,
        bracingStyle,
        frameStyle,
        tunnelBay,
      }),
    [
      bayWidthIn,
      frameDepthIn,
      frameHeightIn,
      beamElevationsIn,
      levelLoadLb,
      columnSectionProps,
      beamSectionProps,
      bracingStyle,
      frameStyle,
      tunnelBay,
    ],
  );

  const handleSmartSolve = (): void => {
    const solved = smartSolveRackBay({
      bayWidthIn,
      frameDepthIn,
      frameHeightIn,
      bracePitchIn: 48,
      levelElevationsIn: beamElevationsIn,
      levelLoadLb,
      beamSection: beamSectionProps,
      bracingStyle,
      frameStyle,
      tunnelBay,
    });
    setColGage(solved.recommended.gage);
    setStatusMessage(
      `SmartSolve selected ${solved.recommended.label}: ${(solved.recommended.maxColumnRatio * 100).toFixed(1)}% utilization · ${solved.recommended.estimatedBayWeightLb.toFixed(1)} lb/bay.`,
    );
  };

  const vertMetrics = useMemo(() => getElevationVerticalMetrics(doc), [doc]);
  const yPercentForInches = vertMetrics.yPercentForInches;

  const clearHeightTopPct = yPercentForInches(clearHeightIn);
  const deflectorTopPct = Math.max(
    yPercentForInches(deflectorIn),
    Math.min(92, clearHeightTopPct + 5.5),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    renderElevationCanvas(ctx, doc, {
      showLoads,
      beamFaceIn,
      minLiftOffIn,
      activeDragIndex: draggingBeamIdx,
      bracingStyle,
      frameStyle,
      tunnelBay,
      showBananaScale,
    });
  }, [
    doc,
    showLoads,
    beamFaceIn,
    minLiftOffIn,
    draggingBeamIdx,
    bracingStyle,
    frameStyle,
    tunnelBay,
    showBananaScale,
  ]);

  const applyBeamElevationIn = (beamIdx: number, rawInches: number): void => {
    if (bt === undefined) return;
    const snappedIn = snapToPitchInches(rawInches, pitchIn);

    const lowerLimitIn =
      beamIdx > 0 && bt.beamLevels[beamIdx - 1] !== undefined
        ? Math.round(bt.beamLevels[beamIdx - 1]! / UM_PER_INCH) + pitchIn
        : pitchIn * 6;
    const upperLimitIn =
      beamIdx < bt.beamLevels.length - 1 && bt.beamLevels[beamIdx + 1] !== undefined
        ? Math.round(bt.beamLevels[beamIdx + 1]! / UM_PER_INCH) - pitchIn
        : clearHeightIn + 48;

    const boundedIn = Math.max(lowerLimitIn, Math.min(upperLimitIn, snappedIn));
    const targetUm = Math.round(boundedIn * UM_PER_INCH);
    if (bt.beamLevels[beamIdx] === targetUm) return;

    const res = runCommand({
      type: 'setBeamLevel',
      bayTypeId: bt.id,
      index: beamIdx,
      top: targetUm,
    });

    if (res.ok) {
      if (boundedIn > clearHeightIn) {
        const msg = `CLASH: Beam L${beamIdx + 1} (${boundedIn}" T.O.B.) exceeds ${clearHeightIn}" Clear Height ceiling!`;
        setStatusMessage(msg);
      } else {
        setStatusMessage(
          `Snapped L${beamIdx + 1} to ${boundedIn}.00" T.O.B. (${pitchIn}" punch pitch).`,
        );
      }
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (draggingBeamIdx === null || stageRef.current === null) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (rect.height <= 0) return;
    const rawMouseY = rect.bottom - e.clientY;
    const ratio = Math.max(0.05, Math.min(0.95, rawMouseY / rect.height));
    const rawInchesY = ratio * maxVertIn;
    applyBeamElevationIn(draggingBeamIdx, rawInchesY);
  };

  const handleStagePointerUp = (): void => {
    if (draggingBeamIdx !== null) {
      setDraggingBeamIdx(null);
    }
  };

  const commitInlineEdit = (): void => {
    if (editingTarget === null) return;
    const parsed = Number(editingInputVal);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setEditingTarget(null);
      return;
    }

    if (editingTarget.kind === 'beam' && editingTarget.beamIndex !== undefined) {
      applyBeamElevationIn(editingTarget.beamIndex, parsed);
    } else if (editingTarget.kind === 'clear-height') {
      const snappedClearIn = Math.round(parsed);
      runCommand({
        type: 'setField',
        label: `Set building clear height to ${snappedClearIn}"`,
        change: {
          section: 'building',
          patch: {
            clearHeight: {
              value: Math.round(snappedClearIn * UM_PER_INCH),
              established: 'INPUT',
              source: 'Elevation inline ceiling datum entry',
            },
          },
        },
      });
      setStatusMessage(`Verified building Clear Height ceiling at ${snappedClearIn}".`);
    } else if (editingTarget.kind === 'deflector') {
      const snappedDeflIn = Math.round(parsed);
      runCommand({
        type: 'setField',
        label: `Set sprinkler deflector elevation to ${snappedDeflIn}"`,
        change: {
          section: 'building',
          patch: {
            deflectorElev: {
              value: Math.round(snappedDeflIn * UM_PER_INCH),
              established: 'INPUT',
              source: 'Elevation inline sprinkler deflector entry',
            },
          },
        },
      });
      setStatusMessage(`Verified Sprinkler Deflector datum at ${snappedDeflIn}".`);
    }
    setEditingTarget(null);
  };

  const autoSpaceBeamsForClearance = (): void => {
    if (bt === undefined) return;
    const loadHIn = Math.round(doc.unitLoad.height / UM_PER_INCH);
    const minStepIn = snapToPitchInches(loadHIn + minLiftOffIn + beamFaceIn, pitchIn);
    const firstLevelIn =
      run?.floorStorage ?? true
        ? minStepIn
        : snapToPitchInches(
            Math.round((bt.beamLevels[0] ?? 60 * UM_PER_INCH) / UM_PER_INCH),
            pitchIn,
          );

    const cmds: Command[] = [];
    const targetLevelsIn = bt.beamLevels.map((_, idx) => firstLevelIn + idx * minStepIn);

    for (let i = bt.beamLevels.length - 1; i >= 0; i -= 1) {
      const targetUm = Math.round(targetLevelsIn[i]! * UM_PER_INCH);
      if (bt.beamLevels[i] !== targetUm) {
        cmds.push({
          type: 'setBeamLevel',
          bayTypeId: bt.id,
          index: i,
          top: targetUm,
        });
      }
    }

    if (cmds.length > 0) {
      runCommand({
        type: 'batch',
        label: `Auto-space ${bt.beamLevels.length} beam levels for ${minLiftOffIn}" lift-off (${pitchIn}" pitch)`,
        commands: cmds,
      });
      setStatusMessage(
        `Auto-spaced beam levels to ${targetLevelsIn.map((v) => `${v}"`).join(', ')} T.O.B. (${minLiftOffIn}"+ lift-off clearance).`,
      );
    }
  };

  const columnSegments = useMemo<readonly ColumnSegmentEvaluation[]>(() => {
    const pts = [0, ...beamElevationsIn];
    if (frameHeightIn > (pts[pts.length - 1] ?? 0)) pts.push(frameHeightIn);
    const totalLevels = Math.max(1, beamElevationsIn.length);
    return pts.slice(0, -1).map((zStart, idx) => {
      const zEnd = pts[idx + 1] ?? zStart + 60;
      const levelsAbove = Math.max(0, totalLevels - idx);
      const frac = totalLevels > 0 ? levelsAbove / totalLevels : 0;
      const ratio = Number((structuralCheck.maxColumnRatio * Math.max(0.16, frac)).toFixed(3));
      return {
        segmentIndex: idx + 1,
        zStartIn: zStart,
        zEndIn: zEnd,
        segLenIn: zEnd - zStart,
        axialLoadKips: Number((structuralCheck.bottomColumnCheck.PuKip * frac).toFixed(2)),
        PncKips: structuralCheck.bottomColumnCheck.phiPnKip,
        controllingRatio: ratio,
        passes: ratio <= 1.0,
      };
    });
  }, [beamElevationsIn, frameHeightIn, structuralCheck]);

  const activeColSeg =
    columnSegments[selectedMember.type === 'column' ? selectedMember.index : 0] ??
    columnSegments[0];

  const colPasses = structuralCheck.maxColumnRatio <= 1.0;
  const beamPasses = structuralCheck.maxBeamRatio <= 1.0;
  const stabilityPasses = structuralCheck.stabilityRatio <= 1.0;

  return (
    <section className="rc-elevation-workspace" aria-labelledby="view-heading-elevation">
      {/* ==================== LEFT / CENTER: RACKCRAFT BLUEPRINT CANVAS + BOTTOM DOCK ==================== */}
      <div className="rc-canvas-area">
        <div
          ref={stageRef}
          id="elevation-interactive-stage"
          className="rc-canvas-stage"
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
        >
          {/* Top-Left Interactive Hint & Spatial Context Pill */}
          <div
            id="elev-spatial-breadcrumb"
            className="rc-hint-chip"
            aria-label="Active elevation bay context"
          >
            <h1 id="view-heading-elevation" className="rc-sr-heading">
              Elevation
            </h1>
            <span>&#8693; Drag beams vertically &bull; Click any dimension pill</span>
            <span className="rc-hint-sep">|</span>
            <strong>
              RUN {selectedRunIndex + 1} &middot; BAY {selectedBayIndex + 1}
            </strong>
            <span className="rc-hint-sub">
              (UPDATING PROFILE: {(bt?.name ?? 'TYPE A').toUpperCase()} &middot; {bayCountInRun}-BAY{' '}
              {backToBack ? 'BACK-TO-BACK' : 'AISLE'} RUN)
            </span>
          </div>

          {/* Top-Right Banana Scale & Estimated Bay Weight Pill Bar */}
          <div className="rc-top-right-chips">
            <button
              id="elev-banana-scale-btn"
              type="button"
              className={showBananaScale ? 'rc-pill-btn rc-pill-banana-on' : 'rc-pill-btn'}
              aria-pressed={showBananaScale}
              onClick={() => setShowBananaScale((prev) => !prev)}
            >
              {showBananaScale ? 'Banana Scale (7.00")' : 'Banana Scale: OFF'}
            </button>
            <div id="elev-bay-weight-readout" className="rc-weight-chip">
              <span>Est. Weight:</span>
              <strong>
                {structuralCheck.estimatedBayWeightLb.toFixed(1)} lbs (Bay) |{' '}
                {Math.round(structuralCheck.estimatedBayWeightLb * bayCountInRun)} lbs (Row)
              </strong>
              <span>({structuralCheck.passesAll ? 'PASS' : 'REVIEW'}) &rsaquo;</span>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            id="elevation-canvas"
            width={960}
            height={640}
            className="elevation-canvas-underlay"
            aria-hidden="true"
          />

          <ElevationSvg
            document={doc}
            id="elevsvg"
            showLoads={showLoads}
            beamFaceIn={beamFaceIn}
            minLiftOffIn={minLiftOffIn}
            activeDragIndex={draggingBeamIdx}
            bracingStyle={bracingStyle}
            frameStyle={frameStyle}
            tunnelBay={tunnelBay}
            showBananaScale={showBananaScale}
            backToBack={backToBack}
            flueSpaceIn={flueSpaceIn}
            zoomFactor={zoomFactor}
            columnSegments={columnSegments}
            beamControllingRatio={structuralCheck.maxBeamRatio}
            selectedMember={selectedMember}
            onSelectMember={(m) => setSelectedMember(m)}
            onBeamPointerDown={(idx) => {
              setSelectedMember({ type: 'beam', index: idx });
              setDraggingBeamIdx(idx);
            }}
            onDimensionLabelClick={(idx) => {
              if (bt === undefined || bt.beamLevels[idx] === undefined) return;
              const valIn = Math.round(bt.beamLevels[idx]! / UM_PER_INCH);
              setSelectedMember({ type: 'beam', index: idx });
              setEditingTarget({
                kind: 'beam',
                beamIndex: idx,
                valueIn: valIn,
                topPct: yPercentForInches(valIn),
              });
              setEditingInputVal(String(valIn));
            }}
            onCeilingLabelClick={(datum) => {
              const valIn = datum === 'clear-height' ? clearHeightIn : deflectorIn;
              setEditingTarget({
                kind: datum,
                valueIn: valIn,
                topPct: yPercentForInches(valIn),
              });
              setEditingInputVal(String(valIn));
            }}
          />

          {/* Floating Inline Click-to-Type Dimension Input Popover */}
          {editingTarget !== null && (
            <div id="elev-inline-editor-popover" className="rc-inline-popover">
              <div className="rc-inline-popover-head">
                <label htmlFor="elev-inline-dim-input">
                  {editingTarget.kind === 'beam'
                    ? `L${(editingTarget.beamIndex ?? 0) + 1} T.O.B. Elevation (in)`
                    : editingTarget.kind === 'clear-height'
                      ? 'Clear Height Ceiling (in)'
                      : 'Sprinkler Deflector (in)'}
                </label>
                <button
                  id="elev-inline-cancel-btn"
                  type="button"
                  className="rc-inline-close"
                  onClick={() => setEditingTarget(null)}
                >
                  &times;
                </button>
              </div>
              <div className="rc-inline-popover-row">
                <input
                  id="elev-inline-dim-input"
                  autoFocus
                  type="number"
                  step={editingTarget.kind === 'beam' ? pitchIn : 1}
                  className="rc-inline-input"
                  value={editingInputVal}
                  onChange={(e) => setEditingInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitInlineEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTarget(null);
                    }
                  }}
                />
                <button
                  id="elev-inline-apply-btn"
                  type="button"
                  className="rc-btn-apply"
                  onClick={commitInlineEdit}
                >
                  Apply
                </button>
              </div>
            </div>
          )}

          {/* Bottom-Right Viewport Zoom Controls */}
          <div className="rc-zoom-controls" role="group" aria-label="Viewport zoom controls">
            <button
              type="button"
              className="rc-zoom-btn"
              title="Zoom Out"
              onClick={() => setZoomFactor((z) => Math.max(0.55, z / 1.15))}
            >
              &minus;
            </button>
            <button
              type="button"
              className="rc-zoom-btn rc-zoom-fit"
              title="Fit to Viewport"
              onClick={() => setZoomFactor(1.0)}
            >
              FIT
            </button>
            <button
              type="button"
              className="rc-zoom-btn"
              title="Zoom In"
              onClick={() => setZoomFactor((z) => Math.min(2.4, z * 1.15))}
            >
              &#43;
            </button>
          </div>
        </div>

        {/* Dedicated Bottom Member Telemetry & Clash Status Dock */}
        <div className="rc-bottom-dock">
          <div
            id="elev-structural-telemetry"
            className="rc-member-card"
            aria-label="RMI MH16.1 and AISI S100 structural check telemetry"
          >
            <div className="rc-member-card-head">
              <strong>
                Column Seg {activeColSeg?.zStartIn ?? 0}&quot;&ndash;
                {activeColSeg?.zEndIn ?? 60}&quot; ({bt?.uprightPart ?? '3x3 ROLL-FORMED'} &middot;{' '}
                {colGage} ({colThicknessIn.toFixed(4)}&quot;))
              </strong>
              <div className="rc-member-live-bar">
                <span>Top Z (in):</span>
                <input
                  type="number"
                  aria-label="Selected segment top elevation in inches"
                  value={activeColSeg?.zEndIn ?? 60}
                  onChange={(e) => {
                    const idx = Math.min(
                      selectedMember.index,
                      Math.max(0, (bt?.beamLevels.length ?? 1) - 1),
                    );
                    applyBeamElevationIn(idx, Number(e.target.value));
                  }}
                />
                <span>Kx: 1.7</span>
                <span
                  className={
                    (activeColSeg?.controllingRatio ?? structuralCheck.maxColumnRatio) > 1.0
                      ? 'rc-util-pill rc-util-fail'
                      : 'rc-util-pill rc-util-pass'
                  }
                >
                  {(activeColSeg?.controllingRatio ?? structuralCheck.maxColumnRatio).toFixed(3)}{' '}
                  {(activeColSeg?.controllingRatio ?? structuralCheck.maxColumnRatio) > 1.0
                    ? 'FAIL'
                    : 'PASS'}
                </span>
              </div>
            </div>

            <div className="rc-member-stats-grid">
              <div className="rc-member-stat">
                <span>Axial Load Pu</span>
                <strong>{structuralCheck.bottomColumnCheck.PuKip.toFixed(2)} kips</strong>
              </div>
              <div className="rc-member-stat">
                <span>Capacity &phi;Pn</span>
                <strong>{structuralCheck.bottomColumnCheck.phiPnKip.toFixed(2)} kips</strong>
              </div>
              <div className="rc-member-stat">
                <span>Lengths Lx/Ly/Lt</span>
                <strong>
                  {activeColSeg?.segLenIn ?? 60}&quot;/48&quot;/48&quot;
                </strong>
              </div>
              <div className="rc-member-stat">
                <span>Fe / Fn</span>
                <strong>
                  {structuralCheck.bottomColumnCheck.FeKsi.toFixed(1)} /{' '}
                  {structuralCheck.bottomColumnCheck.FnKsi.toFixed(1)} ksi
                </strong>
              </div>
              <div id="elev-section-props-readout" className="rc-member-stat">
                <span>Eff. Area Ae ({colGage})</span>
                <strong>
                  Anet={columnSectionProps.Anet.toFixed(3)} in&sup2; &middot; Ag=
                  {columnSectionProps.A.toFixed(3)} in&sup2; &middot; Ix=
                  {columnSectionProps.Ix.toFixed(3)} in&#8308; &middot; Cw=
                  {columnSectionProps.Cw.toFixed(4)} in&#8310;
                </strong>
              </div>
              <div className="rc-member-stat">
                <span>RMI Interaction &amp; P-&Delta;</span>
                <strong>
                  <span id="elev-col-unity-readout">
                    Column Unity: {(structuralCheck.maxColumnRatio * 100).toFixed(1)}% (
                    {structuralCheck.bottomColumnCheck.passes ? 'PASS' : 'FAIL'})
                  </span>{' '}
                  &middot;{' '}
                  <span id="elev-beam-unity-readout">
                    Beam Unity: {(structuralCheck.maxBeamRatio * 100).toFixed(1)}% (&Delta;=
                    {structuralCheck.beamCheck.deltaIn.toFixed(3)}&quot;)
                  </span>{' '}
                  &middot;{' '}
                  <span id="elev-pdelta-readout">
                    P-&Delta; B2: {structuralCheck.stabilityB2.toFixed(2)}
                  </span>
                </strong>
              </div>
            </div>
          </div>

          {/* Right Status & Clash Toast */}
          <div
            id="elev-clash-banner"
            className={
              clashItems.length > 0 || !structuralCheck.passesAll
                ? 'rc-warning-toast rc-toast-fail'
                : 'rc-warning-toast rc-toast-pass'
            }
            role="status"
          >
            <div>
              {clashItems.length > 0
                ? `\u26A0 CLASH DETECTED (${clashItems.length}): ${clashItems
                    .map((c) =>
                      c.isCeilingClash
                        ? `${c.label} > ${clearHeightIn}" ceiling`
                        : `${c.label} lift-off ${c.liftOffClearanceInches.toFixed(1)}" (< ${minLiftOffIn}")`,
                    )
                    .join(' · ')}`
                : !structuralCheck.passesAll
                  ? `\u26A0 Over-utilized (${Math.max(structuralCheck.maxColumnRatio, structuralCheck.maxBeamRatio).toFixed(3)} > 1.00). Click SmartSolve or upsize specs.`
                  : `\u2713 All ${clearances.length} levels meet \u2265 ${minLiftOffIn}" lift-off & RMI MH16.1 limits.`}
            </div>
            {statusMessage !== null && (
              <div id="elev-status-readout" className="rc-toast-sub">
                {statusMessage}
              </div>
            )}
            {clashItems.length > 0 && (
              <button
                id="elev-autofix-liftoff-btn"
                type="button"
                className="rc-btn-apply"
                style={{ marginTop: '4px' }}
                onClick={autoSpaceBeamsForClearance}
              >
                Auto-Space Beams ({minLiftOffIn}&quot;+ Clear)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ==================== RIGHT INSPECTOR SIDEBAR (RACKCRAFT CONTROLS) ==================== */}
      <aside
        id="elevation-cad-toolbar"
        className="rc-right-inspector"
        role="toolbar"
        aria-label="Elevation CAD controls"
      >
        <button
          id="elev-smartsolve-btn"
          type="button"
          className="rc-smartsolve-btn"
          onClick={handleSmartSolve}
        >
          <span>SmartSolve Lightest Gage</span>
          <span className="rc-auto-badge">AUTO</span>
        </button>

        {/* 1. Workflow / Status Tracker */}
        <div className="rc-inspector-section">
          <div className="rc-inspector-heading">
            <span>Workflow / Status</span>
            <span className="rc-heading-tag">RMI MH16.1</span>
          </div>
          <div className="rc-workflow-stepper">
            <div className="rc-workflow-step">
              <span>Static Analysis (Col &amp; Beam)</span>
              <span className={colPasses && beamPasses ? 'rc-dot rc-dot-pass' : 'rc-dot rc-dot-fail'} />
            </div>
            <div className="rc-workflow-step">
              <span>Stability (B&#8322; P-&Delta; = {structuralCheck.stabilityB2.toFixed(2)})</span>
              <span className={stabilityPasses ? 'rc-dot rc-dot-pass' : 'rc-dot rc-dot-fail'} />
            </div>
            <div className="rc-workflow-step">
              <span>Forklift Lift-Off (&ge; {minLiftOffIn}&quot;)</span>
              <span className={clashItems.length === 0 ? 'rc-dot rc-dot-pass' : 'rc-dot rc-dot-fail'} />
            </div>
            <div className="rc-workflow-step">
              <span>Ceiling &amp; Sprinkler Datums</span>
              <div className="rc-datum-btns">
                <button
                  id="elev-clear-height-tag"
                  type="button"
                  className="rc-datum-pill"
                  title="Click to verify building Clear Height ceiling (in)"
                  onClick={() => {
                    setEditingTarget({
                      kind: 'clear-height',
                      valueIn: clearHeightIn,
                      topPct: clearHeightTopPct,
                    });
                    setEditingInputVal(String(clearHeightIn));
                  }}
                >
                  {clearHeightIn}&quot;{' '}
                  {doc.building.clearHeight.established === 'UNKNOWN' ? 'VERIFY' : 'VERIFIED'}
                </button>
                <button
                  id="elev-deflector-tag"
                  type="button"
                  className="rc-datum-pill"
                  title="Click to verify Sprinkler Deflector elevation (in)"
                  onClick={() => {
                    setEditingTarget({
                      kind: 'deflector',
                      valueIn: deflectorIn,
                      topPct: deflectorTopPct,
                    });
                    setEditingInputVal(String(deflectorIn));
                  }}
                >
                  Defl {deflectorIn}&quot;{' '}
                  {doc.building.deflectorElev.established === 'UNKNOWN' ? 'VERIFY' : 'VERIFIED'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Structural Members (Upright Column & Shelf Beam) */}
        <div className="rc-inspector-section">
          <div className="rc-inspector-heading">
            <span>Structural Members</span>
            <span className="rc-heading-tag">Step 1 Library</span>
          </div>
          <div className="rc-part-card-list">
            <div className="rc-part-row-card">
              <div className="rc-part-row-header">
                <label htmlFor="elev-col-gage-select">Upright Column</label>
                <div className="rc-part-row-meta">
                  <span>Max: {structuralCheck.maxColumnRatio.toFixed(3)}</span>
                  <span className={colPasses ? 'rc-dot rc-dot-pass' : 'rc-dot rc-dot-fail'} />
                </div>
              </div>
              <select
                id="elev-col-gage-select"
                aria-label="Upright Steel Gage"
                className="rc-part-select"
                value={colGage}
                onChange={(e) => setColGage(e.target.value)}
              >
                <option value="16ga">3x3x0.75 Roll-Formed &middot; 16 ga (0.060&quot;)</option>
                <option value="14ga">3x3x0.75 Roll-Formed &middot; 14 ga (0.075&quot;)</option>
                <option value="13ga">3x3x0.75 Roll-Formed &middot; 13 ga (0.090&quot;)</option>
                <option value="12ga">3x3x0.75 Roll-Formed &middot; 12 ga (0.105&quot;)</option>
                <option value="10ga">3x3x0.75 Structural &middot; 10 ga (0.135&quot;)</option>
              </select>
            </div>

            <div className="rc-part-row-card">
              <div className="rc-part-row-header">
                <label htmlFor="elev-beam-face-select">Shelf Beam</label>
                <div className="rc-part-row-meta">
                  <span>Max: {structuralCheck.maxBeamRatio.toFixed(3)}</span>
                  <span className={beamPasses ? 'rc-dot rc-dot-pass' : 'rc-dot rc-dot-fail'} />
                </div>
              </div>
              <select
                id="elev-beam-face-select"
                aria-label="Beam Face Height"
                className="rc-part-select"
                value={String(beamFaceIn)}
                onChange={(e) => setBeamFaceIn(Number(e.target.value))}
              >
                <option value="3.5">3.5&quot; Step Beam &middot; 16ga</option>
                <option value="4">4.0&quot; Step Beam &middot; 14ga</option>
                <option value="4.5">4.5&quot; Step Beam &middot; 14ga</option>
                <option value="5">5.0&quot; Step Beam &middot; 14ga</option>
                <option value="5.5">5.5&quot; Step Beam &middot; 13ga</option>
                <option value="6">6.0&quot; Structural Channel &middot; 12ga</option>
              </select>
            </div>
          </div>
        </div>

        {/* 3. Frame & Bay Arrangements */}
        <div className="rc-inspector-section">
          <div className="rc-inspector-heading">
            <span>Frame &amp; Bay Arrangements</span>
            <span className="rc-heading-tag">Step 2</span>
          </div>

          <div className="rc-field-group" style={{ marginBottom: '6px' }}>
            <label htmlFor="elev-bay-context-select">Active Bay Context</label>
            <select
              id="elev-bay-context-select"
              aria-label="Active Bay Context"
              className="rc-part-select"
              value={`${selectedRunIndex}:${selectedBayIndex}`}
              onChange={(e) => {
                const [rStr, bStr] = e.target.value.split(':');
                setSelectedRunIndex(Number(rStr) || 0);
                setSelectedBayIndex(Number(bStr) || 0);
              }}
            >
              {doc.runs.map((r, rIdx) =>
                Array.from({ length: Math.max(1, r.bays.length) }, (_, bIdx) => (
                  <option key={`${r.id}-${bIdx}`} value={`${rIdx}:${bIdx}`}>
                    Run {rIdx + 1} &middot; Bay {bIdx + 1} ({bt?.name ?? 'Type A'})
                  </option>
                )),
              )}
            </select>
          </div>

          <div className="rc-form-grid-2">
            <div className="rc-field-group">
              <label htmlFor="elev-bracing-style-select">Bracing Style</label>
              <select
                id="elev-bracing-style-select"
                aria-label="Frame Bracing Style"
                value={bracingStyle}
                onChange={(e) => setBracingStyle(e.target.value as FrameBracingStyle)}
              >
                <option value="z-pattern">Z-Pattern (Std)</option>
                <option value="x-pattern">X-Pattern (Heavy)</option>
                <option value="k-pattern">K-Pattern</option>
                <option value="d-pattern">D-Pattern (Warren)</option>
              </select>
            </div>

            <div className="rc-field-group">
              <label htmlFor="elev-frame-style-select">Leg Profile</label>
              <select
                id="elev-frame-style-select"
                aria-label="Frame Leg Profile"
                value={frameStyle}
                onChange={(e) => setFrameStyle(e.target.value as FrameLegStyle)}
              >
                <option value="standard">Standard Vertical</option>
                <option value="setback">Setback (Recessed)</option>
                <option value="slant-leg">Slant-Leg (Slope)</option>
              </select>
            </div>

            <div className="rc-field-group">
              <label htmlFor="elev-pitch-select">Punch Pitch</label>
              <select
                id="elev-pitch-select"
                aria-label="Punch Pitch"
                value={String(pitchIn)}
                onChange={(e) => setPitchIn(Number(e.target.value))}
              >
                <option value="2">2&quot; Teardrop</option>
                <option value="3">3&quot; Structural</option>
                <option value="4">4&quot; Slotted</option>
              </select>
            </div>

            <div className="rc-field-group">
              <label htmlFor="elev-min-liftoff-select">Min Lift-Off</label>
              <select
                id="elev-min-liftoff-select"
                aria-label="Minimum Lift-Off Clearance"
                value={String(minLiftOffIn)}
                onChange={(e) => setMinLiftOffIn(Number(e.target.value))}
              >
                <option value="4">4&quot; Standard</option>
                <option value="6">6&quot; Reach Truck</option>
              </select>
            </div>
          </div>

          <div className="rc-checkbox-row">
            <label htmlFor="rc-check-b2b">Back-to-Back Row Config</label>
            <input
              id="rc-check-b2b"
              type="checkbox"
              checked={backToBack}
              onChange={(e) => setBackToBack(e.target.checked)}
            />
          </div>

          <div className="rc-toggle-btn-row">
            <button
              id="elev-tunnel-bay-btn"
              type="button"
              className={tunnelBay ? 'rc-mini-toggle rc-mini-toggle-on' : 'rc-mini-toggle'}
              aria-pressed={tunnelBay}
              onClick={() => setTunnelBay((prev) => !prev)}
            >
              {tunnelBay ? 'Tunnel Bay: ON' : 'Tunnel Bay: OFF'}
            </button>
            <button
              id="elev-toggle-loads-btn"
              type="button"
              className={showLoads ? 'rc-mini-toggle rc-mini-toggle-on' : 'rc-mini-toggle'}
              aria-pressed={showLoads}
              onClick={() => setShowLoads((prev) => !prev)}
            >
              {showLoads ? 'Show Loads: ON' : 'Show Loads: OFF'}
            </button>
          </div>
        </div>

        {/* 4. Live Geometry & Loads (60fps Live Sliders) */}
        {bt !== undefined && (
          <div className="rc-inspector-section">
            <div className="rc-inspector-heading">
              <span>Live Geometry &amp; Loads</span>
              <span className="rc-heading-live">60fps Live</span>
            </div>

            <div className="rc-counter-row">
              <span className="rc-counter-label">Beam Levels</span>
              <div className="rc-counter-ctrl">
                <button
                  type="button"
                  className="rc-counter-btn"
                  title="Remove top beam level"
                  disabled={bt.beamLevels.length <= 1}
                  onClick={() => {
                    if (bt.beamLevels.length <= 1) return;
                    runCommand({
                      type: 'deleteBeamLevel',
                      bayTypeId: bt.id,
                      index: bt.beamLevels.length - 1,
                    });
                  }}
                >
                  &minus;
                </button>
                <span className="rc-counter-val">{bt.beamLevels.length}</span>
                <button
                  id="elev-add-level-btn"
                  type="button"
                  className="rc-counter-btn"
                  title="Add beam level"
                  onClick={() => {
                    const topMostUm = bt.beamLevels[bt.beamLevels.length - 1] ?? 0;
                    const nextIn = snapToPitchInches(
                      Math.round(topMostUm / UM_PER_INCH) + 60,
                      pitchIn,
                    );
                    runCommand({
                      type: 'addBeamLevel',
                      bayTypeId: bt.id,
                      top: Math.round(nextIn * UM_PER_INCH),
                    });
                  }}
                >
                  &#43;
                </button>
              </div>
            </div>

            <div className="rc-slider-row">
              <div className="rc-slider-top">
                <span>Bay Width (Beam Span)</span>
                <span>in</span>
              </div>
              <div className="rc-slider-controls">
                <input
                  type="range"
                  min={48}
                  max={168}
                  step={6}
                  aria-label="Bay Width Slider"
                  value={bayWidthIn}
                  onChange={(e) => {
                    const nextW = Number(e.target.value);
                    runCommand({
                      type: 'setField',
                      label: `Set bay width to ${nextW}"`,
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: { beamLength: Math.round(nextW * UM_PER_INCH) },
                      },
                    });
                  }}
                />
                <input
                  type="number"
                  min={48}
                  max={192}
                  step={6}
                  aria-label="Bay Width Input"
                  value={bayWidthIn}
                  onChange={(e) => {
                    const nextW = Number(e.target.value);
                    if (nextW >= 36) {
                      runCommand({
                        type: 'setField',
                        label: `Set bay width to ${nextW}"`,
                        change: {
                          section: 'bayType',
                          bayTypeId: bt.id,
                          patch: { beamLength: Math.round(nextW * UM_PER_INCH) },
                        },
                      });
                    }
                  }}
                />
              </div>
            </div>

            <div className="rc-slider-row">
              <div className="rc-slider-top">
                <span>Frame Height</span>
                <span>in</span>
              </div>
              <div className="rc-slider-controls">
                <input
                  type="range"
                  min={120}
                  max={420}
                  step={12}
                  aria-label="Frame Height Slider"
                  value={frameHeightIn}
                  onChange={(e) => {
                    const nextH = Number(e.target.value);
                    runCommand({
                      type: 'setField',
                      label: `Set frame height to ${nextH}"`,
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: {
                          frameHeight: {
                            value: Math.round(nextH * UM_PER_INCH),
                            established: 'INPUT',
                            source: 'Elevation live geometry slider',
                          },
                        },
                      },
                    });
                  }}
                />
                <input
                  type="number"
                  min={96}
                  max={480}
                  step={6}
                  aria-label="Frame Height Input"
                  value={frameHeightIn}
                  onChange={(e) => {
                    const nextH = Number(e.target.value);
                    if (nextH >= 96) {
                      runCommand({
                        type: 'setField',
                        label: `Set frame height to ${nextH}"`,
                        change: {
                          section: 'bayType',
                          bayTypeId: bt.id,
                          patch: {
                            frameHeight: {
                              value: Math.round(nextH * UM_PER_INCH),
                              established: 'INPUT',
                              source: 'Elevation live geometry input',
                            },
                          },
                        },
                      });
                    }
                  }}
                />
              </div>
            </div>

            <div className="rc-slider-row">
              <div className="rc-slider-top">
                <span>Frame Depth</span>
                <span>in</span>
              </div>
              <div className="rc-slider-controls">
                <input
                  type="range"
                  min={24}
                  max={60}
                  step={6}
                  aria-label="Frame Depth Slider"
                  value={frameDepthIn}
                  onChange={(e) => {
                    const nextD = Number(e.target.value);
                    runCommand({
                      type: 'setField',
                      label: `Set frame depth to ${nextD}"`,
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: { frameDepth: Math.round(nextD * UM_PER_INCH) },
                      },
                    });
                  }}
                />
                <input
                  type="number"
                  min={24}
                  max={72}
                  step={2}
                  aria-label="Frame Depth Input"
                  value={frameDepthIn}
                  onChange={(e) => {
                    const nextD = Number(e.target.value);
                    if (nextD >= 24) {
                      runCommand({
                        type: 'setField',
                        label: `Set frame depth to ${nextD}"`,
                        change: {
                          section: 'bayType',
                          bayTypeId: bt.id,
                          patch: { frameDepth: Math.round(nextD * UM_PER_INCH) },
                        },
                      });
                    }
                  }}
                />
              </div>
            </div>

            <div className="rc-slider-row">
              <div className="rc-slider-top">
                <span>All-Level Pair Load</span>
                <span>lbs/lvl</span>
              </div>
              <div className="rc-slider-controls">
                <input
                  type="range"
                  min={1000}
                  max={10000}
                  step={250}
                  aria-label="Level Load Slider"
                  value={levelLoadLb}
                  onChange={(e) => {
                    const nextL = Number(e.target.value);
                    runCommand({
                      type: 'setField',
                      label: `Set beam pair capacity to ${nextL} lb`,
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: {
                          beamPairCapacity: {
                            value: nextL,
                            established: 'INPUT',
                            source: 'Elevation live load slider',
                          },
                        },
                      },
                    });
                  }}
                />
                <input
                  type="number"
                  min={500}
                  max={20000}
                  step={250}
                  aria-label="Level Load Input"
                  value={levelLoadLb}
                  onChange={(e) => {
                    const nextL = Number(e.target.value);
                    if (nextL >= 500) {
                      runCommand({
                        type: 'setField',
                        label: `Set beam pair capacity to ${nextL} lb`,
                        change: {
                          section: 'bayType',
                          bayTypeId: bt.id,
                          patch: {
                            beamPairCapacity: {
                              value: nextL,
                              established: 'INPUT',
                              source: 'Elevation live load input',
                            },
                          },
                        },
                      });
                    }
                  }}
                />
              </div>
            </div>

            {backToBack && (
              <div className="rc-slider-row">
                <div className="rc-slider-top">
                  <span>Back-to-Back Flue Space</span>
                  <span>in</span>
                </div>
                <div className="rc-slider-controls">
                  <input
                    type="range"
                    min={3}
                    max={24}
                    step={1}
                    aria-label="Flue Space Slider"
                    value={flueSpaceIn}
                    onChange={(e) => setFlueSpaceIn(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={3}
                    max={36}
                    step={1}
                    aria-label="Flue Space Input"
                    value={flueSpaceIn}
                    onChange={(e) => setFlueSpaceIn(Math.max(3, Number(e.target.value)))}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. Per-Level Elevations & Loads Schedule */}
        <div
          id="elev-coordinate-overlays"
          className="rc-inspector-section"
          aria-label="Interactive elevation dimension overlays"
        >
          <div className="rc-inspector-heading">
            <span>Per-Level Elevations &amp; Loads</span>
            <span className="rc-heading-tag">Elev (in) / Lift-Off</span>
          </div>

          <div className="rc-level-editor-list">
            {beamClearances.map((c) => {
              const idx = c.levelIndex;
              const topPct = yPercentForInches(c.tobInches);
              const isSelected = selectedMember.type === 'beam' && selectedMember.index === idx;
              return (
                <div
                  key={c.levelId}
                  id={`elev-dim-pill-${idx}`}
                  data-elev-dim-pill={idx}
                  data-elev-clash={c.isLiftOffClash || c.isCeilingClash ? 'true' : 'false'}
                  className={
                    isSelected
                      ? 'rc-level-edit-row rc-level-row-selected'
                      : 'rc-level-edit-row'
                  }
                >
                  <button
                    id={`elev-dim-btn-${idx}`}
                    type="button"
                    className="rc-level-tob-btn"
                    title={`Click to type L${idx + 1} T.O.B. elevation in inches (snaps to ${pitchIn}" pitch)`}
                    onClick={() => {
                      setSelectedMember({ type: 'beam', index: idx });
                      setEditingTarget({
                        kind: 'beam',
                        beamIndex: idx,
                        valueIn: c.tobInches,
                        topPct,
                      });
                      setEditingInputVal(String(c.tobInches));
                    }}
                  >
                    <strong>L{idx + 1}</strong>{' '}
                    <span>
                      {c.tobInches.toFixed(0)}&quot; ({Math.round(c.tobInches * 25.4)} mm) T.O.B.
                    </span>
                  </button>

                  <span
                    className={
                      c.isLiftOffClash
                        ? 'rc-util-pill rc-util-fail'
                        : 'rc-util-pill rc-util-pass'
                    }
                  >
                    {c.liftOffClearanceInches.toFixed(1)}&quot; clr
                  </span>

                  <div
                    className="rc-pitch-steppers"
                    role="group"
                    aria-label={`Nudge L${idx + 1} by ${pitchIn}" pitch`}
                  >
                    <button
                      id={`elev-nudge-up-${idx}`}
                      type="button"
                      className="rc-step-btn"
                      title={`Raise L${idx + 1} by +${pitchIn}"`}
                      aria-label={`Raise beam level ${idx + 1} by ${pitchIn} inches`}
                      onClick={() => applyBeamElevationIn(idx, c.tobInches + pitchIn)}
                    >
                      +{pitchIn}&quot;
                    </button>
                    <button
                      id={`elev-nudge-down-${idx}`}
                      type="button"
                      className="rc-step-btn"
                      title={`Lower L${idx + 1} by -${pitchIn}"`}
                      aria-label={`Lower beam level ${idx + 1} by ${pitchIn} inches`}
                      onClick={() => applyBeamElevationIn(idx, c.tobInches - pitchIn)}
                    >
                      -{pitchIn}&quot;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}
