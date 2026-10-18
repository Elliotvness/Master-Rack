/**
 * Authentication and invitation client for studio-web.
 *
 * Implements Blueprint §15.2 Step 1 & Step 2:
 *   - Step 1 (Internal Staff creates invitation): `createInvitation`
 *   - Step 2 (Client Acceptance & First Sign-in):
 *       `checkInvitation`, `acceptInvitation`, `enrollMfa`, `verifyMfa`, `signIn`, `signOut`
 *
 * AC-01 Security & Anti-Oracle Requirement:
 *   Expired, revoked, already-used, and non-existent tokens must all render the same
 *   refusal message, with no leaking of status codes or distinct reason codes.
 *
 * No Auto-Login (§14.3):
 *   Acceptance produces an acceptance session to enroll a second factor (TOTP).
 *   After second-factor enrollment, the user must explicitly sign in at `/login`.
 */

export const INVITATION_REFUSED_MESSAGE =
  'This invitation link cannot be used. It may have expired, already been used, ' +
  'or been withdrawn. Ask whoever invited you to send a new one.';

export const MIN_PASSWORD_LENGTH = 12;

export interface InvitationCheckSuccess {
  readonly status: 'valid';
  readonly organizationName: string;
  readonly invitedEmail: string;
}

export interface InvitationRefused {
  readonly status: 'refused';
  readonly message: string;
}

export type InvitationCheckState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | InvitationCheckSuccess
  | InvitationRefused;

export interface AcceptInvitationInput {
  readonly token: string;
  readonly displayName: string;
  readonly password: string;
}

export type AcceptInvitationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly fieldErrors: readonly string[] };

export interface MfaEnrollResult {
  readonly ok: true;
  readonly secret: string;
  readonly factorType: string;
}

export interface MfaVerifyResult {
  readonly ok: true;
}

export interface AuthOperationError {
  readonly ok: false;
  readonly message: string;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
  readonly mfaCode: string;
}

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly email: string;
  readonly role: 'CLIENT_USER' | 'CLIENT_ADMIN';
  readonly projectId?: string;
}

export interface CreateInvitationSuccess {
  readonly ok: true;
  readonly invitation: {
    readonly id: string;
    readonly organization_id: string;
    readonly email: string;
    readonly role: string;
    readonly token: string;
    readonly expires_at?: string;
  };
}

/**
 * Validate password requirements locally before hitting the server.
 */
export function validatePassword(password: string): readonly string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`);
  }
  return Object.freeze(problems);
}

/**
 * Check an invitation token.
 *
 * AC-01: Collapses every failure (404, 410, 400, network error) to identical refusal.
 */
export async function checkInvitation(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InvitationCheckState> {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
  }

  try {
    const res = await fetchImpl('/api/client/v1/invitations/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: trimmed }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
    }

    const data = (await res.json()) as { organizationName?: string; invitedEmail?: string };
    if (typeof data.organizationName === 'string' && typeof data.invitedEmail === 'string') {
      return {
        status: 'valid',
        organizationName: data.organizationName,
        invitedEmail: data.invitedEmail,
      };
    }

    return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
  } catch {
    return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
  }
}

/**
 * Accept an invitation by providing name and password.
 *
 * AC-01: Collapses server errors to the single refusal message.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AcceptInvitationResult> {
  const trimmedName = input.displayName.trim();
  if (trimmedName.length === 0) {
    return {
      ok: false,
      message: 'Please enter your name.',
      fieldErrors: Object.freeze(['A display name is required.']),
    };
  }

  const pwProblems = validatePassword(input.password);
  if (pwProblems.length > 0) {
    return {
      ok: false,
      message: 'Please choose a longer password.',
      fieldErrors: pwProblems,
    };
  }

  try {
    const res = await fetchImpl('/api/auth/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: input.token.trim(),
        name: trimmedName,
        password: input.password,
      }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return {
        ok: false,
        message: INVITATION_REFUSED_MESSAGE,
        fieldErrors: Object.freeze([]),
      };
    }

    const data = (await res.json()) as { state?: string };
    if (data.state === 'ready') {
      return { ok: true };
    }

    return {
      ok: false,
      message: INVITATION_REFUSED_MESSAGE,
      fieldErrors: Object.freeze([]),
    };
  } catch {
    return {
      ok: false,
      message: INVITATION_REFUSED_MESSAGE,
      fieldErrors: Object.freeze([]),
    };
  }
}

/**
 * Enroll a second factor (TOTP) during acceptance session.
 */
export async function enrollMfa(
  factorType: 'totp' = 'totp',
  fetchImpl: typeof fetch = fetch,
): Promise<MfaEnrollResult | AuthOperationError> {
  try {
    const res = await fetchImpl('/api/client/v1/mfa/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ factor_type: factorType }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return { ok: false, message: 'Failed to enroll second factor.' };
    }

    const data = (await res.json()) as { secret?: string; factor_type?: string };
    if (typeof data.secret === 'string') {
      return {
        ok: true,
        secret: data.secret,
        factorType: data.factor_type ?? factorType,
      };
    }

    return { ok: false, message: 'Invalid response from MFA enrollment.' };
  } catch {
    return { ok: false, message: 'Network error during MFA enrollment.' };
  }
}

/**
 * Verify a TOTP code during second-factor enrollment.
 */
export async function verifyMfa(
  code: string,
  factorType: 'totp' = 'totp',
  fetchImpl: typeof fetch = fetch,
): Promise<MfaVerifyResult | AuthOperationError> {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Please enter the verification code.' };
  }

  try {
    const res = await fetchImpl('/api/client/v1/mfa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ factor_type: factorType, code: trimmed }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return { ok: false, message: 'Invalid verification code.' };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: 'Network error during code verification.' };
  }
}

/**
 * Explicit sign-in with email, password, and second factor code.
 */
export async function signIn(
  credentials: SignInInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | AuthOperationError> {
  const email = credentials.email.trim().toLowerCase();
  if (email.length === 0 || credentials.password.length === 0) {
    return { ok: false, message: 'Email and password are required.' };
  }

  try {
    const res = await fetchImpl('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: credentials.password,
        mfa_code: credentials.mfaCode.trim(),
      }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return {
        ok: false,
        message: 'Invalid credentials. Please check your email, password, and MFA code.',
      };
    }

    const data = (await res.json()) as { state?: string };
    if (data.state === 'authenticated') {
      return { ok: true };
    }

    return {
      ok: false,
      message: 'Invalid credentials. Please check your email, password, and MFA code.',
    };
  } catch {
    return { ok: false, message: 'Network error during sign in.' };
  }
}

/**
 * Sign out and revoke the session.
 */
export async function signOut(fetchImpl: typeof fetch = fetch): Promise<{ ok: true }> {
  try {
    await fetchImpl('/api/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch {
    // Deliberately ignore errors on sign-out to ensure client session is always cleared
  }
  return { ok: true };
}

/**
 * Internal Staff creates an invitation for a client organization (Step 1).
 */
export async function createInvitation(
  input: CreateInvitationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateInvitationSuccess | AuthOperationError> {
  if (input.organizationId.trim().length === 0) {
    return { ok: false, message: 'Organization ID is required.' };
  }
  if (input.email.trim().length === 0) {
    return { ok: false, message: 'Invited email is required.' };
  }

  try {
    const res = await fetchImpl('/api/internal/v1/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organization_id: input.organizationId.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        ...(input.projectId ? { project_id: input.projectId.trim() } : {}),
      }),
      credentials: 'same-origin',
    });

    if (!res.ok) {
      return { ok: false, message: 'Failed to create invitation.' };
    }

    const data = (await res.json()) as CreateInvitationSuccess['invitation'];
    return { ok: true, invitation: data };
  } catch {
    return { ok: false, message: 'Network error while creating invitation.' };
  }
}
