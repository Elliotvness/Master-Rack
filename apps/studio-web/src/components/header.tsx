import { useState, type JSX } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';

import { STEPS, VIEWS, stepForPath } from '../nav.js';
import { useAuth } from '../auth/auth-context.js';
import { ThemeToggle } from './theme-toggle.js';
import { StatusBadge } from './badge.js';
import { InviteModal } from './invite-modal.js';

export interface HeaderProps {
  /** The project/revision tag. Absent until a document is loaded — never faked. */
  readonly jobTag?: string | undefined;
  readonly canUndo?: boolean | undefined;
  readonly saveState?: ('saved' | 'unsaved' | 'saving' | 'read-only') | undefined;
  readonly onUndo?: (() => void) | undefined;
  readonly onSave?: (() => void) | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * The save button states, from the build plan S6: exactly one of Saved, Save
 * layout, Saving…, Read-only. Enumerated so the button cannot invent a fifth.
 */
const SAVE_LABEL = {
  saved: 'Saved',
  unsaved: 'Save layout',
  saving: 'Saving…',
  'read-only': 'Read-only',
} as const;

/**
 * The chrome (ADR-020): brand and job on the first row, the six job steps on
 * the second, and — when the active step owns more than one view — that step's
 * views on a third. Undo, save, theme and the auth controls sit on the first
 * row visually but LAST in the DOM, so a keyboard user reaches the navigation
 * before them; `HEADER_CONTROL_ORDER` pins that and the grid places it.
 */
export function Header({
  jobTag,
  canUndo = false,
  saveState = 'read-only',
  onUndo,
  onSave,
  fetchImpl,
}: HeaderProps): JSX.Element {
  const { user, isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const currentPath = pathname.split('/').filter(Boolean)[0] ?? '';
  const activeStep = stepForPath(currentPath);
  const stepViews =
    activeStep !== undefined && activeStep.views.length > 1
      ? VIEWS.filter((v) => activeStep.views.includes(v.path))
      : [];

  const handleSignOut = async () => {
    await signOut(fetchImpl);
    navigate('/login');
  };

  return (
    <>
      <header className="chrome">
        <div className="chrome-brand">
          <img
            className="brand-logo brand-logo-light"
            src="/brand/mcs-wordmark-color.png"
            alt="McMurray Stern"
            width={92}
            height={33}
          />
          <img
            className="brand-logo brand-logo-dark"
            src="/brand/mcs-wordmark-white.png"
            alt=""
            aria-hidden="true"
            width={92}
            height={33}
          />
          <span className="chrome-product">Rack Master Studio</span>
        </div>

        <span id="jobtag" className="jobtag" tabIndex={0} data-established={jobTag !== undefined}>
          {/* No document is loaded, so there is no tag. It says so rather than
              showing a placeholder that reads like a real project number. */}
          {jobTag ?? 'No document loaded'}
        </span>

        <nav className="steps" aria-label="Job steps">
          <ol>
            {STEPS.map((step, index) => {
              const isActive = step.id === activeStep?.id;
              return (
                <li key={step.id}>
                  <Link
                    id={`step-${step.id}`}
                    to={`/${step.views[0] as string}`}
                    className={isActive ? 'step step-active' : 'step'}
                    aria-current={isActive ? 'step' : undefined}
                    title={step.description}
                  >
                    <span className="step-num" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {step.label}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        {stepViews.length > 0 && activeStep !== undefined ? (
          <nav className="step-views" aria-label={`${activeStep.label} views`}>
            {stepViews.map((view) => (
              <NavLink
                key={view.path}
                id={`tab-${view.path}`}
                to={`/${view.path}`}
                className={({ isActive }) => (isActive ? 'view-tab view-tab-active' : 'view-tab')}
                title={view.description}
              >
                {view.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        <div className="chrome-actions">
          <button
            id="undobtn"
            type="button"
            className="chrome-btn"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
          >
            Undo
          </button>
          <button
            id="savebtn"
            type="button"
            className="chrome-btn"
            onClick={onSave}
            disabled={saveState === 'read-only' || saveState === 'saving'}
            aria-label={SAVE_LABEL[saveState]}
          >
            {SAVE_LABEL[saveState]}
          </button>
          <ThemeToggle />
          <Link
            id="portal-hub-btn"
            to="/welcome"
            className="chrome-btn"
            title="Open Main Page, User Access & System Guide"
          >
            Main Page &amp; Guide
          </Link>

          {isAuthenticated && user ? (
            <div className="auth-chrome-group" id="auth-chrome-controls">
              <button
                id="invite-client-btn"
                type="button"
                className="chrome-btn"
                onClick={() => setIsInviteOpen(true)}
                title="Issue a client invitation"
              >
                Invite client
              </button>
              <StatusBadge tone="pass" id="user-badge" className="user-badge">
                {user.name ?? user.email}
              </StatusBadge>
              <button
                id="signoutbtn"
                type="button"
                className="chrome-btn"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link id="signinbtn" to="/login" className="chrome-btn">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <InviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        fetchImpl={fetchImpl}
      />
    </>
  );
}
