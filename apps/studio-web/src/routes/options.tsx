import {
  STEEL_GAGE_TABLE,
  coldWorkFya,
  computeSectionProperties,
  type RackShapeType,
} from '@rms/kernel-derive';
import { useMemo, useState, type JSX } from 'react';
import { useToasts } from '../components/toast.js';
import { OptionBuilder } from '../options/option-builder.js';
import type { SaveOptionsResult } from '../options/options-client.js';
import { useOptionalStudioSession } from '../session-context.js';

interface CustomRackComponentItem {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly role: 'Upright Column' | 'Load Beam' | 'Frame Brace';
  readonly shapeType: RackShapeType;
  readonly depthIn: number;
  readonly widthIn: number;
  readonly lipIn: number;
  readonly gage: string;
  readonly fyKsi: number;
}

const INITIAL_LIBRARY_PARTS: readonly CustomRackComponentItem[] = [
  {
    id: 'lib-interlake-30x30-13',
    name: 'Interlake 3.0×3.0 Teardrop Upright (13ga)',
    manufacturer: 'Interlake Mecalux',
    role: 'Upright Column',
    shapeType: 'c-lips',
    depthIn: 3.0,
    widthIn: 3.0,
    lipIn: 0.75,
    gage: '13ga',
    fyKsi: 50,
  },
  {
    id: 'lib-unarco-30x30-12',
    name: 'Unarco T-Bolt 3.0×3.0 Upright (12ga)',
    manufacturer: 'Unarco T-Bolt',
    role: 'Upright Column',
    shapeType: 'c-lips',
    depthIn: 3.0,
    widthIn: 3.0,
    lipIn: 0.75,
    gage: '12ga',
    fyKsi: 50,
  },
  {
    id: 'lib-frazier-40x30-10',
    name: 'Frazier 4.0×3.0 Structural C-Channel',
    manufacturer: 'Frazier Structural',
    role: 'Upright Column',
    shapeType: 'c-channel',
    depthIn: 4.0,
    widthIn: 3.0,
    lipIn: 0,
    gage: '10ga',
    fyKsi: 50,
  },
  {
    id: 'lib-stepbeam-45-14',
    name: 'Standard 4.5"×1.625" Roll-Formed Step Beam (14ga)',
    manufacturer: 'Interlake Mecalux',
    role: 'Load Beam',
    shapeType: 'step-beam',
    depthIn: 4.5,
    widthIn: 1.625,
    lipIn: 0.625,
    gage: '14ga',
    fyKsi: 50,
  },
];

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
  const studioSession = useOptionalStudioSession();
  const [revisionId, setRevisionId] = useState<string>(initialRevisionId);
  const [showComparisonGuide, setShowComparisonGuide] = useState<boolean>(false);

  // Step 1: Part Builder & Multi-Manufacturer Library state
  const [mfgFilter, setMfgFilter] = useState<string>('ALL');
  const [partName, setPartName] = useState<string>('Custom 3.5×3.0 Cold-Formed Upright');
  const [partMfg, setPartMfg] = useState<string>('Custom / Used Inventory');
  const [partRole, setPartRole] = useState<'Upright Column' | 'Load Beam' | 'Frame Brace'>(
    'Upright Column',
  );
  const [shapeType, setShapeType] = useState<RackShapeType>('c-lips');
  const [depthIn, setDepthIn] = useState<number>(3.5);
  const [widthIn, setWidthIn] = useState<number>(3.0);
  const [lipIn, setLipIn] = useState<number>(0.75);
  const [gage, setGage] = useState<string>('12ga');
  const holeWidthIn = 0.65;
  const [fyKsi, setFyKsi] = useState<number>(50);
  const [libraryParts, setLibraryParts] =
    useState<readonly CustomRackComponentItem[]>(INITIAL_LIBRARY_PARTS);

  const thicknessIn = STEEL_GAGE_TABLE[gage] ?? 0.1046;
  const safeDepth = Math.min(20, Math.max(1.25, Number.isFinite(depthIn) ? depthIn : 3.0));
  const safeWidth = Math.min(12, Math.max(0.75, Number.isFinite(widthIn) ? widthIn : 3.0));
  const safeLip =
    shapeType === 'c-channel' || shapeType === 'closed-tube'
      ? 0
      : Math.min(safeDepth * 0.45, Math.max(0, Number.isFinite(lipIn) ? lipIn : 0.75));
  const safeHole = Math.min(safeDepth * 0.4, Math.max(0, Number.isFinite(holeWidthIn) ? holeWidthIn : 0.65));

  const sectionProps = useMemo(
    () =>
      computeSectionProperties(
        safeDepth,
        safeWidth,
        safeLip,
        thicknessIn,
        safeHole,
        2 * thicknessIn,
        shapeType,
      ),
    [safeDepth, safeWidth, safeLip, thicknessIn, safeHole, shapeType],
  );

  const coldWorkedFyaKsi = useMemo(
    () => coldWorkFya(2 * thicknessIn, thicknessIn, fyKsi, fyKsi + 15, 0.18),
    [fyKsi, thicknessIn],
  );

  const filteredLibraryParts = useMemo(
    () =>
      mfgFilter === 'ALL'
        ? libraryParts
        : libraryParts.filter((p) => p.manufacturer === mfgFilter),
    [libraryParts, mfgFilter],
  );

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
        {/* Step 1: Part Builder & Multi-Manufacturer Component Library */}
        <section
          id="part-builder-section"
          className="cmdbar-panel"
          aria-label="Part Builder and Multi-Manufacturer Component Library"
        >
          <div className="plan-dock-popover-head">
            <div>
              <h2>Part Builder &amp; Multi-Manufacturer Component Library</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
                Select standard manufacturer components or enter custom section dimensions to
                calculate thin-walled engineering properties (AISI S100 / RMI MH16.1).
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label htmlFor="part-builder-mfg-select" className="elev-toolbar-label">
                Manufacturer Filter
                <select
                  id="part-builder-mfg-select"
                  className="pf-input dock-compact-select"
                  value={mfgFilter}
                  onChange={(e) => setMfgFilter(e.target.value)}
                >
                  <option value="ALL">All Manufacturers</option>
                  <option value="Interlake Mecalux">Interlake Mecalux</option>
                  <option value="Unarco T-Bolt">Unarco T-Bolt</option>
                  <option value="Frazier Structural">Frazier Structural</option>
                  <option value="Custom / Used Inventory">Custom / Used Inventory</option>
                </select>
              </label>
              <button
                id="part-builder-save-custom-btn"
                type="button"
                className="pf-btn"
                onClick={() => {
                  const newItem: CustomRackComponentItem = {
                    id: `custom-${String(libraryParts.length + 1)}`,
                    name: partName.trim() || `Custom ${safeDepth}×${safeWidth} (${gage})`,
                    manufacturer: partMfg,
                    role: partRole,
                    shapeType,
                    depthIn: safeDepth,
                    widthIn: safeWidth,
                    lipIn: safeLip,
                    gage,
                    fyKsi,
                  };
                  setLibraryParts((prev) => [newItem, ...prev]);
                  push(
                    `Added "${newItem.name}" (Ag=${sectionProps.A.toFixed(3)} in², Ix=${sectionProps.Ix.toFixed(3)} in⁴) to component library.`,
                    'info',
                  );
                }}
              >
                + Save Custom Part to Library
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: '12px',
              marginTop: '12px',
            }}
          >
            <label
              htmlFor="part-builder-name-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Component Designation</span>
              <input
                id="part-builder-name-input"
                type="text"
                className="pf-input"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
              />
            </label>
            <label
              htmlFor="part-builder-shape-select"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Profile Shape</span>
              <select
                id="part-builder-shape-select"
                className="pf-input"
                value={shapeType}
                onChange={(e) => setShapeType(e.target.value as RackShapeType)}
              >
                <option value="c-lips">Lipped C-Channel (Teardrop)</option>
                <option value="closed-tube">Closed Tube Column</option>
                <option value="step-beam">Roll-Formed Step Beam</option>
                <option value="c-channel">Unlipped Structural C-Channel</option>
                <option value="hat">Hat Brace Strut</option>
              </select>
            </label>
            <label
              htmlFor="part-builder-depth-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Depth H (in)</span>
              <input
                id="part-builder-depth-input"
                type="number"
                step="0.25"
                min="1.5"
                max="16"
                className="pf-input"
                value={depthIn}
                onChange={(e) => setDepthIn(Number(e.target.value))}
              />
            </label>
            <label
              htmlFor="part-builder-width-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Flange Width W (in)</span>
              <input
                id="part-builder-width-input"
                type="number"
                step="0.125"
                min="1.0"
                max="10"
                className="pf-input"
                value={widthIn}
                onChange={(e) => setWidthIn(Number(e.target.value))}
              />
            </label>
            <label
              htmlFor="part-builder-lip-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Stiffener Lip L (in)</span>
              <input
                id="part-builder-lip-input"
                type="number"
                step="0.125"
                min="0"
                max="2.5"
                className="pf-input"
                value={lipIn}
                onChange={(e) => setLipIn(Number(e.target.value))}
              />
            </label>
            <label
              htmlFor="part-builder-gage-select"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Steel Gage (t)</span>
              <select
                id="part-builder-gage-select"
                className="pf-input"
                value={gage}
                onChange={(e) => setGage(e.target.value)}
              >
                <option value="16ga">16 ga (0.0598&quot;)</option>
                <option value="14ga">14 ga (0.0747&quot;)</option>
                <option value="13ga">13 ga (0.0897&quot;)</option>
                <option value="12ga">12 ga (0.1046&quot;)</option>
                <option value="10ga">10 ga (0.1345&quot;)</option>
              </select>
            </label>
            <label
              htmlFor="part-builder-fy-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}
            >
              <span>Virgin Yield Fy (ksi)</span>
              <input
                id="part-builder-fy-input"
                type="number"
                step="5"
                min="33"
                max="80"
                className="pf-input"
                value={fyKsi}
                onChange={(e) => setFyKsi(Number(e.target.value))}
              />
            </label>
          </div>

          {/* Live Calculated Section Properties + 2D Cross-Section SVG */}
          <div
            id="part-builder-props-grid"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              alignItems: 'center',
              marginTop: '12px',
              padding: '10px',
              border: '1px solid var(--rule)',
              borderRadius: '6px',
            }}
          >
            <svg
              id="part-builder-section-svg"
              width={110}
              height={110}
              viewBox="0 0 110 110"
              role="img"
              aria-label={`2D cross-section preview for ${shapeType}`}
            >
              <rect x={2} y={2} width={106} height={106} fill="var(--zinc-900)" stroke="var(--zinc-700)" />
              <rect
                x={25}
                y={18}
                width={Math.min(60, Math.round(safeWidth * 14))}
                height={Math.min(74, Math.round(safeDepth * 14))}
                fill="none"
                stroke="#f97316"
                strokeWidth={Math.max(3, Math.round(thicknessIn * 36))}
              />
              <circle cx={48} cy={55} r={3.5} fill="#22c55e" />
              <circle cx={32} cy={55} r={3.5} fill="#38bdf8" />
            </svg>
            <div className="font-mono" style={{ fontSize: '12px', lineHeight: 1.65 }}>
              <div>
                <strong>Gross Area Ag:</strong> {sectionProps.A.toFixed(3)} in² ·{' '}
                <strong>Net Area Anet:</strong> {sectionProps.Anet.toFixed(3)} in² ·{' '}
                <strong>Weight:</strong> {sectionProps.weightPerFt.toFixed(2)} lb/ft
              </div>
              <div>
                <strong>Major Axis:</strong> Ix={sectionProps.Ix.toFixed(3)} in⁴ · Sx=
                {sectionProps.Sx.toFixed(3)} in³ · rx={sectionProps.rx.toFixed(3)} in ·{' '}
                <strong>Minor Axis:</strong> Iy={sectionProps.Iy.toFixed(3)} in⁴ · ry=
                {sectionProps.ry.toFixed(3)} in
              </div>
              <div>
                <strong>Torsion &amp; Warping:</strong> J={sectionProps.J.toFixed(5)} in⁴ · Cw=
                {sectionProps.Cw.toFixed(4)} in⁶ · xo={sectionProps.xo.toFixed(3)} in · ro=
                {sectionProps.ro.toFixed(3)} in · β={sectionProps.beta.toFixed(3)} ·{' '}
                <strong>Cold-Worked Fya:</strong> {coldWorkedFyaKsi.toFixed(2)} ksi
              </div>
            </div>
          </div>

          <table
            id="part-builder-inventory-table"
            aria-label="Multi-manufacturer and custom rack component inventory"
            style={{ marginTop: '12px' }}
          >
            <thead>
              <tr>
                <th scope="col">Component Designation</th>
                <th scope="col">Manufacturer</th>
                <th scope="col">Role</th>
                <th scope="col">Profile / Gage</th>
                <th scope="col">Section (H×W×L)</th>
                <th scope="col">Load into Builder</th>
              </tr>
            </thead>
            <tbody>
              {filteredLibraryParts.map((item) => (
                <tr key={item.id} data-library-part-id={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{item.manufacturer}</td>
                  <td>{item.role}</td>
                  <td className="font-mono">
                    {item.shapeType} · {item.gage}
                  </td>
                  <td className="font-mono">
                    {item.depthIn.toFixed(2)}&quot; × {item.widthIn.toFixed(2)}&quot; ×{' '}
                    {item.lipIn.toFixed(2)}&quot;
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pf-btn pf-btn-small"
                      data-load-part-btn={item.id}
                      onClick={() => {
                        setPartName(item.name);
                        setPartMfg(item.manufacturer);
                        setPartRole(item.role);
                        setShapeType(item.shapeType);
                        setDepthIn(item.depthIn);
                        setWidthIn(item.widthIn);
                        setLipIn(item.lipIn);
                        setGage(item.gage);
                        setFyKsi(item.fyKsi);
                        push(`Loaded "${item.name}" into Part Builder.`, 'info');
                      }}
                    >
                      Inspect / Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {studioSession !== null && (
          <section
            id="saved-plan-snapshots-section"
            className="cmdbar-panel"
            aria-label="Interactive Plan Option Comparison and Snapshots"
          >
            <div className="plan-dock-popover-head">
              <h2>Active Plan &amp; Saved Option Snapshots</h2>
              <button
                id="options-save-snapshot-btn"
                type="button"
                className="pf-btn"
                onClick={() => {
                  const snap = studioSession.saveCurrentSnapshot();
                  push(`Saved "${snap.label}" (${snap.positionsCount} positions).`, 'info');
                }}
              >
                + Snapshot Active Plan ({studioSession.plan.totalPositions} pos)
              </button>
            </div>
            <table aria-label="Plan option comparison matrix">
              <thead>
                <tr>
                  <th scope="col">Option / Snapshot</th>
                  <th scope="col">Runs</th>
                  <th scope="col">Bays</th>
                  <th scope="col">Pallet Positions</th>
                  <th scope="col">Narrowest Clear Aisle</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Option A: High-Density Reach (9&apos;-6&quot; Aisle)</strong>
                  </td>
                  <td>4</td>
                  <td>40</td>
                  <td>480</td>
                  <td>108&quot;</td>
                  <td>
                    <button
                      type="button"
                      className="pf-btn pf-btn-small"
                      onClick={() => {
                        studioSession.generateFromSpace({
                          projectName: studioSession.session.document.name,
                          clientName: studioSession.session.document.client,
                          lengthFt: studioSession.shellOverlay.shellWidthFt,
                          widthFt: studioSession.shellOverlay.shellDepthFt,
                          clearHeightFt: 28,
                          aisleFt: 9.5,
                          targetPositions: 480,
                          showColumns: true,
                          columnSpacingFt: studioSession.shellOverlay.columnSpacingFt,
                        });
                        push('Applied Option A (High-Density Reach) to active Plan.', 'info');
                      }}
                    >
                      Apply to Active Plan
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Option B: Balanced Selective (11&apos;-0&quot; Aisle)</strong>
                  </td>
                  <td>3</td>
                  <td>36</td>
                  <td>576</td>
                  <td>126&quot;</td>
                  <td>
                    <button
                      type="button"
                      className="pf-btn pf-btn-small"
                      onClick={() => {
                        studioSession.loadPreset('benchmark-36');
                        push('Applied Option B (36-Bay Benchmark) to active Plan.', 'info');
                      }}
                    >
                      Apply to Active Plan
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Option C: Wide-Aisle Counterbalance (12&apos;-0&quot; Aisle)</strong>
                  </td>
                  <td>3</td>
                  <td>30</td>
                  <td>360</td>
                  <td>138&quot;</td>
                  <td>
                    <button
                      type="button"
                      className="pf-btn pf-btn-small"
                      onClick={() => {
                        studioSession.generateFromSpace({
                          projectName: studioSession.session.document.name,
                          clientName: studioSession.session.document.client,
                          lengthFt: studioSession.shellOverlay.shellWidthFt,
                          widthFt: studioSession.shellOverlay.shellDepthFt,
                          clearHeightFt: 28,
                          aisleFt: 12,
                          targetPositions: 360,
                          showColumns: true,
                          columnSpacingFt: studioSession.shellOverlay.columnSpacingFt,
                        });
                        push('Applied Option C (Wide-Aisle Counterbalance) to active Plan.', 'info');
                      }}
                    >
                      Apply to Active Plan
                    </button>
                  </td>
                </tr>
                {studioSession.savedSnapshots.map((snap) => (
                  <tr key={snap.id} data-snapshot-id={snap.id}>
                    <td>
                      <strong>{snap.label}</strong>
                    </td>
                    <td>{snap.runsCount}</td>
                    <td>{snap.baysCount}</td>
                    <td>{snap.positionsCount}</td>
                    <td>{snap.narrowestAisleIn !== null ? `${snap.narrowestAisleIn}"` : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="pf-btn pf-btn-small"
                        onClick={() => {
                          studioSession.restoreSnapshot(snap.id);
                          push(`Restored "${snap.label}" to active Plan.`, 'info');
                        }}
                      >
                        Restore Snapshot
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <OptionBuilder
          revisionId={revisionId}
          onSaveSuccess={handleSaveSuccess}
          fetchImpl={fetchImpl}
        />
      </main>
    </div>
  );
}
