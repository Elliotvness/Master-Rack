/**
 * @rms/kernel-rules
 *
 * Rule packs, their citations, and the verification-tier ceiling that caps what
 * a rule is allowed to conclude. Pure: no I/O, no clock, no RNG.
 *
 * This package holds no check logic. It holds the POLICY that check logic is
 * subject to, so that `kernel-checks` can apply the ceiling centrally and a
 * check cannot overstate its own authority.
 */

export {
  TIER_ORDER,
  RulesError,
  applyCeiling,
  blocksSubmission,
  isVerificationTier,
  permits,
  permittedSeverities,
  requiresAhjConfirmation,
  requiresCiteCheckStamp,
  type Severity,
  type VerificationTier,
} from './tier.js';

export {
  RulePack,
  RulePackError,
  RuleApprovalGateError,
  approveRulePack,
  canApproveRulePack,
  canPinRulePackForNewRevision,
  loadRule,
  loadRulePackManifest,
  loadRules,
  ruleApprovalRefusals,
  type Citation,
  type Rule,
  type RulePackManifest,
  type RulePackStatus,
  type RuleVerificationPath,
} from './pack.js';
