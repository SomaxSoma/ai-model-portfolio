import { Alert, Button, TextLink } from '@pf/design-system';
import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { ApiError } from '../api';

// ---------------------------------------------------------------------------
// PfInput — the one editable text control (the design system ships none).
// ---------------------------------------------------------------------------
export interface PfInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'prefix'> {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string;
  prefix?: string;
  hideLabel?: boolean;
  compact?: boolean;
}

export function PfInput({ label, value, onChange, hint, error, prefix, hideLabel, compact, id, className, ...rest }: PfInputProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const input = (
    <input
      id={inputId}
      className={`pf-input${compact ? ' pf-input--compact' : ''}`}
      value={value}
      aria-invalid={error ? true : undefined}
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
  return (
    <div className={`pf-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={inputId} className={hideLabel ? 'ds-visually-hidden' : 'pf-field__label'}>
        {label}
      </label>
      {prefix ? (
        <div className="pf-input__wrap pf-input__wrap--prefixed">
          <span className="pf-input__affix" aria-hidden="true">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
      {hint && !error && (
        <span id={hintId} className="pf-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="pf-field__error">
          {error}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PfSlider — ONE native range input; its own track paints the fill from --pct.
// ---------------------------------------------------------------------------
export function PfSlider({ label, value, onChange, min = 0, max = 100, step = 1, valueText }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; valueText?: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="pf-slider"
      aria-label={label}
      aria-valuetext={valueText}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

// ---------------------------------------------------------------------------
// TableScroll — own scroll container around the system's Table.
// ---------------------------------------------------------------------------
export function TableScroll({ children, stack, fluid, label }: { children: ReactNode; stack?: boolean; fluid?: boolean; label?: string }) {
  const cls = ['pf-table-scroll', stack && 'pf-table-stack', fluid && 'pf-table-scroll--fluid'].filter(Boolean).join(' ');
  return (
    // tabIndex lets keyboard users scroll a wide table.
    <div className={cls} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------
export function PageHead({ overline, title, subtitle, actions }: { overline?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="pf-page-head">
      <div className="pf-page-head__title">
        {overline}
        <h1>{title}</h1>
        {subtitle && <p className="pf-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="pf-page-head__actions">{actions}</div>}
    </header>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <p className="pf-subtle" role="status">
      {what}…
    </p>
  );
}

export function LoadError({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Alert variant="danger" title={error.status === 404 ? 'Not found' : 'Couldn’t load this page'}>
      <div className="pf-stack pf-stack--sm">
        <span>{error.message}</span>
        {onRetry && error.status !== 404 && (
          <span>
            <TextLink as="button" arrow={false} onClick={onRetry}>
              Try again
            </TextLink>
          </span>
        )}
      </div>
    </Alert>
  );
}

/** An action that navigates, styled as a design-system Button. */
export function ButtonLink({ to, children, variant = 'primary' }: { to: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  const navigate = useNavigate();
  return (
    <Button variant={variant} size="lg" onClick={() => navigate(to)}>
      {children}
    </Button>
  );
}
