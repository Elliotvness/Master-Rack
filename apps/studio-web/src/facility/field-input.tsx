import { useState, type ChangeEvent, type JSX } from 'react';
import { Button } from '../components/button.js';
import { StatusBadge } from '../components/badge.js';
import type { FieldValue } from './facility-model.js';

export interface FieldInputProps {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly whoCanAnswer: string;
  readonly unit?: string | undefined;
  readonly type?: 'number' | 'text' | 'boolean' | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly value: FieldValue<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly onChange: (next: FieldValue<any>) => void;
  readonly disabled?: boolean | undefined;
}

export function FieldInput({
  id,
  label,
  help,
  whoCanAnswer,
  unit,
  type = 'number',
  value,
  onChange,
  disabled = false,
}: FieldInputProps): JSX.Element {
  const [inlineRefusal, setInlineRefusal] = useState<string | null>(null);

  const handleTextChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setInlineRefusal(null);
    const raw = e.target.value;
    if (raw.trim() === '') {
      onChange({ state: 'empty' });
    } else {
      onChange({ state: 'known', value: raw });
    }
  };

  const handleNumberChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value.trim();
    if (raw === '') {
      setInlineRefusal(null);
      onChange({ state: 'empty' });
      return;
    }

    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setInlineRefusal('A measurement must be a finite number.');
      return;
    }

    if (n <= 0) {
      setInlineRefusal(
        'A measurement must be greater than zero. If the value is not available, mark the field NOT KNOWN rather than entering a zero.',
      );
      return;
    }

    setInlineRefusal(null);
    onChange({ state: 'known', value: n });
  };

  const handleBooleanChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    setInlineRefusal(null);
    const raw = e.target.value;
    if (raw === '') {
      onChange({ state: 'empty' });
    } else {
      onChange({ state: 'known', value: raw === 'true' });
    }
  };

  const handleMarkNotKnown = (): void => {
    setInlineRefusal(null);
    onChange({
      state: 'not_known',
      note: 'Marked not known by the client; no further detail supplied.',
    });
  };

  const handleNoteChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onChange({
      state: 'not_known',
      note: e.target.value,
    });
  };

  const handleClearNotKnown = (): void => {
    setInlineRefusal(null);
    onChange({ state: 'empty' });
  };

  const isNotKnown = value.state === 'not_known';
  const isKnown = value.state === 'known';
  const displayedVal = isKnown ? String(value.value) : '';

  return (
    <div className={`facility-field-row ${isNotKnown ? 'field-not-known' : ''}`} id={`field-row-${id}`}>
      <div className="field-header">
        <label htmlFor={`input-${id}`} className="field-label">
          {label}
          {unit !== undefined && <span className="field-unit"> ({unit})</span>}
        </label>
        <div className="field-actions">
          {isNotKnown ? (
            <div className="not-known-pill-group">
              <StatusBadge tone="warn" id={`badge-${id}`}>
                NOT KNOWN
              </StatusBadge>
              <Button
                variant="ghost"
                className="btn-enter-value"
                onClick={handleClearNotKnown}
                disabled={disabled}
                aria-label={`Enter value for ${label}`}
              >
                Enter value
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="btn-not-known"
              onClick={handleMarkNotKnown}
              disabled={disabled}
              aria-label={`Mark ${label} as not known`}
            >
              Mark Not Known
            </Button>
          )}
        </div>
      </div>

      <p className="field-help" id={`help-${id}`}>
        {help}
      </p>

      {isNotKnown ? (
        <div className="not-known-note-wrap">
          <label htmlFor={`note-${id}`} className="note-label">
            Context / reason why this is not known (optional):
          </label>
          <input
            id={`note-${id}`}
            type="text"
            className="input-field note-input"
            value={value.note}
            onChange={handleNoteChange}
            disabled={disabled}
            placeholder="e.g. Survey pending next Tuesday"
            aria-describedby={`who-${id}`}
          />
        </div>
      ) : (
        <div className="field-control-wrap">
          {type === 'boolean' ? (
            <select
              id={`input-${id}`}
              className="select-field"
              value={isKnown ? String(value.value) : ''}
              onChange={handleBooleanChange}
              disabled={disabled}
              aria-describedby={`help-${id} who-${id}`}
            >
              <option value="">— Select status —</option>
              <option value="true">Yes / Installed</option>
              <option value="false">No / None</option>
            </select>
          ) : (
            <input
              id={`input-${id}`}
              type={type === 'number' ? 'number' : 'text'}
              step={type === 'number' ? 'any' : undefined}
              className={`input-field ${type === 'number' ? 'pf-input-num' : ''}`}
              value={displayedVal}
              onChange={type === 'number' ? handleNumberChange : handleTextChange}
              disabled={disabled}
              placeholder={type === 'number' ? (unit !== undefined ? `Enter value (${unit})` : 'Enter value') : `Enter ${label.toLowerCase()}`}
              aria-describedby={`help-${id} who-${id}`}
              aria-invalid={inlineRefusal !== null || undefined}
            />
          )}
        </div>
      )}

      {inlineRefusal !== null && (
        <div className="field-refusal-alert" role="alert" id={`refusal-${id}`}>
          <span className="refusal-icon" aria-hidden="true">
            ✕
          </span>
          <span className="refusal-text">{inlineRefusal}</span>
        </div>
      )}

      <div className="who-can-answer" id={`who-${id}`}>
        <span className="who-label">Who can answer: </span>
        <span className="who-text">{whoCanAnswer}</span>
      </div>
    </div>
  );
}
