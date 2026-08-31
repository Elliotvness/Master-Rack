/**
 * @rms/kernel-checks
 *
 * The MVP-1 check set, and the framework that applies the verification-tier
 * ceiling to everything they observe. Pure: no I/O, no clock, no RNG.
 *
 * The important structural fact: a `Check` returns an `Observation`, and only
 * `runChecks` produces a `Finding`. The ceiling is applied in exactly one
 * place, so a check cannot overstate its own authority (AC-19).
 */

export {
  FindingError,
  allParametersEstablished,
  param,
  unknownParam,
  type Finding,
  type FindingCitation,
  type FindingParameter,
} from './finding.js';

export {
  CheckFrameworkError,
  blockers,
  clientActionable,
  runCheck,
  runChecks,
  silentChecks,
  type Check,
  type Observation,
} from './framework.js';

export {
  MVP_CHECKS,
  aisleClearance,
  beamCapacity,
  beamFrameFit,
  citationsBelowPrimary,
  derivedValuesEstablished,
  flueGeometry,
  levelElevations,
  palletOverhang,
  partPublished,
  siteUnknowns,
  topOfLoad,
  uncataloguedParts,
  type CapacityLookup,
  type CheckInput,
  type CitationAudit,
  type LevelInput,
  type PartInput,
} from './checks.js';
