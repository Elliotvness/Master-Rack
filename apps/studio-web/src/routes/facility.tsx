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

export interface FacilityRouteProps {
  readonly initialRevisionId?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export default function FacilityRoute({
  initialRevisionId = '00000000-0000-0000-0000-000000000001',
  fetchImpl,
}: FacilityRouteProps): JSX.Element {
  const { push } = useToasts();
  const [revisionId, setRevisionId] = useState<string>(initialRevisionId);
  const [facility, setFacility] = useState<FacilityDraft>(emptyFacilityDraft);
  const [units, setUnits] = useState<readonly UnitDraft[]>([createUnitDraft('unit-1', 'Standard GMA')]);
  const [activeTab, setActiveTab] = useState<'facility' | 'units' | 'findings'>('facility');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

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
            <FacilityForm draft={facility} onChange={setFacility} disabled={isSaving} />
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
