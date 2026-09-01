-- 0009 — the assumption register becomes the §11.6 record it claims to be.
--
-- Audit D-04, task T-06. Two gaps, both structural:
--
--   1. `scope` — §11.6's record is `{ key, assumed_value {value, unit}, why,
--      scope, acknowledged_by, acknowledged_at }`. The table carried five of
--      the six. An assumption whose scope is unrecorded cannot answer the one
--      question a reviewer asks of it — WHICH objects did this affect — so the
--      record was not a record.
--
--   2. The acknowledgement had no audit event behind it. §11.6: "The client's
--      acknowledgement is an audit event and is what makes the internal
--      conversation 'you accepted a 4-inch overhang assumption' a fact rather
--      than a recollection." Before this migration a row could carry
--      `acknowledged_by` and `acknowledged_at` with nothing in `audit_event`
--      to corroborate them — a recollection wearing a timestamp.
--
-- The CHECK is the mechanism, and it is deliberately in the schema rather than
-- in application code. Orchestration-level validation is a control the next
-- caller can route around; a CHECK constraint is one the database enforces for
-- every writer, including a psql session at 2am.
--
-- AC-15 is what this serves: the audit event is written in the same transaction
-- as the thing it describes. A transaction that writes the acknowledgement and
-- fails to write the event cannot commit, because the FK has nothing to point
-- at.

BEGIN;

-- No DEFAULT and no backfill. There is no defensible stand-in for "which
-- objects this assumption affected", and a DEFAULT '' would survive the
-- migration and let every later INSERT omit the column and inherit blank —
-- absent by convention, which is the failure 0008 documents at length. If this
-- statement fails because rows exist, that is the correct outcome: the rows
-- need scopes, not the column a default.
ALTER TABLE app.assumption ADD COLUMN scope text NOT NULL;

ALTER TABLE app.assumption
  ADD CONSTRAINT assumption_scope_not_blank CHECK (btrim(scope) <> '');

COMMENT ON COLUMN app.assumption.scope IS
  'Which objects this assumption affected. §11.6. NOT NULL and non-blank: an '
  'assumption whose scope is unknown cannot be reviewed, only believed.';

ALTER TABLE app.assumption
  ADD COLUMN acknowledgement_audit_event_id uuid REFERENCES app.audit_event(event_id);

COMMENT ON COLUMN app.assumption.acknowledgement_audit_event_id IS
  'The audit event that recorded the client acknowledging this assumption. §11.6 '
  'makes the acknowledgement an audit event; this foreign key is what makes that '
  'a fact the database enforces rather than a sentence in a docstring.';

-- All three or none. The realistic failure is not a wrong value, it is a row
-- marked acknowledged by someone at some time with no event behind it — which
-- reads, to anyone auditing later, exactly like a real acknowledgement.
ALTER TABLE app.assumption
  ADD CONSTRAINT assumption_acknowledged_all_or_nothing CHECK (
    (
      acknowledged_by IS NULL
      AND acknowledged_at IS NULL
      AND acknowledgement_audit_event_id IS NULL
    )
    OR (
      acknowledged_by IS NOT NULL
      AND acknowledged_at IS NOT NULL
      AND acknowledgement_audit_event_id IS NOT NULL
    )
  );

COMMIT;
