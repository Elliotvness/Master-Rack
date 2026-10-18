/**
 * @vitest-environment jsdom
 *
 * Authentication, invitation acceptance, and first sign-in (task T-18a).
 * Exercises Blueprint §15.2 Step 1 & Step 2:
 *   - AC-01: anti-oracle invitation checking & redemption (invalid, expired, used,
 *     revoked, network failures all collapse to identical shape and message)
 *   - Password policy: minimum 12 characters enforced before round-trip
 *   - No auto-login (§14.3): acceptance creates acceptance session; user enrolls
 *     second factor (TOTP), then explicitly signs in at /login
 *   - Staff invitation issuance: generates single-use token & invite URL
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acceptInvitation,
  checkInvitation,
  createInvitation,
  enrollMfa,
  signIn,
  signOut,
  validatePassword,
  verifyMfa,
  INVITATION_REFUSED_MESSAGE,
  MIN_PASSWORD_LENGTH,
} from './auth-client.js';
import { App } from '../app.js';
import InviteRoute from '../routes/invite.js';
import LoginRoute from '../routes/login.js';
import { AuthProvider } from './auth-context.js';
import { InviteModal } from '../components/invite-modal.js';

afterEach(cleanup);

function stubFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: Error;
}): { fetch: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ url: urlStr, init });
    if (response.throws) throw response.throws;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe('AC-01 anti-oracle invitation checks (auth-client)', () => {
  it('collapses every failure mode to identical status and message', async () => {
    const failures = [
      stubFetch({ ok: false, status: 404, body: { message: 'not found' } }),
      stubFetch({ ok: false, status: 410, body: { message: 'expired' } }),
      stubFetch({ ok: false, status: 409, body: { message: 'already used' } }),
      stubFetch({ ok: false, status: 403, body: { message: 'revoked' } }),
      stubFetch({ throws: new Error('network down') }),
    ];

    const results = [];
    for (const f of failures) {
      results.push(await checkInvitation('test-token', f.fetch));
    }

    for (const r of results) {
      expect(r.status).toBe('refused');
      if (r.status === 'refused') {
        expect(r.message).toBe(INVITATION_REFUSED_MESSAGE);
      }
    }

    const uniqueMessages = new Set(
      results.map((r) => (r.status === 'refused' ? r.message : 'other')),
    );
    expect(uniqueMessages.size).toBe(1);
  });

  it('leaks no reason codes or extra keys in the refused result shape', async () => {
    const { fetch: f } = stubFetch({ ok: false, status: 410, body: { reason: 'expired' } });
    const result = await checkInvitation('token-123', f);

    expect(result).not.toHaveProperty('reason');
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('status_code');
    expect(Object.keys(result).sort()).toEqual(['message', 'status']);
  });

  it('refuses an empty token without a network round trip', async () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    const result = await checkInvitation('   ', f);
    expect(result.status).toBe('refused');
    expect(calls).toHaveLength(0);
  });

  it('accepts a valid token and returns organization and email', async () => {
    const { fetch: f } = stubFetch({
      body: { organizationName: 'Apex Logistics', invitedEmail: 'alice@apex.invalid' },
    });
    const result = await checkInvitation('good-token', f);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.organizationName).toBe('Apex Logistics');
      expect(result.invitedEmail).toBe('alice@apex.invalid');
    }
  });
});

describe('password policy and invitation acceptance (auth-client)', () => {
  it('enforces password floor of at least 12 characters', () => {
    expect(validatePassword('short')).toEqual([
      `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`,
    ]);
    expect(validatePassword('a-sufficiently-long-passphrase')).toHaveLength(0);
  });

  it('refuses acceptance if display name is empty', async () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    const res = await acceptInvitation(
      { token: 'tok', displayName: '   ', password: 'long-passphrase-here' },
      f,
    );
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses acceptance if password is too short', async () => {
    const { fetch: f, calls } = stubFetch({ body: {} });
    const res = await acceptInvitation(
      { token: 'tok', displayName: 'Alice', password: 'short' },
      f,
    );
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('collapses server acceptance rejection to INVITATION_REFUSED_MESSAGE', async () => {
    const { fetch: f } = stubFetch({ ok: false, status: 410, body: { state: 'unavailable' } });
    const res = await acceptInvitation(
      { token: 'tok', displayName: 'Alice', password: 'long-passphrase-here' },
      f,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe(INVITATION_REFUSED_MESSAGE);
    }
  });

  it('succeeds with ok: true on server 200 state: ready', async () => {
    const { fetch: f, calls } = stubFetch({ body: { state: 'ready' } });
    const res = await acceptInvitation(
      { token: 'good-tok', displayName: 'Alice', password: 'long-passphrase-here' },
      f,
    );
    expect(res.ok).toBe(true);
    expect(calls[0]?.url).toBe('/api/auth/invite/accept');
  });
});

describe('second-factor enrollment and verification (auth-client)', () => {
  it('enrolls TOTP and returns secret', async () => {
    const { fetch: f } = stubFetch({ body: { secret: 'JBSWY3DPEHPK3PXP', factor_type: 'totp' } });
    const res = await enrollMfa('totp', f);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.secret).toBe('JBSWY3DPEHPK3PXP');
    }
  });

  it('verifies TOTP code successfully', async () => {
    const { fetch: f, calls } = stubFetch({ body: { factor_type: 'totp', enrolled_at: '2026-08-31T00:00:00Z' } });
    const res = await verifyMfa('123456', 'totp', f);
    expect(res.ok).toBe(true);
    expect(calls[0]?.url).toBe('/api/client/v1/mfa/verify');
  });

  it('returns error on invalid TOTP code', async () => {
    const { fetch: f } = stubFetch({ ok: false, status: 401 });
    const res = await verifyMfa('000000', 'totp', f);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe('Invalid verification code.');
    }
  });
});

describe('sign-in and sign-out (auth-client)', () => {
  it('authenticates with email, password, and MFA code', async () => {
    const { fetch: f } = stubFetch({ body: { state: 'authenticated' } });
    const res = await signIn(
      { email: 'user@example.com', password: 'password123456', mfaCode: '123456' },
      f,
    );
    expect(res.ok).toBe(true);
  });

  it('returns uniform error on invalid credentials', async () => {
    const { fetch: f } = stubFetch({ ok: false, status: 401 });
    const res = await signIn(
      { email: 'user@example.com', password: 'wrong-password', mfaCode: '000000' },
      f,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain('Invalid credentials');
    }
  });

  it('signs out by sending DELETE to /api/auth/session', async () => {
    const { fetch: f, calls } = stubFetch({ ok: true, status: 204 });
    const res = await signOut(f);
    expect(res.ok).toBe(true);
    expect(calls[0]?.url).toBe('/api/auth/session');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});

describe('Step 1 staff invitation generation (auth-client)', () => {
  it('creates invitation and receives single-use token', async () => {
    const { fetch: f, calls } = stubFetch({
      body: {
        id: 'inv-123',
        organization_id: 'org-456',
        email: 'client@example.com',
        role: 'CLIENT_USER',
        token: 'gen-token-xyz',
      },
    });
    const res = await createInvitation(
      { organizationId: 'org-456', email: 'client@example.com', role: 'CLIENT_USER' },
      f,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.invitation.token).toBe('gen-token-xyz');
    }
    expect(calls[0]?.url).toBe('/api/internal/v1/invitations');
  });
});

describe('InviteRoute component (/invite)', () => {
  it('renders refusal when token is expired, invalid, or revoked (AC-01)', async () => {
    const { fetch: f } = stubFetch({ ok: false, status: 410, body: { message: 'expired' } });
    render(
      <MemoryRouter initialEntries={['/invite?token=bad-token']}>
        <InviteRoute fetchImpl={f} />
      </MemoryRouter>,
    );

    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain(INVITATION_REFUSED_MESSAGE);
    expect(document.getElementById('invitation-refused')).not.toBeNull();
  });

  it('runs full acceptance and MFA enrollment walkthrough', async () => {
    const user = userEvent.setup();
    const router = (url: string) => {
      const u = url;
      if (u.includes('/invitations/check')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            organizationName: 'Global Freight',
            invitedEmail: 'bob@global.invalid',
          }),
        } as Response);
      }
      if (u.includes('/invite/accept')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ state: 'ready' }),
        } as Response);
      }
      if (u.includes('/mfa/enroll')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ secret: 'BASE32SECRETKEY99', factor_type: 'totp' }),
        } as Response);
      }
      if (u.includes('/mfa/verify')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ factor_type: 'totp', enrolled_at: '2026-08-31T00:00:00Z' }),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected url ${u}`));
    };

    render(
      <MemoryRouter initialEntries={['/invite?token=valid-token']}>
        <InviteRoute fetchImpl={router as unknown as typeof fetch} />
      </MemoryRouter>,
    );

    // 1. Valid token renders org info
    await screen.findByText('Global Freight');
    expect(screen.getByText('bob@global.invalid')).not.toBeNull();

    // 2. Fill display name & password
    const nameInput = screen.getByLabelText(/Your Full Name/i);
    const pwInput = screen.getByLabelText(/Choose a Password/i);
    const submitBtn = screen.getByRole('button', { name: /Accept & Set Credentials/i });

    await user.type(nameInput, 'Bob Smith');
    await user.type(pwInput, 'a-secure-passphrase-12');
    await user.click(submitBtn);

    // 3. Advances to MFA enrollment
    await screen.findByText(/Second Factor Enrollment/i);
    const secretInput = await screen.findByDisplayValue('BASE32SECRETKEY99');
    expect(secretInput).not.toBeNull();

    // 4. Enter TOTP verification code
    const codeInput = screen.getByLabelText(/Verification Code/i);
    const verifyBtn = screen.getByRole('button', { name: /Verify Code & Complete Enrollment/i });

    await user.type(codeInput, '654321');
    await user.click(verifyBtn);

    // 5. Success screen and link to explicit login
    await screen.findByText(/Second factor enrolled successfully!/i);
    const loginLink = screen.getByRole('link', { name: /Proceed to Sign In/i });
    expect(loginLink.getAttribute('href')).toBe('/login');
  });
});

describe('LoginRoute component (/login)', () => {
  it('renders login form and displays error on bad credentials', async () => {
    const user = userEvent.setup();
    const { fetch: f } = stubFetch({ ok: false, status: 401 });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginRoute fetchImpl={f} />
        </AuthProvider>
      </MemoryRouter>,
    );

    const emailInput = screen.getByLabelText(/Email Address/i);
    const pwInput = screen.getByLabelText(/Password/i);
    const mfaInput = screen.getByLabelText(/Second Factor/i);
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });

    await user.type(emailInput, 'user@example.com');
    await user.type(pwInput, 'wrongpassword');
    await user.type(mfaInput, '123456');
    await user.click(submitBtn);

    const errorBanner = await screen.findByRole('alert');
    expect(errorBanner.textContent).toContain('Invalid credentials');
  });
});

describe('InviteModal component (Staff Step 1)', () => {
  it('allows staff to issue an invitation and copy link', async () => {
    const user = userEvent.setup();
    const { fetch: f } = stubFetch({
      body: {
        id: 'inv-test-id',
        organization_id: 'org-1111',
        email: 'newclient@apex.invalid',
        role: 'CLIENT_USER',
        token: 'single-use-token-abc',
      },
    });

    render(
      <InviteModal isOpen={true} onClose={() => {}} fetchImpl={f} />,
    );

    const orgInput = screen.getByLabelText(/Client Organization ID/i);
    const emailInput = screen.getByLabelText(/Invitee Email Address/i);
    const createBtn = screen.getByRole('button', { name: /Generate Invitation/i });

    await user.type(orgInput, 'org-1111');
    await user.type(emailInput, 'newclient@apex.invalid');
    await user.click(createBtn);

    await screen.findByText(/Invitation issued successfully/i);
    expect(screen.getByDisplayValue('single-use-token-abc')).not.toBeNull();
  });
});

describe('Header auth integration in App', () => {
  it('shows user badge and sign out button when authenticated', () => {
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App initialUser={{ email: 'staff@rms.internal', name: 'Staff Operator', role: 'INTERNAL_ADMIN' }} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Staff Operator')).not.toBeNull();
    expect(document.getElementById('invite-client-btn')).not.toBeNull();
    expect(document.getElementById('signoutbtn')).not.toBeNull();
  });

  it('shows sign in link when unauthenticated', () => {
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App initialUser={null} />
      </MemoryRouter>,
    );

    const signInLink = document.getElementById('signinbtn');
    expect(signInLink).not.toBeNull();
    expect(signInLink?.getAttribute('href')).toBe('/login');
  });
});
