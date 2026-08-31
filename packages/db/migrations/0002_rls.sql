-- Row-level security, and the role split that makes it real.
--
-- RLS is the backstop, not the only control: application queries carry their
-- own tenant predicate too. The two fail DIFFERENTLY, which is the point. RLS
-- fails silently (a SELECT returns empty rather than erroring); application
-- predicates fail loudly in tests. Together you get a quiet net and a loud one.
--
-- Tenant context is set with set_config('app.organization_id', $1, true) INSIDE
-- an explicit transaction — the `true` makes it transaction-local. A
-- session-scoped SET survives the connection being handed to another client
-- under a transaction pooler, which is a cross-tenant leak waiting for a load
-- spike. See packages/db/src/with-tenant.ts, the only permitted entry point.

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------

-- The application role owns NOTHING and has neither SUPERUSER nor BYPASSRLS.
-- All three of those classes bypass RLS entirely, so ownership separation is
-- what makes the policies below more than decoration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev_only'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_user;

-- Audit events are append-only for the application: INSERT and SELECT only.
-- The trigger in 0001 refuses the rest as well, because two independent
-- controls are what an auditor actually asks for.
REVOKE UPDATE, DELETE ON app.audit_event FROM app_user;

-- --------------------------------------------------------------------------
-- Context helpers
-- --------------------------------------------------------------------------

-- Returns NULL when no tenant context is set. A NULL comparison is false, so
-- an unset context sees NOTHING rather than everything. Fail closed.
CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_actor_type() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_type', true), '');
$$;

-- Staff see across organizations; clients never do.
CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.current_actor_type() = 'staff';
$$;

-- --------------------------------------------------------------------------
-- Policies
-- --------------------------------------------------------------------------
--
-- Every tenant table gets ENABLE *and* FORCE. Enabling alone leaves the table
-- owner exempt; forcing closes that. A table where the ALTER was forgotten is
-- wide open, which is why tools/check-rls.mjs asserts this for every table
-- rather than trusting that it was remembered.
--
-- Every policy covers SELECT, INSERT (WITH CHECK), UPDATE and DELETE. A
-- USING-only policy lets a client WRITE a row into a tenant it cannot read.

-- Tenant-scoped tables: visible to the current organization, or to staff.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'app_user', 'membership', 'invitation', 'project', 'revision',
    'finding', 'assumption', 'uncatalogued_part', 'submission'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY %1$I_tenant_select ON app.%1$I FOR SELECT
        USING (organization_id = app.current_org() OR app.is_staff())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$I_tenant_insert ON app.%1$I FOR INSERT
        WITH CHECK (organization_id = app.current_org() OR app.is_staff())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$I_tenant_update ON app.%1$I FOR UPDATE
        USING (organization_id = app.current_org() OR app.is_staff())
        WITH CHECK (organization_id = app.current_org() OR app.is_staff())
    $f$, t);

    EXECUTE format($f$
      CREATE POLICY %1$I_tenant_delete ON app.%1$I FOR DELETE
        USING (organization_id = app.current_org() OR app.is_staff())
    $f$, t);
  END LOOP;
END
$$;

-- The organization table itself: a client sees only its own row. Our client
-- list is confidential, so "which other organizations exist" must not leak.
ALTER TABLE app.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_select ON app.organization FOR SELECT
  USING (id = app.current_org() OR app.is_staff());
CREATE POLICY organization_insert ON app.organization FOR INSERT
  WITH CHECK (app.is_staff());
CREATE POLICY organization_update ON app.organization FOR UPDATE
  USING (app.is_staff()) WITH CHECK (app.is_staff());
CREATE POLICY organization_delete ON app.organization FOR DELETE
  USING (app.is_staff());

-- Internal-only tables. Tenant-scoped AND staff-only: the actor_type predicate
-- is the second, independent control. A client principal cannot reach these
-- rows even if an application query forgets its own WHERE clause.
DO $$
DECLARE
  t text;
  internal_tables text[] := ARRAY['bom_line', 'internal_note', 'finding_internal_detail'];
BEGIN
  FOREACH t IN ARRAY internal_tables LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY %1$I_staff_select ON app.%1$I FOR SELECT
        USING (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_insert ON app.%1$I FOR INSERT
        WITH CHECK (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_update ON app.%1$I FOR UPDATE
        USING (app.is_staff()) WITH CHECK (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_delete ON app.%1$I FOR DELETE
        USING (app.is_staff())
    $f$, t);
  END LOOP;
END
$$;

-- Reference data: readable by staff only, writable by staff only. Not
-- tenant-scoped, because it is our data rather than a client's.
DO $$
DECLARE
  t text;
  reference_tables text[] := ARRAY['catalog_release', 'rule_pack_release'];
BEGIN
  FOREACH t IN ARRAY reference_tables LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format($f$
      CREATE POLICY %1$I_staff_select ON app.%1$I FOR SELECT USING (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_insert ON app.%1$I FOR INSERT WITH CHECK (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_update ON app.%1$I FOR UPDATE
        USING (app.is_staff()) WITH CHECK (app.is_staff())
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY %1$I_staff_delete ON app.%1$I FOR DELETE USING (app.is_staff())
    $f$, t);
  END LOOP;
END
$$;

-- Audit events. A client admin may read their OWN organization's events; staff
-- read all. Nobody updates or deletes: the policies refuse, the privileges are
-- revoked, and the trigger raises. Three independent controls, because a
-- dropped audit event is a control failure rather than a bad day.
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_event_select ON app.audit_event FOR SELECT
  USING (subject_organization_id = app.current_org() OR app.is_staff());
CREATE POLICY audit_event_insert ON app.audit_event FOR INSERT
  WITH CHECK (true);
-- Deliberately no UPDATE or DELETE policy: with RLS enabled, absent policy
-- means denied. Stated here so its absence reads as intent rather than
-- oversight, and check-rls.mjs knows about this exemption by name.
