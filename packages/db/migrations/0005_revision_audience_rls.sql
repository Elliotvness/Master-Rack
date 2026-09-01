-- 0005 — the revision audience predicate.
--
-- Audit finding D-02, and the most serious of the three structural defects it
-- found.
--
-- app.revision has carried an `audience` column since 0001. It is NOT NULL, it
-- is indexed as (organization_id, audience), and its comment says exactly the
-- right thing: internal revisions are ABSENT from client responses, never
-- "visible but locked". The word `audience` then appeared nowhere in 0002_rls,
-- because `revision` was swept into the generic tenant-table loop whose policy
-- reads only:
--
--     organization_id = app.current_org() OR app.is_staff()
--
-- A derived internal revision carries the CLIENT'S OWN organization_id -- it is
-- derived from their submission -- so that predicate passes it. A client
-- principal with the tenant context correctly set could SELECT the internal
-- revisions of their own projects. The only thing preventing it was
-- stripInternalRevisions(), an Array.filter() living in a front-end package,
-- which is precisely the "field filtering in the serializer" that section 6.3
-- rejects by name.
--
-- Section 2 states the failure this closes, in its own words: "Organization
-- isolation stops Client A seeing Client B. It does nothing to stop Client A
-- seeing our margin on Client A's own project." Two orthogonal dimensions are
-- required, and only one of them was at the database.
--
-- The application-layer filter is NOT removed. Two independent controls is the
-- design; one of them being the only one is not. RLS fails silently (an empty
-- result), application predicates fail loudly in tests -- a quiet net and a
-- loud one.

BEGIN;

-- The generic policies are replaced, not amended: an added policy would be
-- OR-ed with these by Postgres, which would widen access rather than narrow it.
-- That is the single most common way an RLS "tightening" does the opposite.
DROP POLICY IF EXISTS revision_tenant_select ON app.revision;
DROP POLICY IF EXISTS revision_tenant_insert ON app.revision;
DROP POLICY IF EXISTS revision_tenant_update ON app.revision;
DROP POLICY IF EXISTS revision_tenant_delete ON app.revision;

-- A client sees only its own organization's CLIENT-audience revisions. Staff
-- see everything, which is the asymmetry the two applications exist for.
CREATE POLICY revision_audience_select ON app.revision FOR SELECT
  USING (
    (organization_id = app.current_org() AND audience = 'client')
    OR app.is_staff()
  );

-- WITH CHECK matters as much as USING here. Without it a client could WRITE a
-- row with audience='internal' into its own organization: invisible to itself
-- afterwards, present in every staff queue, and attributable to nobody. A
-- USING-only policy is a write hole wearing a read control's clothes.
CREATE POLICY revision_audience_insert ON app.revision FOR INSERT
  WITH CHECK (
    (organization_id = app.current_org() AND audience = 'client')
    OR app.is_staff()
  );

-- Both clauses on UPDATE: USING decides which rows are visible to update,
-- WITH CHECK decides what they may become. Without the second, a client could
-- flip one of its own client revisions to audience='internal' -- a one-way
-- disappearance from its own view.
CREATE POLICY revision_audience_update ON app.revision FOR UPDATE
  USING (
    (organization_id = app.current_org() AND audience = 'client')
    OR app.is_staff()
  )
  WITH CHECK (
    (organization_id = app.current_org() AND audience = 'client')
    OR app.is_staff()
  );

CREATE POLICY revision_audience_delete ON app.revision FOR DELETE
  USING (
    (organization_id = app.current_org() AND audience = 'client')
    OR app.is_staff()
  );

COMMENT ON COLUMN app.revision.audience IS
  'client | internal. Enforced by RLS (0005), not only by the application: an '
  'internal revision is ABSENT from a client principal''s result set, never '
  'returned-and-filtered. AC-14.';

COMMIT;
