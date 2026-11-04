import {
  FORKLIFT_PLANNING_OPTIONS,
  PUBLISHED_BEAM_FAMILIES,
  PUBLISHED_BEAM_SPANS_IN,
  PUBLISHED_FRAME_DEPTH_OPTIONS,
  PUBLISHED_FRAME_OPTIONS,
  beamFamilyFromPartLabel,
  inchesToMicrometres,
  lookupForkliftPlanningOption,
  lookupFrameOption,
  lookupPublishedBeamSpan,
  planGeometry,
  type Command,
  type StudioDocument,
  type Witnessed,
} from '@rms/studio-model';
import { useState } from 'react';

import {
  ProvenancePopover,
  type ProvenanceInfo,
} from '../components/provenance-popover.js';

/**
 * The parameter rail — build-plan **S3.1** + **S4.4** + **S4.5**.
 *
 * Every edit dispatches a typed `Command` (`setField`, `addBeamLevel`,
 * `setBeamLevel`, `deleteBeamLevel`, `setAisleAfter`, `addRun`) through the
 * undo ledger.
 *
 * **Every value goes through its `Witnessed<T>`.** Established shows the value;
 * `UNKNOWN` shows a **VERIFY** badge beside the control until the user
 * establishes it (AC-07). Clicking any `?` (`.qbtn`) button opens the
 * provenance popover (`#prov`) showing the value's origin, stored micrometres,
 * and source citation.
 */

const MICROMETRES_PER_INCH = 25_400;

/** Inches, for display. A stored µm value is exact; this is one-way. */
function inches(micrometres: number): string {
  const n = micrometres / MICROMETRES_PER_INCH;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function parseInchesToUm(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  try {
    return inchesToMicrometres(n);
  } catch {
    return Math.round(n * MICROMETRES_PER_INCH);
  }
}

function ProvBtn({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="qbtn"
      onClick={onClick}
      aria-label={`Provenance for ${label}`}
      title={`Inspect provenance for ${label}`}
    >
      ?
    </button>
  );
}

export function ParamsPanel({
  document: doc,
  onCommand,
}: {
  readonly document: StudioDocument;
  readonly onCommand?: (command: Command) => void;
}): React.JSX.Element {
  const [prov, setProv] = useState<ProvenanceInfo | null>(null);
  const bt = doc.bayTypes[0];
  const plan = planGeometry(doc);
  const firstAisleIn =
    plan.aisles[0] !== undefined ? inches(plan.aisles[0].frameToFrame.value) : '120';

  const send = (cmd: Command): void => {
    onCommand?.(cmd);
  };

  const openWitnessedProv = (
    id: string,
    label: string,
    w: Witnessed<number> | Witnessed<string>,
    isLengthUm: boolean,
    suffix?: string,
  ): void => {
    const shown =
      typeof w.value === 'number'
        ? `${isLengthUm ? inches(w.value) : String(w.value)}${suffix ? ` ${suffix}` : ''}`
        : w.value || '—';
    setProv({
      id,
      label,
      established: w.established,
      displayValue: shown,
      ...(typeof w.value === 'number' && isLengthUm ? { rawMicrometres: w.value } : {}),
      source: w.source ?? (w.established === 'UNKNOWN' ? 'Not established' : 'User / document input'),
    });
  };

  const openInputProv = (
    id: string,
    label: string,
    displayValue: string,
    rawMicrometres?: number,
    origin: 'INPUT' | 'CATALOG' | 'DERIVED' = 'INPUT',
    source = 'User input recorded in StudioDocument',
  ): void => {
    setProv({
      id,
      label,
      established: origin,
      displayValue,
      ...(rawMicrometres !== undefined ? { rawMicrometres } : {}),
      source,
    });
  };

  return (
    <div className="params">
      <p className="pf-note">
        <b>Interactive parameters.</b> Every edit dispatches a reversible{' '}
        <code>setField</code> command to the undo ledger. Click <code>?</code> on any row to
        inspect provenance.
      </p>

      <ProvenancePopover info={prov} onClose={() => setProv(null)} />

      <section aria-labelledby="pf-project">
        <h2 id="pf-project" className="pf-heading">
          Project
        </h2>
        <div className="pf-row">
          <label htmlFor="f-name" className="pf-label">
            Job
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-name"
              type="text"
              className="pf-input"
              value={doc.name}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Set project name',
                  change: { section: 'project', patch: { name: e.target.value } },
                })
              }
            />
            <ProvBtn
              label="Job"
              onClick={() => openInputProv('f-name', 'Job', doc.name)}
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-client" className="pf-label">
            Client
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-client"
              type="text"
              className="pf-input"
              value={doc.client}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Set client',
                  change: { section: 'project', patch: { client: e.target.value } },
                })
              }
            />
            <ProvBtn
              label="Client"
              onClick={() => openInputProv('f-client', 'Client', doc.client)}
            />
          </span>
        </div>

        <div className="pf-row">
          <span className="pf-label">Revision</span>
          <span className="pf-value pf-controls">
            <span>{doc.revision}</span>
            <ProvBtn
              label="Revision"
              onClick={() => openInputProv('f-rev', 'Revision', doc.revision)}
            />
          </span>
        </div>
      </section>

      <section aria-labelledby="pf-building">
        <h2 id="pf-building" className="pf-heading">
          Building <span className="pf-sub">survey and declaration</span>
        </h2>

        <div className="pf-row">
          <label htmlFor="f-clearh" className="pf-label">
            Clear internal height
          </label>
          <span className="pf-value pf-controls">
            {doc.building.clearHeight.established === 'UNKNOWN' && (
              <span className="pf-badge">VERIFY</span>
            )}
            <input
              id="f-clearh"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.building.clearHeight.value)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set clear internal height',
                    change: {
                      section: 'building',
                      patch: {
                        clearHeight: {
                          value: um,
                          established: 'INPUT',
                          source: 'User survey entry',
                        },
                      },
                    },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <input
              id="f-clearh-v"
              type="checkbox"
              aria-label="Clear internal height verified"
              checked={doc.building.clearHeight.established !== 'UNKNOWN'}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Toggle clear height verification',
                  change: {
                    section: 'building',
                    patch: {
                      clearHeight: {
                        value: doc.building.clearHeight.value,
                        established: e.target.checked ? 'INPUT' : 'UNKNOWN',
                        source: e.target.checked ? 'User verified' : 'Marked unverified',
                      },
                    },
                  },
                })
              }
            />
            <ProvBtn
              label="Clear internal height"
              onClick={() =>
                openWitnessedProv(
                  'f-clearh',
                  'Clear internal height',
                  doc.building.clearHeight,
                  true,
                  'in',
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-defl" className="pf-label">
            Sprinkler deflector elev.
          </label>
          <span className="pf-value pf-controls">
            {doc.building.deflectorElev.established === 'UNKNOWN' && (
              <span className="pf-badge">VERIFY</span>
            )}
            <input
              id="f-defl"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.building.deflectorElev.value)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set sprinkler deflector elevation',
                    change: {
                      section: 'building',
                      patch: {
                        deflectorElev: {
                          value: um,
                          established: 'INPUT',
                          source: 'User survey entry',
                        },
                      },
                    },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <input
              id="f-defl-v"
              type="checkbox"
              aria-label="Sprinkler deflector elevation verified"
              checked={doc.building.deflectorElev.established !== 'UNKNOWN'}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Toggle sprinkler deflector verification',
                  change: {
                    section: 'building',
                    patch: {
                      deflectorElev: {
                        value: doc.building.deflectorElev.value,
                        established: e.target.checked ? 'INPUT' : 'UNKNOWN',
                        source: e.target.checked ? 'User verified' : 'Marked unverified',
                      },
                    },
                  },
                })
              }
            />
            <ProvBtn
              label="Sprinkler deflector elev."
              onClick={() =>
                openWitnessedProv(
                  'f-defl',
                  'Sprinkler deflector elev.',
                  doc.building.deflectorElev,
                  true,
                  'in',
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-sprink" className="pf-label">
            Building is sprinklered
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-sprink"
              type="checkbox"
              checked={doc.building.sprinklered}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Set building sprinklered state',
                  change: {
                    section: 'building',
                    patch: { sprinklered: e.target.checked },
                  },
                })
              }
            />
            <span>{doc.building.sprinklered ? 'Yes' : 'No'}</span>
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-insurer" className="pf-label">
            Flue regime
          </label>
          <span className="pf-value pf-controls">
            <select
              id="f-insurer"
              className="pf-select"
              value={doc.building.insurer}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Set flue regime',
                  change: {
                    section: 'building',
                    patch: { insurer: e.target.value },
                  },
                })
              }
            >
              <option value="NFPA">NFPA</option>
              <option value="FM">FM</option>
              <option value="None">None</option>
            </select>
            <ProvBtn
              label="Flue regime"
              onClick={() =>
                openInputProv('f-insurer', 'Flue regime', doc.building.insurer)
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-comm" className="pf-label">
            Commodity class
          </label>
          <span className="pf-value pf-controls">
            {doc.building.commodityClass.established === 'UNKNOWN' && (
              <span className="pf-badge">VERIFY</span>
            )}
            <select
              id="f-comm"
              className="pf-select"
              value={doc.building.commodityClass.value}
              onChange={(e) => {
                const v = e.target.value;
                send({
                  type: 'setField',
                  label: 'Set commodity class',
                  change: {
                    section: 'building',
                    patch: {
                      commodityClass: {
                        value: v,
                        established: v === '' ? 'UNKNOWN' : 'INPUT',
                        source: v === '' ? 'Not declared' : 'User declaration',
                      },
                    },
                  },
                });
              }}
            >
              <option value="">Unestablished (VERIFY)</option>
              <option value="Class I">Class I</option>
              <option value="Class II">Class II</option>
              <option value="Class III">Class III</option>
              <option value="Class IV">Class IV</option>
              <option value="Cartoned Unexpanded Plastic">Cartoned Unexpanded Plastic</option>
            </select>
            <ProvBtn
              label="Commodity class"
              onClick={() =>
                openWitnessedProv(
                  'f-comm',
                  'Commodity class',
                  doc.building.commodityClass,
                  false,
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-sdc" className="pf-label">
            Seismic design cat.
          </label>
          <span className="pf-value pf-controls">
            {doc.building.sdc.established === 'UNKNOWN' && (
              <span className="pf-badge">VERIFY</span>
            )}
            <select
              id="f-sdc"
              className="pf-select"
              value={doc.building.sdc.value}
              onChange={(e) => {
                const v = e.target.value;
                send({
                  type: 'setField',
                  label: 'Set seismic design category',
                  change: {
                    section: 'building',
                    patch: {
                      sdc: {
                        value: v,
                        established: v === '' ? 'UNKNOWN' : 'INPUT',
                        source: v === '' ? 'Not declared' : 'User declaration',
                      },
                    },
                  },
                });
              }}
            >
              <option value="">Unestablished (VERIFY)</option>
              <option value="A">SDC A</option>
              <option value="B">SDC B</option>
              <option value="C">SDC C</option>
              <option value="D">SDC D</option>
              <option value="E">SDC E</option>
              <option value="F">SDC F</option>
            </select>
            <ProvBtn
              label="Seismic design cat."
              onClick={() =>
                openWitnessedProv('f-sdc', 'Seismic design cat.', doc.building.sdc, false)
              }
            />
          </span>
        </div>
      </section>

      <section aria-labelledby="pf-equipment">
        <h2 id="pf-equipment" className="pf-heading">
          Material handling <span className="pf-sub">truck & aisle</span>
        </h2>

        <div className="pf-row">
          <label htmlFor="f-truck" className="pf-label">
            Lift truck type
          </label>
          <span className="pf-value pf-controls">
            <select
              id="f-truck"
              className="pf-select"
              value={doc.equipment.truckType}
              onChange={(e) => {
                const nextType = e.target.value;
                const planning = lookupForkliftPlanningOption(nextType);
                send({
                  type: 'setField',
                  label: 'Set lift truck type',
                  change: {
                    section: 'equipment',
                    patch:
                      planning !== undefined
                        ? {
                            truckType: nextType,
                            truckRAS: {
                              value: planning.planningAstUm,
                              established: 'UNKNOWN',
                              source: `forklift-planning-2026.09 (${planning.manufacturerBand} · MS-6, MS-14 planning seed)`,
                            },
                          }
                        : { truckType: nextType },
                  },
                });
              }}
            >
              {FORKLIFT_PLANNING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.truckType}>
                  {opt.truckType} ({opt.planningAstIn}&quot; planning AST · VERIFY)
                </option>
              ))}
            </select>
            <ProvBtn
              label="Lift truck type"
              onClick={() =>
                openInputProv(
                  'f-truck',
                  'Lift truck type',
                  doc.equipment.truckType,
                  undefined,
                  'CATALOG',
                  `Seed pack ${doc.packs.forklift || 'forklift-planning-2026.09'} (MS-6, MS-14)`,
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-minaisle" className="pf-label">
            Truck mfr min aisle
          </label>
          <span className="pf-value pf-controls">
            {doc.equipment.truckRAS.established === 'UNKNOWN' && (
              <span className="pf-badge">VERIFY</span>
            )}
            <input
              id="f-minaisle"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.equipment.truckRAS.value)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set truck min right-angle stacking aisle',
                    change: {
                      section: 'equipment',
                      patch: {
                        truckRAS: {
                          value: um,
                          established: 'INPUT',
                          source: 'Truck spec sheet entry',
                        },
                      },
                    },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <input
              id="f-minaisle-v"
              type="checkbox"
              aria-label="Truck mfr min aisle verified"
              checked={doc.equipment.truckRAS.established !== 'UNKNOWN'}
              onChange={(e) =>
                send({
                  type: 'setField',
                  label: 'Toggle truck min aisle verification',
                  change: {
                    section: 'equipment',
                    patch: {
                      truckRAS: {
                        value: doc.equipment.truckRAS.value,
                        established: e.target.checked ? 'INPUT' : 'UNKNOWN',
                        source: e.target.checked ? 'User verified' : 'Marked unverified',
                      },
                    },
                  },
                })
              }
            />
            <ProvBtn
              label="Truck mfr min aisle"
              onClick={() =>
                openWitnessedProv(
                  'f-minaisle',
                  'Truck mfr min aisle',
                  doc.equipment.truckRAS,
                  true,
                  'in',
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-aisle" className="pf-label">
            Frame-to-frame aisle
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-aisle"
              type="number"
              className="pf-input pf-input-num"
              value={firstAisleIn}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                const firstRun = doc.runs[0];
                if (um !== null && um > 0 && firstRun !== undefined) {
                  send({
                    type: 'setAisleAfter',
                    runId: firstRun.id,
                    frameToFrame: um,
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
          </span>
        </div>

        <div className="pf-row">
          <button
            id="addrun"
            type="button"
            className="pf-btn"
            onClick={() => send({ type: 'addRun' })}
          >
            + Add rack run
          </button>
        </div>
      </section>

      <section aria-labelledby="pf-unit-load">
        <h2 id="pf-unit-load" className="pf-heading">
          Unit load
        </h2>

        <div className="pf-row">
          <label htmlFor="f-pw" className="pf-label">
            Pallet width, aisle face
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-pw"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.unitLoad.palletW)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set pallet width',
                    change: { section: 'unitLoad', patch: { palletW: um } },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <ProvBtn
              label="Pallet width, aisle face"
              onClick={() =>
                openInputProv(
                  'f-pw',
                  'Pallet width, aisle face',
                  `${inches(doc.unitLoad.palletW)} in`,
                  doc.unitLoad.palletW,
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-pd" className="pf-label">
            Pallet depth, into rack
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-pd"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.unitLoad.palletD)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set pallet depth',
                    change: { section: 'unitLoad', patch: { palletD: um } },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <ProvBtn
              label="Pallet depth, into rack"
              onClick={() =>
                openInputProv(
                  'f-pd',
                  'Pallet depth, into rack',
                  `${inches(doc.unitLoad.palletD)} in`,
                  doc.unitLoad.palletD,
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-ulh" className="pf-label">
            Unit load height
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-ulh"
              type="number"
              className="pf-input pf-input-num"
              value={inches(doc.unitLoad.height)}
              onChange={(e) => {
                const um = parseInchesToUm(e.target.value);
                if (um !== null && um > 0) {
                  send({
                    type: 'setField',
                    label: 'Set unit load height',
                    change: { section: 'unitLoad', patch: { height: um } },
                  });
                }
              }}
            />
            <span className="pf-suffix">in</span>
            <ProvBtn
              label="Unit load height"
              onClick={() =>
                openInputProv(
                  'f-ulh',
                  'Unit load height',
                  `${inches(doc.unitLoad.height)} in`,
                  doc.unitLoad.height,
                )
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-ulw" className="pf-label">
            Rated load
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-ulw"
              type="number"
              className="pf-input pf-input-num"
              value={String(doc.unitLoad.weight)}
              onChange={(e) => {
                const lb = Number(e.target.value);
                if (Number.isFinite(lb) && lb > 0) {
                  send({
                    type: 'setField',
                    label: 'Set unit load weight',
                    change: { section: 'unitLoad', patch: { weight: lb } },
                  });
                }
              }}
            />
            <span className="pf-suffix">lb</span>
            <ProvBtn
              label="Rated load"
              onClick={() =>
                openInputProv('f-ulw', 'Rated load', `${doc.unitLoad.weight} lb`)
              }
            />
          </span>
        </div>

        <div className="pf-row">
          <label htmlFor="f-ldf" className="pf-label">
            Load distribution factor
          </label>
          <span className="pf-value pf-controls">
            <input
              id="f-ldf"
              type="number"
              step="0.05"
              className="pf-input pf-input-num"
              value={String(doc.loadDistributionFactor)}
              onChange={(e) => {
                const f = Number(e.target.value);
                if (Number.isFinite(f) && f > 0) {
                  send({
                    type: 'setField',
                    label: 'Set load distribution factor',
                    change: {
                      section: 'project',
                      patch: { loadDistributionFactor: f },
                    },
                  });
                }
              }}
            />
            <ProvBtn
              label="Load distribution factor"
              onClick={() =>
                openInputProv(
                  'f-ldf',
                  'Load distribution factor',
                  String(doc.loadDistributionFactor),
                )
              }
            />
          </span>
        </div>
      </section>

      {bt !== undefined && (
        <section aria-labelledby="pf-bay-type">
          <h2 id="pf-bay-type" className="pf-heading">
            Bay type — {bt.name} <span className="pf-sub">from catalog ({doc.packs.rack || 'interlake-2026-09'})</span>
          </h2>

          <div className="pf-row">
            <label htmlFor="f-uppart" className="pf-label">
              Upright
            </label>
            <span className="pf-value pf-controls">
              <select
                id="f-uppart"
                className="pf-select"
                value={bt.uprightPart}
                onChange={(e) => {
                  const nextPart = e.target.value;
                  const frameOpt = lookupFrameOption(nextPart);
                  send({
                    type: 'setField',
                    label: 'Set upright part',
                    change: {
                      section: 'bayType',
                      bayTypeId: bt.id,
                      patch:
                        frameOpt !== undefined
                          ? {
                              uprightPart: nextPart,
                              uprightWidth: frameOpt.uprightWidthUm,
                            }
                          : { uprightPart: nextPart },
                    },
                  });
                }}
              >
                {PUBLISHED_FRAME_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ProvBtn
                label="Upright"
                onClick={() =>
                  openInputProv(
                    'f-uppart',
                    'Upright',
                    bt.uprightPart,
                    undefined,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack}`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <span className="pf-label">Upright face</span>
            <span className="pf-value pf-controls">
              <span>{inches(bt.uprightWidth)}</span>
              <span className="pf-suffix">in</span>
              <ProvBtn
                label="Upright face"
                onClick={() =>
                  openInputProv(
                    'f-upw',
                    'Upright face',
                    `${inches(bt.uprightWidth)} in`,
                    bt.uprightWidth,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack}`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-fd" className="pf-label">
              Frame depth
            </label>
            <span className="pf-value pf-controls">
              <select
                id="f-fd"
                className="pf-select"
                value={String(Math.round(bt.frameDepth / MICROMETRES_PER_INCH))}
                onChange={(e) => {
                  const um = parseInchesToUm(e.target.value);
                  if (um !== null && um > 0) {
                    send({
                      type: 'setField',
                      label: 'Set frame depth',
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: { frameDepth: um },
                      },
                    });
                  }
                }}
              >
                {PUBLISHED_FRAME_DEPTH_OPTIONS.map((d) => (
                  <option key={d.depthIn} value={String(d.depthIn)}>
                    {d.label}
                  </option>
                ))}
              </select>
              <ProvBtn
                label="Frame depth"
                onClick={() =>
                  openInputProv(
                    'f-fd',
                    'Frame depth',
                    `${inches(bt.frameDepth)} in`,
                    bt.frameDepth,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack}`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-fh" className="pf-label">
              Frame height
            </label>
            <span className="pf-value pf-controls">
              {bt.frameHeight.established === 'UNKNOWN' && (
                <span className="pf-badge">VERIFY</span>
              )}
              <input
                id="f-fh"
                type="number"
                className="pf-input pf-input-num"
                value={inches(bt.frameHeight.value)}
                onChange={(e) => {
                  const um = parseInchesToUm(e.target.value);
                  if (um !== null && um > 0) {
                    send({
                      type: 'setField',
                      label: 'Set frame height',
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: {
                          frameHeight: {
                            value: um,
                            established: 'INPUT',
                            source: 'User frame height entry',
                          },
                        },
                      },
                    });
                  }
                }}
              />
              <span className="pf-suffix">in</span>
              <input
                id="f-fh-v"
                type="checkbox"
                aria-label="Frame height verified"
                checked={bt.frameHeight.established !== 'UNKNOWN'}
                onChange={(e) =>
                  send({
                    type: 'setField',
                    label: 'Toggle frame height verification',
                    change: {
                      section: 'bayType',
                      bayTypeId: bt.id,
                      patch: {
                        frameHeight: {
                          value: bt.frameHeight.value,
                          established: e.target.checked ? 'CATALOG' : 'UNKNOWN',
                          source: e.target.checked
                            ? `Catalog ${doc.packs.rack}`
                            : 'Marked unverified',
                        },
                      },
                    },
                  })
                }
              />
              <ProvBtn
                label="Frame height"
                onClick={() =>
                  openWitnessedProv('f-fh', 'Frame height', bt.frameHeight, true, 'in')
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-bmfamily" className="pf-label">
              Beam family &amp; series
            </label>
            <span className="pf-value pf-controls">
              <select
                id="f-bmfamily"
                className="pf-select"
                value={beamFamilyFromPartLabel(bt.beamPart)}
                onChange={(e) => {
                  const nextFamily = e.target.value;
                  const curSpanIn = Math.round(bt.beamLength / MICROMETRES_PER_INCH);
                  const looked = lookupPublishedBeamSpan(nextFamily, curSpanIn);
                  send({
                    type: 'setField',
                    label: 'Set beam family',
                    change: {
                      section: 'bayType',
                      bayTypeId: bt.id,
                      patch:
                        looked.status === 'ON_GRID'
                          ? {
                              beamPart: looked.beamPartLabel,
                              beamPairCapacity: {
                                value: looked.capacityLb,
                                established: 'CATALOG',
                                source: `Catalog ${doc.packs.rack || 'interlake-2026-09'} (${looked.family}/${looked.series}/${looked.spanIn}" · PSG 2025 p.88)`,
                              },
                            }
                          : { beamPart: `${curSpanIn}" ${nextFamily} STEP BEAM` },
                    },
                  });
                }}
              >
                {PUBLISHED_BEAM_FAMILIES.map((fam) => (
                  <option key={fam.family} value={fam.family}>
                    {fam.label}
                  </option>
                ))}
              </select>
              <ProvBtn
                label="Beam family & series"
                onClick={() =>
                  openInputProv(
                    'f-bmfamily',
                    'Beam family & series',
                    beamFamilyFromPartLabel(bt.beamPart),
                    undefined,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack || 'interlake-2026-09'} (PSG 2025 p.84 / p.88)`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-bmpart" className="pf-label">
              Beam published span
            </label>
            <span className="pf-value pf-controls">
              <select
                id="f-bmpart"
                className="pf-select"
                value={String(Math.round(bt.beamLength / MICROMETRES_PER_INCH))}
                onChange={(e) => {
                  const nextSpanIn = Number(e.target.value);
                  const curFamily = beamFamilyFromPartLabel(bt.beamPart);
                  const looked = lookupPublishedBeamSpan(curFamily, nextSpanIn);
                  if (looked.status === 'ON_GRID') {
                    send({
                      type: 'setField',
                      label: 'Set beam span from catalog',
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: {
                          beamPart: looked.beamPartLabel,
                          beamLength: looked.spanUm,
                          beamPairCapacity: {
                            value: looked.capacityLb,
                            established: 'CATALOG',
                            source: `Catalog ${doc.packs.rack || 'interlake-2026-09'} (${looked.family}/${looked.series}/${looked.spanIn}" · PSG 2025 p.88)`,
                          },
                        },
                      },
                    });
                  }
                }}
              >
                {PUBLISHED_BEAM_SPANS_IN.map((spanIn) => (
                  <option key={spanIn} value={String(spanIn)}>
                    {spanIn}&quot; ({beamFamilyFromPartLabel(bt.beamPart)} published span)
                  </option>
                ))}
              </select>
              <ProvBtn
                label="Beam"
                onClick={() =>
                  openInputProv(
                    'f-bmpart',
                    'Beam',
                    bt.beamPart,
                    undefined,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack}`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <span className="pf-label">Beam clear span</span>
            <span className="pf-value pf-controls">
              <span>{inches(bt.beamLength)}</span>
              <span className="pf-suffix">in</span>
              <ProvBtn
                label="Beam clear span"
                onClick={() =>
                  openInputProv(
                    'f-bmlen',
                    'Beam clear span',
                    `${inches(bt.beamLength)} in`,
                    bt.beamLength,
                    'CATALOG',
                    `Pinned catalog pack ${doc.packs.rack}`,
                  )
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-ppb" className="pf-label">
              Pallets per bay
            </label>
            <span className="pf-value pf-controls">
              <input
                id="f-ppb"
                type="number"
                className="pf-input pf-input-num"
                value={String(bt.palletsPerBay)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) {
                    send({
                      type: 'setField',
                      label: 'Set pallets per bay',
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: { palletsPerBay: n },
                      },
                    });
                  }
                }}
              />
              <ProvBtn
                label="Pallets per bay"
                onClick={() =>
                  openInputProv('f-ppb', 'Pallets per bay', String(bt.palletsPerBay))
                }
              />
            </span>
          </div>

          <div className="pf-row">
            <label htmlFor="f-bmcap" className="pf-label">
              Beam pair capacity
            </label>
            <span className="pf-value pf-controls">
              {bt.beamPairCapacity.established === 'UNKNOWN' && (
                <span className="pf-badge">VERIFY</span>
              )}
              <input
                id="f-bmcap"
                type="number"
                className="pf-input pf-input-num"
                value={String(bt.beamPairCapacity.value)}
                onChange={(e) => {
                  const lb = Number(e.target.value);
                  if (Number.isFinite(lb) && lb > 0) {
                    send({
                      type: 'setField',
                      label: 'Set beam pair capacity',
                      change: {
                        section: 'bayType',
                        bayTypeId: bt.id,
                        patch: {
                          beamPairCapacity: {
                            value: lb,
                            established: 'INPUT',
                            source: 'User beam capacity entry',
                          },
                        },
                      },
                    });
                  }
                }}
              />
              <span className="pf-suffix">lb</span>
              <input
                id="f-bmcap-v"
                type="checkbox"
                aria-label="Beam pair capacity verified"
                checked={bt.beamPairCapacity.established !== 'UNKNOWN'}
                onChange={(e) =>
                  send({
                    type: 'setField',
                    label: 'Toggle beam pair capacity verification',
                    change: {
                      section: 'bayType',
                      bayTypeId: bt.id,
                      patch: {
                        beamPairCapacity: {
                          value: bt.beamPairCapacity.value,
                          established: e.target.checked ? 'CATALOG' : 'UNKNOWN',
                          source: e.target.checked
                            ? `Catalog ${doc.packs.rack}`
                            : 'Marked unverified',
                        },
                      },
                    },
                  })
                }
              />
              <ProvBtn
                label="Beam pair capacity"
                onClick={() =>
                  openWitnessedProv(
                    'f-bmcap',
                    'Beam pair capacity',
                    bt.beamPairCapacity,
                    false,
                    'lb',
                  )
                }
              />
            </span>
          </div>

          <div id="levels" className="pf-levels" aria-label="Beam levels">
            <div className="pf-levels-head">
              <span className="pf-label">Beam levels ({bt.beamLevels.length})</span>
              <button
                id="addlvl"
                type="button"
                className="pf-btn pf-btn-small"
                onClick={() => {
                  const topMost = bt.beamLevels[bt.beamLevels.length - 1] ?? 0;
                  send({
                    type: 'addBeamLevel',
                    bayTypeId: bt.id,
                    top: topMost + 60 * MICROMETRES_PER_INCH,
                  });
                }}
              >
                + Level
              </button>
            </div>
            {bt.beamLevels.map((lvlUm, idx) => (
              <div key={idx} className="pf-level-row">
                <span className="pf-level-tag">L{idx + 1}</span>
                <input
                  type="number"
                  className="pf-input pf-input-num"
                  data-lvl={idx}
                  aria-label={`Beam level ${idx + 1} elevation in inches`}
                  value={inches(lvlUm)}
                  onChange={(e) => {
                    const um = parseInchesToUm(e.target.value);
                    if (um !== null && um > 0) {
                      send({
                        type: 'setBeamLevel',
                        bayTypeId: bt.id,
                        index: idx,
                        top: um,
                      });
                    }
                  }}
                />
                <span className="pf-suffix">in</span>
                <button
                  type="button"
                  className="pf-level-del"
                  data-del={idx}
                  aria-label={`Remove beam level ${idx + 1}`}
                  onClick={() =>
                    send({ type: 'deleteBeamLevel', bayTypeId: bt.id, index: idx })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
