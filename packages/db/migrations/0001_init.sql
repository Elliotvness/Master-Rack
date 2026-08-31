-- Rack Master Studio — schema v1
--
-- Blueprint section 7 (canonical model) and section 14 (tenancy).
--
-- Five conventions run through every table here, and each one exists because
-- the obvious alternative leaks:
--
--   1. organization_id on every tenant-scoped row, denormalised rather than
--      joined. An RLS policy evaluates per candidate row, so a sub-select into
--      a memberships table both costs and can race.
--   2. Every uniqueness constraint is COMPOSITE with organization_id. Unique
--      and foreign-key checks bypass RLS entirely, so a global unique index
--      leaks another tenant's row existence through a constraint-violation
--      error message.
--   3. actor_type is denormalised onto app_user so a policy can read it
--      without a join.
--   4. Internal-only data lives in SEPARATE TABLES, never as a column on a
--      shared row. That turns "did we remember to strip a field?" — invisible
--      in review — into "did we join a table we should not have?" — visible.
--   5. Lengths are integer micrometres, loads integer millipounds. See
--      packages/kernel-units. BIGINT, never NUMERIC or REAL.

CREATE SCHEMA IF NOT EXISTS app;

-- --------------------------------------------------------------------------
-- Enumerations. Closed sets, so an invalid value is a database error rather
-- than a string nobody validated.
-- --------------------------------------------------------------------------

CREATE TYPE app.actor_type AS ENUM ('client', 'staff', 'service');

CREATE TYPE app.member_role AS ENUM (
  'CLIENT_USER',
  'CLIENT_ADMIN',
  'INTERNAL_SALES',
  'INTERNAL_ADMIN',
  'SERVICE_ENGINE'
);

CREATE TYPE app.lifecycle_state AS ENUM ('DRAFT', 'FROZEN', 'SUPERSEDED', 'WITHDRAWN');

CREATE TYPE app.audience AS ENUM ('client', 'internal');

CREATE TYPE app.release_status AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'RETIRED');

CREATE TYPE app.request_status AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'TRIAGE',
  'NEEDS_INFO',
  'IN_PROGRESS',
  'QUOTED',
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED'
);

CREATE TYPE app.finding_severity AS ENUM (
  'PASS',
  'BLOCKER',
  'WARNING',
  'MISSING_INPUT',
  'ASSUMPTION',
  'ENGINEERING_REVIEW_REQUIRED',
  'NOT_EVALUATED'
);

CREATE TYPE app.audit_outcome AS ENUM ('success', 'denied', 'error');

-- --------------------------------------------------------------------------
-- Tenancy root
-- --------------------------------------------------------------------------

-- The tenant root. McMurray Stern is itself an organization with
-- is_internal = true, so staff need no special case in the data model.
CREATE TABLE app.organization (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  is_internal     boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.app_user (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  email           text NOT NULL,
  name            text NOT NULL,
  -- Denormalised so an RLS policy can read it without a join.
  actor_type      app.actor_type NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Composite with organization_id: a global unique index on email would leak
  -- that an address already exists in ANOTHER organization, and our client
  -- list is confidential.
  CONSTRAINT app_user_org_email_key UNIQUE (organization_id, email)
);

CREATE TABLE app.membership (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  user_id         uuid NOT NULL REFERENCES app.app_user(id),
  role            app.member_role NOT NULL,
  granted_by      uuid REFERENCES app.app_user(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  -- One organization per user in MVP-1 (OD-05).
  CONSTRAINT membership_org_user_key UNIQUE (organization_id, user_id)
);

-- The plaintext token is NEVER stored: a database dump then yields no working
-- invitations. Email, organization and role live in this row rather than in
-- the token or the URL, because accepting them from the client is textbook
-- mass assignment.
CREATE TABLE app.invitation (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  token_hash      text NOT NULL,
  invited_email   text NOT NULL,
  role            app.member_role NOT NULL,
  invited_by      uuid NOT NULL REFERENCES app.app_user(id),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitation_org_token_key UNIQUE (organization_id, token_hash)
);

-- --------------------------------------------------------------------------
-- Projects and revisions — the spine
-- --------------------------------------------------------------------------

CREATE TABLE app.project (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  number          text NOT NULL,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_org_number_key UNIQUE (organization_id, number)
);

-- A catalog release is not tenant-scoped: it is our reference data, visible to
-- staff only. It has no organization_id, and its policy demands staff.
CREATE TABLE app.catalog_release (
  id               uuid PRIMARY KEY,
  manufacturer     text NOT NULL,
  rev              text NOT NULL,
  status           app.release_status NOT NULL DEFAULT 'DRAFT',
  effective_from   date,
  source_document  text NOT NULL,
  page_ref         text,
  digitised_by     text NOT NULL,
  digitised_at     timestamptz NOT NULL,
  approved_by      text,
  approved_at      timestamptz,
  -- The verification act, recorded as data. A name with no verification path
  -- behind it is ceremony: the 72% overstatement in the reference project was
  -- caught by reconciliation, not by a signature.
  verification_path text,
  content_sha256   text NOT NULL,
  CONSTRAINT catalog_release_mfr_rev_key UNIQUE (manufacturer, rev),
  -- An APPROVED release must name an approver who is not the digitiser AND
  -- carry a recorded verification path. Enforced here so no application code
  -- path can approve without one.
  CONSTRAINT catalog_release_approval_gate CHECK (
    status <> 'APPROVED'
    OR (approved_by IS NOT NULL
        AND approved_by <> digitised_by
        AND verification_path IS NOT NULL)
  )
);

CREATE TABLE app.rule_pack_release (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  rev              text NOT NULL,
  status           app.release_status NOT NULL DEFAULT 'DRAFT',
  approved_by      text,
  approved_at      timestamptz,
  content_sha256   text NOT NULL,
  CONSTRAINT rule_pack_release_name_rev_key UNIQUE (name, rev)
);

CREATE TABLE app.revision (
  id                       uuid PRIMARY KEY,
  organization_id          uuid NOT NULL REFERENCES app.organization(id),
  project_id               uuid NOT NULL REFERENCES app.project(id),
  revision_code            text NOT NULL,
  iteration                integer NOT NULL DEFAULT 1,
  lifecycle_state          app.lifecycle_state NOT NULL DEFAULT 'DRAFT',
  -- audience = 'internal' revisions are ABSENT from client responses, never
  -- "visible but locked".
  audience                 app.audience NOT NULL DEFAULT 'client',
  parent_revision_id       uuid REFERENCES app.revision(id),
  derived_from_revision_id uuid REFERENCES app.revision(id),
  -- The pins sit inside the hashed content, so a catalog change cannot alter
  -- a submitted revision.
  catalog_release_id       uuid NOT NULL REFERENCES app.catalog_release(id),
  rule_pack_release_id     uuid NOT NULL REFERENCES app.rule_pack_release(id),
  content                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash             text,
  created_by               uuid NOT NULL REFERENCES app.app_user(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  frozen_at                timestamptz,
  CONSTRAINT revision_org_project_code_iter_key
    UNIQUE (organization_id, project_id, revision_code, iteration),
  -- A frozen revision must carry its hash. There is no third state.
  CONSTRAINT revision_frozen_has_hash CHECK (
    lifecycle_state = 'DRAFT'
    OR (content_hash IS NOT NULL AND frozen_at IS NOT NULL)
  )
);

CREATE INDEX revision_org_project_idx ON app.revision (organization_id, project_id);
CREATE INDEX revision_audience_idx ON app.revision (organization_id, audience);

-- --------------------------------------------------------------------------
-- Client-safe derived content
-- --------------------------------------------------------------------------

CREATE TABLE app.finding (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  revision_id     uuid NOT NULL REFERENCES app.revision(id) ON DELETE CASCADE,
  code            text NOT NULL,
  severity        app.finding_severity NOT NULL,
  subject_object_ids text[] NOT NULL DEFAULT '{}',
  -- Mandatory: every finding must be able to say what would resolve it. A
  -- finding with no path to resolution is a support call.
  closed_by       text NOT NULL,
  revision_hash   text NOT NULL,
  engine_version  text NOT NULL
);

CREATE INDEX finding_org_revision_idx ON app.finding (organization_id, revision_id);

-- Internal detail for a finding: the citation, the standard, the tier. A
-- SEPARATE TABLE, not columns on app.finding, so a client-facing query cannot
-- reach it even if someone writes SELECT *.
CREATE TABLE app.finding_internal_detail (
  finding_id           uuid PRIMARY KEY REFERENCES app.finding(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL REFERENCES app.organization(id),
  rule_id              text NOT NULL,
  rule_pack_release_id uuid NOT NULL REFERENCES app.rule_pack_release(id),
  citation             text,
  verification_tier    text NOT NULL,
  waived_by            uuid REFERENCES app.app_user(id),
  waived_at            timestamptz,
  waiver_reason        text
);

CREATE TABLE app.assumption (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  revision_id     uuid NOT NULL REFERENCES app.revision(id) ON DELETE CASCADE,
  key             text NOT NULL,
  assumed_value_um bigint,
  assumed_unit    text NOT NULL,
  why             text NOT NULL,
  acknowledged_by uuid REFERENCES app.app_user(id),
  acknowledged_at timestamptz
);

CREATE INDEX assumption_org_revision_idx ON app.assumption (organization_id, revision_id);

-- Material with no published capacity. Note what is ABSENT: there is no
-- capacity column at all, so no future code path can populate one under
-- deadline pressure. Absent by schema, not blank by convention.
CREATE TABLE app.uncatalogued_part (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  revision_id     uuid NOT NULL REFERENCES app.revision(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  measured_geometry jsonb NOT NULL,
  gauge           text,
  condition_note  text,
  source          text NOT NULL CHECK (source IN ('CLIENT_EXISTING', 'USED_STOCK'))
);

-- --------------------------------------------------------------------------
-- Internal-only: the BOM
-- --------------------------------------------------------------------------

-- Physically separate, with a policy requiring actor_type = 'staff'. A client
-- principal cannot reach this table even with a malformed query.
CREATE TABLE app.bom_line (
  id                   uuid PRIMARY KEY,
  organization_id      uuid NOT NULL REFERENCES app.organization(id),
  revision_id          uuid NOT NULL REFERENCES app.revision(id) ON DELETE CASCADE,
  category             text NOT NULL,
  -- A part reference is a REVISION, never a part id. And exactly one of the
  -- two references is non-null: half of all jobs contain material with no
  -- published capacity, so a schema where every line must resolve to a catalog
  -- part cannot represent half the work.
  part_revision_id     uuid,
  uncatalogued_part_id uuid REFERENCES app.uncatalogued_part(id),
  qty                  integer,
  uom                  text NOT NULL,
  rule_text            text NOT NULL,
  rule_id              text,
  confirmed            boolean NOT NULL,
  item_snapshot        jsonb,
  source_object_ids    text[] NOT NULL DEFAULT '{}',
  unresolved_reason    text,
  revision_hash        text NOT NULL,
  engine_version       text NOT NULL,
  CONSTRAINT bom_line_part_ref_xor CHECK (
    (part_revision_id IS NOT NULL) <> (uncatalogued_part_id IS NOT NULL)
  ),
  -- A line is either a quantity, or an unresolved line with a reason. There is
  -- no third state, and a plausible number is never emitted in place of one.
  CONSTRAINT bom_line_qty_xor_reason CHECK (
    (qty IS NOT NULL AND unresolved_reason IS NULL)
    OR (qty IS NULL AND unresolved_reason IS NOT NULL)
  )
);

CREATE INDEX bom_line_org_revision_idx ON app.bom_line (organization_id, revision_id);

CREATE TABLE app.internal_note (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  revision_id     uuid NOT NULL REFERENCES app.revision(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES app.app_user(id),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Submission — the commercial record
-- --------------------------------------------------------------------------

CREATE TABLE app.submission (
  id                     uuid PRIMARY KEY,
  organization_id        uuid NOT NULL REFERENCES app.organization(id),
  revision_id            uuid NOT NULL REFERENCES app.revision(id),
  request_status         app.request_status NOT NULL DEFAULT 'SUBMITTED',
  manifest_hash          text NOT NULL,
  manifest_uri           text,
  prev_hash              text,
  this_hash              text NOT NULL,
  supersedes_submission_id uuid REFERENCES app.submission(id),
  decline_reason         text,
  submitted_by           uuid NOT NULL REFERENCES app.app_user(id),
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  acknowledged_at        timestamptz,
  quoted_at              timestamptz,
  CONSTRAINT submission_org_revision_key UNIQUE (organization_id, revision_id),
  -- A structured decline reason is mandatory on decline. Free text alongside,
  -- never instead: this enum is the only route to answering "what are clients
  -- trying to configure that we cannot serve?"
  CONSTRAINT submission_decline_has_reason CHECK (
    request_status <> 'DECLINED' OR decline_reason IS NOT NULL
  )
);

CREATE INDEX submission_status_idx ON app.submission (request_status, submitted_at);

-- --------------------------------------------------------------------------
-- Audit — append only, hash chained
-- --------------------------------------------------------------------------

-- Not tenant-scoped by organization_id alone: an event has an ACTOR
-- organization and a SUBJECT organization, and staff act across tenants.
CREATE TABLE app.audit_event (
  event_id                uuid PRIMARY KEY,
  -- The ordering authority is this sequence, NOT the timestamp. Clocks move.
  sequence                bigserial NOT NULL,
  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  actor_user_id           uuid REFERENCES app.app_user(id),
  actor_type              app.actor_type NOT NULL,
  actor_organization_id   uuid REFERENCES app.organization(id),
  impersonated_by         uuid REFERENCES app.app_user(id),
  subject_organization_id uuid REFERENCES app.organization(id),
  action                  text NOT NULL,
  resource_type           text NOT NULL,
  resource_id             text,
  before                  jsonb,
  after                   jsonb,
  outcome                 app.audit_outcome NOT NULL,
  -- Every reason, not the first. A refusal that lists one of three blockers
  -- makes a client fix them one at a time.
  reasons                 text[] NOT NULL DEFAULT '{}',
  request_id              text,
  session_id_hash         text,
  source_ip               inet,
  user_agent              text,
  prev_hash               text,
  hash                    text NOT NULL
);

CREATE INDEX audit_event_sequence_idx ON app.audit_event (sequence);
CREATE INDEX audit_event_subject_org_idx ON app.audit_event (subject_organization_id, sequence);

-- Append-only, enforced by a trigger as well as by revoked privileges. The
-- trigger is what survives someone connecting as a different role.
CREATE OR REPLACE FUNCTION app.refuse_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'app.audit_event is append-only: % is refused. An audit record that can be '
    'changed is not evidence.', TG_OP;
END;
$$;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.refuse_audit_mutation();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.refuse_audit_mutation();

-- --------------------------------------------------------------------------
-- Immutability of a frozen revision, enforced at the database layer
-- --------------------------------------------------------------------------

-- The layer that matters most in practice, because it is the only one that
-- survives a developer under deadline pressure writing a "quick fix" script.
CREATE OR REPLACE FUNCTION app.refuse_frozen_revision_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Revision % is % and cannot be deleted. Submitted revisions are immutable '
      'for everyone, including us.', OLD.id, OLD.lifecycle_state;
  END IF;

  -- The only permitted change to a frozen revision is its lifecycle state,
  -- moving to SUPERSEDED or WITHDRAWN. Content never changes.
  IF OLD.lifecycle_state <> 'DRAFT' THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.catalog_release_id IS DISTINCT FROM OLD.catalog_release_id
       OR NEW.rule_pack_release_id IS DISTINCT FROM OLD.rule_pack_release_id
       OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
       OR NEW.audience IS DISTINCT FROM OLD.audience
       OR NEW.revision_code IS DISTINCT FROM OLD.revision_code
       OR NEW.iteration IS DISTINCT FROM OLD.iteration THEN
      RAISE EXCEPTION
        'Revision % is % and its content is immutable. Only lifecycle_state may '
        'change, and only to SUPERSEDED or WITHDRAWN. Clone it to a new draft '
        'instead.', OLD.id, OLD.lifecycle_state;
    END IF;

    IF NEW.lifecycle_state NOT IN ('SUPERSEDED', 'WITHDRAWN')
       AND NEW.lifecycle_state <> OLD.lifecycle_state THEN
      RAISE EXCEPTION
        'Revision % cannot move from % to %.',
        OLD.id, OLD.lifecycle_state, NEW.lifecycle_state;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER revision_immutable_when_frozen
  BEFORE UPDATE OR DELETE ON app.revision
  FOR EACH ROW EXECUTE FUNCTION app.refuse_frozen_revision_change();

-- A frozen revision's derived rows are frozen with it.
CREATE OR REPLACE FUNCTION app.refuse_derived_change_when_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_revision uuid;
  state app.lifecycle_state;
BEGIN
  target_revision := COALESCE(NEW.revision_id, OLD.revision_id);
  SELECT lifecycle_state INTO state FROM app.revision WHERE id = target_revision;

  IF state IS NOT NULL AND state <> 'DRAFT' THEN
    RAISE EXCEPTION
      'Revision % is %; its derived % rows cannot be changed. Re-derive into a '
      'new revision instead.', target_revision, state, TG_TABLE_NAME;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER bom_line_frozen_guard
  BEFORE UPDATE OR DELETE ON app.bom_line
  FOR EACH ROW EXECUTE FUNCTION app.refuse_derived_change_when_frozen();

CREATE TRIGGER finding_frozen_guard
  BEFORE UPDATE OR DELETE ON app.finding
  FOR EACH ROW EXECUTE FUNCTION app.refuse_derived_change_when_frozen();
