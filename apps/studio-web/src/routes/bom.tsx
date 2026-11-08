import {
  DEFAULT_PRICING_RATES,
  bomForDocument,
  exportBomCsv,
  exportBomJson,
  exportLegacyTakeoffXlsx,
  pricingForDocument,
  quoteReadinessForDocument,
  runScopeLabelForLine,
  takeoffSummary,
  type Command,
  type PlanGeometry,
  type PricingRates,
  type StudioDocument,
} from '@rms/studio-model';
import { formatLength, um } from '@rms/kernel-units';
import { useEffect, useMemo, useRef, useState } from 'react';

import { readPens } from '../plan/use-pens.js';
import {
  exportDocumentToDXF,
  useStudioSession,
} from '../session-context.js';

type BomFilter = 'all' | 'resolved' | 'unresolved';

type CanvasSelection =
  | { readonly type: 'aisle'; readonly runIndex: number }
  | { readonly type: 'bay'; readonly runIndex: number; readonly bayIndex: number }
  | null;

function VisualGridInteractive({
  document: doc,
  plan,
  onCommand,
  onDownloadDxf,
}: {
  readonly document: StudioDocument;
  readonly plan: PlanGeometry;
  readonly onCommand: (cmd: Command) => void;
  readonly onDownloadDxf: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selection, setSelection] = useState<CanvasSelection>(null);

  const bt = doc.bayTypes[0];
  const frameDepthIn = bt !== undefined ? Math.round(bt.frameDepth / 25_400) : 42;
  const beamLengthIn = bt !== undefined ? Math.round(bt.beamLength / 25_400) : 96;
  const uprightWidthIn = bt !== undefined ? Math.round(bt.uprightWidth / 25_400) : 3;

  const { canvasWidth, canvasHeight } = useMemo(() => {
    let maxW = 0;
    let totalH = 100;
    doc.runs.forEach((run, i) => {
      let runW = 50;
      run.bays.forEach(() => {
        runW += uprightWidthIn + beamLengthIn;
      });
      runW += uprightWidthIn;
      if (runW > maxW) maxW = runW;

      const flueIn = Math.max(6, Math.round(run.rowSpacer / 25_400));
      const runDepth = run.backToBack ? frameDepthIn * 2 + flueIn : frameDepthIn;
      totalH += runDepth;

      const aisle = plan.aisles[i];
      if (i < doc.runs.length - 1) {
        const aisleIn =
          aisle !== undefined ? Math.max(36, Math.round(aisle.frameToFrame.value / 25_400)) : 120;
        totalH += aisleIn;
      }
    });
    return {
      canvasWidth: Math.max(600, maxW + 50),
      canvasHeight: Math.max(220, totalH),
    };
  }, [beamLengthIn, doc.runs, frameDepthIn, plan.aisles, uprightWidthIn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const pens = readPens(window.document.documentElement);
    let currentY = 50;

    doc.runs.forEach((run, rIdx) => {
      const flueIn = Math.max(6, Math.round(run.rowSpacer / 25_400));
      const runDepth = run.backToBack ? frameDepthIn * 2 + flueIn : frameDepthIn;
      const aisle = plan.aisles[rIdx];
      const aisleIn =
        aisle !== undefined ? Math.max(36, Math.round(aisle.frameToFrame.value / 25_400)) : 120;
      let currentX = 50;

      // 1. Draw Aisle Background & Highlight
      if (rIdx < doc.runs.length - 1) {
        ctx.save();
        const isAisleSelected = selection?.type === 'aisle' && selection.runIndex === rIdx;
        ctx.fillStyle = isAisleSelected ? pens.selection : pens.aisle;
        ctx.globalAlpha = isAisleSelected ? 0.22 : 0.1;
        ctx.fillRect(50, currentY + runDepth, canvasWidth - 100, aisleIn);
        ctx.restore();
      }

      // 2. Draw Individual Bays
      run.bays.forEach((_bay, bIdx) => {
        const isSelected =
          selection?.type === 'bay' &&
          selection.runIndex === rIdx &&
          selection.bayIndex === bIdx;

        // Draw Upright Frame (3" wide)
        ctx.fillStyle = pens.upright;
        ctx.fillRect(currentX, currentY, uprightWidthIn, runDepth);

        // Draw Beam Level Boxes
        ctx.strokeStyle = isSelected ? pens.selection : pens.beam;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(currentX + uprightWidthIn, currentY, beamLengthIn, frameDepthIn);

        if (run.backToBack) {
          ctx.strokeRect(
            currentX + uprightWidthIn,
            currentY + frameDepthIn + flueIn,
            beamLengthIn,
            frameDepthIn,
          );
        }

        if (isSelected) {
          ctx.save();
          ctx.fillStyle = pens.selection;
          ctx.globalAlpha = 0.16;
          ctx.fillRect(currentX, currentY, beamLengthIn + uprightWidthIn, runDepth);
          ctx.restore();
        }

        currentX += uprightWidthIn + beamLengthIn;
      });

      // Draw Final Upright Frame
      ctx.fillStyle = pens.upright;
      ctx.fillRect(currentX, currentY, uprightWidthIn, runDepth);

      // 3. Draw Center Flue Space Line
      if (run.backToBack) {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = pens.flue;
        ctx.lineWidth = 1;
        const flueY = currentY + frameDepthIn + flueIn / 2;
        ctx.moveTo(50, flueY);
        ctx.lineTo(currentX + uprightWidthIn, flueY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      currentY += runDepth + aisleIn;
    });
  }, [
    beamLengthIn,
    canvasHeight,
    canvasWidth,
    doc.runs,
    frameDepthIn,
    plan.aisles,
    selection,
    uprightWidthIn,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    let currentY = 50;
    for (let r = 0; r < doc.runs.length; r += 1) {
      const run = doc.runs[r];
      if (run === undefined) continue;
      const flueIn = Math.max(6, Math.round(run.rowSpacer / 25_400));
      const runDepth = run.backToBack ? frameDepthIn * 2 + flueIn : frameDepthIn;
      const aisle = plan.aisles[r];
      const aisleIn =
        aisle !== undefined ? Math.max(36, Math.round(aisle.frameToFrame.value / 25_400)) : 120;

      if (clickY >= currentY && clickY <= currentY + runDepth) {
        let currentX = 50;
        for (let b = 0; b < run.bays.length; b += 1) {
          const bayWidth = uprightWidthIn + beamLengthIn;
          if (clickX >= currentX && clickX <= currentX + bayWidth) {
            setSelection({ type: 'bay', runIndex: r, bayIndex: b });
            return;
          }
          currentX += bayWidth;
        }
      }

      if (
        r < doc.runs.length - 1 &&
        clickY > currentY + runDepth &&
        clickY <= currentY + runDepth + aisleIn
      ) {
        setSelection({ type: 'aisle', runIndex: r });
        return;
      }

      currentY += runDepth + aisleIn;
    }

    setSelection(null);
  };

  return (
    <div
      id="bom-visual-grid-section"
      className="blueprint bom-visual-grid-card"
      aria-label="Interactive HTML5 Top-Down Layout Preview"
    >
      <div className="bom-visual-grid-header">
        <div>
          <h2 className="pricing-title">Interactive Layout Canvas (HTML5 Top-Down Grid)</h2>
          <p className="pricing-desc">
            Click any bay or aisle on the HTML5 canvas to inspect or adjust bays, flue spaces, and
            aisle widths before exporting to AutoCAD.
          </p>
        </div>
        <div className="bom-actions">
          <button
            id="bom-select-first-bay-btn"
            type="button"
            className="btn"
            onClick={() => setSelection({ type: 'bay', runIndex: 0, bayIndex: 0 })}
          >
            Select Run 1 · Bay 1
          </button>
          {doc.runs.length > 1 && (
            <button
              id="bom-select-first-aisle-btn"
              type="button"
              className="btn"
              onClick={() => setSelection({ type: 'aisle', runIndex: 0 })}
            >
              Select Aisle 1
            </button>
          )}
          <button
            id="bom-download-dxf-btn"
            type="button"
            className="btn btn-primary"
            onClick={onDownloadDxf}
          >
            DOWNLOAD .DXF
          </button>
        </div>
      </div>

      <div className="bom-visual-grid-stage">
        <canvas
          id="bom-visual-grid-canvas"
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="bom-visual-canvas"
        />
      </div>

      <div className="bom-visual-scale font-mono">Scale: 1px = 1 inch</div>

      {selection !== null && (
        <div
          id="bom-canvas-toolbar"
          className="seltoolbar sel-toolbar bom-contextual-toolbar"
          role="toolbar"
          aria-label="Interactive layout contextual toolbar"
        >
          {selection.type === 'aisle' &&
            (() => {
              const run = doc.runs[selection.runIndex];
              const aisle = plan.aisles[selection.runIndex];
              if (run === undefined || aisle === undefined) return null;
              const ftfIn = Math.round(aisle.frameToFrame.value / 25_400);
              const clearIn = Math.round(aisle.clearBetweenLoads.value / 25_400);
              return (
                <>
                  <span className="what sel-title">
                    Aisle · Run {selection.runIndex + 1} to Run {selection.runIndex + 2} ({ftfIn}
                    &quot; frame-to-frame · {clearIn}&quot; clear)
                  </span>
                  <button
                    id="bom-aisle-sub-6"
                    type="button"
                    className="btn sel-btn"
                    onClick={() =>
                      onCommand({
                        type: 'setAisleAfter',
                        runId: run.id,
                        frameToFrame: Math.max(36 * 25_400, aisle.frameToFrame.value - 6 * 25_400),
                      })
                    }
                  >
                    -6&quot;
                  </button>
                  <button
                    id="bom-aisle-add-6"
                    type="button"
                    className="btn sel-btn"
                    onClick={() =>
                      onCommand({
                        type: 'setAisleAfter',
                        runId: run.id,
                        frameToFrame: aisle.frameToFrame.value + 6 * 25_400,
                      })
                    }
                  >
                    +6&quot;
                  </button>
                </>
              );
            })()}

          {selection.type === 'bay' &&
            (() => {
              const run = doc.runs[selection.runIndex];
              const bay = run?.bays[selection.bayIndex];
              if (run === undefined || bay === undefined) return null;
              const flueIn = Math.max(6, Math.round(run.rowSpacer / 25_400));
              return (
                <>
                  <span className="what sel-title">
                    Run {selection.runIndex + 1} · Bay {selection.bayIndex + 1}
                    {bay.locked ? ' (LOCKED)' : ''}
                  </span>
                  <button
                    id="bom-bay-insert-after"
                    type="button"
                    className="btn sel-btn"
                    onClick={() => onCommand({ type: 'insertBayAfter', bayId: bay.id })}
                  >
                    Insert after <kbd>I</kbd>
                  </button>
                  <button
                    id="bom-bay-split-run"
                    type="button"
                    className="btn sel-btn"
                    onClick={() => onCommand({ type: 'splitRun', bayId: bay.id })}
                  >
                    Split run <kbd>S</kbd>
                  </button>
                  <button
                    id="bom-bay-lock"
                    type="button"
                    className="btn sel-btn"
                    onClick={() => onCommand({ type: 'toggleLock', bayId: bay.id })}
                  >
                    {bay.locked ? 'Unlock' : 'Lock'} <kbd>L</kbd>
                  </button>
                  {run.backToBack && (
                    <span className="sel-flue-group">
                      <span className="what">Flue:</span>
                      <button
                        id="bom-flue-sub-6"
                        type="button"
                        className="btn sel-btn"
                        onClick={() =>
                          onCommand({
                            type: 'setField',
                            label: `Decrease ${run.name} flue by 6 in`,
                            change: {
                              section: 'run',
                              runId: run.id,
                              patch: { rowSpacer: Math.max(6, flueIn - 6) * 25_400 },
                            },
                          })
                        }
                      >
                        -6&quot;
                      </button>
                      <span className="what">{flueIn}&quot;</span>
                      <button
                        id="bom-flue-add-6"
                        type="button"
                        className="btn sel-btn"
                        onClick={() =>
                          onCommand({
                            type: 'setField',
                            label: `Increase ${run.name} flue by 6 in`,
                            change: {
                              section: 'run',
                              runId: run.id,
                              patch: { rowSpacer: (flueIn + 6) * 25_400 },
                            },
                          })
                        }
                      >
                        +6&quot;
                      </button>
                    </span>
                  )}
                  <button
                    id="bom-bay-delete"
                    type="button"
                    className="btn sel-btn sel-btn-danger"
                    onClick={() => {
                      onCommand({ type: 'deleteBay', bayId: bay.id });
                      setSelection(null);
                    }}
                  >
                    Delete <kbd>⌫</kbd>
                  </button>
                </>
              );
            })()}

          <button
            type="button"
            className="btn sel-btn"
            aria-label="Close toolbar"
            onClick={() => setSelection(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatUnitCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * The model records measured geometry as a storage string — `6096000um`. People
 * read feet and inches (OD-06: micrometres are storage only), so a micrometre
 * string is formatted on the way out and anything else is shown as written.
 */
function geometryText(geometry: string): string {
  const m = /^(\d+)um$/.exec(geometry);
  return m === null ? geometry : formatLength(um(Number(m[1])), { feetInches: true, metric: true });
}

export default function BomView(): React.JSX.Element {
  const {
    session,
    plan,
    runCommand,
    locationData,
    applyZipCodeIntelligence,
    sitePhotos,
    heavyDecking,
    saveCurrentSnapshot,
  } = useStudioSession();
  const doc = session.document;

  const [filter, setFilter] = useState<BomFilter>('all');
  const [rates, setRates] = useState<PricingRates>(DEFAULT_PRICING_RATES);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [zipInput, setZipInput] = useState<string>(locationData?.zipCode ?? '');
  const [isLocatingZip, setIsLocatingZip] = useState<boolean>(false);

  // Automated Logistics & Mechanical Systems state
  const [mdrConveyorFt, setMdrConveyorFt] = useState<number>(0);
  const [spiralChutesQty, setSpiralChutesQty] = useState<number>(0);
  const [sortationDivertsQty, setSortationDivertsQty] = useState<number>(0);
  const [amrCharging, setAmrCharging] = useState<boolean>(false);
  const [safetyFencing, setSafetyFencing] = useState<boolean>(false);
  const [stagingBuffers, setStagingBuffers] = useState<boolean>(false);
  const [palletsPerHour, setPalletsPerHour] = useState<number>(28);

  useEffect(() => {
    if (locationData !== null) {
      setZipInput(locationData.zipCode);
      setRates((prev) => ({
        ...prev,
        taxRate: locationData.taxRate / 100,
        freightRate: locationData.freightMultiplier,
      }));
    }
  }, [locationData]);

  // Compute BOM lines and counts (memoized against geometric & structural dependencies)
  const lines = useMemo(() => bomForDocument(doc), [doc]);
  const summary = useMemo(() => takeoffSummary(lines, doc), [lines, doc]);
  const effectiveRates = useMemo<PricingRates>(
    () => ({
      ...rates,
      deckEach: heavyDecking ? Math.round(rates.deckEach * 1.35 * 100) / 100 : rates.deckEach,
    }),
    [heavyDecking, rates],
  );
  const estimate = useMemo(
    () => pricingForDocument(doc, effectiveRates),
    [doc, effectiveRates],
  );
  const readiness = useMemo(() => quoteReadinessForDocument(doc), [doc]);

  // Mechanical & Automation budget and footprint calculations
  const mechanicalSubtotal = useMemo(() => {
    const mdrCost = mdrConveyorFt * 285;
    const spiralCost = spiralChutesQty * 14_500;
    const divertCost = sortationDivertsQty * 6_800;
    const amrCost = amrCharging ? 18_000 : 0;
    const fenceCost = safetyFencing ? 7_500 : 0;
    const bufferCost = stagingBuffers ? 4_200 : 0;
    return mdrCost + spiralCost + divertCost + amrCost + fenceCost + bufferCost;
  }, [
    amrCharging,
    mdrConveyorFt,
    safetyFencing,
    sortationDivertsQty,
    spiralChutesQty,
    stagingBuffers,
  ]);

  const roboticsFootprintDeduction = useMemo(() => {
    let deductedPositions = 0;
    if (amrCharging) deductedPositions += 8;
    if (safetyFencing) deductedPositions += 4;
    if (stagingBuffers) deductedPositions += 12;
    return deductedPositions;
  }, [amrCharging, safetyFencing, stagingBuffers]);

  const netUsablePositionsAfterRobotics = Math.max(
    0,
    summary.totalPalletPositions - roboticsFootprintDeduction,
  );
  const aisleCapacityPerHour = Math.max(1, plan.aisles.length) * 35;
  const isThroughputBottleneck = palletsPerHour > aisleCapacityPerHour;

  const filteredLines = useMemo(() => {
    if (filter === 'resolved') return lines.filter((l) => l.resolved);
    if (filter === 'unresolved') return lines.filter((l) => !l.resolved);
    return lines;
  }, [lines, filter]);

  const handleRateChange = (field: keyof PricingRates, value: number) => {
    setRates((prev) => ({
      ...prev,
      [field]: Number.isFinite(value) ? value : 0,
    }));
  };

  const handleBomZipChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const zip = e.target.value.replace(/\D/g, '').slice(0, 5);
    setZipInput(zip);
    if (zip.length === 5) {
      setIsLocatingZip(true);
      const data = await applyZipCodeIntelligence(zip);
      setIsLocatingZip(false);
      if (data !== null) {
        setExportNotice(
          `USGS & LTL Location Intelligence applied for ${data.zipCode} (${data.city} · ${data.seismicCategory} · ${data.taxRate}% tax · ${Math.round(data.freightMultiplier * 100)}% LTL freight).`,
        );
      }
    }
  };

  return (
    <section className="bom-view" aria-labelledby="view-heading-bom">
      <div
        id="bom-quote-banner"
        className={readiness.isQuoteReady ? 'bom-quote-banner ready' : 'bom-quote-banner draft'}
        role="status"
      >
        <strong>{readiness.watermark ?? 'Valid for Quote (Screening Complete)'}</strong>
        {!readiness.isQuoteReady && (
          <details className="bom-quote-reasons" style={{ display: 'inline-block', marginLeft: '8px' }}>
            <summary style={{ cursor: 'pointer' }}>
              {readiness.blockingReasons.length} items pending verification
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
              {readiness.blockingReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {exportNotice !== null && (
        <div id="bom-export-notice" className="bom-export-notice" role="alert">
          {exportNotice}
        </div>
      )}

      <div className="bom-header">
        <div>
          <h1 id="view-heading-bom" className="bom-title">
            Takeoff
          </h1>
          <p className="bom-subtitle">
            Quantities derived from the layout by the Interlake counting rules, the internal estimate, and
            the lines that are not resolved yet.
          </p>
        </div>
        <div className="bom-kpis">
          <div className="blueprint kpi-card">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <span className="kpi-label">Pallet Positions</span>
            <span className="kpi-value font-mono">{summary.totalPalletPositions.toLocaleString()}</span>
          </div>
          <div className="blueprint kpi-card highlight">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <span className="kpi-label">Proposal Price</span>
            <span className="kpi-value font-mono">{formatCurrency(estimate.totalPrice)}</span>
            <span className="kpi-sub font-mono">{formatUnitCurrency(estimate.pricePerPosition)} / pos</span>
          </div>
        </div>
      </div>

      <div className="bom-layout">
        {/* Main Column: BOM Table & Filter */}
        <div className="bom-main">
          <div className="bom-toolbar">
            <div className="seg" role="tablist" aria-label="BOM line filter">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={`seg-opt ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All Lines ({lines.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'resolved'}
                className={`seg-opt ${filter === 'resolved' ? 'active' : ''}`}
                onClick={() => setFilter('resolved')}
              >
                Resolved ({summary.resolvedCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'unresolved'}
                className={`seg-opt ${filter === 'unresolved' ? 'active' : ''}`}
                onClick={() => setFilter('unresolved')}
              >
                Unresolved Register ({summary.unresolvedCount})
              </button>
            </div>

            <div className="bom-actions">
              <button
                id="bom-export-csv"
                type="button"
                className="btn"
                onClick={() => {
                  const csv = exportBomCsv(lines, doc);
                  setExportNotice(`Exported Canonical CSV (${csv.split('\n').length} rows).`);
                }}
              >
                Export CSV
              </button>
              <button
                id="bom-export-json"
                type="button"
                className="btn"
                onClick={() => {
                  const json = exportBomJson(lines, doc);
                  setExportNotice(`Exported Canonical JSON (${json.length} bytes).`);
                }}
              >
                Export JSON
              </button>
              <button
                id="bom-export-xlsx"
                type="button"
                className="btn"
                onClick={() => {
                  const res = exportLegacyTakeoffXlsx();
                  setExportNotice(res.reason);
                }}
              >
                Export Takeoff (.xlsx)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!readiness.isQuoteReady}
                onClick={() => window.print()}
                title="Print or Save as Proposal PDF"
              >
                <span aria-hidden="true">⎙</span> Export Proposal PDF
              </button>
            </div>
          </div>

          <div className="blueprint bom-table-wrapper">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <table className="bom-table" aria-label="Bill of materials line items">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Category</th>
                  <th scope="col">Part Reference</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Derivation Rule</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((line, idx) => {
                  const partText =
                    line.partRef.kind === 'catalog'
                      ? `Catalog (${line.partRef.partRevisionId})`
                      : line.partRef.uncataloguedPartId;

                  return (
                    <tr key={`${line.category}-${idx}`} className={line.resolved ? 'resolved-row' : 'unresolved-row'}>
                      <td className="font-mono">{runScopeLabelForLine(line, doc)}</td>
                      <td>
                        <span className={`tag tag-accent cat-${line.category.toLowerCase()}`}>
                          {line.category}
                        </span>
                      </td>
                      <td className="part-col">
                        <span className="part-id font-mono">{partText}</span>
                        {line.partRef.kind === 'uncatalogued' && (
                          <span className="part-geom">{geometryText(line.partRef.measuredGeometry)}</span>
                        )}
                      </td>
                      <td className="qty-col font-mono">
                        {line.resolved ? (
                          <span className="qty-val">
                            {line.qty.value.toLocaleString()} <span className="uom">{line.uom}</span>
                          </span>
                        ) : (
                          <span className="unresolved-txt">{line.unresolvedReason}</span>
                        )}
                      </td>
                      <td className="rule-col">{line.ruleText}</td>
                      <td>
                        {line.resolved ? (
                          <span className="tag tag-accent">Resolved</span>
                        ) : (
                          <span className="tag tag-outline">Unresolved</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="resolved-row">
                  <th scope="row" colSpan={3}>
                    Job Total ({doc.runs.length} {doc.runs.length === 1 ? 'run' : 'runs'})
                  </th>
                  <td className="qty-col font-mono" colSpan={3}>
                    {summary.totalFrames.toLocaleString()} EA upright frames ·{' '}
                    {summary.totalBeamPairs.toLocaleString()} EA load beams ·{' '}
                    {summary.totalAnchors.toLocaleString()} EA wedge anchors
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Step 1: Mounted Interactive HTML5 Top-Down Layout Canvas */}
          <VisualGridInteractive
            document={doc}
            plan={plan}
            onCommand={(cmd) => {
              runCommand(cmd);
            }}
            onDownloadDxf={() => {
              const dxf = exportDocumentToDXF(doc);
              setExportNotice(
                `Downloaded AutoCAD .DXF block layout (Takeoff_${doc.revision}_Layout.dxf · ${dxf.split('\n').length} lines).`,
              );
            }}
          />

          {/* Automated Logistics & Mechanical Systems Estimator */}
          <div
            id="logistics-automation-card"
            className="blueprint bom-visual-grid-card"
            aria-label="Automated Logistics and Mechanical Systems"
          >
            <div className="bom-visual-grid-header">
              <div>
                <h2 className="pricing-title">Automated Logistics &amp; Mechanical Systems</h2>
                <p className="pricing-desc">
                  Conveyor &amp; routing calculators, AMR/AGV robotics infrastructure footprint, and
                  selective aisle throughput bottleneck analysis.
                </p>
              </div>
              <span className="tag tag-accent font-mono">
                +{formatCurrency(mechanicalSubtotal)} Mechanical / Automation
              </span>
            </div>

            <div className="bom-logistics-grid">
              <div className="bom-logistics-col">
                <h3 className="rate-controls-title">1. Conveyor &amp; Routing Calculators</h3>
                <div className="control-field">
                  <label htmlFor="conveyor-mdr-ft">MDR Conveyor (Linear Ft)</label>
                  <input
                    id="conveyor-mdr-ft"
                    className="input font-mono"
                    type="number"
                    min="0"
                    step="10"
                    value={mdrConveyorFt}
                    onChange={(e) => setMdrConveyorFt(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="control-field">
                  <label htmlFor="conveyor-spiral-qty">Gravity Spiral Chutes (Qty)</label>
                  <input
                    id="conveyor-spiral-qty"
                    className="input font-mono"
                    type="number"
                    min="0"
                    step="1"
                    value={spiralChutesQty}
                    onChange={(e) => setSpiralChutesQty(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="control-field">
                  <label htmlFor="conveyor-diverts-qty">Sortation Diverts (Qty)</label>
                  <input
                    id="conveyor-diverts-qty"
                    className="input font-mono"
                    type="number"
                    min="0"
                    step="1"
                    value={sortationDivertsQty}
                    onChange={(e) =>
                      setSortationDivertsQty(Math.max(0, Number(e.target.value) || 0))
                    }
                  />
                </div>
              </div>

              <div className="bom-logistics-col">
                <h3 className="rate-controls-title">2. Robotics Infrastructure Footprint</h3>
                <div className="pf-row pf-toggle-row">
                  <label htmlFor="toggle-amr-charging" className="pf-label">
                    AMR/AGV Charging Stations (−8 pos)
                  </label>
                  <button
                    id="toggle-amr-charging"
                    type="button"
                    role="switch"
                    aria-checked={amrCharging}
                    className={
                      amrCharging ? 'pf-toggle-switch pf-toggle-switch-on' : 'pf-toggle-switch'
                    }
                    onClick={() => setAmrCharging((v) => !v)}
                  >
                    <span className="pf-toggle-thumb" aria-hidden="true" />
                    <span className="pf-toggle-text">{amrCharging ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
                <div className="pf-row pf-toggle-row">
                  <label htmlFor="toggle-safety-fencing" className="pf-label">
                    Safety Fencing Perimeters (−4 pos)
                  </label>
                  <button
                    id="toggle-safety-fencing"
                    type="button"
                    role="switch"
                    aria-checked={safetyFencing}
                    className={
                      safetyFencing ? 'pf-toggle-switch pf-toggle-switch-on' : 'pf-toggle-switch'
                    }
                    onClick={() => setSafetyFencing((v) => !v)}
                  >
                    <span className="pf-toggle-thumb" aria-hidden="true" />
                    <span className="pf-toggle-text">{safetyFencing ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
                <div className="pf-row pf-toggle-row">
                  <label htmlFor="toggle-staging-buffers" className="pf-label">
                    Staging Buffers (−12 pos)
                  </label>
                  <button
                    id="toggle-staging-buffers"
                    type="button"
                    role="switch"
                    aria-checked={stagingBuffers}
                    className={
                      stagingBuffers ? 'pf-toggle-switch pf-toggle-switch-on' : 'pf-toggle-switch'
                    }
                    onClick={() => setStagingBuffers((v) => !v)}
                  >
                    <span className="pf-toggle-thumb" aria-hidden="true" />
                    <span className="pf-toggle-text">{stagingBuffers ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
                <p id="robotics-net-positions" className="font-mono">
                  Net Usable Storage Density:{' '}
                  <strong>{netUsablePositionsAfterRobotics.toLocaleString()} positions</strong> (
                  {roboticsFootprintDeduction} reserved for robotics infrastructure)
                </p>
              </div>

              <div className="bom-logistics-col">
                <h3 className="rate-controls-title">3. Throughput Estimator</h3>
                <div className="control-field">
                  <label htmlFor="throughput-pallets-hr">Pallets Moved / Hour</label>
                  <input
                    id="throughput-pallets-hr"
                    className="input font-mono"
                    type="number"
                    min="1"
                    step="5"
                    value={palletsPerHour}
                    onChange={(e) => setPalletsPerHour(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <div
                  id="throughput-bottleneck-alert"
                  className={
                    isThroughputBottleneck
                      ? 'pf-helper-callout pf-helper-warn'
                      : 'pf-helper-callout'
                  }
                  role="status"
                >
                  {isThroughputBottleneck ? (
                    <>
                      <strong>Selective Aisle Bottleneck Flagged:</strong> {palletsPerHour} pallets/hr
                      exceeds the {aisleCapacityPerHour} pallets/hr capacity across{' '}
                      {Math.max(1, plan.aisles.length)} selective aisle(s). Consider automated
                      high-density VLM, AMR fleet, or pallet shuttle alternatives.
                    </>
                  ) : (
                    <>
                      <strong>Throughput Within Selective Capacity:</strong> {palletsPerHour}{' '}
                      pallets/hr is within the {aisleCapacityPerHour} pallets/hr ceiling across{' '}
                      {Math.max(1, plan.aisles.length)} aisle(s).
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {sitePhotos.length > 0 && (
            <div
              id="bom-site-photos-card"
              className="blueprint bom-visual-grid-card"
              aria-label="Attached Site Survey Media"
            >
              <h2 className="pricing-title">
                Attached Site Survey Photos ({sitePhotos.length})
              </h2>
              <p className="pricing-desc">
                Slab conditions, dock door clearances, and column photos attached to this estimate
                package.
              </p>
              <div className="pf-photo-thumbs">
                {sitePhotos.map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Attached site survey photo ${idx + 1}`}
                    className="pf-photo-thumb"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Column: Estimating & Pricing Calculator */}
        <aside className="bom-sidebar" aria-label="Commercial Pricing Estimator">
          <div className="blueprint pricing-card">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <h2 className="pricing-title">Commercial Estimator</h2>
            <p className="pricing-desc">
              Budgetary pricing model ported from McMurray Stern field takeoff standards.
            </p>

            <div className="control-field">
              <label htmlFor="bom-zip-input">Site Zip Code (USGS &amp; LTL)</label>
              <input
                id="bom-zip-input"
                className="input font-mono"
                type="text"
                maxLength={5}
                placeholder="e.g. 90210"
                value={zipInput}
                onChange={(e) => {
                  void handleBomZipChange(e);
                }}
              />
            </div>
            {isLocatingZip && (
              <p className="font-mono" role="status">
                Locating USGS seismic &amp; LTL freight rates...
              </p>
            )}
            {locationData !== null && (
              <div id="bom-location-summary" className="pf-helper-callout" role="status">
                <strong>
                  {locationData.city} ({locationData.state})
                </strong>{' '}
                · {locationData.seismicCategory} · Tax {locationData.taxRate}% · LTL{' '}
                {Math.round(locationData.freightMultiplier * 100)}%
              </div>
            )}

            <div className="cost-breakdown">
              <div className="cost-row">
                <span>
                  Upright Frames ({summary.totalFrames} ea across {doc.runs.length}{' '}
                  {doc.runs.length === 1 ? 'run' : 'runs'})
                </span>
                <span className="cost-val font-mono">{formatCurrency(estimate.frameCost)}</span>
              </div>
              <div className="cost-row">
                <span>Load Beams ({summary.totalBeamPairs} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.beamCost)}</span>
              </div>
              <div className="cost-row">
                <span>
                  Wire Decks (
                  {summary.totalDecks > 0
                    ? `${summary.totalDecks} panels`
                    : 'budgetary allowance'}
                  )
                </span>
                <span className="cost-val font-mono">{formatCurrency(estimate.deckCost)}</span>
              </div>
              <div className="cost-row">
                <span>
                  Row Spacers (
                  {summary.totalSpacers > 0
                    ? `${summary.totalSpacers} ea`
                    : 'budgetary allowance'}
                  )
                </span>
                <span className="cost-val font-mono">{formatCurrency(estimate.spacerCost)}</span>
              </div>
              <div className="cost-row">
                <span>Floor Anchors ({summary.totalAnchors} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.anchorCost)}</span>
              </div>
              <div className="cost-divider" />
              <div className="cost-row bold">
                <span>Materials Subtotal</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.materialsSubtotal)}</span>
              </div>
              <div className="cost-row">
                <span>Freight ({Math.round(rates.freightRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.freight)}</span>
              </div>
              <div className="cost-row">
                <span>Install Labor ({Math.round(rates.installRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.installation)}</span>
              </div>
              <div className="cost-row">
                <span>Sales Tax ({Number((rates.taxRate * 100).toFixed(2))}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.salesTax)}</span>
              </div>
              <div className="cost-divider thick" />
              {mechanicalSubtotal > 0 && (
                <div className="cost-row">
                  <span>Automated Logistics &amp; Mechanical</span>
                  <span className="cost-val font-mono">{formatCurrency(mechanicalSubtotal)}</span>
                </div>
              )}
              <div className="cost-row grand-total">
                <span>Estimated Proposal Total</span>
                <span className="cost-val highlight font-mono">
                  {formatCurrency(estimate.totalPrice + mechanicalSubtotal)}
                </span>
              </div>
              <div className="cost-unit-pos font-mono">
                {formatUnitCurrency(estimate.pricePerPosition)} per pallet position
                {heavyDecking ? ' · Heavy Wire Decking Active' : ''}
              </div>
            </div>

            <div className="bom-cloud-persistence">
              <button
                id="bom-cloud-save-btn"
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '8px' }}
                onClick={() => {
                  const snap = saveCurrentSnapshot(`${doc.name} (${doc.revision} Takeoff Quote)`);
                  setExportNotice(
                    `Saved Cloud Quote Version "${snap.label}" (${snap.positionsCount} positions) for workstation continuity.`,
                  );
                }}
              >
                Save Cloud Quote Version
              </button>
            </div>

            <details className="rate-controls">
              <summary className="rate-controls-title" style={{ cursor: 'pointer' }}>
                Internal Estimator Rates &amp; Margin
              </summary>
              <div className="cost-row">
                <span>Internal Cost Basis</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.subtotalBeforeMargin)}</span>
              </div>
              <div className="cost-row margin-row">
                <span>Target Gross Margin ({Math.round(rates.marginRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.targetMargin)}</span>
              </div>
              <div className="control-field">
                <label htmlFor="rate-frame">Frame $/ft</label>
                <input
                  id="rate-frame"
                  className="input font-mono"
                  type="number"
                  step="0.25"
                  min="1"
                  value={rates.framePerFt}
                  onChange={(e) => handleRateChange('framePerFt', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-beam">Beam $/ft</label>
                <input
                  id="rate-beam"
                  className="input font-mono"
                  type="number"
                  step="0.10"
                  min="1"
                  value={rates.beamPerFt}
                  onChange={(e) => handleRateChange('beamPerFt', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-deck">Deck $/panel</label>
                <input
                  id="rate-deck"
                  className="input font-mono"
                  type="number"
                  step="0.50"
                  min="1"
                  value={rates.deckEach}
                  onChange={(e) => handleRateChange('deckEach', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-margin">Target Margin %</label>
                <input
                  id="rate-margin"
                  className="input font-mono"
                  type="number"
                  step="1"
                  min="5"
                  max="50"
                  value={Math.round(rates.marginRate * 100)}
                  onChange={(e) => handleRateChange('marginRate', parseFloat(e.target.value) / 100)}
                />
              </div>
            </details>
          </div>
        </aside>
      </div>
    </section>
  );
}
