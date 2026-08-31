# Security Architecture Brief: Multi-Tenant B2B App with Mixed Internal/External Users

**Research date:** 31 August 2026. All version/status claims below were verified against primary sources on this date.

**The governing threat:** the dominant risk is not an external attacker — it is an *authenticated, legitimate client user* seeing a field or row they shouldn't (cost, margin, MPN, BOM line). This is OWASP A01:2025 Broken Access Control (found in **100% of applications tested** in the 2025 dataset) plus API1/API3:2023 (BOLA + Broken Object Property Level Authorization). Design for "the caller is authenticated and hostile," not "the caller is anonymous."

---

## 0. Standards status check (as of Aug 2026)

| Standard | Current version | Status |
|---|---|---|
| NIST SP 800-63B | **Rev 4 (800-63B-4)**, published **31 July 2025**, final | Supersedes rev 3 (Mar 2020) |
| OWASP Top 10 (web) | **2025** edition | Current; A01 Broken Access Control still #1; A09 renamed to *Security Logging and Alerting Failures*; new: A03 Software Supply Chain Failures, A10 Mishandling of Exceptional Conditions |
| OWASP API Security Top 10 | **2023** | Still current — **no 2026 edition exists**. I checked the OWASP API Security project page; the last stable release is 5 Jun 2023. Third-party blogs titled "API Security Top 10 for 2026" are marketing repackaging of the 2023 list. |
| OWASP ASVS | **5.0.0**, released **30 May 2025** | Current; useful as your actual requirements checklist |
| NIST SP 800-92 | **2006 original still final**; Rev 1 has been at **Initial Public Draft since 11 Oct 2023** (comments closed 29 Nov 2023) | ⚠️ Rev 1 not finalized as of this date — cite the 2006 doc for compliance, read the draft for modern practice |
| AICPA Trust Services Criteria | **2017 TSC with Revised Points of Focus – 2022** | Current basis for SOC 2 |
| OAuth 2.0 Security BCP | **RFC 9700 (BCP 240), Jan 2025** | Current |
| ISO/IEC 27001 | 2022 edition, control **A.8.15 Logging** / A.8.16 Monitoring | ⚠️ Standard text is paywalled; I could not verify exact clause wording from a primary source |

---

## 1. Tenant isolation

### The three patterns

Microsoft's multitenancy guidance is the most balanced primary source and explicitly warns on RLS:

> "Row-level security can provide security isolation... However, this approach can be complex to design, implement, test, and maintain. Many multitenant solutions don't use row-level security because of those complexities."

AWS frames the same space as **silo / pool / bridge**. Silo (DB-per-tenant) buys compliance story, no noisy neighbor, contained blast radius, coarse per-tenant cost attribution — and costs you scaling limits, idle capacity, heavyweight onboarding, and loss of "single pane of glass." Pool (shared DB + RLS) inverts all of that.

| | Shared DB + RLS (pool) | Schema-per-tenant (bridge) | DB-per-tenant (silo) |
|---|---|---|---|
| Isolation strength | Logical, one config error from total exposure | Logical, but `search_path` bugs are the same class of risk | Strong; physical |
| Migrations | One migration | N migrations, drift risk, ORM/pooling pain at ~100+ schemas | N migrations + N connection pools |
| Per-tenant restore | Hard (row surgery) | Medium | Trivial |
| Per-tenant CMEK | No | No | Yes |
| Cost at 50 tenants | Lowest | Low | High |
| Cross-tenant analytics | Trivial | Painful (UNION over N schemas) | Very painful |
| Blast radius of a bug | All tenants | All tenants | One tenant |

### Recommended for this product

**Shared database + `tenant_id` column + Postgres RLS, with the tenant_id predicate ALSO written explicitly in every query.** Reserve DB-per-tenant as an escape hatch for the one enterprise customer whose procurement demands it — and design the tenant-context plumbing now so that escape hatch is a config change, not a rewrite.

Rationale: B2B with internal staff needing cross-tenant views makes silo actively hostile (your own staff tooling becomes N-database fan-out). Schema-per-tenant is the worst of both — it has silo's migration cost and pool's shared-failure-domain.

### The "belt and braces" argument — do both

Yes, do both, and understand *why they're not redundant*:

- **The `WHERE tenant_id = $1` in application code** is the primary control. It is visible in code review, testable in unit tests, and survives someone connecting as the wrong DB role.
- **RLS** is the backstop for the query you forgot, the raw SQL in a report generator, the ORM `find_by_id` someone added at 5pm, and the new join that reaches a table nobody thought about.

The two fail independently. RLS fails silently (`SELECT`/`UPDATE`/`DELETE` return **empty results, not errors** — AWS explicitly calls this out; only `INSERT` raises). App-level predicates fail loudly in tests. Together you get both a loud and a quiet net.

**Cost:** you will chase RLS performance. Index every column an RLS policy filters on — policies evaluate per candidate row. On Supabase specifically, wrap auth helpers as `(select auth.uid())` so Postgres caches per-statement rather than per-row.

### Postgres RLS correctness pitfalls — the actual checklist

Verified against the Postgres docs and AWS's RLS pattern:

1. **`ENABLE ROW LEVEL SECURITY` is default-deny.** Postgres docs: *"If no policy exists for the table, a default-deny policy is used."* Good. But this only bites once RLS is enabled — a table where you forgot the `ALTER TABLE ... ENABLE` is wide open. **Enforce with a CI test that asserts every table in the app schema has `relrowsecurity = true` and at least one policy.** (Supabase ships this as advisor lints `0013 rls_disabled_in_public` and `0007 policy_exists_rls_disabled` — but wire the check into CI, not just the dashboard.)

2. **Three classes bypass RLS: superusers, roles with `BYPASSRLS`, and the table owner.** Your app role must be none of these. Own the tables with a `migrator` role; run the app as a separate `app_user` with no ownership and no `BYPASSRLS`.

3. **`FORCE ROW LEVEL SECURITY`** makes the owner subject to its own policies. Set it on every tenant-scoped table anyway — it protects you on the day someone runs the app as the owner by mistake, and it costs nothing.

4. **Connection pooling + `SET LOCAL` — this is safe, but only in one specific shape.** pgBouncer's own compatibility matrix lists `SET/RESET` as **"Never"** supported in transaction pooling mode. But `SET LOCAL` / `set_config(key, value, true)` **inside an explicit transaction** is safe, because Postgres reverts it at COMMIT or ROLLBACK — the GUC is gone before the pooler can hand the backend to another client. Postgres docs: *"The effects of SET LOCAL last only till the end of the current transaction, whether committed or not."* This is confirmed in a Supabase maintainer discussion and is the same mechanism PostgREST uses for `request.jwt.claims`.

   **The rule: every tenant-scoped request must run inside an explicit transaction that begins with `SELECT set_config('app.tenant_id', $1, true)`.** A bare `SET` (session-scoped) under a transaction pooler is a cross-tenant data leak waiting for a load spike. Make this structurally impossible: a single `withTenant(tenantId, fn)` wrapper that opens the transaction, sets the GUC, and runs the callback; ban raw pool checkout everywhere else via lint rule.

5. **Policy on every operation.** A policy with only `USING` covers read paths; `INSERT` and the post-image of `UPDATE` need `WITH CHECK`. Otherwise a client can *write* a row into another tenant even though it can't read one.

6. **Foreign keys and unique constraints bypass RLS entirely.** Postgres docs: *"Referential integrity checks... always bypass row security."* A cross-tenant unique constraint on, say, `part_number` leaks the existence of another tenant's rows via constraint-violation errors. Make uniqueness composite: `UNIQUE (tenant_id, part_number)`.

7. **`SECURITY DEFINER` functions and views** run as their owner and silently re-open everything. Audit them; Supabase lints for this (`0010 security_definer_view`, `0011 function_search_path_mutable`).

8. **Leakproof-function optimization and race conditions.** The planner may apply leakproof functions *before* the RLS check. And policies with sub-SELECTs against other tables can race under concurrent updates (Postgres docs give a worked example where `SELECT ... FOR UPDATE` sees post-commit content the policy meant to hide). Keep policies to simple column comparisons against a GUC — no sub-selects into a `memberships` table if you can denormalize `tenant_id` onto the row instead.

9. **Backups:** `SET row_security = off` errors rather than silently filtering. Use it in dump/ETL jobs so you never take a silently-truncated backup.

### The internal/external axis is separate from the tenant axis

Don't conflate them. `tenant_id` isolation stops Client A seeing Client B. It does **nothing** to stop Client A seeing *your* margin on Client A's own order — those rows legitimately belong to tenant A.

**Recommendation:** model two orthogonal dimensions — `tenant_id` (row scoping, RLS) and `audience` / `sensitivity` (column and table scoping, application layer). Physically separate the commercial data:

- `order_lines` — quantity, part description, customer price, lead time. Client-visible.
- `order_line_internal` — cost, margin, MPN, supplier, BOM detail. **Separate table, 1:1, with an RLS policy that additionally requires `current_setting('app.actor_type') = 'staff'`.**

This converts "did we remember to strip a field?" (a serialization bug, invisible in review) into "did we join a table we shouldn't have?" (a query bug, visible in review and catchable by a test that greps for the table name). That structural conversion is the single highest-leverage decision in this whole brief.

---

## 2. Invitation-based onboarding (no public self-signup)

**There is no OWASP cheat sheet dedicated to invitation flows.** The applicable primary guidance is the Forgot Password Cheat Sheet (structurally the same problem: an emailed bearer token that grants account access), the Authentication Cheat Sheet (enumeration), and ASVS 5.0 §6.4/§6.5.

### Token design

ASVS 5.0 gives the exact requirements:

- **6.4.1 (L1):** *"system generated initial passwords or activation codes are securely randomly generated, follow the existing password policy, and expire after a short period of time or after they are initially used"*
- **6.5.1 (L2):** lookup secrets and out-of-band codes *"are only successfully usable once"*
- **6.5.2 (L2):** secrets with under 112 bits of entropy **must be hashed** with an approved password hashing algorithm and a 32-bit random salt
- **6.5.4 (L2):** minimum 20 bits entropy for OOB codes; **6.6.3 (L2)** recommends *"a code with at least 64 bits of entropy"*
- **6.5.5 (L2):** *"Out of band requests must have a maximum lifetime of 10 minutes"*

**Concrete recommendation:**

```
token   = base64url(CSPRNG(32 bytes))        # 256 bits — well above the 112-bit
                                              # threshold, so a plain SHA-256 at
                                              # rest is sufficient (no Argon2 needed)
store   = sha256(token)                       # never the plaintext
row     = { token_hash, tenant_id, role, invited_email_lower,
            invited_by_user_id, expires_at, accepted_at, revoked_at,
            created_ip, created_at }
```

- **Entropy:** 256 bits from a CSPRNG (`crypto.randomBytes` / Python `secrets`). Do not use UUIDv4 (122 bits, and many libraries use non-crypto RNG).
- **Hash at rest:** store only `sha256(token)`. A DB dump then does not yield working invitations. Because the token is high-entropy, a fast hash is correct here — Argon2 is for low-entropy secrets. (ASVS 6.5.2's Argon2 requirement applies below 112 bits.)
- **Expiry:** ASVS's 10-minute rule is written for OOB *authentication* codes, not invitations, and 10 minutes is unusable for a B2B invite that sits in an inbox overnight. **Use 72 hours for invitations**, with a self-service "resend" that revokes the prior token. Note this as a deliberate, documented deviation with a compensating control (the token is 256-bit and single-use). Use **15 minutes** for anything that acts as a login (magic links, step-up codes).
- **Single-use:** accept only if `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, and set `accepted_at` in the **same transaction** as account creation, using `UPDATE ... WHERE accepted_at IS NULL` and checking the affected-row count. Do not read-then-write; two concurrent redemptions will both succeed.
- **Bind everything server-side:** email, tenant_id, and role live in the invitation row, never in the token or the URL. The acceptance form must not accept a role, tenant, or email parameter from the client — that's textbook mass assignment (API3:2023).
- **Email binding:** the invitation is valid only for the exact address it was sent to (normalized lowercase). If the recipient forwards it, the new person can still redeem it — that is inherent to emailed bearer tokens. Mitigate by requiring the accepter to prove control of the invited address (they already did, by receiving it) and by **never letting the accepter change the email during acceptance**.
- **Revocation:** admins must be able to revoke a pending invite, and revoking a user must revoke their pending invites.
- **Rate limit** both invitation creation (per inviter, per tenant — stops an invite-spam vector using your domain's reputation) and redemption attempts (per token, per IP).
- **Transport:** token in the URL path/query is standard and acceptable, but the acceptance page must set `Referrer-Policy: no-referrer` so the token doesn't leak to third-party assets, and must not load third-party scripts. Better: land on `/invite/accept`, immediately POST the token to the server, exchange it for a short-lived server-side session, and `303` redirect to a clean URL — this keeps the token out of browser history, server access logs, and analytics.

### Email enumeration

Because there is no public signup, your enumeration surface is smaller but not zero:

- **Login:** OWASP's prescribed generic message — *"Login failed; Invalid user ID or password."* ASVS **6.3.8 (L3)**: valid users must not be deducible from *"error messages, HTTP response codes, or different response times."* Timing matters: always run the password hash comparison, even for a nonexistent user, against a dummy hash.
- **Password reset:** *"If that email address is in our database, we will send you an email to reset your password."*
- **Invitation creation:** here you have a real tension. Telling an admin "that user is already a member" is good UX; telling them "that email already has an account **in another tenant**" is a cross-tenant information leak that reveals your customer list. **Recommendation: scope the response to the current tenant only.** "Already a member of this organization" is fine. For an address that exists elsewhere, silently create the invitation and send an email that says "you've been invited to join Acme Corp — sign in to accept" — the existing user gets a correct experience, and the inviting admin learns nothing.
- **Acceptance:** an expired, revoked, already-used, or nonexistent token must all render the **same** page ("This invitation link is no longer valid — ask your administrator to send a new one") with the same status code and comparable timing.

### Acceptance flow

1. GET `/invite/{token}` → server hashes, looks up, validates → renders the org name and role (read-only) plus a credential-setting form. Do **not** create the user yet.
2. POST → in one transaction: mark invitation consumed (conditional UPDATE), create user, create membership with the role **from the invitation row**, write audit events.
3. **Do not auto-login from the invitation token.** OWASP says the same for password reset: *"Users should not be automatically logged in."* Require an explicit first login with the credential just set — this proves the credential works and creates a clean, separately-audited session-establishment event.
4. Notify the inviting admin and the tenant owners that the invite was accepted, with IP and timestamp. This is the detection control for a stolen/forwarded invite.

---

## 3. Authentication

### Passwordless / magic links vs password+MFA vs SSO

**This is the clearest finding in the whole brief, and it cuts against magic links.** The NIST 800-63 FAQ (Q-B11) states:

> "methods that do not prove possession of a specific device, such as voice-over-IP (VOIP) or **email**, SHALL NOT be used"

as out-of-band authenticators. OWASP's MFA cheat sheet agrees: email *"relies entirely on the security of the email account, which often lacks MFA."*

So an email magic link is, under NIST, **not a second factor at all** — it is a single factor whose strength equals the user's mailbox. For a product holding your pricing and margin structure, that means: whoever compromises a client's Outlook owns their access to your commercial data.

SMS is separately **"restricted"** (NIST FAQ Q-B01) due to SS7 and SIM-swap; if you offer it you must offer a non-restricted alternative and warn users.

**Recommended for this product — a three-tier ladder:**

| User class | Method | Why |
|---|---|---|
| **Internal staff** (see cost/margin) | **Mandatory SSO via your IdP (OIDC) with phishing-resistant MFA — passkeys/WebAuthn or FIDO2 keys.** No local passwords. | These accounts are the crown jewels. NIST AAL2 requires the verifier to *"offer at least one phishing-resistant authentication option"*; at AAL3 it's required. |
| **Enterprise clients** | **SSO via their IdP (OIDC, SAML if they insist), + SCIM (RFC 7644) for provisioning/deprovisioning.** | Deprovisioning is the real prize: when a client fires an employee, you want that access gone without a support ticket. Make SSO+SCIM a paid tier if you must, but build it. |
| **SMB clients without an IdP** | **Password (NIST-compliant) + TOTP or passkey. Mandatory, not optional.** | Passkeys first; TOTP as fallback. Email OTP only as a break-glass recovery path, never as the standing second factor. |

Magic links are acceptable as *account recovery* or as a low-friction path for a read-only, non-commercial portal. They are not acceptable as the primary auth for anyone who can see internal data.

### NIST SP 800-63B-4 password rules (verbatim, §3.1.1.1–3.1.1.2)

- *"Verifiers and CSPs **SHALL** require passwords that are used as a single-factor authentication mechanism to be a **minimum of 15 characters**."* MFA-backed passwords **MAY** be shorter but **SHALL** be at least **8**.
- **SHOULD** permit maximum length of at least **64 characters**; **SHOULD** accept all printing ASCII, space, and Unicode.
- *"**SHALL NOT** impose other composition rules (e.g., requiring mixtures of different character types)."*
- *"**SHALL NOT** require subscribers to change passwords periodically"* — but **SHALL** force a change on evidence of compromise.
- **SHALL** check the **entire** password against a breach/common-password blocklist (*"not substrings or words"*), and **SHALL** state the reason for rejection.
- **SHALL NOT** permit password hints accessible to an unauthenticated claimant; **SHALL NOT** use KBA.
- **SHALL** verify the full submitted password (no truncation, no "characters 2, 5, 7").
- Storage: **SHALL** be salted (**≥32-bit salt**) and hashed with a suitable password hashing scheme; **SHOULD** use an SP 800-132-approved scheme; **SHOULD** additionally apply a keyed hash ("pepper") whose key is stored separately and **SHOULD** live in an HSM.

*Practical:* Argon2id (or scrypt/bcrypt if your platform mandates), plus a pepper in KMS. Since you'll mandate MFA, the 8-character floor applies — but set 12 as your product minimum and check against Have I Been Pwned's k-anonymity range API.

### AAL and session timeouts (§5.2)

Verbatim from 800-63B-4:

- **AAL1:** overall reauth timeout **SHALL** be established, **SHOULD** be ≤ **30 days**; inactivity timeout **MAY** apply.
- **AAL2:** overall **SHOULD** be ≤ **24 hours**; inactivity **SHOULD** be ≤ **1 hour**. On inactivity timeout (but not overall timeout), the verifier **MAY** allow reauth with *one* factor plus the session secret.
- **AAL3:** overall **SHALL** be ≤ **12 hours**; inactivity **SHOULD** be ≤ **15 minutes**.

Note rev 4 relaxed AAL2 from rev 3's 12h/30min to 24h/1h.

**Recommended:** target **AAL2** for all users. Internal staff sessions that can see margin: **8-hour absolute / 30-minute idle** (tighter than required — cheap, and matches OWASP's "4–8 hours for typical office worker" absolute-timeout guidance). Client users: 24h absolute / 2h idle is defensible for usability if you enforce it server-side.

### Session management (OWASP Session Management Cheat Sheet + ASVS V7)

- **Entropy:** OWASP cheat sheet says ≥64 bits; **ASVS 5.0 §7.2.3 (L1) says at least 128 bits** from a CSPRNG. Use 128+ (32 bytes base64url).
- **Cookie:** `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` (use `Strict` if you have no cross-site entry points; `Lax` if OIDC redirects need it). No `Domain` attribute. Generic cookie name (`id`, not `JSESSIONID`).
- **Never `localStorage`/`sessionStorage`** for tokens — one XSS drains everything. Use `HttpOnly` cookies or a BFF.
- **Regenerate on authentication and on any privilege change** — ASVS **7.2.4 (L1)**: new token on auth *including re-authentication*, and terminate the old one. This is the tenant-switch and impersonation-start trigger too.
- **Server-side revocation is mandatory** (ASVS **7.4.1**). This rules out stateless-JWT-only sessions unless you add a revocation list — which means you have server state anyway. **Recommendation: opaque server-side session tokens in cookies.** Save JWTs for machine-to-machine.
- **7.4.2 (L1):** terminate all sessions when an account is disabled/deleted. **7.4.3 (L2):** offer "sign out everywhere" after a factor change. **7.4.5 (L2):** admins can terminate sessions.
- **7.5.1 (L2):** full re-authentication before changing sensitive account attributes. Add: before viewing bulk margin exports, before changing another user's role, before starting impersonation.
- **Session binding** to IP/User-Agent: OWASP mentions it as an anomaly signal. **Do not hard-fail on IP change** (mobile users roam); log it and use it for risk-based step-up.
- Log the full session lifecycle using a **salted hash** of the session ID, never the raw ID.

### OAuth/OIDC (RFC 9700, BCP 240, Jan 2025)

- **PKCE:** public clients **MUST**; confidential clients **RECOMMENDED**. Use it everywhere.
- **Exact-string redirect URI matching.** No wildcards, no prefix matching.
- **Refresh tokens:** must be sender-constrained (mTLS/DPoP) **or** rotated. **Recommendation: rotation with reuse detection** — replay of a consumed refresh token revokes the entire token family and raises a security alert. That's your token-theft tripwire.
- Access tokens should be **audience-restricted** and short (5–15 min).
- **Implicit grant discouraged; ROPC prohibited.**

### Account recovery

- Reuse the invitation token machinery: 256-bit CSPRNG, hashed at rest, single-use, **15-minute** expiry for reset (short — the user is actively waiting).
- Generic response regardless of account existence, with constant-ish timing.
- Rate limit per account and per IP.
- ASVS **6.4.3 (L2):** the reset process **must not bypass MFA**. A password reset alone must not get you in.
- Invalidate all sessions on reset (or prompt); notify the user by email at the *old* address that a reset occurred.
- **For internal staff: no self-service email reset at all.** Recovery goes through the IdP + a verified out-of-band human check. Email-based reset on a staff account is a margin-data breach with extra steps.
- Issue **backup/recovery codes** at MFA enrolment (single-use, hashed at rest, displayed once).

---

## 4. Authorization: RBAC + ReBAC

### The model

OWASP's Authorization Cheat Sheet is unusually opinionated here — it recommends **prioritizing ABAC and ReBAC over RBAC**, noting RBAC *"causes role explosion and poor scaling as complexity grows."*

For "org owns project," you need a relationship, not a role. `user → member_of → org → owns → project` is a graph query; RBAC forces you to either flatten it into per-project roles (explosion) or hardcode the traversal (bug farm).

**Recommended: a hybrid, kept deliberately small.**

```
Relationship layer (ReBAC — answers "which rows?"):
  user  --member_of{role}-->  org
  org   --owns-->             project
  project --contains-->       order --contains--> order_line

Role layer (RBAC — answers "which verbs?"), 4–6 roles max:
  client_viewer, client_manager, client_admin,
  staff_sales, staff_ops, staff_admin

Attribute layer (ABAC — answers "which fields?"):
  actor_type ∈ {client, staff}    ← the internal-data gate
  sensitivity ∈ {shared, internal}
```

The decision is `(principal, action, resource, context)` — Cedar's model, which is a good mental frame regardless of implementation.

### Policy-as-code options

| Option | Model | Notes |
|---|---|---|
| **OpenFGA** | ReBAC (Google Zanzibar) — stores object-relation-user tuples, answers checks and reverse queries over the graph | CNCF, open source. Right answer if relationships dominate and you need "list all projects X can see." Adds a service + a tuple store you must keep consistent with your DB. Its own docs note ReBAC alone doesn't cover attribute-driven cases — hence Conditions/Contextual Tuples. |
| **Cedar** (+ Amazon Verified Permissions) | RBAC + ABAC + hierarchy-based relationships | Maintained by Amazon. Design goals are **analyzability and verifiability** — schemas validate policies at authoring time, bounded latency. Strong choice if you want provable properties. AVP is the managed version (vendor lock-in tradeoff). |
| **OPA / Rego** | General-purpose | Most flexible, most general, steepest learning curve. Best when you also need infra/K8s/CI policy. Overkill for app-only authz. |
| **Oso** | Library-first | Ergonomic; note that most head-to-head "OPA vs Cedar vs Zanzibar" comparisons in search results are **published by Oso, Permit.io, Authzed or Teleport — i.e. vendor marketing about competitors.** Treat them as opinion, not evidence. |

**Recommended for this product: don't adopt a policy engine yet.** With ~6 roles and one relationship chain, an external engine adds a network hop, a consistency problem (your tuples vs your DB), and an operational surface — for a policy set that fits in one file.

Build instead: **a single `authorize(actor, action, resource)` function**, pure, exhaustively unit-tested, with a table-driven policy definition in code. Enforce via **one middleware** so no route can skip it (see below). Structure it so the internals could be swapped for Cedar later. Revisit when either (a) customers demand custom roles, or (b) the policy table exceeds ~50 rules.

### Avoiding IDOR / BOLA (API1:2023, ASVS 8.2.2)

OWASP's IDOR cheat sheet is blunt: **unguessable IDs are not access control.** *"Even with complex identifiers, access control checks are essential."* UUIDs are defence in depth only.

The reliable structural fix is **scoped queries — never fetch-then-check**:

```
✗  order = Order.find(params[:id]);  authorize(user, order)
✓  order = current_tenant.orders.find(params[:id])   # 404 if not yours
```

Fetch-then-check fails open whenever someone forgets the second line, and it leaks existence via timing/error differences. Scoped-fetch fails closed. Combine with:

- **Return 404, not 403,** for objects outside the caller's tenant — a 403 confirms the object exists.
- **ASVS 8.2.2 (L1):** data-specific access restricted to consumers with explicit permissions on specific data items.
- **ASVS 8.4.1 (L2):** *"multi-tenant applications use cross-tenant controls to ensure consumer operations will never affect tenants with which they do not have permissions to interact."*
- **API1:2023 prevention:** per-record checks in *every* function taking a client-supplied ID, plus **authorization tests maintained as part of the suite**.

### Centralized enforcement (ASVS 8.3.1, L1)

> "the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate"

**Recommended pattern — deny-by-default routing:**

1. Middleware runs on **every** route and requires an explicit `{ action, resourceLoader }` declaration.
2. A route with no declaration **throws at boot**, not at request time. Add a startup assertion that walks the router and fails if any handler lacks a policy annotation. This is the single control that stops "someone added an endpoint and forgot."
3. Middleware resolves the resource via the tenant-scoped loader, calls `authorize()`, and only then invokes the handler.
4. Every deny is logged (ASVS 16.3.2).
5. Contract test: enumerate all routes, and for each, assert that an unauthenticated caller and a wrong-tenant caller both get 401/404.

### Field-level authorization (ASVS 8.2.3 / 8.1.2, API3:2023)

- **ASVS 8.2.3 (L2):** *"field-level access is restricted to consumers with explicit permissions to specific fields."*
- **ASVS 8.1.2 (L2):** authorization **documentation** must define field-level rules for both read and write. Write the matrix down — auditors will ask, and so will your future self.

See §7 for how to enforce this structurally.

---

## 5. Audit logging

### Audit log ≠ application log

This distinction is the thing most teams get wrong, and it's what auditors probe.

| | Application log | Audit log |
|---|---|---|
| Purpose | Debugging, ops | Accountability, evidence |
| Audience | Engineers | Auditors, courts, customers |
| Schema | Free-text, evolving | Fixed, versioned |
| Mutability | Rotate, delete freely | **Append-only, retained** |
| Sampling | Yes | **Never** |
| Loss tolerance | Acceptable | **Not acceptable** — a dropped audit event is a control failure |
| Write path | Fire-and-forget | Same transaction as the change, or a durable outbox |

**Recommendation: two separate pipelines.** Audit events go to a dedicated append-only Postgres table written *in the same transaction as the business change* (so you cannot have a change without its audit record), then shipped asynchronously to immutable storage. Application logs go to your normal log stack. Do not let them share a system — OWASP A09:2025 and ASVS 16.4.3 both call for logs shipped *"to a logically separate system for analysis."*

### What to record

ASVS **16.2.1 (L2)** requires **when / where / who / what**. OWASP's Logging Cheat Sheet expands this. Concrete schema:

```
event_id            uuid (server-generated)
occurred_at         timestamptz, UTC       ← ASVS 16.2.2: synchronized source,
                                             UTC or explicit offset
recorded_at         timestamptz            ← detect clock skew / delayed writes
sequence            bigint, monotonic per tenant  ← ordering that survives equal timestamps
actor_user_id       who
actor_type          client | staff | service | system
actor_tenant_id     which org the actor belongs to
impersonated_by     nullable — CRITICAL for staff-acting-as-client
subject_tenant_id   which org the data belongs to
action              verb, from a closed enum (order.price.updated)
resource_type       + resource_id
before / after      jsonb, changed fields only, redacted per classification
outcome             success | denied | error
reason              policy id / denial reason
request_id          correlation across services
session_id_hash     salted hash, never raw
source_ip, user_agent
prev_hash, hash     tamper-evidence chain
```

**Do NOT log** (Logging Cheat Sheet): passwords, keys, session/access tokens, connection strings, payment data, source code, or PII beyond what's legally sanctioned — mask or hash where possible.

**Log at minimum** (ASVS 16.3.1–16.3.4): all authentication attempts (success and failure); **failed authorization attempts** at L2, and at L3 *all* authorization decisions including sensitive-data access attempts (logging the access, not the data); security-control bypass attempts; unexpected errors and control failures such as backend TLS failures.

**For this product specifically, add:** every read of an internal-only field or export by a client-facing path (should be zero — treat any occurrence as an alert, not a log line); every staff impersonation start/end; every role and membership change; every invitation issued, accepted, revoked; every bulk export with row counts.

### Tamper evidence

Three mechanisms, increasing in strength. OWASP A09:2025 explicitly recommends *"audit trail with integrity controls to prevent tampering or deletion, such as append-only database tables."*

1. **Append-only at the DB layer.** Revoke UPDATE/DELETE from the app role on the audit table; add a `BEFORE UPDATE OR DELETE` trigger that raises. Note that a DB superuser can still disable this — it defends against application bugs and low-privilege compromise, not a root DBA.

2. **Hash chaining.** `hash_n = SHA256(prev_hash || canonical_json(event_n))`. Publish or externally store the head hash periodically (hourly). This detects *modification and deletion of interior records* — the chain breaks. Design it exactly the way **AWS CloudTrail** does: per-file SHA-256 hashes, hourly digest files that reference the previous digest's signature, signed SHA-256-with-RSA. That's a well-tested, auditor-legible design worth copying rather than inventing. Note the chain only proves tampering to someone who has a trusted copy of a later head hash — so ship the head somewhere the app cannot rewrite.

3. **WORM storage.** Ship sealed daily batches to **S3 Object Lock in Compliance mode** (or Azure immutable blob). In Compliance mode *no user can overwrite or delete — including the AWS account root user*; the only way to remove an object before retention expiry is to delete the entire account. Governance mode is for testing (holders of `s3:BypassGovernanceRetention` can override). Object Lock has been assessed by Cohasset Associates against SEC 17a-4, CFTC and FINRA requirements — useful precedent to hand an auditor. Also enable **MFA Delete** on the bucket (AWS recommends this for CloudTrail digests).

**Recommended for this product: all three.** They cost roughly a week of work combined and they are exactly what a SOC 2 auditor and a suspicious enterprise customer will ask about.

### Clock and ordering

- ASVS **16.2.2 (L2):** synchronized time sources; UTC or explicit offset. Use the platform NTP/chrony; never a client-supplied timestamp.
- **Timestamps alone do not order events** — clocks skew, and two events can share a millisecond. Carry a **monotonic sequence number** (a Postgres sequence, or the append-only table's identity column) and treat *that* as the ordering authority. Record both `occurred_at` (application) and `recorded_at` (DB `now()`); a large gap is itself an alertable anomaly.

### Retention

- ASVS **16.1.1 (L2):** document a log inventory including *"for how long logs are kept."* The requirement is that you have a written, followed policy — not a specific number.
- OWASP: retain per legal/regulatory/contractual obligation; destroy only after expiry.
- **Recommended:** audit events — **7 years** in WORM (cheap in Glacier, covers most contract and limitation periods; check your customer contracts, some enterprise MSAs specify). Hot/queryable — 13 months (covers a full annual cycle plus your SOC 2 observation window). Application logs — 30–90 days. Note the tension with GDPR minimization: audit logs generally qualify for the legal-obligation/legitimate-interest basis, but keep PII in them to the minimum (user IDs, not names; hashed session IDs).

### Standards mapping

- **NIST SP 800-92 (2006)** is still the current final publication; **SP 800-92r1** remains an initial public draft (Oct 2023). Cite the 2006 version in compliance documentation; read r1 (which covers zero trust, continuous monitoring, and the full generate→transmit→store→access→dispose lifecycle) for design.
- **SOC 2:** the relevant common criteria are **CC7** (system operations / monitoring / incident detection) and **CC6** (logical access), plus CC4 (monitoring of controls). ⚠️ I could not retrieve the full CC1–CC9 text from AICPA's public page — the criteria document itself is a gated download. Confirm exact criteria wording with your auditor.
- **ISO/IEC 27001:2022 A.8.15 (Logging)** and **A.8.16 (Monitoring activities)** are the analogous controls. ⚠️ Clause text is paywalled; I could not verify it from a primary source, only from consultancy summaries.

---

## 6. Data protection

### In transit

- **TLS 1.3 default, TLS 1.2 for compatibility. Disable TLS 1.0/1.1** (formally deprecated by **RFC 8996**, March 2021), SSLv2, SSLv3.
- TLS 1.2 cipher suites: AEAD only (AES-GCM, ChaCha20-Poly1305); no CBC, no static DH, no export/null/anonymous.
- **HSTS** on all responses. RSA ≥2048 bits or ECDSA P-256; SHA-256 signatures; **CAA DNS records** to restrict who can issue for your domain. Let's Encrypt is fine.
- Use the **Mozilla SSL Configuration Generator** rather than hand-rolling cipher strings.
- **Internal traffic too** — including app→Postgres. Enforce `sslmode=verify-full` on the DB connection string; `require` alone doesn't validate the cert. mTLS between services if you have more than a couple.

### At rest

- **AES-256-GCM** (or ChaCha20-Poly1305). Authenticated modes always; never ECB.
- **Envelope encryption**: DEK per data class, wrapped by a KEK in **KMS/HSM**. The wrapped DEK can sit next to the data; the KEK cannot.
- Full-disk/volume encryption (RDS/Aurora/Cloud SQL encryption) is table stakes and satisfies most SOC 2 questions, but note what it *doesn't* protect against: anyone with a valid DB connection. It is not a control against the threat in this brief.
- **Application-level encryption for the crown jewels?** Tempting for cost/margin columns, but it breaks range queries, sorting and aggregation on exactly the columns your internal users need to analyze. **Recommendation: don't.** Use the separate-table + RLS + column-permission approach from §1 instead; it's stronger against the actual threat (over-fetch) and doesn't destroy your reporting.
- Key rotation triggers per OWASP: suspected compromise, staff departure, cryptoperiod expiry, algorithm weakness. Write the rotation runbook *before* you need it.

### Secrets

- Centralize in a vault: AWS Secrets Manager / Azure Key Vault / GCP Secret Manager / HashiCorp Vault.
- **No secrets in source, config files, or environment variables** (OWASP is explicit that env vars are also unacceptable — they leak via crash dumps, `/proc`, child processes, and CI logs).
- Prefer **dynamic, short-lived credentials** over static ones — especially DB credentials.
- Least privilege *within* the vault: engineers should not have access to all secrets.
- **Audit every secret access**; alert on unexpected IPs/patterns.
- **Secret scanning in CI** (gitleaks/trufflehog) plus a pre-commit hook. Treat CI/CD as production infrastructure.

### PII minimization

- Collect only what the workflow needs. For a B2B app the PII surface should be thin: name, work email, phone, role. Resist storing anything else.
- Field-level classification tags in your schema (`shared` / `internal` / `pii`) drive redaction in logs, exports, and DTOs automatically rather than by memory.
- Have a documented deletion path per tenant, and test it — "we can't delete a customer's data" is a GDPR problem and a lost enterprise deal.

### SOC 2 Type II readiness — what a small B2B SaaS actually needs

The framework is the **2017 Trust Services Criteria (With Revised Points of Focus – 2022)**. Type II tests operating effectiveness over an observation window (typically 3–12 months; **start with 3 months** for your first report, then move to 12).

**Scope: Security (mandatory) + Confidentiality.** Add Availability only if you have SLAs. Skip Processing Integrity and Privacy for v1 — each adds real cost.

Realistic minimum:

1. **Written policies** — infosec, access control, change management, incident response, vendor management, BCDR, secure SDLC, data classification. ~10 documents. These must be approved, dated, and reviewed annually.
2. **Access control evidence** — SSO+MFA everywhere (including AWS, GitHub, the DB); quarterly access reviews with signed artifacts; documented onboarding/offboarding checklists with evidence of execution.
3. **Change management** — PRs require review; CI runs tests; deploys are logged and traceable to a PR. Auditors sample deploys and ask "show me the approval."
4. **Monitoring and alerting** — this is where A09:2025's rename bites: logging without alerting fails the criterion. You need alerts *with playbooks*.
5. **Vulnerability management** — dependency scanning, a patching SLA you actually meet, annual pen test (expect $8–20k).
6. **Vendor management** — a subprocessor list with each vendor's own SOC 2.
7. **Risk assessment** — annual, documented, with treatment decisions.
8. **Incident response** — a plan, plus at least one tabletop exercise with minutes.
9. **BCDR** — backups *and a tested restore*. Auditors ask for the restore test evidence.

Compliance automation platforms (Vanta, Drata, Secureframe) are the pragmatic path for a small team — ~$10–25k/yr, and they map controls to criteria automatically. **This is a vendor-tooling opinion, not a standards requirement**; SOC 2 can be done with spreadsheets, it's just slower. Total first-year cost including the audit typically lands $30–60k.

**The good news:** everything in §1–§5 of this brief maps directly onto CC6 (logical access) and CC7 (monitoring). Building it right now means SOC 2 is mostly a documentation exercise later, not a re-architecture.

---

## 7. Preventing over-fetch and field leakage

This is where the "must never leak" requirement is won or lost. The goal is to make leakage a **compile/test failure**, not a code-review catch.

### Layer 1 — separate the data physically (highest leverage)

As in §1: `order_lines` (client-safe) and `order_line_internal` (cost, margin, MPN, BOM). A client-facing query cannot leak what it cannot join to. This defeats an entire class of bug — accidental `SELECT *`, a new ORM eager-load, a `to_json` on a model that grew a column — at the cost of one join in staff views.

Back it with **column-level GRANTs** and an RLS policy on the internal table requiring `app.actor_type = 'staff'`. Now even raw SQL from the client-facing code path fails.

### Layer 2 — deny-by-default serialization

**Never serialize domain models directly.** API3:2023's prevention guidance is explicit: *"cherry-pick specific properties rather than using generic serialization methods"* and *"avoid automatic binding functions that enable mass assignment."*

```
✗  res.json(order)                          # leaks any column ever added
✗  OrderSerializer.exclude(['cost'])        # allow-by-default; new column leaks
✓  ClientOrderDTO.from(order)               # explicit allowlist per audience
```

**Recommended: one DTO per (entity × audience).** `ClientOrderLineDTO` and `StaffOrderLineDTO` are separate types with separate field lists. Adding a column to the DB changes no DTO — it must be explicitly added, by a human, to a specific audience. In TypeScript, define DTOs as explicit interfaces and construct them field-by-field (no spread from the entity); a new sensitive column then simply cannot appear.

### Layer 3 — response schema validation (API3:2023)

OWASP recommends *"schema-based response validation as an additional security layer."* Validate outbound responses against an OpenAPI schema with `additionalProperties: false` on client-facing types, and **fail the response in non-production, alert in production.** This catches the DTO that someone bypassed.

### Layer 4 — mass assignment on the write side

The same vulnerability inbound. Bind request bodies to explicit input DTOs. Never `Object.assign(entity, req.body)`. Server-controlled fields — `tenant_id`, `role`, `cost`, `status`, `id` — must be structurally unreachable from a request body. API3:2023's worked examples are exactly this (`total_stay_price` injection, `blocked: false` injection).

### Layer 5 — GraphQL specifics (if applicable)

- Enforce authorization **in resolvers**, on *both edges and nodes* — checking only the node lets a connection edge leak.
- Use **Interfaces and Unions** to return different property sets per requester permission, rather than nulling fields out — a nulled field still tells the client the field exists.
- **Disable introspection in production** (it publishes your entire internal schema, including field names like `marginPercent`) and disable field-name suggestion hints.
- Query depth limits, cost analysis, and **batching/aliasing limits** — batching is a brute-force amplifier for tokens and OTPs.
- ⚠️ **Recommendation: for this product, prefer REST/RPC over GraphQL.** GraphQL's whole value proposition is client-driven field selection, which is precisely the property you're trying to eliminate. If you already have GraphQL, run two schemas (client and staff) behind separate endpoints rather than one schema with per-field guards.

### Layer 6 — contract tests that assert absence

This is the control that keeps working after everyone who read this brief has left.

```
FORBIDDEN_FOR_CLIENTS = [
  'cost', 'unit_cost', 'landed_cost', 'margin', 'margin_pct',
  'mpn', 'manufacturer_part_number', 'supplier', 'supplier_id',
  'bom', 'bom_line', 'internal_note', 'buy_price'
]

for every route reachable by a client principal:
    response = call(route, as=client_user)
    for key in deep_keys(response.body):          # recurse; don't just check top level
        assert normalize(key) not in FORBIDDEN_FOR_CLIENTS
```

Three properties make this work:
1. **Route enumeration is automatic** — walk the router, so new endpoints are covered the day they're added rather than when someone remembers to write a test.
2. **Recursive key inspection** — nested objects and arrays are where leaks hide.
3. **The forbidden list is a shared constant**, referenced by the test, the log redactor, and the response validator. One place to update.

Add a companion test asserting the *positive* case (staff DO see these fields), so an over-eager redaction doesn't silently break internal tooling.

### Layer 7 — the impersonation trap

Staff impersonating a client user is the highest-risk feature you will build, and it's the one most likely to leak in the wrong direction (staff context bleeding into a client-visible surface, or a support session leaving margin data in a screenshare).

- Impersonation must **replace** the principal, not augment it — `actor_type` becomes `client` for the duration, with `impersonated_by` carried separately for audit only.
- Never let `impersonated_by` influence an authorization decision.
- Require re-authentication to start (ASVS 7.5.1), cap the session at 30 minutes, make it visibly banner-marked in the UI, audit start and end, and notify the tenant admin.
- Consider making impersonation **read-only** by default, with writes requiring a second staff approver.

---

## Recommended build order

1. **Week 1–2:** tenant context plumbing (`withTenant` transaction wrapper + `SET LOCAL`), separate `_internal` tables, RLS on everything, CI assertion that every table has RLS + a policy.
2. **Week 2–3:** authorization middleware with boot-time route coverage assertion; scoped-query pattern enforced by lint; `authorize()` unit tests.
3. **Week 3–4:** DTO layer per audience + the forbidden-fields contract test. Do this *before* you have many endpoints.
4. **Week 4–5:** invitation flow, auth (SSO for staff, password+MFA for SMB clients), session management.
5. **Week 5–6:** audit log table (transactional writes, append-only trigger, hash chain) + WORM shipping.
6. **Ongoing:** SOC 2 documentation, alerting playbooks, quarterly access reviews.

Items 1 and 3 are structural and get exponentially more expensive to retrofit. Item 5 is the one auditors and enterprise customers ask about first.

---

## Things I could not verify

- **ISO/IEC 27001:2022 A.8.15/A.8.16 exact clause text** — the standard is paywalled. All accessible sources are consultancy summaries (isms.online, High Table, DQS). Buy the standard or ask your auditor.
- **AICPA TSC CC1–CC9 detailed criteria text** — the AICPA landing page confirms the document's official name and date but the criteria document itself is a gated download. My CC6/CC7 mapping is from general knowledge, not a fetched primary source; confirm with your auditor.
- **NIST SP 800-92r1 final status** — still IPD as of this date. If it finalized very recently, my check may lag by days; re-check csrc.nist.gov before citing.
- **OWASP has no invitation-flow cheat sheet.** §2 is my synthesis from the Forgot Password cheat sheet, the Authentication cheat sheet, and ASVS V6 — sound, but not a single citable OWASP position.
- **The 72-hour invitation expiry** is my recommendation and is a deliberate deviation from ASVS 6.5.5's 10-minute rule for OOB codes; document it as a risk-accepted exception.
- **Policy-engine comparisons** (Oso, Permit.io, Authzed, Teleport blogs) are vendor content about competitors. I cite only OpenFGA's and Cedar's own docs for their own descriptions.
- **RLS performance at scale** — I found no primary benchmark. Supabase's optimization advice is vendor guidance for its own platform.

---

## Sources

**Standards status and identity**
- https://csrc.nist.gov/pubs/sp/800/63/b/4/final — confirms SP 800-63B-4 final, published 31 Jul 2025, supersedes rev 3 (Mar 2020)
- https://pages.nist.gov/800-63-4/sp800-63b.html — §3.1.1.1/3.1.1.2 verbatim password requirements (15/8 char, no composition rules, no rotation, blocklists, 32-bit salt, pepper in HSM)
- https://pages.nist.gov/800-63-4/sp800-63b/aal/ — verbatim AAL1/2/3 reauthentication and inactivity timeouts (30d / 24h+1h / 12h+15min)
- https://pages.nist.gov/800-63-FAQ/ — Q-B11: email **SHALL NOT** be used as an out-of-band authenticator; Q-B01: SMS/PSTN is "restricted"
- https://owasp.org/Top10/2025/ — confirms OWASP Top 10:2025 category list and ordering
- https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/ — 100% incidence, 40 CWEs, deny-by-default and record-ownership prevention guidance
- https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/ — rename to include "Alerting"; recommends append-only tables and integrity controls
- https://owasp.org/www-project-api-security/ — confirms API Security Top 10 **2023** is still the current edition (no 2026 edition)
- https://owasp.org/www-project-application-security-verification-standard/ — ASVS 5.0.0 released 30 May 2025
- https://csrc.nist.gov/pubs/sp/800/92/r1/ipd — SP 800-92 Rev 1 still Initial Public Draft (11 Oct 2023)
- https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 — official name/date of the current SOC 2 Trust Services Criteria
- https://www.rfc-editor.org/rfc/rfc9700.html — OAuth 2.0 Security BCP (BCP 240, Jan 2025): PKCE, exact redirect matching, refresh rotation/sender-constraining, implicit and ROPC deprecation
- https://datatracker.ietf.org/doc/html/rfc7644 — SCIM protocol for enterprise provisioning/deprovisioning

**Tenant isolation**
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html — default-deny, owner/superuser/BYPASSRLS bypass, FORCE ROW LEVEL SECURITY, FK/unique constraints bypass RLS, leakproof functions, sub-SELECT race conditions, `SET row_security = off`
- https://www.postgresql.org/docs/current/sql-set.html — SET LOCAL is transaction-scoped and reverts at COMMIT or ROLLBACK
- https://www.pgbouncer.org/features.html — SET/RESET listed as "Never" supported in transaction pooling mode
- https://github.com/orgs/supabase/discussions/47946 — SET LOCAL GUCs are guaranteed isolated between clients under a transaction-mode pooler by Postgres semantics
- https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/ — AWS pattern: non-owner app role without BYPASSRLS, `current_setting()` tenant context, pgBouncer caveat, silent empty results on SELECT/UPDATE/DELETE
- https://docs.aws.amazon.com/whitepapers/latest/saas-tenant-isolation-strategies/silo-isolation.html — silo model pros/cons (compliance, noisy neighbor, blast radius vs cost, agility, onboarding)
- https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data — shared/sharded/dedicated tradeoffs; explicit caution that RLS "can be complex to design, implement, test, and maintain"
- https://supabase.com/docs/guides/database/postgres/row-level-security — enable RLS on all exposed tables, revoke-then-grant, `(select auth.uid())` optimization, index policy columns, service_role bypasses RLS *(vendor guidance)*
- https://supabase.com/docs/guides/database/database-advisors — lint rules 0013 rls_disabled_in_public, 0007 policy_exists_rls_disabled, 0010 security_definer_view, 0011 function_search_path_mutable *(vendor tooling)*

**Authentication, sessions, invitations**
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html — generic enumeration-safe error strings, NIST-aligned password policy, lockout/throttling, re-auth for sensitive ops
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — ≥64-bit entropy, `__Host-` prefix, Secure/HttpOnly/SameSite, regeneration on privilege change, 2–5min/15–30min idle and 4–8h absolute timeouts, no localStorage
- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html — CSPRNG tokens, single-use, expiry, consistent responses and timing, rate limiting, no auto-login, notification email
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html — factor ranking (passkeys > TOTP > hardware U2F), email as weak factor, SMS restricted, step-up triggers, recovery codes
- https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x15-V6-Authentication.md — 6.4.1, 6.4.3, 6.5.1, 6.5.2, 6.5.4, 6.5.5, 6.6.3, 6.6.4, 6.3.8 verbatim
- https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x16-V7-Session-Management.md — 7.2.3 (128-bit entropy), 7.2.4, 7.3.1/7.3.2, 7.4.1–7.4.5, 7.5.1, 7.5.3

**Authorization**
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html — deny by default, server-side enforcement, ABAC/ReBAC preferred over RBAC, role explosion, centralized failure handling, authz testing
- https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html — unguessable IDs are defence in depth only; per-object checks required
- https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x17-V8-Authorization.md — 8.1.2, 8.2.2, 8.2.3, 8.3.1, 8.4.1 verbatim (field-level, per-record, trusted service layer, cross-tenant controls)
- https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/ — API1:2023 per-record checks, random IDs, maintained authorization tests
- https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/ — API3:2023 cherry-pick properties, avoid auto-binding, schema-based response validation
- https://openfga.dev/docs/authorization-concepts — RBAC/ABAC/ReBAC framing, Zanzibar tuple model, stated need for Conditions/Contextual Tuples
- https://docs.cedarpolicy.com/ — Cedar's principal/action/resource/context model, RBAC+ABAC support, analyzability/verifiability design goals, relationship to Amazon Verified Permissions
- https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html — resolver-level authz on edges *and* nodes, Interfaces/Unions for field-level access, disable introspection, depth/cost limits, batching abuse

**Logging and audit**
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html — what to log, when/where/who/what fields, what never to log, tamper detection, time synchronization, retention
- https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md — 16.1.1, 16.2.1, 16.2.2 (UTC/synchronized), 16.2.5, 16.3.1–16.3.4, 16.4.1–16.4.3 verbatim
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html — reference design for hash chaining: per-file SHA-256, hourly digests referencing the previous digest's signature, SHA-256-with-RSA signing, MFA Delete recommendation
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html — WORM; Compliance mode blocks deletion even by the account root user; legal holds; Cohasset assessment against SEC 17a-4 / CFTC / FINRA
- https://csrc.nist.gov/pubs/sp/800/92/final — SP 800-92 (2006), still the current final log management guide

**Data protection**
- https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html — TLS 1.3 default, RFC 8996 deprecation of TLS 1.0/1.1, AEAD ciphers, HSTS, CAA records, mTLS internally
- https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html — AES-256-GCM, authenticated modes, envelope encryption (DEK/KEK), KMS/HSM storage, rotation triggers, CSPRNG requirements, hash-don't-encrypt for passwords
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html — centralized vaults, automated rotation, dynamic short-lived secrets, no secrets in code *or environment variables*, least privilege within the vault, access auditing, CI secret scanningagentId: a6d5581fd8cbc56be (use SendMessage with to: 'a6d5581fd8cbc56be', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 132012
tool_uses: 67
duration_ms: 682829</usage>