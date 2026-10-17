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
  planGeometry,
  type Command,
  type StudioDocument,
} from '@rms/studio-model';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hitTestPlan, type PlanHit } from './hit-test.js';
import { readPens } from './use-pens.js';

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

/** One HUD chip. `pending` marks a measure this build does not yet produce. */
function Chip({
  label,
  value,
  pending = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly pending?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={pending ? 'chip chip-pending' : 'chip'}
      aria-disabled={pending || undefined}
      title={pending ? 'Not implemented — arrives with the screening checks' : undefined}
    >
      <span className="chip-label">{label}</span>
      <b className="chip-value">{value}</b>
      {pending && <span className="visually-hidden">not implemented</span>}
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
  onCommand,
  onUndo,
}: {
  readonly document: StudioDocument;
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
  const plan = useMemo(() => planGeometry(doc), [doc]);

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
    draw(ctx, list, { camera, viewport, dpr, pens });
    drawOverlays(ctx, { camera, viewport, dpr, pens });
  }, [camera, list, viewport]);

  useEffect(() => {
    render();
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
      setHovered(hitTestPlan(plan, world.x, world.y, effectiveCamera.scale));
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
    <div className="plan-wrap" ref={wrapRef}>
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
      </svg>

      {/* S4.2 Floating selection toolbar */}
      {activeSelection !== null && (
        <div
          id="seltoolbar"
          className="sel-toolbar"
          role="toolbar"
          aria-label="Selected bay actions"
        >
          <span id="seltitle" className="sel-title">
            {activeSelection.run.label} · Bay {activeSelection.bay.index + 1}
            {activeSelection.bay.locked ? ' (LOCKED)' : ''}
          </span>
          <button
            type="button"
            className="sel-btn"
            data-act="insert"
            onClick={() => actOnSelection('insert')}
          >
            Insert bay (I)
          </button>
          <button
            type="button"
            className="sel-btn"
            data-act="split"
            onClick={() => actOnSelection('split')}
          >
            Split run (S)
          </button>
          <button
            type="button"
            className="sel-btn"
            data-act="lock"
            onClick={() => actOnSelection('lock')}
          >
            {activeSelection.bay.locked ? 'Unlock (L)' : 'Lock (L)'}
          </button>
          <button
            type="button"
            className="sel-btn sel-btn-danger"
            data-act="delete"
            onClick={() => actOnSelection('delete')}
          >
            Delete bay (⌫)
          </button>
          <button
            type="button"
            className="sel-btn"
            data-act="deselect"
            aria-label="Clear selection"
            onClick={() => actOnSelection('deselect')}
          >
            ×
          </button>
        </div>
      )}

      {/* S3.5 Legend strip */}
      <div id="legend" className="plan-legend" aria-label="Drawing legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-upright" aria-hidden="true" />
          Upright &amp; beam
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-load" aria-hidden="true" />
          Unit load footprint
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-flue" aria-hidden="true" />
          Flue space
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-locked" aria-hidden="true" />
          Locked bay
        </span>
      </div>

      <div className="plan-hud" role="group" aria-label="Layout summary">
        <Chip label="Pallet positions" value={String(plan.totalPositions)} />
        <Chip label="Bays" value={String(plan.totalBays)} />
        <Chip
          label="Narrowest clear aisle"
          value={
            plan.narrowestClearAisle === null
              ? 'No aisle'
              : formatFeetInches(plan.narrowestClearAisle.value)
          }
        />
        <Chip label="Failing" value="—" pending />
        <Chip label="Awaiting input" value="—" pending />
        <Chip label="Awaiting source" value="—" pending />
        <span className="plan-hud-sep" aria-hidden="true" />
        <span className="plan-hud-muted">
          {camera === null ? 'fitting…' : `${(camera.scale * 25_400).toFixed(2)} px/in`}
        </span>
        <button type="button" className="plan-fit" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}
