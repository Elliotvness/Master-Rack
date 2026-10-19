import type { OptionConfig } from './options-model.js';
import { isOptionReady } from './options-model.js';
import { StatusBadge } from '../components/badge.js';

interface OptionsListProps {
  readonly options: readonly OptionConfig[];
  readonly activeOptionId: string;
  readonly onSelectOption: (id: string) => void;
  readonly onAddOption: () => void;
  readonly onDuplicateOption: (id: string) => void;
  readonly onDeleteOption: (id: string) => void;
}

/**
 * Tab bar and management actions for multi-option configurations (FR-CP-04).
 */
export function OptionsList({
  options,
  activeOptionId,
  onSelectOption,
  onAddOption,
  onDuplicateOption,
  onDeleteOption,
}: OptionsListProps): React.JSX.Element {
  return (
    <div className="options-tabs-container" data-testid="options-list">
      <div className="options-tabs-header">
        <div className="options-tabs-nav" role="tablist" aria-label="Configuration Options">
          {options.map((opt, idx) => {
            const isActive = opt.id === activeOptionId;
            const ready = isOptionReady(opt);

            return (
              <button
                key={opt.id}
                role="tab"
                id={`tab-option-${opt.id}`}
                aria-selected={isActive}
                aria-controls={`panel-option-${opt.id}`}
                className={`tab-btn option-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => onSelectOption(opt.id)}
                data-testid={`option-tab-${opt.id}`}
              >
                <span className="tab-title">
                  {opt.label || `Option ${idx + 1}`}
                </span>
                <span className="tab-indicator">
                  <StatusBadge tone={ready ? 'pass' : 'block'}>
                    {ready ? 'Valid' : 'Incomplete'}
                  </StatusBadge>
                </span>
              </button>
            );
          })}
        </div>

        <div className="options-tab-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onAddOption}
            data-testid="add-option-btn"
            title="Create a new configuration option"
          >
            + Add Option
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onDuplicateOption(activeOptionId)}
            data-testid="duplicate-option-btn"
            title="Duplicate the selected option"
          >
            Duplicate
          </button>
          {options.length > 1 && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => onDeleteOption(activeOptionId)}
              data-testid="delete-option-btn"
              title="Delete the selected option"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="options-meta-bar">
        <span className="options-count-badge">
          {options.length} {options.length === 1 ? 'Option' : 'Options'} Configured
          {options.length >= 2 && ' (Meets Blueprint §15.2 Step 4 requirement)'}
        </span>
      </div>
    </div>
  );
}
