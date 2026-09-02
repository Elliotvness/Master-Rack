-- 0010 — `part` and `part_revision`: give `bom_line.part_revision_id` something
-- to reference.
--
-- Audit D-10, task T-09. §19.2 names "BOM lines reference a part revision, never
-- a part" as one of only two decisions that cannot be retrofitted. The TYPE has
-- honoured it since 0001; the SCHEMA has not. `bom_line.part_revision_id` is a
-- bare `uuid` with no REFERENCES, while its `uncatalogued_part_id` sibling IS
-- constrained — so half of the XOR was enforced and half was a convention.
--
-- Catalog-as-pinned-file is NOT overturned here. The JSON files under
-- data/catalog/ remain the source of truth and the thing the content hash is
-- taken over; these tables are a QUERYABLE PROJECTION of them, populated at
-- load. That is what makes FR-BM-05 (where-used) and FR-CT-06 (supersede
-- impact) answerable instead of unanswerable.
--
-- WHAT THE IDENTITY IS, and why it is not the part number.
--
-- Measured against the approved release rather than assumed: `part_number` is
-- NOT unique. In interlake-2026-09, UM005516 appears on two rows (54" @ 24,940
-- lbs and 60" @ 22,540 lbs) and UM005517 on two more (66" and 72"). The same
-- duplication is in interlake-2026-08, so it is carried forward rather than
-- introduced by the 2026-09 corrections. `code_18` IS unique — 336 distinct
-- codes across 336 rows in both releases.
--
-- So `part` is keyed on (manufacturer, code_18) and `part_number` is carried as
-- an ATTRIBUTE of the revision, not as identity. A schema keyed on part_number
-- would have refused to load the approved catalog on its first run. Filed as
-- F-30: whether those four rows are a source fact or an extract defect is the
-- approver's call, not this migration's, and nothing here alters the release.
--
-- WHY TWO TABLES, evidenced rather than asserted. All 336 codes in 2026-09 also
-- exist in 2026-08 (42 phantom rows removed, none added) — and 288 of those 336
-- carry a DIFFERENT published row between the two releases, from the capacity
-- and face-height corrections. One `part`, two `part_revision` rows, different
-- values. That is precisely why a BOM line must reference the revision: a line
-- pinned to the 2026-08 revision still renders its own capacity after 2026-09
-- lands, which is §10.2's requirement and the reason for this task.
--
-- FRAMES ARE NOT IN THIS PROJECTION, and the omission is deliberate rather than
-- forgotten: frames.json contains zero part numbers and zero codes. It holds
-- capacity TABLES indexed by independent variables, not orderable parts. A
-- frame row has no part identity to project, and inventing one would be a
-- fabricated key in a table whose whole purpose is resolvable references.

BEGIN;

-- The part identity, stable across releases.
CREATE TABLE app.part (
  id            uuid PRIMARY KEY,
  manufacturer  text NOT NULL,
  -- The 18-character published product code. Unique within a manufacturer, and
  -- the reason this and not `part_number` is the key — see the header.
  code_18       text NOT NULL,
  CONSTRAINT part_manufacturer_code_key UNIQUE (manufacturer, code_18),
  CONSTRAINT part_manufacturer_not_blank CHECK (btrim(manufacturer) <> ''),
  CONSTRAINT part_code_18_not_blank CHECK (btrim(code_18) <> '')
);

-- The part AS PUBLISHED IN ONE RELEASE. This is what a BOM line references.
CREATE TABLE app.part_revision (
  id                  uuid PRIMARY KEY,
  part_id             uuid NOT NULL REFERENCES app.part(id),
  -- Carrying the release is what keeps a discontinued part resolvable and a
  -- historical revision renderable (§10.2). A part dropped by a later release
  -- keeps its earlier revision row; nothing here deletes on supersede.
  catalog_release_id  uuid NOT NULL REFERENCES app.catalog_release(id),
  -- An attribute, not identity: see the header on UM005516 / UM005517.
  part_number         text NOT NULL,
  -- The published row verbatim. The files stay the source of truth, so this is
  -- a faithful copy rather than a re-modelling of it: beams and frames do not
  -- share a shape, and flattening one into columns invented for the other is
  -- how a projection stops matching what it projects.
  published_row       jsonb NOT NULL,
  CONSTRAINT part_revision_part_release_key UNIQUE (part_id, catalog_release_id),
  CONSTRAINT part_revision_part_number_not_blank CHECK (btrim(part_number) <> '')
);

CREATE INDEX part_revision_release_idx ON app.part_revision (catalog_release_id);

-- The half of the XOR that was a convention becomes a constraint.
--
-- If this statement fails because `bom_line` already holds a part_revision_id
-- matching no row, that is the CORRECT outcome and not something to work around
-- with NOT VALID: the column has never had a referent, so any value in it is
-- unverified by construction. The rows need resolving, not the constraint
-- relaxing.
ALTER TABLE app.bom_line
  ADD CONSTRAINT bom_line_part_revision_fk
  FOREIGN KEY (part_revision_id) REFERENCES app.part_revision(id);

-- --------------------------------------------------------------------------
-- RLS — staff-only, matching app.catalog_release and app.rule_pack_release.
--
-- Not tenant-scoped, because it is our data rather than a client's, and never
-- client-readable: the catalog IS the commercial position this product exists
-- to protect. ENABLE *and* FORCE, and a policy for every operation, because an
-- absent policy under RLS means denied and a forgotten ALTER means wide open.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  registry_tables text[] := ARRAY['part', 'part_revision'];
BEGIN
  FOREACH t IN ARRAY registry_tables LOOP
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

-- GRANTs, which RLS does not imply and `check-rls` does not check.
--
-- 0002 ran `GRANT ... ON ALL TABLES IN SCHEMA app`, and 0003 already records why
-- that is not enough: ON ALL TABLES affects only the tables that existed when it
-- ran. A table added later with RLS and no GRANT is invisible to `app_user` with
-- a `permission denied`, and `check-rls` reports PASS over it because RLS really
-- is enabled, forced and policied — the privilege is simply absent. This was
-- caught by the T-09 tests failing, not by a gate. Filed as F-31.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.part, app.part_revision TO app_user;

COMMIT;
