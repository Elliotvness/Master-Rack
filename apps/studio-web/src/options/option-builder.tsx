import { useState } from 'react';
import { DemoBeat5Widget } from './demo-beat-5.js';
import { OptionEditor } from './option-editor.js';
import { OptionsList } from './options-list.js';
import { saveOptionsDraft, type SaveOptionsResult } from './options-client.js';
import {
  createDefaultOption,
  createInitialOptions,
  duplicateOption,
  isOptionReady,
  toOptionsApiPayload,
  type OptionConfig,
} from './options-model.js';
import { selectSpan, PUBLISHED_BEAM_SPANS_IN } from './options-model.js';

interface OptionBuilderProps {
  readonly revisionId: string;
  readonly onSaveSuccess?: ((result: SaveOptionsResult) => void) | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

function nextOptionId(existing: readonly OptionConfig[]): string {
  let max = 0;
  for (const opt of existing) {
    const match = /^opt-(\d+)$/.exec(opt.id);
    if (match?.[1]) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `opt-${max + 1}`;
}

/**
 * Option Builder Container (Blueprint §15.2 Step 4, §15.3 D-03).
 *
 * Allows clients to configure, duplicate, and compare selective pallet rack options
 * over the controlled vocabulary, and enforces the Demo Beat 5 refusal requirement.
 */
export function OptionBuilder({
  revisionId,
  onSaveSuccess,
  fetchImpl,
}: OptionBuilderProps): React.JSX.Element {
  const [options, setOptions] = useState<readonly OptionConfig[]>(createInitialOptions);
  const [activeOptionId, setActiveOptionId] = useState<string>(() => options[0]?.id ?? 'opt-1');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const activeOption = options.find((o) => o.id === activeOptionId) ?? options[0];

  const handleUpdateActive = (updated: OptionConfig): void => {
    setOptions((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    setSaveStatus(null);
  };

  const handleAddOption = (): void => {
    const nextIdx = options.length + 1;
    const newId = nextOptionId(options);
    const newLabel = `Option ${String.fromCharCode(64 + nextIdx)}: New Layout`;
    const newOpt = createDefaultOption(newId, newLabel, activeOption?.unitId ?? 'unit-1');
    setOptions((prev) => [...prev, newOpt]);
    setActiveOptionId(newId);
    setSaveStatus(null);
  };

  const handleDuplicateOption = (id: string): void => {
    const target = options.find((o) => o.id === id);
    if (!target) return;
    const newId = nextOptionId(options);
    const newLabel = `${target.label} (Copy)`;
    const copy = duplicateOption(target, newId, newLabel);
    setOptions((prev) => [...prev, copy]);
    setActiveOptionId(newId);
    setSaveStatus(null);
  };

  const handleDeleteOption = (id: string): void => {
    if (options.length <= 1) return;
    const remaining = options.filter((o) => o.id !== id);
    setOptions(remaining);
    if (activeOptionId === id) {
      setActiveOptionId(remaining[0]?.id ?? '');
    }
    setSaveStatus(null);
  };

  const handleApplySpanFromDemo = (spanIn: number): void => {
    if (!activeOption) return;
    handleUpdateActive({
      ...activeOption,
      span: selectSpan(PUBLISHED_BEAM_SPANS_IN, spanIn),
    });
  };

  const allValid = options.length > 0 && options.every(isOptionReady);

  const handleSave = async (): Promise<void> => {
    if (!revisionId || !allValid) return;
    setSaving(true);
    setSaveStatus(null);

    try {
      const payload = toOptionsApiPayload(options, activeOptionId);
      const res = await saveOptionsDraft(revisionId, payload, fetchImpl);
      setSaveStatus({
        ok: true,
        message: `Successfully saved ${options.length} options to revision ${res.code || revisionId}.`,
      });
      onSaveSuccess?.(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save options draft.';
      setSaveStatus({ ok: false, message: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="option-builder-layout" data-testid="option-builder">
      <div className="option-builder-sidebar">
        <DemoBeat5Widget onApplySpan={handleApplySpanFromDemo} />
      </div>

      <div className="option-builder-main">
        <div className="builder-header-panel">
          <OptionsList
            options={options}
            activeOptionId={activeOptionId}
            onSelectOption={setActiveOptionId}
            onAddOption={handleAddOption}
            onDuplicateOption={handleDuplicateOption}
            onDeleteOption={handleDeleteOption}
          />
        </div>

        {activeOption ? (
          <div className="builder-editor-container">
            <OptionEditor option={activeOption} onChange={handleUpdateActive} />
          </div>
        ) : (
          <div className="empty-state">No options available. Add an option to begin.</div>
        )}

        <div className="builder-save-panel">
          <div className="save-status-area">
            {saveStatus && (
              <div
                className={`alert ${saveStatus.ok ? 'alert-success' : 'alert-danger'}`}
                role={saveStatus.ok ? 'status' : 'alert'}
                data-testid="save-status-alert"
              >
                {saveStatus.message}
              </div>
            )}
          </div>

          <div className="save-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || !allValid || !revisionId}
              onClick={handleSave}
              data-testid="save-options-btn"
            >
              {saving ? 'Saving Options…' : 'Save Options to Revision'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
