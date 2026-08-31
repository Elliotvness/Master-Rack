-- Transactional outbox (A-11).
--
-- Blueprint §6.2 (jobs), §13.1 (submit enqueues via the outbox).
--
-- The guarantee: a message is written in the SAME transaction as the business
-- change that produces it. If that transaction rolls back, the message was
-- never written, so nothing is dispatched for work that did not happen — no
-- email for a submission that failed, no notification for a rolled-back edit.
-- The alternative, sending inline, fails in both directions: a send after the
-- commit can be lost if the process dies, and a send before the commit fires
-- for a transaction that then rolls back.
--
-- A worker claims pending rows, dispatches them, and marks them done or failed.
-- Claiming uses FOR UPDATE SKIP LOCKED so many workers can drain the table
-- without contending on the same rows.

CREATE TYPE app.outbox_status AS ENUM ('pending', 'dispatched', 'failed', 'dead');

CREATE TABLE app.outbox_message (
  id              uuid PRIMARY KEY,
  -- Not tenant-scoped by RLS: the worker runs as a system principal draining
  -- every organization's messages. organization_id is carried for routing and
  -- for the audit trail, not for isolation.
  organization_id uuid REFERENCES app.organization(id),
  -- What kind of side effect this is: 'email.invitation', 'email.submission', etc.
  topic           text NOT NULL,
  -- The payload the worker needs to perform the side effect. Never contains a
  -- secret; it references ids the worker resolves under its own authority.
  payload         jsonb NOT NULL,
  status          app.outbox_status NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 5,
  -- The earliest time a worker may claim this row. Advanced on each failure for
  -- exponential backoff. A row is claimable when now() >= available_at.
  available_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz,
  last_error      text,
  CONSTRAINT outbox_attempts_nonneg CHECK (attempts >= 0),
  -- A dead-lettered row has exhausted its attempts; a dispatched row has a time.
  CONSTRAINT outbox_terminal_consistency CHECK (
    (status <> 'dispatched') OR (dispatched_at IS NOT NULL)
  )
);

-- The worker's claim query filters on (status, available_at); index it so
-- draining a large backlog does not scan the whole table.
CREATE INDEX outbox_claimable_idx
  ON app.outbox_message (available_at)
  WHERE status = 'pending';

-- The outbox is written inside the business transaction (as whatever principal
-- made the change — often a client) and drained by a worker running with a
-- staff context. It carries organization_id and gets the same RLS treatment as
-- every other tenant table: a client can enqueue/see only its own org's
-- messages; a staff-context worker sees all, which is how it drains the queue.
-- No exemption in check-rls is needed, and no client route reaches it anyway.
ALTER TABLE app.outbox_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox_message FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_tenant_select ON app.outbox_message FOR SELECT
  USING (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY outbox_tenant_insert ON app.outbox_message FOR INSERT
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY outbox_tenant_update ON app.outbox_message FOR UPDATE
  USING (organization_id = app.current_org() OR app.is_staff())
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY outbox_tenant_delete ON app.outbox_message FOR DELETE
  USING (organization_id = app.current_org() OR app.is_staff());

-- Explicit grant because ON ALL TABLES in an earlier migration does not cover a
-- table created later.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.outbox_message TO app_user;
