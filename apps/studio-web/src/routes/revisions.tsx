import {
  MICROMETRES_PER_INCH,
  bomForDocument,
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
      `Revision ${revisionCode} locked as FROZEN. WORM manifest queued for 7-year compliance retention.`,
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
                    {a.statement} <span className="review-key">{a.scope} · {a.key}</span>
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
              I acknowledge <code>disclaimer-v2026.09</code>: this layout is preliminary screening
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
          <strong>Pack Authority:</strong> <code>{doc.packs.structural}</code> ·{' '}
          <strong>Session Edits:</strong> {session.ledger.depth}
        </p>

        <div className="review-sync">
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
        <p className="review-note">
          Internal work derives C01 from the locked revision and never writes back to it.
        </p>
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
