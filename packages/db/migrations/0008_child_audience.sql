-- 0008 — the audience boundary reaches the rows that hang off a revision.
--
-- Review finding F-01, and the same defect as D-02 one join away.
--
-- 0005 closed app.revision: a client principal can no longer SELECT an internal
-- revision of its own organization. Four tables carrying a revision_id were not
-- closed, and their policies still read the generic tenant predicate alone:
--
--     organization_id = app.current_org() OR app.is_staff()
--
-- A derived internal revision carries the CLIENT'S OWN organization_id — that is
-- what made D-02 work, and it makes this work too. Demonstrated against a live
-- database before this migration was written: as a client principal of ORG_A the
-- internal revision row was correctly absent, and a `finding` attached to it was
-- fully readable, code and severity.
--
-- Suppressing the parent while publishing its children is the same shape as
-- suppressing a revision while publishing an audit event that names it, which is
-- what 0006 was written to fix. AC-14 says ABSENT, and absent has to mean absent
-- everywhere or it means nothing.
--
-- WHY THE CHECKER DID NOT SEE IT. check-rls asserts that a table CARRYING a
-- sensitivity column must name it in a policy. These four carried none — they
-- inherit their audience from a parent — so the control built to stop D-02
-- recurring was structurally unable to see D-02 recurring. This migration gives
-- them the column, which brings them inside that control with no new rule.
--
-- WHY A COMPOSITE FOREIGN KEY. A denormalised copy that can disagree with its
-- parent is a second source of truth and a slower version of the same bug.
-- (revision_id, audience) REFERENCES revision (id, audience) makes disagreement
-- impossible at the database rather than by convention — the same argument 0001
-- already makes for denormalising organization_id onto every child. It replaces
-- the single-column key rather than sitting beside it: a composite key implies
-- the simple one, and two constraints saying overlapping things is a moving
-- piece nobody needs.
--
-- bom_line, internal_note and finding_internal_detail are staff-only already and
-- are deliberately untouched. Their policy is app.is_staff() with no tenancy
-- clause at all, which is stricter than anything here.

BEGIN;

-- The FK target. Redundant against the primary key, which is what makes it free:
-- Postgres requires a unique constraint on exactly the referenced columns.
ALTER TABLE app.revision
  ADD CONSTRAINT revision_id_audience_key UNIQUE (id, audience);

DO $$
DECLARE
  t text;
  child_tables text[] := ARRAY['assumption', 'finding', 'submission', 'uncatalogued_part'];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    -- Nullable first, backfilled from the parent, then NOT NULL. A DEFAULT would
    -- survive the migration and let a later INSERT omit the column and inherit
    -- 'client' silently, which is the failure this closes wearing a convenience.
    EXECUTE format('ALTER TABLE app.%I ADD COLUMN audience app.audience', t);
    EXECUTE format(
      'UPDATE app.%I c SET audience = r.audience FROM app.revision r WHERE r.id = c.revision_id', t);
    EXECUTE format('ALTER TABLE app.%I ALTER COLUMN audience SET NOT NULL', t);

    EXECUTE format('ALTER TABLE app.%I DROP CONSTRAINT %I', t, t || '_revision_id_fkey');
    EXECUTE format($f$
      ALTER TABLE app.%1$I
        ADD CONSTRAINT %1$I_revision_audience_fkey
        FOREIGN KEY (revision_id, audience) REFERENCES app.revision (id, audience)
        ON DELETE CASCADE
    $f$, t);

    EXECUTE format($f$
      COMMENT ON COLUMN app.%1$I.audience IS
        'Inherited from the parent revision and held equal to it by the composite '
        'foreign key, not by convention. Enforced by RLS below: a row on an '
        'internal revision is ABSENT from a client principal''s result set. F-01.'
    $f$, t);

    -- Replaced, never amended: an added policy is OR-ed with the existing one by
    -- Postgres, which widens access rather than narrowing it. That is the single
    -- most common way an RLS "tightening" does the opposite.
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_select ON app.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_insert ON app.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_update ON app.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$I_tenant_delete ON app.%1$I', t);

    EXECUTE format($f$
      CREATE POLICY %1$I_audience_select ON app.%1$I FOR SELECT
        USING ((organization_id = app.current_org() AND audience = 'client') OR app.is_staff())
    $f$, t);

    -- WITH CHECK matters as much as USING, for the reason 0005 gives: without it
    -- a client could WRITE a row with audience='internal' into its own
    -- organization — invisible to itself afterwards and attributable to nobody.
    EXECUTE format($f$
      CREATE POLICY %1$I_audience_insert ON app.%1$I FOR INSERT
        WITH CHECK ((organization_id = app.current_org() AND audience = 'client') OR app.is_staff())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$I_audience_update ON app.%1$I FOR UPDATE
        USING ((organization_id = app.current_org() AND audience = 'client') OR app.is_staff())
        WITH CHECK ((organization_id = app.current_org() AND audience = 'client') OR app.is_staff())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$I_audience_delete ON app.%1$I FOR DELETE
        USING ((organization_id = app.current_org() AND audience = 'client') OR app.is_staff())
    $f$, t);

    -- The predicate's leading columns, matching revision_audience_idx on the
    -- parent. Every one of these tables is read by (organization_id, ...) today.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %1$I_org_audience_idx ON app.%1$I (organization_id, audience)', t);
  END LOOP;
END
$$;

COMMIT;
