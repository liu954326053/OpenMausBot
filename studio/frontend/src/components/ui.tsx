/**
 * Core UI components library
 */

import React from 'react';
import clsx from 'clsx';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseClasses = clsx(
      'inline-flex items-center justify-center gap-2 font-medium transition-colors',
      'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      {
        'px-3 py-1.5 text-sm': size === 'sm',
        'px-4 py-2 text-base': size === 'md',
        'px-6 py-3 text-lg': size === 'lg',
        'w-full': fullWidth,
      }
    );

    const variantClasses = {
      primary: 'bg-accent text-white hover:opacity-90',
      secondary: 'bg-bg-card text-text-primary border border-border hover:bg-bg-panel',
      danger: 'bg-status-error text-white hover:opacity-90',
      ghost: 'text-text-primary hover:bg-bg-card',
    }[variant];

    return (
      <button
        ref={ref}
        className={clsx(baseClasses, variantClasses, className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

/* Input component */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ error, label, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-2">
        {label && <label className="text-sm font-medium text-text-primary">{label}</label>}
        <input
          ref={ref}
          className={clsx(
            'px-3 py-2 border border-border rounded-lg bg-bg-base text-text-primary',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-status-error',
            className
          )}
          {...props}
        />
        {error && <span className="text-xs text-status-error">{error}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';

/* Modal / Dialog component */
export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  actions,
  size = 'md',
}) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={clsx(
          'bg-bg-panel rounded-lg shadow-lg',
          'max-h-[90vh] overflow-auto',
          'p-6 w-full mx-4',
          sizeClasses
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="text-lg font-semibold mb-4 text-text-primary">{title}</h2>}
        <div className="mb-6 text-text-secondary">{children}</div>
        {actions && <div className="flex gap-3 justify-end">{actions}</div>}
      </div>
    </div>
  );
};

Dialog.displayName = 'Dialog';

/* Loading spinner */
export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }[size];

  return (
    <div
      className={clsx(
        'border-2 border-border border-t-accent rounded-full animate-spin',
        sizeClasses
      )}
    />
  );
};

Spinner.displayName = 'Spinner';

/* Badge component */
export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children }) => {
  const variantClasses = {
    default: 'bg-bg-card text-text-primary',
    success: 'bg-status-success/20 text-status-success',
    warning: 'bg-status-warning/20 text-status-warning',
    error: 'bg-status-error/20 text-status-error',
  }[variant];

  return (
    <span className={clsx('px-2.5 py-1 text-xs font-medium rounded-full', variantClasses)}>
      {children}
    </span>
  );
};

Badge.displayName = 'Badge';

/* Card component */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(
        'bg-bg-card border border-border rounded-lg p-4',
        'hover:bg-opacity-80 transition-colors',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);

Card.displayName = 'Card';
