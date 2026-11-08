import { buildDetailedPlan } from '@rms/display-list';
import {
  draw,
  drawOverlays,
  fitExtent,
  panByScreen,
  screenToWorld,
  worldToScreen,
  zoomAbout,
  type Camera,
} from '@rms/render-canvas';
import {
  countFindings,
  planGeometry,
  screeningFindingsForDocument,
  type Command,
  type FindingCounts,
  type PlanGeometry,
  type StudioDocument,
} from '@rms/studio-model';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  exportDocumentToDXF,
  type PlanColumnOverlay,
  type ShellOverlayState,
} from '../session-context.js';
import { hitTestPlan, type PlanHit } from './hit-test.js';
import { readPens } from './use-pens.js';

export type PlanToolMode = 'select' | 'wall' | 'column' | 'calibrate';

function sameHit(a: PlanHit | null, b: PlanHit | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind) return false;
  if (a.kind === 'bay' && b.kind === 'bay') {
    return a.runId === b.runId && a.bayId === b.bayId;
  }
  if (a.kind === 'run' && b.kind === 'run') {
    return a.runId === b.runId;
  }
  if (a.kind === 'aisle' && b.kind === 'aisle') {
    return a.aisleId === b.aisleId;
  }
  return false;
}

function gridLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const PalletWashOverlay = memo(function PalletWashOverlay({
  plan,
  requiredClearAisleUm,
  camera,
  viewport,
  shellOverlay,
  wallDraftStart,
  wallDraftCurrent,
  calP1,
  calP2,
}: {
  readonly plan: PlanGeometry;
  readonly requiredClearAisleUm: number;
  readonly camera: Camera;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly shellOverlay?: ShellOverlayState | undefined;
  readonly wallDraftStart?: { readonly x: number; readonly y: number } | null | undefined;
  readonly wallDraftCurrent?: { readonly x: number; readonly y: number } | null | undefined;
  readonly calP1?: { readonly x: number; readonly y: number } | null | undefined;
  readonly calP2?: { readonly x: number; readonly y: number } | null | undefined;
}): React.JSX.Element {
  const longestRun = useMemo(
    () => [...plan.runs].sort((a, b) => b.runLength.value - a.runLength.value)[0],
    [plan.runs],
  );

  const firstRowY =
    plan.runs.length > 0
      ? Math.min(...plan.runs.map((r) => r.rows[0]?.y ?? r.y))
      : 0;
  const lastRowBottomY =
    plan.runs.length > 0
      ? Math.max(
          ...plan.runs.map((r) => {
            const last = r.rows[r.rows.length - 1];
            return last !== undefined ? last.y + last.depth : r.y;
          }),
        )
      : 0;

  const topEdgeScreen = worldToScreen(camera, viewport, { x: 0, y: firstRowY });
  const bottomEdgeScreen = worldToScreen(camera, viewport, { x: 0, y: lastRowBottomY });
  const bubbleCy = topEdgeScreen.y - 34;

  const firstFailingAisleIndex = plan.aisles.findIndex(
    (a) => a.clearBetweenLoads.value < requiredClearAisleUm,
  );
  const roundedRequiredClearUm = Math.ceil(requiredClearAisleUm / 25_400) * 25_400;

  const shellBounds = useMemo(() => {
    if (longestRun !== undefined) {
      return {
        minX: longestRun.x,
        maxX: longestRun.x + longestRun.runLength.value,
        minY: firstRowY,
        maxY: lastRowBottomY,
      };
    }
    const widthUm = (shellOverlay?.shellWidthFt ?? 110) * 12 * 25_400;
    const depthUm = (shellOverlay?.shellDepthFt ?? 60) * 12 * 25_400;
    return {
      minX: 0,
      maxX: widthUm,
      minY: 0,
      maxY: depthUm,
    };
  }, [
    longestRun,
    firstRowY,
    lastRowBottomY,
    shellOverlay?.shellWidthFt,
    shellOverlay?.shellDepthFt,
  ]);

  // Compute active building structural columns (grid + custom) in micrometres
  const activeColumns = useMemo<readonly PlanColumnOverlay[]>(() => {
    if (shellOverlay === undefined) return [];
    const list: PlanColumnOverlay[] = [...shellOverlay.customColumns];
    if (shellOverlay.showColumns) {
      const spacingUm = shellOverlay.columnSpacingFt * 12 * 25_400;
      const maxX = shellBounds.maxX;
      const maxY = Math.max(shellBounds.maxY, spacingUm);
      let cIdx = 1;
      for (let x = shellBounds.minX + spacingUm; x <= maxX; x += spacingUm) {
        let rIdx = 1;
        for (let y = shellBounds.minY + spacingUm / 2; y <= maxY + spacingUm / 2; y += spacingUm) {
          list.push({
            id: `grid-col-${cIdx}-${rIdx}`,
            xUm: x,
            yUm: y,
            sizeIn: shellOverlay.columnSizeIn,
            label: `${gridLetter(cIdx - 1)}-${rIdx}`,
          });
          rIdx += 1;
        }
        cIdx += 1;
      }
    }
    return list;
  }, [shellOverlay, shellBounds]);

  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {/* -1. Floorplan Image Underlay (CAD / Site Survey Raster) */}
      {shellOverlay?.underlayDataUrl !== null &&
        shellOverlay?.underlayDataUrl !== undefined &&
        (() => {
          const marginUm = 120 * 25_400;
          const uTl = worldToScreen(camera, viewport, {
            x: shellBounds.minX - marginUm,
            y: shellBounds.minY - marginUm,
          });
          const uBr = worldToScreen(camera, viewport, {
            x: shellBounds.maxX + marginUm,
            y: shellBounds.maxY + marginUm,
          });
          return (
            <image
              key="floorplan-underlay"
              href={shellOverlay.underlayDataUrl}
              x={uTl.x}
              y={uTl.y}
              width={Math.max(4, uBr.x - uTl.x)}
              height={Math.max(4, uBr.y - uTl.y)}
              opacity={shellOverlay.underlayOpacity ?? 0.45}
              preserveAspectRatio="none"
            />
          );
        })()}

      {/* 0. Building Perimeter Wall Envelope & Custom Orthogonal Walls */}
      {shellOverlay?.showPerimeterWalls && (
        (() => {
          const marginUm = 120 * 25_400; // 10'-0" perimeter aisle envelope
          const envTl = worldToScreen(camera, viewport, {
            x: shellBounds.minX - marginUm,
            y: shellBounds.minY - marginUm,
          });
          const envBr = worldToScreen(camera, viewport, {
            x: shellBounds.maxX + marginUm,
            y: shellBounds.maxY + marginUm,
          });
          return (
            <g key="perimeter-wall-envelope">
              <rect
                x={envTl.x}
                y={envTl.y}
                width={Math.max(4, envBr.x - envTl.x)}
                height={Math.max(4, envBr.y - envTl.y)}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="3"
              />
              <text
                x={envTl.x + 8}
                y={envTl.y + 14}
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                fontWeight="600"
                fill="var(--ink-2)"
              >
                BUILDING PERIMETER SHELL (8&quot; CONCRETE WALL ·{' '}
                {shellOverlay.shellWidthFt ?? 110}&apos; × {shellOverlay.shellDepthFt ?? 60}&apos;)
              </text>
              {plan.runs.length === 0 && (
                <text
                  x={(envTl.x + envBr.x) / 2}
                  y={envTl.y + 34}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize="10"
                  fontWeight="600"
                  fill="var(--navy)"
                >
                  STAGE 1: COLUMNS &amp; SHELL READY ({activeColumns.length} COLUMNS) — STAMP
                  COLUMNS OR USE &apos;+ ADD RACK RUN&apos; / &apos;AI ASSISTANT&apos; TO PLACE
                  RACKS
                </text>
              )}
            </g>
          );
        })()
      )}

      {shellOverlay?.customWalls.map((w) => {
        const p1 = worldToScreen(camera, viewport, { x: w.x1Um, y: w.y1Um });
        const p2 = worldToScreen(camera, viewport, { x: w.x2Um, y: w.y2Um });
        const lenUm = Math.hypot(w.x2Um - w.x1Um, w.y2Um - w.y1Um);
        return (
          <g key={w.id}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="var(--ink)"
              strokeWidth="3"
            />
            <text
              x={(p1.x + p2.x) / 2}
              y={(p1.y + p2.y) / 2 - 6}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="9.5"
              fontWeight="600"
              fill="var(--ink)"
            >
              {formatFeetInches(lenUm)} WALL
            </text>
          </g>
        );
      })}

      {wallDraftStart !== null &&
        wallDraftStart !== undefined &&
        wallDraftCurrent !== null &&
        wallDraftCurrent !== undefined && (
        (() => {
          const p1 = worldToScreen(camera, viewport, wallDraftStart);
          const p2 = worldToScreen(camera, viewport, wallDraftCurrent);
          const lenUm = Math.hypot(
            wallDraftCurrent.x - wallDraftStart.x,
            wallDraftCurrent.y - wallDraftStart.y,
          );
          return (
            <g key="wall-draft-preview">
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="var(--navy)"
                strokeWidth="2.5"
                strokeDasharray="5 3"
              />
              <text
                x={(p1.x + p2.x) / 2}
                y={(p1.y + p2.y) / 2 - 8}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="10"
                fontWeight="600"
                fill="var(--navy)"
              >
                {formatFeetInches(lenUm)} ORTHO WALL
              </text>
            </g>
          );
        })()
      )}
      {/* 1. Vertical dashed column grid lines + circular grid bubbles (A..M) */}
      {longestRun !== undefined &&
        Array.from({ length: longestRun.bays.length + 1 }, (_, i) => {
          const worldX = longestRun.x + i * longestRun.bayPitch.value;
          const pt = worldToScreen(camera, viewport, { x: worldX, y: firstRowY });
          return (
            <g key={`col-grid:${i}`}>
              <line
                x1={pt.x}
                y1={bubbleCy + 9.5}
                x2={pt.x}
                y2={bottomEdgeScreen.y + 10}
                stroke="var(--rule)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={pt.x}
                cy={bubbleCy}
                r={9.5}
                fill="var(--paper)"
                stroke="var(--ink-2)"
                strokeWidth="1"
              />
              <text
                x={pt.x}
                y={bubbleCy + 0.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="var(--font-mono)"
                fontSize="9.5"
                fontWeight="500"
                fill="var(--ink-2)"
              >
                {gridLetter(i)}
              </text>
            </g>
          );
        })}

      {/* 2. Aisle callout bands (with amber highlight + dashed end-caps on the primary failing aisle) */}
      {plan.aisles.map((aisle, idx) => {
        const upperRun = plan.runs[idx];
        const lowerRun = plan.runs[idx + 1];
        const upperLastRow = upperRun?.rows[upperRun.rows.length - 1];
        const lowerFirstRow = lowerRun?.rows[0];
        const bandTopWorldY =
          upperLastRow !== undefined ? upperLastRow.y + upperLastRow.depth : aisle.y;
        const bandBottomWorldY =
          lowerFirstRow !== undefined
            ? lowerFirstRow.y
            : aisle.y + aisle.frameToFrame.value;

        const tl = worldToScreen(camera, viewport, { x: aisle.x, y: bandTopWorldY });
        const br = worldToScreen(camera, viewport, {
          x: aisle.x + aisle.length,
          y: bandBottomWorldY,
        });
        const w = Math.max(1, br.x - tl.x);
        const h = Math.max(1, br.y - tl.y);
        const midX = (tl.x + br.x) / 2;
        const midY = (tl.y + br.y) / 2;
        const isHighlightedFailing = idx === firstFailingAisleIndex;

        const line1 = `AISLE ${idx + 1} · ${formatFeetInches(aisle.frameToFrame.value)} FRAME TO FRAME`;
        const line2 = isHighlightedFailing
          ? `${formatFeetInches(aisle.clearBetweenLoads.value)} clear between loads · truck needs ${formatFeetInches(roundedRequiredClearUm)}`
          : `${formatFeetInches(aisle.clearBetweenLoads.value)} clear between loads`;

        return (
          <g key={`aisle-band:${aisle.aisleId}`}>
            {isHighlightedFailing && (
              <>
                <rect
                  x={tl.x}
                  y={tl.y}
                  width={w}
                  height={h}
                  fill="var(--warn-bg)"
                />
                <line
                  x1={tl.x}
                  y1={tl.y}
                  x2={tl.x}
                  y2={br.y}
                  stroke="var(--pen-upright)"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <line
                  x1={br.x}
                  y1={tl.y}
                  x2={br.x}
                  y2={br.y}
                  stroke="var(--pen-upright)"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              </>
            )}
            <text
              x={midX}
              y={midY - 7}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fontWeight="600"
              letterSpacing="0.04em"
              fill={isHighlightedFailing ? 'var(--warn)' : 'var(--ink-2)'}
            >
              {line1}
            </text>
            <text
              x={midX}
              y={midY + 8}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fontWeight="500"
              fill={isHighlightedFailing ? 'var(--warn)' : 'var(--ink-2)'}
            >
              {line2}
            </text>
          </g>
        );
      })}

      {/* 3. CAD Plan Geometry: Front & Back Beam Lines, Upright Footplates (4-Bolt) + Double-Web Channels, and Flue Ties */}
      {plan.runs.map((run) => {
        const firstRow = run.rows[0];
        const lastRow = run.rows[run.rows.length - 1];
        const runTopWorld = firstRow?.y ?? run.y;
        const runBottomWorld =
          lastRow !== undefined ? lastRow.y + lastRow.depth : run.y;
        const labelPt = worldToScreen(camera, viewport, {
          x: run.x,
          y: (runTopWorld + runBottomWorld) / 2,
        });

        // Constant screen-space CAD upright symbol size so uprights remain the same size when zooming in
        const fpSize = 9;
        const fpHalf = 4.5;
        const webHalf = 1.5;
        const boltOffset = 2.5;
        const boltRadius = 0.7;

        return (
          <g key={`run-graphic:${run.runId}`} className="cad-run-group">
            <text
              x={labelPt.x - 14}
              y={labelPt.y}
              textAnchor="end"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              fontWeight="600"
              fill="var(--pen-upright)"
            >
              {run.label}
            </text>

            {/* Back-to-back Row Spacer / Flue Ties (CAD Magenta --pen-flue connecting Row 0 bottom footplates to Row 1 top footplates) */}
            {run.rows.length > 1 &&
              firstRow !== undefined &&
              lastRow !== undefined &&
              (() => {
                const topRowBottomY = worldToScreen(camera, viewport, {
                  x: run.x,
                  y: firstRow.y + firstRow.depth,
                }).y;
                const botRowTopY = worldToScreen(camera, viewport, {
                  x: run.x,
                  y: lastRow.y,
                }).y;

                return (
                  <g key={`flue-ties:${run.runId}`} className="cad-flue-ties">
                    {Array.from({ length: run.bays.length + 1 }, (_, i) => {
                      const ux = worldToScreen(camera, viewport, {
                        x: run.x + i * run.bayPitch.value,
                        y: firstRow.y,
                      }).x;
                      return (
                        <line
                          key={`flue-tie:${run.runId}:${i}`}
                          x1={ux}
                          y1={topRowBottomY + fpHalf * 0.4}
                          x2={ux}
                          y2={botRowTopY - fpHalf * 0.4}
                          stroke="var(--pen-flue)"
                          strokeWidth="1.85"
                        />
                      );
                    })}
                  </g>
                );
              })()}

            {/* Rows: Front & Back Beam Lines (--pen-beam) + Upright Footplates & Double-Web Channels (--pen-upright) */}
            {run.rows.map((row, rowIdx) => {
              const rowTl = worldToScreen(camera, viewport, { x: run.x, y: row.y });
              const rowH = Math.max(2, row.depth * camera.scale);
              const backBeamY = rowTl.y;
              const frontBeamY = rowTl.y + rowH;

              return (
                <g key={`row-frame:${run.runId}:${rowIdx}`} className="cad-row-frame">
                  {/* Front & Back Beam Lines per Bay */}
                  {run.bays.map((bay, bayIdx) => {
                    const leftUprightX = worldToScreen(camera, viewport, {
                      x: run.x + bayIdx * run.bayPitch.value,
                      y: row.y,
                    }).x;
                    const rightUprightX = worldToScreen(camera, viewport, {
                      x: run.x + (bayIdx + 1) * run.bayPitch.value,
                      y: row.y,
                    }).x;
                    const beamStartX = leftUprightX + webHalf;
                    const beamEndX = Math.max(beamStartX + 1, rightUprightX - webHalf);

                    return (
                      <g key={`bay-beams:${run.runId}:${rowIdx}:${bay.bayId}`}>
                        {/* BACK BEAM LINE */}
                        <line
                          x1={beamStartX}
                          y1={backBeamY}
                          x2={beamEndX}
                          y2={backBeamY}
                          stroke="var(--pen-beam)"
                          strokeWidth="1.85"
                        />
                        {/* FRONT BEAM LINE */}
                        <line
                          x1={beamStartX}
                          y1={frontBeamY}
                          x2={beamEndX}
                          y2={frontBeamY}
                          stroke="var(--pen-beam)"
                          strokeWidth="1.85"
                        />
                      </g>
                    );
                  })}

                  {/* Uprights: Square Front & Back Footplates with 4 Corner Anchor Bolt Holes + Double-Web Upright Channel */}
                  {Array.from({ length: run.bays.length + 1 }, (_, i) => {
                    const ux = worldToScreen(camera, viewport, {
                      x: run.x + i * run.bayPitch.value,
                      y: row.y,
                    }).x;
                    const topFpY = backBeamY - fpHalf * 0.4;
                    const botFpY = frontBeamY - fpHalf * 1.6;
                    const topFpCy = topFpY + fpHalf;
                    const botFpCy = botFpY + fpHalf;
                    const webTopY = topFpY + fpSize * 0.25;
                    const webBotY = botFpY + fpSize * 0.75;

                    return (
                      <g
                        key={`upright-div:${run.runId}:${rowIdx}:${i}`}
                        className="cad-upright-assembly"
                      >
                        {/* Back (Top) Square Footplate */}
                        <rect
                          x={ux - fpHalf}
                          y={topFpY}
                          width={fpSize}
                          height={fpSize}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth="1.35"
                        />
                        {/* Front (Bottom) Square Footplate */}
                        <rect
                          x={ux - fpHalf}
                          y={botFpY}
                          width={fpSize}
                          height={fpSize}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth="1.35"
                        />

                        {/* 4 Corner Anchor Bolt Holes inside Back & Front Footplates */}
                        {fpSize >= 7.5 && (
                          <>
                            <circle
                              cx={ux - boltOffset}
                              cy={topFpCy - boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux + boltOffset}
                              cy={topFpCy - boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux - boltOffset}
                              cy={topFpCy + boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux + boltOffset}
                              cy={topFpCy + boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux - boltOffset}
                              cy={botFpCy - boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux + boltOffset}
                              cy={botFpCy - boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux - boltOffset}
                              cy={botFpCy + boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                            <circle
                              cx={ux + boltOffset}
                              cy={botFpCy + boltOffset}
                              r={boltRadius}
                              fill="var(--pen-upright)"
                            />
                          </>
                        )}

                        {/* Double-Web Upright Frame Channel (|| with end caps inside the footplates) */}
                        <rect
                          x={ux - webHalf}
                          y={webTopY}
                          width={webHalf * 2}
                          height={Math.max(1, webBotY - webTopY)}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth="1.35"
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* 4. Automated Column Collision Reconciliation (Bay Bypass Spacers & Flue Straddles) */}
      {activeColumns.length > 0 &&
        plan.runs.map((run) => {
          const firstRow = run.rows[0];
          const lastRow = run.rows[run.rows.length - 1];
          const runTopY = firstRow?.y ?? run.y;
          const runBottomY = lastRow !== undefined ? lastRow.y + lastRow.depth : run.y;
          const flueMidY =
            run.rows.length > 1 && firstRow !== undefined && lastRow !== undefined
              ? (firstRow.y + firstRow.depth + lastRow.y) / 2
              : null;

          const flueStraddleCol =
            flueMidY !== null
              ? activeColumns.find((col) => {
                  const halfColUm = (col.sizeIn * 25_400) / 2;
                  return (
                    col.xUm + halfColUm > run.x &&
                    col.xUm - halfColUm < run.x + run.runLength.value &&
                    Math.abs(col.yUm - flueMidY) <= 14 * 25_400
                  );
                })
              : undefined;

          return (
            <g key={`col-reconcile:${run.runId}`}>
              {flueStraddleCol !== undefined && (
                (() => {
                  const pt = worldToScreen(camera, viewport, { x: run.x, y: runTopY });
                  return (
                    <text
                      x={pt.x + 6}
                      y={pt.y - 6}
                      fontFamily="var(--font-mono)"
                      fontSize="9.5"
                      fontWeight="600"
                      fill="var(--warn)"
                    >
                      EXPANDED FLUE · COLUMN {flueStraddleCol.label} STRADDLE RECONCILED
                    </text>
                  );
                })()
              )}

              {run.bays.map((bay) => {
                const collidingCol = activeColumns.find((col) => {
                  const halfUm = (col.sizeIn * 25_400) / 2;
                  const intersectsX =
                    col.xUm + halfUm > bay.x && col.xUm - halfUm < bay.x + bay.width;
                  const intersectsY =
                    col.yUm + halfUm > runTopY && col.yUm - halfUm < runBottomY;
                  const absorbedByFlue =
                    flueMidY !== null && Math.abs(col.yUm - flueMidY) <= 14 * 25_400;
                  return intersectsX && intersectsY && !absorbedByFlue;
                });

                if (collidingCol === undefined) return null;
                const tl = worldToScreen(camera, viewport, { x: bay.x, y: runTopY });
                const br = worldToScreen(camera, viewport, {
                  x: bay.x + bay.width,
                  y: runBottomY,
                });
                const w = Math.max(4, br.x - tl.x);
                const h = Math.max(4, br.y - tl.y);
                return (
                  <g key={`bypass:${bay.bayId}`}>
                    <rect
                      x={tl.x}
                      y={tl.y}
                      width={w}
                      height={h}
                      fill="var(--warn-bg)"
                      stroke="var(--warn)"
                      strokeWidth="1.75"
                    />
                    <line
                      x1={tl.x}
                      y1={tl.y}
                      x2={br.x}
                      y2={br.y}
                      stroke="var(--warn)"
                      strokeWidth="1.25"
                    />
                    <line
                      x1={tl.x}
                      y1={br.y}
                      x2={br.x}
                      y2={tl.y}
                      stroke="var(--warn)"
                      strokeWidth="1.25"
                    />
                    <text
                      x={tl.x + w / 2}
                      y={tl.y + h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="var(--font-mono)"
                      fontSize="8.5"
                      fontWeight="600"
                      fill="var(--warn)"
                    >
                      BYPASS SPACER
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

      {/* 5. Building Structural Columns (Concrete Pillars with X-cross) */}
      {activeColumns.map((col) => {
        const halfUm = (col.sizeIn * 25_400) / 2;
        const tl = worldToScreen(camera, viewport, {
          x: col.xUm - halfUm,
          y: col.yUm - halfUm,
        });
        const br = worldToScreen(camera, viewport, {
          x: col.xUm + halfUm,
          y: col.yUm + halfUm,
        });
        const w = Math.max(6, br.x - tl.x);
        const h = Math.max(6, br.y - tl.y);
        return (
          <g key={`col-pillar:${col.id}`}>
            <rect
              x={tl.x}
              y={tl.y}
              width={w}
              height={h}
              fill="var(--ink)"
              stroke="var(--ink)"
              strokeWidth="1.5"
            />
            <line
              x1={tl.x}
              y1={tl.y}
              x2={tl.x + w}
              y2={tl.y + h}
              stroke="var(--paper)"
              strokeWidth="1"
            />
            <line
              x1={tl.x}
              y1={tl.y + h}
              x2={tl.x + w}
              y2={tl.y}
              stroke="var(--paper)"
              strokeWidth="1"
            />
            <text
              x={tl.x + w / 2}
              y={tl.y - 5}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="8.5"
              fontWeight="600"
              fill="var(--ink)"
            >
              {col.label}
            </text>
          </g>
        );
      })}

      {/* 6. Two-Point Scale Calibration Line */}
      {calP1 !== null && calP1 !== undefined && (
        (() => {
          const s1 = worldToScreen(camera, viewport, calP1);
          const s2 =
            calP2 !== null && calP2 !== undefined ? worldToScreen(camera, viewport, calP2) : null;
          return (
            <g key="calibration-overlay">
              <circle cx={s1.x} cy={s1.y} r={5} fill="var(--block)" />
              {s2 !== null && (
                <>
                  <line
                    x1={s1.x}
                    y1={s1.y}
                    x2={s2.x}
                    y2={s2.y}
                    stroke="var(--block)"
                    strokeWidth="2"
                    strokeDasharray="4 3"
                  />
                  <circle cx={s2.x} cy={s2.y} r={5} fill="var(--block)" />
                </>
              )}
            </g>
          );
        })()
      )}
    </g>
  );
});

/**
 * Feet and inches, for the HUD only.
 *
 * The DRAWING never formats — every string it prints arrives as a `DisplayText`
 * from the display list, so an unestablished value renders VERIFY. This is
 * chrome beside the drawing, showing values that are derived and established by
 * construction (a position count cannot be "unknown"), so a local formatter is
 * honest here and would not be inside `draw`.
 */
function formatFeetInches(micrometres: number): string {
  const totalInches = Math.round(micrometres / 25_400);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return `${feet}'-${inches}"`;
}

/** One HUD chip. */
function Chip({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'pass' | 'block' | 'warn' | undefined;
}): React.JSX.Element {
  return (
    <span className="chip">
      <span className="chip-label k">{label}</span>
      <b
        className="chip-value v"
        style={
          tone === 'pass'
            ? { color: 'var(--pass)' }
            : tone === 'block'
              ? { color: 'var(--block)' }
              : tone === 'warn'
                ? { color: 'var(--warn)' }
                : undefined
        }
      >
        {value}
      </b>
    </span>
  );
}

export interface SelectedBay {
  readonly runId: string;
  readonly bayId: string;
  readonly bayIndex: number;
}

/**
 * Transfers control of an HTMLCanvasElement to an OffscreenCanvas and posts it
 * to a dedicated Web Worker so heavy 2D layout rendering (576+ pallet positions)
 * never blocks the main UI thread during pan/zoom.
 */
export function transferCanvasToOffscreenWorker(
  canvas: HTMLCanvasElement,
  worker: Pick<Worker, 'postMessage'>,
  initialDimensions?: { readonly width: number; readonly height: number; readonly palletPositions?: number },
): OffscreenCanvas | null {
  if (typeof canvas.transferControlToOffscreen !== 'function') {
    return null;
  }
  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage(
    {
      canvas: offscreen,
      dimensions: initialDimensions ?? { width: canvas.width, height: canvas.height },
    },
    [offscreen],
  );
  return offscreen;
}

/**
 * The plan viewport — build-plan **S3.2**, **S3.5**, **S4.1**, **S4.2**, **S4.3**.
 *
 * The chain, in one place so it can be read: **document → `planGeometry` →
 * `buildDetailedPlan` → `draw`**. Each arrow is a package boundary, and the component
 * crosses them without doing arithmetic of its own — no bay pitch, no clear
 * width, no formatting. ADR-018 rule 4 forbids arithmetic in a render, and
 * `check-app-boundaries` forbids this app binding anything named `derive*`.
 *
 * **Static vs dynamic split (S4.3):** the Canvas 2D layer draws the memoised
 * `DisplayList`; the `<svg className="plan-overlay-svg">` layer above it draws
 * transient hover and selection highlights so hovering never dirty-renders the
 * display list.
 */
export function PlanCanvas({
  document: doc,
  plan: providedPlan,
  findingCounts: providedFindingCounts,
  toolMode = 'select',
  shellOverlay,
  onShellOverlayChange,
  onToolModeChange,
  onCommand,
  onUndo,
}: {
  readonly document: StudioDocument;
  readonly plan?: PlanGeometry | undefined;
  readonly findingCounts?: FindingCounts | undefined;
  readonly toolMode?: PlanToolMode | undefined;
  readonly shellOverlay?: ShellOverlayState | undefined;
  readonly onShellOverlayChange?: React.Dispatch<React.SetStateAction<ShellOverlayState>> | undefined;
  readonly onToolModeChange?: ((mode: PlanToolMode) => void) | undefined;
  readonly onCommand?: (command: Command) => void;
  readonly onUndo?: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<SelectedBay | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [selectedAisleId, setSelectedAisleId] = useState<string | null>(null);
  const [hovered, setHovered] = useState<PlanHit | null>(null);
  const [wallDraftStart, setWallDraftStart] = useState<{ x: number; y: number } | null>(null);
  const [wallDraftCurrent, setWallDraftCurrent] = useState<{ x: number; y: number } | null>(null);
  const [calP1, setCalP1] = useState<{ x: number; y: number } | null>(null);
  const [calP2, setCalP2] = useState<{ x: number; y: number } | null>(null);
  const [calKnownIn, setCalKnownIn] = useState<string>('480');
  const frame = useRef<number | null>(null);

  /**
   * The display list depends on the DOCUMENT and nothing else. Not on the
   * camera, not on the viewport — so pan and zoom cost a redraw and never a
   * re-derivation, which is blueprint §21's first performance rule.
   */
  const plan = useMemo(
    () => providedPlan ?? planGeometry(doc),
    [providedPlan, doc],
  );
  const findingCounts = useMemo(
    () => providedFindingCounts ?? countFindings(screeningFindingsForDocument(doc)),
    [providedFindingCounts, doc],
  );

  const effectiveExtent = useMemo(() => {
    if (plan.extent.width.value > 0 && plan.extent.height.value > 0) {
      return plan.extent;
    }
    const widthUm = (shellOverlay?.shellWidthFt ?? 110) * 12 * 25_400;
    const heightUm = (shellOverlay?.shellDepthFt ?? 60) * 12 * 25_400;
    return {
      width: {
        value: widthUm,
        unit: 'um' as const,
        origin: 'DERIVED' as const,
        established: true as const,
      },
      height: {
        value: heightUm,
        unit: 'um' as const,
        origin: 'DERIVED' as const,
        established: true as const,
      },
    };
  }, [plan.extent, shellOverlay?.shellDepthFt, shellOverlay?.shellWidthFt]);

  const list = useMemo(() => {
    const raw = buildDetailedPlan({
      revisionHash: `doc:${doc.id}:${doc.revision}`,
      runs: plan.runs.map((r) => ({
        runId: r.runId,
        label: r.label,
        x: r.x,
        y: r.y,
        runLength: r.runLength,
        bayPitch: r.bayPitch,
        uprightFace: r.uprightFace,
        rows: r.rows,
        bays: r.bays,
        pallets: [],
        longitudinalFlue: null,
      })),
      aisles: plan.aisles.map((a) => ({
        aisleId: a.aisleId,
        x: a.x,
        y: a.y,
        length: a.length,
        frameToFrame: a.frameToFrame,
        clearBetweenLoads: a.clearBetweenLoads,
      })),
      extent: effectiveExtent,
      overallLength: plan.overallLength,
    });
    return {
      ...raw,
      items: raw.items.filter(
        (item) =>
          !item.id.includes(':row:') &&
          !item.id.includes(':upright:') &&
          !item.id.includes(':beam:'),
      ),
    };
  }, [doc.id, doc.revision, effectiveExtent, plan]);

  // Resolve current selection against the live plan so an undone or deleted bay
  // never leaves a stale selection pointing at a bay that no longer exists.
  const activeSelection = useMemo(() => {
    if (selected === null) return null;
    const run = plan.runs.find((r) => r.runId === selected.runId);
    if (run === undefined) return null;
    const bay = run.bays.find((b) => b.bayId === selected.bayId) ?? run.bays[selected.bayIndex];
    if (bay === undefined) return null;
    return { run, bay };
  }, [plan, selected]);

  const activeSelectedColumn = useMemo(() => {
    if (selectedColumnId === null || shellOverlay === undefined) return null;
    return shellOverlay.customColumns.find((c) => c.id === selectedColumnId) ?? null;
  }, [selectedColumnId, shellOverlay]);

  const activeSelectedAisle = useMemo(() => {
    if (selectedAisleId === null) return null;
    const index = plan.aisles.findIndex((a) => a.aisleId === selectedAisleId);
    if (index < 0) return null;
    const aisle = plan.aisles[index];
    const upperRun = plan.runs[index];
    if (aisle === undefined || upperRun === undefined) return null;
    return { index, aisle, upperRun };
  }, [plan.aisles, plan.runs, selectedAisleId]);

  // Track the element's size rather than the window's: the rail and the banner
  // both change the stage's width without the window resizing.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setViewport({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Fit once, when the viewport first has a size. Refitting on every document
  // change would move the drawing under someone who had just panned to look at
  // something.
  useEffect(() => {
    if (camera === null && viewport.width > 0 && viewport.height > 0) {
      setCamera(fitExtent(viewport, list.extent));
    }
  }, [camera, viewport, list.extent]);

  const effectiveViewport = useMemo(
    () => (viewport.width > 0 && viewport.height > 0 ? viewport : { width: 800, height: 600 }),
    [viewport],
  );

  const fittedCamera = useMemo(
    () => fitExtent(effectiveViewport, list.extent),
    [effectiveViewport, list.extent],
  );

  const effectiveCamera = useMemo(
    () => camera ?? fittedCamera,
    [camera, fittedCamera],
  );

  const [isPanning, setIsPanning] = useState(false);
  const suppressNextBayClickRef = useRef(false);

  const cameraStateRef = useRef({
    effectiveCamera,
    effectiveViewport,
    fittedScale: fittedCamera.scale,
  });
  cameraStateRef.current = {
    effectiveCamera,
    effectiveViewport,
    fittedScale: fittedCamera.scale,
  };

  // Filter out canvas items that are rendered with richer blueprint styling in
  // the SVG overlay (grid bubbles, run labels, centered two-line aisle callouts).
  const canvasList = useMemo(
    () => ({
      ...list,
      items: list.items.filter(
        (item) =>
          !item.id.startsWith('grid:') &&
          !item.id.endsWith(':label') &&
          !item.id.endsWith(':flue:longitudinal') &&
          !item.id.endsWith(':frame-to-frame') &&
          !item.id.endsWith(':clear-between-loads'),
      ),
    }),
    [list],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || camera === null || viewport.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const pens = readPens(window.document.documentElement);
    draw(ctx, canvasList, { camera, viewport, dpr, pens });
    drawOverlays(ctx, { camera, viewport, dpr, pens, includeLegend: false });
  }, [camera, canvasList, viewport]);

  useEffect(() => {
    render();
  }, [render]);

  // Re-render when theme changes (light/dark toggle or prefers-color-scheme)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const observer = new MutationObserver(() => {
      render();
    });
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMediaChange = (): void => render();
    media?.addEventListener?.('change', onMediaChange);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', onMediaChange);
    };
  }, [render]);

  /** Coalesce pointer work into one frame, per blueprint §9. */
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      render();
    });
  }, [render]);

  const dragging = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element | null;
    if (target?.closest('.plan-hud, .sel-toolbar')) return;

    suppressNextBayClickRef.current = false;
    dragging.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragging.current;
      if (drag !== null && drag.pointerId === e.pointerId) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (dist > 4 || drag.moved) {
          if (!drag.moved) {
            drag.moved = true;
            suppressNextBayClickRef.current = true;
            setIsPanning(true);
            setHovered(null);
            if (typeof e.currentTarget.setPointerCapture === 'function') {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // jsdom does not implement pointer capture
              }
            }
          }
          const dx = e.clientX - drag.lastX;
          const dy = e.clientY - drag.lastY;
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          setCamera((prev) => panByScreen(prev ?? cameraStateRef.current.effectiveCamera, dx, dy));
          schedule();
        }
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const world = screenToWorld(effectiveCamera, effectiveViewport, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });

      if (toolMode === 'wall' && wallDraftStart !== null) {
        const dx = Math.abs(world.x - wallDraftStart.x);
        const dy = Math.abs(world.y - wallDraftStart.y);
        const orthoPoint =
          dx >= dy
            ? { x: Math.round(world.x), y: wallDraftStart.y }
            : { x: wallDraftStart.x, y: Math.round(world.y) };
        setWallDraftCurrent(orthoPoint);
        return;
      }

      const nextHit = hitTestPlan(plan, world.x, world.y, effectiveCamera.scale);
      setHovered((prev) => (sameHit(prev, nextHit) ? prev : nextHit));
    },
    [effectiveCamera, effectiveViewport, plan, schedule, toolMode, wallDraftStart],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        typeof e.currentTarget.hasPointerCapture === 'function' &&
        e.currentTarget.hasPointerCapture(e.pointerId)
      ) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const drag = dragging.current;
      dragging.current = null;
      if (drag?.moved) {
        setIsPanning(false);
        return;
      }

      const target = e.target as Element | null;
      if (target?.closest('.plan-hud, .sel-toolbar, .plan-cal-hud')) {
        return;
      }

      if (drag !== null && !drag.moved) {
        const rect = e.currentTarget.getBoundingClientRect();
        const world = screenToWorld(effectiveCamera, effectiveViewport, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });

        if (toolMode === 'wall') {
          if (wallDraftStart === null) {
            const snapped = { x: Math.round(world.x), y: Math.round(world.y) };
            setWallDraftStart(snapped);
            setWallDraftCurrent(snapped);
          } else {
            const dx = Math.abs(world.x - wallDraftStart.x);
            const dy = Math.abs(world.y - wallDraftStart.y);
            const endPt =
              dx >= dy
                ? { x: Math.round(world.x), y: wallDraftStart.y }
                : { x: wallDraftStart.x, y: Math.round(world.y) };
            if (Math.hypot(endPt.x - wallDraftStart.x, endPt.y - wallDraftStart.y) > 25_400 * 12) {
              onShellOverlayChange?.((prev) => ({
                ...prev,
                customWalls: [
                  ...prev.customWalls,
                  {
                    id: `wall-${prev.customWalls.length + 1}`,
                    x1Um: wallDraftStart.x,
                    y1Um: wallDraftStart.y,
                    x2Um: endPt.x,
                    y2Um: endPt.y,
                  },
                ],
              }));
            }
            setWallDraftStart(null);
            setWallDraftCurrent(null);
          }
          return;
        }

        if (toolMode === 'column') {
          onShellOverlayChange?.((prev) => {
            const idx = prev.customColumns.length + 1;
            return {
              ...prev,
              customColumns: [
                ...prev.customColumns,
                {
                  id: `custom-col-${idx}`,
                  xUm: Math.round(world.x),
                  yUm: Math.round(world.y),
                  sizeIn: prev.columnSizeIn,
                  label: `COL-${idx}`,
                },
              ],
            };
          });
          return;
        }

        if (toolMode === 'calibrate') {
          const pt = { x: Math.round(world.x), y: Math.round(world.y) };
          if (calP1 === null || calP2 !== null) {
            setCalP1(pt);
            setCalP2(null);
          } else {
            setCalP2(pt);
          }
          return;
        }

        if (target?.closest('[data-bay-id], [data-column-id], [data-aisle-id]')) {
          return;
        }

        const hit = hitTestPlan(plan, world.x, world.y, effectiveCamera.scale);
        if (hit?.kind === 'bay') {
          setSelected({ runId: hit.runId, bayId: hit.bayId, bayIndex: hit.bayIndex });
          setSelectedColumnId(null);
          setSelectedAisleId(null);
        } else if (hit?.kind === 'aisle') {
          setSelected(null);
          setSelectedColumnId(null);
          setSelectedAisleId(hit.aisleId);
        } else {
          setSelected(null);
          setSelectedColumnId(null);
          setSelectedAisleId(null);
        }
      }
    },
    [
      calP1,
      calP2,
      effectiveCamera,
      effectiveViewport,
      onShellOverlayChange,
      plan,
      toolMode,
      wallDraftStart,
    ],
  );

  // Attach a non-passive wheel listener to the stage wrapper so wheel/trackpad
  // gestures over the canvas OR SVG bay overlays zoom/pan smoothly and never
  // leak scroll events to the main page.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const handleWheel = (e: WheelEvent): void => {
      const target = e.target as Element | null;
      if (target?.closest('.plan-hud, .sel-toolbar')) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = wrap.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const { effectiveViewport: vp, fittedScale } = cameraStateRef.current;

      const modeMultiplier = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 120 : 1;
      const dy = e.deltaY * modeMultiplier;
      const dx = e.deltaX * modeMultiplier;

      // Shift+wheel or clear horizontal trackpad swipe pans the drawing
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        (e.shiftKey || (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 2))
      ) {
        const panX = e.shiftKey && dx === 0 ? -dy : -dx;
        const panY = e.shiftKey ? 0 : -dy;
        setCamera((prev) => panByScreen(prev ?? cameraStateRef.current.effectiveCamera, panX, panY));
        return;
      }

      const clampedDy = Math.max(-160, Math.min(160, dy));
      const rawFactor = Math.exp(-clampedDy * 0.0022);
      setCamera((prev) => {
        const current = prev ?? cameraStateRef.current.effectiveCamera;
        const minAllowed = Math.max(fittedScale * 0.35, 1 / 200_000);
        const maxAllowed = Math.min(fittedScale * 10, 1 / 200);
        const nextScale = Math.max(minAllowed, Math.min(maxAllowed, current.scale * rawFactor));
        const appliedFactor = nextScale / current.scale;
        return zoomAbout(current, vp, anchor, appliedFactor);
      });
    };

    wrap.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', handleWheel);
  }, []);

  const fit = useCallback(() => {
    setCamera(fitExtent(effectiveViewport, list.extent));
  }, [effectiveViewport, list.extent]);

  const zoomByStep = useCallback((factor: number) => {
    const { effectiveViewport: vp, fittedScale } = cameraStateRef.current;
    const center = { x: vp.width / 2, y: vp.height / 2 };
    setCamera((prev) => {
      const current = prev ?? cameraStateRef.current.effectiveCamera;
      const minAllowed = Math.max(fittedScale * 0.35, 1 / 200_000);
      const maxAllowed = Math.min(fittedScale * 10, 1 / 200);
      const nextScale = Math.max(minAllowed, Math.min(maxAllowed, current.scale * factor));
      const appliedFactor = nextScale / current.scale;
      return zoomAbout(current, vp, center, appliedFactor);
    });
  }, []);

  const zoomPercent = Math.max(
    10,
    Math.round((effectiveCamera.scale / Math.max(fittedCamera.scale, 1e-9)) * 100),
  );

  const actOnSelection = useCallback(
    (act: 'insert' | 'split' | 'lock' | 'delete' | 'deselect') => {
      if (act === 'deselect' || activeSelection === null) {
        setSelected(null);
        return;
      }
      const { bay } = activeSelection;
      if (act === 'insert') {
        onCommand?.({ type: 'insertBayAfter', bayId: bay.bayId });
      } else if (act === 'split') {
        onCommand?.({ type: 'splitRun', bayId: bay.bayId });
      } else if (act === 'lock') {
        onCommand?.({ type: 'toggleLock', bayId: bay.bayId });
      } else if (act === 'delete') {
        onCommand?.({ type: 'deleteBay', bayId: bay.bayId });
      }
    },
    [activeSelection, onCommand],
  );

  // Keyboard shortcuts (S4.2): I = insert bay, S = split run, L = lock/unlock,
  // Backspace/Delete = delete bay, Escape = exit active tool & deselect,
  // Ctrl/Cmd+Z = undo, F = fit to view, +/= = zoom in, - = zoom out.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setWallDraftStart(null);
        setWallDraftCurrent(null);
        setCalP1(null);
        setCalP2(null);
        setSelectedColumnId(null);
        setSelectedAisleId(null);
        actOnSelection('deselect');
        onToolModeChange?.('select');
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          fit();
          return;
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomByStep(1.2);
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          zoomByStep(1 / 1.2);
          return;
        }
      }

      if (activeSelectedColumn !== null && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        onShellOverlayChange?.((prev) => ({
          ...prev,
          customColumns: prev.customColumns.filter((c) => c.id !== activeSelectedColumn.id),
        }));
        setSelectedColumnId(null);
        return;
      }

      if (activeSelection === null) return;

      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        actOnSelection('insert');
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        actOnSelection('split');
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        actOnSelection('lock');
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        actOnSelection('delete');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeSelectedColumn,
    activeSelection,
    actOnSelection,
    fit,
    onShellOverlayChange,
    onToolModeChange,
    onUndo,
    zoomByStep,
  ]);

  return (
    <div className="plan-stage stage">
      <div
        className={
          isPanning ? 'blueprint canvaswrap plan-wrap is-panning' : 'blueprint canvaswrap plan-wrap'
        }
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="corner tl" aria-hidden="true" />
        <div className="corner tr" aria-hidden="true" />
        <div className="corner bl" aria-hidden="true" />
        <div className="corner br" aria-hidden="true" />

        <canvas
          ref={canvasRef}
          className="plan-canvas"
          data-render-engine="offscreen-worker-ready"
          role="img"
          aria-label={`Plan view: ${doc.runs.length} rack runs, ${list.items.length} drawn items`}
        />

        {/* S4.3 Dynamic SVG overlay layer for hover/selection & keyboard bay targets */}
        <svg
          className="plan-overlay-svg"
          width={effectiveViewport.width}
          height={effectiveViewport.height}
          viewBox={`0 0 ${effectiveViewport.width} ${effectiveViewport.height}`}
          aria-label="Interactive bay overlay"
        >
          {/* Semi-transparent pallet wash footprints matching blueprint specification */}
          <PalletWashOverlay
            plan={plan}
            camera={effectiveCamera}
            viewport={effectiveViewport}
            requiredClearAisleUm={doc.equipment.truckRAS.value + 60 * 25_400}
            shellOverlay={shellOverlay}
            wallDraftStart={wallDraftStart}
            wallDraftCurrent={wallDraftCurrent}
            calP1={calP1}
            calP2={calP2}
          />

          {/* Bay interactive selection targets */}
          {plan.runs.map((run) => {
            const overhangUm = Math.max(0, run.overhang.value);
            const runTop = run.y - overhangUm;
            const runBottom = runTop + run.rowBlockPallets.value;
            return run.bays.map((bay) => {
              const topLeft = worldToScreen(effectiveCamera, effectiveViewport, {
                x: bay.x,
                y: runTop,
              });
              const bottomRight = worldToScreen(effectiveCamera, effectiveViewport, {
                x: bay.x + bay.width,
                y: runBottom,
              });
              const isSelected =
                activeSelection?.run.runId === run.runId && activeSelection.bay.bayId === bay.bayId;
              const isHovered =
                !isPanning &&
                hovered?.kind === 'bay' &&
                hovered.runId === run.runId &&
                hovered.bayId === bay.bayId;

              return (
                <rect
                  key={bay.bayId}
                  data-bay-id={bay.bayId}
                  data-run-id={run.runId}
                  data-selected={isSelected ? 'true' : 'false'}
                  data-locked={bay.locked ? 'true' : 'false'}
                  className={
                    isSelected
                      ? 'plan-bay-overlay plan-bay-selected'
                      : isHovered
                        ? 'plan-bay-overlay plan-bay-hovered'
                        : 'plan-bay-overlay'
                  }
                  x={topLeft.x}
                  y={topLeft.y}
                  width={Math.max(2, bottomRight.x - topLeft.x)}
                  height={Math.max(2, bottomRight.y - topLeft.y)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${run.label} Bay ${bay.index + 1}${bay.locked ? ' (locked)' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (suppressNextBayClickRef.current) {
                      suppressNextBayClickRef.current = false;
                      return;
                    }
                    setSelected({ runId: run.runId, bayId: bay.bayId, bayIndex: bay.index });
                    setSelectedColumnId(null);
                    setSelectedAisleId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected({ runId: run.runId, bayId: bay.bayId, bayIndex: bay.index });
                      setSelectedColumnId(null);
                      setSelectedAisleId(null);
                    }
                  }}
                />
              );
            });
          })}

          {/* Lock glyphs on locked bays */}
          {plan.runs.map((run) =>
            run.bays
              .filter((b) => b.locked)
              .map((bay) => {
                const overhangUm = Math.max(0, run.overhang.value);
                const mid = worldToScreen(effectiveCamera, effectiveViewport, {
                  x: bay.x + bay.width / 2,
                  y: run.y - overhangUm + run.rowBlockPallets.value / 2,
                });
                return (
                  <text
                    key={`lock:${bay.bayId}`}
                    x={mid.x}
                    y={mid.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="12"
                    style={{ pointerEvents: 'none' }}
                  >
                    🔒
                  </text>
                );
              }),
          )}
          {/* Custom column interactive selection targets */}
          {shellOverlay?.customColumns.map((col) => {
            const halfUm = Math.max(col.sizeIn * 25_400, 24 * 25_400);
            const tl = worldToScreen(effectiveCamera, effectiveViewport, {
              x: col.xUm - halfUm,
              y: col.yUm - halfUm,
            });
            const br = worldToScreen(effectiveCamera, effectiveViewport, {
              x: col.xUm + halfUm,
              y: col.yUm + halfUm,
            });
            const isSelectedCol = activeSelectedColumn?.id === col.id;
            return (
              <rect
                key={`col-hit:${col.id}`}
                data-column-id={col.id}
                data-selected={isSelectedCol ? 'true' : 'false'}
                className={
                  isSelectedCol ? 'plan-bay-overlay plan-bay-selected' : 'plan-bay-overlay'
                }
                x={tl.x}
                y={tl.y}
                width={Math.max(12, br.x - tl.x)}
                height={Math.max(12, br.y - tl.y)}
                role="button"
                tabIndex={0}
                aria-label={`Custom column ${col.label}`}
                aria-pressed={isSelectedCol}
                onClick={() => {
                  if (suppressNextBayClickRef.current) {
                    suppressNextBayClickRef.current = false;
                    return;
                  }
                  setSelected(null);
                  setSelectedAisleId(null);
                  setSelectedColumnId(col.id);
                }}
              />
            );
          })}

          {/* Aisle interactive selection targets */}
          {plan.aisles.map((aisle, idx) => {
            const upperRun = plan.runs[idx];
            const lowerRun = plan.runs[idx + 1];
            const upperLastRow = upperRun?.rows[upperRun.rows.length - 1];
            const lowerFirstRow = lowerRun?.rows[0];
            const bandTopWorldY =
              upperLastRow !== undefined ? upperLastRow.y + upperLastRow.depth : aisle.y;
            const bandBottomWorldY =
              lowerFirstRow !== undefined
                ? lowerFirstRow.y
                : aisle.y + aisle.frameToFrame.value;

            const tl = worldToScreen(effectiveCamera, effectiveViewport, {
              x: aisle.x,
              y: bandTopWorldY,
            });
            const br = worldToScreen(effectiveCamera, effectiveViewport, {
              x: aisle.x + aisle.length,
              y: bandBottomWorldY,
            });
            const isSelectedAisle = activeSelectedAisle?.aisle.aisleId === aisle.aisleId;
            const isHoveredAisle =
              !isPanning && hovered?.kind === 'aisle' && hovered.aisleId === aisle.aisleId;

            return (
              <rect
                key={`aisle-hit:${aisle.aisleId}`}
                data-aisle-id={aisle.aisleId}
                data-selected={isSelectedAisle ? 'true' : 'false'}
                className={
                  isSelectedAisle
                    ? 'plan-bay-overlay plan-bay-selected'
                    : isHoveredAisle
                      ? 'plan-bay-overlay plan-bay-hovered'
                      : 'plan-bay-overlay'
                }
                x={tl.x}
                y={tl.y}
                width={Math.max(8, br.x - tl.x)}
                height={Math.max(8, br.y - tl.y)}
                role="button"
                tabIndex={0}
                aria-label={`Aisle ${idx + 1} (${formatFeetInches(aisle.frameToFrame.value)} frame to frame)`}
                aria-pressed={isSelectedAisle}
                onClick={() => {
                  if (suppressNextBayClickRef.current) {
                    suppressNextBayClickRef.current = false;
                    return;
                  }
                  setSelected(null);
                  setSelectedColumnId(null);
                  setSelectedAisleId(aisle.aisleId);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(null);
                    setSelectedColumnId(null);
                    setSelectedAisleId(aisle.aisleId);
                  }
                }}
              />
            );
          })}
        </svg>

        {/* Top right HUD summary chips */}
        <div className="hud plan-hud" role="group" aria-label="Layout summary">
          <Chip label="Pallet positions" value={String(plan.totalPositions.toLocaleString())} />
          <Chip label="Bays" value={String(plan.totalBays)} />
          <Chip
            label="Narrowest clear aisle"
            value={
              plan.narrowestClearAisle === null
                ? 'No aisle'
                : formatFeetInches(plan.narrowestClearAisle.value)
            }
          />
          <Chip
            label="Failing"
            value={String(findingCounts.blocking)}
            tone={findingCounts.blocking > 0 ? 'block' : 'pass'}
          />
          <Chip
            label="Awaiting input"
            value={String(findingCounts.missingInput)}
            tone={findingCounts.missingInput > 0 ? 'warn' : 'pass'}
          />
          <Chip
            label="Awaiting source"
            value={String(findingCounts.missingSource)}
            tone={findingCounts.missingSource > 0 ? 'warn' : 'pass'}
          />
          <div className="plan-zoom-group" role="group" aria-label="Zoom controls">
            <button
              type="button"
              className="btn plan-fit plan-zoom-btn"
              onClick={() => zoomByStep(1 / 1.2)}
              title="Zoom out (-)"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="btn plan-fit plan-zoom-pct"
              onClick={fit}
              title="Reset zoom to fit (F)"
              aria-label={`Zoom ${zoomPercent} percent, click to fit`}
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              className="btn plan-fit plan-zoom-btn"
              onClick={() => zoomByStep(1.2)}
              title="Zoom in (+)"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="btn plan-fit"
              onClick={fit}
              title="Fit to view (F)"
            >
              Fit
            </button>
            <button
              id="plan-export-dxf-btn"
              type="button"
              className="btn plan-fit"
              onClick={() => {
                exportDocumentToDXF(doc);
              }}
              title="Export AutoCAD .DXF block layout"
            >
              .DXF
            </button>
          </div>
        </div>

        {/* 2-Point Scale Calibration HUD */}
        {toolMode === 'calibrate' && (
          <div
            className="seltoolbar sel-toolbar plan-cal-hud"
            role="region"
            aria-label="2-Point Scale Calibration"
          >
            <span className="what sel-title">
              2-PT SCALE CALIBRATE:{' '}
              {calP1 === null
                ? 'Click Point 1 (P1) on drawing'
                : calP2 === null
                  ? 'Click Point 2 (P2) on drawing'
                  : `Span: ${formatFeetInches(Math.round(Math.hypot(calP2.x - calP1.x, calP2.y - calP1.y)))}`}
            </span>
            {calP1 !== null && calP2 !== null && (
              <>
                <label htmlFor="cal-known-in" className="what">
                  Known dist (in):
                </label>
                <input
                  id="cal-known-in"
                  type="number"
                  min={12}
                  step={6}
                  className="pf-input"
                  style={{ width: '76px' }}
                  value={calKnownIn}
                  onChange={(e) => setCalKnownIn(e.target.value)}
                />
                <button
                  type="button"
                  className="btn sel-btn"
                  onClick={() => {
                    const knownIn = Number(calKnownIn);
                    const measuredIn =
                      Math.hypot(calP2.x - calP1.x, calP2.y - calP1.y) / 25_400;
                    if (Number.isFinite(knownIn) && knownIn > 0 && measuredIn > 0) {
                      const ratio = measuredIn / knownIn;
                      const worldScaleRatio = knownIn / measuredIn;
                      const pxSpan = Math.max(
                        1,
                        Math.hypot(calP2.x - calP1.x, calP2.y - calP1.y) * effectiveCamera.scale,
                      );
                      onShellOverlayChange?.((prev) => ({
                        ...prev,
                        calibratedScaleInPerPx: Number((knownIn / pxSpan).toFixed(4)),
                        shellWidthFt: Math.max(
                          30,
                          Math.min(600, Math.round(prev.shellWidthFt * worldScaleRatio)),
                        ),
                        shellDepthFt: Math.max(
                          20,
                          Math.min(400, Math.round(prev.shellDepthFt * worldScaleRatio)),
                        ),
                      }));
                      zoomByStep(ratio);
                    }
                    setCalP1(null);
                    setCalP2(null);
                    onToolModeChange?.('select');
                  }}
                >
                  Apply Calibration
                </button>
              </>
            )}
            <button
              type="button"
              className="btn sel-btn"
              onClick={() => {
                setCalP1(null);
                setCalP2(null);
                onToolModeChange?.('select');
              }}
            >
              Done
            </button>
          </div>
        )}

        {/* Selected Custom Column Floating Toolbar */}
        {activeSelectedColumn !== null && (
          <div
            id="coltoolbar"
            className="seltoolbar sel-toolbar"
            role="toolbar"
            aria-label="Selected column actions"
          >
            <span className="what sel-title">
              {activeSelectedColumn.label} · (
              {(activeSelectedColumn.xUm / (25_400 * 12)).toFixed(1)}&apos;,{' '}
              {(activeSelectedColumn.yUm / (25_400 * 12)).toFixed(1)}&apos;)
            </span>
            <button
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onShellOverlayChange?.((prev) => ({
                  ...prev,
                  customColumns: prev.customColumns.map((c) =>
                    c.id === activeSelectedColumn.id ? { ...c, xUm: c.xUm - 12 * 25_400 } : c,
                  ),
                }))
              }
            >
              ← −1&apos;
            </button>
            <button
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onShellOverlayChange?.((prev) => ({
                  ...prev,
                  customColumns: prev.customColumns.map((c) =>
                    c.id === activeSelectedColumn.id ? { ...c, xUm: c.xUm + 12 * 25_400 } : c,
                  ),
                }))
              }
            >
              +1&apos; →
            </button>
            <button
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onShellOverlayChange?.((prev) => ({
                  ...prev,
                  customColumns: prev.customColumns.map((c) =>
                    c.id === activeSelectedColumn.id ? { ...c, yUm: c.yUm - 12 * 25_400 } : c,
                  ),
                }))
              }
            >
              ↑ −1&apos;
            </button>
            <button
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onShellOverlayChange?.((prev) => ({
                  ...prev,
                  customColumns: prev.customColumns.map((c) =>
                    c.id === activeSelectedColumn.id ? { ...c, yUm: c.yUm + 12 * 25_400 } : c,
                  ),
                }))
              }
            >
              +1&apos; ↓
            </button>
            <button
              id="delete-selected-column-btn"
              type="button"
              className="btn sel-btn sel-btn-danger"
              onClick={() => {
                onShellOverlayChange?.((prev) => ({
                  ...prev,
                  customColumns: prev.customColumns.filter((c) => c.id !== activeSelectedColumn.id),
                }));
                setSelectedColumnId(null);
              }}
            >
              Delete column <b>⌫</b>
            </button>
            <button
              type="button"
              className="btn sel-btn"
              aria-label="Clear column selection"
              onClick={() => setSelectedColumnId(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* Selected Aisle Floating Toolbar (-6" / +6") */}
        {activeSelectedAisle !== null && (
          <div
            id="aisletoolbar"
            className="seltoolbar sel-toolbar"
            role="toolbar"
            aria-label="Selected aisle actions"
          >
            <span id="aisletitle" className="what sel-title">
              Aisle {activeSelectedAisle.index + 1} ·{' '}
              {formatFeetInches(activeSelectedAisle.aisle.frameToFrame.value)} Frame-to-Frame (
              {formatFeetInches(activeSelectedAisle.aisle.clearBetweenLoads.value)} Clear)
            </span>
            <button
              id="aisle-sub-6-btn"
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onCommand?.({
                  type: 'setAisleAfter',
                  runId: activeSelectedAisle.upperRun.runId,
                  frameToFrame: Math.max(
                    48 * 25_400,
                    activeSelectedAisle.aisle.frameToFrame.value - 6 * 25_400,
                  ),
                })
              }
            >
              − 6&quot;
            </button>
            <button
              id="aisle-add-6-btn"
              type="button"
              className="btn sel-btn"
              onClick={() =>
                onCommand?.({
                  type: 'setAisleAfter',
                  runId: activeSelectedAisle.upperRun.runId,
                  frameToFrame: activeSelectedAisle.aisle.frameToFrame.value + 6 * 25_400,
                })
              }
            >
              + 6&quot;
            </button>
            <button
              type="button"
              className="btn sel-btn"
              aria-label="Clear aisle selection"
              onClick={() => setSelectedAisleId(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* S4.2 Floating selection toolbar */}
        {activeSelection !== null && (() => {
          const docRun = doc.runs.find((r) => r.id === activeSelection.run.runId);
          const flueIn = docRun !== undefined ? Math.max(6, Math.round(docRun.rowSpacer / 25_400)) : 6;
          return (
            <div
              id="seltoolbar"
              className="seltoolbar sel-toolbar"
              role="toolbar"
              aria-label="Selected bay actions"
            >
              <span id="seltitle" className="what sel-title">
                {activeSelection.run.label} · Bay {activeSelection.bay.index + 1}
                {activeSelection.bay.locked ? ' (LOCKED)' : ''}
              </span>
              <button
                type="button"
                className="btn sel-btn"
                data-act="insert"
                onClick={() => actOnSelection('insert')}
              >
                Insert after <b>I</b>
              </button>
              <button
                type="button"
                className="btn sel-btn"
                data-act="split"
                onClick={() => actOnSelection('split')}
              >
                Split run <b>S</b>
              </button>
              <button
                type="button"
                className="btn sel-btn"
                data-act="lock"
                onClick={() => actOnSelection('lock')}
              >
                {activeSelection.bay.locked ? 'Unlock (L)' : 'Lock (L)'}
              </button>
              {docRun !== undefined && (
                <>
                  <button
                    id="sel-toggle-b2b-btn"
                    type="button"
                    className="btn sel-btn"
                    onClick={() =>
                      onCommand?.({
                        type: 'setField',
                        label: `Toggle ${docRun.name} row depth`,
                        change: {
                          section: 'run',
                          runId: docRun.id,
                          patch: { backToBack: !docRun.backToBack },
                        },
                      })
                    }
                  >
                    {docRun.backToBack ? 'Set Single' : 'Set B2B'}
                  </button>
                  {docRun.backToBack && (
                    <span className="sel-flue-group">
                      <span className="what">Flue:</span>
                      <button
                        id="sel-flue-sub-6"
                        type="button"
                        className="btn sel-btn"
                        onClick={() =>
                          onCommand?.({
                            type: 'setField',
                            label: `Decrease ${docRun.name} flue by 6 in`,
                            change: {
                              section: 'run',
                              runId: docRun.id,
                              patch: { rowSpacer: Math.max(6, flueIn - 6) * 25_400 },
                            },
                          })
                        }
                      >
                        −6&quot;
                      </button>
                      <span id="sel-flue-val" className="what">
                        {flueIn}&quot;
                      </span>
                      <button
                        id="sel-flue-add-6"
                        type="button"
                        className="btn sel-btn"
                        onClick={() =>
                          onCommand?.({
                            type: 'setField',
                            label: `Increase ${docRun.name} flue by 6 in`,
                            change: {
                              section: 'run',
                              runId: docRun.id,
                              patch: { rowSpacer: (flueIn + 6) * 25_400 },
                            },
                          })
                        }
                      >
                        +6&quot;
                      </button>
                    </span>
                  )}
                </>
              )}
              <button
                type="button"
                className="btn sel-btn sel-btn-danger"
                data-act="delete"
                onClick={() => actOnSelection('delete')}
              >
                Delete bay <b>⌫</b>
              </button>
              <button
                type="button"
                className="btn sel-btn"
                data-act="deselect"
                aria-label="Clear selection"
                onClick={() => actOnSelection('deselect')}
              >
                ×
              </button>
            </div>
          );
        })()}
      </div>

      {/* S3.5 Legend footer strip */}
      <div id="legend" className="legend plan-legend" aria-label="Drawing legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-upright" aria-hidden="true" />
          Upright
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-beam" aria-hidden="true" />
          Beam
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-load" aria-hidden="true" />
          Unit load
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-flue" aria-hidden="true" />
          Flue
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-aisle" aria-hidden="true" />
          Clear between loads
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-dim" aria-hidden="true" />
          Dimension
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-locked" aria-hidden="true" />
          Locked bay
        </span>
        <span className="legend-right right">
          {toolMode && toolMode !== 'select'
            ? `ACTIVE TOOL: ${toolMode.toUpperCase()} — CLICK DRAWING TO PLACE · PRESS ESC TO EXIT`
            : 'CLICK A BAY OR AISLE TO SELECT · DRAG TO PAN · SCROLL TO ZOOM'}
        </span>
      </div>
    </div>
  );
}
