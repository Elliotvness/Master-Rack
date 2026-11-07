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
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import fixture from '../../../fixtures/continuity/rack-studio-v1.json';

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

  const plan = useMemo(() => planGeometry(session.document), [session.document]);
  const findings = useMemo(
    () => screeningFindingsForDocument(session.document),
    [session.document],
  );
  const findingCounts = useMemo(() => countFindings(findings), [findings]);

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
