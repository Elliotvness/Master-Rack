import { buildDetailedPlan } from '@rms/display-list';
import { planGeometry, type StudioDocument } from '@rms/studio-model';
import { useMemo, useState } from 'react';

import { ElevationSvg } from '../elevation/elevation-svg.js';
import { useStudioSession } from '../session-context.js';

export type SheetId = 'R-101' | 'R-201' | 'R-501';

interface SheetSpec {
  readonly id: SheetId;
  readonly title: string;
  readonly subtitle: string;
}

const SHEETS: readonly SheetSpec[] = [
  {
    id: 'R-101',
    title: 'OVERALL RACK LAYOUT PLAN',
    subtitle: 'Plan geometry, bay layout, and dual aisle datums',
  },
  {
    id: 'R-201',
    title: 'TYPICAL BAY ELEVATION & SECTION',
    subtitle: 'Beam levels from slab datum and reference elevations',
  },
  {
    id: 'R-501',
    title: 'GENERAL NOTES & SCREENING SCHEDULE',
    subtitle: 'Pinned packs, bay schedule, and delegated-design scope',
  },
] as const;

function PlanSheetSvg({ document: doc }: { readonly document: StudioDocument }): React.JSX.Element {
  const plan = useMemo(() => planGeometry(doc), [doc]);
  const list = useMemo(
    () =>
      buildDetailedPlan({
        revisionHash: `doc:${doc.id}:${doc.revision}`,
        runs: plan.runs.map((r) => ({
          runId: r.runId,
          label: r.label,
          x: r.x,
          y: r.y,
          runLength: r.runLength,
          bayPitch: r.bayPitch,
          uprightFace: r.uprightFace,
          rows: r.rows,
          bays: r.bays,
          pallets: r.pallets,
          longitudinalFlue: r.longitudinalFlue,
        })),
        aisles: plan.aisles.map((a) => ({
          aisleId: a.aisleId,
          x: a.x,
          y: a.y,
          length: a.length,
          frameToFrame: a.frameToFrame,
          clearBetweenLoads: a.clearBetweenLoads,
        })),
        extent: plan.extent,
        overallLength: plan.overallLength,
      }),
    [doc.id, doc.revision, plan],
  );

  const pad = 1_200_000;
  const vbW = Math.max(list.extent.width, 2_540_000) + pad * 2;
  const vbH = Math.max(list.extent.height, 2_540_000) + pad * 2;
  const strokeW = 24_000;
  const fontSize = 140_000;

  return (
    <svg
      className="sheet-plan-svg"
      viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Sheet R-101 plan drawing for ${doc.name}`}
    >
      {list.items.map((item) => {
        if (item.kind === 'rect') {
          return (
            <g key={item.id} data-item-id={item.id}>
              <rect
                className={`sheet-rect sheet-rect-${item.item}`}
                x={item.origin.x}
                y={item.origin.y}
                width={item.width}
                height={item.height}
                strokeWidth={strokeW}
              />
              {item.label !== null && (
                <text
                  className={
                    item.label.established ? 'sheet-text' : 'sheet-text sheet-text-unestablished'
                  }
                  data-established={item.label.established}
                  x={item.origin.x + item.width / 2}
                  y={item.origin.y + item.height / 2}
                  fontSize={fontSize}
                  textAnchor="middle"
                >
                  {item.label.text}
                </text>
              )}
            </g>
          );
        }
        if (item.kind === 'line') {
          return (
            <line
              key={item.id}
              data-item-id={item.id}
              className={`sheet-line sheet-line-${item.item}`}
              x1={item.from.x}
              y1={item.from.y}
              x2={item.to.x}
              y2={item.to.y}
              strokeWidth={strokeW}
            />
          );
        }
        if (item.kind === 'dimension') {
          return (
            <g key={item.id} data-item-id={item.id}>
              <line
                className="sheet-dim-line"
                x1={item.from.x}
                y1={item.from.y}
                x2={item.to.x}
                y2={item.to.y}
                strokeWidth={strokeW}
              />
              <text
                className={
                  item.text.established ? 'sheet-text' : 'sheet-text sheet-text-unestablished'
                }
                data-established={item.text.established}
                x={(item.from.x + item.to.x) / 2}
                y={(item.from.y + item.to.y) / 2 - strokeW * 2}
                fontSize={fontSize}
                textAnchor="middle"
              >
                {item.text.text}
              </text>
            </g>
          );
        }
        return (
          <text
            key={item.id}
            data-item-id={item.id}
            className={
              item.text.established ? 'sheet-text' : 'sheet-text sheet-text-unestablished'
            }
            data-established={item.text.established}
            x={item.at.x}
            y={item.at.y}
            fontSize={fontSize}
          >
            {item.text.text}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * The sheets view — build-plan **S3.4**.
 *
 * ANSI D sheet preview with selector rail (`R-101`, `R-201`, `R-501`),
 * honest fitted scale (`1 : n fitted`) + `"NOT TO SCALE ON SCREEN"` legend,
 * delegated-design note, and empty preliminary stamp box.
 */
export default function SheetsView(): React.JSX.Element {
  const { session } = useStudioSession();
  const doc = session.document;
  const [activeSheet, setActiveSheet] = useState<SheetId>('R-101');
  const plan = useMemo(() => planGeometry(doc), [doc]);

  const currentSpec: SheetSpec = SHEETS.find((s) => s.id === activeSheet) ?? SHEETS[0]!;

  // Compute an honest approximate fitted ratio for the screen preview, never a
  // fake architectural scale like 1/8" = 1'-0" (build-plan S3.4 / D-H).
  const fittedRatio = useMemo(() => {
    const spanUm =
      activeSheet === 'R-201'
        ? (doc.bayTypes[0]?.frameHeight.value ?? 6_096_000)
        : Math.max(plan.extent.width.value, plan.extent.height.value, 2_540_000);
    // Approximate against a 500 mm (500,000 µm) viewport frame width
    const ratio = Math.max(10, Math.round(spanUm / 500_000));
    return `1 : ${ratio} fitted`;
  }, [activeSheet, doc.bayTypes, plan.extent.height.value, plan.extent.width.value]);

  return (
    <section id="sheetview" className="sheets-view" aria-labelledby="view-heading-sheets">
      <h1 id="view-heading-sheets" className="visually-hidden">
        Sheets
      </h1>

      <aside id="sheetrail" className="sheet-rail" aria-label="Sheet index">
        {SHEETS.map((sheet) => {
          const isCurrent = sheet.id === activeSheet;
          return (
            <button
              key={sheet.id}
              type="button"
              data-sheet={sheet.id}
              aria-pressed={isCurrent}
              className={isCurrent ? 'sheet-tab sheet-tab-active' : 'sheet-tab'}
              onClick={() => setActiveSheet(sheet.id)}
            >
              <strong className="sheet-tab-id">{sheet.id}</strong>
              <span className="sheet-tab-title">{sheet.title}</span>
              <span className="sheet-tab-sub">{sheet.subtitle}</span>
            </button>
          );
        })}
      </aside>

      <div className="sheet-stage">
        <div id="sheetpage" className="sheet-page" role="region" aria-label={`Sheet ${currentSpec.id}`}>
          <div id="sheetmain" className="sheet-main">
            <div id="sheetdrawing" className="sheet-drawing">
              {activeSheet === 'R-101' && <PlanSheetSvg document={doc} />}
              {activeSheet === 'R-201' && <ElevationSvg document={doc} id="sheet-elev-svg" />}
              {activeSheet === 'R-501' && (
                <div className="sheet-schedule">
                  <h2>BAY &amp; RUN SCHEDULE</h2>
                  <table className="sheet-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Bay Type</th>
                        <th>Bays</th>
                        <th>Config</th>
                        <th>Positions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.runs.map((r) => {
                        const docRun = doc.runs.find((dr) => dr.id === r.runId);
                        const bt = doc.bayTypes.find((b) => b.id === docRun?.bayTypeId);
                        return (
                          <tr key={r.runId}>
                            <td>{r.label}</td>
                            <td>{bt?.name ?? '—'}</td>
                            <td>{r.bays.length}</td>
                            <td>{docRun?.backToBack ? 'Back-to-back' : 'Single-row'}</td>
                            <td>{r.positions}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <aside id="sheetnotes" className="sheet-notes" aria-label="General notes">
              <h3>DELEGATED DESIGN &amp; SCREENING NOTES</h3>
              <ol>
                <li>
                  <strong>NOT TO SCALE ON SCREEN.</strong> Screen preview is fitted to viewport (
                  {fittedRatio}). Read witnessed dimensions only; do not scale from screen.
                </li>
                <li>
                  <strong>DELEGATED DESIGN SCOPE.</strong> Final structural design, seismic
                  anchorage, and slab demand verification are by the Rack Manufacturer&apos;s
                  registered Professional Engineer of Record per ANSI/RMI MH16.1.
                </li>
                <li>
                  <strong>UNESTABLISHED DATUMS.</strong> Any quantity marked <code>VERIFY</code> has
                  not been field-verified or certified and must be established prior to submittal.
                </li>
              </ol>
            </aside>
          </div>

          <footer id="sheettb" className="sheet-titleblock" aria-label="Sheet title block">
            <div className="tb-cell">
              <span className="tb-label">CLIENT</span>
              <strong id="tb-client">{doc.client}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">PROJECT</span>
              <strong id="tb-proj">{doc.name}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SHEET TITLE</span>
              <strong id="tb-title">{currentSpec.title}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SCALE</span>
              <strong id="tb-scale">{fittedRatio} · NOT TO SCALE ON SCREEN</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">REVISION</span>
              <strong id="tb-rev">{doc.revision}</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">STATUS</span>
              <strong id="tb-date">SCREENING ONLY</strong>
            </div>
            <div className="tb-cell">
              <span className="tb-label">SHEET NO.</span>
              <strong id="tb-num">{currentSpec.id}</strong>
            </div>
            <div id="tb-stamp" className="tb-stamp" aria-label="Seal placeholder">
              PRELIMINARY SCREENING — NOT FOR CONSTRUCTION OR PERMITTING (NO EOR SEAL)
            </div>
            <div id="tb-packs" className="tb-packs">
              Packs: {doc.packs.rack} · {doc.packs.fire} · {doc.packs.structural}
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
