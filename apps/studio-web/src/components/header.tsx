import { NavLink } from 'react-router';

import { VIEWS } from '../nav.js';
import { ThemeToggle } from './theme-toggle.js';

export interface HeaderProps {
  /** The project/revision tag. Absent until a document is loaded — never faked. */
  readonly jobTag?: string;
  readonly canUndo?: boolean;
  readonly saveState?: 'saved' | 'unsaved' | 'saving' | 'read-only';
  readonly onUndo?: () => void;
  readonly onSave?: () => void;
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
 * S1 draws nothing and owns no document, so undo and save render DISABLED
 * rather than absent. A control that appears when a later slice lands moves the
 * tab order under the user; one that is present and disabled does not, and it
 * tells the truth about what the application can currently do.
 */
export function Header({
  jobTag,
  canUndo = false,
  saveState = 'read-only',
  onUndo,
  onSave,
}: HeaderProps): React.JSX.Element {
  return (
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
      </div>
    </header>
  );
}
