/**
 * The findings a derivation produces, as the CLIENT sees them.
 *
 * Declared here rather than in either front end because the submit transaction
 * has to name them: §13.1 step 2 refuses on every open `BLOCKER`, and a type
 * the refusal cannot name is a refusal that cannot be written down.
 *
 * What is ABSENT is the point. No citation, no rule id, no tier, no internal
 * note — those are the internal finding's fields, and §6's two-bundle rule
 * exists so they cannot reach a client screen. A single finding type with
 * optional internal fields would put the leak one `undefined` check away.
 */

/** A finding as the CLIENT sees it. No citation, no rule id, no tier. */
export interface ClientFinding {
  readonly code: string;
  readonly severity:
    | 'PASS'
    | 'BLOCKER'
    | 'WARNING'
    | 'MISSING_INPUT'
    | 'ASSUMPTION'
    | 'ENGINEERING_REVIEW_REQUIRED'
    | 'NOT_EVALUATED';
  /** Plain-English statement of what would resolve this. Never empty. */
  readonly closedBy: string;
  readonly subjectObjectIds: readonly string[];
}
