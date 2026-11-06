import {
  LOST_POSITION_REASONS,
  OBSTRUCTION_ENTITY_KINDS,
  acceptFixProposal,
  lostPositionLedger,
  planGeometry,
  proposeFixes,
  quoteReadinessForDocument,
  screeningFindingsForDocument,
  type AcceptedFixAuditRecord,
  type FixProposal,
} from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { useStudioSession } from '../session-context.js';

export default function ScreeningView(): React.JSX.Element {
  const { session, runCommands } = useStudioSession();
  const doc = session.document;

  const [auditRecords, setAuditRecords] = useState<readonly AcceptedFixAuditRecord[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const readiness = useMemo(() => quoteReadinessForDocument(doc), [doc]);
  const proposals = useMemo(() => proposeFixes(doc, session.counter), [doc, session.counter]);
  const plan = useMemo(() => planGeometry(doc), [doc]);

  const findings = useMemo(() => screeningFindingsForDocument(doc), [doc]);

  const positionLedger = useMemo(
    () =>
      lostPositionLedger({
        grossPositions: plan.totalPositions,
        losses: {},
      }),
    [plan.totalPositions],
  );

  const handleAcceptProposal = (proposal: FixProposal): void => {
    const audit = acceptFixProposal(doc, session.counter, proposal);
    const res = runCommands(proposal.commands);
    if (res.ok) {
      setAuditRecords((prev) => [audit, ...prev]);
      setActionNotice(`Accepted ${proposal.id} — ${audit.auditAttribution}`);
    }
  };

  return (
    <section className="screening-view" aria-labelledby="view-heading-screening">
      <div
        id="screening-readiness-banner"
        className={readiness.isQuoteReady ? 'bom-quote-banner ready' : 'bom-quote-banner draft'}
        role="status"
      >
        <strong>{readiness.watermark ?? 'Valid for Quote (Screening Complete)'}</strong>
        {!readiness.isQuoteReady && (
          <span className="bom-quote-reasons">
            {' — '}
            {readiness.blockingReasons.join(' ')}
          </span>
        )}
      </div>

      {actionNotice !== null && (
        <div id="screening-action-notice" className="bom-export-notice" role="status">
          {actionNotice}
        </div>
      )}

      <div className="bom-header">
        <div>
          <h1 id="view-heading-screening" className="bom-title">
            Checks
          </h1>
          <p className="bom-subtitle">
            Every screening finding against this layout, what it depends on, and the fix that would close
            it. Fixes are previewed and never applied without your say-so.
          </p>
        </div>
      </div>

      {/* 1. Pinned Authority Packs */}
      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
        <h2 style={{ marginTop: 0 }}>Pinned Authority Packs (I4)</h2>
        <div id="screening-pack-pins" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <span>
            <strong>Rack Catalog:</strong> <code>{doc.packs.rack}</code>
          </span>
          <span>
            <strong>Forklift Pack:</strong> <code>{doc.packs.forklift}</code>
          </span>
          <span>
            <strong>Accessory Pack:</strong> <code>{doc.packs.accessory}</code>
          </span>
          <span>
            <strong>Fire Pack:</strong> <code>{doc.packs.fire}</code>
          </span>
          <span>
            <strong>Structural Rules:</strong> <code>{doc.packs.structural}</code>
          </span>
        </div>
      </div>

      {/* 2. Previewable Fix Proposals (ADR-010, D2, D8) */}
      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
        <h2 style={{ marginTop: 0 }}>Previewable Fix Proposals ({proposals.length})</h2>
        <p style={{ fontSize: '12px', marginTop: 0 }}>
          Candidate remediations are computed deterministically and never auto-apply without explicit
          acceptance.
        </p>
        {proposals.length === 0 ? (
          <p id="screening-no-proposals">
            No geometric or catalog capacity shortfalls require a fix proposal on the current layout.
          </p>
        ) : (
          <table className="bom-table" aria-label="Previewable fix proposals">
            <thead>
              <tr>
                <th scope="col">Finding</th>
                <th scope="col">Proposed Fix</th>
                <th scope="col">Rationale</th>
                <th scope="col">Position Delta</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((prop) => (
                <tr key={prop.id} data-proposal-id={prop.id}>
                  <td>
                    <code>{prop.findingCode}</code>
                  </td>
                  <td>{prop.title}</td>
                  <td>{prop.rationale}</td>
                  <td className="font-mono">
                    {prop.previewDelta.palletPositionDelta >= 0
                      ? `+${prop.previewDelta.palletPositionDelta}`
                      : prop.previewDelta.palletPositionDelta}{' '}
                    pos
                  </td>
                  <td>
                    <button
                      id={`accept-fix-${prop.id}`}
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleAcceptProposal(prop)}
                    >
                      Accept Fix
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {auditRecords.length > 0 && (
          <div id="screening-audit-log" style={{ marginTop: '12px' }}>
            <h3>Accepted Fix Audit Trail (D8)</h3>
            <ul>
              {auditRecords.map((rec, idx) => (
                <li key={`${rec.proposalId}-${idx}`}>
                  <code>{rec.proposalId}</code>: {rec.auditAttribution}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 3. Live Screening Findings Table */}
      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
        <h2 style={{ marginTop: 0 }}>Screening Findings ({findings.length})</h2>
        <table className="bom-table" aria-label="Compliance screening findings">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Severity</th>
              <th scope="col">Subject</th>
              <th scope="col">Finding Summary</th>
              <th scope="col">What Closes It</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f, idx) => (
              <tr key={`${f.code}-${idx}`}>
                <td>
                  <code>{f.code}</code>
                </td>
                <td>
                  <span className="tag tag-accent">{f.severity}</span>
                </td>
                <td>{f.subject}</td>
                <td>{f.summary}</td>
                <td>{f.closureText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4. Obstruction-Face Registry & Position Accounting Ledger */}
      <div className="blueprint" style={{ padding: '12px' }}>
        <h2 style={{ marginTop: 0 }}>Warehouse Shell &amp; Position Accounting (ADR-007)</h2>
        <p style={{ fontSize: '12px' }}>
          <strong>Registered Obstruction Face Kinds ({OBSTRUCTION_ENTITY_KINDS.length}):</strong>{' '}
          {OBSTRUCTION_ENTITY_KINDS.join(', ')}
        </p>
        <p id="screening-position-identity" className="font-mono" style={{ fontSize: '13px' }}>
          Gross ({positionLedger.grossPositions}) - Lost ({positionLedger.totalLostPositions} across{' '}
          {LOST_POSITION_REASONS.length} tracked reasons) = Net Usable (
          {positionLedger.netUsablePositions})
        </p>
      </div>
    </section>
  );
}
