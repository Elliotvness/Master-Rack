import { buildDetailedPlan } from '@rms/display-list';
import {
  draw,
  drawOverlays,
  fitExtent,
  panByScreen,
  zoomAbout,
  type Camera,
} from '@rms/render-canvas';
import { planGeometry, type StudioDocument } from '@rms/studio-model';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

/**
 * The plan viewport.
 *
 * The chain, in one place so it can be read: **document → `planGeometry` →
 * `buildDetailedPlan` → `draw`**. Each arrow is a package boundary, and the component
 * crosses them without doing arithmetic of its own — no bay pitch, no clear
 * width, no formatting. ADR-018 rule 4 forbids arithmetic in a render, and
 * `check-app-boundaries` forbids this app binding anything named `derive*`.
 *
 * **Camera state is view state** (ADR-018 rule 3): it lives in `useState`, it is
 * not in the document, and panning cannot change a content hash. That is what
 * keeps §13's immutability and the audit chain meaning something.
 *
 * Pointer handling follows the blueprint's §9 flow: pointer capture on down,
 * batched through `requestAnimationFrame` on move, and no derivation on either.
 * Pan and zoom recompute nothing — the display list is memoised on the document
 * alone, so a camera change redraws and re-derives nothing.
 */
export function PlanCanvas({ document: doc }: { readonly document: StudioDocument }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
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

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || camera === null || viewport.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    // Re-read the ratio every frame: a window dragged to another display
    // changes it, and a canvas sized once is blurry from then on.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const pens = readPens(window.document.documentElement);
    draw(ctx, list, { camera, viewport, dpr, pens });
    // Screen-space, and drawn AFTER the world so they are never culled and hold
    // their size as the camera zooms.
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

  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const from = dragging.current;
      if (from === null || camera === null) return;
      setCamera(panByScreen(camera, e.clientX - from.x, e.clientY - from.y));
      dragging.current = { x: e.clientX, y: e.clientY };
      schedule();
    },
    [camera, schedule],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragging.current = null;
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (camera === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Zoom about the cursor, so the thing being examined stays put.
      setCamera(zoomAbout(camera, viewport, anchor, e.deltaY < 0 ? 1.12 : 1 / 1.12));
    },
    [camera, viewport],
  );

  const fit = useCallback(() => {
    if (viewport.width > 0) setCamera(fitExtent(viewport, list.extent));
  }, [viewport, list.extent]);

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
        // The canvas is not the only way to reach this information — the same
        // counts are in the HUD below as text, which is what a screen reader
        // and a keyboard user get. A bitmap is never the sole source.
        role="img"
        aria-label={`Plan view: ${doc.runs.length} rack runs, ${list.items.length} drawn items`}
      />
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
        {/*
          The three finding chips are PLACEHOLDERS, and they say so rather than
          showing a zero. A zero here would read as "nothing failing", which is
          a claim about the layout; "not implemented" is a claim about the
          build. They become real in S5, when kernel-checks is wired.
        */}
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
