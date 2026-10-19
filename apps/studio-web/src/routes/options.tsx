import { useState, type JSX } from 'react';
import { useToasts } from '../components/toast.js';
import { OptionBuilder } from '../options/option-builder.js';
import type { SaveOptionsResult } from '../options/options-client.js';

export interface OptionsRouteProps {
  readonly initialRevisionId?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Route component for Option Builder (/options).
 *
 * Blueprint §15.2 Step 4 (FR-CP-04..07, D-03).
 * Client creates two controlled selective-pallet-rack options using
 * the controlled vocabulary, and verifies Demo Beat 5 non-interpolation refusal.
 */
export default function OptionsRoute({
  initialRevisionId = '00000000-0000-0000-0000-000000000001',
  fetchImpl,
}: OptionsRouteProps): JSX.Element {
  const { push } = useToasts();
  const [revisionId, setRevisionId] = useState<string>(initialRevisionId);

  const handleSaveSuccess = (result: SaveOptionsResult): void => {
    push(`Options successfully saved to revision ${result.code || revisionId}.`, 'info');
  };

  return (
    <div className="options-page-container" id="options-page" data-testid="options-route">
      <header className="page-header">
        <div className="page-header-info">
          <h1 className="page-title">Option Builder & Controlled Vocabulary</h1>
          <p className="page-description">
            Blueprint §15.2 Step 4 (FR-CP-04..07, D-03). Configure controlled selective-pallet-rack options
            over the pinned manufacturer catalog release (Interlake 2026-08). Free-text dimensional entry
            is forbidden. Off-grid dimensions (such as 110″ in Demo Beat 5) are strictly refused with published
            brackets and no interpolation.
          </p>
        </div>

        <div className="page-header-controls">
          <div className="revision-selector-wrap">
            <label htmlFor="options-revision-id-input" className="selector-label">
              Active Revision ID:
            </label>
            <input
              id="options-revision-id-input"
              type="text"
              className="input-field input-field-mono"
              value={revisionId}
              onChange={(e) => setRevisionId(e.target.value)}
              placeholder="UUID revision id"
              data-testid="options-revision-input"
            />
          </div>
        </div>
      </header>

      <main className="options-page-main">
        <OptionBuilder
          revisionId={revisionId}
          onSaveSuccess={handleSaveSuccess}
          fetchImpl={fetchImpl}
        />
      </main>
    </div>
  );
}
