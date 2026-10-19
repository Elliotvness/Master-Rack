import {
  PUBLISHED_BEAM_FACES_IN,
  PUBLISHED_BEAM_SPANS_IN,
  PUBLISHED_FRAME_DEPTHS_IN,
  PUBLISHED_FRAME_HEIGHTS_IN,
  RACK_CONFIGURATIONS,
  type RackConfigurationType,
} from './catalog-vocabulary.js';
import type { OptionConfig } from './options-model.js';
import {
  getOptionBlockingReasons,
  selectBeamLevels,
  selectSpan,
  spanChoices,
} from './options-model.js';

interface OptionEditorProps {
  readonly option: OptionConfig;
  readonly onChange: (updated: OptionConfig) => void;
}

/**
 * Editor for configuring a selective pallet rack option over the controlled vocabulary (FR-CP-05).
 */
export function OptionEditor({ option, onChange }: OptionEditorProps): React.JSX.Element {
  const choices = spanChoices(PUBLISHED_BEAM_SPANS_IN);
  const currentSpan = option.span.state === 'selected' ? option.span.spanIn : 96;
  const currentLevels = option.levels.state === 'selected' ? option.levels.beamLevels : 4;
  const floorStores = option.levels.state === 'selected' ? option.levels.floorStores : true;
  const blockingReasons = getOptionBlockingReasons(option);

  const updateField = <K extends keyof OptionConfig>(field: K, value: OptionConfig[K]): void => {
    onChange({
      ...option,
      [field]: value,
    });
  };

  const handleSpanChange = (spanIn: number): void => {
    updateField('span', selectSpan(PUBLISHED_BEAM_SPANS_IN, spanIn));
  };

  const handleLevelsChange = (levels: number): void => {
    updateField('levels', selectBeamLevels(levels, floorStores));
  };

  const handleFloorStoresChange = (stores: boolean): void => {
    updateField('levels', selectBeamLevels(currentLevels, stores));
  };

  // Quick calculations for display summary
  const totalBays = option.runCount * option.baysPerRun;
  const levelsPerBay = currentLevels + (floorStores ? 1 : 0);
  const positionsPerBay = 2; // standard 2 pallets per bay for 96"–108"
  const totalPalletPositions = totalBays * levelsPerBay * positionsPerBay;

  return (
    <div className="option-editor" data-testid="option-editor">
      <div className="editor-section-card">
        <h4 className="editor-section-title">General Option Settings</h4>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="opt-label" className="form-label">
              Option Name / Description:
            </label>
            <input
              id="opt-label"
              type="text"
              className="input-field"
              value={option.label}
              onChange={(e) => updateField('label', e.target.value)}
              placeholder="e.g. Option A: 96″ 4-Level Standard"
              data-testid="option-label-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="opt-rack-type" className="form-label">
              Rack System Configuration:
            </label>
            <select
              id="opt-rack-type"
              className="select-field"
              value={option.rackType}
              onChange={(e) => updateField('rackType', e.target.value as RackConfigurationType)}
              data-testid="option-rack-type-select"
            >
              {RACK_CONFIGURATIONS.map((c) => (
                <option key={c.type} value={c.type}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {RACK_CONFIGURATIONS.find((c) => c.type === option.rackType)?.description}
            </span>
          </div>
        </div>
      </div>

      <div className="editor-section-card">
        <h4 className="editor-section-title">
          Controlled Vocabulary — Beam & Frame Sizing (Interlake 2026-08)
        </h4>
        <p className="section-note">
          Choices are restricted strictly to manufacturer-published dimensions. Free-text
          dimensional entry is disabled to prevent unrated load approximations.
        </p>

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="opt-beam-span" className="form-label">
              Published Beam Span (Clear Bay Width):
            </label>
            <select
              id="opt-beam-span"
              className="select-field"
              value={currentSpan}
              onChange={(e) => handleSpanChange(Number(e.target.value))}
              data-testid="option-beam-span-select"
            >
              {choices.map((c) => (
                <option key={c.spanIn} value={c.spanIn}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              Catalog certified. Non-published spans (e.g. 110″) are refused per Demo Beat 5.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="opt-beam-face" className="form-label">
              Beam Profile / Face Height:
            </label>
            <select
              id="opt-beam-face"
              className="select-field"
              value={option.beamFaceIn}
              onChange={(e) => updateField('beamFaceIn', Number(e.target.value))}
              data-testid="option-beam-face-select"
            >
              {PUBLISHED_BEAM_FACES_IN.map((face) => (
                <option key={face} value={face}>
                  {face}″ Roll-Formed Step Beam
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="opt-frame-depth" className="form-label">
              Frame Depth (Cross-Aisle):
            </label>
            <select
              id="opt-frame-depth"
              className="select-field"
              value={option.frameDepthIn}
              onChange={(e) => updateField('frameDepthIn', Number(e.target.value))}
              data-testid="option-frame-depth-select"
            >
              {PUBLISHED_FRAME_DEPTHS_IN.map((depth) => (
                <option key={depth} value={depth}>
                  {depth}″ {depth === 42 ? '(Industry Standard for 48″x40″ Pallets)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="opt-frame-height" className="form-label">
              Frame Upright Height:
            </label>
            <select
              id="opt-frame-height"
              className="select-field"
              value={option.frameHeightIn}
              onChange={(e) => updateField('frameHeightIn', Number(e.target.value))}
              data-testid="option-frame-height-select"
            >
              {PUBLISHED_FRAME_HEIGHTS_IN.map((height) => (
                <option key={height} value={height}>
                  {height}″ ({(height / 12).toFixed(1)} ft)
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="editor-section-card">
        <h4 className="editor-section-title">Vertical Storage Levels (Scope: OD-03)</h4>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="opt-beam-levels" className="form-label">
              Beam Levels Above Floor:
            </label>
            <select
              id="opt-beam-levels"
              className="select-field"
              value={currentLevels}
              onChange={(e) => handleLevelsChange(Number(e.target.value))}
              data-testid="option-beam-levels-select"
            >
              {[2, 3, 4, 5, 6].map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl} Beam Levels
                </option>
              ))}
            </select>
            <span className="field-hint">Scope is restricted to 2–6 beam levels per OD-03.</span>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={floorStores}
                onChange={(e) => handleFloorStoresChange(e.target.checked)}
                data-testid="option-floor-stores-checkbox"
              />
              <span>Include Floor Level Pallet Storage (Under 1st Beam Level)</span>
            </label>
          </div>
        </div>
      </div>

      <div className="editor-section-card">
        <h4 className="editor-section-title">Layout & Aisle Dimensions</h4>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="opt-aisle-width" className="form-label">
              Forklift Operating Aisle Width (inches):
            </label>
            <input
              id="opt-aisle-width"
              type="number"
              className="input-field"
              value={option.aisleWidthIn}
              onChange={(e) => updateField('aisleWidthIn', Number(e.target.value))}
              min={60}
              step={1}
              data-testid="option-aisle-width-input"
            />
            <span className="field-hint">120″ (10 ft) standard counterbalance clearance.</span>
          </div>

          <div className="form-group">
            <label htmlFor="opt-run-count" className="form-label">
              Number of Rack Runs:
            </label>
            <input
              id="opt-run-count"
              type="number"
              className="input-field"
              value={option.runCount}
              onChange={(e) => updateField('runCount', Math.max(1, Number(e.target.value)))}
              min={1}
              step={1}
              data-testid="option-run-count-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="opt-bays-per-run" className="form-label">
              Bays Per Run:
            </label>
            <input
              id="opt-bays-per-run"
              type="number"
              className="input-field"
              value={option.baysPerRun}
              onChange={(e) => updateField('baysPerRun', Math.max(1, Number(e.target.value)))}
              min={1}
              step={1}
              data-testid="option-bays-per-run-input"
            />
          </div>
        </div>
      </div>

      <div className="option-summary-card" data-testid="option-summary-card">
        <h5 className="summary-title">Option Capacity & Geometry Summary</h5>
        <div className="summary-grid">
          <div className="summary-metric">
            <span className="summary-label">Estimated Pallet Positions:</span>
            <span className="summary-value" data-testid="summary-pallet-positions">
              {totalPalletPositions} positions
            </span>
          </div>
          <div className="summary-metric">
            <span className="summary-label">Total Bays:</span>
            <span className="summary-value" data-testid="summary-total-bays">
              {totalBays} bays ({option.runCount} runs × {option.baysPerRun} bays)
            </span>
          </div>
          <div className="summary-metric">
            <span className="summary-label">Storage Elevation:</span>
            <span className="summary-value" data-testid="summary-levels">
              {levelsPerBay} total tiers ({currentLevels} beam levels +{' '}
              {floorStores ? 'floor' : 'no floor'})
            </span>
          </div>
          <div className="summary-metric">
            <span className="summary-label">Frame Specs:</span>
            <span className="summary-value">
              {option.frameDepthIn}″ D × {option.frameHeightIn}″ H
            </span>
          </div>
        </div>

        {blockingReasons.length > 0 && (
          <div className="option-blocking-alert alert alert-warning" role="alert">
            <strong>Configuration issues to resolve:</strong>
            <ul>
              {blockingReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
