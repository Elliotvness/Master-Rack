-- 0006 — a client admin reads its own people's actions, not ours.
--
-- Found by the sensitivity-column assertion added to check-rls in 0005, on its
-- first run. Not in the Rev C audit: the audit found `revision.audience`, and
-- the checker built to stop that class of defect recurring immediately found
-- another instance of it.
--
-- The policy read:
--
--     subject_organization_id = app.current_org() OR app.is_staff()
--
-- `subject_organization_id` is the organization an event is ABOUT. When an
-- internal user derives a working revision from Harbor Logistics' submission,
-- the subject is Harbor Logistics -- so Harbor Logistics' own admin could read
-- an audit event saying `revision.derived`, and `bom.viewed`, and every other
-- staff action on their job.
--
-- That discloses the existence of an internal derived revision, which AC-14
-- requires to be ABSENT from every client-facing response. Suppressing the
-- revision row while publishing an audit event that names it would be a
-- thorough job of closing one door and leaving the next one open.
--
-- Section 2 grants a client admin "own organization's own events only". The
-- operative word is OWN: events their people generated. A staff action on their
-- project is our event about their project, and it stays ours.
--
-- Both conditions are required, not either:
--   actor_organization_id  -- whose people did it
--   actor_type = 'client'  -- and they were acting as a client principal
-- The second is not redundant. SERVICE_ENGINE writes derived outputs and audit
-- events, and a service principal acting inside a client organization is not
-- that organization's own action either.

BEGIN;

DROP POLICY IF EXISTS audit_event_select ON app.audit_event;

CREATE POLICY audit_event_select ON app.audit_event FOR SELECT
  USING (
    (actor_organization_id = app.current_org() AND actor_type = 'client')
    OR app.is_staff()
  );

CREATE INDEX IF NOT EXISTS audit_event_actor_org_idx
  ON app.audit_event (actor_organization_id, actor_type);

COMMENT ON POLICY audit_event_select ON app.audit_event IS
  'A client principal reads only events its OWN people generated as client '
  'actors. Staff actions on a client''s project are not that client''s events, '
  'and publishing them would disclose internal revisions that AC-14 requires '
  'to be absent. Staff read everything.';

COMMIT;
