import {
  DEFAULT_PRICING_RATES,
  bomForDocument,
  pricingForDocument,
  takeoffSummary,
  type PricingRates,
} from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { useStudioSession } from '../session-context.js';

type BomFilter = 'all' | 'resolved' | 'unresolved';

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatUnitCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function BomView(): React.JSX.Element {
  const { session } = useStudioSession();
  const doc = session.document;

  const [filter, setFilter] = useState<BomFilter>('all');
  const [rates, setRates] = useState<PricingRates>(DEFAULT_PRICING_RATES);

  // Compute BOM lines and counts
  const lines = useMemo(() => bomForDocument(doc), [doc]);
  const summary = useMemo(() => takeoffSummary(lines, doc), [lines, doc]);
  const estimate = useMemo(() => pricingForDocument(doc, rates), [doc, rates]);

  const filteredLines = useMemo(() => {
    if (filter === 'resolved') return lines.filter((l) => l.resolved);
    if (filter === 'unresolved') return lines.filter((l) => !l.resolved);
    return lines;
  }, [lines, filter]);

  const handleRateChange = (field: keyof PricingRates, value: number) => {
    setRates((prev) => ({
      ...prev,
      [field]: Number.isFinite(value) ? value : 0,
    }));
  };

  return (
    <section className="bom-view" aria-labelledby="view-heading-bom">
      <div className="bom-header">
        <div>
          <h1 id="view-heading-bom" className="bom-title">
            BOM
          </h1>
          <p className="bom-subtitle">
            Takeoff &amp; Commercial Pricing — derived from document runs and Interlake counting rules.
          </p>
        </div>
        <div className="bom-kpis">
          <div className="blueprint kpi-card">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <span className="kpi-label">Pallet Positions</span>
            <span className="kpi-value font-mono">{summary.totalPalletPositions.toLocaleString()}</span>
          </div>
          <div className="blueprint kpi-card highlight">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <span className="kpi-label">Proposal Price</span>
            <span className="kpi-value font-mono">{formatCurrency(estimate.totalPrice)}</span>
            <span className="kpi-sub font-mono">{formatUnitCurrency(estimate.pricePerPosition)} / pos</span>
          </div>
        </div>
      </div>

      <div className="bom-layout">
        {/* Main Column: BOM Table & Filter */}
        <div className="bom-main">
          <div className="bom-toolbar">
            <div className="seg" role="tablist" aria-label="BOM line filter">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={`seg-opt ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All Lines ({lines.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'resolved'}
                className={`seg-opt ${filter === 'resolved' ? 'active' : ''}`}
                onClick={() => setFilter('resolved')}
              >
                Resolved ({summary.resolvedCount})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'unresolved'}
                className={`seg-opt ${filter === 'unresolved' ? 'active' : ''}`}
                onClick={() => setFilter('unresolved')}
              >
                Unresolved Register ({summary.unresolvedCount})
              </button>
            </div>

            <div className="bom-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.print()}
                title="Print or Save as Proposal PDF"
              >
                <span aria-hidden="true">⎙</span> Export Proposal PDF
              </button>
            </div>
          </div>

          <div className="blueprint bom-table-wrapper">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <table className="bom-table" aria-label="Bill of materials line items">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Part Reference</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Derivation Rule</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((line, idx) => {
                  const partText =
                    line.partRef.kind === 'catalog'
                      ? `Catalog (${line.partRef.partRevisionId})`
                      : line.partRef.uncataloguedPartId;

                  return (
                    <tr key={`${line.category}-${idx}`} className={line.resolved ? 'resolved-row' : 'unresolved-row'}>
                      <td>
                        <span className={`tag tag-accent cat-${line.category.toLowerCase()}`}>
                          {line.category}
                        </span>
                      </td>
                      <td className="part-col">
                        <span className="part-id font-mono">{partText}</span>
                        {line.partRef.kind === 'uncatalogued' && (
                          <span className="part-geom">{line.partRef.measuredGeometry}</span>
                        )}
                      </td>
                      <td className="qty-col font-mono">
                        {line.resolved ? (
                          <span className="qty-val">
                            {line.qty.value.toLocaleString()} <span className="uom">{line.uom}</span>
                          </span>
                        ) : (
                          <span className="unresolved-txt">{line.unresolvedReason}</span>
                        )}
                      </td>
                      <td className="rule-col">{line.ruleText}</td>
                      <td>
                        {line.resolved ? (
                          <span className="tag tag-accent">Resolved</span>
                        ) : (
                          <span className="tag tag-outline">Unresolved</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sidebar Column: Estimating & Pricing Calculator */}
        <aside className="bom-sidebar" aria-label="Commercial Pricing Estimator">
          <div className="blueprint pricing-card">
            <div className="corner tl" aria-hidden="true" />
            <div className="corner tr" aria-hidden="true" />
            <div className="corner bl" aria-hidden="true" />
            <div className="corner br" aria-hidden="true" />
            <h2 className="pricing-title">Commercial Estimator</h2>
            <p className="pricing-desc">
              Budgetary pricing model ported from McMurray Stern field takeoff standards.
            </p>

            <div className="cost-breakdown">
              <div className="cost-row">
                <span>Upright Frames ({summary.totalFrames} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.frameCost)}</span>
              </div>
              <div className="cost-row">
                <span>Load Beams ({summary.totalBeamPairs * 2} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.beamCost)}</span>
              </div>
              <div className="cost-row">
                <span>Wire Decks ({summary.totalDecks} panels)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.deckCost)}</span>
              </div>
              <div className="cost-row">
                <span>Row Spacers ({summary.totalSpacers} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.spacerCost)}</span>
              </div>
              <div className="cost-row">
                <span>Floor Anchors ({summary.totalAnchors} ea)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.anchorCost)}</span>
              </div>
              <div className="cost-divider" />
              <div className="cost-row bold">
                <span>Materials Subtotal</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.materialsSubtotal)}</span>
              </div>
              <div className="cost-row">
                <span>Freight ({Math.round(rates.freightRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.freight)}</span>
              </div>
              <div className="cost-row">
                <span>Install Labor ({Math.round(rates.installRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.installation)}</span>
              </div>
              <div className="cost-row">
                <span>Sales Tax ({Number((rates.taxRate * 100).toFixed(2))}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.salesTax)}</span>
              </div>
              <div className="cost-divider" />
              <div className="cost-row bold">
                <span>Total Cost</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.subtotalBeforeMargin)}</span>
              </div>
              <div className="cost-row margin-row">
                <span>Target Gross Margin ({Math.round(rates.marginRate * 100)}%)</span>
                <span className="cost-val font-mono">{formatCurrency(estimate.targetMargin)}</span>
              </div>
              <div className="cost-divider thick" />
              <div className="cost-row grand-total">
                <span>Total Proposal</span>
                <span className="cost-val highlight font-mono">{formatCurrency(estimate.totalPrice)}</span>
              </div>
              <div className="cost-unit-pos font-mono">
                {formatUnitCurrency(estimate.pricePerPosition)} per pallet position
              </div>
            </div>

            <div className="rate-controls">
              <h3 className="rate-controls-title">Rate Parameters</h3>
              <div className="control-field">
                <label htmlFor="rate-frame">Frame $/ft</label>
                <input
                  id="rate-frame"
                  className="input font-mono"
                  type="number"
                  step="0.25"
                  min="1"
                  value={rates.framePerFt}
                  onChange={(e) => handleRateChange('framePerFt', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-beam">Beam $/ft</label>
                <input
                  id="rate-beam"
                  className="input font-mono"
                  type="number"
                  step="0.10"
                  min="1"
                  value={rates.beamPerFt}
                  onChange={(e) => handleRateChange('beamPerFt', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-deck">Deck $/panel</label>
                <input
                  id="rate-deck"
                  className="input font-mono"
                  type="number"
                  step="0.50"
                  min="1"
                  value={rates.deckEach}
                  onChange={(e) => handleRateChange('deckEach', parseFloat(e.target.value))}
                />
              </div>
              <div className="control-field">
                <label htmlFor="rate-margin">Target Margin %</label>
                <input
                  id="rate-margin"
                  className="input font-mono"
                  type="number"
                  step="1"
                  min="5"
                  max="50"
                  value={Math.round(rates.marginRate * 100)}
                  onChange={(e) => handleRateChange('marginRate', parseFloat(e.target.value) / 100)}
                />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
