-- 0007 — a client action must name the organization that performed it.
--
-- Review finding F-04, alongside F-03: the 0006 policy reads
--
--     (actor_organization_id = app.current_org() AND actor_type = 'client')
--       OR app.is_staff()
--
-- `actor_type` is NOT NULL. `actor_organization_id` is not, and `app.audit_event`
-- carried no CHECK constraints at all. A NULL in that comparison yields NULL
-- rather than false, so a client-actor event written without an actor
-- organization is invisible to EVERY client principal — including the
-- organization whose own action it records.
--
-- It fails CLOSED, so this is not a disclosure. It is a hole in a client's own
-- audit trail, and 0002 states why that matters in its own words: "RLS fails
-- silently (a SELECT returns empty rather than erroring); application predicates
-- fail loudly in tests." Here both halves would be silent. A row that nobody can
-- read is not much better than a row that was never written, and an audit trail
-- is the one table where "we cannot tell which" is not an acceptable answer.
--
-- Staff and service events legitimately carry no actor organization — a
-- background job that belongs to no tenant is a real case — so the constraint is
-- conditional rather than a blanket NOT NULL. It says the narrow true thing: if
-- you claim a client did it, say which client.

BEGIN;

ALTER TABLE app.audit_event
  ADD CONSTRAINT audit_event_client_actor_has_org
  CHECK (actor_type <> 'client' OR actor_organization_id IS NOT NULL);

COMMENT ON CONSTRAINT audit_event_client_actor_has_org ON app.audit_event IS
  'A client-actor event names the organization that performed it. Without this '
  'the 0006 policy compares against NULL and the event is invisible to the '
  'client whose action it records — silently, because RLS returns empty rather '
  'than raising. F-04.';

COMMIT;
