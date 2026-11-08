import { bayTypeForRun, type Command } from '@rms/studio-model';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ELEV_VB_PAD_BOTTOM_UM,
  ELEV_VB_PAD_TOP_UM,
  ElevationSvg,
  beamFaceHeightInFromPart,
  buildDocumentElevation,
  computeElevationClearances,
  renderElevationCanvas,
  snapToPitchInches,
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
 * The elevation view — build-plan **S3.3** upgraded with CAD Direct Canvas Manipulation:
 * 1. Snap-to-Pitch Drag & Drop (2" teardrop / 3" structural punch pitch)
 * 2. Physical Beam Face Thickness, Upright Diagonal Bracing & Slab/Ceiling Limits
 * 3. Ghosted Pallet Loads & Dynamic Lift-Off Clearance Clash Detection
 * 4. Anchored Coordinate Overlays & Inline Click-to-Type Dimension Editing (T.O.B.)
 */
export default function ElevationView(): React.JSX.Element {
  const { session, runCommand } = useStudioSession();
  const doc = session.document;
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];

  const defaultBeamFaceIn = bt !== undefined ? beamFaceHeightInFromPart(bt.beamPart) : 4.0;
  const [pitchIn, setPitchIn] = useState<number>(2);
  const [beamFaceIn, setBeamFaceIn] = useState<number>(defaultBeamFaceIn);
  const [showLoads, setShowLoads] = useState<boolean>(true);
  const [minLiftOffIn, setMinLiftOffIn] = useState<number>(4);
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

  const elevationDisplayList = useMemo(() => buildDocumentElevation(doc), [doc]);
  const extentHeightUm = elevationDisplayList.extent.height;
  const totalVbHeightUm = extentHeightUm + ELEV_VB_PAD_TOP_UM + ELEV_VB_PAD_BOTTOM_UM;

  const yPercentForInches = (elevIn: number): number => {
    const elevUm = elevIn * UM_PER_INCH;
    const svgY = extentHeightUm - elevUm + ELEV_VB_PAD_TOP_UM;
    return Math.max(4, Math.min(96, Math.round((svgY / totalVbHeightUm) * 10000) / 100));
  };

  const clearHeightTopPct = yPercentForInches(clearHeightIn);
  const deflectorTopPct = Math.max(
    yPercentForInches(deflectorIn),
    Math.min(92, clearHeightTopPct + 6.5),
  );

  // Keep the HTML5 canvas layer synchronized with state
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
    });
  }, [doc, showLoads, beamFaceIn, minLiftOffIn, draggingBeamIdx]);

  const applyBeamElevationIn = (beamIdx: number, rawInches: number): void => {
    if (bt === undefined) return;
    const snappedIn = snapToPitchInches(rawInches, pitchIn);

    // Ensure ascending order between adjacent beam levels so setBeamLevel succeeds
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
        : snapToPitchInches(Math.round((bt.beamLevels[0] ?? 60 * UM_PER_INCH) / UM_PER_INCH), pitchIn);

    const cmds: Command[] = [];
    // Process from top level down so ascending order is never violated mid-batch
    const targetLevelsIn = bt.beamLevels.map(
      (_, idx) => firstLevelIn + idx * minStepIn,
    );

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

  return (
    <section className="elevation-view" aria-labelledby="view-heading-elevation">
      <div className="elevation-header">
        <div className="elevation-title-group">
          <h1 id="view-heading-elevation" className="elevation-title">
            Elevation
          </h1>
          {bt !== undefined && (
            <span className="elevation-sub">
              {bt.name} · {bt.uprightPart} · {bt.beamPart} ({beamFaceIn.toFixed(1)}&quot; face) ·{' '}
              {bt.beamLevels.length} beam levels · {pitchIn}&quot; punch pitch
            </span>
          )}
        </div>

        {/* Interactive CAD Elevation Toolbar */}
        <div
          id="elevation-cad-toolbar"
          className="elevation-toolbar"
          role="toolbar"
          aria-label="Elevation CAD controls"
        >
          <label htmlFor="elev-pitch-select" className="elev-toolbar-label">
            Pitch
            <select
              id="elev-pitch-select"
              aria-label="Punch Pitch"
              className="pf-input dock-compact-select"
              value={String(pitchIn)}
              onChange={(e) => setPitchIn(Number(e.target.value))}
            >
              <option value="2">2&quot; Teardrop</option>
              <option value="3">3&quot; Structural</option>
              <option value="4">4&quot; Slotted</option>
            </select>
          </label>

          <label htmlFor="elev-beam-face-select" className="elev-toolbar-label">
            Beam Face
            <select
              id="elev-beam-face-select"
              aria-label="Beam Face Height"
              className="pf-input dock-compact-select"
              value={String(beamFaceIn)}
              onChange={(e) => setBeamFaceIn(Number(e.target.value))}
            >
              <option value="3.5">3.5&quot; Step</option>
              <option value="4">4.0&quot; Step</option>
              <option value="4.5">4.5&quot; Step</option>
              <option value="5">5.0&quot; Step</option>
              <option value="5.5">5.5&quot; Step</option>
              <option value="6">6.0&quot; Channel</option>
            </select>
          </label>

          <label htmlFor="elev-min-liftoff-select" className="elev-toolbar-label">
            Min Lift-Off
            <select
              id="elev-min-liftoff-select"
              aria-label="Minimum Lift-Off Clearance"
              className="pf-input dock-compact-select"
              value={String(minLiftOffIn)}
              onChange={(e) => setMinLiftOffIn(Number(e.target.value))}
            >
              <option value="4">4&quot; Standard</option>
              <option value="6">6&quot; Reach Truck</option>
            </select>
          </label>

          <button
            id="elev-toggle-loads-btn"
            type="button"
            className="pf-btn"
            aria-pressed={showLoads}
            onClick={() => setShowLoads((prev) => !prev)}
          >
            {showLoads ? 'Show Loads: ON' : 'Show Loads: OFF'}
          </button>

          {bt !== undefined && (
            <button
              id="elev-add-level-btn"
              type="button"
              className="pf-btn"
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
              + Add Beam Level
            </button>
          )}

          {clashItems.length > 0 && (
            <button
              id="elev-autofix-liftoff-btn"
              type="button"
              className="pf-btn elev-autofix-btn"
              onClick={autoSpaceBeamsForClearance}
            >
              Auto-Space Beams ({minLiftOffIn}&quot;+ Clear)
            </button>
          )}
        </div>
      </div>

      {/* Live Clash & Clearance Status Banner */}
      <div
        id="elev-clash-banner"
        className={
          clashItems.length > 0
            ? 'elev-clash-banner elev-clash-banner-alert'
            : 'elev-clash-banner elev-clash-banner-ok'
        }
        role="status"
      >
        <span>
          {clashItems.length > 0
            ? `CLASH DETECTED (${clashItems.length}): ${clashItems
                .map((c) =>
                  c.isCeilingClash
                    ? `${c.label} exceeds ${clearHeightIn}" Clear Height ceiling`
                    : `${c.label} lift-off is ${c.liftOffClearanceInches.toFixed(1)}" (< ${minLiftOffIn}" min)`,
                )
                .join(' · ')}`
            : `All ${clearances.length} storage levels meet ≥ ${minLiftOffIn}" forklift lift-off clearance & ${clearHeightIn}" ceiling limit.`}
        </span>
        {statusMessage !== null && (
          <span id="elev-status-readout" className="elev-status-readout">
            {statusMessage}
          </span>
        )}
      </div>

      {/* Interactive CAD Stage: HTML5 Canvas + SVG DisplayList + Anchored Coordinate Overlays */}
      <div
        ref={stageRef}
        id="elevation-interactive-stage"
        className="elevation-stage"
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
      >
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
          onBeamPointerDown={(idx) => setDraggingBeamIdx(idx)}
          onDimensionLabelClick={(idx) => {
            if (bt === undefined || bt.beamLevels[idx] === undefined) return;
            const valIn = Math.round(bt.beamLevels[idx]! / UM_PER_INCH);
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

        {/* Anchored HTML Coordinate Overlays (Ceiling, Deflector, and Beam T.O.B. Dimension Pills) */}
        <div
          id="elev-coordinate-overlays"
          className="elev-coordinate-overlays"
          aria-label="Interactive elevation dimension overlays"
        >
          {/* Building Clear Height Ceiling Limit Overlay */}
          <div
            id="elev-clear-height-overlay"
            className="elev-coord-pill elev-coord-pill-ceiling"
            style={{ top: `${clearHeightTopPct}%` }}
          >
            <span className="elev-coord-tick elev-coord-tick-ceiling" aria-hidden="true" />
            <button
              id="elev-clear-height-tag"
              type="button"
              className="elev-coord-btn elev-coord-btn-ceiling"
              title="Click to set building Clear Height ceiling limit (in)"
              onClick={() => {
                setEditingTarget({
                  kind: 'clear-height',
                  valueIn: clearHeightIn,
                  topPct: clearHeightTopPct,
                });
                setEditingInputVal(String(clearHeightIn));
              }}
            >
              Clear height {clearHeightIn}&quot; ({Math.round(clearHeightIn * 25.4)} mm){' '}
              <span className="elev-verify-tag">
                {doc.building.clearHeight.established === 'UNKNOWN' ? 'VERIFY' : 'VERIFIED'}
              </span>
            </button>
          </div>

          {/* Sprinkler Deflector Limit Overlay */}
          <div
            id="elev-deflector-overlay"
            className="elev-coord-pill elev-coord-pill-deflector"
            style={{ top: `${deflectorTopPct}%` }}
          >
            <span className="elev-coord-tick elev-coord-tick-deflector" aria-hidden="true" />
            <button
              id="elev-deflector-tag"
              type="button"
              className="elev-coord-btn elev-coord-btn-deflector"
              title="Click to set Sprinkler Deflector elevation (in)"
              onClick={() => {
                setEditingTarget({
                  kind: 'deflector',
                  valueIn: deflectorIn,
                  topPct: deflectorTopPct,
                });
                setEditingInputVal(String(deflectorIn));
              }}
            >
              Sprinkler deflector {deflectorIn}&quot; ({Math.round(deflectorIn * 25.4)} mm){' '}
              <span className="elev-verify-tag">
                {doc.building.deflectorElev.established === 'UNKNOWN' ? 'VERIFY' : 'VERIFIED'}
              </span>
            </button>
          </div>

          {/* Anchored Beam Level T.O.B. Dimension Overlays */}
          {beamClearances.map((c) => {
            const idx = c.levelIndex;
            const topPct = yPercentForInches(c.tobInches);
            return (
              <div
                key={c.levelId}
                id={`elev-dim-pill-${idx}`}
                data-elev-dim-pill={idx}
                data-elev-clash={c.isLiftOffClash || c.isCeilingClash ? 'true' : 'false'}
                className={
                  c.isLiftOffClash || c.isCeilingClash
                    ? 'elev-coord-pill elev-coord-pill-clash'
                    : 'elev-coord-pill'
                }
                style={{ top: `${topPct}%` }}
              >
                <span className="elev-coord-tick" aria-hidden="true" />
                <button
                  id={`elev-dim-btn-${idx}`}
                  type="button"
                  className="elev-coord-btn"
                  title={`Click to type L${idx + 1} T.O.B. elevation in inches (snaps to ${pitchIn}" pitch)`}
                  onClick={() => {
                    setEditingTarget({
                      kind: 'beam',
                      beamIndex: idx,
                      valueIn: c.tobInches,
                      topPct,
                    });
                    setEditingInputVal(String(c.tobInches));
                  }}
                >
                  <strong className="elev-tob-num">
                    {c.tobInches.toFixed(0)}&quot; ({Math.round(c.tobInches * 25.4)} mm)
                  </strong>{' '}
                  <span className="elev-tob-tag">T.O.B. · L{idx + 1}</span>
                </button>
                <span
                  className={
                    c.isLiftOffClash
                      ? 'elev-liftoff-badge elev-liftoff-badge-clash'
                      : 'elev-liftoff-badge'
                  }
                >
                  {c.isLiftOffClash
                    ? `CLASH: ${c.liftOffClearanceInches.toFixed(1)}" lift-off`
                    : `${c.liftOffClearanceInches.toFixed(1)}" lift-off`}
                </span>
                <div className="elev-pitch-steppers" role="group" aria-label={`Nudge L${idx + 1} by ${pitchIn}" pitch`}>
                  <button
                    id={`elev-nudge-up-${idx}`}
                    type="button"
                    className="elev-step-btn"
                    title={`Raise L${idx + 1} by +${pitchIn}"`}
                    aria-label={`Raise beam level ${idx + 1} by ${pitchIn} inches`}
                    onClick={() => applyBeamElevationIn(idx, c.tobInches + pitchIn)}
                  >
                    +{pitchIn}&quot;
                  </button>
                  <button
                    id={`elev-nudge-down-${idx}`}
                    type="button"
                    className="elev-step-btn"
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

          {/* Inline Click-to-Type Dimension Input Popover */}
          {editingTarget !== null && (
            <div
              id="elev-inline-editor-popover"
              className="elev-inline-editor"
              style={{ top: `${editingTarget.topPct}%` }}
            >
              <label htmlFor="elev-inline-dim-input" className="elev-inline-label">
                {editingTarget.kind === 'beam'
                  ? `L${(editingTarget.beamIndex ?? 0) + 1} T.O.B. (in):`
                  : editingTarget.kind === 'clear-height'
                    ? 'Clear Height Ceiling (in):'
                    : 'Sprinkler Deflector (in):'}
              </label>
              <input
                id="elev-inline-dim-input"
                autoFocus
                type="number"
                step={editingTarget.kind === 'beam' ? pitchIn : 1}
                className="elev-inline-input"
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
                className="pf-btn pf-btn-small"
                onClick={commitInlineEdit}
              >
                Apply
              </button>
              <button
                id="elev-inline-cancel-btn"
                type="button"
                className="pf-btn pf-btn-small"
                onClick={() => setEditingTarget(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
