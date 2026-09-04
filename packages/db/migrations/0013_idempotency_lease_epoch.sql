-- 0013 — the lease gets a fence (task T-13d, found by adversarial review).
--
-- 0012 added the lease and it was NOT a fence. A takeover reused the same row
-- id, and `settleOn` guarded only on `claim_outcome = 'in_flight'`, so the
-- overtaken holder was byte-identical to the new one as far as settling was
-- concerned. Review demonstrated it rather than argued it:
--
--     stale holder A settle -> true
--     real  holder B settle -> false
--     replay -> A's result_ref, while B's effect had also committed
--
-- The client is handed the wrong result for an effect that ran twice — the
-- exact failure AD-3 exists to prevent. And worse than the cost 0012 stated:
-- a stale holder settling `failed` frees the key IMMEDIATELY, no lease expiry
-- needed, so a third effect can start at once. "One effect per key per lease
-- window" was not the guarantee. There was no bound at all.
--
-- `lease_epoch` is the fence token, and it is the whole fix. It increments on
-- every claim of a row that already exists — a re-claim of a terminal state, or
-- a lease takeover — and the epoch a caller was handed is required by every
-- settle. A holder whose lease was taken carries a stale epoch, its settle
-- matches no row, and it is told so.
--
-- Integer, not a timestamp: two takeovers inside one clock tick must still be
-- distinguishable, and monotonicity is the only property needed.

BEGIN;

ALTER TABLE app.idempotency_key
  ADD COLUMN lease_epoch integer NOT NULL DEFAULT 1;

-- A fence that can go backwards is not a fence.
ALTER TABLE app.idempotency_key
  ADD CONSTRAINT idempotency_lease_epoch_positive CHECK (lease_epoch >= 1);

COMMENT ON COLUMN app.idempotency_key.lease_epoch IS
  'Fence token. Incremented on every re-claim or lease takeover; a settle must '
  'present the epoch it was claimed under, so an overtaken holder cannot settle '
  'a claim it no longer holds.';

COMMIT;
