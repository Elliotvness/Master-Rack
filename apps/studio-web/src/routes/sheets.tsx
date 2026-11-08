import {
  SUBMITTAL_13_SHEETS,
  buildDetailedPlan,
  exportDisplayListDxf,
  gridRef,
  type DisplayList,
  type SubmittalSheetId,
  type SubmittalSheetSpec,
} from '@rms/display-list';
import { type PlanGeometry, type StudioDocument } from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { ElevationSvg } from '../elevation/elevation-svg.js';
import {
  useStudioSession,
  type PlanColumnOverlay,
  type ShellOverlayState,
} from '../session-context.js';

export type SheetId = SubmittalSheetId;

const SHEETS: readonly SubmittalSheetSpec[] = SUBMITTAL_13_SHEETS;

function formatFeetInches(um: number): string {
  const totalInches = Math.round(um / 25_400);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.abs(totalInches % 12);
  return `${feet}'-${inches}"`;
}

function PlanSheetSvg({
  document: doc,
  plan,
  shellOverlay,
  list,
}: {
  readonly document: StudioDocument;
  readonly plan: PlanGeometry;
  readonly shellOverlay: ShellOverlayState;
  readonly list: DisplayList;
}): React.JSX.Element {
  const longestRun = useMemo(
    () => [...plan.runs].sort((a, b) => b.runLength.value - a.runLength.value)[0],
    [plan.runs],
  );

  const firstRowY =
    plan.runs.length > 0 ? Math.min(...plan.runs.map((r) => r.rows[0]?.y ?? r.y)) : 0;
  const lastRowBottomY =
    plan.runs.length > 0
      ? Math.max(
          ...plan.runs.map((r) => {
            const last = r.rows[r.rows.length - 1];
            return last !== undefined ? last.y + last.depth : r.y;
          }),
        )
      : 0;

  const shellBounds = useMemo(() => {
    if (longestRun !== undefined) {
      return {
        minX: longestRun.x,
        maxX: longestRun.x + longestRun.runLength.value,
        minY: firstRowY,
        maxY: lastRowBottomY,
      };
    }
    const widthUm = shellOverlay.shellWidthFt * 12 * 25_400;
    const depthUm = shellOverlay.shellDepthFt * 12 * 25_400;
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
    shellOverlay.shellWidthFt,
    shellOverlay.shellDepthFt,
  ]);

  const activeColumns = useMemo<readonly PlanColumnOverlay[]>(() => {
    const cols: PlanColumnOverlay[] = [...shellOverlay.customColumns];
    if (shellOverlay.showColumns) {
      const spacingUm = shellOverlay.columnSpacingFt * 12 * 25_400;
      const maxX = shellBounds.maxX;
      const maxY = Math.max(shellBounds.maxY, spacingUm);
      let cIdx = 1;
      for (let x = shellBounds.minX + spacingUm; x <= maxX; x += spacingUm) {
        let rIdx = 1;
        for (let y = shellBounds.minY + spacingUm / 2; y <= maxY + spacingUm / 2; y += spacingUm) {
          cols.push({
            id: `sheet-grid-col-${cIdx}-${rIdx}`,
            xUm: x,
            yUm: y,
            sizeIn: shellOverlay.columnSizeIn,
            label: `${gridRef(cIdx - 1)}-${rIdx}`,
          });
          rIdx += 1;
        }
        cIdx += 1;
      }
    }
    return cols;
  }, [shellOverlay, shellBounds]);

  const marginUm = 120 * 25_400;
  const minX =
    (shellOverlay.showPerimeterWalls ? shellBounds.minX - marginUm : shellBounds.minX) - 2_200_000;
  const minY =
    (shellOverlay.showPerimeterWalls ? shellBounds.minY - marginUm : shellBounds.minY) - 2_200_000;
  const maxX =
    (shellOverlay.showPerimeterWalls
      ? Math.max(shellBounds.maxX + marginUm, Math.max(list.extent.width, 2_540_000))
      : Math.max(shellBounds.maxX, Math.max(list.extent.width, 2_540_000))) + 2_200_000;
  const maxY =
    (shellOverlay.showPerimeterWalls
      ? Math.max(shellBounds.maxY + marginUm, Math.max(list.extent.height, 2_540_000))
      : Math.max(shellBounds.maxY, Math.max(list.extent.height, 2_540_000))) + 2_200_000;

  const vbW = Math.max(2_540_000, maxX - minX);
  const vbH = Math.max(2_540_000, maxY - minY);

  // World-space CAD symbol dimensions tuned to match PlanCanvas proportions
  const fpSize = 9 * 25_400;
  const fpHalf = fpSize / 2;
  const webHalf = 1.6 * 25_400;
  const boltOffset = 2.5 * 25_400;
  const boltRadius = 0.75 * 25_400;
  const strokeW = 22_000;
  const fontSize = 240_000;

  const requiredClearAisleUm = doc.equipment.truckRAS.value + 60 * 25_400;
  const roundedRequiredClearUm = Math.ceil(requiredClearAisleUm / 25_400) * 25_400;
  const firstFailingAisleIndex = plan.aisles.findIndex(
    (a) => a.clearBetweenLoads.value < requiredClearAisleUm,
  );

  return (
    <svg
      className="sheet-plan-svg"
      viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Sheet R-101 plan drawing for ${doc.name}`}
    >
      {/* -1. Floorplan Image Underlay */}
      {shellOverlay.underlayDataUrl !== null && (
        <image
          href={shellOverlay.underlayDataUrl}
          x={shellBounds.minX - marginUm}
          y={shellBounds.minY - marginUm}
          width={Math.max(25_400, shellBounds.maxX - shellBounds.minX + marginUm * 2)}
          height={Math.max(25_400, shellBounds.maxY - shellBounds.minY + marginUm * 2)}
          opacity={shellOverlay.underlayOpacity}
          preserveAspectRatio="none"
        />
      )}

      {/* 0. Building Perimeter Wall Envelope & Custom Orthogonal Walls */}
      {shellOverlay.showPerimeterWalls && (
        <g className="sheet-perimeter-walls">
          <rect
            x={shellBounds.minX - marginUm}
            y={shellBounds.minY - marginUm}
            width={shellBounds.maxX - shellBounds.minX + marginUm * 2}
            height={shellBounds.maxY - shellBounds.minY + marginUm * 2}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={strokeW * 1.8}
          />
          <text
            x={shellBounds.minX - marginUm + 200_000}
            y={shellBounds.minY - marginUm + 360_000}
            fontFamily="var(--font-mono)"
            fontSize={fontSize * 0.9}
            fontWeight="700"
            fill="var(--ink-2)"
          >
            BUILDING PERIMETER SHELL ({shellOverlay.shellWidthFt}&apos; ×{' '}
            {shellOverlay.shellDepthFt}&apos; ENVELOPE)
          </text>
        </g>
      )}

      {shellOverlay.customWalls.map((w) => (
        <line
          key={`sheet-wall:${w.id}`}
          x1={w.x1Um}
          y1={w.y1Um}
          x2={w.x2Um}
          y2={w.y2Um}
          stroke="var(--ink)"
          strokeWidth={strokeW * 2}
        />
      ))}

      {/* 0b. Structural Columns (Grid + Custom Stamped Columns) */}
      {activeColumns.map((col) => {
        const colSizeUm = Math.max(col.sizeIn * 25_400, 14 * 25_400);
        const colHalfUm = colSizeUm / 2;
        const padHalfUm = colHalfUm * 1.45;
        return (
          <g key={`sheet-col:${col.id}`}>
            <rect
              x={col.xUm - padHalfUm}
              y={col.yUm - padHalfUm}
              width={padHalfUm * 2}
              height={padHalfUm * 2}
              fill="none"
              stroke="var(--warn)"
              strokeWidth={strokeW * 0.8}
              strokeDasharray={`${strokeW * 2} ${strokeW * 1.5}`}
            />
            <rect
              x={col.xUm - colHalfUm}
              y={col.yUm - colHalfUm}
              width={colSizeUm}
              height={colSizeUm}
              fill="var(--warn-bg)"
              stroke="var(--warn)"
              strokeWidth={strokeW * 1.3}
            />
            <line
              x1={col.xUm - colHalfUm}
              y1={col.yUm - colHalfUm}
              x2={col.xUm + colHalfUm}
              y2={col.yUm + colHalfUm}
              stroke="var(--warn)"
              strokeWidth={strokeW}
            />
            <line
              x1={col.xUm + colHalfUm}
              y1={col.yUm - colHalfUm}
              x2={col.xUm - colHalfUm}
              y2={col.yUm + colHalfUm}
              stroke="var(--warn)"
              strokeWidth={strokeW}
            />
            <text
              x={col.xUm}
              y={col.yUm - padHalfUm - 120_000}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={fontSize * 0.85}
              fontWeight="700"
              fill="var(--warn)"
            >
              {col.label}
            </text>
          </g>
        );
      })}

      {/* 1. Grid Bubbles (A..Z) & Vertical Grid Lines */}
      {longestRun !== undefined &&
        Array.from({ length: longestRun.bays.length + 1 }, (_, i) => {
          const worldX = longestRun.x + i * longestRun.bayPitch.value;
          const bubbleY = firstRowY - 1_250_000;
          const rBub = 310_000;
          return (
            <g key={`sheet-grid:${i}`}>
              <line
                x1={worldX}
                y1={bubbleY + rBub}
                x2={worldX}
                y2={lastRowBottomY + 250_000}
                stroke="var(--pen-grid)"
                strokeWidth={strokeW * 0.65}
                strokeDasharray={`${strokeW * 3} ${strokeW * 3}`}
              />
              <circle
                cx={worldX}
                cy={bubbleY}
                r={rBub}
                fill="var(--panel)"
                stroke="var(--ink-2)"
                strokeWidth={strokeW}
              />
              <text
                x={worldX}
                y={bubbleY}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="var(--font-mono)"
                fontSize={fontSize * 0.9}
                fontWeight="600"
                fill="var(--ink)"
              >
                {gridRef(i)}
              </text>
            </g>
          );
        })}

      {/* 2. Centered Two-Line Aisle Callout Bands */}
      {plan.aisles.map((aisle, idx) => {
        const upperRun = plan.runs[idx];
        const lowerRun = plan.runs[idx + 1];
        const upperLastRow = upperRun?.rows[upperRun.rows.length - 1];
        const lowerFirstRow = lowerRun?.rows[0];
        const bandTopY =
          upperLastRow !== undefined ? upperLastRow.y + upperLastRow.depth : aisle.y;
        const bandBottomY =
          lowerFirstRow !== undefined ? lowerFirstRow.y : aisle.y + aisle.frameToFrame.value;
        const midX = aisle.x + aisle.length / 2;
        const midY = (bandTopY + bandBottomY) / 2;
        const isHighlightedFailing = idx === firstFailingAisleIndex;
        const line1 = `AISLE ${idx + 1} · ${formatFeetInches(aisle.frameToFrame.value)} FRAME TO FRAME`;
        const line2 = isHighlightedFailing
          ? `${formatFeetInches(aisle.clearBetweenLoads.value)} clear between loads · truck needs ${formatFeetInches(roundedRequiredClearUm)}`
          : `${formatFeetInches(aisle.clearBetweenLoads.value)} clear between loads`;

        return (
          <g key={`sheet-aisle:${aisle.aisleId}`}>
            {isHighlightedFailing && (
              <rect
                x={aisle.x}
                y={bandTopY}
                width={aisle.length}
                height={Math.max(25_400, bandBottomY - bandTopY)}
                fill="var(--warn-bg)"
              />
            )}
            <text
              x={midX}
              y={midY - fontSize * 0.65}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize={fontSize}
              fontWeight="600"
              fill={isHighlightedFailing ? 'var(--warn)' : 'var(--ink-2)'}
            >
              {line1}
            </text>
            <text
              x={midX}
              y={midY + fontSize * 0.65}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize={fontSize * 0.92}
              fontWeight="500"
              fill={isHighlightedFailing ? 'var(--warn)' : 'var(--ink-2)'}
            >
              {line2}
            </text>
          </g>
        );
      })}

      {/* 3. CAD Plan Geometry: Front & Back Beam Lines (--pen-beam), Upright 4-Bolt Footplates + Double-Web Channels (--pen-upright), and Flue Ties (--pen-flue) */}
      {plan.runs.map((run) => {
        const firstRow = run.rows[0];
        const lastRow = run.rows[run.rows.length - 1];
        const runTopY = firstRow?.y ?? run.y;
        const runBottomY = lastRow !== undefined ? lastRow.y + lastRow.depth : run.y;

        return (
          <g key={`sheet-run:${run.runId}`}>
            <text
              x={run.x - 360_000}
              y={(runTopY + runBottomY) / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize={fontSize}
              fontWeight="600"
              fill="var(--pen-upright)"
            >
              {run.label}
            </text>

            {/* Back-to-back Row Spacer / Flue Ties */}
            {run.rows.length > 1 &&
              firstRow !== undefined &&
              lastRow !== undefined &&
              Array.from({ length: run.bays.length + 1 }, (_, i) => {
                const ux = run.x + i * run.bayPitch.value;
                return (
                  <line
                    key={`sheet-flue-tie:${run.runId}:${i}`}
                    x1={ux}
                    y1={firstRow.y + firstRow.depth + fpHalf * 0.4}
                    x2={ux}
                    y2={lastRow.y - fpHalf * 0.4}
                    stroke="var(--pen-flue)"
                    strokeWidth={strokeW * 1.5}
                  />
                );
              })}

            {run.rows.map((row, rowIdx) => {
              const backBeamY = row.y;
              const frontBeamY = row.y + row.depth;

              return (
                <g key={`sheet-row:${run.runId}:${rowIdx}`}>
                  {run.bays.map((bay, bayIdx) => {
                    const leftUprightX = run.x + bayIdx * run.bayPitch.value;
                    const rightUprightX = run.x + (bayIdx + 1) * run.bayPitch.value;
                    const beamStartX = leftUprightX + webHalf;
                    const beamEndX = Math.max(beamStartX + 25_400, rightUprightX - webHalf);

                    return (
                      <g key={`sheet-bay:${run.runId}:${rowIdx}:${bay.bayId}`}>
                        <line
                          x1={beamStartX}
                          y1={backBeamY}
                          x2={beamEndX}
                          y2={backBeamY}
                          stroke="var(--pen-beam)"
                          strokeWidth={strokeW * 1.6}
                        />
                        <line
                          x1={beamStartX}
                          y1={frontBeamY}
                          x2={beamEndX}
                          y2={frontBeamY}
                          stroke="var(--pen-beam)"
                          strokeWidth={strokeW * 1.6}
                        />
                      </g>
                    );
                  })}

                  {Array.from({ length: run.bays.length + 1 }, (_, i) => {
                    const ux = run.x + i * run.bayPitch.value;
                    const topFpY = backBeamY - fpHalf * 0.4;
                    const botFpY = frontBeamY - fpHalf * 1.6;
                    const topFpCy = topFpY + fpHalf;
                    const botFpCy = botFpY + fpHalf;
                    const webTopY = topFpY + fpSize * 0.25;
                    const webBotY = botFpY + fpSize * 0.75;

                    return (
                      <g key={`sheet-upright:${run.runId}:${rowIdx}:${i}`}>
                        <rect
                          x={ux - fpHalf}
                          y={topFpY}
                          width={fpSize}
                          height={fpSize}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth={strokeW * 1.15}
                        />
                        <rect
                          x={ux - fpHalf}
                          y={botFpY}
                          width={fpSize}
                          height={fpSize}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth={strokeW * 1.15}
                        />
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
                        <rect
                          x={ux - webHalf}
                          y={webTopY}
                          width={webHalf * 2}
                          height={Math.max(25_400, webBotY - webTopY)}
                          fill="var(--sunk)"
                          stroke="var(--pen-upright)"
                          strokeWidth={strokeW * 1.15}
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

      {/* 4. Overall Run Length Dimension at Bottom */}
      {longestRun !== undefined && (
        <g className="sheet-overall-dim">
          <line
            x1={longestRun.x}
            y1={lastRowBottomY + 850_000}
            x2={longestRun.x + longestRun.runLength.value}
            y2={lastRowBottomY + 850_000}
            stroke="var(--pen-dim)"
            strokeWidth={strokeW}
          />
          <text
            x={longestRun.x + longestRun.runLength.value / 2}
            y={lastRowBottomY + 1_250_000}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={fontSize}
            fontWeight="600"
            fill="var(--ink-2)"
          >
            {formatFeetInches(longestRun.runLength.value)} OVERALL
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * The sheets view — build-plan **S3.4**.
 *
 * ANSI D sheet preview with selector rail (`R-101`, `R-201`, `R-501`),
 * honest fitted scale (`1 : n fitted`) + `"NOT TO SCALE ON SCREEN"` legend,
 * delegated-design note, and empty preliminary stamp box.
 */
export default function SheetsView(): React.JSX.Element {
  const { session, plan, shellOverlay } = useStudioSession();
  const doc = session.document;
  const [activeSheet, setActiveSheet] = useState<SheetId>('R-101');
  const [dxfNotice, setDxfNotice] = useState<string | null>(null);

  const detailedPlan = useMemo(
    () =>
      buildDetailedPlan({
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
          pallets: r.pallets,
          longitudinalFlue: r.longitudinalFlue,
        })),
        aisles: plan.aisles.map((a) => ({
          aisleId: a.aisleId,
          x: a.x,
          y: a.y,
          length: a.length,
          frameToFrame: a.frameToFrame,
          clearBetweenLoads: a.clearBetweenLoads,
        })),
        extent: plan.extent,
        overallLength: plan.overallLength,
      }),
    [doc.id, doc.revision, plan],
  );

  const currentSpec: SubmittalSheetSpec = SHEETS.find((s) => s.id === activeSheet) ?? SHEETS[1]!;

  // Compute an honest approximate fitted ratio for the screen preview, never a
  // fake architectural scale like 1/8" = 1'-0" (build-plan S3.4 / D-H).
  const fittedRatio = useMemo(() => {
    const spanUm =
      currentSpec.category === 'elevation'
        ? (doc.bayTypes[0]?.frameHeight.value ?? 6_096_000)
        : Math.max(plan.extent.width.value, plan.extent.height.value, 2_540_000);
    // Approximate against a 500 mm (500,000 µm) viewport frame width
    const ratio = Math.max(10, Math.round(spanUm / 500_000));
    return `1 : ${ratio} fitted`;
  }, [currentSpec.category, doc.bayTypes, plan.extent.height.value, plan.extent.width.value]);

  const handleExportDxf = () => {
    const dxf = exportDisplayListDxf(detailedPlan, doc.name);
    setDxfNotice(`Exported AutoCAD LT DXF (${dxf.split('\n').length} lines · 7 layers).`);
  };

  return (
    <section id="sheetview" className="sheets-view" aria-labelledby="view-heading-sheets">
      <h1 id="view-heading-sheets" className="visually-hidden">
        Sheets
      </h1>

      <aside id="sheetrail" className="sheet-rail" aria-label="Sheet index">
        <div className="sheet-rail-actions">
          <button
            id="sheet-export-dxf"
            type="button"
            className="btn btn-primary"
            onClick={handleExportDxf}
          >
            Export AutoCAD LT DXF
          </button>
          {dxfNotice !== null && (
            <p id="sheet-dxf-notice" role="status" className="sheet-dxf-notice">
              {dxfNotice}
            </p>
          )}
        </div>
        {SHEETS.map((sheet) => {
          const isCurrent = sheet.id === activeSheet;
          return (
            <button
              key={sheet.id}
              type="button"
              data-sheet={sheet.id}
              aria-pressed={isCurrent}
              className={isCurrent ? 'sheet-tab sheet-tab-active' : 'sheet-tab'}
              onClick={() => setActiveSheet(sheet.id)}
            >
              <strong className="sheet-tab-id">{sheet.id}</strong>
              <span className="sheet-tab-title">{sheet.title}</span>
              <span className="sheet-tab-sub">{sheet.subtitle}</span>
            </button>
          );
        })}
      </aside>

      <div className="sheet-stage">
        <div id="sheetpage" className="sheet-page" role="region" aria-label={`Sheet ${currentSpec.id}`}>
          <div id="sheetmain" className="sheet-main">
            <div id="sheetdrawing" className="sheet-drawing">
              {currentSpec.category === 'plan' && (
                <PlanSheetSvg
                  document={doc}
                  plan={plan}
                  shellOverlay={shellOverlay}
                  list={detailedPlan}
                />
              )}
              {currentSpec.category === 'elevation' && <ElevationSvg document={doc} id="sheet-elev-svg" />}
              {currentSpec.id === 'R-401' && (
                <div className="sheet-plaque" data-sheet-plaque="R-401">
                  <h2>RMI LOAD CAPACITY PLAQUE ARTWORK (MIN. 50 SQ IN. · ANSI/RMI MH16.1 §1.4.2)</h2>
                  <p>
                    <strong>MAXIMUM PERMISSIBLE UNIT LOAD:</strong> {doc.unitLoad.weight.toLocaleString()} LB PER PALLET
                  </p>
                  <p>
                    <strong>MAXIMUM BEAM LEVEL LOAD:</strong>{' '}
                    {doc.bayTypes[0]?.beamPairCapacity.established === 'UNKNOWN'
                      ? 'VERIFY'
                      : `${doc.bayTypes[0]?.beamPairCapacity.value.toLocaleString() ?? 'VERIFY'} LB / PAIR`}
                  </p>
                  <p>
                    <strong>DELEGATED DESIGN — SCREENING ONLY:</strong> Do not alter beam elevations without EOR approval.
                  </p>
                </div>
              )}
              {(currentSpec.category === 'schedule' ||
                currentSpec.category === 'cover' ||
                currentSpec.category === 'detail' ||
                currentSpec.category === 'audit') && (
                <div className="sheet-schedule">
                  <h2>BAY &amp; RUN SCHEDULE ({currentSpec.id} · {currentSpec.title})</h2>
                  <table className="sheet-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Bay Type</th>
                        <th>Bays</th>
                        <th>Config</th>
                        <th>Positions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.runs.map((r) => {
                        const docRun = doc.runs.find((dr) => dr.id === r.runId);
                        const bt = doc.bayTypes.find((b) => b.id === docRun?.bayTypeId);
                        return (
                          <tr key={r.runId}>
                            <td>{r.label}</td>
                            <td>{bt?.name ?? '—'}</td>
                            <td>{r.bays.length}</td>
                            <td>{docRun?.backToBack ? 'Back-to-back' : 'Single-row'}</td>
                            <td>{r.positions}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <aside id="sheetnotes" className="sheet-notes" aria-label="General notes">
              <h3>DELEGATED DESIGN &amp; SCREENING NOTES</h3>
              <ol>
                <li>
                  <strong>NOT TO SCALE ON SCREEN.</strong> Screen preview is fitted to viewport (
                  {fittedRatio}). Read witnessed dimensions only; do not scale from screen.
                </li>
                <li>
                  <strong>DELEGATED DESIGN SCOPE.</strong> Final structural design, seismic
                  anchorage, and slab demand verification are by the Rack Manufacturer&apos;s
                  registered Professional Engineer of Record per ANSI/RMI MH16.1.
                </li>
                <li>
                  <strong>UNESTABLISHED DATUMS.</strong> Any quantity marked <code>VERIFY</code> has
                  not been field-verified or certified and must be established prior to submittal.
                </li>
              </ol>
            </aside>
          </div>

          <footer id="sheettb" className="sheet-titleblock" aria-label="Sheet title block">
            <div className="tb-cell">
              <span className="tb-label">CLIENT</span>
              <strong id="tb-client">{doc.client}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">PROJECT</span>
              <strong id="tb-proj">{doc.name}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SHEET TITLE</span>
              <strong id="tb-title">{currentSpec.title}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SCALE</span>
              <strong id="tb-scale">{fittedRatio} · NOT TO SCALE ON SCREEN</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">REVISION</span>
              <strong id="tb-rev">{doc.revision}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">STATUS</span>
              <strong id="tb-date">SCREENING ONLY</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SHEET NO.</span>
              <strong id="tb-num">{currentSpec.id}</strong>
            </div>
            <div id="tb-stamp" className="tb-stamp" aria-label="Seal placeholder">
              PRELIMINARY SCREENING — NOT FOR CONSTRUCTION OR PERMITTING (NO EOR SEAL)
            </div>
            <div id="tb-packs" className="tb-packs">
              Packs: {doc.packs.rack} · {doc.packs.fire} · {doc.packs.structural}
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
