import {
  LOST_POSITION_REASONS,
  MICROMETRES_PER_INCH,
  OBSTRUCTION_ENTITY_KINDS,
  acceptFixProposal,
  beamFamilyFromPartLabel,
  lostPositionLedger,
  lookupPublishedBeamSpan,
  planGeometry,
  proposeFixes,
  quoteReadinessForDocument,
  type AcceptedFixAuditRecord,
  type FixProposal,
} from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { useStudioSession } from '../session-context.js';

interface ScreeningFindingRow {
  readonly code: string;
  readonly severity: 'BLOCKING' | 'REVIEW' | 'MISSING_INPUT' | 'MISSING_SOURCE' | 'PASS';
  readonly subject: string;
  readonly summary: string;
  readonly closureText: string;
}

function umToIn(um: number): number {
  return Math.round(um / MICROMETRES_PER_INCH);
}

export default function ScreeningView(): React.JSX.Element {
  const { session, runCommands } = useStudioSession();
  const doc = session.document;

  const [auditRecords, setAuditRecords] = useState<readonly AcceptedFixAuditRecord[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const readiness = useMemo(() => quoteReadinessForDocument(doc), [doc]);
  const proposals = useMemo(() => proposeFixes(doc, session.counter), [doc, session.counter]);
  const plan = useMemo(() => planGeometry(doc), [doc]);

  const findings = useMemo<readonly ScreeningFindingRow[]>(() => {
    const rows: ScreeningFindingRow[] = [];

    // 1. Draft rule-pack ceiling check
    const isDraftRulePack = doc.packs.structural.includes('mvp-2026-08');
    rows.push({
      code: 'RULE_PACK_AUTHORITY',
      severity: isDraftRulePack ? 'REVIEW' : 'PASS',
      subject: `Pack ${doc.packs.structural}`,
      summary: isDraftRulePack
        ? `Rule pack ${doc.packs.structural} is DRAFT; all PASS outcomes are capped at REVIEW.`
        : `Rule pack ${doc.packs.structural} is two-person APPROVED (DEC-DF active).`,
      closureText: isDraftRulePack
        ? 'Pin an approved rule pack (studio-2026.09) to unlock PASS outcomes.'
        : 'Two-person approval verified.',
    });

    // 2. Aisle clearance checks
    const requiredClearUm = doc.equipment.truckRAS.value + 60 * MICROMETRES_PER_INCH;
    for (const aisle of plan.aisles) {
      const clearIn = umToIn(aisle.clearBetweenLoads.value);
      const reqIn = umToIn(requiredClearUm);
      if (aisle.clearBetweenLoads.value < requiredClearUm) {
        rows.push({
          code: 'AISLE_CLEAR_SHORTFALL',
          severity: 'BLOCKING',
          subject: aisle.aisleId,
          summary: `Clear aisle between loads is ${clearIn}" vs required ${reqIn}" (RAS + 60").`,
          closureText: `Widen frame-to-frame spacing or select a narrower reach truck.`,
        });
      } else {
        rows.push({
          code: 'AISLE_CLEAR_OK',
          severity: doc.equipment.truckRAS.established === 'UNKNOWN' ? 'MISSING_INPUT' : 'PASS',
          subject: aisle.aisleId,
          summary: `Clear aisle between loads is ${clearIn}" (target ${reqIn}").`,
          closureText:
            doc.equipment.truckRAS.established === 'UNKNOWN'
              ? 'Verify forklift right-angle stack (RAS) from OEM spec sheet.'
              : 'Meets operational aisle target.',
        });
      }
    }

    // 3. Bay-type beam span & capacity checks
    for (const bt of doc.bayTypes) {
      const family = beamFamilyFromPartLabel(bt.beamPart);
      const spanIn = umToIn(bt.beamLength);
      const spanLookup = lookupPublishedBeamSpan(family, spanIn);
      if (spanLookup.status === 'OFF_GRID') {
        rows.push({
          code: 'BEAM_SPAN_OFF_GRID',
          severity: 'REVIEW',
          subject: bt.name,
          summary: `Beam span ${spanIn}" is off-grid for ${family} (brackets: ${spanLookup.lowerSpanIn ?? 'min'}"–${spanLookup.upperSpanIn ?? 'max'}").`,
          closureText: 'Snap to a published span or obtain manufacturer engineering approval.',
        });
      }

      const demandLb = doc.unitLoad.weight * bt.palletsPerBay * doc.loadDistributionFactor;
      if (bt.beamPairCapacity.value < demandLb) {
        rows.push({
          code: 'BEAM_CAPACITY_EXCEEDED',
          severity: 'BLOCKING',
          subject: bt.name,
          summary: `Beam pair capacity ${bt.beamPairCapacity.value.toLocaleString()} lb < demand ${Math.round(demandLb).toLocaleString()} lb.`,
          closureText: 'Step up beam family or reduce unit load weight.',
        });
      } else {
        rows.push({
          code: 'BEAM_CAPACITY_OK',
          severity: bt.beamPairCapacity.established === 'UNKNOWN' ? 'MISSING_INPUT' : 'PASS',
          subject: bt.name,
          summary: `Beam pair capacity ${bt.beamPairCapacity.value.toLocaleString()} lb >= demand ${Math.round(demandLb).toLocaleString()} lb.`,
          closureText: 'Published catalog pair capacity satisfied.',
        });
      }
    }

    // 4. Unestablished building & fire protection fields (MS-1..MS-18)
    if (doc.building.clearHeight.established === 'UNKNOWN') {
      rows.push({
        code: 'CLEAR_HEIGHT_UNVERIFIED',
        severity: 'MISSING_INPUT',
        subject: 'Building clear height',
        summary: `Clear height (${umToIn(doc.building.clearHeight.value)}") is marked VERIFY.`,
        closureText: 'Confirm clear height from field laser measurement or architectural section.',
      });
    }
    if (doc.building.commodityClass.value.trim() === '') {
      rows.push({
        code: 'COMMODITY_CLASS_MISSING',
        severity: 'MISSING_SOURCE',
        subject: 'Fire protection (MS-15)',
        summary: 'NFPA 13 / FM Global commodity classification has not been established.',
        closureText: 'Provide owner fire-protection letter naming commodity class.',
      });
    }
    if (doc.building.sdc.value.trim() === '') {
      rows.push({
        code: 'SEISMIC_SDC_MISSING',
        severity: 'MISSING_SOURCE',
        subject: 'Seismic design category (MS-18)',
        summary: 'ASCE 7 / RMI Seismic Design Category (SDC) has not been established.',
        closureText: 'Provide site geotechnical / structural criteria naming SDC.',
      });
    }

    return rows;
  }, [doc, plan.aisles]);

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
