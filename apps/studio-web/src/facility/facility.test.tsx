/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import {
  emptyFacilityDraft,
  createUnitDraft,
  validateNumericEntry,
  setFacilityKnown,
  setFacilityNotKnown,
  clearFacilityField,
  setUnitKnown,
  setUnitNotKnown,
  clearUnitField,
  collectFindings,
  readyToSubmit,
  toFacilityApiPayload,
  toUnitsApiPayload,
  MeasurementRefusalError,
  FACILITY_FIELD_SPECS,
  UNIT_FIELD_SPECS,
} from './facility-model.js';
import {
  saveFacilityDraft,
  saveUnitsDraft,
  fetchRevisionPreview,
  FacilityApiError,
} from './facility-client.js';
import { FieldInput } from './field-input.js';
import { FindingsPanel } from './findings-panel.js';
import { FacilityForm } from './facility-form.js';
import { UnitForm } from './unit-form.js';
import FacilityRoute from '../routes/facility.js';

describe('Facility & Unit Model (Blueprint §15.2 Step 3, §15.3 D-02, FR-CP-01..03)', () => {
  it('starts with every facility field empty, assuming nothing', () => {
    const draft = emptyFacilityDraft();
    for (const spec of FACILITY_FIELD_SPECS) {
      expect(draft[spec.id].state).toBe('empty');
    }
    const unit = createUnitDraft('unit-1');
    for (const spec of UNIT_FIELD_SPECS) {
      if (spec.id === 'unitName') {
        expect(unit.unitName.state).toBe('known');
      } else {
        expect(unit[spec.id].state).toBe('empty');
      }
    }
    expect(readyToSubmit(draft, [unit])).toBe(false);
  });

  it('REFUSES zero or negative values for measurements with actionable NOT KNOWN guidance', () => {
    expect(() => validateNumericEntry('clearHeightIn', 0)).toThrow(MeasurementRefusalError);
    expect(() => validateNumericEntry('clearHeightIn', 0)).toThrow(/mark the field NOT KNOWN rather than entering a zero/);
    expect(() => validateNumericEntry('clearHeightIn', -12)).toThrow(MeasurementRefusalError);
    expect(() => validateNumericEntry('clearHeightIn', Number.NaN)).toThrow(/finite number/);

    expect(() => validateNumericEntry('palletWidthIn', 0)).toThrow(MeasurementRefusalError);
    expect(() => validateNumericEntry('palletDepthIn', -5)).toThrow(MeasurementRefusalError);
    expect(() => validateNumericEntry('palletHeightIn', 0)).toThrow(MeasurementRefusalError);
    expect(() => validateNumericEntry('palletWeightLb', 0)).toThrow(MeasurementRefusalError);

    // Non-negative keys allow 0 but refuse < 0
    expect(() => validateNumericEntry('palletOverhangIn', 0)).not.toThrow();
    expect(() => validateNumericEntry('palletOverhangIn', -1)).toThrow(/must be non-negative/);
    expect(() => validateNumericEntry('dockCount', 0)).not.toThrow();
    expect(() => validateNumericEntry('dockCount', -1)).toThrow(/must be non-negative/);
  });

  it('allows clients to mark fields NOT KNOWN and submit without inventing numbers', () => {
    let draft = emptyFacilityDraft();
    for (const spec of FACILITY_FIELD_SPECS) {
      draft = setFacilityNotKnown(draft, spec.id, '');
    }

    let unit = createUnitDraft('unit-1');
    for (const spec of UNIT_FIELD_SPECS) {
      unit = setUnitNotKnown(unit, spec.id, '');
    }

    expect(readyToSubmit(draft, [unit])).toBe(true);
    const findings = collectFindings(draft, [unit]);
    expect(findings.length).toBe(FACILITY_FIELD_SPECS.length + UNIT_FIELD_SPECS.length);
    expect(findings.every((f) => f.kind === 'not_known')).toBe(true);
  });

  it('distinguishes NOT KNOWN from NOT ANSWERED across facility and unit fields', () => {
    let draft = emptyFacilityDraft();
    draft = setFacilityNotKnown(draft, 'slabThicknessIn', 'Landlord has no structural records');
    draft = setFacilityKnown(draft, 'clearHeightIn', 384);

    let unit = createUnitDraft('unit-1');
    unit = setUnitNotKnown(unit, 'commodityClass', 'Awaiting chemical inventory hazard review');

    const findings = collectFindings(draft, [unit]);

    const slab = findings.find((f) => f.fieldKey === 'slabThicknessIn');
    const envelope = findings.find((f) => f.fieldKey === 'envelopeWidthFt');
    const clearHeight = findings.find((f) => f.fieldKey === 'clearHeightIn');
    const commodity = findings.find((f) => f.fieldKey === 'commodityClass');

    expect(slab?.kind).toBe('not_known');
    expect(slab?.note).toBe('Landlord has no structural records');
    expect(envelope?.kind).toBe('not_answered');
    expect(clearHeight).toBeUndefined(); // Answered fields are excluded from missing findings
    expect(commodity?.kind).toBe('not_known');
  });

  it('ensures every finding provides actionable "Who can answer" guidance (> 10 characters)', () => {
    const draft = emptyFacilityDraft();
    const unit = createUnitDraft('unit-1');
    const findings = collectFindings(draft, [unit]);

    for (const finding of findings) {
      expect(finding.whoCanAnswer.length).toBeGreaterThan(10);
      expect(finding.label.length).toBeGreaterThan(0);
    }
  });

  it('supports multiple independent handling units (FR-CP-02, FR-CP-03)', () => {
    let u1 = createUnitDraft('unit-1', 'GMA Pallet');
    u1 = setUnitKnown(u1, 'palletWidthIn', 40);
    u1 = setUnitKnown(u1, 'palletDepthIn', 48);
    u1 = setUnitKnown(u1, 'palletHeightIn', 60);
    u1 = setUnitKnown(u1, 'palletWeightLb', 2000);
    u1 = setUnitKnown(u1, 'palletOverhangIn', 2);
    u1 = setUnitKnown(u1, 'palletsPerBay', 2);
    u1 = setUnitKnown(u1, 'targetLevels', 4);
    u1 = setUnitKnown(u1, 'commodityClass', 'Class III');

    let u2 = createUnitDraft('unit-2', 'Euro Pallet');
    u2 = setUnitKnown(u2, 'palletWidthIn', 31.5);
    u2 = setUnitKnown(u2, 'palletDepthIn', 47.2);
    u2 = setUnitKnown(u2, 'palletHeightIn', 55);
    u2 = setUnitKnown(u2, 'palletWeightLb', 1500);
    u2 = setUnitKnown(u2, 'palletOverhangIn', 1.5);
    u2 = setUnitKnown(u2, 'palletsPerBay', 3);
    u2 = setUnitKnown(u2, 'targetLevels', 5);
    u2 = setUnitKnown(u2, 'commodityClass', 'Class II');

    const serialized = toUnitsApiPayload([u1, u2]);
    expect(serialized.units).toHaveLength(2);
    expect(serialized.units[0]?.['unit_id']).toBe('unit-1');
    expect(serialized.units[0]?.['width_um']).toBe(Math.round(40 * 25400));
    expect(serialized.units[0]?.['weight_lb']).toBe(2000);

    expect(serialized.units[1]?.['unit_id']).toBe('unit-2');
    expect(serialized.units[1]?.['width_um']).toBe(Math.round(31.5 * 25400));
    expect(serialized.units[1]?.['weight_lb']).toBe(1500);
  });

  it('converts facility draft to API payload with µm units and null for unknown values', () => {
    let draft = emptyFacilityDraft();
    draft = setFacilityKnown(draft, 'facilityName', 'Pacific Gateway DC');
    draft = setFacilityKnown(draft, 'clearHeightIn', 360);
    draft = setFacilityKnown(draft, 'envelopeWidthFt', 200);
    draft = setFacilityKnown(draft, 'envelopeDepthFt', 150);
    draft = setFacilityKnown(draft, 'columnGridXIn', 540);
    draft = setFacilityKnown(draft, 'columnGridYIn', 480);
    draft = setFacilityKnown(draft, 'dockCount', 8);
    draft = setFacilityKnown(draft, 'forkliftModel', 'Crown RR 5700');
    draft = setFacilityKnown(draft, 'forkliftAisleIn', 114);

    const payload = toFacilityApiPayload(draft);
    expect(payload['name']).toBe('Pacific Gateway DC');
    expect(payload['clear_height_um']).toBe(360 * 25400);
    expect(payload['width_um']).toBe(200 * 304800);
    expect(payload['depth_um']).toBe(150 * 304800);
    expect(payload['column_grid']).toEqual({
      pitch_x_um: 540 * 25400,
      pitch_y_um: 480 * 25400,
    });
    expect(payload['forklift']).toEqual({
      model_stated: true,
      required_aisle_um: 114 * 25400,
    });
    expect(payload['dock_count']).toBe(8);

    // If marked not known, payload sends null
    let unknownDraft = emptyFacilityDraft();
    unknownDraft = setFacilityNotKnown(unknownDraft, 'clearHeightIn');
    unknownDraft = setFacilityNotKnown(unknownDraft, 'columnGridXIn');
    unknownDraft = setFacilityNotKnown(unknownDraft, 'forkliftModel');
    const unknownPayload = toFacilityApiPayload(unknownDraft);
    expect(unknownPayload['clear_height_um']).toBeNull();
    expect(unknownPayload['column_grid']).toBeNull();
    expect(unknownPayload['forklift']).toEqual({ model_stated: false });
  });

  it('clears a field back to unanswered, distinct from not known', () => {
    let draft = setFacilityKnown(emptyFacilityDraft(), 'clearHeightIn', 384);
    expect(draft.clearHeightIn.state).toBe('known');
    draft = clearFacilityField(draft, 'clearHeightIn');
    expect(draft.clearHeightIn.state).toBe('empty');

    let unit = setUnitKnown(createUnitDraft('u1'), 'palletWeightLb', 2000);
    expect(unit.palletWeightLb.state).toBe('known');
    unit = clearUnitField(unit, 'palletWeightLb');
    expect(unit.palletWeightLb.state).toBe('empty');
  });

  it('never mutates drafts in place', () => {
    const original = emptyFacilityDraft();
    const next = setFacilityKnown(original, 'clearHeightIn', 384);
    expect(original.clearHeightIn.state).toBe('empty');
    expect(next.clearHeightIn.state).toBe('known');
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe('Facility API Client (facility-client.ts)', () => {
  it('posts facility draft and returns revision status on 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'rev-1',
        code: 'P01',
        iteration: 1,
        frozen: false,
      }),
    });

    const res = await saveFacilityDraft('rev-1', { width_um: 10000000 }, mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/client/v1/revisions/rev-1/facility',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.code).toBe('P01');
  });

  it('posts units draft and returns revision status on 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'rev-1',
        code: 'P01',
        iteration: 1,
        frozen: false,
      }),
    });

    const res = await saveUnitsDraft('rev-1', { units: [{ unit_id: 'u1' }] }, mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/client/v1/revisions/rev-1/units',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.iteration).toBe(1);
  });

  it('throws FacilityApiError with code and message on HTTP 400 validation error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'VALIDATION_ERROR', message: 'facility dimensions must be positive integers' },
      }),
    });

    await expect(
      saveFacilityDraft('rev-1', { width_um: 0 }, mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(FacilityApiError);

    try {
      await saveFacilityDraft('rev-1', { width_um: 0 }, mockFetch as unknown as typeof fetch);
    } catch (e) {
      const err = e as FacilityApiError;
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toMatch(/positive integers/);
    }
  });

  it('surfaces 422 immutable revision refusal cleanly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: { code: 'UNPROCESSABLE', message: 'revision is FROZEN and cannot be modified' },
      }),
    });

    try {
      await saveUnitsDraft('rev-1', { units: [] }, mockFetch as unknown as typeof fetch);
    } catch (e) {
      const err = e as FacilityApiError;
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('UNPROCESSABLE');
      expect(err.message).toMatch(/cannot be modified/);
    }
  });

  it('fetches revision preview on GET', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        revision_id: 'rev-1',
        counts: { gross_positions: 100, lost_positions: 0, net_positions: 100 },
        assumptions: [],
        findings: [],
      }),
    });

    const preview = await fetchRevisionPreview('rev-1', mockFetch as unknown as typeof fetch);
    expect(preview['revision_id']).toBe('rev-1');
  });
});

describe('FieldInput Component', () => {
  it('renders label, help text, and who-can-answer guidance', () => {
    render(
      <FieldInput
        id="clearHeightIn"
        label="Building clear height"
        help="Floor to lowest obstruction."
        whoCanAnswer="Facilities manager or architectural drawings."
        unit="in"
        type="number"
        value={{ state: 'empty' }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Building clear height/)).toBeDefined();
    expect(screen.getByText('(in)')).toBeDefined();
    expect(screen.getByText('Floor to lowest obstruction.')).toBeDefined();
    expect(screen.getByText('Facilities manager or architectural drawings.')).toBeDefined();
    expect(screen.getByRole('button', { name: /Mark Building clear height as not known/ })).not.toBeNull();
  });

  it('refuses entering 0 or negative measurements inline', () => {
    const onChange = vi.fn();
    render(
      <FieldInput
        id="clearHeightIn"
        label="Building clear height"
        help="Floor to lowest obstruction."
        whoCanAnswer="Facilities manager."
        unit="in"
        type="number"
        value={{ state: 'empty' }}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '0' } });

    expect(
      screen.getByText(/A measurement must be greater than zero. If the value is not available, mark the field NOT KNOWN/),
    ).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    // Entering negative also refuses
    fireEvent.change(input, { target: { value: '-15' } });
    expect(screen.getByRole('alert')).not.toBeNull();

    // Entering positive updates value
    fireEvent.change(input, { target: { value: '384' } });
    expect(onChange).toHaveBeenCalledWith({ state: 'known', value: 384 });
  });

  it('toggles to NOT KNOWN, shows badge and context note input, and permits restoration', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FieldInput
        id="clearHeightIn"
        label="Building clear height"
        help="Floor to lowest obstruction."
        whoCanAnswer="Facilities manager."
        unit="in"
        type="number"
        value={{ state: 'empty' }}
        onChange={onChange}
      />,
    );

    const markBtn = screen.getByRole('button', { name: /Mark Building clear height as not known/ });
    fireEvent.click(markBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'not_known' }),
    );

    // Rerender with not_known state
    rerender(
      <FieldInput
        id="clearHeightIn"
        label="Building clear height"
        help="Floor to lowest obstruction."
        whoCanAnswer="Facilities manager."
        unit="in"
        type="number"
        value={{ state: 'not_known', note: 'Awaiting survey report' }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('NOT KNOWN')).not.toBeNull();
    const noteInput = screen.getByDisplayValue('Awaiting survey report');
    expect(noteInput).not.toBeNull();

    // Click "Enter value" to clear not_known
    const enterValBtn = screen.getByRole('button', { name: /Enter value for Building clear height/ });
    fireEvent.click(enterValBtn);
    expect(onChange).toHaveBeenCalledWith({ state: 'empty' });
  });
});

describe('FindingsPanel Component', () => {
  it('renders summary counts, readiness banner, and filters findings', () => {
    const findings = [
      {
        id: 'facility.clearHeightIn',
        scope: 'facility' as const,
        fieldKey: 'clearHeightIn',
        label: 'Building clear height',
        kind: 'not_known' as const,
        note: 'Laser measure pending',
        whoCanAnswer: 'Facilities manager',
      },
      {
        id: 'facility.columnGridXIn',
        scope: 'facility' as const,
        fieldKey: 'columnGridXIn',
        label: 'Column grid spacing (across)',
        kind: 'not_answered' as const,
        whoCanAnswer: 'Structural drawings',
      },
    ];

    const { rerender } = render(<FindingsPanel findings={findings} isReady={false} />);

    expect(screen.getByText('1 Needs Answer')).not.toBeNull();
    expect(screen.getByText('1 Not Known')).not.toBeNull();
    expect(screen.getByText(/Awaiting required answers/)).not.toBeNull();

    // Filter to Not Known
    fireEvent.click(screen.getByRole('tab', { name: /Not Known \(1\)/ }));
    expect(screen.getByText('Building clear height')).not.toBeNull();
    expect(screen.queryByText('Column grid spacing (across)')).toBeNull();

    // Rerender as ready
    rerender(<FindingsPanel findings={findings} isReady={true} />);
    expect(screen.getByText(/Ready to proceed/)).not.toBeNull();
  });
});

describe('FacilityForm Component', () => {
  it('renders general, envelope, structural, and equipment fieldsets and responds to edits', () => {
    const onChange = vi.fn();
    const draft = emptyFacilityDraft();

    render(<FacilityForm draft={draft} onChange={onChange} />);

    expect(screen.getByText('General Identification')).not.toBeNull();
    expect(screen.getByText('Dimensional Envelope')).not.toBeNull();
    expect(screen.getByText('Column Grid & Dock Geometry')).not.toBeNull();
    expect(screen.getByText('Handling Equipment & Life Safety')).not.toBeNull();

    // Mark clear height as not known
    const markBtn = screen.getByRole('button', { name: /Mark Building clear height as not known/ });
    fireEvent.click(markBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        clearHeightIn: expect.objectContaining({ state: 'not_known' }),
      }),
    );
  });
});

describe('UnitForm Component', () => {
  it('manages multiple handling units with tabs and independent fields', () => {
    const onChange = vi.fn();
    const u1 = createUnitDraft('unit-1', 'Standard GMA');
    const u2 = createUnitDraft('unit-2', 'Bulk Drum');

    render(<UnitForm units={[u1, u2]} onChange={onChange} />);

    expect(screen.getByRole('tab', { name: 'Standard GMA' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Bulk Drum' })).not.toBeNull();

    // Click "+ Add Unit"
    const addBtn = screen.getByRole('button', { name: /Add another handling unit/ });
    fireEvent.click(addBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-1' }),
        expect.objectContaining({ unitId: 'unit-2' }),
        expect.objectContaining({ unitId: 'unit-3' }),
      ]),
    );
  });
});

describe('FacilityRoute Component (/facility)', () => {
  it('renders facility form, tabbed navigation, and dispatches draft save to API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: '00000000-0000-0000-0000-000000000001',
        code: 'P01',
        iteration: 1,
        frozen: false,
      }),
    });

    render(<FacilityRoute fetchImpl={mockFetch as unknown as typeof fetch} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Facility' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '1. Facility Envelope' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /2. Handling Units/ })).not.toBeNull();

    // Click Save Draft
    const saveBtn = screen.getByRole('button', { name: 'Save facility and unit configuration' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/facility'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/units'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Draft updated successfully/)).not.toBeNull();
    });
  });

  it('switches between tabs to display facility envelope, unit profiles, and findings', () => {
    render(<FacilityRoute />);

    const unitTab = screen.getByRole('tab', { name: /2. Handling Units/ });
    fireEvent.click(unitTab);
    expect(screen.getByRole('heading', { level: 2, name: /Handling Units & Operational Loads/ })).not.toBeNull();

    const findingsTab = screen.getByRole('tab', { name: /3. Findings & Readiness/ });
    fireEvent.click(findingsTab);
    expect(screen.getAllByRole('heading', { level: 2, name: 'Site Findings & Readiness' })[0]).not.toBeNull();
  });
});
