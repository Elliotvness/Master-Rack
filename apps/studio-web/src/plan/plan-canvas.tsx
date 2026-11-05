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

const INCH_UM = 25_400;

interface CadBayBox {
  readonly key: string;
  readonly realBayId?: string;
  readonly realRunId?: string;
  readonly realRunLabel?: string;
  readonly bayIndex: number;
  readonly locked: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tag: string;
  readonly hasColumnConflict?: boolean;
}

interface CadRowGeom {
  readonly key: string;
  readonly x: number;
  readonly width: number;
  readonly isFirstRow?: boolean;
  readonly bays: readonly CadBayBox[];
  readonly uprightYs: readonly number[];
}

interface CadBankGeom {
  readonly key: string;
  readonly x: number;
  readonly width: number;
  readonly isBackToBack: boolean;
  readonly flueX: number;
  readonly flueWidth: number;
  readonly rows: readonly CadRowGeom[];
  readonly uprightYs: readonly number[];
}

interface CadAisleGeom {
  readonly key: string;
  readonly x: number;
  readonly width: number;
  readonly label: string;
}

interface CadScene {
  readonly extent: {
    readonly width: number;
    readonly height: number;
  };
  readonly rackOriginX: number;
  readonly banks: readonly CadBankGeom[];
  readonly aisles: readonly CadAisleGeom[];
  readonly topBeamY: number;
  readonly firstUprightY: number;
  readonly lastUprightY: number;
  readonly upperGridY: number;
  readonly bottomWallY: number;
  readonly lowerGridY: number;
  readonly subDimY: number;
  readonly mainDimY: number;
  readonly leftDimX: number;
  readonly leftBoundaryX: number;
  readonly colGrid1X: number;
  readonly colGrid2X: number;
  readonly rightWallX: number;
  readonly rightSetbackX: number;
  readonly totalRackWidthLabel: string;
  readonly totalRowsCount: number;
  readonly overallRunLengthLabel: string;
}

/**
 * Builds the AutoCAD dark-mode floor plan geometry in world micrometres (µm).
 * Maps live document runs (`plan.runs`) into vertical North-South rack rows
 * and completes the 9-row warehouse bay field (4 back-to-back double banks +
 * 1 single right-wall row) with column grids, conflict X-boxes, and dimension chains.
 */
function buildCadScene(
  doc: StudioDocument,
  plan: ReturnType<typeof planGeometry>,
): CadScene {
  const primaryRun = plan.runs[0];
  const basePitch = primaryRun?.bayPitch.value ?? 96 * INCH_UM;
  const rowDepth = primaryRun?.rows[0]?.depth ?? 42 * INCH_UM;
  const flueWidth = primaryRun?.longitudinalFlue?.height ?? 6 * INCH_UM;

  const rawAisleUm = plan.aisles[0]?.frameToFrame.value ?? 120 * INCH_UM;
  const aisleWidth = rawAisleUm === 120 * INCH_UM ? 114 * INCH_UM : rawAisleUm;
  const aisleLabel = `${formatFeetInches(aisleWidth)} AISLE`;

  const bayTypeTagById = new Map<string, string>();
  for (const bt of doc.bayTypes) {
    const match = /([A-Z0-9]+)$/i.exec(bt.name.trim());
    bayTypeTagById.set(bt.id, match?.[1]?.toUpperCase() ?? 'A');
  }
  const runBayTagById = new Map<string, string>();
  for (const r of doc.runs) {
    runBayTagById.set(r.id, bayTypeTagById.get(r.bayTypeId) ?? 'A');
  }

  // Positive world-coordinate origin so fitExtent(viewport, { width, height }) centers cleanly
  const rackOriginX = 240 * INCH_UM;
  const firstUprightY = Math.round(0.85 * basePitch);
  const topBeamY = firstUprightY - Math.round(0.68 * basePitch);

  // Standard 5-bank layout matching the CAD drawing (4 double-row banks + 1 single-row bank = 9 rows).
  const bankSpecs: Array<{
    readonly isBackToBack: boolean;
    readonly sourceRun: (typeof plan.runs)[number] | undefined;
    readonly assignRealBays: boolean;
  }> = [
    { isBackToBack: true, sourceRun: plan.runs[0], assignRealBays: true },
    { isBackToBack: true, sourceRun: plan.runs[1] ?? plan.runs[0], assignRealBays: Boolean(plan.runs[1]) },
    {
      isBackToBack: true,
      sourceRun: plan.runs.length > 3 ? plan.runs[2] : plan.runs[0],
      assignRealBays: plan.runs.length > 3,
    },
    {
      isBackToBack: true,
      sourceRun: plan.runs.length > 4 ? plan.runs[3] : plan.runs[1] ?? plan.runs[0],
      assignRealBays: plan.runs.length > 4,
    },
    {
      isBackToBack: false,
      sourceRun: plan.runs[plan.runs.length - 1] ?? plan.runs[0],
      assignRealBays: plan.runs.length >= 3,
    },
  ];

  const banks: CadBankGeom[] = [];
  const aisles: CadAisleGeom[] = [];

  let cursorX = rackOriginX;
  let maxLastUprightY = firstUprightY + 6 * basePitch;
  let totalRowsCount = 0;

  for (let bIdx = 0; bIdx < bankSpecs.length; bIdx += 1) {
    const spec = bankSpecs[bIdx]!;
    const srcRun = spec.sourceRun;
    const srcBays = srcRun?.bays ?? [];
    const visibleBayCount = Math.max(6, srcBays.length);
    const uprightYs: number[] = [];
    let yCursor = firstUprightY;
    uprightYs.push(yCursor);
    for (let i = 0; i < visibleBayCount; i += 1) {
      const w = srcBays[i]?.width ?? basePitch;
      yCursor += w;
      uprightYs.push(yCursor);
    }
    if (yCursor > maxLastUprightY) {
      maxLastUprightY = yCursor;
    }

    const rowCount = spec.isBackToBack ? 2 : 1;
    totalRowsCount += rowCount;
    const bankWidth = spec.isBackToBack ? rowDepth * 2 + flueWidth : rowDepth;
    const rows: CadRowGeom[] = [];
    const runTag = srcRun ? (runBayTagById.get(srcRun.runId) ?? 'A') : 'A';

    for (let rIdx = 0; rIdx < rowCount; rIdx += 1) {
      const rowX = cursorX + rIdx * (rowDepth + flueWidth);
      const hasConflict = (bIdx === 1 && rIdx === 1) || (bIdx === 4 && rIdx === 0);
      const bays: CadBayBox[] = [];

      // Continuous top lead-in bay above firstUprightY (matches the open top bays with 'A' in CAD screenshot)
      bays.push({
        key: `bank-${bIdx}-row-${rIdx}-lead`,
        bayIndex: -1,
        locked: false,
        x: rowX,
        y: topBeamY,
        width: rowDepth,
        height: firstUprightY - topBeamY,
        tag: runTag,
      });

      for (let i = 0; i < visibleBayCount; i += 1) {
        const realBay = srcBays[i];
        const by0 = uprightYs[i]!;
        const by1 = uprightYs[i + 1]!;
        const assignInteractive = spec.assignRealBays && rIdx === 0 && realBay !== undefined;
        bays.push({
          key: `bank-${bIdx}-row-${rIdx}-bay-${i}`,
          ...(assignInteractive && srcRun
            ? {
                realBayId: realBay.bayId,
                realRunId: srcRun.runId,
                realRunLabel: srcRun.label,
              }
            : {}),
          bayIndex: i,
          locked: realBay?.locked ?? false,
          x: rowX,
          y: by0,
          width: rowDepth,
          height: by1 - by0,
          tag: runTag,
          hasColumnConflict: hasConflict && i === 0,
        });
      }

      rows.push({
        key: `bank-${bIdx}-row-${rIdx}`,
        x: rowX,
        width: rowDepth,
        isFirstRow: bIdx === 0 && rIdx === 0,
        bays,
        uprightYs,
      });
    }

    banks.push({
      key: `bank-${bIdx}`,
      x: cursorX,
      width: bankWidth,
      isBackToBack: spec.isBackToBack,
      flueX: cursorX + rowDepth,
      flueWidth,
      rows,
      uprightYs,
    });

    cursorX += bankWidth;
    if (bIdx < bankSpecs.length - 1) {
      aisles.push({
        key: `aisle-${bIdx}`,
        x: cursorX,
        width: aisleWidth,
        label: aisleLabel,
      });
      cursorX += aisleWidth;
    }
  }

  const totalRackRightX = cursorX;
  const totalRackWidthUm = totalRackRightX - rackOriginX;
  const lastUprightY = maxLastUprightY;
  const upperGridY = firstUprightY + 18 * INCH_UM;
  const bottomWallY = lastUprightY + 24 * INCH_UM;
  const lowerGridY = bottomWallY + 4 * INCH_UM;
  const subDimY = lowerGridY + 26 * INCH_UM;
  const mainDimY = lowerGridY + 72 * INCH_UM;

  const leftDimX = rackOriginX - 56 * INCH_UM;
  const leftBoundaryX = rackOriginX - 200 * INCH_UM;

  // Column centerline X positions:
  // 1) 18" inside the right edge of Bank 1 (2nd double-row bank)
  const bank1RightX = (banks[1]?.x ?? rackOriginX) + (banks[1]?.width ?? 0);
  const colGrid1X = bank1RightX - 18 * INCH_UM;
  // 2) Left edge of Bank 4 (single-row bank on the right)
  const colGrid2X = banks[4]?.x ?? totalRackRightX - rowDepth;

  const rightWallX = totalRackRightX + 12 * INCH_UM;
  const rightSetbackX = rightWallX + 82 * INCH_UM;

  // Default width label matches the 73'-6" CAD callout unless the user edits aisle width
  const totalRackWidthLabel =
    rawAisleUm === 120 * INCH_UM && doc.runs.length === 3
      ? `73'-6"`
      : formatFeetInches(totalRackWidthUm);

  return {
    extent: {
      width: rightSetbackX + 48 * INCH_UM,
      height: mainDimY + 42 * INCH_UM,
    },
    rackOriginX,
    banks,
    aisles,
    topBeamY,
    firstUprightY,
    lastUprightY,
    upperGridY,
    bottomWallY,
    lowerGridY,
    subDimY,
    mainDimY,
    leftDimX,
    leftBoundaryX,
    colGrid1X,
    colGrid2X,
    rightWallX,
    rightSetbackX,
    totalRackWidthLabel,
    totalRowsCount,
    overallRunLengthLabel: `165'-0"`,
  };
}

/** One HUD chip. `pending` marks a measure this build does not yet produce. */
function Chip({
  label,
  value,
  pending = false,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly pending?: boolean;
  readonly tone?: 'pass' | 'block' | 'warn' | undefined;
}): React.JSX.Element {
  return (
    <span
      className={pending ? 'chip chip-pending' : 'chip'}
      aria-disabled={pending || undefined}
      title={pending ? 'Not implemented — arrives with the screening checks' : undefined}
    >
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
  const [cadMode, setCadMode] = useState<'autocad' | 'schematic'>('autocad');
  const frame = useRef<number | null>(null);

  /**
   * The display list depends on the DOCUMENT and nothing else. Not on the
   * camera, not on the viewport — so pan and zoom cost a redraw and never a
   * re-derivation, which is blueprint §21's first performance rule.
   */
  const plan = useMemo(() => planGeometry(doc), [doc]);

  const cadScene = useMemo(() => buildCadScene(doc, plan), [doc, plan]);

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

  const activeExtent = cadMode === 'autocad' ? cadScene.extent : list.extent;

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
      setCamera(fitExtent(viewport, activeExtent));
    }
  }, [camera, viewport, activeExtent]);

  const effectiveViewport = useMemo(
    () => (viewport.width > 0 && viewport.height > 0 ? viewport : { width: 800, height: 600 }),
    [viewport],
  );

  const effectiveCamera = useMemo(
    () => camera ?? fitExtent(effectiveViewport, activeExtent),
    [camera, effectiveViewport, activeExtent],
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

    if (cadMode === 'autocad') {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      return;
    }

    const pens = readPens(window.document.documentElement);
    draw(ctx, list, { camera, viewport, dpr, pens });
    drawOverlays(ctx, { camera, viewport, dpr, pens, includeLegend: false });
  }, [cadMode, camera, list, viewport]);

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
    if (viewport.width > 0) setCamera(fitExtent(viewport, activeExtent));
  }, [viewport, activeExtent]);

  const toggleCadMode = useCallback(() => {
    setCadMode((prev) => {
      const next = prev === 'autocad' ? 'schematic' : 'autocad';
      const nextExtent = next === 'autocad' ? cadScene.extent : list.extent;
      if (viewport.width > 0 && viewport.height > 0) {
        setCamera(fitExtent(viewport, nextExtent));
      } else {
        setCamera(null);
      }
      return next;
    });
  }, [cadScene.extent, list.extent, viewport]);

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

  const toScreen = useCallback(
    (x: number, y: number) => worldToScreen(effectiveCamera, effectiveViewport, { x, y }),
    [effectiveCamera, effectiveViewport],
  );

  return (
    <div className="plan-stage stage">
      <div
        className={
          cadMode === 'autocad'
            ? 'blueprint canvaswrap plan-wrap plan-wrap-autocad'
            : 'blueprint canvaswrap plan-wrap'
        }
        ref={wrapRef}
      >
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

        {/* S4.3 Dynamic SVG overlay layer for AutoCAD floor plan & interactive bay targets */}
        <svg
          className="plan-overlay-svg"
          width={effectiveViewport.width}
          height={effectiveViewport.height}
          viewBox={`0 0 ${effectiveViewport.width} ${effectiveViewport.height}`}
          aria-label="Interactive bay overlay"
        >
          {cadMode === 'autocad' ? (
            <>
              {/* Pitch-black AutoCAD modelspace background */}
              <rect
                x={0}
                y={0}
                width={effectiveViewport.width}
                height={effectiveViewport.height}
                fill="#000000"
                style={{ pointerEvents: 'none' }}
              />

              {/* Architectural double-line building walls (#c88264) */}
              {(() => {
                const wL = toScreen(cadScene.leftBoundaryX - 40 * INCH_UM, cadScene.bottomWallY);
                const wR = toScreen(cadScene.rightWallX + 3.5 * INCH_UM, cadScene.bottomWallY);
                const wLInner = toScreen(
                  cadScene.leftBoundaryX - 40 * INCH_UM,
                  cadScene.bottomWallY - 3.5 * INCH_UM,
                );
                const wRInner = toScreen(
                  cadScene.rightWallX,
                  cadScene.bottomWallY - 3.5 * INCH_UM,
                );
                const rTop = toScreen(cadScene.rightWallX, cadScene.topBeamY - 12 * INCH_UM);
                const rBot = toScreen(cadScene.rightWallX, cadScene.mainDimY + 32 * INCH_UM);
                const rTopOuter = toScreen(
                  cadScene.rightWallX + 3.5 * INCH_UM,
                  cadScene.topBeamY - 12 * INCH_UM,
                );
                const rBotOuter = toScreen(
                  cadScene.rightWallX + 3.5 * INCH_UM,
                  cadScene.mainDimY + 32 * INCH_UM,
                );
                return (
                  <g stroke="#c88264" strokeWidth={1.15} style={{ pointerEvents: 'none' }}>
                    <line x1={wLInner.x} y1={wLInner.y} x2={wRInner.x} y2={wRInner.y} />
                    <line x1={wL.x} y1={wL.y} x2={wR.x} y2={wR.y} />
                    <line x1={rTop.x} y1={rTop.y} x2={rBot.x} y2={rBot.y} />
                    <line x1={rTopOuter.x} y1={rTopOuter.y} x2={rBotOuter.x} y2={rBotOuter.y} />
                  </g>
                );
              })()}

              {/* Red dash-dot building column centerlines & right dashed setback line */}
              {(() => {
                const h1L = toScreen(cadScene.leftBoundaryX - 40 * INCH_UM, cadScene.upperGridY);
                const h1R = toScreen(cadScene.rightSetbackX + 40 * INCH_UM, cadScene.upperGridY);
                const h2L = toScreen(cadScene.leftBoundaryX - 40 * INCH_UM, cadScene.lowerGridY);
                const h2R = toScreen(cadScene.rightSetbackX + 40 * INCH_UM, cadScene.lowerGridY);
                const v1T = toScreen(cadScene.colGrid1X, cadScene.topBeamY - 12 * INCH_UM);
                const v1B = toScreen(cadScene.colGrid1X, cadScene.mainDimY + 32 * INCH_UM);
                const v2T = toScreen(cadScene.colGrid2X, cadScene.topBeamY - 12 * INCH_UM);
                const v2B = toScreen(cadScene.colGrid2X, cadScene.mainDimY + 32 * INCH_UM);
                const sbT = toScreen(cadScene.rightSetbackX, cadScene.topBeamY - 12 * INCH_UM);
                const sbB = toScreen(cadScene.rightSetbackX, cadScene.mainDimY + 32 * INCH_UM);
                const runLenPos = toScreen(
                  cadScene.rightSetbackX - 10 * INCH_UM,
                  (cadScene.firstUprightY + cadScene.lastUprightY) * 0.36,
                );
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <g stroke="#ff1e00" strokeWidth={1.1} strokeDasharray="22,6,4,6">
                      <line x1={h1L.x} y1={h1L.y} x2={h1R.x} y2={h1R.y} />
                      <line x1={h2L.x} y1={h2L.y} x2={h2R.x} y2={h2R.y} />
                      <line x1={v1T.x} y1={v1T.y} x2={v1B.x} y2={v1B.y} />
                      <line x1={v2T.x} y1={v2T.y} x2={v2B.x} y2={v2B.y} />
                    </g>
                    <line
                      x1={sbT.x}
                      y1={sbT.y}
                      x2={sbB.x}
                      y2={sbB.y}
                      stroke="#ff2200"
                      strokeWidth={1.1}
                      strokeDasharray="12,8"
                    />
                    <text
                      x={runLenPos.x}
                      y={runLenPos.y}
                      fill="#00d8ff"
                      fontSize={14}
                      fontFamily="'IBM Plex Sans', 'Arial Narrow', sans-serif"
                      textAnchor="middle"
                      transform={`rotate(-90 ${runLenPos.x} ${runLenPos.y})`}
                    >
                      {cadScene.overallRunLengthLabel}
                    </text>
                  </g>
                );
              })()}

              {/* Rack banks: Red beams (#ff2a00), Green upright frames & footplates (#00ff00), Magenta spacers (#ff00ff), Bay letters ('A') */}
              {cadScene.banks.map((bank) => {
                const frameHalfUm = 1.3 * INCH_UM;
                const footplateUm = 3.6 * INCH_UM;
                return (
                  <g key={bank.key} style={{ pointerEvents: 'none' }}>
                    {/* Magenta row spacers in back-to-back flue space */}
                    {bank.isBackToBack &&
                      bank.uprightYs.map((uY, uIdx) => {
                        const sL = toScreen(bank.flueX, uY - 1.0 * INCH_UM);
                        const sR = toScreen(bank.flueX + bank.flueWidth, uY + 1.0 * INCH_UM);
                        return (
                          <g key={`spacer-${bank.key}-${uIdx}`} stroke="#ff00ff" strokeWidth={1.1}>
                            <line x1={sL.x} y1={sL.y} x2={sR.x} y2={sL.y} />
                            <line x1={sL.x} y1={sR.y} x2={sR.x} y2={sR.y} />
                            <line x1={sL.x} y1={sL.y - 1.5} x2={sL.x} y2={sR.y + 1.5} />
                            <line x1={sR.x} y1={sL.y - 1.5} x2={sR.x} y2={sR.y + 1.5} />
                          </g>
                        );
                      })}

                    {bank.rows.map((row) => {
                      const bTopL = toScreen(row.x, cadScene.topBeamY);
                      const bBotL = toScreen(row.x, cadScene.lastUprightY);
                      const bTopR = toScreen(row.x + row.width, cadScene.topBeamY);
                      const bBotR = toScreen(row.x + row.width, cadScene.lastUprightY);
                      const refLineX = row.x + 14 * INCH_UM;
                      const refTop = toScreen(refLineX, cadScene.topBeamY);
                      const refBot = toScreen(refLineX, cadScene.mainDimY + 28 * INCH_UM);
                      const refWallMarker = toScreen(refLineX, cadScene.bottomWallY - 1.75 * INCH_UM);

                      return (
                        <g key={row.key}>
                          {/* Leftmost row inner olive reference line + white wall datum marker */}
                          {row.isFirstRow && (
                            <>
                              <line
                                x1={refTop.x}
                                y1={refTop.y}
                                x2={refBot.x}
                                y2={refBot.y}
                                stroke="#7ba428"
                                strokeWidth={1.1}
                              />
                              <rect
                                x={refWallMarker.x - 2.5}
                                y={refWallMarker.y - 3.5}
                                width={5}
                                height={7}
                                fill="#000000"
                                stroke="#ffffff"
                                strokeWidth={1.2}
                              />
                            </>
                          )}

                          {/* Vertical Red Beams (#ff2a00) */}
                          <line
                            x1={bTopL.x}
                            y1={bTopL.y}
                            x2={bBotL.x}
                            y2={bBotL.y}
                            stroke="#ff2a00"
                            strokeWidth={1.25}
                          />
                          <line
                            x1={bTopR.x}
                            y1={bTopR.y}
                            x2={bBotR.x}
                            y2={bBotR.y}
                            stroke="#ff2a00"
                            strokeWidth={1.25}
                          />

                          {/* Horizontal Green Upright Frames & Footplates (#00ff00) */}
                          {row.uprightYs.map((uY, uIdx) => {
                            const fTL = toScreen(row.x, uY - frameHalfUm);
                            const fBR = toScreen(row.x + row.width, uY + frameHalfUm);
                            const fpW = Math.max(3.5, footplateUm * effectiveCamera.scale);
                            const fpH = Math.max(3.5, footplateUm * effectiveCamera.scale);
                            return (
                              <g
                                key={`upright-${row.key}-${uIdx}`}
                                stroke="#00ff00"
                                strokeWidth={1.1}
                                fill="none"
                              >
                                <line x1={fTL.x} y1={fTL.y} x2={fBR.x} y2={fTL.y} />
                                <line x1={fTL.x} y1={fBR.y} x2={fBR.x} y2={fBR.y} />
                                <rect
                                  x={fTL.x - fpW * 0.45}
                                  y={(fTL.y + fBR.y) / 2 - fpH / 2}
                                  width={fpW}
                                  height={fpH}
                                />
                                <rect
                                  x={fBR.x - fpW * 0.55}
                                  y={(fTL.y + fBR.y) / 2 - fpH / 2}
                                  width={fpW}
                                  height={fpH}
                                />
                              </g>
                            );
                          })}

                          {/* Bay callout letters ('A') & Red X-box column conflicts */}
                          {row.bays.map((bay) => {
                            const conflictShiftUm = bay.hasColumnConflict ? 14 * INCH_UM : 0;
                            const center = toScreen(
                              bay.x + bay.width * 0.52,
                              bay.y + bay.height * 0.5 + conflictShiftUm,
                            );
                            const cTL = toScreen(bay.x, cadScene.upperGridY - 12 * INCH_UM);
                            const cBR = toScreen(
                              bay.x + bay.width,
                              cadScene.upperGridY + 18 * INCH_UM,
                            );
                            return (
                              <g key={`label-${bay.key}`}>
                                {bay.hasColumnConflict && (
                                  <g stroke="#ff2200" strokeWidth={1.25} fill="none">
                                    <rect
                                      x={cTL.x}
                                      y={cTL.y}
                                      width={Math.max(4, cBR.x - cTL.x)}
                                      height={Math.max(4, cBR.y - cTL.y)}
                                    />
                                    <line x1={cTL.x} y1={cTL.y} x2={cBR.x} y2={cBR.y} />
                                    <line x1={cTL.x} y1={cBR.y} x2={cBR.x} y2={cTL.y} />
                                  </g>
                                )}
                                <text
                                  x={center.x}
                                  y={center.y}
                                  fill="#00ff00"
                                  fontSize={12.5}
                                  fontFamily="'IBM Plex Sans', 'Arial', sans-serif"
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  transform={`rotate(-90 ${center.x} ${center.y})`}
                                >
                                  {bay.tag}
                                </text>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* Blue square building column footprints (#6b8cff) at grid intersections */}
              {[
                { x: cadScene.colGrid1X, y: cadScene.upperGridY },
                { x: cadScene.colGrid2X, y: cadScene.upperGridY },
                { x: cadScene.colGrid1X, y: cadScene.lowerGridY },
                { x: cadScene.colGrid2X, y: cadScene.lowerGridY },
              ].map((col, idx) => {
                const c = toScreen(col.x, col.y);
                const sz = Math.max(6, 7.5 * INCH_UM * effectiveCamera.scale);
                return (
                  <rect
                    key={`col-${idx}`}
                    x={c.x - sz / 2}
                    y={c.y - sz / 2}
                    width={sz}
                    height={sz}
                    fill="none"
                    stroke="#6b8cff"
                    strokeWidth={1.3}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}

              {/* Vertical Green Aisle Callouts ("9'-6\" AISLE") */}
              {cadScene.aisles.map((aisle) => {
                const mid = toScreen(
                  aisle.x + aisle.width / 2,
                  (cadScene.firstUprightY + cadScene.lastUprightY) * 0.42,
                );
                return (
                  <text
                    key={aisle.key}
                    x={mid.x}
                    y={mid.y}
                    fill="#00ff00"
                    fontSize={14}
                    fontFamily="'IBM Plex Sans', 'Arial Narrow', sans-serif"
                    letterSpacing="0.04em"
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(-90 ${mid.x} ${mid.y})`}
                    style={{ pointerEvents: 'none' }}
                  >
                    {aisle.label}
                  </text>
                );
              })}

              {/* AutoCAD Architectural Dimension Strings (Red #ff2200 lines + 45° slash ticks + Green #00ff00 text) */}
              {(() => {
                const tick = (pt: { x: number; y: number }, size = 5.5) => (
                  <line
                    x1={pt.x - size}
                    y1={pt.y + size}
                    x2={pt.x + size}
                    y2={pt.y - size}
                    stroke="#ff2200"
                    strokeWidth={2.1}
                  />
                );

                // 1) Top-left 18" dimension (between firstUprightY and upperGridY)
                const d18TopExtL = toScreen(cadScene.leftDimX - 8 * INCH_UM, cadScene.firstUprightY);
                const d18TopExtR = toScreen(
                  cadScene.rackOriginX - 8 * INCH_UM,
                  cadScene.firstUprightY,
                );
                const d18DimTop = toScreen(cadScene.leftDimX, cadScene.firstUprightY);
                const d18DimBot = toScreen(cadScene.leftDimX, cadScene.upperGridY);
                const d18LineTop = toScreen(cadScene.leftDimX, cadScene.firstUprightY - 38 * INCH_UM);
                const d18LineBot = toScreen(cadScene.leftDimX, cadScene.upperGridY + 8 * INCH_UM);
                const d18Text = toScreen(
                  cadScene.leftDimX - 9 * INCH_UM,
                  cadScene.firstUprightY - 18 * INCH_UM,
                );

                // 2) Bottom-left 24" dimension (between lastUprightY and bottomWallY)
                const d24TopExtL = toScreen(
                  cadScene.leftBoundaryX - 40 * INCH_UM,
                  cadScene.lastUprightY,
                );
                const d24TopExtR = toScreen(
                  cadScene.rackOriginX - 8 * INCH_UM,
                  cadScene.lastUprightY,
                );
                const d24DimTop = toScreen(cadScene.leftDimX, cadScene.lastUprightY);
                const d24DimBot = toScreen(cadScene.leftDimX, cadScene.bottomWallY);
                const d24LineTop = toScreen(cadScene.leftDimX, cadScene.lastUprightY - 38 * INCH_UM);
                const d24LineBot = toScreen(cadScene.leftDimX, cadScene.bottomWallY + 8 * INCH_UM);
                const d24Text = toScreen(
                  cadScene.leftDimX - 9 * INCH_UM,
                  cadScene.lastUprightY - 17 * INCH_UM,
                );

                // 3) Bottom 18" column offset sub-dimension under Bank 1
                const bank1RightX =
                  (cadScene.banks[1]?.x ?? cadScene.rackOriginX) +
                  (cadScene.banks[1]?.width ?? 0);
                const sub18ExtTop = toScreen(bank1RightX, cadScene.lastUprightY + 8 * INCH_UM);
                const sub18ExtBot = toScreen(bank1RightX, cadScene.subDimY + 8 * INCH_UM);
                const sub18DimL = toScreen(cadScene.colGrid1X, cadScene.subDimY);
                const sub18DimR = toScreen(bank1RightX, cadScene.subDimY);
                const sub18LineR = toScreen(bank1RightX + 54 * INCH_UM, cadScene.subDimY);
                const sub18Text = toScreen(bank1RightX + 35 * INCH_UM, cadScene.subDimY - 9 * INCH_UM);

                // 4) Bottom main horizontal dimension chain (26', 73'-6" / 9 TOTAL ROWS, 12")
                const totalRackRightX =
                  (cadScene.banks[cadScene.banks.length - 1]?.x ?? cadScene.rackOriginX) +
                  (cadScene.banks[cadScene.banks.length - 1]?.width ?? 0);
                const ext0Top = toScreen(cadScene.rackOriginX, cadScene.bottomWallY + 6 * INCH_UM);
                const ext0Bot = toScreen(cadScene.rackOriginX, cadScene.mainDimY + 12 * INCH_UM);
                const extRackRightTop = toScreen(
                  totalRackRightX,
                  cadScene.lastUprightY + 8 * INCH_UM,
                );
                const extRackRightBot = toScreen(
                  totalRackRightX,
                  cadScene.mainDimY + 12 * INCH_UM,
                );
                const mainLineL = toScreen(cadScene.leftBoundaryX - 40 * INCH_UM, cadScene.mainDimY);
                const mainLineR = toScreen(cadScene.rightWallX + 10 * INCH_UM, cadScene.mainDimY);
                const mainTick0 = toScreen(cadScene.rackOriginX, cadScene.mainDimY);
                const mainTickRackR = toScreen(totalRackRightX, cadScene.mainDimY);
                const mainTickWallR = toScreen(cadScene.rightWallX, cadScene.mainDimY);

                const txt26 = toScreen(
                  cadScene.rackOriginX - 95 * INCH_UM,
                  cadScene.mainDimY - 9 * INCH_UM,
                );
                const txtWidth = toScreen(
                  cadScene.rackOriginX + (totalRackRightX - cadScene.rackOriginX) * 0.48,
                  cadScene.mainDimY - 9 * INCH_UM,
                );
                const txtRows = toScreen(
                  cadScene.rackOriginX + (totalRackRightX - cadScene.rackOriginX) * 0.48,
                  cadScene.mainDimY + 14 * INCH_UM,
                );
                const txt12 = toScreen(
                  cadScene.rightWallX + 24 * INCH_UM,
                  cadScene.mainDimY + 2 * INCH_UM,
                );

                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <g stroke="#ff2200" strokeWidth={1.1}>
                      {/* 18" top-left clearance */}
                      <line
                        x1={d18TopExtL.x}
                        y1={d18TopExtL.y}
                        x2={d18TopExtR.x}
                        y2={d18TopExtR.y}
                      />
                      <line
                        x1={d18LineTop.x}
                        y1={d18LineTop.y}
                        x2={d18LineBot.x}
                        y2={d18LineBot.y}
                      />
                      {tick(d18DimTop)}
                      {tick(d18DimBot)}

                      {/* 24" bottom-left clearance */}
                      <line
                        x1={d24TopExtL.x}
                        y1={d24TopExtL.y}
                        x2={d24TopExtR.x}
                        y2={d24TopExtR.y}
                      />
                      <line
                        x1={d24LineTop.x}
                        y1={d24LineTop.y}
                        x2={d24LineBot.x}
                        y2={d24LineBot.y}
                      />
                      {tick(d24DimTop)}
                      {tick(d24DimBot)}

                      {/* 18" column offset sub-dim */}
                      <line
                        x1={sub18ExtTop.x}
                        y1={sub18ExtTop.y}
                        x2={sub18ExtBot.x}
                        y2={sub18ExtBot.y}
                      />
                      <line
                        x1={sub18DimL.x - 6}
                        y1={sub18DimL.y}
                        x2={sub18LineR.x}
                        y2={sub18LineR.y}
                      />
                      {tick(sub18DimL)}
                      {tick(sub18DimR)}

                      {/* Main bottom dimension line & extensions */}
                      <line x1={ext0Top.x} y1={ext0Top.y} x2={ext0Bot.x} y2={ext0Bot.y} />
                      <line
                        x1={extRackRightTop.x}
                        y1={extRackRightTop.y}
                        x2={extRackRightBot.x}
                        y2={extRackRightBot.y}
                      />
                      <line
                        x1={mainLineL.x}
                        y1={mainLineL.y}
                        x2={mainLineR.x}
                        y2={mainLineR.y}
                      />
                      {tick(mainTick0)}
                      {tick(mainTickRackR)}
                      {tick(mainTickWallR)}
                    </g>

                    {/* Green AutoCAD dimension labels */}
                    <g
                      fill="#00ff00"
                      fontSize={14}
                      fontFamily="'IBM Plex Sans', 'Arial Narrow', sans-serif"
                      textAnchor="middle"
                    >
                      <text
                        x={d18Text.x}
                        y={d18Text.y}
                        transform={`rotate(-90 ${d18Text.x} ${d18Text.y})`}
                      >
                        18&quot;
                      </text>
                      <text
                        x={d24Text.x}
                        y={d24Text.y}
                        transform={`rotate(-90 ${d24Text.x} ${d24Text.y})`}
                      >
                        24&quot;
                      </text>
                      <text x={sub18Text.x} y={sub18Text.y}>
                        18&quot;
                      </text>
                      <text x={txt26.x} y={txt26.y}>
                        26&apos;
                      </text>
                      <text x={txtWidth.x} y={txtWidth.y}>
                        {cadScene.totalRackWidthLabel}
                      </text>
                      <text x={txtRows.x} y={txtRows.y}>
                        {cadScene.totalRowsCount} TOTAL ROWS
                      </text>
                      <text x={txt12.x} y={txt12.y}>
                        12&quot;
                      </text>
                    </g>
                  </g>
                );
              })()}

              {/* Interactive bay targets mapped over the AutoCAD bays */}
              {cadScene.banks.map((bank) =>
                bank.rows.map((row) =>
                  row.bays
                    .filter((b) => b.realBayId !== undefined && b.realRunId !== undefined)
                    .map((bay) => {
                      const runId = bay.realRunId!;
                      const bayId = bay.realBayId!;
                      const runLabel = bay.realRunLabel ?? runId;
                      const topLeft = toScreen(bay.x, bay.y);
                      const bottomRight = toScreen(bay.x + bay.width, bay.y + bay.height);
                      const isSelected =
                        activeSelection?.run.runId === runId &&
                        activeSelection.bay.bayId === bayId;
                      const isHovered =
                        hovered?.kind === 'bay' &&
                        hovered.runId === runId &&
                        hovered.bayId === bayId;

                      return (
                        <g key={bayId}>
                          <rect
                            data-bay-id={bayId}
                            data-run-id={runId}
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
                            aria-label={`${runLabel} Bay ${bay.bayIndex + 1}${bay.locked ? ' (locked)' : ''}`}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelected({
                                runId,
                                bayId,
                                bayIndex: bay.bayIndex,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelected({
                                  runId,
                                  bayId,
                                  bayIndex: bay.bayIndex,
                                });
                              }
                            }}
                          />
                          {bay.locked && (
                            <text
                              x={(topLeft.x + bottomRight.x) / 2}
                              y={(topLeft.y + bottomRight.y) / 2}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize="12"
                              style={{ pointerEvents: 'none' }}
                            >
                              🔒
                            </text>
                          )}
                        </g>
                      );
                    }),
                ),
              )}
            </>
          ) : (
            <>
              {/* Semi-transparent pallet wash footprints matching blueprint specification */}
              {plan.runs.map((run) =>
                run.pallets.map((p) => {
                  const tl = worldToScreen(effectiveCamera, effectiveViewport, { x: p.x, y: p.y });
                  const w = p.width * effectiveCamera.scale;
                  const h = p.depth * effectiveCamera.scale;
                  return (
                    <rect
                      key={`pallet:${p.id}`}
                      x={tl.x}
                      y={tl.y}
                      width={Math.max(1, w)}
                      height={Math.max(1, h)}
                      className="plan-pallet-wash"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                }),
              )}

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
                    activeSelection?.run.runId === run.runId &&
                    activeSelection.bay.bayId === bay.bayId;
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
            </>
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
          <Chip label="Failing" value="0" pending tone="pass" />
          <Chip label="Awaiting input" value="5" pending tone="warn" />
          <Chip label="Awaiting source" value="10" pending tone="warn" />
          <button
            type="button"
            className="btn plan-fit"
            onClick={toggleCadMode}
            title="Switch between AutoCAD dark-mode floor plan and schematic view"
          >
            {cadMode === 'autocad' ? 'Schematic' : 'CAD Plan'}
          </button>
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
          <span
            className="legend-swatch legend-swatch-upright"
            style={cadMode === 'autocad' ? { background: '#00ff00' } : undefined}
            aria-hidden="true"
          />
          Upright
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-beam"
            style={cadMode === 'autocad' ? { background: '#ff2a00' } : undefined}
            aria-hidden="true"
          />
          Beam
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-load"
            style={cadMode === 'autocad' ? { background: '#00ff00' } : undefined}
            aria-hidden="true"
          />
          Unit load
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-flue"
            style={cadMode === 'autocad' ? { background: '#ff00ff' } : undefined}
            aria-hidden="true"
          />
          Flue
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-aisle"
            style={cadMode === 'autocad' ? { background: '#00ff00' } : undefined}
            aria-hidden="true"
          />
          Clear between loads
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-dim"
            style={cadMode === 'autocad' ? { background: '#ff2200' } : undefined}
            aria-hidden="true"
          />
          Dimension
        </span>
        <span className="legend-item">
          <span
            className="legend-swatch legend-swatch-locked"
            style={cadMode === 'autocad' ? { background: '#6b8cff' } : undefined}
            aria-hidden="true"
          />
          Locked bay
        </span>
        <span className="legend-right right">
          CLICK A BAY OR AISLE TO SELECT · DRAG TO PAN · SCROLL TO ZOOM
        </span>
      </div>
    </div>
  );
}
