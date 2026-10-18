import { useState, type JSX } from 'react';
import { NavLink, Link, useNavigate } from 'react-router';

import { VIEWS } from '../nav.js';
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
 * The chrome bar: job tag, view tabs, undo, save, theme — in that DOM order,
 * which is the artifact's and is pinned by `HEADER_CONTROL_ORDER`.
 *
 * Auth controls (Invite Client, User status badge, Sign out / Sign in) sit
 * after theme in .chrome-actions, preserving the relative order of the core 10
 * controls.
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
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut(fetchImpl);
    navigate('/login');
  };

  return (
    <>
      <header className="chrome">
        <span id="jobtag" className="jobtag" tabIndex={0} data-established={jobTag !== undefined}>
          {/* No document is loaded, so there is no tag. It says so rather than
              showing a placeholder that reads like a real project number. */}
          {jobTag ?? 'No document loaded'}
        </span>

        <nav className="tabs" aria-label="Studio views">
          {VIEWS.map((view) => (
            <NavLink
              key={view.path}
              id={`tab-${view.path}`}
              to={`/${view.path}`}
              className={({ isActive }) => (isActive ? 'tab tab-active' : 'tab')}
              title={view.description}
            >
              {view.label}
            </NavLink>
          ))}
        </nav>

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

          {/* Auth controls appended after theme toggle */}
          {isAuthenticated && user ? (
            <div className="auth-chrome-group" id="auth-chrome-controls">
              <button
                id="invite-client-btn"
                type="button"
                className="chrome-btn"
                onClick={() => setIsInviteOpen(true)}
                title="Issue client invitation (Step 1)"
              >
                Invite Client
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
