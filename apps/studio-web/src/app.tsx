import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { Banner } from './components/banner.js';
import { Header } from './components/header.js';
import { ToastRegion, useToasts, type ToastMessage } from './components/toast.js';
import { DEFAULT_VIEW, VIEWS } from './nav.js';
import { StudioSessionProvider, useStudioSession } from './session-context.js';
import { AuthProvider, type AuthUser } from './auth/auth-context.js';

/**
 * One lazy chunk per view — blueprint §5.4's route-level code-splitting
 * decision, taken before there were routes to split. The 200 KB gzipped ceiling
 * applies to the INITIAL payload: the shell plus the first route, not the sum
 * of all views.
 */
const LAZY_VIEWS = {
  plan: lazy(() => import('./routes/plan.js')),
  elevation: lazy(() => import('./routes/elevation.js')),
  sheets: lazy(() => import('./routes/sheets.js')),
  screening: lazy(() => import('./routes/screening.js')),
  bom: lazy(() => import('./routes/bom.js')),
  revisions: lazy(() => import('./routes/revisions.js')),
  invite: lazy(() => import('./routes/invite.js')),
  login: lazy(() => import('./routes/login.js')),
  facility: lazy(() => import('./routes/facility.js')),
  options: lazy(() => import('./routes/options.js')),
} as const;

function Loading(): React.JSX.Element {
  return (
    <p className="loading" role="status">
      Loading view…
    </p>
  );
}

function StudioShell({
  messages,
  fetchImpl,
}: {
  readonly messages: readonly ToastMessage[];
  readonly fetchImpl?: typeof fetch | undefined;
}): React.JSX.Element {
  const { canUndo, onUndo } = useStudioSession();

  return (
    <div className="studio">
      <Header canUndo={canUndo} onUndo={onUndo} fetchImpl={fetchImpl} />
      <Banner />

      <div className="studio-body">
        <main className="stage" id="stage">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Navigate to={`/${DEFAULT_VIEW}`} replace />} />
              <Route path="/welcome" element={<LAZY_VIEWS.login />} />
              <Route path="/invite" element={<LAZY_VIEWS.invite />} />
              <Route path="/login" element={<LAZY_VIEWS.login />} />
              {VIEWS.map((view) => {
                const Element = LAZY_VIEWS[view.path as keyof typeof LAZY_VIEWS];
                return <Route key={view.path} path={`/${view.path}`} element={<Element />} />;
              })}
              <Route
                path="*"
                element={
                  <section className="view-placeholder">
                    <h1>No such view</h1>
                    <p className="not-implemented">
                      That address does not name one of the studio views.
                    </p>
                  </section>
                }
              />
            </Routes>
          </Suspense>
        </main>
      </div>

      <ToastRegion messages={messages} />
    </div>
  );
}

/**
 * The shell with AuthProvider and StudioSessionProvider.
 */
export function App({
  initialUser = null,
  fetchImpl,
}: {
  readonly initialUser?: AuthUser | null | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
} = {}): React.JSX.Element {
  const { messages, push } = useToasts();

  return (
    <AuthProvider initialUser={initialUser}>
      <StudioSessionProvider onRefusal={(msg) => push(msg, 'refusal')}>
        <StudioShell messages={messages} fetchImpl={fetchImpl} />
      </StudioSessionProvider>
    </AuthProvider>
  );
}
