import type { JSX, ReactNode } from 'react';

export type BadgeTone = 'pass' | 'warn' | 'block' | 'info' | 'verify' | 'neutral';

export interface BadgeProps {
  readonly tone: BadgeTone;
  readonly children: ReactNode;
  readonly label?: string;
  readonly id?: string;
  readonly className?: string;
}

const TONE_SYMBOLS: Record<BadgeTone, string> = {
  pass: '✓',
  warn: '⚠',
  block: '✕',
  info: 'ℹ',
  verify: '?',
  neutral: '•',
};

/**
 * Accessible status badge / chip component.
 *
 * Implements ADR-019 rule 5: "never colour alone for state" — every badge
 * provides a distinct visual glyph and text description alongside color cues,
 * ensuring complete legibility for colour-blind users and high-contrast modes.
 */
export function StatusBadge({
  tone,
  children,
  label,
  id,
  className = '',
}: BadgeProps): JSX.Element {
  const symbol = TONE_SYMBOLS[tone];
  const textContent = typeof children === 'string' ? children : '';
  const ariaLabel = label ?? `${tone.toUpperCase()}: ${textContent}`;

  return (
    <span
      id={id}
      className={`status-badge status-badge-${tone} ${className}`.trim()}
      role="status"
      aria-label={ariaLabel}
    >
      <span className="badge-symbol" aria-hidden="true">
        {symbol}
      </span>
      <span className="badge-text">{children}</span>
    </span>
  );
}
