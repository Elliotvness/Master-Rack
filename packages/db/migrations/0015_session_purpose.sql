-- What a session is FOR, and the fifteen minutes the database enforces.
--
-- THE PROBLEM THE §8.2 AMENDMENT CREATED. §14.3 has two rows that reconcile
-- exactly one way. *Transport*: "Land on the acceptance page, immediately POST
-- the token, exchange it for a SHORT-LIVED SERVER-SIDE SESSION, and 303 to a
-- clean URL." *No auto-login*: "Require an explicit first sign-in with the new
-- credential." Both are true, so acceptance opens a session that is not a
-- login: the invited person needs a principal to enroll a second factor under
-- (§15.2 step 2, "enrolls a second factor, AND SIGNS IN" — in that order), and
-- then signs in properly.
--
-- That session is a client principal. As the gate stood when the amendment
-- landed, it could reach EVERY CLIENT ROUTE — projects, revisions, previews,
-- submit — on the strength of having clicked an email link. Nobody had decided
-- otherwise, because until §8.2 carried a sign-in route there was no acceptance
-- session to decide about.
--
-- WHY THE COLUMN AND NOT AN APPLICATION FLAG. AD-3's precedent: the guarantee
-- is decided by the schema, not by code that has to remember. A session's
-- authority is the single most consequential thing about it, and a purpose held
-- only in application memory is one refactor from being defaulted.
--
--   NOT NULL, NO DEFAULT     Every INSERT must SAY what the session is for. A
--                            default would make "forgot to decide" mean "full
--                            authority", which is the wrong direction to fail.
--   an ENUM, not text        Same reason as every other closed set in 0001: an
--                            invalid value is a database error, not a string
--                            nobody validated.
--   IMMUTABLE                a session cannot change what it is FOR. See the
--                            trigger below, and the blocker that produced it.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, after adversarial review
-- refused its first version.
--
-- The first draft carried a CHECK that an `acceptance` session could not
-- outlive fifteen minutes, on the strength of §14.3's "15 minutes for anything
-- that acts as a login". Review refused it on two grounds and both are right.
--
--   1. IT ARGUED BOTH WAYS AT ONCE. The whole reason the gate bounds what an
--      acceptance session may reach is that it is NOT a login (§14.3's
--      *No auto-login* row). Using "acts as a login" to justify the cap and
--      "is not a login" to justify the allowlist cannot both be the reading,
--      and §14.3 states no acceptance-session lifetime at all. The number was
--      invented here, and a number invented in a migration is not a blueprint
--      decision.
--   2. IT STRANDED PEOPLE, IRREVERSIBLY. The acceptance POST spends the
--      single-use token (`accepted_at`), and both revoke and §14.3's
--      self-service resend require `accepted_at IS NULL`. So after the POST
--      there is exactly one way in, and a CHECK constraint is a cliff no
--      operator can extend and no application change can soften: a person who
--      takes sixteen minutes to find their authenticator app has a spent
--      invitation, possibly no credential, and no route back.
--
-- The lifetime now lives only in `ACCEPTANCE_SESSION_TTL_MS`, which says in
-- its own docstring that the number is PROVISIONAL and EL's to set — and the
-- recovery gap is recorded as a finding rather than papered over, because it
-- exists whatever the number is.

CREATE TYPE app.session_purpose AS ENUM ('acceptance', 'full');

-- DEFAULT 'full' for the length of this statement only. Existing rows are
-- test fixtures created before the column existed, and every one of them was
-- full-authority by construction because no other kind could be made. The
-- default is then DROPPED, so from here on a session with no stated purpose is
-- a failed INSERT rather than a full-authority session.
ALTER TABLE app.session ADD COLUMN purpose app.session_purpose NOT NULL DEFAULT 'full';
ALTER TABLE app.session ALTER COLUMN purpose DROP DEFAULT;

-- A SESSION CANNOT CHANGE WHAT IT IS FOR.
--
-- This is the guarantee the column is actually worth, and the first draft did
-- not have it. `purpose` was a plain mutable column, so review turned an
-- acceptance session into a 24-hour full login in ONE statement — and
-- `session_tenant_update` lets `app_user` update its own organization's session
-- rows, so that statement is reachable from application code. The header
-- claimed "the guarantee is decided by the schema, not by code that has to
-- remember"; it was not, and a purpose held in a mutable column is one UPDATE
-- from being escalated.
--
-- §14.3 already prescribes the alternative: "Session identifier regenerated on
-- authentication and on any privilege change." Signing in therefore CREATES a
-- session and revokes the acceptance one. It does not promote a row, and after
-- this trigger it cannot.
CREATE FUNCTION app.refuse_session_purpose_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION
      'app.session.purpose is immutable (was %, tried %). A session cannot change what it is '
      'for: signing in CREATES a session and revokes the acceptance one, per §14.3''s '
      '"identifier regenerated on authentication". Promoting a row in place is the escalation '
      'this refuses.', OLD.purpose, NEW.purpose;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER session_purpose_is_immutable
  BEFORE UPDATE ON app.session
  FOR EACH ROW EXECUTE FUNCTION app.refuse_session_purpose_change();

COMMENT ON COLUMN app.session.purpose IS
  'acceptance = the short-lived session §14.3''s Transport row opens, which may reach only the '
  'routes ACCEPTANCE_REACHABLE names. full = a session established by an explicit sign-in. '
  'NOT NULL with no default, so a session that does not say what it is for cannot be created; '
  'and immutable, so one cannot become the other.';
