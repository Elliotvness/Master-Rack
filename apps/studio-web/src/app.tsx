import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { Banner } from './components/banner.js';
import { Header } from './components/header.js';
import { ToastRegion, useToasts } from './components/toast.js';
import { DEFAULT_VIEW, VIEWS } from './nav.js';

/**
 * One lazy chunk per view — blueprint §5.4's route-level code-splitting
 * decision, taken before there were routes to split. The 200 KB gzipped ceiling
 * applies to the INITIAL payload: the shell plus the first route, not the sum
 * of all six.
 *
 * The map is written out rather than built from `VIEWS` with a template
 * literal, because a fully dynamic `import(`./routes/${path}.js`)` gives the
 * bundler no static graph to split on — it would emit one chunk holding all six
 * views and the ceiling would be met by accident while the decision was
 * silently reversed.
 */
const LAZY_VIEWS = {
  plan: lazy(() => import('./routes/plan.js')),
  elevation: lazy(() => import('./routes/elevation.js')),
  sheets: lazy(() => import('./routes/sheets.js')),
  screening: lazy(() => import('./routes/screening.js')),
  bom: lazy(() => import('./routes/bom.js')),
  revisions: lazy(() => import('./routes/revisions.js')),
} as const;

function Loading(): React.JSX.Element {
  return (
    <p className="loading" role="status">
      Loading view…
    </p>
  );
}

/**
 * The shell.
 *
 * Three regions, which is the frame every later slice fills: the chrome bar,
 * the view, and the inspector rail. The rail is empty in S1 and says so — an
 * empty region that explains itself is honest; one that is simply blank reads
 * as broken.
 */
export function App(): React.JSX.Element {
  const { messages } = useToasts();

  return (
    <div className="studio">
      <Header />
      <Banner />

      <div className="studio-body">
        <main className="stage" id="stage">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Navigate to={`/${DEFAULT_VIEW}`} replace />} />
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
                      That address does not name one of the six studio views.
                    </p>
                  </section>
                }
              />
            </Routes>
          </Suspense>
        </main>

        <aside className="rail" aria-label="Inspector">
          <p className="not-implemented">
            <b>Empty.</b> The parameter panel, findings list and provenance popover arrive in later
            slices.
          </p>
        </aside>
      </div>

      <ToastRegion messages={messages} />
    </div>
  );
}
