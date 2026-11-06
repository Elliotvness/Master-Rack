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

import { hitTestPlan, type PlanHit } from './hit-test.js';
import { readPens } from './use-pens.js';

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
}: {
  readonly plan: PlanGeometry;
  readonly requiredClearAisleUm: number;
  readonly camera: Camera;
  readonly viewport: { readonly width: number; readonly height: number };
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

  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
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

      {/* 3. Pallet footprints with internal crossbars + crisp rack row/bay framing + left Run labels */}
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

        return (
          <g key={`run-graphic:${run.runId}`}>
            <text
              x={labelPt.x - 12}
              y={labelPt.y}
              textAnchor="end"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize="10.5"
              fontWeight="500"
              fill="var(--ink-2)"
            >
              {run.label}
            </text>

            {run.pallets.map((p) => {
              const tl = worldToScreen(camera, viewport, { x: p.x, y: p.y });
              const w = Math.max(1, p.width * camera.scale);
              const h = Math.max(1, p.depth * camera.scale);
              const cx = tl.x + w / 2;
              const cy = tl.y + h / 2;
              return (
                <g key={`pallet:${p.id}`}>
                  <rect
                    x={tl.x}
                    y={tl.y}
                    width={w}
                    height={h}
                    className="plan-pallet-wash"
                  />
                  <line
                    x1={cx}
                    y1={tl.y + 1}
                    x2={cx}
                    y2={tl.y + h - 1}
                    stroke="var(--paper)"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={tl.x + 1}
                    y1={cy}
                    x2={tl.x + w - 1}
                    y2={cy}
                    stroke="var(--paper)"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })}

            {run.rows.map((row, rowIdx) => {
              const rowTl = worldToScreen(camera, viewport, { x: run.x, y: row.y });
              const rowW = Math.max(1, run.runLength.value * camera.scale);
              const rowH = Math.max(1, row.depth * camera.scale);
              return (
                <g key={`row-frame:${run.runId}:${rowIdx}`}>
                  <rect
                    x={rowTl.x}
                    y={rowTl.y}
                    width={rowW}
                    height={rowH}
                    fill="none"
                    stroke="var(--pen-upright)"
                    strokeWidth="1.75"
                  />
                  {Array.from({ length: run.bays.length + 1 }, (_, i) => {
                    const ux = worldToScreen(camera, viewport, {
                      x: run.x + i * run.bayPitch.value,
                      y: row.y,
                    }).x;
                    return (
                      <line
                        key={`upright-div:${run.runId}:${rowIdx}:${i}`}
                        x1={ux}
                        y1={rowTl.y}
                        x2={ux}
                        y2={rowTl.y + rowH}
                        stroke="var(--pen-upright)"
                        strokeWidth="1.5"
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
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
  onCommand,
  onUndo,
}: {
  readonly document: StudioDocument;
  readonly plan?: PlanGeometry | undefined;
  readonly findingCounts?: FindingCounts | undefined;
  readonly onCommand?: (command: Command) => void;
  readonly onUndo?: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<SelectedBay | null>(null);
  const [hovered, setHovered] = useState<PlanHit | null>(null);
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

  const list = useMemo(
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

  const effectiveCamera = useMemo(
    () => camera ?? fitExtent(effectiveViewport, list.extent),
    [camera, effectiveViewport, list.extent],
  );

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
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom does not implement pointer capture
      }
    }
    dragging.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragging.current;
      if (drag !== null) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (dist > 3 && camera !== null) {
          drag.moved = true;
          setCamera(panByScreen(camera, e.clientX - drag.lastX, e.clientY - drag.lastY));
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          schedule();
        }
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const world = screenToWorld(effectiveCamera, effectiveViewport, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      const nextHit = hitTestPlan(plan, world.x, world.y, effectiveCamera.scale);
      setHovered((prev) => (sameHit(prev, nextHit) ? prev : nextHit));
    },
    [camera, effectiveCamera, effectiveViewport, plan, schedule],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (
        typeof e.currentTarget.hasPointerCapture === 'function' &&
        e.currentTarget.hasPointerCapture(e.pointerId)
      ) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const drag = dragging.current;
      dragging.current = null;

      if (drag !== null && !drag.moved) {
        const rect = e.currentTarget.getBoundingClientRect();
        const world = screenToWorld(effectiveCamera, effectiveViewport, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        const hit = hitTestPlan(plan, world.x, world.y, effectiveCamera.scale);
        if (hit?.kind === 'bay') {
          setSelected({ runId: hit.runId, bayId: hit.bayId, bayIndex: hit.bayIndex });
        } else {
          setSelected(null);
        }
      }
    },
    [effectiveCamera, effectiveViewport, plan],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (camera === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setCamera(zoomAbout(camera, viewport, anchor, e.deltaY < 0 ? 1.12 : 1 / 1.12));
    },
    [camera, viewport],
  );

  const fit = useCallback(() => {
    if (viewport.width > 0) setCamera(fitExtent(viewport, list.extent));
  }, [viewport, list.extent]);

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
  // Backspace/Delete = delete bay, Escape = deselect, Ctrl/Cmd+Z = undo.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
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
      } else if (e.key === 'Escape') {
        e.preventDefault();
        actOnSelection('deselect');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSelection, actOnSelection, onUndo]);

  return (
    <div className="plan-stage stage">
      <div className="blueprint canvaswrap plan-wrap" ref={wrapRef}>
        <div className="corner tl" aria-hidden="true" />
        <div className="corner tr" aria-hidden="true" />
        <div className="corner bl" aria-hidden="true" />
        <div className="corner br" aria-hidden="true" />

        <canvas
          ref={canvasRef}
          className="plan-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
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
                  onClick={() =>
                    setSelected({ runId: run.runId, bayId: bay.bayId, bayIndex: bay.index })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected({ runId: run.runId, bayId: bay.bayId, bayIndex: bay.index });
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
          <button type="button" className="btn plan-fit" onClick={fit} title="Fit to view">
            Fit
          </button>
        </div>

        {/* S4.2 Floating selection toolbar */}
        {activeSelection !== null && (
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
        )}
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
          CLICK A BAY OR AISLE TO SELECT · DRAG TO PAN · SCROLL TO ZOOM
        </span>
      </div>
    </div>
  );
}
