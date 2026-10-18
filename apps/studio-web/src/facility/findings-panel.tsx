import { useState, type JSX } from 'react';
import { StatusBadge } from '../components/badge.js';
import type { FacilityFinding } from './facility-model.js';

export interface FindingsPanelProps {
  readonly findings: readonly FacilityFinding[];
  readonly isReady: boolean;
}

export function FindingsPanel({ findings, isReady }: FindingsPanelProps): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'not_known' | 'not_answered'>('all');

  const notKnownCount = findings.filter((f) => f.kind === 'not_known').length;
  const notAnsweredCount = findings.filter((f) => f.kind === 'not_answered').length;

  const filteredFindings = findings.filter((f) => {
    if (filter === 'not_known') return f.kind === 'not_known';
    if (filter === 'not_answered') return f.kind === 'not_answered';
    return true;
  });

  return (
    <aside className="findings-register" aria-labelledby="findings-heading">
      <div className="findings-header">
        <h2 id="findings-heading" className="findings-title">
          Site Findings & Readiness
        </h2>
        <div className="findings-summary-counts">
          <StatusBadge tone={notAnsweredCount > 0 ? 'block' : 'pass'} id="count-unanswered">
            {notAnsweredCount} Needs Answer
          </StatusBadge>
          <StatusBadge tone="warn" id="count-not-known">
            {notKnownCount} Not Known
          </StatusBadge>
        </div>
      </div>

      <div
        className={`readiness-banner ${isReady ? 'readiness-ready' : 'readiness-blocked'}`}
        role="region"
        aria-label="Submission Readiness Status"
        id="submission-readiness-banner"
      >
        {isReady ? (
          <p className="readiness-text">
            <span className="readiness-icon" aria-hidden="true">
              ✓
            </span>
            <strong> Ready to proceed:</strong> All facility envelope and unit load fields have been
            addressed. Unknown fields will generate formal missing-input findings for the engineering team.
          </p>
        ) : (
          <p className="readiness-text">
            <span className="readiness-icon" aria-hidden="true">
              ⚠
            </span>
            <strong> Awaiting required answers:</strong> {notAnsweredCount} field{notAnsweredCount === 1 ? '' : 's'} remain
            unanswered. Enter measurements or explicitly mark them <strong>NOT KNOWN</strong> to proceed.
          </p>
        )}
      </div>

      <div className="findings-filters" role="tablist" aria-label="Filter findings by status">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({findings.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'not_answered'}
          className={`filter-btn ${filter === 'not_answered' ? 'active' : ''}`}
          onClick={() => setFilter('not_answered')}
        >
          Needs Answer ({notAnsweredCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'not_known'}
          className={`filter-btn ${filter === 'not_known' ? 'active' : ''}`}
          onClick={() => setFilter('not_known')}
        >
          Not Known ({notKnownCount})
        </button>
      </div>

      <div className="findings-list" role="list">
        {filteredFindings.length === 0 ? (
          <p className="findings-empty" id="findings-none">
            No findings for the selected filter.
          </p>
        ) : (
          filteredFindings.map((f) => (
            <div key={f.id} className="finding-card" role="listitem" id={`finding-${f.id.replace(/\./g, '-')}`}>
              <div className="finding-card-header">
                <span className="finding-label">{f.label}</span>
                <StatusBadge tone={f.kind === 'not_known' ? 'warn' : 'block'}>
                  {f.kind === 'not_known' ? 'NOT KNOWN' : 'NEEDS ANSWER'}
                </StatusBadge>
              </div>

              {f.note !== undefined && f.note.trim() !== '' && (
                <p className="finding-note">
                  <em>Note:</em> {f.note}
                </p>
              )}

              <div className="finding-who-can-answer">
                <span className="who-title">Who can answer: </span>
                <span className="who-body">{f.whoCanAnswer}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
