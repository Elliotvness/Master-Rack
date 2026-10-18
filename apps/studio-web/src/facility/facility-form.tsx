import type { JSX } from 'react';
import { FieldInput } from './field-input.js';
import {
  FACILITY_FIELD_SPECS,
  setFacilityKnown,
  setFacilityNotKnown,
  clearFacilityField,
  type FacilityDraft,
  type FacilityFieldKey,
  type FieldValue,
} from './facility-model.js';

export interface FacilityFormProps {
  readonly draft: FacilityDraft;
  readonly onChange: (next: FacilityDraft) => void;
  readonly disabled?: boolean | undefined;
}

export function FacilityForm({
  draft,
  onChange,
  disabled = false,
}: FacilityFormProps): JSX.Element {
  const handleFieldChange = (key: FacilityFieldKey, next: FieldValue<unknown>): void => {
    if (next.state === 'known') {
      onChange(setFacilityKnown(draft, key, next.value as never));
    } else if (next.state === 'not_known') {
      onChange(setFacilityNotKnown(draft, key, next.note));
    } else {
      onChange(clearFacilityField(draft, key));
    }
  };

  const generalSpecs = FACILITY_FIELD_SPECS.filter(
    (s) => s.id === 'facilityName' || s.id === 'facilityAddress',
  );
  const dimensionalSpecs = FACILITY_FIELD_SPECS.filter(
    (s) =>
      s.id === 'clearHeightIn' ||
      s.id === 'envelopeWidthFt' ||
      s.id === 'envelopeDepthFt' ||
      s.id === 'slabThicknessIn',
  );
  const structuralSpecs = FACILITY_FIELD_SPECS.filter(
    (s) => s.id === 'columnGridXIn' || s.id === 'columnGridYIn' || s.id === 'dockCount',
  );
  const equipmentSpecs = FACILITY_FIELD_SPECS.filter(
    (s) => s.id === 'forkliftModel' || s.id === 'forkliftAisleIn' || s.id === 'sprinklered',
  );

  return (
    <div className="facility-editor-section" id="facility-editor">
      <header className="section-header">
        <h2 className="section-title">Facility Information & Site Envelope</h2>
        <p className="section-subtitle">
          Record building dimensions and column geometry. Every field can be marked{' '}
          <strong>NOT KNOWN</strong> to generate an actionable finding rather than an arbitrary default.
        </p>
      </header>

      <fieldset className="form-fieldset" id="fieldset-general">
        <legend className="fieldset-legend">General Identification</legend>
        <div className="fields-grid">
          {generalSpecs.map((spec) => (
            <FieldInput
              key={spec.id}
              id={spec.id}
              label={spec.label}
              help={spec.help}
              whoCanAnswer={spec.whoCanAnswer}
              unit={spec.unit}
              type={spec.type}
              value={draft[spec.id]}
              onChange={(next) => handleFieldChange(spec.id, next)}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="form-fieldset" id="fieldset-envelope">
        <legend className="fieldset-legend">Dimensional Envelope</legend>
        <div className="fields-grid">
          {dimensionalSpecs.map((spec) => (
            <FieldInput
              key={spec.id}
              id={spec.id}
              label={spec.label}
              help={spec.help}
              whoCanAnswer={spec.whoCanAnswer}
              unit={spec.unit}
              type={spec.type}
              value={draft[spec.id]}
              onChange={(next) => handleFieldChange(spec.id, next)}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="form-fieldset" id="fieldset-structural">
        <legend className="fieldset-legend">Column Grid & Dock Geometry</legend>
        <div className="fields-grid">
          {structuralSpecs.map((spec) => (
            <FieldInput
              key={spec.id}
              id={spec.id}
              label={spec.label}
              help={spec.help}
              whoCanAnswer={spec.whoCanAnswer}
              unit={spec.unit}
              type={spec.type}
              value={draft[spec.id]}
              onChange={(next) => handleFieldChange(spec.id, next)}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="form-fieldset" id="fieldset-equipment">
        <legend className="fieldset-legend">Handling Equipment & Life Safety</legend>
        <div className="fields-grid">
          {equipmentSpecs.map((spec) => (
            <FieldInput
              key={spec.id}
              id={spec.id}
              label={spec.label}
              help={spec.help}
              whoCanAnswer={spec.whoCanAnswer}
              unit={spec.unit}
              type={spec.type}
              value={draft[spec.id]}
              onChange={(next) => handleFieldChange(spec.id, next)}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
