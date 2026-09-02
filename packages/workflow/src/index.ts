/**
 * @rms/workflow
 *
 * The submit transaction (§13.1), the assumption register (§11.6), and internal
 * revision derivation (`E-04`, `E-05`, `AC-14`).
 *
 * Audit **D-01**: all of this used to live in `apps/client-web` — by the
 * repository's own definition, "the bundle a client downloads". The module was
 * never the problem; the package was. If the only thing enforcing a nine-step
 * sequence ships to the browser, a caller reaching the endpoints directly can
 * skip steps, repeat them, or arrive at a terminal step without its
 * prerequisites. Workflow state belongs on the server, in storage the client
 * cannot write to.
 *
 * It is a pure package rather than part of `apps/api` (AD-1) because the
 * ordering is the invariant, and an invariant that needs a database to observe
 * is one nobody tests. Every effect is injected; `apps/api` supplies them and
 * owns the transaction.
 *
 * Pure: no I/O, no clock, no RNG.
 */

export type { Acknowledgement, Assumption } from './assumptions.js';

export type { ClientFinding } from './finding.js';

export {
  DerivationError,
  deriveInternalRevision,
  internalNote,
  stripInternalRevisions,
  type DeriveResult,
  type InternalNote,
  type InternalRevision,
  type SourceSubmission,
} from './internal.js';

export {
  SUBMIT_STEPS,
  SubmitError,
  preSubmitConfirmation,
  stepsInOrder,
  submit,
  submitRefusals,
  type Derivation,
  type SubmitEffects,
  type SubmitInput,
  type SubmitResult,
  type SubmitStep,
} from './submit.js';
