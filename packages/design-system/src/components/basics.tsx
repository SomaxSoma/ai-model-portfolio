import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.js';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Soft tinted surface variant. */
  tint?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  as?: ElementType;
}

export function Card({ tint, padding = 'md', as: As = 'div', className, ...rest }: CardProps) {
  return <As className={cx('ds-card', tint && 'ds-card--tint', `ds-card--pad-${padding}`, className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export type ButtonVariant = 'primary' | 'ghost' | 'secondary' | 'accent';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
}

export function Button({ variant = 'primary', size = 'md', fullWidth, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('ds-button', `ds-button--${variant}`, `ds-button--${size}`, fullWidth && 'ds-button--full', className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// TextLink
// ---------------------------------------------------------------------------
type TextLinkBase = { variant?: 'accent' | 'muted'; arrow?: boolean; children?: ReactNode; className?: string };
export type TextLinkProps =
  | (TextLinkBase & { as?: 'a' } & AnchorHTMLAttributes<HTMLAnchorElement>)
  | (TextLinkBase & { as: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>)
  | (TextLinkBase & { as: ElementType } & Record<string, unknown>);

export function TextLink({ as = 'a', variant = 'accent', arrow = true, className, children, ...rest }: TextLinkProps) {
  const As = as as ElementType;
  const extra = as === 'button' ? { type: (rest as { type?: string }).type ?? 'button' } : {};
  return (
    <As className={cx('ds-textlink', variant === 'muted' && 'ds-textlink--muted', className)} {...rest} {...extra}>
      {children}
      {arrow && (
        <span className="ds-textlink__arrow" aria-hidden="true">
          →
        </span>
      )}
    </As>
  );
}

// ---------------------------------------------------------------------------
// FilterChip
// ---------------------------------------------------------------------------
export interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function FilterChip({ active, className, type = 'button', children, ...rest }: FilterChipProps) {
  return (
    <button type={type} aria-pressed={!!active} className={cx('ds-chip', active && 'ds-chip--active', className)} {...rest}>
      {active && <span aria-hidden="true">✓</span>}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field — read-only label/value pair (a display device, not an input)
// ---------------------------------------------------------------------------
export function Field({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cx('ds-field', className)}>
      <span className="ds-field__label">{label}</span>
      <span className="ds-field__value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat
// ---------------------------------------------------------------------------
export function Stat({ value, label, size = 'md', className }: { value: ReactNode; label: ReactNode; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cx('ds-stat', size === 'sm' && 'ds-stat--sm', className)}>
      <span className="ds-stat__value">{value}</span>
      <span className="ds-stat__label">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge / TopicTag
// ---------------------------------------------------------------------------
export interface BadgeProps {
  variant?: 'prize' | 'topic' | 'status';
  /** Show a leading status dot. */
  dot?: boolean;
  tone?: 'neutral' | 'positive' | 'negative';
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'topic', dot, tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span className={cx('ds-badge', `ds-badge--${variant}`, tone !== 'neutral' && `ds-badge--tone-${tone}`, className)}>
      {dot && <span className="ds-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function TopicTag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('ds-topictag', className)}>{children}</span>;
}
