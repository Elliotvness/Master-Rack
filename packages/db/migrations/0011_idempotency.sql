-- 0011 — the idempotency key store (task T-13d, decision AD-3).
--
-- §8.3: "Idempotency keys on submit, derive, clone and invite. A double-click
-- must not produce two submissions." AD-3 is the contract behind that sentence,
-- and its first line is the reason this is a UNIQUE CONSTRAINT rather than
-- application code: "A SELECT then INSERT is a race, not a guard — and under a
-- retry storm the race is exactly when it fires."
--
-- So the claim is `INSERT … ON CONFLICT (organization_id, key) DO NOTHING`.
-- The database arbitrates. Two callers racing on one key cannot both win,
-- whatever the application layer believes about its own ordering.
--
-- THREE OUTCOMES, NOT TWO (AD-3). The intent row is written and COMMITTED
-- before the effect runs, in its own transaction. That is not an oversight
-- about atomicity — it is the point. A row written inside the effect's
-- transaction disappears when the effect rolls back or the process dies, and a
-- crash between the call and the response then leaves nothing at all: the next
-- retry looks like a first attempt and duplicates the work. Committing the
-- intent first means a crash leaves `in_flight`, which is evidence.
--
-- RETENTION. `expires_at` is set 30 days out, and 30 days is not a disk-cost
-- number: AD-3 requires the window to outlive the longest retry path, which is
-- the outbox's dead-letter replay window. `idempotency.test.ts` computes that
-- window from `backoffFor` and `max_attempts` and asserts 30 days exceeds it,
-- so the relationship is a test rather than a sentence in a comment.

BEGIN;

-- The three outcomes AD-3 names, and no more. T-13b's review (F-38) was a
-- six-state status vocabulary invented for a table that needed three; the
-- alphabet here is exactly the one the decision record uses.
--
--   in_flight  claimed, effect not yet settled — or the process died holding it
--   succeeded  the effect committed; a retry with this key must not re-run it
--   failed     the effect rolled back; the intent may be claimed again
CREATE TYPE app.idempotency_outcome AS ENUM ('in_flight', 'succeeded', 'failed');

CREATE TABLE app.idempotency_key (
  -- Caller-supplied, like every other id in this schema. A DEFAULT
  -- gen_random_uuid() would make the id an accident of insert order.
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),

  -- The CLIENT's key. AD-3: generated once per intent and reused across
  -- retries, never derived from a per-attempt UUID or a timestamp. The
  -- database cannot enforce that origin; it can only make the key mean one
  -- thing, which the unique constraint below does.
  key             text NOT NULL,

  -- Which operation this key was claimed for — one of §8.3's four. Evidence,
  -- and a second axis for the payload guard: two different operations that
  -- happen to hash identically are still two different intents, so a key
  -- reused across them is a reuse, not a retry. It is deliberately NOT part of
  -- the unique constraint, because AD-3 names `(organization_id, key)` and
  -- scoping the key by route would let one key claim four intents at once.
  intent          text NOT NULL,

  -- SHA-256 over the canonical text of the request body, dropping nothing
  -- (`canonicaliseAll`). AD-3: same key, different body ⇒ 422, loudly.
  request_hash    text NOT NULL,

  claim_outcome   app.idempotency_outcome NOT NULL DEFAULT 'in_flight',

  -- The row the effect produced — a submission id, an invitation id. Null
  -- until the effect settles, and null forever on a failure.
  --
  -- A reference rather than a stored response body, deliberately. This
  -- product's architecture is one canonical model with everything derived from
  -- it (§19.2, "no screen-only models"); a frozen response body cached here
  -- would be exactly that, and it would go stale the first time a DTO changed
  -- while claiming to be what the client saw. The handler re-renders from the
  -- referenced row through the same outbound DTO T-13b validates.
  result_ref      uuid,

  claimed_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  expires_at      timestamptz NOT NULL,

  -- AD-3's atomic claim. Everything else in this file is bookkeeping around
  -- this line.
  CONSTRAINT idempotency_key_org_key_uniq UNIQUE (organization_id, key),

  -- An empty key is a key that collides with every other empty key, which
  -- turns the guard into a denial of service for the second caller.
  CONSTRAINT idempotency_key_nonempty CHECK (length(btrim(key)) > 0),
  CONSTRAINT idempotency_intent_nonempty CHECK (length(btrim(intent)) > 0),

  -- 64 lowercase hex characters. A truncated or re-encoded hash compares
  -- unequal to itself and would return 422 for a genuine retry.
  CONSTRAINT idempotency_request_hash_shape CHECK (request_hash ~ '^[0-9a-f]{64}$'),

  -- A settled row has a settling time and an unsettled one does not. Without
  -- this, `settled_at` is a column the application remembers to write.
  CONSTRAINT idempotency_settled_consistency CHECK (
    (claim_outcome = 'in_flight') = (settled_at IS NULL)
  ),

  -- Only a success can point at a result. A failed intent with a result_ref is
  -- a row claiming the effect both did and did not happen.
  CONSTRAINT idempotency_result_only_on_success CHECK (
    result_ref IS NULL OR claim_outcome = 'succeeded'
  ),

  CONSTRAINT idempotency_expiry_after_claim CHECK (expires_at > claimed_at)
);

-- The retention sweep filters on expires_at alone; index it so a purge over a
-- large table does not scan it.
CREATE INDEX idempotency_expiry_idx ON app.idempotency_key (expires_at);

-- Tenant-scoped exactly like the outbox: a client claims and reads only its own
-- organization's keys, and a staff context sees all, which is what lets the
-- retention sweep run as a service principal over every organization.
ALTER TABLE app.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_key FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_key_tenant_select ON app.idempotency_key FOR SELECT
  USING (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY idempotency_key_tenant_insert ON app.idempotency_key FOR INSERT
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY idempotency_key_tenant_update ON app.idempotency_key FOR UPDATE
  USING (organization_id = app.current_org() OR app.is_staff())
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY idempotency_key_tenant_delete ON app.idempotency_key FOR DELETE
  USING (organization_id = app.current_org() OR app.is_staff());

-- F-31: `GRANT … ON ALL TABLES` in 0002 covered only the tables that existed
-- then. A table added later is invisible to app_user with a permission denied,
-- and check-rls reports PASS over it because RLS really is enabled.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.idempotency_key TO app_user;

COMMIT;
