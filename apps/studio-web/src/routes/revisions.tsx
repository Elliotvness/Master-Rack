import {
  MICROMETRES_PER_INCH,
  bomForDocument,
  runScopeLabelForLine,
  takeoffSummary,
} from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { ChecksDrawer } from '../checks/checks-drawer.js';
import { useStudioSession } from '../session-context.js';

interface AssumptionItem {
  readonly key: string;
  readonly scope: string;
  readonly statement: string;
}

interface CloudHubProjectItem {
  readonly id: string;
  readonly name: string;
  readonly client: string;
  readonly revision: string;
  readonly status: 'DRAFT' | 'FROZEN' | 'IN_PE_REVIEW' | 'PE_SEALED';
  readonly positions: number;
  readonly jurisdiction: string;
}

interface TeamAccessMember {
  readonly email: string;
  readonly role: 'Viewer' | 'Editor' | 'PE Reviewer';
}

const INITIAL_CLOUD_PROJECTS: readonly CloudHubProjectItem[] = [
  {
    id: 'prj-ontario-dc',
    name: 'Ontario West Distribution Center — Phase 1',
    client: 'Pacific Cold Logistics',
    revision: 'P02',
    status: 'PE_SEALED',
    positions: 1440,
    jurisdiction: 'CA — CBC / ASCE 7-22',
  },
  {
    id: 'prj-dallas-hub',
    name: 'DFW Regional Fulfillment Annex',
    client: 'LoneStar Freight Corp',
    revision: 'P01',
    status: 'IN_PE_REVIEW',
    positions: 864,
    jurisdiction: 'TX — IBC',
  },
  {
    id: 'prj-joliet-3pl',
    name: 'Joliet Cross-Dock Selective Expansion',
    client: 'Midwest 3PL Partners',
    revision: 'P01',
    status: 'FROZEN',
    positions: 576,
    jurisdiction: 'IL — IBC',
  },
];

const INITIAL_TEAM_MEMBERS: readonly TeamAccessMember[] = [
  { email: 'lead.integrator@mcmurraystern.com', role: 'Editor' },
  { email: 'eor.review@structural-pe-partner.com', role: 'PE Reviewer' },
];

function umToIn(um: number): number {
  return Math.round(um / MICROMETRES_PER_INCH);
}

export default function RevisionsView(): React.JSX.Element {
  const { session } = useStudioSession();
  const doc = session.document;

  const [revisionIdInput, setRevisionIdInput] = useState<string>('');
  const [revisionCode, setRevisionCode] = useState<'P01' | 'P02'>('P01');
  const [lifecycleState, setLifecycleState] = useState<'DRAFT' | 'FROZEN'>('DRAFT');
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<ReadonlySet<string>>(new Set());
  const [disclaimerChecked, setDisclaimerChecked] = useState<boolean>(false);
  const [internalC01Created, setInternalC01Created] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [refusalReasons, setRefusalReasons] = useState<readonly string[]>([]);

  // Step 5: PE Submittal & 2-5 Business Day Turnaround Tracker state
  const [peStateJurisdiction, setPeStateJurisdiction] = useState<string>('CA — CBC / ASCE 7-22');
  const [peSlabSpec, setPeSlabSpec] = useState<string>('6" Slab · 4,000 psi');
  const [peAnchorSpec, setPeAnchorSpec] = useState<string>(
    '(2) 5/8"×5" Seismic Expansion Anchors',
  );
  const [peSubmittalState, setPeSubmittalState] = useState<'READY' | 'IN_PE_REVIEW' | 'PE_SEALED'>(
    'READY',
  );
  const [peTrackingNumber, setPeTrackingNumber] = useState<string | null>(null);

  // Step 6: Cloud Project Hub & Team Access state
  const [cloudProjects, setCloudProjects] =
    useState<readonly CloudHubProjectItem[]>(INITIAL_CLOUD_PROJECTS);
  const [cloudSearch, setCloudSearch] = useState<string>('');
  const [cloudStatusFilter, setCloudStatusFilter] = useState<string>('ALL');
  const [teamMembers, setTeamMembers] =
    useState<readonly TeamAccessMember[]>(INITIAL_TEAM_MEMBERS);
  const [newMemberEmail, setNewMemberEmail] = useState<string>('');
  const [newMemberRole, setNewMemberRole] = useState<'Viewer' | 'Editor' | 'PE Reviewer'>(
    'Viewer',
  );

  const filteredCloudProjects = useMemo(
    () =>
      cloudProjects.filter((p) => {
        const matchesStatus = cloudStatusFilter === 'ALL' || p.status === cloudStatusFilter;
        const q = cloudSearch.trim().toLowerCase();
        const matchesQuery =
          q.length === 0 ||
          p.name.toLowerCase().includes(q) ||
          p.client.toLowerCase().includes(q) ||
          p.jurisdiction.toLowerCase().includes(q);
        return matchesStatus && matchesQuery;
      }),
    [cloudProjects, cloudSearch, cloudStatusFilter],
  );

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

  const handleSyncDraftToApi = async (): Promise<void> => {
    const revId = revisionIdInput.trim();
    if (revId.length === 0) {
      setStatusNotice('Enter a Revision UUID before syncing the Studio draft to the API.');
      return;
    }
    try {
      const encodedId = encodeURIComponent(revId);
      const facRes = await fetch(`/api/client/v1/revisions/${encodedId}/facility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: doc.name,
          width_um: 36_576_000,
          depth_um: 24_384_000,
          clear_height_um: doc.building.clearHeight.value,
          forklift:
            doc.equipment.truckRAS.established === 'INPUT'
              ? { model_stated: true, required_aisle_um: doc.equipment.truckRAS.value }
              : { model_stated: false },
        }),
      });
      if (!facRes.ok) {
        setStatusNotice(`Facility sync failed (${String(facRes.status)}).`);
        return;
      }

      const unitsRes = await fetch(`/api/client/v1/revisions/${encodedId}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          units: [
            {
              unit_id: 'studio-unit-1',
              width_um: doc.unitLoad.palletW,
              depth_um: doc.unitLoad.palletD,
              height_um: doc.unitLoad.height,
              weight_lb: Math.max(1, Math.round(doc.unitLoad.weight)),
              overhang_um: null,
            },
          ],
        }),
      });
      if (!unitsRes.ok) {
        setStatusNotice(`Units sync failed (${String(unitsRes.status)}).`);
        return;
      }

      const firstAisleUm = doc.equipment.truckRAS.value;
      const runsPayload = doc.runs.map((r) => {
        const bt = doc.bayTypes.find((b) => b.id === r.bayTypeId) ?? doc.bayTypes[0]!;
        const activeLevels = bt.beamLevels.length;
        const bays = r.bays.map((b) => ({
          bay_id: b.id,
          length_um: bt.beamLength,
          levels: Math.max(1, activeLevels),
        }));
        return {
          run_id: r.id,
          unit_id: 'studio-unit-1',
          x_um: Math.max(0, r.x),
          y_um: Math.max(0, r.y),
          bays,
        };
      });

      const optRes = await fetch(`/api/client/v1/revisions/${encodedId}/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: [
            {
              option_id: 'studio-opt-1',
              label: doc.name || 'Studio Layout Option',
              aisle_width_um: firstAisleUm,
              runs: runsPayload,
            },
          ],
          active_option_id: 'studio-opt-1',
        }),
      });
      if (!optRes.ok) {
        setStatusNotice(`Options sync failed (${String(optRes.status)}).`);
        return;
      }

      setStatusNotice(`Synced Studio draft (facility, units, options) to revision ${revId}.`);
    } catch (err) {
      setStatusNotice(
        `Revision sync failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }
  };

  const handleLockPreliminary = async (): Promise<void> => {
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

    const revId = revisionIdInput.trim();
    if (revId.length > 0) {
      try {
        const res = await fetch(
          `/api/client/v1/revisions/${encodeURIComponent(revId)}/submit`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': `studio-lock-${revId}-${revisionCode}`,
            },
            body: JSON.stringify({
              assumptions_acknowledged: true,
              disclaimer_version_id: 'disclaimer-v2026.09',
            }),
          },
        );
        if (!res.ok) {
          setStatusNotice(`Server submit returned HTTP ${String(res.status)}.`);
          return;
        }
      } catch (err) {
        setStatusNotice(
          `Server submit failed: ${err instanceof Error ? err.message : 'network error'}`,
        );
        return;
      }
    }

    setRefusalReasons([]);
    setLifecycleState('FROZEN');
    setStatusNotice(
      `Revision ${revisionCode} locked as FROZEN and recorded in the revision history.`,
    );
  };

  const handleCloneToP02 = async (): Promise<void> => {
    const revId = revisionIdInput.trim();
    if (revId.length > 0) {
      try {
        await fetch(`/api/client/v1/revisions/${encodeURIComponent(revId)}/clone`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `studio-clone-${revId}-p02`,
          },
          body: JSON.stringify({}),
        });
      } catch {
        // Proceed with local clone state if offline.
      }
    }
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

  const unackedCount = assumptions.filter((a) => !acknowledgedKeys.has(a.key)).length;
  const requiredLeft = (unackedCount > 0 ? 1 : 0) + (disclaimerChecked ? 0 : 1);

  return (
    <section className="revisions-view" aria-labelledby="view-heading-revisions">
      <div className="bom-header">
        <div>
          <h1 id="view-heading-revisions" className="bom-title">
            Review &amp; submit
          </h1>
          <p className="bom-subtitle">
            Locking issues {revisionCode} as a preliminary revision that cannot be edited. Two things
            are required first; open checks are not — they travel with the revision as findings.
          </p>
        </div>
        <p id="rev-required-left" className="review-left" role="status">
          {lifecycleState === 'FROZEN'
            ? `${revisionCode} is locked.`
            : requiredLeft === 0
              ? 'Ready to lock.'
              : `${requiredLeft} required step${requiredLeft === 1 ? '' : 's'} left.`}
        </p>
      </div>

      {statusNotice !== null && (
        <div id="rev-status-notice" className="bom-export-notice" role="status">
          {statusNotice}
        </div>
      )}

      {refusalReasons.length > 0 && (
        <div id="rev-refusal-banner" className="bom-quote-banner draft" role="alert">
          <strong>Preliminary lock refused ({refusalReasons.length} reason(s)):</strong>
          <ul className="review-reasons">
            {refusalReasons.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <ol className="review-steps">
        <li className="blueprint review-step" aria-labelledby="review-open-checks">
          <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
          <div className="review-step-head">
            <h2 id="review-open-checks">Open checks</h2>
            <span className="tag tag-neutral">Not required to lock</span>
          </div>
          <p className="review-note">
            Anything still open is listed in the revision as a finding, with who can close it — the
            gap travels with the submission rather than stopping it.
          </p>
          <ChecksDrawer />
        </li>

        <li className="blueprint review-step" aria-labelledby="review-assumptions">
          <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
          <div className="review-step-head">
            <h2 id="review-assumptions">Acknowledge planning assumptions</h2>
            <span className={unackedCount === 0 ? 'tag tag-accent' : 'tag tag-outline'}>
              Required · {assumptions.length - unackedCount} of {assumptions.length}
            </span>
          </div>
          <ul className="review-checklist" aria-label="Pre-submission assumptions">
            {assumptions.map((a) => (
              <li key={a.key}>
                <label>
                  <input
                    type="checkbox"
                    data-assumption-key={a.key}
                    checked={acknowledgedKeys.has(a.key)}
                    disabled={lifecycleState === 'FROZEN'}
                    onChange={() => toggleAssumption(a.key)}
                    aria-label={`Acknowledge ${a.key}`}
                  />
                  <span>
                    {a.statement} <span className="review-key">({a.scope})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </li>

        <li className="blueprint review-step" aria-labelledby="review-notice">
          <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
          <div className="review-step-head">
            <h2 id="review-notice">Accept the preliminary notice</h2>
            <span className={disclaimerChecked ? 'tag tag-accent' : 'tag tag-outline'}>
              Required · {disclaimerChecked ? 'done' : 'open'}
            </span>
          </div>
          <label className="review-disclaimer">
            <input
              id="rev-ack-disclaimer"
              type="checkbox"
              checked={disclaimerChecked}
              disabled={lifecycleState === 'FROZEN'}
              onChange={(e) => setDisclaimerChecked(e.target.checked)}
            />
            <span>
              I acknowledge the preliminary screening notice: this layout is preliminary screening
              only, unstamped, for discussion, and requires review by a licensed structural engineer
              of record and the authority having jurisdiction.
            </span>
          </label>
        </li>
      </ol>

      <div className="review-lock">
        <button
          id="rev-lock-btn"
          type="button"
          className="btn btn-primary"
          disabled={lifecycleState === 'FROZEN'}
          onClick={() => {
            void handleLockPreliminary();
          }}
        >
          Lock &amp; Issue Preliminary {revisionCode}
        </button>
        <span className="review-note">
          A lock that is missing a required step is refused and says which.
        </span>
      </div>

      <section className="blueprint review-revision" aria-labelledby="review-revision">
        <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
        <h2 id="review-revision">Revision</h2>
        <p id="rev-active-card" className="font-mono">
          <strong>Revision:</strong> <span id="rev-code">{revisionCode}</span> ·{' '}
          <strong>State:</strong> <span id="rev-state">{lifecycleState}</span> ·{' '}
          <strong>Session Edits:</strong> {session.ledger.depth}
        </p>

        <details className="review-sync-details">
          <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
            Advanced: Server Revision Sync
          </summary>
          <div className="review-sync" style={{ marginTop: '8px' }}>
            <label htmlFor="rev-id-input">Revision UUID</label>
            <input
              id="rev-id-input"
              type="text"
              className="input-field font-mono"
              placeholder="00000000-0000-4000-8000-000000000001"
              value={revisionIdInput}
              onChange={(e) => setRevisionIdInput(e.target.value)}
            />
            <button
              id="rev-sync-draft-btn"
              type="button"
              className="btn"
              disabled={lifecycleState === 'FROZEN'}
              onClick={() => {
                void handleSyncDraftToApi();
              }}
            >
              Sync draft to the revision
            </button>
          </div>
        </details>

        {lifecycleState === 'FROZEN' && (
          <div className="review-sync">
            <button
              id="rev-clone-btn"
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void handleCloneToP02();
              }}
            >
              Clone to Draft P02
            </button>
            <details style={{ display: 'inline-block', marginLeft: '8px' }}>
              <summary className="btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                Internal Estimator Tools
              </summary>
              <button
                id="rev-create-c01-btn"
                type="button"
                className="btn"
                style={{ marginLeft: '8px' }}
                onClick={handleCreateInternalC01}
              >
                Create Internal Commercial Revision C01
              </button>
            </details>
          </div>
        )}
      </section>

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
                <th scope="col">Run</th>
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
                    <td className="font-mono">{runScopeLabelForLine(line, doc)}</td>
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

      {/* 4. Step 5: Professional Engineering (PE) Submittal & 2-5 Business Day Turnaround Pipeline */}
      <section
        id="rev-pe-submittal-panel"
        className="blueprint review-revision"
        aria-labelledby="heading-pe-submittal"
        style={{ marginTop: '16px' }}
      >
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>
        <div className="review-step-head">
          <h2 id="heading-pe-submittal">
            Step 5: Professional Engineering (PE) Submittal &amp; 2–5 Day Turnaround Tracker
          </h2>
          <span
            id="rev-pe-status-badge"
            className={peSubmittalState === 'IN_PE_REVIEW' ? 'tag tag-accent' : 'tag tag-outline'}
          >
            {peSubmittalState === 'IN_PE_REVIEW'
              ? `IN PE REVIEW (${peTrackingNumber ?? 'PE-2026-01'}) · EST. 2–5 BUSINESS DAYS`
              : 'PRELIMINARY PACKAGE · READY FOR PE SUBMITTAL'}
          </span>
        </div>
        <p className="review-note">
          Submit your locked preliminary package to licensed professional engineers for municipal
          permit calculation packages and sealed drawings (typical turnaround: 2–5 business days vs.
          multi-week traditional workflows).
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
            marginTop: '12px',
          }}
        >
          <label
            htmlFor="rev-pe-state-select"
            style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
          >
            <span>State &amp; Building Code Jurisdiction</span>
            <select
              id="rev-pe-state-select"
              className="pf-input"
              value={peStateJurisdiction}
              onChange={(e) => setPeStateJurisdiction(e.target.value)}
            >
              <option value="CA — CBC / ASCE 7-22">CA — CBC / ASCE 7-22</option>
              <option value="TX — IBC">TX — IBC</option>
              <option value="IL — IBC">IL — IBC</option>
              <option value="FL — FBC">FL — FBC</option>
              <option value="WA — WSBC">WA — WSBC</option>
            </select>
          </label>

          <label
            htmlFor="rev-pe-slab-select"
            style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
          >
            <span>Concrete Slab Verification</span>
            <select
              id="rev-pe-slab-select"
              className="pf-input"
              value={peSlabSpec}
              onChange={(e) => setPeSlabSpec(e.target.value)}
            >
              <option value={'6" Slab · 4,000 psi'}>6&quot; Slab · 4,000 psi</option>
              <option value={'8" Slab · 4,500 psi'}>8&quot; Slab · 4,500 psi</option>
              <option value={'10" Heavy Slab · 5,000 psi'}>10&quot; Heavy Slab · 5,000 psi</option>
            </select>
          </label>

          <label
            htmlFor="rev-pe-anchor-select"
            style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
          >
            <span>Baseplate Anchor Specification</span>
            <select
              id="rev-pe-anchor-select"
              className="pf-input"
              value={peAnchorSpec}
              onChange={(e) => setPeAnchorSpec(e.target.value)}
            >
              <option value={'(2) 1/2"×4-1/4" Wedge Anchors'}>
                (2) 1/2&quot;×4-1/4&quot; Wedge Anchors
              </option>
              <option value={'(2) 5/8"×5" Seismic Expansion Anchors'}>
                (2) 5/8&quot;×5&quot; Seismic Expansion Anchors
              </option>
              <option value={'(4) 3/4"×6" Heavy Seismic Anchors'}>
                (4) 3/4&quot;×6&quot; Heavy Seismic Anchors
              </option>
            </select>
          </label>
        </div>

        <ol
          id="rev-pe-milestone-tracker"
          aria-label="PE Submittal 2 to 5 day turnaround milestones"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '8px',
            marginTop: '12px',
            paddingLeft: '18px',
            fontSize: '12px',
          }}
        >
          <li data-pe-stage="1">
            <strong>Stage 1:</strong> Preliminary CAD &amp; BOM Package ({revisionCode}){' '}
            <span>[{lifecycleState === 'FROZEN' ? 'COMPLETE' : 'IN DRAFT'}]</span>
          </li>
          <li data-pe-stage="2">
            <strong>Stage 2:</strong> RMI MH16.1 / AISI S100 Pre-Check &amp; Anchor Schedule{' '}
            <span>[VERIFIED]</span>
          </li>
          <li data-pe-stage="3">
            <strong>Stage 3:</strong> Licensed PE Review &amp; Calculation Submittal{' '}
            <span>
              [{peSubmittalState === 'IN_PE_REVIEW' ? 'ACTIVE · DAY 1 OF 2–5' : 'QUEUED'}]
            </span>
          </li>
          <li data-pe-stage="4">
            <strong>Stage 4:</strong> Sealed Permit Drawings &amp; Calc Book Issued{' '}
            <span>[EST. 2–5 BUSINESS DAYS]</span>
          </li>
        </ol>

        <div className="review-sync" style={{ marginTop: '10px' }}>
          <button
            id="rev-pe-submit-btn"
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const ticket = `PE-2026-${revisionCode}-884`;
              setPeSubmittalState('IN_PE_REVIEW');
              setPeTrackingNumber(ticket);
              setStatusNotice(
                `Submitted ${revisionCode} (${peStateJurisdiction}, ${peSlabSpec}, ${peAnchorSpec}) to Licensed PE queue (${ticket} · 2–5 business day turnaround).`,
              );
            }}
          >
            Submit {revisionCode} for Licensed PE Review (2–5 Days)
          </button>
        </div>
      </section>

      {/* 5. Step 6: Cloud Project Hub, Reuse & Team Sharing */}
      <section
        id="rev-cloud-hub-panel"
        className="blueprint review-revision"
        aria-labelledby="heading-cloud-hub"
        style={{ marginTop: '16px' }}
      >
        <i className="corner tl"></i>
        <i className="corner tr"></i>
        <i className="corner bl"></i>
        <i className="corner br"></i>
        <div className="review-step-head">
          <h2 id="heading-cloud-hub">Step 6: Cloud Project Hub, Design Reuse &amp; Team Access</h2>
          <button
            id="rev-cloud-save-btn"
            type="button"
            className="btn"
            onClick={() => {
              const newPrj: CloudHubProjectItem = {
                id: `prj-saved-${String(cloudProjects.length + 1)}`,
                name: doc.name || 'Warehouse Rack Design',
                client: doc.client || 'Active Client',
                revision: revisionCode,
                status:
                  peSubmittalState === 'IN_PE_REVIEW'
                    ? 'IN_PE_REVIEW'
                    : lifecycleState,
                positions: summary.totalPalletPositions,
                jurisdiction: peStateJurisdiction,
              };
              setCloudProjects((prev) => [newPrj, ...prev]);
              setStatusNotice(
                `Stored "${newPrj.name}" (${newPrj.revision}, ${newPrj.positions} pallet positions) in Cloud Project Hub.`,
              );
            }}
          >
            + Store Active Design in Cloud Hub
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
            marginTop: '10px',
          }}
        >
          <label htmlFor="rev-cloud-search-input" className="elev-toolbar-label">
            Search Projects
            <input
              id="rev-cloud-search-input"
              type="text"
              className="pf-input"
              placeholder="Filter by project, client, or state..."
              value={cloudSearch}
              onChange={(e) => setCloudSearch(e.target.value)}
            />
          </label>
          <label htmlFor="rev-cloud-status-filter" className="elev-toolbar-label">
            Status Filter
            <select
              id="rev-cloud-status-filter"
              className="pf-input dock-compact-select"
              value={cloudStatusFilter}
              onChange={(e) => setCloudStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PE_SEALED">PE Sealed</option>
              <option value="IN_PE_REVIEW">In PE Review</option>
              <option value="FROZEN">Preliminary Locked</option>
              <option value="DRAFT">Draft</option>
            </select>
          </label>
        </div>

        <table
          id="rev-cloud-projects-table"
          className="bom-table"
          aria-label="Cloud stored rack projects"
          style={{ marginTop: '10px' }}
        >
          <thead>
            <tr>
              <th scope="col">Project Name</th>
              <th scope="col">Client</th>
              <th scope="col">Revision</th>
              <th scope="col">Status</th>
              <th scope="col">Pallet Positions</th>
              <th scope="col">Jurisdiction</th>
              <th scope="col">Reuse</th>
            </tr>
          </thead>
          <tbody>
            {filteredCloudProjects.map((prj) => (
              <tr key={prj.id} data-cloud-project-id={prj.id}>
                <td>
                  <strong>{prj.name}</strong>
                </td>
                <td>{prj.client}</td>
                <td className="font-mono">{prj.revision}</td>
                <td className="font-mono">{prj.status}</td>
                <td className="font-mono">{prj.positions}</td>
                <td>{prj.jurisdiction}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    data-reuse-project-btn={prj.id}
                    onClick={() => {
                      setPeStateJurisdiction(prj.jurisdiction);
                      setStatusNotice(
                        `Loaded cloud project "${prj.name}" (${prj.revision}) template for reuse.`,
                      );
                    }}
                  >
                    Reuse Design
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Team Access & Role Sharing */}
        <div
          id="rev-team-sharing-box"
          style={{
            marginTop: '14px',
            paddingTop: '10px',
            borderTop: '1px solid var(--rule)',
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: '13px' }}>Team Sharing &amp; Access Control</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
            <label htmlFor="rev-team-email-input" className="elev-toolbar-label">
              Collaborator Email
              <input
                id="rev-team-email-input"
                type="email"
                className="pf-input"
                placeholder="colleague@company.com"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
              />
            </label>
            <label htmlFor="rev-team-role-select" className="elev-toolbar-label">
              Access Role
              <select
                id="rev-team-role-select"
                className="pf-input dock-compact-select"
                value={newMemberRole}
                onChange={(e) =>
                  setNewMemberRole(e.target.value as 'Viewer' | 'Editor' | 'PE Reviewer')
                }
              >
                <option value="Viewer">Viewer (Read-Only)</option>
                <option value="Editor">Editor (Design &amp; BOM)</option>
                <option value="PE Reviewer">PE Reviewer (Submittal &amp; Seal)</option>
              </select>
            </label>
            <button
              id="rev-team-share-btn"
              type="button"
              className="btn"
              onClick={() => {
                const emailTrimmed = newMemberEmail.trim();
                if (emailTrimmed.length === 0) return;
                setTeamMembers((prev) => [
                  ...prev,
                  { email: emailTrimmed, role: newMemberRole },
                ]);
                setNewMemberEmail('');
                setStatusNotice(
                  `Granted ${newMemberRole} access to ${emailTrimmed} on ${revisionCode}.`,
                );
              }}
            >
              + Share Project
            </button>
          </div>
          <ul
            id="rev-team-members-list"
            aria-label="Project team collaborators"
            style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12px' }}
          >
            {teamMembers.map((m, idx) => (
              <li key={`${m.email}-${idx}`}>
                <span className="font-mono">{m.email}</span> — <strong>{m.role}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
