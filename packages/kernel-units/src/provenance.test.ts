import { describe, expect, it } from 'vitest';
import {
  MAX_PROVENANCE_DEPTH,
  ProvenanceDepthError,
  emptySteps,
  isEstablished,
  isEstablishedOrigin,
  nodeCount,
  rulesUsed,
  um,
  unestablished,
  type ProvenanceNode,
} from './index.js';

const value = (label: string, origin: Parameters<typeof um>[1]): ProvenanceNode => ({
  kind: 'value',
  label,
  quantity: um(1, origin),
});

const step = (
  label: string,
  ruleId: string,
  inputs: readonly ProvenanceNode[],
): ProvenanceNode => ({ kind: 'step', label, ruleId, inputs });

describe('established origins', () => {
  it('treats INPUT, DERIVED, CATALOG and RULE as established', () => {
    expect(isEstablishedOrigin('INPUT')).toBe(true);
    expect(isEstablishedOrigin('DERIVED')).toBe(true);
    expect(isEstablishedOrigin('CATALOG')).toBe(true);
    expect(isEstablishedOrigin('RULE')).toBe(true);
  });

  it('never treats UNKNOWN as established', () => {
    expect(isEstablishedOrigin('UNKNOWN')).toBe(false);
  });
});

describe('walking a derivation graph', () => {
  const good = step('bay pitch', 'RULE-PITCH-01', [
    value('beam length', 'CATALOG'),
    value('frame width', 'CATALOG'),
  ]);

  it('reports an all-established graph as established', () => {
    expect(isEstablished(good)).toBe(true);
    expect(unestablished(good)).toHaveLength(0);
  });

  it('names every unestablished leaf rather than just failing', () => {
    const mixed = step('top of load', 'RULE-TOL-01', [
      value('beam elevation', 'CATALOG'),
      value('pallet height', 'UNKNOWN'),
      step('overhang', 'RULE-OH-01', [value('clear height', 'UNKNOWN')]),
    ]);

    const found = unestablished(mixed);
    expect(isEstablished(mixed)).toBe(false);
    expect(found.map((n) => n.label)).toEqual(['pallet height', 'clear height']);
  });

  it('collects every rule executed, without duplicates', () => {
    const g = step('a', 'RULE-1', [
      step('b', 'RULE-2', [value('x', 'INPUT')]),
      step('c', 'RULE-1', [value('y', 'INPUT')]),
    ]);
    expect(rulesUsed(g)).toEqual(['RULE-1', 'RULE-2']);
  });

  it('reports a step that claims to derive something from nothing', () => {
    const g = step('a', 'RULE-1', [step('from nowhere', 'RULE-2', [])]);
    expect(emptySteps(g).map((n) => n.label)).toEqual(['from nowhere']);
    expect(emptySteps(good)).toHaveLength(0);
  });

  it('visits every node exactly once', () => {
    expect(nodeCount(good)).toBe(3);
  });
});

describe('fail-closed behaviour', () => {
  it('terminates on a cycle instead of recursing forever', () => {
    const a: { kind: 'step'; label: string; ruleId: string; inputs: ProvenanceNode[] } = {
      kind: 'step',
      label: 'a',
      ruleId: 'RULE-1',
      inputs: [],
    };
    a.inputs.push(a as ProvenanceNode);
    expect(nodeCount(a as ProvenanceNode)).toBe(1);
  });

  it('refuses a graph deeper than the bound rather than truncating', () => {
    let node: ProvenanceNode = value('leaf', 'INPUT');
    for (let i = 0; i <= MAX_PROVENANCE_DEPTH + 1; i += 1) {
      node = step(`s${i}`, 'RULE-1', [node]);
    }
    expect(() => isEstablished(node)).toThrow(ProvenanceDepthError);
  });

  it('accepts a graph exactly at the bound', () => {
    let node: ProvenanceNode = value('leaf', 'INPUT');
    for (let i = 0; i < MAX_PROVENANCE_DEPTH; i += 1) {
      node = step(`s${i}`, 'RULE-1', [node]);
    }
    expect(isEstablished(node)).toBe(true);
  });
});
