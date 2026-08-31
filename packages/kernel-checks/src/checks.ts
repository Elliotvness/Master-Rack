/**
 * The twelve MVP-1 checks (blueprint §11.4).
 *
 * Every check here is pure and states only what it OBSERVED. None of them
 * applies a tier ceiling, and none of them can: a check returns `Observation`,
 * and only the framework turns that into a `Finding`. Checks 1, 2 and 7 apply
 * only to catalog parts; check 12 fires in their place on uncatalogued
 * material, and on roughly half of all jobs it will.
 *
 * The discipline these checks keep, stated once:
 *   - No catalog or rule NUMBER appears here. Values arrive from pinned data or
 *     client input, already carrying provenance.
 *   - An UNKNOWN input propagates to an unestablished parameter rather than
 *     being laundered into a number.
 *   - Every observation states what would close it.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import {
  type Quantity,
  compare,
  convert,
  isEstablished,
  isEstablishedOrigin,
  subtract,
  unestablished,
  type ProvenanceNode,
} from '@rms/kernel-units';

import { type Check, type Observation } from './framework.js';
import { param, unknownParam } from './finding.js';

/* ------------------------------------------------------------------ *
 * The input the MVP check set reads.
 *
 * Deliberately a plain, fully-derived snapshot: the checks do no derivation of
 * their own, so a check and the display list can never disagree about a number.
 * ------------------------------------------------------------------ */

/** A beam level within a bay. */
export interface LevelInput {
  readonly id: string;
  /** Elevation of the beam top above the floor. */
  readonly elevation: Quantity;
  /** The load the client intends to place on this level, per bay. */
  readonly load: Quantity | null;
  /** True when this level stores product (a floor position may not). */
  readonly stores: boolean;
}

export interface CapacityLookup {
  /** 'ON_GRID' with a capacity, or off-grid/absent with none. */
  readonly status: 'ON_GRID' | 'OFF_GRID' | 'NOT_FOUND';
  readonly capacity: Quantity | null;
  /** The published brackets, when off-grid. Reported, never interpolated. */
  readonly lowerSpanIn: number | null;
  readonly upperSpanIn: number | null;
}

export interface PartInput {
  readonly id: string;
  readonly description: string;
  /** Null when the part is not in the pinned catalog: uncatalogued material. */
  readonly partRevisionId: string | null;
  readonly discontinued: boolean;
}

export interface CheckInput {
  readonly runId: string;
  /** Upright frame height. */
  readonly frameHeight: Quantity;
  readonly levels: readonly LevelInput[];
  /** Beam clear span actually selected. */
  readonly beamSpan: Quantity;
  /** Result of the no-interpolation catalog lookup for the selected beam. */
  readonly beamCapacity: CapacityLookup;
  /** Whether the catalog publishes this beam against this frame. Null = unknown. */
  readonly beamFrameCompatible: boolean | null;
  /** Stated building clear height. Null when not surveyed. */
  readonly clearHeight: Quantity | null;
  /** Height of the tallest load above the top beam. */
  readonly topOfLoad: Quantity | null;
  /** Aisle clear width between load faces, from kernel-derive. */
  readonly aisleClearWidth: Quantity | null;
  /** The handling equipment's stated requirement. Null when not supplied. */
  readonly aisleRequired: Quantity | null;
  /** Pallet overhang front and rear, already allocated (never halved). */
  readonly overhangFront: Quantity | null;
  readonly overhangRear: Quantity | null;
  readonly parts: readonly PartInput[];
  /** Provenance roots for every derived output that will be displayed. */
  readonly derivedOutputs: readonly { readonly label: string; readonly node: ProvenanceNode }[];
  readonly columnGridResolved: boolean;
  readonly commodityClassEstablished: boolean;
  /** Measured flue geometry, reported with no verdict. Null when not derivable. */
  readonly transverseFlue: Quantity | null;
}

const NO_IDS: readonly string[] = Object.freeze([]);

function obs(o: Observation): Observation {
  return Object.freeze({
    ...o,
    subjectObjectIds: Object.freeze([...o.subjectObjectIds]),
    parameters: Object.freeze([...o.parameters]),
  });
}

/* ------------------------------------------------------------------ *
 * 1. Beam / frame compatibility
 * ------------------------------------------------------------------ */

export const beamFrameFit: Check<CheckInput> = {
  code: 'BEAM_FRAME_INCOMPATIBLE',
  ruleId: 'GEOM-BEAM-FRAME-FIT',
  run(input) {
    // Applies to catalog parts only. Uncatalogued material is check 12's job,
    // and reporting an incompatibility we cannot establish would be an invented
    // conclusion.
    if (input.beamFrameCompatible === null) {
      return [
        obs({
          code: 'BEAM_FRAME_INCOMPATIBLE',
          observed: 'NOT_EVALUATED',
          subjectObjectIds: [input.runId],
          parameters: [
            unknownParam(
              'published compatibility',
              'the pinned catalog does not publish a compatibility statement for this beam and frame',
            ),
          ],
          closedBy: 'Select a beam and frame the pinned catalog publishes together.',
        }),
      ];
    }
    if (input.beamFrameCompatible) return [];
    return [
      obs({
        code: 'BEAM_FRAME_INCOMPATIBLE',
        observed: 'BLOCKER',
        subjectObjectIds: [input.runId],
        parameters: [param('beam clear span', input.beamSpan)],
        closedBy:
          'Select a beam published as compatible with this frame connector and depth, or change the frame.',
      }),
    ];
  },
};

/* ------------------------------------------------------------------ *
 * 2. Beam pair capacity vs level load, exact span only
 * ------------------------------------------------------------------ */

export const beamCapacity: Check<CheckInput> = {
  code: 'BEAM_CAPACITY_EXCEEDED',
  ruleId: 'CAP-BEAM-PAIR',
  run(input) {
    const out: Observation[] = [];

    // Off-grid is NOT EVALUATED, never a nearest match. This is the single most
    // important behaviour in the product: the brackets are reported and no
    // capacity value is produced.
    if (input.beamCapacity.status !== 'ON_GRID' || input.beamCapacity.capacity === null) {
      const brackets =
        input.beamCapacity.lowerSpanIn !== null && input.beamCapacity.upperSpanIn !== null
          ? `the published grid brackets it at ${input.beamCapacity.lowerSpanIn}" and ${input.beamCapacity.upperSpanIn}"`
          : 'this beam is not published for this series';
      return [
        obs({
          code: 'BEAM_CAPACITY_OFF_GRID',
          observed: 'NOT_EVALUATED',
          subjectObjectIds: [input.runId],
          parameters: [
            param('requested span', input.beamSpan),
            unknownParam(
              'published capacity',
              `the engine does not interpolate between published spans; ${brackets}`,
            ),
          ],
          closedBy:
            'Choose a published span. The engine does not interpolate between grid values, so no capacity can be stated for this one.',
        }),
      ];
    }

    const capacity = input.beamCapacity.capacity;
    for (const level of input.levels) {
      if (!level.stores) continue;
      if (level.load === null) {
        out.push(
          obs({
            code: 'BEAM_CAPACITY_LOAD_UNKNOWN',
            observed: 'MISSING_INPUT',
            subjectObjectIds: [level.id],
            parameters: [unknownParam('level load', 'no load was stated for this level')],
            closedBy: 'State the intended load for this level.',
          }),
        );
        continue;
      }
      // Both are per-pair loads. kernel-units refuses the conversion that would
      // silently halve or double a rating, so no unit juggling happens here.
      if (compare(level.load, capacity) > 0) {
        out.push(
          obs({
            code: 'BEAM_CAPACITY_EXCEEDED',
            observed: 'BLOCKER',
            subjectObjectIds: [level.id],
            parameters: [param('level load', level.load), param('published capacity', capacity)],
            closedBy:
              'Reduce the level load, shorten the span, or select a heavier beam with published capacity at this span.',
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 3. Level elevations distinct, monotonic, within the frame
 * ------------------------------------------------------------------ */

export const levelElevations: Check<CheckInput> = {
  code: 'LEVEL_ELEVATION_INVALID',
  ruleId: 'GEOM-LEVEL-DISTINCT',
  run(input) {
    const out: Observation[] = [];
    const levels = input.levels;

    for (let i = 1; i < levels.length; i += 1) {
      const prev = levels[i - 1] as LevelInput;
      const cur = levels[i] as LevelInput;
      const order = compare(cur.elevation, prev.elevation);
      if (order === 0) {
        out.push(
          obs({
            code: 'LEVEL_ELEVATION_DUPLICATE',
            observed: 'BLOCKER',
            subjectObjectIds: [prev.id, cur.id],
            parameters: [param('elevation', cur.elevation)],
            closedBy: 'Give each beam level a distinct elevation.',
          }),
        );
      } else if (order < 0) {
        out.push(
          obs({
            code: 'LEVEL_ELEVATION_OUT_OF_ORDER',
            observed: 'BLOCKER',
            subjectObjectIds: [prev.id, cur.id],
            parameters: [param('elevation', cur.elevation), param('previous elevation', prev.elevation)],
            closedBy: 'Order the beam levels from the floor upwards.',
          }),
        );
      }
    }

    for (const level of levels) {
      if (compare(level.elevation, input.frameHeight) > 0) {
        out.push(
          obs({
            code: 'LEVEL_ABOVE_FRAME',
            observed: 'BLOCKER',
            subjectObjectIds: [level.id],
            parameters: [param('elevation', level.elevation), param('frame height', input.frameHeight)],
            closedBy: 'Lower the level, or select a taller upright frame.',
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 4. Top of load within the stated clear height
 * ------------------------------------------------------------------ */

export const topOfLoad: Check<CheckInput> = {
  code: 'TOP_OF_LOAD_EXCEEDS_CLEAR_HEIGHT',
  ruleId: 'GEOM-TOP-OF-LOAD',
  run(input) {
    // A missing clear height is check 9's business. Reporting it here too would
    // give the client the same problem twice on one screen.
    if (input.clearHeight === null || input.topOfLoad === null) return [];

    if (compare(input.topOfLoad, input.clearHeight) > 0) {
      return [
        obs({
          code: 'TOP_OF_LOAD_EXCEEDS_CLEAR_HEIGHT',
          observed: 'BLOCKER',
          subjectObjectIds: [input.runId],
          parameters: [
            param('top of load', input.topOfLoad),
            param('stated clear height', input.clearHeight),
            param('overrun', subtract(input.topOfLoad, input.clearHeight)),
          ],
          closedBy:
            'Reduce the top beam elevation or the load height so the loaded rack fits within the stated clear height.',
        }),
      ];
    }
    return [];
  },
};

/* ------------------------------------------------------------------ *
 * 5. Aisle clear width vs the equipment requirement
 * ------------------------------------------------------------------ */

export const aisleClearance: Check<CheckInput> = {
  code: 'AISLE_CLEAR_SHORTFALL',
  ruleId: 'AISLE-CLEAR-WIDTH',
  run(input) {
    if (input.aisleRequired === null) {
      return [
        obs({
          code: 'AISLE_REQUIREMENT_UNKNOWN',
          observed: 'MISSING_INPUT',
          subjectObjectIds: [input.runId],
          parameters: [
            unknownParam(
              'required aisle width',
              'no handling-equipment requirement was supplied',
            ),
          ],
          closedBy:
            'State the aisle width your handling equipment requires, from its data sheet.',
        }),
      ];
    }
    if (input.aisleClearWidth === null) return [];

    if (compare(input.aisleClearWidth, input.aisleRequired) < 0) {
      return [
        obs({
          code: 'AISLE_CLEAR_SHORTFALL',
          // Observed as a blocker. The rule sits at SECONDARY tier, so the
          // framework will cap this at ENGINEERING REVIEW REQUIRED — the check
          // does not know that and must not.
          observed: 'BLOCKER',
          subjectObjectIds: [input.runId],
          parameters: [
            param('aisle clear width', input.aisleClearWidth),
            param('required', input.aisleRequired),
            param('shortfall', subtract(input.aisleRequired, input.aisleClearWidth)),
          ],
          closedBy:
            'Widen the aisle, reduce the pallet overhang, or confirm the equipment requirement.',
        }),
      ];
    }
    return [];
  },
};

/* ------------------------------------------------------------------ *
 * 6. Pallet fits the bay: overhang allocated, not halved
 * ------------------------------------------------------------------ */

export const palletOverhang: Check<CheckInput> = {
  code: 'PALLET_OVERHANG',
  ruleId: 'GEOM-PALLET-OVERHANG',
  run(input) {
    if (input.overhangFront === null || input.overhangRear === null) return [];

    const out: Observation[] = [];
    // A negative overhang means the pallet does not fit the bay at all.
    for (const [name, value] of [
      ['front overhang', input.overhangFront],
      ['rear overhang', input.overhangRear],
    ] as const) {
      if (convert(value, 'um') < 0) {
        out.push(
          obs({
            code: 'PALLET_DOES_NOT_FIT',
            observed: 'BLOCKER',
            subjectObjectIds: [input.runId],
            parameters: [param(name, value)],
            closedBy: 'Select a longer beam, or a smaller pallet footprint.',
          }),
        );
      }
    }
    if (out.length > 0) return out;

    // Fits, but the two shares are unequal by more than a micrometre. That is
    // the odd-micrometre allocation working as designed, not a defect; report
    // it as a warning so the drawing does not surprise anyone.
    const diff = Math.abs(convert(input.overhangFront, 'um') - convert(input.overhangRear, 'um'));
    if (diff > 1) {
      out.push(
        obs({
          code: 'PALLET_OVERHANG_UNEVEN',
          observed: 'WARNING',
          subjectObjectIds: [input.runId],
          parameters: [
            param('front overhang', input.overhangFront),
            param('rear overhang', input.overhangRear),
          ],
          closedBy:
            'No action required unless the layout depends on symmetry; adjust the bay depth to even the overhang.',
        }),
      );
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 7. Selected part is published and not discontinued
 * ------------------------------------------------------------------ */

export const partPublished: Check<CheckInput> = {
  code: 'PART_DISCONTINUED',
  ruleId: 'PART-PUBLISHED',
  run(input) {
    const out: Observation[] = [];
    for (const p of input.parts) {
      // Uncatalogued material is check 12's, not this one's.
      if (p.partRevisionId === null) continue;
      if (p.discontinued) {
        out.push(
          obs({
            code: 'PART_DISCONTINUED',
            observed: 'WARNING',
            subjectObjectIds: [p.id],
            parameters: [],
            closedBy: `Select a current part in place of ${p.description}.`,
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 8. Every value used in a derived output is established
 * ------------------------------------------------------------------ */

export const derivedValuesEstablished: Check<CheckInput> = {
  code: 'DERIVED_VALUE_UNESTABLISHED',
  ruleId: 'PROV-ESTABLISHED',
  run(input) {
    const out: Observation[] = [];
    for (const output of input.derivedOutputs) {
      if (isEstablished(output.node)) continue;
      // Name every unestablished leaf, not just the first. A client fixing one
      // at a time is the support-load failure mode.
      const missing = unestablished(output.node);
      out.push(
        obs({
          code: 'DERIVED_VALUE_UNESTABLISHED',
          observed: 'MISSING_INPUT',
          subjectObjectIds: [output.label],
          parameters: missing.map((n) =>
            unknownParam(
              n.label,
              'this value is not established, so it is never rendered as a number',
            ),
          ),
          closedBy: `Supply the unestablished inputs to ${output.label}.`,
        }),
      );
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 9. Site unknowns
 * ------------------------------------------------------------------ */

export const siteUnknowns: Check<CheckInput> = {
  code: 'SITE_INPUT_MISSING',
  ruleId: 'INPUT-SITE-UNKNOWNS',
  run(input) {
    const out: Observation[] = [];

    if (input.clearHeight === null) {
      out.push(
        obs({
          code: 'CLEAR_HEIGHT_NOT_SURVEYED',
          observed: 'MISSING_INPUT',
          subjectObjectIds: NO_IDS,
          parameters: [
            unknownParam('building clear height', 'the clear height has not been surveyed'),
          ],
          closedBy:
            'Measure the clear height to the lowest obstruction and enter it, or ask your facilities team.',
        }),
      );
    }
    if (!input.columnGridResolved) {
      out.push(
        obs({
          code: 'COLUMN_GRID_NOT_RESOLVED',
          observed: 'MISSING_INPUT',
          subjectObjectIds: NO_IDS,
          parameters: [unknownParam('column grid', 'the column grid has not been resolved')],
          closedBy: 'Supply the column grid spacing, or a dimensioned floor plan.',
        }),
      );
    }
    if (!input.commodityClassEstablished) {
      out.push(
        obs({
          code: 'COMMODITY_CLASS_NOT_ESTABLISHED',
          observed: 'MISSING_INPUT',
          subjectObjectIds: NO_IDS,
          parameters: [unknownParam('commodity class', 'the commodity class has not been established')],
          closedBy:
            'State what will be stored, so the commodity class can be established by your fire-protection consultant.',
        }),
      );
    }
    return out;
  },
};

/* ------------------------------------------------------------------ *
 * 10. Any citation used is below PRIMARY tier
 * ------------------------------------------------------------------ */

/**
 * Check 10 is unusual: its subject is the RULE PACK, not the configuration. It
 * takes the tiers actually used in this evaluation, so the client can see which
 * conclusions the tool was not entitled to draw.
 */
export interface CitationAudit {
  readonly usedRules: readonly { readonly ruleId: string; readonly tier: string }[];
}

export const citationsBelowPrimary: Check<CitationAudit> = {
  code: 'CITATION_BELOW_PRIMARY',
  ruleId: 'CITE-BELOW-PRIMARY',
  run(input) {
    const weak = input.usedRules.filter((r) => r.tier !== 'PRIMARY');
    if (weak.length === 0) return [];
    return [
      obs({
        code: 'CITATION_BELOW_PRIMARY',
        observed: 'ENGINEERING_REVIEW_REQUIRED',
        subjectObjectIds: weak.map((r) => r.ruleId),
        parameters: [],
        closedBy:
          'Our team will review the findings that rest on sources below primary tier. Obtaining the source document promotes them.',
      }),
    ];
  },
};

/* ------------------------------------------------------------------ *
 * 11. Flue geometry, reported with NO verdict
 * ------------------------------------------------------------------ */

export const flueGeometry: Check<CheckInput> = {
  code: 'FLUE_GEOMETRY_REPORTED',
  ruleId: 'FLUE-SPRINKLER-GEOMETRY',
  run(input) {
    if (input.transverseFlue === null) return [];
    // Reported as a measured dimension. The rule sits at NOT_FOUND tier, so the
    // framework forces NOT EVALUATED and no fire-protection verdict is
    // reachable — deliberately, because the governing section has not been
    // located. The measurement is still worth showing.
    return [
      obs({
        code: 'FLUE_GEOMETRY_REPORTED',
        observed: 'NOT_EVALUATED',
        subjectObjectIds: [input.runId],
        parameters: [param('transverse flue', input.transverseFlue)],
        closedBy:
          'No action here. This dimension is reported for your fire-protection consultant; this tool draws no sprinkler conclusion.',
      }),
    ];
  },
};

/* ------------------------------------------------------------------ *
 * 12. Uncatalogued material
 * ------------------------------------------------------------------ */

export const uncataloguedParts: Check<CheckInput> = {
  code: 'UNCATALOGUED_PART',
  ruleId: 'PART-UNCATALOGUED',
  run(input) {
    const unknownParts = input.parts.filter((p) => p.partRevisionId === null);
    if (unknownParts.length === 0) return [];
    return [
      obs({
        code: 'UNCATALOGUED_PART',
        observed: 'ENGINEERING_REVIEW_REQUIRED',
        subjectObjectIds: unknownParts.map((p) => p.id),
        parameters: unknownParts.map((p) =>
          unknownParam(
            p.description,
            'this material is not in the pinned catalog, so no published capacity exists for it',
          ),
        ),
        closedBy:
          'Our team will review this material. Capacity cannot be established from geometry, and dimensional similarity to a published part is not evidence of capacity.',
      }),
    ];
  },
};

/** The MVP-1 check set that reads a CheckInput. Order is the report order. */
export const MVP_CHECKS: readonly Check<CheckInput>[] = Object.freeze([
  beamFrameFit,
  beamCapacity,
  levelElevations,
  topOfLoad,
  aisleClearance,
  palletOverhang,
  partPublished,
  derivedValuesEstablished,
  siteUnknowns,
  flueGeometry,
  uncataloguedParts,
]);

export { isEstablishedOrigin };
