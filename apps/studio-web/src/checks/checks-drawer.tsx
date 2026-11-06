import { Link } from 'react-router';

import { useStudioSession } from '../session-context.js';

/**
 * The Layout step's checks drawer (ADR-020): what is blocking this layout, said
 * under the drawing it is about, with the full list one link away.
 *
 * It reads the shared `findings` and `findingCounts` from `StudioSessionProvider`,
 * so the plan HUD chips, the checks drawer, and the Checks view cannot disagree.
 */
export function ChecksDrawer(): React.JSX.Element {
  const { findings: rows, findingCounts: counts } = useStudioSession();
  const blocking = rows.filter((r) => r.severity === 'BLOCKING');

  return (
    <section id="checks-drawer" className="checks-drawer" aria-labelledby="checks-drawer-heading">
      <div className="checks-drawer-head">
        <h2 id="checks-drawer-heading">Checks</h2>
        <ul className="checks-counts" aria-label="Findings by status">
          <li className={counts.blocking > 0 ? 'count count-block' : 'count'}>
            {counts.blocking} blocking
          </li>
          <li className="count">{counts.review} to review</li>
          <li className="count">{counts.missingInput} need input</li>
          <li className="count">{counts.missingSource} need a source</li>
          <li className="count count-pass">{counts.pass} passing</li>
        </ul>
        <Link id="checks-drawer-open" to="/screening" className="chrome-btn">
          Open all checks
        </Link>
      </div>
      {blocking.length > 0 ? (
        <ul className="checks-blocking" aria-label="Blocking findings">
          {blocking.map((row, i) => (
            <li key={`${row.code}-${row.subject}-${i}`}>
              <span className="tag tag-accent">Blocking</span>
              <span className="checks-summary">
                <b>{row.subject}</b> — {row.summary}
              </span>
              <span className="checks-closure">{row.closureText}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="checks-clear">Nothing is blocking this layout.</p>
      )}
    </section>
  );
}
