/**
 * Invitation acceptance (`D-01`).
 *
 * `AC-01` governs this screen, and it is a security requirement wearing the
 * clothes of a UX decision:
 *
 *   **Expired, revoked, already-used and never-issued tokens must all render
 *   the same page, with the same status and comparable timing.**
 *
 * If they differ, the page becomes an oracle. "This invitation has expired"
 * confirms the token was real, which tells an attacker their guess was in the
 * right space. "No such invitation" tells them it was not. Given a few thousand
 * attempts that difference is enough to map the token space.
 *
 * The server already enforces this — it returns one refusal shape for all four
 * cases. This module's job is to not undo it in the browser, which is easier to
 * get wrong than it sounds: a helpful `switch` on the reason code, added later
 * by someone trying to improve the error message, reintroduces the oracle.
 *
 * There is therefore deliberately NO reason code in the refusal type. The
 * distinction is not available to render, so it cannot be rendered.
 */

import { CLIENT_NAMESPACE, request } from './api.js';

export type InvitationState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | {
      readonly status: 'valid';
      readonly organizationName: string;
      readonly invitedEmail: string;
    }
  /**
   * One refusal for every failure mode. No `reason` field exists, by design.
   */
  | { readonly status: 'refused'; readonly message: string };

/**
 * The single message shown for every unusable token.
 *
 * Written to be honest without being an oracle: it does not claim the
 * invitation never existed, and it does not confirm that it did.
 */
export const INVITATION_REFUSED_MESSAGE =
  'This invitation link cannot be used. It may have expired, already been used, ' +
  'or been withdrawn. Ask whoever invited you to send a new one.';

export interface InvitationCheckResponse {
  readonly organizationName: string;
  readonly invitedEmail: string;
}

/**
 * Check a token.
 *
 * Every failure — 404, 410, 400, a network error — collapses to the same
 * refusal. Note what is NOT done here: no branching on status code, no
 * distinguishing "expired" from "not found". The collapse is the feature.
 */
export async function checkInvitation(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InvitationState> {
  if (token.trim() === '') {
    return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
  }

  try {
    const result = await request<InvitationCheckResponse>(
      `${CLIENT_NAMESPACE}/invitations/check`,
      { method: 'POST', body: { token } },
      fetchImpl,
    );
    return {
      status: 'valid',
      organizationName: result.organizationName,
      invitedEmail: result.invitedEmail,
    };
  } catch {
    // Deliberately NOT inspecting the error. An ApiError, a network fault and
    // anything else collapse to the same page — that collapse is AC-01, and
    // branching here to "improve" the message would reintroduce the oracle.
    //
    // There is no `instanceof` check because there is nothing to decide: every
    // path returns the same value, so a discriminating branch would be
    // unreachable code implying a distinction the design forbids.
    return { status: 'refused', message: INVITATION_REFUSED_MESSAGE };
  }
}

export interface AcceptInvitationInput {
  readonly token: string;
  readonly displayName: string;
  readonly password: string;
}

export type AcceptResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly fieldErrors: readonly string[] };

/**
 * Minimum password policy applied in the browser.
 *
 * The server enforces this too; doing it here as well is not duplication for
 * its own sake, it is so the client is told before a round trip. The length
 * floor is deliberately the only hard rule: composition rules push people
 * toward `Password1!` and away from length, which is the property that
 * actually matters.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblems(password: string): readonly string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`);
  }
  return Object.freeze(problems);
}

/**
 * Accept an invitation.
 *
 * There is no auto-login on success: the client is sent to sign in with the
 * credentials they just set. That is a deliberate friction. Auto-login turns a
 * single-use token into a session-granting token, which means a leaked link in
 * an email forward is a full account takeover rather than a wasted invitation.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AcceptResult> {
  const problems = passwordProblems(input.password);
  if (input.displayName.trim() === '') {
    return {
      ok: false,
      message: 'Please enter your name.',
      fieldErrors: Object.freeze(['A display name is required.']),
    };
  }
  if (problems.length > 0) {
    return { ok: false, message: 'Please choose a longer password.', fieldErrors: problems };
  }

  try {
    await request<{ accepted: true }>(
      `${CLIENT_NAMESPACE}/invitations/accept`,
      {
        method: 'POST',
        body: {
          token: input.token,
          displayName: input.displayName.trim(),
          password: input.password,
        },
      },
      fetchImpl,
    );
    return { ok: true };
  } catch {
    // Same collapse as the check: a redemption that loses the race with another
    // tab must be indistinguishable from an expired token.
    return {
      ok: false,
      message: INVITATION_REFUSED_MESSAGE,
      fieldErrors: Object.freeze([]),
    };
  }
}
