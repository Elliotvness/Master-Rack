-- The invitation tenant resolver (F-47), and the one SECURITY DEFINER function
-- in this schema.
--
-- WHY IT HAS TO EXIST, stated before what it does.
--
-- `withTenant` is the way to the database and it REQUIRES an organization and
-- an actor type before any statement runs. Every table an anonymous request
-- must touch -- `app.invitation` above all -- is governed by
-- `organization_id = app.current_org() OR app.is_staff()`. So a row cannot be
-- read until its organization is already known.
--
-- An invited person arrives cold from an email link and the organization
-- cannot come from them: §14.3 is explicit -- "Email, organization and role
-- live in the invitation row, NEVER in the token or the URL" -- and §8.3 makes
-- `organization_id` structurally unreachable from a request body, which
-- `clientRequestBody` enforces rather than asks for.
--
-- That is a genuine circle, and `POST /api/auth/invite/accept` -- the one route
-- an unauthenticated caller can reach -- sits inside it. This function is the
-- smallest thing that breaks it.
--
-- WHAT IT IS ALLOWED TO DO, and what it deliberately cannot.
--
-- It takes a token HASH and returns ONE uuid: the organization that owns the
-- invitation. It is a tenant RESOLVER, not a reader. Nothing else about the
-- invitation crosses this boundary -- not the email, not the role, not the
-- expiry, not whether it has been used. The caller takes the uuid, opens
-- `withTenant` on it, and reads and claims the row under RLS like any other
-- code in this repository. The privileged step is one column of one row, and
-- everything that decides anything still happens under the tenant.
--
-- IT DOES NOT FILTER ON expires_at, accepted_at OR revoked_at, and that is
-- deliberate. Filtering here would return NULL for a used or expired token, the
-- caller would never enter the tenant, `redeemInvitation` would never run, and
-- the DISTINCT audit reason it produces -- invalid / expired / used / revoked
-- -- would be lost. AC-01's requirement is that the CLIENT cannot tell them
-- apart; the audit log must. So the resolver resolves, and the refusal stays
-- where the reason can be recorded.
--
-- THE HARDENING, each line load-bearing:
--
--   SET search_path = ''    Not `= app, pg_catalog`. Empty, with every
--                           identifier in the body schema-qualified. A definer
--                           function that resolves names against the CALLER's
--                           path lets a caller who can create objects shadow
--                           what it names and run their code as its owner --
--                           the standard escalation. An empty path cannot be
--                           shadowed at all.
--   STABLE                  It reads. It must never be the thing that writes.
--   REVOKE FROM PUBLIC      A definer function is EXECUTE-to-PUBLIC by default,
--                           which would hand it to every role in the cluster.
--   GRANT TO app_user       Exactly one caller.
--
-- THE DEVIATION THAT MAKES THIS SHARPER THAN IT SHOULD BE, recorded rather
-- than buried: §14.2 item 3 says "Migrations run as a separate migrator role",
-- and today they run as `postgres`, a SUPERUSER. A SECURITY DEFINER function
-- runs as its owner, so this function currently runs as a superuser rather
-- than as a role whose only privilege is owning these tables. The body is one
-- fully-qualified SELECT of one column and cannot be extended without another
-- migration -- which `check-rls` now audits -- so the exposure is bounded by
-- the body rather than by the owner. It is still the wrong owner, and the fix
-- is item 3's separate migrator role, not a change here.
--
-- A definer function owned by a NON-owner role would not work and the reason
-- is worth writing down so nobody re-proposes it: RLS applies to every role
-- except the table owner and BYPASSRLS holders, so a modest little
-- `rms_resolver` role would run this function, hit `invitation_tenant_select`
-- with no tenant context, and read nothing at all. The alternatives are a
-- `USING (true)` policy scoped to that role -- this schema's first permissive
-- read policy, permanent, and a shape every future reviewer must re-reason
-- about -- or BYPASSRLS, which is strictly worse than what is written here.

-- The lookup index. `invitation_org_token_key` is composite and leads on
-- organization_id, so a predicate on token_hash alone cannot use it and the one
-- route an anonymous caller can hit at will would full-scan an index that grows
-- with every tenant's invitations. NOT a unique index, and that is §14.2 item 5
-- being obeyed rather than overlooked: "every uniqueness constraint is composite
-- with organization_id … a global unique index leaks another tenant's row
-- existence through a constraint-violation error message." The ambiguity a
-- global unique index would have prevented is closed in the function instead,
-- below, where it costs nothing and leaks nothing.
CREATE INDEX invitation_token_hash_idx ON app.invitation (token_hash);

-- IT FAILS CLOSED ON AN AMBIGUOUS HASH, and the reason is worth the two extra
-- lines. `token_hash` is unique only PER ORGANIZATION, so two tenants holding
-- the same hash is a shape the schema accepts. A bare `SELECT … WHERE
-- token_hash = $1` returning a scalar would then hand back whichever row came
-- first — silently, with no error — and the acceptance path would open a
-- STRANGER'S tenant and run the redemption there. Review demonstrated exactly
-- that against this function's first draft.
--
-- A 256-bit token makes the collision infeasible rather than impossible, and
-- "infeasible" is not a thing a tenant-selection authority on an unauthenticated
-- route should rest on when the alternative is one CASE. Two matches resolve to
-- NULL, which the caller reports as the same generic refusal as an unknown
-- token: nobody is misdirected, and the outcome is a refusal rather than a
-- wrong tenant.
CREATE FUNCTION app.resolve_invitation_tenant(p_token_hash text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(i.organization_id))[1] ELSE NULL END
    FROM app.invitation AS i
   WHERE i.token_hash = p_token_hash
$$;

COMMENT ON FUNCTION app.resolve_invitation_tenant(text) IS
  'F-47. Resolves an invitation token hash to the organization that owns it, and '
  'nothing else, so an anonymous acceptance request can open a tenant context. '
  'SECURITY DEFINER: the one in this schema, audited by tools/check-rls.mjs.';

-- Default is EXECUTE to PUBLIC. That would be the whole point undone.
REVOKE EXECUTE ON FUNCTION app.resolve_invitation_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_invitation_tenant(text) TO app_user;
