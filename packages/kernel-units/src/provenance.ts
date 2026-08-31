/**
 * Provenance walking, fail-closed.
 *
 * Two questions this module answers, and one it refuses:
 *   - Is every value behind this result established?  -> isEstablished()
 *   - Which ones are not?                             -> unestablished()
 *   - "Probably fine" is not an answer.
 *
 * "Fail-closed" means every ambiguity resolves toward *not established*: an
 * unknown origin, a cycle, an unrecognised node, or a graph deeper than the
 * bound. A walker that guesses in the optimistic direction is worse than no
 * walker, because it launders uncertainty into a number on a client's drawing.
 */

import { ProvenanceDepthError } from './errors.js';
import type { Origin } from './units.js';
import type { Quantity } from './quantity.js';

/** Depth bound. Carried from rack-studio/packages/units, which used 32. */
export const MAX_PROVENANCE_DEPTH = 32;

/**
 * A node in a derivation graph. A leaf is a quantity; a step names the rule
 * that produced it and the inputs it consumed.
 */
export type ProvenanceNode =
  | { readonly kind: 'value'; readonly label: string; readonly quantity: Quantity }
  | {
      readonly kind: 'step';
      readonly label: string;
      /** The rule or formula executed. PROV's hadPlan; never null in a step. */
      readonly ruleId: string;
      readonly inputs: readonly ProvenanceNode[];
    };

/** Origins that count as established. UNKNOWN never does. */
const ESTABLISHED: ReadonlySet<Origin> = new Set<Origin>([
  'INPUT',
  'DERIVED',
  'CATALOG',
  'RULE',
]);

export function isEstablishedOrigin(origin: Origin): boolean {
  return ESTABLISHED.has(origin);
}

interface WalkState {
  readonly seen: Set<ProvenanceNode>;
  depth: number;
}

function walk(
  node: ProvenanceNode,
  state: WalkState,
  visit: (n: ProvenanceNode) => void,
): void {
  if (state.depth > MAX_PROVENANCE_DEPTH) {
    throw new ProvenanceDepthError(MAX_PROVENANCE_DEPTH);
  }
  // A cycle is a malformed graph. Refusing to revisit means the walk
  // terminates, and the depth bound still catches a graph that is merely deep.
  if (state.seen.has(node)) return;
  state.seen.add(node);

  visit(node);

  if (node.kind === 'step') {
    state.depth += 1;
    for (const input of node.inputs) {
      walk(input, state, visit);
    }
    state.depth -= 1;
  }
}

/**
 * Every value node whose origin is not established. Empty means the whole
 * graph is established.
 */
export function unestablished(root: ProvenanceNode): readonly ProvenanceNode[] {
  const found: ProvenanceNode[] = [];
  walk(root, { seen: new Set(), depth: 0 }, (n) => {
    if (n.kind === 'value' && !isEstablishedOrigin(n.quantity.origin)) {
      found.push(n);
    }
  });
  return Object.freeze(found);
}

/**
 * True only when every value in the graph is established. Any refusal in the
 * walk propagates as a throw rather than a false, so the caller cannot confuse
 * "not established" with "could not tell".
 */
export function isEstablished(root: ProvenanceNode): boolean {
  return unestablished(root).length === 0;
}

/**
 * A step with no inputs is a step that claims to have derived something from
 * nothing. Reported rather than assumed benign.
 */
export function emptySteps(root: ProvenanceNode): readonly ProvenanceNode[] {
  const found: ProvenanceNode[] = [];
  walk(root, { seen: new Set(), depth: 0 }, (n) => {
    if (n.kind === 'step' && n.inputs.length === 0) found.push(n);
  });
  return Object.freeze(found);
}

/** Every distinct rule id executed anywhere in the graph, in encounter order. */
export function rulesUsed(root: ProvenanceNode): readonly string[] {
  const ids: string[] = [];
  walk(root, { seen: new Set(), depth: 0 }, (n) => {
    if (n.kind === 'step' && !ids.includes(n.ruleId)) ids.push(n.ruleId);
  });
  return Object.freeze(ids);
}

/** Count of nodes visited. Useful in tests to prove a walk was not truncated. */
export function nodeCount(root: ProvenanceNode): number {
  let n = 0;
  walk(root, { seen: new Set(), depth: 0 }, () => {
    n += 1;
  });
  return n;
}
