import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RulePack, loadRulePackManifest, loadRules, type Severity } from '@rms/kernel-rules';
import { inches } from '@rms/kernel-units';

import {
  CheckFrameworkError,
  FindingError,
  allParametersEstablished,
  blockers,
  clientActionable,
  param,
  runCheck,
  runChecks,
  silentChecks,
  unknownParam,
  type Check,
  type Observation,
} from './index.js';

const rulesPath = fileURLToPath(
  new URL('../../../data/rules/mvp-2026-08/rules.json', import.meta.url),
);
const doc = JSON.parse(readFileSync(rulesPath, 'utf8')) as { manifest: unknown; rules: unknown[] };
const pack = new RulePack(loadRulePackManifest(doc.manifest), loadRules(doc.rules));

/** A check that reports exactly what the test tells it to. */
function stub(code: string, ruleId: string, observed: Severity): Check<null> {
  return {
    code,
    ruleId,
    run: (): readonly Observation[] => [
      {
        code,
        observed,
        subjectObjectIds: ['run-1'],
        parameters: [param('a length', inches(96))],
        closedBy: 'do the thing that would resolve this',
      },
    ],
  };
}

describe('AC-19 \u2014 the ceiling is applied by the framework, not by the check', () => {
  // The governing acceptance criterion. Every test in this block is written
  // against a check that TRIES to overstate itself, because a check that
  // behaves is not evidence the control works.

  it('downgrades a PASS asserted against a SECONDARY rule', () => {
    // AISLE-CLEAR-WIDTH is SECONDARY: the load-face convention has no located
    // code basis. A check claiming a clean pass must not get one.
    const [finding] = runCheck(stub('X', 'AISLE-CLEAR-WIDTH', 'PASS'), pack, null);
    expect(finding?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
  });

  it('downgrades a BLOCKER asserted against a SECONDARY rule', () => {
    const [finding] = runCheck(stub('X', 'AISLE-CLEAR-WIDTH', 'BLOCKER'), pack, null);
    expect(finding?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
    // And therefore it cannot stop a submission.
    expect(blockers([finding!])).toHaveLength(0);
  });

  it('forces NOT EVALUATED for a rule with no located source', () => {
    // FLUE-SPRINKLER-GEOMETRY is NOT_FOUND. Even a check asserting a hard
    // blocker cannot produce a fire-protection verdict.
    const [finding] = runCheck(stub('X', 'FLUE-SPRINKLER-GEOMETRY', 'BLOCKER'), pack, null);
    expect(finding?.severity).toBe('NOT_EVALUATED');
  });

  it('lets a PRIMARY rule pass and block, because it is entitled to', () => {
    expect(runCheck(stub('X', 'GEOM-LEVEL-DISTINCT', 'PASS'), pack, null)[0]?.severity).toBe('PASS');
    expect(runCheck(stub('X', 'GEOM-LEVEL-DISTINCT', 'BLOCKER'), pack, null)[0]?.severity).toBe(
      'BLOCKER',
    );
  });

  it('records that it lowered the outcome, so "why is this not a pass?" is answerable', () => {
    const [finding] = runCheck(stub('X', 'AISLE-CLEAR-WIDTH', 'PASS'), pack, null);
    expect(finding?.ceilingApplied).toEqual({ observed: 'PASS', tier: 'SECONDARY' });
    // Answerable from stored data alone, with no recomputation.
    const untouched = runCheck(stub('X', 'GEOM-LEVEL-DISTINCT', 'PASS'), pack, null)[0];
    expect(untouched?.ceilingApplied).toBeNull();
  });

  it('is the only thing that decides severity: two checks differing ONLY in rule diverge', () => {
    // Identical observation, identical code, different governing rule. If the
    // check controlled its own severity these would agree.
    const strong = runCheck(stub('SAME', 'GEOM-LEVEL-DISTINCT', 'PASS'), pack, null)[0];
    const weak = runCheck(stub('SAME', 'AISLE-CLEAR-WIDTH', 'PASS'), pack, null)[0];
    expect(strong?.severity).toBe('PASS');
    expect(weak?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
  });

  it('lets a missing input reach the client even from a weak rule', () => {
    // The §11.1 failure mode: collapsing MISSING INPUT into ENGINEERING REVIEW
    // buries the one list the client can act on.
    const [finding] = runCheck(stub('X', 'AISLE-CLEAR-WIDTH', 'MISSING_INPUT'), pack, null);
    expect(finding?.severity).toBe('MISSING_INPUT');
    expect(clientActionable([finding!])).toHaveLength(1);
  });
});

describe('the framework refuses to let a check evaluate against nothing', () => {
  it('throws when a check names a rule the pack does not contain', () => {
    // Silently skipping would let a check report a confident result with no
    // rule behind it. Loud is correct.
    expect(() => runCheck(stub('X', 'NO-SUCH-RULE', 'PASS'), pack, null)).toThrow(
      /no rule 'NO-SUCH-RULE'/,
    );
  });

  it('refuses a finding with no closed_by', () => {
    const bad: Check<null> = {
      code: 'X',
      ruleId: 'GEOM-LEVEL-DISTINCT',
      run: () => [
        { code: 'X', observed: 'BLOCKER', subjectObjectIds: [], parameters: [], closedBy: '  ' },
      ],
    };
    expect(() => runCheck(bad, pack, null)).toThrow(FindingError);
    expect(() => runCheck(bad, pack, null)).toThrow(/every finding must state what would resolve it/);
  });

  it('refuses a finding with no code', () => {
    const bad: Check<null> = {
      code: 'X',
      ruleId: 'GEOM-LEVEL-DISTINCT',
      run: () => [
        { code: '', observed: 'BLOCKER', subjectObjectIds: [], parameters: [], closedBy: 'fix it' },
      ],
    };
    expect(() => runCheck(bad, pack, null)).toThrow(/no code/);
  });

  it('refuses duplicate check codes in one run', () => {
    const a = stub('DUP', 'GEOM-LEVEL-DISTINCT', 'PASS');
    expect(() => runChecks([a, a], pack, null)).toThrow(CheckFrameworkError);
    expect(() => runChecks([a, a], pack, null)).toThrow(/duplicate check code 'DUP'/);
  });

  it('treats a check reporting nothing as silence, never as a pass', () => {
    // §11.1: "Silence is not a pass." A check that produced no finding is
    // NAMED so the screen can show it, rather than being absent from it.
    const quiet: Check<null> = {
      code: 'QUIET',
      ruleId: 'GEOM-TOP-OF-LOAD',
      run: () => [],
    };
    const loud = stub('LOUD', 'GEOM-LEVEL-DISTINCT', 'BLOCKER');
    const findings = runChecks([quiet, loud], pack, null);
    expect(findings).toHaveLength(1);
    expect(silentChecks([quiet, loud], findings)).toEqual(['QUIET']);
  });
});

describe('the finding carries what an internal reviewer needs', () => {
  it('carries the full citation, including the tier and the pinned pack revision', () => {
    const [finding] = runCheck(stub('X', 'AISLE-CLEAR-WIDTH', 'BLOCKER'), pack, null);
    expect(finding?.citation.ruleId).toBe('AISLE-CLEAR-WIDTH');
    expect(finding?.citation.tier).toBe('SECONDARY');
    expect(finding?.citation.rulePack).toBe('mvp');
    expect(finding?.citation.rulePackRev).toBe('2026-08');
    expect(finding?.citation.sourceNote).not.toBe('');
  });

  it('stamps a REPRODUCED blocker as cite-checked, and flags an AHJ rule', () => {
    // No seed rule sits at these tiers today, so build a pack that does rather
    // than leave the behaviour unexercised.
    const custom = new RulePack(loadRulePackManifest(doc.manifest), [
      ...loadRules(doc.rules),
      {
        id: 'REPRO-1',
        text: 'a reproduced rule',
        tier: 'REPRODUCED',
        value: null,
        unit: null,
        citation: { standard: 'S', edition: '2020', section: '1.1', sourceNote: 'reconciled' },
      },
      {
        id: 'AHJ-1',
        text: 'an authority interpretation',
        tier: 'AHJ_INTERPRETATION',
        value: null,
        unit: null,
        citation: { standard: 'City handout', edition: '', section: '', sourceNote: 'handout' },
      },
    ]);

    const repro = runCheck(stub('X', 'REPRO-1', 'BLOCKER'), custom, null)[0];
    expect(repro?.severity).toBe('BLOCKER');
    expect(repro?.citeCheckStamp).toBe(true);
    expect(repro?.ahjConfirmationRequired).toBe(false);

    const ahj = runCheck(stub('Y', 'AHJ-1', 'BLOCKER'), custom, null)[0];
    expect(ahj?.severity).toBe('ENGINEERING_REVIEW_REQUIRED');
    expect(ahj?.ahjConfirmationRequired).toBe(true);
    expect(ahj?.citeCheckStamp).toBe(false);
  });

  it('freezes what it returns, so a finding cannot be edited after the fact', () => {
    const [finding] = runCheck(stub('X', 'GEOM-LEVEL-DISTINCT', 'PASS'), pack, null);
    expect(Object.isFrozen(finding)).toBe(true);
    expect(Object.isFrozen(finding?.parameters)).toBe(true);
  });

  it('preserves the caller\u2019s check order, so a report reads the same way twice', () => {
    const findings = runChecks(
      [
        stub('A', 'GEOM-LEVEL-DISTINCT', 'BLOCKER'),
        stub('B', 'GEOM-TOP-OF-LOAD', 'BLOCKER'),
        stub('C', 'PROV-ESTABLISHED', 'MISSING_INPUT'),
      ],
      pack,
      null,
    );
    expect(findings.map((f) => f.code)).toEqual(['A', 'B', 'C']);
  });
});

describe('AC-07 \u2014 an unestablished value is never a numeral', () => {
  it('refuses an unestablished parameter with no reason', () => {
    expect(() => unknownParam('clear height', '  ')).toThrow(/must state why/);
  });

  it('refuses an unnamed parameter, established or not', () => {
    expect(() => param('', inches(96))).toThrow(/must be named/);
    expect(() => unknownParam(' ', 'because')).toThrow(/must be named/);
  });

  it('makes "unestablished but here is the number anyway" unrepresentable', () => {
    const p = unknownParam('clear height', 'not surveyed');
    expect(p.established).toBe(false);
    expect(p.value).toBeNull();
    const q = param('span', inches(96));
    expect(q.established).toBe(true);
    expect(q.value).not.toBeNull();
  });

  it('reports whether a whole finding is safe to render as numerals', () => {
    // The predicate a renderer asks before printing a row of figures.
    const mixed: Check<null> = {
      code: 'M',
      ruleId: 'GEOM-LEVEL-DISTINCT',
      run: () => [
        {
          code: 'M',
          observed: 'WARNING',
          subjectObjectIds: [],
          parameters: [param('span', inches(96)), unknownParam('height', 'not surveyed')],
          closedBy: 'survey the height',
        },
      ],
    };
    const [f] = runCheck(mixed, pack, null);
    expect(allParametersEstablished(f!)).toBe(false);

    const [clean] = runCheck(stub('C', 'GEOM-LEVEL-DISTINCT', 'PASS'), pack, null);
    expect(allParametersEstablished(clean!)).toBe(true);
  });
});
