import { useState, type JSX } from 'react';
import { Button } from '../components/button.js';
import { FieldInput } from './field-input.js';
import {
  UNIT_FIELD_SPECS,
  createUnitDraft,
  setUnitKnown,
  setUnitNotKnown,
  clearUnitField,
  type UnitDraft,
  type UnitFieldKey,
  type FieldValue,
} from './facility-model.js';

export interface UnitFormProps {
  readonly units: readonly UnitDraft[];
  readonly onChange: (nextUnits: readonly UnitDraft[]) => void;
  readonly disabled?: boolean | undefined;
}

export function UnitForm({
  units,
  onChange,
  disabled = false,
}: UnitFormProps): JSX.Element {
  const [activeUnitId, setActiveUnitId] = useState<string>(units[0]?.unitId ?? 'unit-1');

  const activeUnit = units.find((u) => u.unitId === activeUnitId) ?? units[0];

  const handleAddUnit = (): void => {
    const nextIdx = units.length + 1;
    const newId = `unit-${nextIdx}`;
    const newUnit = createUnitDraft(newId, `Unit ${nextIdx}`);
    const updated = [...units, newUnit];
    onChange(updated);
    setActiveUnitId(newId);
  };

  const handleRemoveUnit = (idToRemove: string): void => {
    if (units.length <= 1) return;
    const updated = units.filter((u) => u.unitId !== idToRemove);
    onChange(updated);
    if (activeUnitId === idToRemove) {
      setActiveUnitId(updated[0]?.unitId ?? 'unit-1');
    }
  };

  const handleFieldChange = (key: UnitFieldKey, next: FieldValue<unknown>): void => {
    if (activeUnit === undefined) return;
    const updatedUnit =
      next.state === 'known'
        ? setUnitKnown(activeUnit, key, next.value as never)
        : next.state === 'not_known'
          ? setUnitNotKnown(activeUnit, key, next.note)
          : clearUnitField(activeUnit, key);

    const updatedUnits = units.map((u) => (u.unitId === activeUnit.unitId ? updatedUnit : u));
    onChange(updatedUnits);
  };

  if (activeUnit === undefined) {
    return <div className="unit-editor-empty">No units configured. Click Add Unit.</div>;
  }

  const footprintSpecs = UNIT_FIELD_SPECS.filter(
    (s) => s.id === 'palletWidthIn' || s.id === 'palletDepthIn' || s.id === 'palletHeightIn',
  );
  const loadingSpecs = UNIT_FIELD_SPECS.filter(
    (s) => s.id === 'palletWeightLb' || s.id === 'palletOverhangIn',
  );
  const rackSpecs = UNIT_FIELD_SPECS.filter(
    (s) => s.id === 'palletsPerBay' || s.id === 'targetLevels' || s.id === 'commodityClass',
  );

  return (
    <div className="unit-editor-section" id="unit-editor">
      <header className="section-header">
        <div className="section-header-top">
          <div>
            <h2 className="section-title">Handling Units & Operational Loads</h2>
            <p className="section-subtitle">
              Configure pallet footprints, gross weights, and storage density per unit type (FR-CP-02, FR-CP-03).
            </p>
          </div>
          <Button
            variant="chrome"
            className="btn-add-unit"
            onClick={handleAddUnit}
            disabled={disabled}
            aria-label="Add another handling unit"
          >
            + Add Unit
          </Button>
        </div>

        <nav className="unit-tabs-nav" aria-label="Handling unit profiles" role="tablist">
          {units.map((u) => {
            const isTabActive = u.unitId === activeUnit.unitId;
            const tabName = u.unitName.state === 'known' ? u.unitName.value : u.unitId;
            return (
              <button
                key={u.unitId}
                type="button"
                role="tab"
                aria-selected={isTabActive}
                className={`unit-tab-btn ${isTabActive ? 'active' : ''}`}
                onClick={() => setActiveUnitId(u.unitId)}
                id={`tab-${u.unitId}`}
              >
                {tabName}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="active-unit-card" id={`panel-${activeUnit.unitId}`} role="tabpanel">
        <div className="active-unit-header">
          <FieldInput
            id={`unitName-${activeUnit.unitId}`}
            label="Unit Profile Name"
            help="Descriptive name for this pallet profile (e.g. Standard GMA, Beverage Bulk)."
            whoCanAnswer="Packaging or warehousing team."
            type="text"
            value={activeUnit.unitName}
            onChange={(next) => handleFieldChange('unitName', next)}
            disabled={disabled}
          />
          {units.length > 1 && (
            <Button
              variant="danger"
              className="btn-remove-unit"
              onClick={() => handleRemoveUnit(activeUnit.unitId)}
              disabled={disabled}
              aria-label={`Remove unit ${activeUnit.unitId}`}
            >
              Remove Unit
            </Button>
          )}
        </div>

        <fieldset className="form-fieldset" id={`fieldset-footprint-${activeUnit.unitId}`}>
          <legend className="fieldset-legend">Pallet Footprint & Height</legend>
          <div className="fields-grid">
            {footprintSpecs.map((spec) => (
              <FieldInput
                key={spec.id}
                id={`${spec.id}-${activeUnit.unitId}`}
                label={spec.label}
                help={spec.help}
                whoCanAnswer={spec.whoCanAnswer}
                unit={spec.unit}
                type={spec.type}
                value={activeUnit[spec.id]}
                onChange={(next) => handleFieldChange(spec.id, next)}
                disabled={disabled}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="form-fieldset" id={`fieldset-loading-${activeUnit.unitId}`}>
          <legend className="fieldset-legend">Weight & Clearance</legend>
          <div className="fields-grid">
            {loadingSpecs.map((spec) => (
              <FieldInput
                key={spec.id}
                id={`${spec.id}-${activeUnit.unitId}`}
                label={spec.label}
                help={spec.help}
                whoCanAnswer={spec.whoCanAnswer}
                unit={spec.unit}
                type={spec.type}
                value={activeUnit[spec.id]}
                onChange={(next) => handleFieldChange(spec.id, next)}
                disabled={disabled}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="form-fieldset" id={`fieldset-rack-${activeUnit.unitId}`}>
          <legend className="fieldset-legend">Storage Density & Fire Protection</legend>
          <div className="fields-grid">
            {rackSpecs.map((spec) => (
              <FieldInput
                key={spec.id}
                id={`${spec.id}-${activeUnit.unitId}`}
                label={spec.label}
                help={spec.help}
                whoCanAnswer={spec.whoCanAnswer}
                unit={spec.unit}
                type={spec.type}
                value={activeUnit[spec.id]}
                onChange={(next) => handleFieldChange(spec.id, next)}
                disabled={disabled}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
