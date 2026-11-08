import {
  EMPTY_LEDGER,
  IN,
  canRedo,
  canUndo,
  countFindings,
  dispatch,
  migrate,
  mintId,
  planGeometry,
  redo,
  screeningFindingsForDocument,
  undo,
  type Bay,
  type Command,
  type FindingCounts,
  type PlanGeometry,
  type Run,
  type ScreeningFindingRow,
  type Session,
  type SessionResult,
  type StudioDocument,
} from '@rms/studio-model';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import fixture from '../../../fixtures/continuity/rack-studio-v1.json';

export interface StateStorage {
  readonly getItem: (name: string) => Promise<string | null>;
  readonly setItem: (name: string, value: string) => Promise<void>;
  readonly removeItem: (name: string) => Promise<void>;
}

const IDB_DB_NAME = 'rack-master-studio-db';
const IDB_STORE_NAME = 'keyval';
export const IDB_WORKSPACE_KEY = 'rack-master-studio-storage';
const idbFallbackMap = new Map<string, string>();

function openStudioIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await openStudioIdb();
    if (db === null) {
      return idbFallbackMap.get(name) ?? null;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(name);
        req.onsuccess = () => {
          const res = typeof req.result === 'string' ? req.result : null;
          resolve(res ?? idbFallbackMap.get(name) ?? null);
        };
        req.onerror = () => resolve(idbFallbackMap.get(name) ?? null);
      } catch {
        resolve(idbFallbackMap.get(name) ?? null);
      }
    });
  },
  setItem: async (name: string, value: string): Promise<void> => {
    idbFallbackMap.set(name, value);
    const db = await openStudioIdb();
    if (db === null) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put(value, name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
  removeItem: async (name: string): Promise<void> => {
    idbFallbackMap.delete(name);
    const db = await openStudioIdb();
    if (db === null) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },
};

export interface RackLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly xIn: number;
  readonly yIn: number;
  readonly widthIn: number;
  readonly depthIn: number;
}

export type BaySide = 'top' | 'bottom';
export type BayTargetScope = 'top' | 'bottom' | 'both';

export interface BaySideConfig {
  readonly beamLevels: readonly number[]; // in inches, e.g. [60, 120, 180]
  readonly loadWeightLb: number;
  readonly isSingle: boolean;
}

export interface DoubleBay {
  readonly id: string; // `${runId}:${bayId}`
  readonly runId: string;
  readonly bayId: string;
  readonly x: number;
  readonly width: number;
  readonly topSide: BaySideConfig;
  readonly bottomSide: BaySideConfig;
}

export interface GridLine {
  readonly id: string; // 'A', 'B', 'C' or '1', '2', '3'
  readonly offset: number; // absolute inches from origin (0,0)
}

export interface GridColumnItem {
  readonly id: string;
  readonly x: number; // inches
  readonly y: number; // inches
}

export interface ColumnGridState {
  readonly gridX: readonly GridLine[];
  readonly gridY: readonly GridLine[];
  readonly columns: readonly GridColumnItem[];
  readonly setGrid: (x: readonly GridLine[], y: readonly GridLine[]) => void;
  readonly addGridLineX: (id: string, offsetIn: number) => void;
  readonly addGridLineY: (id: string, offsetIn: number) => void;
  readonly placeColumn: (x: number, y: number, id?: string) => GridColumnItem;
  readonly importColumns: (csvString: string) => readonly GridColumnItem[];
}

const gridStoreListeners = new Set<() => void>();
let activeGridColumnSyncSink: ((cols: readonly GridColumnItem[]) => void) | null = null;

export function registerGridColumnSyncSink(
  sink: ((cols: readonly GridColumnItem[]) => void) | null,
): void {
  activeGridColumnSyncSink = sink;
}

let gridStoreState: ColumnGridState = {
  gridX: [
    { id: 'A', offset: 0 },
    { id: 'B', offset: 600 },
    { id: 'C', offset: 1200 },
  ],
  gridY: [
    { id: '1', offset: 0 },
    { id: '2', offset: 600 },
  ],
  columns: [],
  setGrid: (gridX, gridY): void => {
    gridStoreState = {
      ...gridStoreState,
      gridX: [...gridX],
      gridY: [...gridY],
    };
    gridStoreListeners.forEach((l) => l());
  },
  addGridLineX: (id, offsetIn): void => {
    if (!Number.isFinite(offsetIn) || offsetIn < 0) return;
    const filtered = gridStoreState.gridX.filter((g) => g.id !== id);
    const nextX = [...filtered, { id, offset: Math.round(offsetIn) }].sort(
      (a, b) => a.offset - b.offset,
    );
    gridStoreState = { ...gridStoreState, gridX: nextX };
    gridStoreListeners.forEach((l) => l());
  },
  addGridLineY: (id, offsetIn): void => {
    if (!Number.isFinite(offsetIn) || offsetIn < 0) return;
    const filtered = gridStoreState.gridY.filter((g) => g.id !== id);
    const nextY = [...filtered, { id, offset: Math.round(offsetIn) }].sort(
      (a, b) => a.offset - b.offset,
    );
    gridStoreState = { ...gridStoreState, gridY: nextY };
    gridStoreListeners.forEach((l) => l());
  },
  placeColumn: (x, y, id): GridColumnItem => {
    const colId = id ?? `COL-${gridStoreState.columns.length + 1}`;
    const item: GridColumnItem = {
      id: colId,
      x: Math.round(x),
      y: Math.round(y),
    };
    const nextCols = [...gridStoreState.columns, item];
    gridStoreState = {
      ...gridStoreState,
      columns: nextCols,
    };
    activeGridColumnSyncSink?.(nextCols);
    gridStoreListeners.forEach((l) => l());
    return item;
  },
  importColumns: (csvString): readonly GridColumnItem[] => {
    const rows = csvString
      .trim()
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const parsed: GridColumnItem[] = [];
    rows.forEach((row, idx) => {
      const parts = row.split(',').map((p) => p.trim());
      if (parts.length >= 3) {
        const xVal = Number(parts[1]);
        const yVal = Number(parts[2]);
        if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
          parsed.push({
            id: parts[0] && parts[0].length > 0 ? parts[0] : `COL-${idx + 1}`,
            x: xVal,
            y: yVal,
          });
        }
      } else if (parts.length === 2) {
        const xVal = Number(parts[0]);
        const yVal = Number(parts[1]);
        if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
          parsed.push({
            id: `COL-${idx + 1}`,
            x: xVal,
            y: yVal,
          });
        }
      }
    });
    gridStoreState = {
      ...gridStoreState,
      columns: parsed,
    };
    activeGridColumnSyncSink?.(parsed);
    gridStoreListeners.forEach((l) => l());
    return parsed;
  },
};

function subscribeGridStore(listener: () => void): () => void {
  gridStoreListeners.add(listener);
  return () => {
    gridStoreListeners.delete(listener);
  };
}

function getGridStoreSnapshot(): ColumnGridState {
  return gridStoreState;
}

export function useGridStore<T>(selector: (state: ColumnGridState) => T): T {
  const state = useSyncExternalStore(
    subscribeGridStore,
    getGridStoreSnapshot,
    getGridStoreSnapshot,
  );
  return selector(state);
}

useGridStore.getState = (): ColumnGridState => gridStoreState;

export interface RackState {
  readonly beamClearSpan: number;
  readonly frameToFrameAisle: number;
  readonly truckMinAisle: number;
  readonly palletPositions: number;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly zoom: number;
  readonly warehouseWidth: number;
  readonly warehouseLength: number;
  readonly layoutNodes: readonly RackLayoutNode[];
  readonly doubleBays: Readonly<Record<string, DoubleBay>>;
  readonly lastAutoSavedAt: string | null;
  readonly setBeamClearSpan: (span: number) => void;
  readonly setFrameToFrameAisle: (aisle: number) => void;
  readonly setTruckMinAisle: (minAisle: number) => void;
  readonly updateCalculations: (positions: number) => void;
  readonly setBaySideConfig: (
    runId: string,
    bayId: string,
    scope: BayTargetScope,
    patch: Partial<BaySideConfig>,
  ) => void;
  readonly setViewportCamera: (cam: {
    readonly cameraX: number;
    readonly cameraY: number;
    readonly zoom: number;
    readonly warehouseWidth: number;
    readonly warehouseLength: number;
  }) => void;
}

type RackStoreListener = () => void;

const rackStoreListeners = new Set<RackStoreListener>();
let activeRackCommandSink: ((cmd: Command) => void) | null = null;
let activeRackFirstRunId: string | null = 'run-1';
let activeRackAllRunIds: readonly string[] = ['run-1', 'run-2', 'run-3'];
let activeRackBayTypeId: string | null = 'bt-1';

const DEFAULT_SIDE_CONFIG: BaySideConfig = {
  beamLevels: [60, 120, 180],
  loadWeightLb: 2000,
  isSingle: false,
};

let rackStoreState: RackState = {
  beamClearSpan: 96,
  frameToFrameAisle: 132,
  truckMinAisle: 66.3,
  palletPositions: 576,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  warehouseWidth: 1320,
  warehouseLength: 720,
  layoutNodes: [],
  doubleBays: {},
  lastAutoSavedAt: null,
  setBeamClearSpan: (span: number): void => {
    if (!Number.isFinite(span) || span <= 0) return;
    updateRackStoreSlice({ beamClearSpan: span });
    if (activeRackCommandSink !== null && activeRackBayTypeId !== null) {
      activeRackCommandSink({
        type: 'setField',
        label: `Set beam clear span to ${span}"`,
        change: {
          section: 'bayType',
          bayTypeId: activeRackBayTypeId,
          patch: { beamLength: Math.round(span * 25_400) },
        },
      });
    }
  },
  setFrameToFrameAisle: (aisle: number): void => {
    if (!Number.isFinite(aisle) || aisle <= 0) return;
    updateRackStoreSlice({ frameToFrameAisle: aisle });
    if (activeRackCommandSink !== null) {
      const targetRuns =
        activeRackAllRunIds.length > 0
          ? activeRackAllRunIds
          : activeRackFirstRunId !== null
            ? [activeRackFirstRunId]
            : [];
      const cmds: Command[] = targetRuns.map((runId) => ({
        type: 'setAisleAfter',
        runId,
        frameToFrame: Math.round(aisle * 25_400),
      }));
      if (cmds.length === 1 && cmds[0] !== undefined) {
        activeRackCommandSink(cmds[0]);
      } else if (cmds.length > 1) {
        activeRackCommandSink({
          type: 'batch',
          label: `Set frame-to-frame aisles to ${aisle}"`,
          commands: cmds,
        });
      }
    }
  },
  setTruckMinAisle: (minAisle: number): void => {
    if (!Number.isFinite(minAisle) || minAisle <= 0) return;
    updateRackStoreSlice({ truckMinAisle: minAisle });
    if (activeRackCommandSink !== null) {
      activeRackCommandSink({
        type: 'setField',
        label: `Set truck min aisle to ${minAisle}"`,
        change: {
          section: 'equipment',
          patch: {
            truckRAS: {
              value: Math.round(minAisle * 25_400),
              established: 'INPUT',
              source: 'Granular rack store update',
            },
          },
        },
      });
    }
  },
  updateCalculations: (positions: number): void => {
    if (!Number.isFinite(positions) || positions < 0) return;
    updateRackStoreSlice({ palletPositions: positions });
  },
  setBaySideConfig: (runId, bayId, scope, patch): void => {
    const key = `${runId}:${bayId}`;
    const existing: DoubleBay = rackStoreState.doubleBays[key] ?? {
      id: key,
      runId,
      bayId,
      x: 0,
      width: rackStoreState.beamClearSpan,
      topSide: { ...DEFAULT_SIDE_CONFIG },
      bottomSide: { ...DEFAULT_SIDE_CONFIG },
    };
    const nextTop =
      scope === 'top' || scope === 'both'
        ? { ...existing.topSide, ...patch }
        : existing.topSide;
    const nextBottom =
      scope === 'bottom' || scope === 'both'
        ? { ...existing.bottomSide, ...patch }
        : existing.bottomSide;

    const updated: DoubleBay = {
      ...existing,
      topSide: nextTop,
      bottomSide: nextBottom,
    };
    updateRackStoreSlice({
      doubleBays: {
        ...rackStoreState.doubleBays,
        [key]: updated,
      },
    });
  },
  setViewportCamera: (cam): void => {
    updateRackStoreSlice(cam);
  },
};

function updateRackStoreSlice(
  patch: Partial<
    Pick<
      RackState,
      | 'beamClearSpan'
      | 'frameToFrameAisle'
      | 'truckMinAisle'
      | 'palletPositions'
      | 'cameraX'
      | 'cameraY'
      | 'zoom'
      | 'warehouseWidth'
      | 'warehouseLength'
      | 'layoutNodes'
      | 'doubleBays'
      | 'lastAutoSavedAt'
    >
  >,
): void {
  const nextBeam = patch.beamClearSpan ?? rackStoreState.beamClearSpan;
  const nextAisle = patch.frameToFrameAisle ?? rackStoreState.frameToFrameAisle;
  const nextTruck = patch.truckMinAisle ?? rackStoreState.truckMinAisle;
  const nextPos = patch.palletPositions ?? rackStoreState.palletPositions;
  const nextCamX = patch.cameraX ?? rackStoreState.cameraX;
  const nextCamY = patch.cameraY ?? rackStoreState.cameraY;
  const nextZoom = patch.zoom ?? rackStoreState.zoom;
  const nextW = patch.warehouseWidth ?? rackStoreState.warehouseWidth;
  const nextL = patch.warehouseLength ?? rackStoreState.warehouseLength;
  const nextNodes = patch.layoutNodes ?? rackStoreState.layoutNodes;
  const nextDoubleBays = patch.doubleBays ?? rackStoreState.doubleBays;
  const nextSaved =
    patch.lastAutoSavedAt !== undefined ? patch.lastAutoSavedAt : rackStoreState.lastAutoSavedAt;
  if (
    nextBeam === rackStoreState.beamClearSpan &&
    nextAisle === rackStoreState.frameToFrameAisle &&
    nextTruck === rackStoreState.truckMinAisle &&
    nextPos === rackStoreState.palletPositions &&
    nextCamX === rackStoreState.cameraX &&
    nextCamY === rackStoreState.cameraY &&
    nextZoom === rackStoreState.zoom &&
    nextW === rackStoreState.warehouseWidth &&
    nextL === rackStoreState.warehouseLength &&
    nextNodes === rackStoreState.layoutNodes &&
    nextDoubleBays === rackStoreState.doubleBays &&
    nextSaved === rackStoreState.lastAutoSavedAt
  ) {
    return;
  }
  rackStoreState = {
    ...rackStoreState,
    beamClearSpan: nextBeam,
    frameToFrameAisle: nextAisle,
    truckMinAisle: nextTruck,
    palletPositions: nextPos,
    cameraX: nextCamX,
    cameraY: nextCamY,
    zoom: nextZoom,
    warehouseWidth: nextW,
    warehouseLength: nextL,
    layoutNodes: nextNodes,
    doubleBays: nextDoubleBays,
    lastAutoSavedAt: nextSaved,
  };
  rackStoreListeners.forEach((listener) => listener());
}

export async function persistWorkspaceToIndexedDb(doc?: StudioDocument): Promise<string> {
  const savedAt = new Date().toISOString();
  const payload = JSON.stringify({
    savedAt,
    state: {
      beamClearSpan: rackStoreState.beamClearSpan,
      frameToFrameAisle: rackStoreState.frameToFrameAisle,
      truckMinAisle: rackStoreState.truckMinAisle,
      palletPositions: rackStoreState.palletPositions,
      layoutNodes: rackStoreState.layoutNodes,
      ...(doc !== undefined ? { document: doc } : {}),
    },
  });
  await idbStorage.setItem(IDB_WORKSPACE_KEY, payload);
  updateRackStoreSlice({ lastAutoSavedAt: savedAt });
  return savedAt;
}

function subscribeRackStore(listener: RackStoreListener): () => void {
  rackStoreListeners.add(listener);
  return () => {
    rackStoreListeners.delete(listener);
  };
}

function getRackStoreSnapshot(): RackState {
  return rackStoreState;
}

export function useRackStore<T>(selector: (state: RackState) => T): T {
  const state = useSyncExternalStore(subscribeRackStore, getRackStoreSnapshot, getRackStoreSnapshot);
  return selector(state);
}

useRackStore.getState = (): RackState => rackStoreState;
useRackStore.setState = updateRackStoreSlice;

export interface PlanWallOverlay {
  readonly id: string;
  readonly x1Um: number;
  readonly y1Um: number;
  readonly x2Um: number;
  readonly y2Um: number;
}

export interface PlanColumnOverlay {
  readonly id: string;
  readonly xUm: number;
  readonly yUm: number;
  readonly sizeIn: number;
  readonly label: string;
}

export interface ShellOverlayState {
  readonly showPerimeterWalls: boolean;
  readonly showColumns: boolean;
  readonly columnSpacingFt: 30 | 40 | 50;
  readonly columnSizeIn: number;
  readonly shellWidthFt: number;
  readonly shellDepthFt: number;
  readonly underlayDataUrl: string | null;
  readonly underlayOpacity: number;
  readonly customWalls: readonly PlanWallOverlay[];
  readonly customColumns: readonly PlanColumnOverlay[];
  readonly calibratedScaleInPerPx: number | null;
}

export interface SavedPlanSnapshot {
  readonly id: string;
  readonly label: string;
  readonly runsCount: number;
  readonly baysCount: number;
  readonly positionsCount: number;
  readonly narrowestAisleIn: number | null;
  readonly document: StudioDocument;
  readonly counter: Session['counter'];
  readonly shellOverlay: ShellOverlayState;
}

export interface StarterSpaceInput {
  readonly projectName?: string;
  readonly clientName?: string;
  readonly lengthFt: number;
  readonly widthFt: number;
  readonly clearHeightFt: number;
  readonly aisleFt: number;
  readonly targetPositions: number;
  readonly showColumns: boolean;
  readonly columnSpacingFt: 30 | 40 | 50;
}

export interface LocationData {
  readonly zipCode: string;
  readonly city: string;
  readonly state: string;
  readonly seismicCategory: 'Standard SDC D' | 'Complex / High Seismic' | 'Not Needed';
  readonly sdcCode: 'C' | 'D' | 'E';
  readonly taxRate: number;
  readonly freightMultiplier: number;
}

export async function analyzeZipCode(zipCode: string): Promise<LocationData | null> {
  const clean = zipCode.trim();
  if (clean.length < 5) return null;

  const isCalifornia = clean.startsWith('9');
  const isHighSeismicCA = ['90', '91', '92', '93', '94'].some((prefix) => clean.startsWith(prefix));

  return {
    zipCode: clean.slice(0, 5),
    city: isCalifornia ? 'California Region' : 'Out of State',
    state: isCalifornia ? 'CA' : 'US',
    seismicCategory: isHighSeismicCA ? 'Complex / High Seismic' : 'Standard SDC D',
    sdcCode: isHighSeismicCA ? 'E' : 'D',
    taxRate: isCalifornia ? 10.25 : 6.5,
    freightMultiplier: isCalifornia ? 0.04 : 0.08,
  };
}

export function buildDocumentDxfString(doc: StudioDocument): string {
  let dxfString = '0\nSECTION\n2\nENTITIES\n';

  const drawRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    layer: string,
    color: number,
  ): void => {
    const lines = [
      { x1: x, y1: y, x2: x + w, y2: y },
      { x1: x + w, y1: y, x2: x + w, y2: y + h },
      { x1: x + w, y1: y + h, x2: x, y2: y + h },
      { x1: x, y1: y + h, x2: x, y2: y },
    ];
    lines.forEach((l) => {
      dxfString += `0\nLINE\n8\n${layer}\n62\n${color}\n10\n${l.x1}\n20\n${l.y1}\n11\n${l.x2}\n21\n${l.y2}\n`;
    });
  };

  const bt = doc.bayTypes[0];
  const frameDepthIn = bt !== undefined ? Math.round(bt.frameDepth / 25_400) : 42;
  const beamLengthIn = bt !== undefined ? Math.round(bt.beamLength / 25_400) : 96;
  const uprightWidthIn = bt !== undefined ? Math.round(bt.uprightWidth / 25_400) : 3;

  let currentY = 0;

  doc.runs.forEach((run, rIdx) => {
    const flueWidthIn = Math.max(6, Math.round(run.rowSpacer / 25_400));
    const runDepth = run.backToBack ? frameDepthIn * 2 + flueWidthIn : frameDepthIn;
    let currentX = 0;

    run.bays.forEach(() => {
      // Draw 3" Upright Frame (Color 3 = Green)
      drawRect(currentX, currentY, uprightWidthIn, runDepth, 'UPRIGHTS', 3);

      // Draw Bay Footprint (Color 1 = Red)
      drawRect(currentX + uprightWidthIn, currentY, beamLengthIn, frameDepthIn, 'BAYS', 1);
      if (run.backToBack) {
        drawRect(
          currentX + uprightWidthIn,
          currentY + frameDepthIn + flueWidthIn,
          beamLengthIn,
          frameDepthIn,
          'BAYS',
          1,
        );
      }

      currentX += uprightWidthIn + beamLengthIn;
    });

    // Final Upright Frame
    drawRect(currentX, currentY, uprightWidthIn, runDepth, 'UPRIGHTS', 3);

    const nextRun = doc.runs[rIdx + 1];
    const aisleWidthAfterIn =
      nextRun !== undefined
        ? Math.max(36, Math.round((nextRun.y - run.y) / 25_400) - runDepth)
        : 120;
    currentY += runDepth + aisleWidthAfterIn;
  });

  dxfString += '0\nENDSEC\n0\nEOF\n';
  return dxfString;
}

export function exportDocumentToDXF(doc: StudioDocument): string {
  const dxfString = buildDocumentDxfString(doc);
  try {
    if (typeof window !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([dxfString], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `Takeoff_${doc.revision}_Layout.dxf`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL?.(url);
    }
  } catch {
    // Headless test environment fallback
  }
  return dxfString;
}

export async function uploadSitePhoto(file: File, projectId: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      try {
        const key = `rackstudio_site_photos_${projectId}`;
        const existingRaw = window.localStorage?.getItem(key);
        const existing: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
        window.localStorage?.setItem(key, JSON.stringify([...existing, dataUrl]));
      } catch {
        // Ignore storage quota errors
      }
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

export interface StudioSessionValue {
  readonly session: Session;
  readonly plan: PlanGeometry;
  readonly findings: readonly ScreeningFindingRow[];
  readonly findingCounts: FindingCounts;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly shellOverlay: ShellOverlayState;
  readonly setShellOverlay: React.Dispatch<React.SetStateAction<ShellOverlayState>>;
  readonly savedSnapshots: readonly SavedPlanSnapshot[];
  readonly saveCurrentSnapshot: (label?: string) => SavedPlanSnapshot;
  readonly restoreSnapshot: (snapshotId: string) => void;
  readonly locationData: LocationData | null;
  readonly applyZipCodeIntelligence: (zipCode: string) => Promise<LocationData | null>;
  readonly sitePhotos: readonly string[];
  readonly addSitePhoto: (dataUrl: string) => void;
  readonly removeSitePhoto: (index: number) => void;
  readonly heavyDecking: boolean;
  readonly setHeavyDecking: (enabled: boolean) => void;
  readonly runCommand: (command: Command) => SessionResult;
  /** All-or-nothing: applies every command or none. */
  readonly runCommands: (commands: readonly Command[]) => SessionResult;
  readonly onUndo: () => SessionResult;
  readonly onRedo: () => SessionResult;
  readonly loadPreset: (preset: 'benchmark-36' | 'starter-2' | 'shell-columns') => void;
  readonly generateFromSpace: (input: StarterSpaceInput) => void;
  readonly exportProjectJson: () => string;
  readonly importProjectJson: (rawJson: string) => { readonly ok: boolean; readonly message: string };
}

const DEFAULT_SHELL_OVERLAY: ShellOverlayState = {
  showPerimeterWalls: false,
  showColumns: false,
  columnSpacingFt: 40,
  columnSizeIn: 16,
  shellWidthFt: 110,
  shellDepthFt: 60,
  underlayDataUrl: null,
  underlayOpacity: 0.45,
  customWalls: [],
  customColumns: [],
  calibratedScaleInPerPx: null,
};

const StudioSessionContext = createContext<StudioSessionValue | null>(null);

export function createInitialSession(): Session {
  const migrated = migrate(fixture.document);
  return {
    document: migrated.document,
    counter: migrated.counter,
    ledger: EMPTY_LEDGER,
  };
}

function buildStarterTwoBaySession(): Session {
  const base = createInitialSession();
  const doc = base.document;
  const firstRun = doc.runs[0];
  if (firstRun === undefined) return base;
  const twoBays = firstRun.bays.slice(0, 2);
  const singleRun: Run = {
    ...firstRun,
    name: 'Run 1',
    backToBack: false,
    bays: twoBays,
  };
  return {
    document: {
      ...doc,
      name: 'Starter 2-Bay Concept',
      runs: [singleRun],
    },
    counter: base.counter,
    ledger: EMPTY_LEDGER,
  };
}

function buildShellColumnsFirstSession(): Session {
  const base = createInitialSession();
  return {
    document: {
      ...base.document,
      name: 'Building Shell & Column Grid (Pre-Rack)',
      runs: [],
    },
    counter: base.counter,
    ledger: EMPTY_LEDGER,
  };
}

export function StudioSessionProvider({
  children,
  onRefusal,
}: {
  readonly children: React.ReactNode;
  readonly onRefusal?: ((msg: string) => void) | undefined;
}): React.JSX.Element {
  const [session, setSession] = useState<Session>(createInitialSession);
  const [shellOverlay, setShellOverlay] = useState<ShellOverlayState>(DEFAULT_SHELL_OVERLAY);
  const [savedSnapshots, setSavedSnapshots] = useState<readonly SavedPlanSnapshot[]>([]);
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [sitePhotos, setSitePhotos] = useState<readonly string[]>([]);
  const [heavyDecking, setHeavyDecking] = useState<boolean>(false);

  useEffect(() => {
    registerGridColumnSyncSink((cols) => {
      setShellOverlay((prev) => ({
        ...prev,
        showColumns: true,
        customColumns: cols.map((c) => ({
          id: c.id,
          xUm: Math.round(c.x * 25_400),
          yUm: Math.round(c.y * 25_400),
          sizeIn: prev.columnSizeIn,
          label: c.id,
        })),
      }));
    });
    return () => {
      registerGridColumnSyncSink(null);
    };
  }, []);

  const addSitePhoto = useCallback((dataUrl: string): void => {
    setSitePhotos((prev) => [...prev, dataUrl]);
  }, []);

  const removeSitePhoto = useCallback((index: number): void => {
    setSitePhotos((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const runCommand = useCallback(
    (command: Command): SessionResult => {
      const result = dispatch(session, command);
      if (result.ok) {
        setSession(result.session);
      } else {
        onRefusal?.(result.msg);
      }
      return result;
    },
    [session, onRefusal],
  );

  const runCommands = useCallback(
    (commands: readonly Command[]): SessionResult => {
      if (commands.length === 0) {
        return { ok: true, session, label: 'No commands' };
      }
      const res = dispatch(session, { type: 'batch', commands });
      if (!res.ok) {
        onRefusal?.(res.msg);
        return res;
      }
      setSession(res.session);
      return res;
    },
    [session, onRefusal],
  );

  const onUndo = useCallback((): SessionResult => {
    const result = undo(session);
    if (result.ok) {
      setSession(result.session);
    } else {
      onRefusal?.(result.msg);
    }
    return result;
  }, [session, onRefusal]);

  const onRedo = useCallback((): SessionResult => {
    const result = redo(session);
    if (result.ok) {
      setSession(result.session);
    } else {
      onRefusal?.(result.msg);
    }
    return result;
  }, [session, onRefusal]);

  const loadPreset = useCallback(
    (preset: 'benchmark-36' | 'starter-2' | 'shell-columns'): void => {
      if (preset === 'starter-2') {
        setSession(buildStarterTwoBaySession());
      } else if (preset === 'shell-columns') {
        setSession(buildShellColumnsFirstSession());
        setShellOverlay((prev) => ({
          ...prev,
          showPerimeterWalls: true,
          showColumns: true,
        }));
      } else {
        setSession(createInitialSession());
      }
    },
    [],
  );

  const generateFromSpace = useCallback((input: StarterSpaceInput): void => {
    const base = createInitialSession();
    const doc = base.document;
    const bt = doc.bayTypes[0];
    if (bt === undefined) return;

    const clearHeightIn = Math.max(144, Math.round(input.clearHeightFt * 12));
    const usableHeightIn = Math.max(120, clearHeightIn - 36);
    const levelPitchIn = 60;
    const levelCount = Math.max(2, Math.min(6, Math.floor(usableHeightIn / levelPitchIn)));
    const beamLevels = Array.from({ length: levelCount }, (_, idx) => IN((idx + 1) * levelPitchIn));

    const bayPitchIn = Math.round((bt.beamLength + bt.uprightWidth) / 25_400);
    const usableLengthIn = Math.max(bayPitchIn * 2, Math.round(input.lengthFt * 12 * 0.8));
    const baysPerRun = Math.max(2, Math.min(16, Math.floor(usableLengthIn / bayPitchIn)));

    const palletsPerBay = (levelCount + 1) * bt.palletsPerBay;
    const targetBays = Math.max(baysPerRun, Math.ceil(Math.max(24, input.targetPositions) / Math.max(1, palletsPerBay)));
    const runCount = Math.max(2, Math.min(6, Math.ceil(targetBays / baysPerRun)));

    const aisleIn = Math.max(84, Math.round(input.aisleFt * 12));
    const frameDepthIn = Math.round(bt.frameDepth / 25_400);

    let counter = base.counter;
    const runs: Run[] = [];
    let currentYIn = 0;

    for (let r = 0; r < runCount; r += 1) {
      const runMinted = mintId(counter, 'run');
      counter = runMinted.counter;
      const isB2B = r > 0 && r < runCount - 1;
      const bays: Bay[] = [];
      for (let b = 0; b < baysPerRun; b += 1) {
        const bayMinted = mintId(counter, 'bay');
        counter = bayMinted.counter;
        bays.push({ id: bayMinted.id, locked: false });
      }
      runs.push({
        id: runMinted.id,
        name: `Run ${r + 1}`,
        x: IN(0),
        y: IN(currentYIn),
        bayTypeId: bt.id,
        backToBack: isB2B,
        rowSpacer: IN(6),
        floorStorage: true,
        bays,
      });
      const rowBlockIn = isB2B ? frameDepthIn * 2 + 6 : frameDepthIn;
      currentYIn += rowBlockIn + aisleIn;
    }

    const updatedDoc: StudioDocument = {
      ...doc,
      name: input.projectName?.trim() || doc.name,
      client: input.clientName?.trim() || doc.client,
      building: {
        ...doc.building,
        clearHeight: {
          value: IN(clearHeightIn),
          established: 'INPUT',
          source: 'Space generator input',
        },
        deflectorElev: {
          value: IN(Math.max(120, clearHeightIn - 16)),
          established: 'INPUT',
          source: 'Space generator input',
        },
      },
      bayTypes: [
        {
          ...bt,
          frameHeight: {
            value: IN(Math.min(clearHeightIn - 24, levelCount * levelPitchIn + 24)),
            established: 'INPUT',
            source: 'Space generator input',
          },
          beamLevels,
        },
      ],
      runs,
    };

    setSession({
      document: updatedDoc,
      counter,
      ledger: EMPTY_LEDGER,
    });
    setShellOverlay((prev) => ({
      ...prev,
      showPerimeterWalls: true,
      showColumns: input.showColumns,
      columnSpacingFt: input.columnSpacingFt,
      shellWidthFt: Math.max(40, Math.round(input.lengthFt)),
      shellDepthFt: Math.max(30, Math.round(input.widthFt)),
    }));
  }, []);

  const exportProjectJson = useCallback((): string => {
    const payload = {
      schemaVersion: '2.0',
      exportedAt: new Date().toISOString(),
      source: 'Rack Master Studio',
      document: session.document,
      counter: session.counter,
      shellOverlay,
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      window.localStorage?.setItem('rackstudio_last_exported_project', json);
    } catch {
      // Ignore storage quota errors in sandboxed environments
    }
    return json;
  }, [session, shellOverlay]);

  const importProjectJson = useCallback(
    (rawJson: string): { readonly ok: boolean; readonly message: string } => {
      try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        // Case 1: Native StudioDocument v2 export or v1 continuity fixture
        const docCandidate = (parsed['document'] ?? parsed) as Record<string, unknown>;
        if (Array.isArray(docCandidate['runs']) && Array.isArray(docCandidate['bayTypes'])) {
          if (docCandidate['schemaVersion'] === 2) {
            const doc = docCandidate as unknown as StudioDocument;
            setSession({
              document: doc,
              counter: (parsed['counter'] as Session['counter'] | undefined) ?? session.counter,
              ledger: EMPTY_LEDGER,
            });
            if (parsed['shellOverlay'] && typeof parsed['shellOverlay'] === 'object') {
              setShellOverlay((prev) => ({
                ...prev,
                ...(parsed['shellOverlay'] as Partial<ShellOverlayState>),
              }));
            }
            return {
              ok: true,
              message: `Imported studio project "${doc.name}" (${doc.runs.length} runs).`,
            };
          }
          const migrated = migrate(docCandidate);
          setSession({
            document: migrated.document,
            counter: migrated.counter,
            ledger: EMPTY_LEDGER,
          });
          return {
            ok: true,
            message: `Migrated and imported v1 project "${migrated.document.name}".`,
          };
        }

        // Case 2: Client Intake Handoff Package (ProjectHandoffPackage from warehouse-layout-planner)
        if (parsed['preliminaryLayout'] || parsed['spaceDefinition']) {
          const meta = (parsed['projectMetadata'] ?? {}) as Record<string, unknown>;
          const space = (parsed['spaceDefinition'] ?? {}) as Record<string, unknown>;
          const prelim = (parsed['preliminaryLayout'] ?? {}) as Record<string, unknown>;
          const aisleIn = Number(prelim['aisleWidthIn']) || 126;
          generateFromSpace({
            projectName: String(meta['projectName'] ?? 'Imported Client Intake'),
            clientName: String(meta['company'] ?? meta['companyName'] ?? 'Client Account'),
            lengthFt: Number(space['lengthFt']) || 120,
            widthFt: Number(space['widthFt']) || 80,
            clearHeightFt: Number(space['clearHeightFt']) || 28,
            aisleFt: aisleIn / 12,
            targetPositions: Number(prelim['palletCapacity']) || 192,
            showColumns: space['interiorColumns'] === 'yes',
            columnSpacingFt: 40,
          });
          return {
            ok: true,
            message: `Imported client intake package "${String(meta['projectName'] ?? 'Client Intake')}".`,
          };
        }

        return { ok: false, message: 'Unrecognized JSON schema. Expected StudioDocument or ProjectHandoffPackage.' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON file.';
        return { ok: false, message: `Import failed: ${msg}` };
      }
    },
    [generateFromSpace, session.counter],
  );

  const applyZipCodeIntelligence = useCallback(
    async (zipCode: string): Promise<LocationData | null> => {
      const data = await analyzeZipCode(zipCode);
      if (data === null) return null;
      setLocationData(data);
      const res = dispatch(session, {
        type: 'setField',
        label: `Set SDC from Zip Code ${data.zipCode}`,
        change: {
          section: 'building',
          patch: {
            sdc: {
              value: data.sdcCode,
              established: 'INPUT',
              source: `USGS / Zip Code Intelligence (${data.zipCode} · ${data.seismicCategory})`,
            },
          },
        },
      });
      if (res.ok) {
        setSession(res.session);
      }
      return data;
    },
    [session],
  );

  // State Isolation: memoize geometry against geometric fields (runs, bayTypes, unitLoad)
  // so editing Project Name or Client never triggers an unnecessary geometry recalculation.
  const plan = useMemo(
    () => planGeometry(session.document),
    [session.document.runs, session.document.bayTypes, session.document.unitLoad],
  );
  const findings = useMemo(
    () => screeningFindingsForDocument(session.document),
    [session.document],
  );
  const findingCounts = useMemo(() => countFindings(findings), [findings]);

  // Synchronize granular useRackStore slices with geometric state changes
  useEffect(() => {
    activeRackCommandSink = (cmd: Command) => {
      runCommand(cmd);
    };
    activeRackFirstRunId = session.document.runs[0]?.id ?? null;
    activeRackAllRunIds = session.document.runs.slice(0, -1).map((r) => r.id);
    activeRackBayTypeId = session.document.bayTypes[0]?.id ?? null;
    const bt = session.document.bayTypes[0];
    const spanIn = bt !== undefined ? Math.round((bt.beamLength / 25_400) * 100) / 100 : 96;
    const aisleIn =
      plan.aisles[0] !== undefined
        ? Math.round((plan.aisles[0].frameToFrame.value / 25_400) * 100) / 100
        : 132;
    const truckIn =
      Math.round((session.document.equipment.truckRAS.value / 25_400) * 100) / 100;
    const layoutNodes: RackLayoutNode[] = plan.runs.map((r) => {
      const firstRow = r.rows[0];
      const lastRow = r.rows[r.rows.length - 1];
      const topY = firstRow?.y ?? r.y;
      const botY = lastRow !== undefined ? lastRow.y + lastRow.depth : r.y;
      return {
        id: r.runId,
        label: r.label,
        xIn: Math.round(r.x / 25_400),
        yIn: Math.round(topY / 25_400),
        widthIn: Math.max(12, Math.round(r.runLength.value / 25_400)),
        depthIn: Math.max(12, Math.round((botY - topY) / 25_400)),
      };
    });
    updateRackStoreSlice({
      beamClearSpan: spanIn,
      frameToFrameAisle: aisleIn,
      truckMinAisle: truckIn,
      palletPositions: plan.totalPositions,
      layoutNodes,
    });
    return () => {
      activeRackCommandSink = null;
    };
  }, [
    plan.aisles,
    plan.runs,
    plan.totalPositions,
    runCommand,
    session.document.bayTypes,
    session.document.equipment.truckRAS.value,
    session.document.runs,
  ]);

  // Local-first 3-second debounced IndexedDB auto-save
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void persistWorkspaceToIndexedDb(session.document);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [session.document]);

  const saveCurrentSnapshot = useCallback(
    (label?: string): SavedPlanSnapshot => {
      const idx = savedSnapshots.length + 1;
      const optionCode = String.fromCharCode(67 + idx); // D, E, F...
      const narrowestIn =
        plan.narrowestClearAisle !== null
          ? Math.round(plan.narrowestClearAisle.value / 25_400)
          : null;
      const snap: SavedPlanSnapshot = {
        id: `snap-${idx}`,
        label: label?.trim() || `Option ${optionCode}: Custom Plan Snapshot #${idx}`,
        runsCount: plan.runs.length,
        baysCount: plan.totalBays,
        positionsCount: plan.totalPositions,
        narrowestAisleIn: narrowestIn,
        document: session.document,
        counter: session.counter,
        shellOverlay,
      };
      setSavedSnapshots((prev) => [...prev, snap]);
      return snap;
    },
    [plan, savedSnapshots.length, session.counter, session.document, shellOverlay],
  );

  const restoreSnapshot = useCallback(
    (snapshotId: string): void => {
      const found = savedSnapshots.find((s) => s.id === snapshotId);
      if (found === undefined) return;
      setSession({
        document: found.document,
        counter: found.counter,
        ledger: EMPTY_LEDGER,
      });
      setShellOverlay(found.shellOverlay);
    },
    [savedSnapshots],
  );

  const value = useMemo<StudioSessionValue>(
    () => ({
      session,
      plan,
      findings,
      findingCounts,
      canUndo: canUndo(session.ledger),
      canRedo: canRedo(session.ledger),
      shellOverlay,
      setShellOverlay,
      savedSnapshots,
      saveCurrentSnapshot,
      restoreSnapshot,
      locationData,
      applyZipCodeIntelligence,
      sitePhotos,
      addSitePhoto,
      removeSitePhoto,
      heavyDecking,
      setHeavyDecking,
      runCommand,
      runCommands,
      onUndo,
      onRedo,
      loadPreset,
      generateFromSpace,
      exportProjectJson,
      importProjectJson,
    }),
    [
      session,
      plan,
      findings,
      findingCounts,
      shellOverlay,
      savedSnapshots,
      saveCurrentSnapshot,
      restoreSnapshot,
      locationData,
      applyZipCodeIntelligence,
      sitePhotos,
      addSitePhoto,
      removeSitePhoto,
      heavyDecking,
      runCommand,
      runCommands,
      onUndo,
      onRedo,
      loadPreset,
      generateFromSpace,
      exportProjectJson,
      importProjectJson,
    ],
  );

  return <StudioSessionContext.Provider value={value}>{children}</StudioSessionContext.Provider>;
}

export function useOptionalStudioSession(): StudioSessionValue | null {
  return useContext(StudioSessionContext);
}

export function useStudioSession(): StudioSessionValue {
  const ctx = useContext(StudioSessionContext);
  if (ctx === null) {
    throw new Error('useStudioSession must be used inside a StudioSessionProvider');
  }
  return ctx;
}
