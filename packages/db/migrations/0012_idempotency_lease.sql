-- 0012 — a stranded claim gets released (task T-13d, EL's decision 2026-09-03).
--
-- AD-3 chose `409` for an in-flight duplicate over waiting, and that is right.
-- What it did not say is what happens when the process holding the claim dies:
-- the row stays `in_flight`, and **every retry of that key gets 409 for the
-- full 30-day retention window**. Nothing settled it and nothing swept it. A
-- claim that cannot be released is a submission the user can never make, and no
-- amount of retrying fixes it — a correctness defect, not an operability gap.
--
-- EL's decision is both halves, deliberately:
--
--   LEASE          an `in_flight` row whose `claimed_at` is older than
--                  CLAIM_LEASE_MINUTES (default 10) is re-claimable. Handles
--                  the ordinary case with no human in the loop. Ten minutes is
--                  chosen against the effect these claims guard — a B2 upload
--                  that has not finished in ten minutes is dead or hitting a
--                  network fault a retry will solve — so it is long enough
--                  never to false-positive on a slow upload and short enough
--                  that nobody waits half an hour.
--   OPERATOR       `abandoned`, set through an internal route by an
--                  INTERNAL_ADMIN, writing an audit event. Handles the case
--                  where the lease is wrong or the work was genuinely long.
--
-- With only the lease, a genuinely long effect gets re-claimed under it. With
-- only the operator action, every stranded claim needs a human. With both,
-- the lease covers the ordinary case and the operator covers the exception.
--
-- WHAT THIS COSTS, stated rather than discovered later. A lease converts AD-3's
-- guarantee from "one effect per key, ever" to "one effect per key per lease
-- window". If a process is alive and slower than the lease, a second effect
-- CAN run. That is a real weakening and it is the price of not stranding
-- users; the mitigation is that the lease is set against the measured shape of
-- the effect, and that it is configurable without a deploy so it can be raised
-- the moment a legitimate effect is seen to outrun it.

BEGIN;

-- The fourth outcome. `failed` and `abandoned` are both terminal AND
-- re-claimable, and they differ in who ended it: `failed` is the effect
-- reporting its own rollback, `abandoned` is an operator overriding a claim
-- that reported nothing at all. Collapsing them would lose exactly the
-- distinction an audit reader needs.
--
-- ALTER TYPE ... ADD VALUE is permitted inside a transaction on PostgreSQL 12
-- and later, but the new value may not be USED until this transaction commits.
-- Nothing in this migration uses it, and that is deliberate rather than
-- incidental — a CHECK constraint naming 'abandoned' here would fail.
ALTER TYPE app.idempotency_outcome ADD VALUE IF NOT EXISTS 'abandoned';

-- The lease scan asks one question: which rows are still `in_flight` and were
-- claimed before a cutoff. Index it so a sweep does not read the whole table.
CREATE INDEX idempotency_lease_idx
  ON app.idempotency_key (claimed_at)
  WHERE claim_outcome = 'in_flight';

COMMIT;
