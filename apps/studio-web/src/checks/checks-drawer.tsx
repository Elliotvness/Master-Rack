import { proposeFixes } from '@rms/studio-model';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { useRackStore, useStudioSession } from '../session-context.js';

/**
 * The Layout step's checks drawer (ADR-020): what is blocking this layout, said
 * under the drawing it is about, with the full list one link away.
 *
 * It reads the shared `findings` and `findingCounts` from `StudioSessionProvider`,
 * so the plan HUD chips, the checks drawer, and the Checks view cannot disagree.
 */
export function ChecksDrawer(): React.JSX.Element {
  const { session, findings: rows, findingCounts: counts, runCommands } = useStudioSession();
  const setFrameToFrameAisle = useRackStore((state) => state.setFrameToFrameAisle);
  const blocking = rows.filter((r) => r.severity === 'BLOCKING');
  const proposals = useMemo(
    () => proposeFixes(session.document, session.counter),
    [session.document, session.counter],
  );

  const truckNeedsIn = Number(
    ((session.document.equipment.truckRAS.value + 60 * 25_400) / 25_400).toFixed(2),
  );
  const targetF2FIn = Math.ceil(truckNeedsIn + 6);
  const targetClearIn = Math.ceil(truckNeedsIn);

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
          {blocking.map((row, i) => {
            const isAisleError =
              row.code.includes('AISLE') || row.subject.toLowerCase().includes('aisle');
            const matchingProposal = proposals.find((p) => p.findingCode === row.code);
            return (
              <li key={`${row.code}-${row.subject}-${i}`} className="checks-blocking-row">
                <span className="tag tag-accent">Blocking</span>
                <span className="checks-summary">
                  <b>{row.subject}</b> — {row.summary}
                </span>
                <span className="checks-closure">{row.closureText}</span>
                {isAisleError ? (
                  <button
                    id={i === 0 ? 'checks-autofix-aisle-btn' : undefined}
                    type="button"
                    className="checks-autofix-btn"
                    onClick={() => {
                      setFrameToFrameAisle(targetF2FIn);
                      const cmds = session.document.runs.slice(0, -1).map((r) => ({
                        type: 'setAisleAfter' as const,
                        runId: r.id,
                        frameToFrame: targetF2FIn * 25_400,
                      }));
                      if (cmds.length > 0) {
                        runCommands(cmds);
                      }
                    }}
                  >
                    Auto-adjust to {targetF2FIn}&quot; ({targetClearIn}&quot; clear)
                  </button>
                ) : matchingProposal !== undefined ? (
                  <button
                    type="button"
                    className="checks-autofix-btn"
                    onClick={() => runCommands(matchingProposal.commands)}
                  >
                    Auto-fix: {matchingProposal.title}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="checks-clear">Nothing is blocking this layout.</p>
      )}
    </section>
  );
}
