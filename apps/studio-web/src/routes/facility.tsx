import { useMemo, useState, type JSX } from 'react';
import { Button } from '../components/button.js';
import { useToasts } from '../components/toast.js';
import { FacilityForm } from '../facility/facility-form.js';
import { UnitForm } from '../facility/unit-form.js';
import { FindingsPanel } from '../facility/findings-panel.js';
import {
  emptyFacilityDraft,
  createUnitDraft,
  collectFindings,
  readyToSubmit,
  toFacilityApiPayload,
  toUnitsApiPayload,
  type FacilityDraft,
  type UnitDraft,
} from '../facility/facility-model.js';
import {
  saveFacilityDraft,
  saveUnitsDraft,
  FacilityApiError,
} from '../facility/facility-client.js';
import { useOptionalStudioSession } from '../session-context.js';

export interface FacilityRouteProps {
  readonly initialRevisionId?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export default function FacilityRoute({
  initialRevisionId = '00000000-0000-0000-0000-000000000001',
  fetchImpl,
}: FacilityRouteProps): JSX.Element {
  const { push } = useToasts();
  const studioSession = useOptionalStudioSession();
  const [revisionId, setRevisionId] = useState<string>(initialRevisionId);
  const [facility, setFacility] = useState<FacilityDraft>(emptyFacilityDraft);
  const [units, setUnits] = useState<readonly UnitDraft[]>([createUnitDraft('unit-1', 'Standard GMA')]);
  const [activeTab, setActiveTab] = useState<'facility' | 'units' | 'findings'>('facility');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Space-to-Layout Quick Generator state (ported from warehouse-layout-planner intake wizard)
  const [spaceLengthFt, setSpaceLengthFt] = useState<number>(110);
  const [spaceWidthFt, setSpaceWidthFt] = useState<number>(60);
  const [spaceClearHeightFt, setSpaceClearHeightFt] = useState<number>(32);
  const [spaceTargetAisleFt, setSpaceTargetAisleFt] = useState<number>(11);
  const [spaceTargetPositions, setSpaceTargetPositions] = useState<number>(576);
  const [spaceColumnGridFt, setSpaceColumnGridFt] = useState<null | 30 | 40 | 50>(40);
  const [spaceGeneratorStatus, setSpaceGeneratorStatus] = useState<string | null>(null);

  const findings = useMemo(() => collectFindings(facility, units), [facility, units]);
  const isReady = useMemo(() => readyToSubmit(facility, units), [facility, units]);

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const facilityPayload = toFacilityApiPayload(facility);
      const unitsPayload = toUnitsApiPayload(units);

      await saveFacilityDraft(revisionId, facilityPayload, fetchImpl);
      await saveUnitsDraft(revisionId, unitsPayload, fetchImpl);

      setSaveSuccess(true);
      push('Facility and handling unit specifications saved to revision draft.', 'info');
    } catch (err) {
      if (err instanceof FacilityApiError) {
        push(err.message, 'refusal');
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to save draft specifications.';
        push(msg, 'refusal');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="facility-page-container" id="facility-page">
      <header className="page-header">
        <div className="page-header-info">
          <h1 className="page-title">Facility</h1>
          <p className="page-description">
            Tell us about the building and the loads it stores. Answer what you know; mark anything else{' '}
            <strong>not known</strong> and it becomes an open question with the person who can answer it —
            never a guess, and never a zero.
          </p>
        </div>

        <div className="page-header-controls">
          <details className="revision-selector-wrap">
            <summary className="selector-label">Advanced: Revision Target</summary>
            <label htmlFor="revision-id-input" className="selector-label">
              Active Revision ID:
            </label>
            <input
              id="revision-id-input"
              type="text"
              className="input-field input-field-mono"
              value={revisionId}
              onChange={(e) => setRevisionId(e.target.value)}
              placeholder="UUID revision id"
              disabled={isSaving}
            />
          </details>

          <div className="header-actions">
            <Button
              variant="primary"
              className="btn-save-facility"
              onClick={handleSave}
              isLoading={isSaving}
              loadingText="Saving draft…"
              aria-label="Save facility and unit configuration"
              id="save-facility-btn"
            >
              Save Draft
            </Button>
          </div>
        </div>
      </header>

      {saveSuccess && (
        <div className="facility-save-banner" role="status" id="facility-save-success">
          ✓ Draft updated successfully. Review the findings panel for unresolved items.
        </div>
      )}

      <nav className="section-tabs-nav" aria-label="Facility configuration sections" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'facility'}
          className={`section-tab-btn ${activeTab === 'facility' ? 'active' : ''}`}
          onClick={() => setActiveTab('facility')}
          id="tab-section-facility"
        >
          1. Facility Envelope
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'units'}
          className={`section-tab-btn ${activeTab === 'units' ? 'active' : ''}`}
          onClick={() => setActiveTab('units')}
          id="tab-section-units"
        >
          2. Handling Units ({units.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'findings'}
          className={`section-tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
          onClick={() => setActiveTab('findings')}
          id="tab-section-findings"
        >
          3. Findings & Readiness ({findings.length})
        </button>
      </nav>

      <main className="facility-main-layout">
        <div className="facility-content-column">
          {activeTab === 'facility' && (
            <>
              <FacilityForm draft={facility} onChange={setFacility} disabled={isSaving} />

              <section
                id="space-layout-generator-card"
                className="cmdbar-panel"
                aria-label="Starter Layout Generator from Space and Target Positions"
              >
                <h2>Quick Space-to-Layout Generator</h2>
                <p>
                  Enter your building dimensions and target pallet count to seed the Plan view with
                  an engineered starter layout, perimeter shell, and structural column grid.
                </p>
                <div className="pf-row">
                  <label htmlFor="space-len-ft" className="pf-label">
                    Length (ft)
                  </label>
                  <input
                    id="space-len-ft"
                    type="number"
                    min={24}
                    max={1000}
                    className="pf-input"
                    value={spaceLengthFt}
                    onChange={(e) => setSpaceLengthFt(Math.max(24, Number(e.target.value) || 24))}
                  />
                  <label htmlFor="space-wid-ft" className="pf-label">
                    Width (ft)
                  </label>
                  <input
                    id="space-wid-ft"
                    type="number"
                    min={20}
                    max={1000}
                    className="pf-input"
                    value={spaceWidthFt}
                    onChange={(e) => setSpaceWidthFt(Math.max(20, Number(e.target.value) || 20))}
                  />
                  <label htmlFor="space-clear-ft" className="pf-label">
                    Clear Height (ft)
                  </label>
                  <input
                    id="space-clear-ft"
                    type="number"
                    min={16}
                    max={60}
                    className="pf-input"
                    value={spaceClearHeightFt}
                    onChange={(e) =>
                      setSpaceClearHeightFt(Math.max(16, Number(e.target.value) || 16))
                    }
                  />
                </div>
                <div className="pf-row">
                  <label htmlFor="space-aisle-ft" className="pf-label">
                    Target Aisle (ft)
                  </label>
                  <input
                    id="space-aisle-ft"
                    type="number"
                    min={8}
                    max={20}
                    step={0.5}
                    className="pf-input"
                    value={spaceTargetAisleFt}
                    onChange={(e) =>
                      setSpaceTargetAisleFt(Math.max(8, Number(e.target.value) || 11))
                    }
                  />
                  <label htmlFor="space-target-pos" className="pf-label">
                    Target Pallet Positions
                  </label>
                  <input
                    id="space-target-pos"
                    type="number"
                    min={16}
                    max={10000}
                    step={16}
                    className="pf-input"
                    value={spaceTargetPositions}
                    onChange={(e) =>
                      setSpaceTargetPositions(Math.max(16, Number(e.target.value) || 64))
                    }
                  />
                  <label htmlFor="space-col-grid" className="pf-label">
                    Column Grid
                  </label>
                  <select
                    id="space-col-grid"
                    className="pf-input"
                    value={spaceColumnGridFt === null ? 'none' : String(spaceColumnGridFt)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSpaceColumnGridFt(
                        val === 'none' ? null : (Number(val) as 30 | 40 | 50),
                      );
                    }}
                  >
                    <option value="none">None (Clear Span)</option>
                    <option value="30">30 ft × 30 ft</option>
                    <option value="40">40 ft × 40 ft</option>
                    <option value="50">50 ft × 50 ft</option>
                  </select>
                </div>
                <div className="intake-actions">
                  <button
                    id="generate-space-layout-btn"
                    type="button"
                    className="pf-btn"
                    onClick={() => {
                      studioSession?.generateFromSpace({
                        lengthFt: spaceLengthFt,
                        widthFt: spaceWidthFt,
                        clearHeightFt: spaceClearHeightFt,
                        aisleFt: spaceTargetAisleFt,
                        targetPositions: spaceTargetPositions,
                        showColumns: spaceColumnGridFt !== null,
                        columnSpacingFt: spaceColumnGridFt ?? 40,
                      });
                      const msg = `Generated starter layout (${spaceLengthFt}' × ${spaceWidthFt}' shell, ${spaceClearHeightFt}' clear height) in Plan view.`;
                      setSpaceGeneratorStatus(msg);
                      push(msg, 'info');
                    }}
                  >
                    Generate Starter Layout in Plan
                  </button>
                </div>
                {spaceGeneratorStatus !== null && (
                  <p id="space-generator-status" role="status">
                    {spaceGeneratorStatus}
                  </p>
                )}
              </section>
            </>
          )}

          {activeTab === 'units' && (
            <UnitForm units={units} onChange={setUnits} disabled={isSaving} />
          )}

          {activeTab === 'findings' && (
            <FindingsPanel findings={findings} isReady={isReady} />
          )}
        </div>

        {activeTab !== 'findings' && (
          <aside className="facility-sidebar-column">
            <FindingsPanel findings={findings} isReady={isReady} />
          </aside>
        )}
      </main>
    </div>
  );
}
