import { useState } from 'react';
import { PUBLISHED_BEAM_SPANS_IN } from './catalog-vocabulary.js';
import { selectSpan, type SpanSelection } from './options-model.js';
import { StatusBadge } from '../components/badge.js';

interface DemoBeat5Props {
  readonly onApplySpan?: (spanIn: number) => void;
}

/**
 * Demo Beat 5 Widget (Blueprint §15.2 Step 4, §15.3 D-03).
 *
 * Demonstrates the engine's core invariant:
 * "A client tries a 110″ beam. The tool refuses, states that the published grid
 *  brackets it at 108″ and 114″, and explains that it does not interpolate."
 */
export function DemoBeat5Widget({ onApplySpan }: DemoBeat5Props): React.JSX.Element {
  const [testInput, setTestInput] = useState<string>('110');
  const [selection, setSelection] = useState<SpanSelection>(() =>
    selectSpan(PUBLISHED_BEAM_SPANS_IN, 110),
  );

  const handleTest = (raw: string): void => {
    setTestInput(raw);
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) {
      setSelection(selectSpan(PUBLISHED_BEAM_SPANS_IN, n));
    } else {
      setSelection({ state: 'unset' });
    }
  };

  const handleApplyPreset = (value: number): void => {
    handleTest(String(value));
  };

  return (
    <div className="demo-beat-5-card" data-testid="demo-beat-5-card">
      <div className="demo-beat-5-header">
        <div className="demo-beat-5-title-row">
          <h4>Demo Beat 5 — Beam Grid Refusal Test</h4>
          <span className="demo-badge">§15.3 D-03 Verification</span>
        </div>
        <p className="demo-beat-5-subtitle">
          Test uncatalogued or off-grid beam lengths. The engine strictly refuses non-published
          lengths and surfaces published brackets without interpolation.
        </p>
      </div>

      <div className="demo-beat-5-controls">
        <label htmlFor="demo-span-input" className="demo-label">
          Test Beam Span (inches):
        </label>
        <div className="demo-input-row">
          <input
            id="demo-span-input"
            type="number"
            className="input-field demo-input"
            value={testInput}
            onChange={(e) => handleTest(e.target.value)}
            placeholder="e.g. 110"
            min={1}
            step="any"
            data-testid="demo-span-input"
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleApplyPreset(110)}
            data-testid="preset-110-btn"
          >
            Try 110″ Beam
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleApplyPreset(108)}
          >
            Try 108″ (Published)
          </button>
        </div>
      </div>

      <div className="demo-beat-5-result" data-testid="demo-beat-5-result">
        {selection.state === 'refused' && (
          <div className="refusal-box alert alert-refusal" role="alert" data-testid="off-grid-refusal">
            <div className="refusal-header">
              <StatusBadge tone="block">Refused: Off-Grid Span</StatusBadge>
              <strong className="refusal-heading">Non-Interpolated Grid Refusal</strong>
            </div>
            <p className="refusal-text" data-testid="refusal-explanation">
              {selection.explanation}
            </p>
            {(selection.lowerIn !== null || selection.upperIn !== null) && (
              <div className="bracket-actions">
                <span className="bracket-prompt">Choose an official published bracket instead:</span>
                <div className="bracket-buttons">
                  {selection.lowerIn !== null && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        handleApplyPreset(selection.lowerIn!);
                        onApplySpan?.(selection.lowerIn!);
                      }}
                      data-testid="apply-lower-bracket-btn"
                    >
                      Use Lower: {selection.lowerIn}″
                    </button>
                  )}
                  {selection.upperIn !== null && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        handleApplyPreset(selection.upperIn!);
                        onApplySpan?.(selection.upperIn!);
                      }}
                      data-testid="apply-upper-bracket-btn"
                    >
                      Use Upper: {selection.upperIn}″
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {selection.state === 'selected' && (
          <div className="accepted-box alert alert-success" role="status" data-testid="on-grid-accepted">
            <div className="accepted-header">
              <StatusBadge tone="pass">Published Beam Span</StatusBadge>
              <strong>{selection.spanIn}″ is an approved published catalog span</strong>
            </div>
            <p className="accepted-text">
              Capacity and deflection are certified from the pinned Interlake 2026-08 release table.
            </p>
            {onApplySpan && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onApplySpan(selection.spanIn)}
                data-testid="apply-active-span-btn"
              >
                Apply to Current Option
              </button>
            )}
          </div>
        )}

        {selection.state === 'unset' && (
          <p className="hint-text">Enter a span in inches to test the engine refusal response.</p>
        )}
      </div>
    </div>
  );
}
