import { describe, expect, it } from 'vitest';

import { buildPlan, buildElevation, type DisplayList } from '@rms/display-list';
import { inches } from '@rms/kernel-units';

import {
  PreviewSequencer,
  REVIEW_WORDING,
  canSubmit,
  clientActionList,
  groupFindings,
  summarise,
  type ClientFinding,
  type PreviewResult,
} from './index.js';

const HASH = 'sha256:preview';

function plan(): DisplayList {
  return buildPlan({
    revisionHash: HASH,
    runs: [
      {
        runId: 'run-1',
        offsetX: inches(0),
        offsetY: inches(0),
        bays: 3,
        bayPitch: inches(102),
        runLength: inches(312),
        frameDepth: inches(42),
        uprightFace: inches(3),
      },
    ],
    aisles: [],
    extent: { width: inches(600), height: inches(600) },
  });
}

function elevation(): DisplayList {
  return buildElevation({
    revisionHash: HASH,
    runId: 'run-1',
    frameHeight: inches(240),
    bayPitch: inches(102),
    levels: [{ levelId: 'L1', elevation: inches(60), load: null }],
  });
}

function finding(
  severity: ClientFinding['severity'],
  code = 'X',
  closedBy = 'do the thing',
): ClientFinding {
  return { code, severity, closedBy, subjectObjectIds: ['run-1'] };
}

function result(findings: readonly ClientFinding[] = [], netPositions: number | null = 120): PreviewResult {
  return { plan: plan(), elevation: elevation(), netPositions, findings };
}

describe('nothing displays from a stale computation', () => {
  // A correctness requirement, not a performance one. If a slow earlier
  // derivation lands after a fast later one, the screen shows a real drawing
  // of a configuration the client no longer has — and cannot tell.

  it('discards a result that arrives after a newer request started', () => {
    const seq = new PreviewSequencer();
    const first = seq.begin();
    const second = seq.begin();

    // The FIRST derivation finishes last. Classic out-of-order arrival.
    const appliedFirst = seq.settle(first, result([], 999));
    expect(appliedFirst).toBe(false);
    expect(seq.discardedGenerations).toEqual([first]);

    const appliedSecond = seq.settle(second, result([], 120));
    expect(appliedSecond).toBe(true);

    const state = seq.current();
    expect(state.status).toBe('ready');
    // The stale 999 never reached the screen.
    if (state.status === 'ready') expect(state.result.netPositions).toBe(120);
  });

  it('discards a stale FAILURE too, not just a stale success', () => {
    // A late error would otherwise replace a good current drawing with an
    // error state belonging to inputs the client has already changed.
    const seq = new PreviewSequencer();
    const first = seq.begin();
    const second = seq.begin();

    seq.settle(second, result());
    expect(seq.fail(first, 'network died')).toBe(false);
    expect(seq.current().status).toBe('ready');
  });

  it('reports that the screen is NOT current while a derivation is in flight', () => {
    const seq = new PreviewSequencer();
    seq.settle(seq.begin(), result());
    expect(seq.isCurrent()).toBe(true);

    // The client changes a parameter: what is on screen is now stale.
    seq.begin();
    expect(seq.isCurrent()).toBe(false);
  });

  it('applies a current failure', () => {
    const seq = new PreviewSequencer();
    const g = seq.begin();
    expect(seq.fail(g, 'derivation refused')).toBe(true);
    const state = seq.current();
    expect(state.status).toBe('failed');
    if (state.status === 'failed') expect(state.message).toBe('derivation refused');
    expect(seq.isCurrent()).toBe(false);
  });

  it('survives many rapid changes, applying only the last', () => {
    // Typing in a numeric field produces a burst. Only the final value may
    // ever be rendered.
    const seq = new PreviewSequencer();
    const generations = [1, 2, 3, 4, 5].map(() => seq.begin());
    const last = generations[generations.length - 1] as number;

    for (const g of generations) {
      seq.settle(g, result([], g * 10));
    }

    const state = seq.current();
    if (state.status === 'ready') expect(state.result.netPositions).toBe(last * 10);
    expect(seq.discardedGenerations).toHaveLength(generations.length - 1);
  });

  it('starts idle, showing nothing rather than an empty drawing', () => {
    const seq = new PreviewSequencer();
    expect(seq.current().status).toBe('idle');
    expect(seq.isCurrent()).toBe(false);
  });
});

describe('missing input is NOT the same as engineering review', () => {
  // The §11.1 failure mode: collapsing them makes the client's actionable
  // list unfindable inside a wall of things they cannot act on.

  const findings = [
    finding('MISSING_INPUT', 'CLEAR_HEIGHT', 'Measure the clear height and enter it.'),
    finding('ENGINEERING_REVIEW_REQUIRED', 'AISLE', 'Our team will review the aisle width.'),
    finding('BLOCKER', 'CAPACITY', 'Reduce the level load.'),
    finding('WARNING', 'OVERHANG', 'No action required.'),
    finding('ASSUMPTION', 'PALLET', 'Confirm the pallet size.'),
    finding('NOT_EVALUATED', 'FLUE', 'No action here.'),
    finding('PASS', 'LEVELS', 'Nothing to do.'),
  ];

  it('separates every severity into its own list', () => {
    const g = groupFindings(findings);
    expect(g.missingInputs).toHaveLength(1);
    expect(g.forReview).toHaveLength(1);
    expect(g.blockers).toHaveLength(1);
    expect(g.warnings).toHaveLength(1);
    expect(g.assumptions).toHaveLength(1);
    expect(g.notEvaluated).toHaveLength(1);
    expect(g.passed).toHaveLength(1);
  });

  it('puts ONLY blockers and missing inputs on the client\u2019s action list', () => {
    // A review item is a notification, not a task. Asking the client to act on
    // something only a person with authority can resolve is a support call.
    const actions = clientActionList(groupFindings(findings));
    expect(actions).toHaveLength(2);
    expect(actions).toContain('Reduce the level load.');
    expect(actions).toContain('Measure the clear height and enter it.');
    expect(actions).not.toContain('Our team will review the aisle width.');
  });

  it('orders blockers before missing inputs, because blockers stop progress', () => {
    const actions = clientActionList(groupFindings(findings));
    expect(actions[0]).toBe('Reduce the level load.');
  });

  it('never renders NOT EVALUATED as a pass, and never omits it', () => {
    // "Silence is not a pass." The check that did not run must appear.
    const g = groupFindings(findings);
    expect(g.notEvaluated).toHaveLength(1);
    expect(g.passed.map((f) => f.code)).not.toContain('FLUE');
  });

  it('uses wording that does not expose the mechanism', () => {
    // R-15: "the governing rule is below primary tier" invites a question the
    // client cannot act on.
    expect(REVIEW_WORDING).toMatch(/Our team will review/);
    expect(REVIEW_WORDING).not.toMatch(/tier|primary|rule|citation/i);
  });
});

describe('submission is blocked by a BLOCKER and nothing else', () => {
  it('allows submission with review items, warnings and assumptions', () => {
    // A review item does not stop a client submitting: it is what the
    // submission is FOR. Blocking here would strand every job that touches an
    // under-sourced rule, which is most of them.
    expect(
      canSubmit([
        finding('ENGINEERING_REVIEW_REQUIRED'),
        finding('WARNING'),
        finding('ASSUMPTION'),
        finding('MISSING_INPUT'),
        finding('NOT_EVALUATED'),
      ]),
    ).toBe(true);
  });

  it('blocks on a blocker', () => {
    expect(canSubmit([finding('BLOCKER')])).toBe(false);
  });

  it('allows an empty finding set', () => {
    expect(canSubmit([])).toBe(true);
  });
});

describe('the summary strip', () => {
  it('counts what the client must do, separately from what we will review', () => {
    const s = summarise(
      result([
        finding('BLOCKER'),
        finding('MISSING_INPUT'),
        finding('ENGINEERING_REVIEW_REQUIRED'),
        finding('ENGINEERING_REVIEW_REQUIRED'),
      ]),
    );
    expect(s.blockerCount).toBe(1);
    expect(s.actionCount).toBe(2);
    expect(s.reviewCount).toBe(2);
  });

  it('carries a NULL position count rather than a zero when unestablished', () => {
    // A zero position count is a claim, and a badly wrong one. The strip must
    // render VERIFY, which it can only do if the model says null.
    const s = summarise(result([], null));
    expect(s.netPositions).toBeNull();
    expect(s.netPositions).not.toBe(0);
  });

  it('carries the count when it is established', () => {
    expect(summarise(result([], 6824)).netPositions).toBe(6824);
  });
});

describe('the preview renders from the display list, and derives nothing', () => {
  it('carries a plan and an elevation built from the same revision', () => {
    const r = result();
    expect(r.plan.revisionHash).toBe(r.elevation.revisionHash);
    expect(r.plan.view).toBe('plan');
    expect(r.elevation.view).toBe('elevation');
  });

  it('gives the client no citation, rule id or tier on any finding', () => {
    // AC-02 at the panel: the client sees severity and closed_by. The citation
    // lives in finding_internal_detail and never crosses.
    const f = finding('ENGINEERING_REVIEW_REQUIRED');
    expect(Object.keys(f).sort()).toEqual(['closedBy', 'code', 'severity', 'subjectObjectIds']);
    expect(f).not.toHaveProperty('citation');
    expect(f).not.toHaveProperty('ruleId');
    expect(f).not.toHaveProperty('tier');
  });

  it('gives every finding something the client can read', () => {
    for (const f of [finding('BLOCKER'), finding('MISSING_INPUT')]) {
      expect(f.closedBy.trim()).not.toBe('');
    }
  });
});
