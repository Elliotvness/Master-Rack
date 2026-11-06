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
          <h1 className="page-title">Options</h1>
          <p className="page-description">
            Build the rack options to compare, from the pinned catalog release (Interlake 2026-08) only. A
            beam span the catalog does not publish — 110″, say — is refused and the published sizes on
            either side are offered instead; nothing is interpolated.
          </p>
        </div>

        <div className="page-header-controls">
          <details className="revision-selector-wrap">
            <summary className="selector-label">Advanced: Revision Target</summary>
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
          </details>
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
