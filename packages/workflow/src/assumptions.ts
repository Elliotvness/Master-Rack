/**
 * The assumption register (§11.6) — owned by neither app.
 *
 * An assumption is a stated planning value used in place of a missing input.
 * The blueprint is explicit that it is *"a first-class record, not a
 * footnote"*, and it names three places the same record has to appear: the
 * pre-submit confirmation, the client PDF, and the top of the internal review
 * package.
 *
 * Three audiences is why the type lives here rather than in either app. A
 * client-side `Assumption` and an internal-side `Assumption` that happen to
 * agree today are two contracts, and the day they stop agreeing is the day
 * "you accepted a 4-inch overhang assumption" becomes arguable again — which
 * is the exact failure §11.6 exists to prevent.
 *
 * It sits in `@rms/workflow` rather than `@rms/contracts` because the register
 * is produced by the submit transaction, not carried on the wire, and because
 * a pure package may not import `@rms/contracts` at all — see
 * `tools/check-boundaries.mjs`.
 *
 * Types only: no runtime, no I/O, no clock, no RNG.
 */

/** One entry in the register. Field-for-field, §11.6's record. */
export interface Assumption {
  /** Stable identifier, e.g. `pallet.overhang.front`. What acknowledgement keys to. */
  readonly key: string;
  /** The value actually used, with its unit. Integer micrometres for lengths. */
  readonly assumedValue: { readonly value: number; readonly unit: string };
  /** Why the model had to assume rather than read. Written for the client. */
  readonly why: string;
  /** Which objects it affected. */
  readonly scope: string;
  /**
   * The client user who confirmed it at submit, and when.
   *
   * Optional because the register exists before anyone has acknowledged it: a
   * draft's register is derived on every preview. Present on a register read
   * back from a frozen submission, and the internal review package refuses to
   * assemble without it.
   */
  readonly acknowledgedBy?: string;
  readonly acknowledgedAt?: string;
}

/**
 * The record that a client acknowledged the register.
 *
 * `auditEventId` is not decoration. §11.6 makes the acknowledgement an audit
 * event and AC-15 requires the event to be written in the same transaction as
 * the thing it describes, so an acknowledgement that comes back without one
 * did not happen atomically — and a submission built on it would assert an
 * acceptance that nothing recorded.
 */
export interface Acknowledgement {
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
  /** AC-15 — written in the same transaction. Blank means it was not. */
  readonly auditEventId: string;
  /** Every `Assumption.key` this acknowledgement covers. */
  readonly keys: readonly string[];
}
