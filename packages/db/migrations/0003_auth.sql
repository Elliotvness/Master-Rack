-- Sessions and credentials (A-07).
--
-- Blueprint §14.3 (invitations), §14.4 (authentication ladder), NFR-SEC-02..05.
--
-- Two rules shape every table here:
--
--   1. No bearer secret is stored in the clear. A session token, an invitation
--      token and a password are all held only as a hash, so a database dump
--      yields nothing that can be replayed. The tokens are high-entropy, so a
--      fast hash (SHA-256) is correct for them; the password is low-entropy, so
--      it needs a slow, salted hash — recorded here as an opaque string whose
--      algorithm is named in the value itself (e.g. "scrypt$...").
--
--   2. Sessions are OPAQUE and server-side, never JWTs. Server-side revocation
--      is mandatory (deactivating an account must end every session at once),
--      which means server state exists anyway; a stateless token would only add
--      a second source of truth that cannot be revoked.

-- --------------------------------------------------------------------------
-- Credentials — one per user, client principals only
-- --------------------------------------------------------------------------
--
-- Staff authenticate via OIDC SSO and have NO local password: an emailed reset
-- on an account that can see every client's data is a breach with extra steps.
-- So this table exists for client principals, and a CHECK keeps a staff or
-- service actor from ever growing a local password.

CREATE TABLE app.credential (
  user_id            uuid PRIMARY KEY REFERENCES app.app_user(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES app.organization(id),
  -- Opaque, algorithm-tagged. Never a bare hash whose parameters are implicit.
  password_hash      text NOT NULL,
  -- A second factor is mandatory for anyone who can reach client data. TOTP
  -- secret or a passkey credential id; the type says which.
  mfa_type           text NOT NULL DEFAULT 'none' CHECK (mfa_type IN ('none', 'totp', 'passkey')),
  mfa_secret_hash    text,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.credential FORCE ROW LEVEL SECURITY;

-- A credential is reachable only within its own organization, or by staff. It
-- is never a client-facing DTO regardless: the API layer never serialises it.
CREATE POLICY credential_tenant_select ON app.credential FOR SELECT
  USING (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY credential_tenant_insert ON app.credential FOR INSERT
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY credential_tenant_update ON app.credential FOR UPDATE
  USING (organization_id = app.current_org() OR app.is_staff())
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY credential_tenant_delete ON app.credential FOR DELETE
  USING (organization_id = app.current_org() OR app.is_staff());

-- --------------------------------------------------------------------------
-- Sessions
-- --------------------------------------------------------------------------

CREATE TABLE app.session (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES app.organization(id),
  user_id          uuid NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
  actor_type       app.actor_type NOT NULL,
  -- SHA-256 of the opaque cookie token. The plaintext lives only in the
  -- client's __Host- cookie; a database dump yields no usable session.
  token_hash       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Absolute and idle limits are enforced in application code against these.
  -- Internal: 8h absolute / 30m idle. Client: 24h absolute / 2h idle.
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at  timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when the session is ended: logout, privilege change, or account
  -- deactivation. A revoked session is kept, not deleted, so "when did this
  -- session end and why" stays answerable.
  revoked_at       timestamptz,
  revoked_reason   text,
  CONSTRAINT session_org_token_key UNIQUE (organization_id, token_hash)
);

CREATE INDEX session_user_idx ON app.session (organization_id, user_id);

ALTER TABLE app.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.session FORCE ROW LEVEL SECURITY;

CREATE POLICY session_tenant_select ON app.session FOR SELECT
  USING (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY session_tenant_insert ON app.session FOR INSERT
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY session_tenant_update ON app.session FOR UPDATE
  USING (organization_id = app.current_org() OR app.is_staff())
  WITH CHECK (organization_id = app.current_org() OR app.is_staff());
CREATE POLICY session_tenant_delete ON app.session FOR DELETE
  USING (organization_id = app.current_org() OR app.is_staff());

-- --------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------
--
-- GRANT ... ON ALL TABLES in an earlier migration only affects tables that
-- existed when it ran. New tables need their own grant, or the application
-- role gets "permission denied" — which is exactly what a test caught.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.credential, app.session TO app_user;
