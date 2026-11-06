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
  const [showComparisonGuide, setShowComparisonGuide] = useState<boolean>(false);

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
          <button
            id="toggle-rack-comparison-guide-btn"
            type="button"
            className="pf-btn"
            aria-expanded={showComparisonGuide}
            onClick={() => setShowComparisonGuide((prev) => !prev)}
          >
            {showComparisonGuide
              ? 'Hide Rack Systems Comparison Guide'
              : 'Explore Pallet Rack Systems Guide'}
          </button>

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

      {showComparisonGuide && (
        <section
          id="rack-systems-comparison-guide"
          className="cmdbar-panel"
          aria-label="Pallet Rack Systems Comparison Guide"
        >
          <h2>Pallet Rack Systems Comparison Guide</h2>
          <p>
            Compare trade-offs across storage density, SKU selectivity, inventory rotation (FIFO vs.
            LIFO), aisle width requirements, and relative investment per pallet position.
          </p>
          <table aria-label="Pallet rack systems comparison">
            <thead>
              <tr>
                <th scope="col">System Type</th>
                <th scope="col">Storage Density</th>
                <th scope="col">Selectivity &amp; Rotation</th>
                <th scope="col">Typical Aisle Need</th>
                <th scope="col">Cost / Position</th>
                <th scope="col">Best Fit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Standard Selective (1-Deep / Double Row)</strong>
                </td>
                <td>Baseline (40–50% floor utilization)</td>
                <td>100% direct access · FIFO or LIFO</td>
                <td>9&apos;-6&quot; to 12&apos;-0&quot; (Reach / Counterbalance)</td>
                <td>$ (Lowest per position)</td>
                <td>High SKU counts, fast pick turnover, standard distribution centers</td>
              </tr>
              <tr>
                <td>
                  <strong>Pushback Rack (2–6 Deep Carts)</strong>
                </td>
                <td>High (+40–65% vs. Selective)</td>
                <td>By lane · LIFO rotation</td>
                <td>10&apos;-0&quot; to 11&apos;-6&quot;</td>
                <td>$$–$$$</td>
                <td>Medium SKU depth (4–24 pallets/SKU), cold storage, staging lanes</td>
              </tr>
              <tr>
                <td>
                  <strong>Drive-In / Drive-Through</strong>
                </td>
                <td>Very High (+60–80% vs. Selective)</td>
                <td>By full lane · LIFO (Drive-In) / FIFO (Drive-Through)</td>
                <td>10&apos;-6&quot; to 12&apos;-0&quot; transfer aisle</td>
                <td>$$</td>
                <td>Low SKU count, high volume homogeneous products, seasonal bulk storage</td>
              </tr>
              <tr>
                <td>
                  <strong>Pallet Flow (Gravity Roller FIFO)</strong>
                </td>
                <td>Highest (+70–85% vs. Selective)</td>
                <td>Dedicated charge/discharge faces · Strict FIFO</td>
                <td>10&apos;-6&quot; charge &amp; discharge aisles</td>
                <td>$$$$</td>
                <td>Lot-dated food/beverage, pharma, high-throughput cross-dock buffers</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

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
