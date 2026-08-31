/**
 * Rules and rule-pack releases.
 *
 * Blueprint §10.1 and §10.5. A rule pack is a SEPARATE artifact from a catalog
 * release, pinned separately, because standards and part data churn on
 * completely different clocks: a manufacturer republishes a capacity chart
 * yearly, a standard's edition changes once a decade.
 *
 * "A rule is not a constant. It is a record with a citation and a confidence,
 * and its confidence caps what it is allowed to conclude."
 *
 * Pure: no I/O, no clock, no RNG. Dates are supplied by the caller.
 */

import { type VerificationTier, RulesError, isVerificationTier } from './tier.js';

/**
 * Where a rule came from. Every field is required at PRIMARY tier and the gate
 * enforces that — an unsourced PRIMARY rule is the exact dishonesty §11.2 was
 * written to stop.
 */
export interface Citation {
  /** e.g. 'ANSI MH16.1', 'NFPA 13', 'Santa Fe Springs rack handout'. */
  readonly standard: string;
  /** Edition or year. Empty string when the source carries none. */
  readonly edition: string;
  /** Section, clause or page. Empty string when the source carries none. */
  readonly section: string;
  /** Free text: what was actually read, or why it could not be. */
  readonly sourceNote: string;
}

export interface Rule {
  /** Stable id, referenced by a check. Never renumbered. */
  readonly id: string;
  /** Plain-English statement of the rule, in the words a finding would print. */
  readonly text: string;
  readonly tier: VerificationTier;
  readonly citation: Citation;
  /**
   * The rule's value, when it has one, in the unit named by `unit`. Null for a
   * rule that states a requirement without a number (e.g. "levels must be
   * distinct"), and null for NOT_FOUND rules, which have no established value
   * by definition.
   */
  readonly value: number | null;
  readonly unit: string | null;
}

export type RulePackStatus = 'DRAFT' | 'APPROVED' | 'SUPERSEDED' | 'RETIRED';

/**
 * How a rule pack earned approval. Same principle as the catalog's, restated
 * for rules: a name with no verification act behind it is ceremony.
 */
export type RuleVerificationPath =
  | { readonly kind: 'source_read'; readonly rulesChecked: number; readonly note: string }
  | { readonly kind: 'independent_review'; readonly rulesChecked: number; readonly note: string };

export interface RulePackManifest {
  readonly pack: string;
  readonly rev: string;
  readonly status: RulePackStatus;
  readonly authoredBy: string;
  readonly authoredAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly verificationPath: RuleVerificationPath | null;
  /** Conflicts left deliberately open (§10.8). Recorded, never silently chosen. */
  readonly openConflicts: readonly string[];
}

export class RulePackError extends RulesError {
  override readonly name = 'RulePackError';
}

/** A rule pack that fails the approval gate. Carries EVERY reason. */
export class RuleApprovalGateError extends RulesError {
  override readonly name = 'RuleApprovalGateError';
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`Rule pack cannot be approved: ${reasons.join(' | ')}`);
    this.reasons = Object.freeze([...reasons]);
  }
}

function requireString(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RulePackError(`${where}: '${field}' must be a non-empty string`);
  }
  return value;
}

/**
 * Validate one rule from declarative data. Rules are DATA (JSON), never
 * executable code — the same decision the catalog makes, for the same reason.
 *
 * Two integrity rules are enforced here rather than left to review:
 *
 *  1. A PRIMARY rule must name a standard, an edition AND a section. "Primary"
 *     means someone read the standard; if they did, they can say where. This is
 *     the mechanical form of the Rev A finding.
 *  2. A NOT_FOUND rule may not carry a value. No source located means no
 *     established number, and a number present in the data will eventually be
 *     read by something regardless of its tier.
 */
export function loadRule(raw: unknown, index: number): Rule {
  const where = `rule ${index}`;
  if (typeof raw !== 'object' || raw === null) {
    throw new RulePackError(`${where}: not an object`);
  }
  const r = raw as Record<string, unknown>;

  const id = requireString(r['id'], 'id', where);
  const text = requireString(r['text'], 'text', where);

  const tier = r['tier'];
  if (!isVerificationTier(tier)) {
    throw new RulePackError(`${where} (${id}): 'tier' is not a verification tier, got ${String(tier)}`);
  }

  const rawCitation = r['citation'];
  if (typeof rawCitation !== 'object' || rawCitation === null) {
    throw new RulePackError(`${where} (${id}): 'citation' must be an object`);
  }
  const c = rawCitation as Record<string, unknown>;
  const standard = requireString(c['standard'], 'citation.standard', `${where} (${id})`);
  const sourceNote = requireString(c['source_note'], 'citation.source_note', `${where} (${id})`);
  const edition = typeof c['edition'] === 'string' ? c['edition'] : '';
  const section = typeof c['section'] === 'string' ? c['section'] : '';

  if (tier === 'PRIMARY' && (edition === '' || section === '')) {
    throw new RulePackError(
      `${where} (${id}): a PRIMARY rule must cite an edition and a section — ` +
        'if the standard was read, the reader can say where',
    );
  }

  const rawValue = r['value'];
  let value: number | null = null;
  if (rawValue !== null && rawValue !== undefined) {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new RulePackError(`${where} (${id}): 'value' must be a finite number or null`);
    }
    value = rawValue;
  }

  const rawUnit = r['unit'];
  const unit = typeof rawUnit === 'string' && rawUnit !== '' ? rawUnit : null;

  if (value !== null && unit === null) {
    throw new RulePackError(`${where} (${id}): a rule with a value must name its unit`);
  }
  if (tier === 'NOT_FOUND' && value !== null) {
    throw new RulePackError(
      `${where} (${id}): a NOT_FOUND rule may not carry a value — ` +
        'no source located means no established number',
    );
  }

  return Object.freeze({
    id,
    text,
    tier,
    value,
    unit,
    citation: Object.freeze({ standard, edition, section, sourceNote }),
  });
}

/** An indexed, immutable set of rules. Lookup by id is exact; there is no fallback. */
export class RulePack {
  private readonly byId: ReadonlyMap<string, Rule>;
  readonly manifest: RulePackManifest;

  constructor(manifest: RulePackManifest, rules: readonly Rule[]) {
    const map = new Map<string, Rule>();
    for (const rule of rules) {
      if (map.has(rule.id)) {
        throw new RulePackError(`duplicate rule id '${rule.id}'`);
      }
      map.set(rule.id, rule);
    }
    this.byId = map;
    this.manifest = Object.freeze({ ...manifest });
    Object.freeze(this);
  }

  get size(): number {
    return this.byId.size;
  }

  /** Every rule id, sorted, so callers and tests are deterministic. */
  ids(): readonly string[] {
    return Object.freeze([...this.byId.keys()].sort());
  }

  /** Undefined when absent — the caller must decide, never a default rule. */
  get(id: string): Rule | undefined {
    return this.byId.get(id);
  }

  /**
   * Get a rule or throw. A check that names a rule the pack does not contain is
   * a programming error, not a validation outcome: failing loudly is correct,
   * because the alternative is a check silently evaluating against nothing.
   */
  mustGet(id: string): Rule {
    const rule = this.byId.get(id);
    if (rule === undefined) {
      throw new RulePackError(`no rule '${id}' in pack ${this.manifest.pack}@${this.manifest.rev}`);
    }
    return rule;
  }
}

/** Parse a rules.json `rules` array. */
export function loadRules(rules: readonly unknown[]): readonly Rule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new RulePackError('rules must be a non-empty array');
  }
  return Object.freeze(rules.map((raw, i) => loadRule(raw, i)));
}

/**
 * Every reason a rule pack may NOT be approved. Empty means it may.
 * Deliberately the same shape as the catalog gate: list every reason, never
 * just the first, so one round of review surfaces all the work.
 */
export function ruleApprovalRefusals(
  manifest: Pick<RulePackManifest, 'authoredBy' | 'verificationPath'>,
  approver: string,
): readonly string[] {
  const reasons: string[] = [];

  if (approver.trim() === '') {
    reasons.push('the approver must be a named person');
  }
  if (approver === manifest.authoredBy) {
    reasons.push('the approver may not be the author of the pack');
  }
  if (manifest.verificationPath === null) {
    reasons.push(
      'approval requires a recorded verification path (the source read, or an independent review)',
    );
  } else if (manifest.verificationPath.rulesChecked <= 0) {
    reasons.push('the recorded verification path must cover at least one rule');
  }

  return Object.freeze(reasons);
}

export function canApproveRulePack(
  manifest: Pick<RulePackManifest, 'authoredBy' | 'verificationPath'>,
  approver: string,
): boolean {
  return ruleApprovalRefusals(manifest, approver).length === 0;
}

/**
 * Approve a DRAFT rule pack, or throw with every reason it cannot be approved.
 * Returns a new manifest; never mutates. `approvedAt` is the caller's, not a clock's.
 */
export function approveRulePack(
  manifest: RulePackManifest,
  approver: string,
  approvedAt: string,
): RulePackManifest {
  if (manifest.status !== 'DRAFT') {
    throw new RuleApprovalGateError([
      `only a DRAFT rule pack may be approved; this is ${manifest.status}`,
    ]);
  }
  const reasons = ruleApprovalRefusals(manifest, approver);
  if (reasons.length > 0) {
    throw new RuleApprovalGateError(reasons);
  }
  return Object.freeze({
    ...manifest,
    status: 'APPROVED' as const,
    approvedBy: approver,
    approvedAt,
  });
}

/** Only an APPROVED pack may be pinned by a new revision. Existing pins survive forever. */
export function canPinRulePackForNewRevision(manifest: Pick<RulePackManifest, 'status'>): boolean {
  return manifest.status === 'APPROVED';
}

/** Parse a rules.json manifest object into a typed manifest. */
export function loadRulePackManifest(raw: unknown): RulePackManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new RulePackError('manifest: not an object');
  }
  const m = raw as Record<string, unknown>;
  const status = m['status'];
  if (
    status !== 'DRAFT' &&
    status !== 'APPROVED' &&
    status !== 'SUPERSEDED' &&
    status !== 'RETIRED'
  ) {
    throw new RulePackError(`manifest: unknown status ${String(status)}`);
  }
  const conflicts = m['open_conflicts'];
  return Object.freeze({
    pack: requireString(m['pack'], 'pack', 'manifest'),
    rev: requireString(m['rev'], 'rev', 'manifest'),
    status,
    authoredBy: requireString(m['authored_by'], 'authored_by', 'manifest'),
    authoredAt: requireString(m['authored_at'], 'authored_at', 'manifest'),
    approvedBy: typeof m['approved_by'] === 'string' && m['approved_by'] !== '' ? m['approved_by'] : null,
    approvedAt: typeof m['approved_at'] === 'string' && m['approved_at'] !== '' ? m['approved_at'] : null,
    verificationPath: null,
    openConflicts: Object.freeze(
      Array.isArray(conflicts) ? conflicts.filter((c): c is string => typeof c === 'string') : [],
    ),
  });
}
