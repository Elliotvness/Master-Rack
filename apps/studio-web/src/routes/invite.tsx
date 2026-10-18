import { useEffect, useState, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router';

import {
  acceptInvitation,
  checkInvitation,
  enrollMfa,
  verifyMfa,
  validatePassword,
  INVITATION_REFUSED_MESSAGE,
  MIN_PASSWORD_LENGTH,
  type InvitationCheckState,
} from '../auth/auth-client.js';
import { Button } from '../components/button.js';
import { StatusBadge } from '../components/badge.js';

export interface InviteRouteProps {
  readonly fetchImpl?: typeof fetch | undefined;
}

export default function InviteRoute({ fetchImpl }: InviteRouteProps): JSX.Element {
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get('token') ?? '';

  const [enteredToken, setEnteredToken] = useState(tokenParam);
  const [tokenToCheck, setTokenToCheck] = useState(tokenParam);
  const [checkState, setCheckState] = useState<InvitationCheckState>({ status: 'idle' });

  // Acceptance step state
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [acceptErrors, setAcceptErrors] = useState<readonly string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);

  // MFA step state
  const [step, setStep] = useState<'accept' | 'mfa' | 'complete'>('accept');
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);

  useEffect(() => {
    if (!tokenToCheck.trim()) {
      return;
    }

    let active = true;
    setCheckState({ status: 'checking' });

    void checkInvitation(tokenToCheck, fetchImpl).then((res) => {
      if (active) {
        setCheckState(res);
      }
    });

    return () => {
      active = false;
    };
  }, [tokenToCheck, fetchImpl]);

  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredToken.trim()) {
      setTokenToCheck(enteredToken.trim());
    }
  };

  const handleAcceptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAcceptErrors([]);

    const problems: string[] = [];
    if (!displayName.trim()) {
      problems.push('A display name is required.');
    }
    const pwProblems = validatePassword(password);
    problems.push(...pwProblems);

    if (problems.length > 0) {
      setAcceptErrors(problems);
      return;
    }

    setIsAccepting(true);
    try {
      const res = await acceptInvitation(
        {
          token: tokenToCheck,
          displayName: displayName.trim(),
          password,
        },
        fetchImpl,
      );

      if (res.ok) {
        setStep('mfa');
        // Fetch MFA secret for enrollment
        const enrollRes = await enrollMfa('totp', fetchImpl);
        if (enrollRes.ok) {
          setMfaSecret(enrollRes.secret);
        } else {
          setMfaError(enrollRes.message);
        }
      } else {
        // Anti-oracle: set checkState to refused with the standard message
        setCheckState({ status: 'refused', message: res.message });
      }
    } finally {
      setIsAccepting(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaError(null);
    if (!mfaCode.trim()) {
      setMfaError('Please enter the verification code.');
      return;
    }

    setIsVerifyingMfa(true);
    try {
      const res = await verifyMfa(mfaCode.trim(), 'totp', fetchImpl);
      if (res.ok) {
        setStep('complete');
      } else {
        setMfaError(res.message);
      }
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  return (
    <section className="auth-card" id="invite-card">
      <div className="auth-header">
        <h1 className="auth-title">Client Invitation Acceptance (Step 2)</h1>
        <p className="auth-subtitle">
          Rack Master Studio quotation intake onboarding and credential setup.
        </p>
      </div>

      {/* No token supplied */}
      {checkState.status === 'idle' && (
        <form onSubmit={handleTokenSubmit} className="auth-form" id="token-form">
          <p className="auth-instruction">
            Please enter your invitation link or token below to continue:
          </p>
          <div className="field-group">
            <label htmlFor="invite-token-input" className="field-label">
              Invitation Token
            </label>
            <input
              id="invite-token-input"
              className="input-field"
              type="text"
              required
              placeholder="Paste invitation token here"
              value={enteredToken}
              onChange={(e) => setEnteredToken(e.target.value)}
            />
          </div>
          <Button id="invite-token-submit" type="submit" variant="primary">
            Check Invitation
          </Button>
        </form>
      )}

      {/* Checking status */}
      {checkState.status === 'checking' && (
        <div className="auth-loading" role="status" id="invite-checking">
          <StatusBadge tone="neutral">Validating…</StatusBadge>
          <p>Verifying invitation link with server…</p>
        </div>
      )}

      {/* Refused status (AC-01: uniform anti-oracle collapse) */}
      {checkState.status === 'refused' && (
        <div className="auth-refusal" id="invitation-refused" role="alert">
          <StatusBadge tone="block" id="refusal-badge">
            Invitation Refused
          </StatusBadge>
          <p className="refusal-message" id="refusal-message">
            {checkState.message || INVITATION_REFUSED_MESSAGE}
          </p>
          <div className="auth-nav">
            <Link to="/login" className="btn btn-chrome">
              Go to Sign In
            </Link>
          </div>
        </div>
      )}

      {/* Valid invitation */}
      {checkState.status === 'valid' && (
        <div className="auth-flow" id="invite-valid-flow">
          {step === 'accept' && (
            <form onSubmit={handleAcceptSubmit} className="auth-form" id="invite-form">
              <div className="invitation-org-summary" id="invite-org-summary">
                <StatusBadge tone="pass">Valid Invitation</StatusBadge>
                <div className="org-details">
                  <span className="org-label">Organization:</span>{' '}
                  <strong id="invite-org-name">{checkState.organizationName}</strong>
                </div>
                <div className="email-details">
                  <span className="email-label">Invited Email:</span>{' '}
                  <span id="invite-email-display">{checkState.invitedEmail}</span>
                </div>
              </div>

              {acceptErrors.length > 0 && (
                <div id="invite-form-errors" role="alert" className="error-banner">
                  <StatusBadge tone="block">Validation Error</StatusBadge>
                  <ul className="error-list">
                    {acceptErrors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="field-group">
                <label htmlFor="invite-name" className="field-label">
                  Your Full Name
                </label>
                <input
                  id="invite-name"
                  name="displayName"
                  className="input-field"
                  type="text"
                  required
                  placeholder="e.g. Jane Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="invite-password" className="field-label">
                  Choose a Password
                </label>
                <input
                  id="invite-password"
                  name="password"
                  className="input-field"
                  type="password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  placeholder="At least 12 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className="field-hint">
                  Must be at least {MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.
                </span>
              </div>

              <Button
                id="invite-submit"
                type="submit"
                variant="primary"
                isLoading={isAccepting}
                loadingText="Setting credentials…"
              >
                Accept &amp; Set Credentials
              </Button>
            </form>
          )}

          {step === 'mfa' && (
            <div className="auth-form" id="mfa-enrollment-step">
              <StatusBadge tone="info">Step 2: Second Factor Enrollment</StatusBadge>
              <p className="mfa-desc">
                Per security policy (§14.3), all client accounts require a Time-based One-Time
                Password (TOTP) second factor.
              </p>

              {mfaSecret && (
                <div className="mfa-secret-box">
                  <label htmlFor="mfa-secret-value" className="field-label">
                    TOTP Secret Key
                  </label>
                  <input
                    id="mfa-secret"
                    className="input-field code-font"
                    type="text"
                    readOnly
                    value={mfaSecret}
                  />
                  <span className="field-hint">
                    Enter this secret key into your authenticator app (e.g. Google Authenticator, 1Password).
                  </span>
                </div>
              )}

              {mfaError && (
                <div id="mfa-error" role="alert" className="error-banner">
                  <StatusBadge tone="block">Error</StatusBadge>
                  <span>{mfaError}</span>
                </div>
              )}

              <form onSubmit={handleMfaVerify} id="mfa-verify-form">
                <div className="field-group">
                  <label htmlFor="mfa-code" className="field-label">
                    Verification Code
                  </label>
                  <input
                    id="mfa-code"
                    name="mfaCode"
                    className="input-field code-font"
                    type="text"
                    required
                    placeholder="6-digit code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                </div>

                <Button
                  id="mfa-verify"
                  type="submit"
                  variant="primary"
                  isLoading={isVerifyingMfa}
                  loadingText="Verifying…"
                >
                  Verify Code &amp; Complete Enrollment
                </Button>
              </form>
            </div>
          )}

          {step === 'complete' && (
            <div className="auth-form" id="mfa-complete-step">
              <StatusBadge tone="pass" id="mfa-success">
                Enrollment Complete
              </StatusBadge>
              <h2>Second factor enrolled successfully!</h2>
              <p className="no-auto-login-note">
                <strong>No auto-login:</strong> Per security specification §14.3, you must now
                perform an explicit sign-in using your new password and authenticator code.
              </p>
              <div className="auth-nav">
                <Link to="/login" id="go-to-login" className="btn btn-primary">
                  Proceed to Sign In
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
