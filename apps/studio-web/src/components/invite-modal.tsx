import { useEffect, useState, type JSX } from 'react';

import { createInvitation } from '../auth/auth-client.js';
import { Button } from './button.js';
import { StatusBadge } from './badge.js';

export interface InviteModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly fetchImpl?: typeof fetch | undefined;
}

export function InviteModal({
  isOpen,
  onClose,
  fetchImpl,
}: InviteModalProps): JSX.Element | null {
  const [organizationId, setOrganizationId] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'CLIENT_USER' | 'CLIENT_ADMIN'>('CLIENT_USER');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<{
    readonly token: string;
    readonly link: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setOrganizationId('');
      setEmail('');
      setRole('CLIENT_USER');
      setError(null);
      setCreatedInvite(null);
      setCopied(false);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await createInvitation(
        {
          organizationId: organizationId.trim(),
          email: email.trim().toLowerCase(),
          role,
        },
        fetchImpl,
      );

      if (res.ok) {
        const link = `${window.location.origin}/invite?token=${res.invitation.token}`;
        setCreatedInvite({
          token: res.invitation.token,
          link,
        });
      } else {
        setError(res.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (createdInvite) {
      navigator.clipboard?.writeText(createdInvite.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="modal-backdrop"
      id="invite-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        id="invite-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
      >
        <div className="modal-header">
          <h2 id="invite-modal-title" className="modal-title">
            Issue Client Invitation (Step 1)
          </h2>
          <button
            type="button"
            id="close-invite-modal"
            className="chrome-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {createdInvite ? (
          <div className="modal-body" id="invite-token-result">
            <StatusBadge tone="pass" id="invite-success-badge">
              Invitation issued successfully
            </StatusBadge>
            <p className="invite-desc">
              Share this single-use link with the client representative. The link allows them
              to establish their display name, set a password, and enroll a second factor.
            </p>
            <div className="invite-link-box">
              <label htmlFor="invite-generated-link" className="field-label">
                Invitation URL
              </label>
              <input
                id="invite-generated-link"
                className="input-field"
                type="text"
                readOnly
                value={createdInvite.link}
              />
            </div>
            <div className="invite-token-box">
              <label htmlFor="invite-generated-token" className="field-label">
                Single-use Token
              </label>
              <input
                id="invite-generated-token"
                className="input-field"
                type="text"
                readOnly
                value={createdInvite.token}
              />
            </div>
            <div className="modal-actions">
              <Button
                id="copy-invite-link"
                variant="primary"
                onClick={handleCopy}
              >
                {copied ? 'Copied!' : 'Copy Invitation Link'}
              </Button>
              <Button variant="chrome" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form id="staff-invite-form" onSubmit={handleSubmit} className="modal-body">
            {error && (
              <div id="invite-create-error" role="alert" className="error-banner">
                <StatusBadge tone="block">Error</StatusBadge>
                <span>{error}</span>
              </div>
            )}
            <div className="field-group">
              <label htmlFor="invite-org-id" className="field-label">
                Client Organization ID (UUID)
              </label>
              <input
                id="invite-org-id"
                name="organizationId"
                className="input-field"
                type="text"
                required
                placeholder="00000000-0000-0000-0000-000000000000"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="invite-email" className="field-label">
                Invitee Email Address
              </label>
              <input
                id="invite-email"
                name="email"
                className="input-field"
                type="email"
                required
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="invite-role" className="field-label">
                Client Role
              </label>
              <select
                id="invite-role"
                name="role"
                className="select-field"
                value={role}
                onChange={(e) => setRole(e.target.value as 'CLIENT_USER' | 'CLIENT_ADMIN')}
              >
                <option value="CLIENT_USER">CLIENT_USER (Standard)</option>
                <option value="CLIENT_ADMIN">CLIENT_ADMIN (Administrator)</option>
              </select>
            </div>

            <div className="modal-actions">
              <Button
                id="invite-create-btn"
                type="submit"
                variant="primary"
                isLoading={isSubmitting}
                loadingText="Issuing…"
              >
                Generate Invitation
              </Button>
              <Button variant="chrome" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
