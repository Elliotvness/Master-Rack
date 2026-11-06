import {
  EMPTY_LEDGER,
  canRedo,
  canUndo,
  countFindings,
  dispatch,
  migrate,
  planGeometry,
  redo,
  screeningFindingsForDocument,
  undo,
  type Command,
  type FindingCounts,
  type PlanGeometry,
  type ScreeningFindingRow,
  type Session,
  type SessionResult,
} from '@rms/studio-model';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import fixture from '../../../fixtures/continuity/rack-studio-v1.json';

export interface StudioSessionValue {
  readonly session: Session;
  readonly plan: PlanGeometry;
  readonly findings: readonly ScreeningFindingRow[];
  readonly findingCounts: FindingCounts;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly runCommand: (command: Command) => SessionResult;
  /** All-or-nothing: applies every command or none. */
  readonly runCommands: (commands: readonly Command[]) => SessionResult;
  readonly onUndo: () => SessionResult;
  readonly onRedo: () => SessionResult;
}

const StudioSessionContext = createContext<StudioSessionValue | null>(null);

export function createInitialSession(): Session {
  const migrated = migrate(fixture.document);
  return {
    document: migrated.document,
    counter: migrated.counter,
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

  const plan = useMemo(() => planGeometry(session.document), [session.document]);
  const findings = useMemo(
    () => screeningFindingsForDocument(session.document),
    [session.document],
  );
  const findingCounts = useMemo(() => countFindings(findings), [findings]);

  const value = useMemo<StudioSessionValue>(
    () => ({
      session,
      plan,
      findings,
      findingCounts,
      canUndo: canUndo(session.ledger),
      canRedo: canRedo(session.ledger),
      runCommand,
      runCommands,
      onUndo,
      onRedo,
    }),
    [session, plan, findings, findingCounts, runCommand, runCommands, onUndo, onRedo],
  );

  return <StudioSessionContext.Provider value={value}>{children}</StudioSessionContext.Provider>;
}

export function useStudioSession(): StudioSessionValue {
  const ctx = useContext(StudioSessionContext);
  if (ctx === null) {
    throw new Error('useStudioSession must be used inside a StudioSessionProvider');
  }
  return ctx;
}
