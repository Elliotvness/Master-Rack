import type { ButtonHTMLAttributes, JSX } from 'react';

export type ButtonVariant = 'chrome' | 'primary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly isLoading?: boolean;
  readonly loadingText?: string;
}

/**
 * Standard accessible button primitive for the shared UI component library.
 *
 * Handles focus rings via :focus-visible, explicit type="button" default,
 * aria-busy and aria-disabled when loading, and clear accessible labels.
 */
export function Button({
  type = 'button',
  variant = 'chrome',
  isLoading = false,
  loadingText,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      className={`btn btn-${variant} ${className}`.trim()}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? (loadingText ?? children) : children}
    </button>
  );
}
