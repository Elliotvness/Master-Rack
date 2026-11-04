import {
  MICROMETRES_PER_INCH,
  bomForDocument,
  takeoffSummary,
} from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { useStudioSession } from '../session-context.js';

interface AssumptionItem {
  readonly key: string;
  readonly scope: string;
  readonly statement: string;
}

function umToIn(um: number): number {
  return Math.round(um / MICROMETRES_PER_INCH);
}

export default function RevisionsView(): React.JSX.Element {
  const { session } = useStudioSession();
  const doc = session.document;

  const [revisionCode, setRevisionCode] = useState<'P01' | 'P02'>('P01');
  const [lifecycleState, setLifecycleState] = useState<'DRAFT' | 'FROZEN'>('DRAFT');
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<ReadonlySet<string>>(new Set());
  const [disclaimerChecked, setDisclaimerChecked] = useState<boolean>(false);
  const [internalC01Created, setInternalC01Created] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [refusalReasons, setRefusalReasons] = useState<readonly string[]>([]);

  const assumptions = useMemo<readonly AssumptionItem[]>(() => {
    const list: AssumptionItem[] = [
      {
        key: 'pallet.overhang.front',
        scope: 'unit load',
        statement:
          'Pallet front/rear overhang uses the 3 in per side planning assumption unless field-verified.',
      },
    ];
    if (doc.equipment.truckRAS.established !== 'INPUT') {
      list.push({
        key: 'forklift.aisle_clearance',
        scope: 'equipment',
        statement: `Forklift right-angle stack (${umToIn(doc.equipment.truckRAS.value)}") is a planning band assumption (${doc.equipment.truckType}).`,
      });
    }
    if (doc.building.clearHeight.established !== 'INPUT') {
      list.push({
        key: 'building.clear_height',
        scope: 'facility',
        statement: `Building clear height (${umToIn(doc.building.clearHeight.value)}") is unverified and requires field laser confirmation.`,
      });
    }
    return list;
  }, [doc]);

  const bomLines = useMemo(() => bomForDocument(doc), [doc]);
  const summary = useMemo(() => takeoffSummary(bomLines, doc), [bomLines, doc]);

  const toggleAssumption = (key: string): void => {
    setAcknowledgedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleLockPreliminary = (): void => {
    const reasons: string[] = [];
    const unacked = assumptions.filter((a) => !acknowledgedKeys.has(a.key));
    if (unacked.length > 0) {
      reasons.push(
        `${unacked.length} assumption(s) remain unacknowledged (${unacked.map((a) => a.key).join(', ')}).`,
      );
    }
    if (!disclaimerChecked) {
      reasons.push(
        'Delegated-design preliminary screening disclaimer (disclaimer-v2026.09) must be acknowledged.',
      );
    }
    if (reasons.length > 0) {
      setRefusalReasons(reasons);
      setStatusNotice(null);
      return;
    }

    setRefusalReasons([]);
    setLifecycleState('FROZEN');
    setStatusNotice(
      `Revision ${revisionCode} locked as FROZEN. WORM manifest queued for 7-year compliance retention.`,
    );
  };

  const handleCloneToP02 = (): void => {
    setRevisionCode('P02');
    setLifecycleState('DRAFT');
    setRefusalReasons([]);
    setStatusNotice(
      'Cloned frozen P01 to editable Draft P02. P01 remains immutable.',
    );
  };

  const handleCreateInternalC01 = (): void => {
    setInternalC01Created(true);
    setStatusNotice(
      `Created internal commercial revision C01 from ${revisionCode} (invisible on client routes; waivers reset).`,
    );
  };

  return (
    <section className="revisions-view" aria-labelledby="view-heading-revisions">
      <div className="bom-header">
        <div>
          <h1 id="view-heading-revisions" className="bom-title">
            Revisions
          </h1>
          <p className="bom-subtitle">
            Revision Lineage, Pre-Submission Assumption Register, Immutability &amp; Internal C01
            Calculation Trace.
          </p>
        </div>
      </div>

      {statusNotice !== null && (
        <div id="rev-status-notice" className="bom-export-notice" role="status">
          {statusNotice}
        </div>
      )}

      {refusalReasons.length > 0 && (
        <div id="rev-refusal-banner" className="bom-quote-banner draft" role="alert">
          <strong>Preliminary lock refused ({refusalReasons.length} reason(s)):</strong>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {refusalReasons.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Active Revision Card & Command History */}
      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
        <h2 style={{ marginTop: 0 }}>Active Revision Lineage</h2>
        <p id="rev-active-card" className="font-mono">
          <strong>Revision:</strong> <span id="rev-code">{revisionCode}</span> ·{' '}
          <strong>State:</strong> <span id="rev-state">{lifecycleState}</span> ·{' '}
          <strong>Pack Authority:</strong> <code>{doc.packs.structural}</code> ·{' '}
          <strong>Session Edits:</strong> {session.ledger.depth}
        </p>

        {lifecycleState === 'FROZEN' && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button
              id="rev-clone-btn"
              type="button"
              className="btn btn-primary"
              onClick={handleCloneToP02}
            >
              Clone to Draft P02
            </button>
            <button
              id="rev-create-c01-btn"
              type="button"
              className="btn"
              onClick={handleCreateInternalC01}
            >
              Create Internal Commercial Revision C01
            </button>
          </div>
        )}
      </div>

      {/* 2. Pre-Submission Assumption Register & Disclaimer */}
      <div className="blueprint" style={{ padding: '12px', marginBottom: '16px' }}>
        <h2 style={{ marginTop: 0 }}>Pre-Submission Assumption Register ({assumptions.length})</h2>
        <p style={{ fontSize: '12px', marginTop: 0 }}>
          Every planning assumption must be explicitly acknowledged before locking a preliminary
          revision.
        </p>
        <table className="bom-table" aria-label="Pre-submission assumptions">
          <thead>
            <tr>
              <th scope="col">Acknowledge</th>
              <th scope="col">Assumption Key</th>
              <th scope="col">Scope</th>
              <th scope="col">Statement</th>
            </tr>
          </thead>
          <tbody>
            {assumptions.map((a) => (
              <tr key={a.key}>
                <td>
                  <input
                    type="checkbox"
                    data-assumption-key={a.key}
                    checked={acknowledgedKeys.has(a.key)}
                    disabled={lifecycleState === 'FROZEN'}
                    onChange={() => toggleAssumption(a.key)}
                    aria-label={`Acknowledge ${a.key}`}
                  />
                </td>
                <td>
                  <code>{a.key}</code>
                </td>
                <td>{a.scope}</td>
                <td>{a.statement}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input
              id="rev-ack-disclaimer"
              type="checkbox"
              checked={disclaimerChecked}
              disabled={lifecycleState === 'FROZEN'}
              onChange={(e) => setDisclaimerChecked(e.target.checked)}
            />
            <span>
              I acknowledge <code>disclaimer-v2026.09</code>: this layout is preliminary screening
              only, unstamped, for discussion, and requires review by a licensed structural engineer
              of record and the authority having jurisdiction.
            </span>
          </label>
        </div>

        <div style={{ marginTop: '12px' }}>
          <button
            id="rev-lock-btn"
            type="button"
            className="btn btn-primary"
            disabled={lifecycleState === 'FROZEN'}
            onClick={handleLockPreliminary}
          >
            Lock &amp; Issue Preliminary {revisionCode}
          </button>
        </div>
      </div>

      {/* 3. Internal Commercial C01 "Show Your Work" Calculation Trace */}
      {internalC01Created && (
        <div
          id="rev-c01-panel"
          className="blueprint"
          style={{ padding: '12px', marginBottom: '16px' }}
        >
          <h2 style={{ marginTop: 0 }}>
            Internal Commercial Revision C01 — &ldquo;Show Your Work&rdquo; Trace
          </h2>
          <p style={{ fontSize: '12px', marginTop: 0 }}>
            Internal-only commercial workspace (audience: <code>internal</code>). Client routes
            never return <code>C01</code> or its part-level MPNs. Total pallet positions:{' '}
            <strong>{summary.totalPalletPositions}</strong>.
          </p>
          <table
            id="rev-trace-table"
            className="bom-table"
            aria-label="Internal C01 calculation trace"
          >
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Part / Unresolved Reference</th>
                <th scope="col">Quantity</th>
                <th scope="col">Derivation Rule (&ldquo;Show Your Work&rdquo;)</th>
              </tr>
            </thead>
            <tbody>
              {bomLines.map((line, idx) => {
                const partLabel =
                  line.partRef.kind === 'catalog'
                    ? line.partRef.partRevisionId
                    : line.partRef.uncataloguedPartId;
                return (
                  <tr key={`${line.category}-${idx}`}>
                    <td>{line.category}</td>
                    <td className="font-mono">{partLabel}</td>
                    <td className="font-mono">
                      {line.resolved ? `${line.qty.value} ${line.uom}` : line.unresolvedReason}
                    </td>
                    <td>{line.ruleText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
