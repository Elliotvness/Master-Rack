import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
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
  applyCeiling,
  type RulePackManifest,
} from './index.js';

// The REAL seed rule pack, not a fixture. These assertions are against the data
// the product will actually ship with.
const rulesPath = fileURLToPath(
  new URL('../../../data/rules/mvp-2026-08/rules.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(rulesPath, 'utf8')) as {
  manifest: unknown;
  rules: unknown[];
};
const manifest = loadRulePackManifest(doc.manifest);
const rules = loadRules(doc.rules);
const pack = new RulePack(manifest, rules);

function ruleAt(tier: string): Record<string, unknown> {
  return {
    id: 'X-1',
    text: 'a rule',
    tier,
    value: null,
    unit: null,
    citation: { standard: 'S', edition: 'E', section: '1.2', source_note: 'read it' },
  };
}

describe('the seed rule pack loads and is honest about itself', () => {
  it('arrives as DRAFT, awaiting approval in the new system', () => {
    // Same discipline as the catalog: data re-enters DRAFT even though it was
    // authored here. Approval is an act, not an inheritance.
    expect(manifest.status).toBe('DRAFT');
    expect(manifest.approvedBy).toBeNull();
    expect(canPinRulePackForNewRevision(manifest)).toBe(false);
  });

  it('covers the MVP check set', () => {
    expect(pack.size).toBe(12);
    expect(pack.ids()).toContain('CAP-BEAM-PAIR');
    expect(pack.ids()).toContain('AISLE-CLEAR-WIDTH');
    expect(pack.ids()).toContain('FLUE-SPRINKLER-GEOMETRY');
  });

  it('records the six open source conflicts rather than resolving them silently', () => {
    // §10.8. Recording a conflict is what makes it safe to ship an unresolved
    // question: the tier caps the outcome and the conflict names the reason.
    expect(manifest.openConflicts).toHaveLength(6);
    expect(manifest.openConflicts.join(' ')).toMatch(/MH16\.1/);
    expect(manifest.openConflicts.join(' ')).toMatch(/NFPA/);
  });

  it('claims PRIMARY only where the source is genuinely established, with a section', () => {
    for (const id of pack.ids()) {
      const rule = pack.mustGet(id);
      if (rule.tier === 'PRIMARY') {
        expect(rule.citation.edition).not.toBe('');
        expect(rule.citation.section).not.toBe('');
      }
    }
  });

  it('does not claim any code or standards authority it has not established', () => {
    // The scope fence, asserted against the data. No rule may cite MH16.1 or
    // NFPA at PRIMARY, because which edition applies is an open conflict.
    for (const id of pack.ids()) {
      const rule = pack.mustGet(id);
      const s = rule.citation.standard.toUpperCase();
      if (s.includes('MH16.1') || s.includes('NFPA')) {
        expect(rule.tier).not.toBe('PRIMARY');
      }
    }
  });

  it('cannot produce a fire-protection verdict from the flue rule', () => {
    // Check 11 exists to report a measured dimension with NO verdict. The rule
    // sits at NOT_FOUND, so even a check that tried to block is forced to
    // NOT EVALUATED. This is the tier system doing the work the prose promises.
    const flue = pack.mustGet('FLUE-SPRINKLER-GEOMETRY');
    expect(flue.tier).toBe('NOT_FOUND');
    expect(applyCeiling(flue.tier, 'BLOCKER')).toBe('NOT_EVALUATED');
    expect(applyCeiling(flue.tier, 'PASS')).toBe('NOT_EVALUATED');
    // And it carries no number that could be mistaken for an established one.
    expect(flue.value).toBeNull();
  });

  it('caps the aisle rule at engineering review, because the convention has no code basis', () => {
    const aisle = pack.mustGet('AISLE-CLEAR-WIDTH');
    expect(aisle.tier).toBe('SECONDARY');
    expect(applyCeiling(aisle.tier, 'PASS')).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(applyCeiling(aisle.tier, 'BLOCKER')).toBe('ENGINEERING_REVIEW_REQUIRED');
  });

  it('still lets a missing input reach the client from a weak rule', () => {
    const aisle = pack.mustGet('AISLE-CLEAR-WIDTH');
    expect(applyCeiling(aisle.tier, 'MISSING_INPUT')).toBe('MISSING_INPUT');
  });
});

describe('rule lookup is exact, with no default and no fallback', () => {
  it('returns undefined for an unknown id', () => {
    expect(pack.get('NO-SUCH-RULE')).toBeUndefined();
  });

  it('throws when a check requires a rule the pack does not contain', () => {
    // Loud, because the alternative is a check evaluating against nothing and
    // reporting a confident result.
    expect(() => pack.mustGet('NO-SUCH-RULE')).toThrow(RulePackError);
    expect(() => pack.mustGet('NO-SUCH-RULE')).toThrow(/no rule 'NO-SUCH-RULE' in pack mvp@2026-08/);
  });

  it('refuses duplicate rule ids', () => {
    const r = loadRule(ruleAt('PRIMARY'), 0);
    expect(() => new RulePack(manifest, [r, r])).toThrow(/duplicate rule id 'X-1'/);
  });

  it('returns ids sorted, so callers are deterministic', () => {
    const ids = pack.ids();
    expect([...ids].sort()).toEqual([...ids]);
  });
});

describe('the loader refuses data that would let a rule overstate itself', () => {
  it('refuses a PRIMARY rule with no edition or section', () => {
    const bad = { ...ruleAt('PRIMARY'), citation: { standard: 'S', edition: '', section: '', source_note: 'n' } };
    expect(() => loadRule(bad, 0)).toThrow(/a PRIMARY rule must cite an edition and a section/);
  });

  it('refuses a NOT_FOUND rule that carries a value', () => {
    // No source located means no established number. A value present in the
    // data will eventually be read by something regardless of its tier.
    const bad = { ...ruleAt('NOT_FOUND'), value: 18, unit: 'in' };
    expect(() => loadRule(bad, 0)).toThrow(/a NOT_FOUND rule may not carry a value/);
  });

  it('refuses a value with no unit', () => {
    const bad = { ...ruleAt('PRIMARY'), value: 18, unit: null };
    expect(() => loadRule(bad, 0)).toThrow(/a rule with a value must name its unit/);
  });

  it('refuses an unknown tier rather than defaulting to one', () => {
    expect(() => loadRule(ruleAt('PROBABLY_FINE'), 0)).toThrow(/'tier' is not a verification tier/);
  });

  it('refuses a non-finite value, a missing id, text, standard or source note', () => {
    expect(() => loadRule({ ...ruleAt('PRIMARY'), value: Number.NaN, unit: 'in' }, 0)).toThrow(
      /'value' must be a finite number or null/,
    );
    expect(() => loadRule({ ...ruleAt('PRIMARY'), id: '' }, 0)).toThrow(/'id' must be a non-empty string/);
    expect(() => loadRule({ ...ruleAt('PRIMARY'), text: '  ' }, 0)).toThrow(/'text' must be a non-empty string/);
    expect(() =>
      loadRule({ ...ruleAt('PRIMARY'), citation: { standard: '', edition: 'e', section: 's', source_note: 'n' } }, 0),
    ).toThrow(/'citation.standard' must be a non-empty string/);
    expect(() =>
      loadRule({ ...ruleAt('PRIMARY'), citation: { standard: 'S', edition: 'e', section: 's', source_note: '' } }, 0),
    ).toThrow(/'citation.source_note' must be a non-empty string/);
  });

  it('refuses a malformed shape outright', () => {
    expect(() => loadRule(null, 0)).toThrow(/not an object/);
    expect(() => loadRule('a rule', 0)).toThrow(/not an object/);
    expect(() => loadRule({ ...ruleAt('PRIMARY'), citation: 'ANSI' }, 0)).toThrow(
      /'citation' must be an object/,
    );
    expect(() => loadRules([])).toThrow(/must be a non-empty array/);
  });

  it('accepts a value with a unit, and a rule with neither', () => {
    const withValue = loadRule({ ...ruleAt('PRIMARY'), value: 18, unit: 'in' }, 0);
    expect(withValue.value).toBe(18);
    expect(withValue.unit).toBe('in');
    const without = loadRule(ruleAt('PRIMARY'), 0);
    expect(without.value).toBeNull();
    expect(without.unit).toBeNull();
  });

  it('refuses a manifest with an unknown status or missing fields', () => {
    expect(() => loadRulePackManifest({ ...(doc.manifest as object), status: 'PROBABLY' })).toThrow(
      /unknown status/,
    );
    expect(() => loadRulePackManifest(null)).toThrow(/not an object/);
    expect(() => loadRulePackManifest({ ...(doc.manifest as object), pack: '' })).toThrow(
      /'pack' must be a non-empty string/,
    );
  });

  it('tolerates a manifest with no open-conflicts array', () => {
    const m = loadRulePackManifest({ ...(doc.manifest as object), open_conflicts: undefined });
    expect(m.openConflicts).toEqual([]);
  });

  it('treats a non-string edition or section as absent, never as a citation', () => {
    // A null or numeric edition must not become the string "null" and satisfy
    // the PRIMARY gate. Absent is absent.
    const bad = {
      ...ruleAt('PRIMARY'),
      citation: { standard: 'S', edition: null, section: 12, source_note: 'n' },
    };
    expect(() => loadRule(bad, 0)).toThrow(/a PRIMARY rule must cite an edition and a section/);

    // At a weaker tier the same input is allowed, and normalises to empty.
    const ok = loadRule(
      { ...ruleAt('SECONDARY'), citation: { standard: 'S', edition: null, section: 12, source_note: 'n' } },
      0,
    );
    expect(ok.citation.edition).toBe('');
    expect(ok.citation.section).toBe('');
  });

  it('round-trips an already-approved manifest without losing the approval', () => {
    const approvedDoc = {
      ...(doc.manifest as object),
      status: 'APPROVED',
      approved_by: 'A Reviewer',
      approved_at: '2026-09-01',
    };
    const m = loadRulePackManifest(approvedDoc);
    expect(m.status).toBe('APPROVED');
    expect(m.approvedBy).toBe('A Reviewer');
    expect(m.approvedAt).toBe('2026-09-01');
    expect(canPinRulePackForNewRevision(m)).toBe(true);
  });
});

describe('the rule-pack approval gate', () => {
  const draft: RulePackManifest = {
    ...manifest,
    authoredBy: 'automated draft (Claude)',
    verificationPath: { kind: 'source_read', rulesChecked: 12, note: 'sources read' },
  };

  it('refuses an unnamed approver', () => {
    expect(ruleApprovalRefusals({ ...draft }, '  ')).toContain('the approver must be a named person');
  });

  it('refuses the author approving their own pack', () => {
    expect(ruleApprovalRefusals(draft, 'automated draft (Claude)')).toContain(
      'the approver may not be the author of the pack',
    );
  });

  it('refuses approval with no recorded verification path', () => {
    // A name with no verification act behind it is ceremony. Same principle as
    // the catalog gate, and it is here because a rule pack can be as wrong as
    // a capacity table and is harder to spot.
    const reasons = ruleApprovalRefusals({ ...draft, verificationPath: null }, 'A Reviewer');
    expect(reasons.join(' ')).toMatch(/recorded verification path/);
  });

  it('refuses a verification path covering no rules', () => {
    const reasons = ruleApprovalRefusals(
      { ...draft, verificationPath: { kind: 'independent_review', rulesChecked: 0, note: 'n' } },
      'A Reviewer',
    );
    expect(reasons).toContain('the recorded verification path must cover at least one rule');
  });

  it('lists EVERY reason at once, not just the first', () => {
    // One round of review should surface all the work.
    const reasons = ruleApprovalRefusals(
      { authoredBy: 'X', verificationPath: null },
      'X',
    );
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('approves when the gate is satisfied, without mutating the original', () => {
    expect(canApproveRulePack(draft, 'A Reviewer')).toBe(true);
    const approved = approveRulePack(draft, 'A Reviewer', '2026-09-01');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('A Reviewer');
    expect(approved.approvedAt).toBe('2026-09-01');
    expect(draft.status).toBe('DRAFT');
    expect(canPinRulePackForNewRevision(approved)).toBe(true);
  });

  it('throws with every reason when approval is refused', () => {
    expect(() => approveRulePack(draft, 'automated draft (Claude)', '2026-09-01')).toThrow(
      RuleApprovalGateError,
    );
    try {
      approveRulePack({ ...draft, verificationPath: null }, 'automated draft (Claude)', '2026-09-01');
      expect.unreachable('approval should have been refused');
    } catch (e) {
      expect(e).toBeInstanceOf(RuleApprovalGateError);
      expect((e as RuleApprovalGateError).reasons.length).toBe(2);
    }
  });

  it('refuses to approve anything that is not a DRAFT', () => {
    const approved = approveRulePack(draft, 'A Reviewer', '2026-09-01');
    expect(() => approveRulePack(approved, 'Another Reviewer', '2026-09-02')).toThrow(
      /only a DRAFT rule pack may be approved; this is APPROVED/,
    );
  });
});
