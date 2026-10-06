import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../cx.js';

// ---------------------------------------------------------------------------
// SearchInput
// ---------------------------------------------------------------------------
export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible label (visually hidden). */
  label?: string;
}

export function SearchInput({ value, onChange, label = 'Search', className, placeholder = 'Search', ...rest }: SearchInputProps) {
  return (
    <label className={cx('ds-search', className)}>
      <span className="ds-visually-hidden">{label}</span>
      <svg className="ds-search__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input type="search" className="ds-search__input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export interface TableColumn {
  key: string;
  label: ReactNode;
  align?: 'left' | 'right' | 'center';
}

export type TableRow = { id: string | number; _variant?: 'total' } & Record<string, unknown>;

export interface TableProps {
  columns: TableColumn[];
  rows: TableRow[];
  caption?: ReactNode;
  /** Render the first column as a row header (<th scope="row">). */
  rowHeaders?: boolean;
  className?: string;
}

export function Table({ columns, rows, caption, rowHeaders, className }: TableProps) {
  const align = (c: TableColumn) => (c.align && c.align !== 'left' ? `ds-align-${c.align}` : undefined);
  return (
    <div className={cx('ds-table-wrap', className)}>
      <table className="ds-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={align(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r._variant === 'total' ? 'ds-table__row--total' : undefined}>
              {columns.map((c, i) =>
                rowHeaders && i === 0 ? (
                  <th key={c.key} scope="row" className={align(c)}>
                    {r[c.key] as ReactNode}
                  </th>
                ) : (
                  <td key={c.key} className={align(c)} data-label={typeof c.label === 'string' ? c.label : undefined}>
                    {r[c.key] as ReactNode}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------
export interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Alert({ variant = 'info', title, children, onDismiss, className }: AlertProps) {
  const urgent = variant === 'danger' || variant === 'warning';
  return (
    <div role={urgent ? 'alert' : 'status'} className={cx('ds-alert', `ds-alert--${variant}`, className)}>
      <div className="ds-alert__body">
        {title && <div className="ds-alert__title">{title}</div>}
        {children}
      </div>
      {onDismiss && (
        <button type="button" className="ds-alert__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs (controlled)
// ---------------------------------------------------------------------------
export interface TabsProps {
  tabs: { key: string; label: ReactNode; content: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  label?: string;
}

export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === current?.key);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length]!;
    onChange(t.key);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-key="${t.key}"]`)?.focus();
  };

  return (
    <div className="ds-tabs">
      <div className="ds-tabs__list" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            data-key={t.key}
            type="button"
            role="tab"
            id={`${id}-tab-${t.key}`}
            aria-selected={t.key === current?.key}
            aria-controls={`${id}-panel-${t.key}`}
            tabIndex={t.key === current?.key ? 0 : -1}
            className="ds-tabs__tab"
            onClick={() => onChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel" id={`${id}-panel-${current.key}`} aria-labelledby={`${id}-tab-${current.key}`} className="ds-tabs__panel">
          {current.content}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SegmentedNav
// ---------------------------------------------------------------------------
export interface SegmentedNavProps {
  items: { key: string; label: ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  label?: string;
}

export function SegmentedNav({ items, active, onChange, label }: SegmentedNavProps) {
  return (
    <div className="ds-segmented" role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" aria-pressed={it.key === active} className="ds-segmented__item" onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: ReactNode;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  options: (string | { value: string; label: string })[];
  onChange: (value: string) => void;
}

export function Select({ label, hideLabel, options, onChange, className, ...rest }: SelectProps) {
  return (
    <label className={cx('ds-select', className)}>
      {label && <span className={hideLabel ? 'ds-visually-hidden' : 'ds-select__label'}>{label}</span>}
      <select className="ds-select__control" onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterProps {
  brand: ReactNode;
  tagline?: ReactNode;
  columns: { title: string; links: FooterLink[] }[];
  legal?: ReactNode;
  /** Render links with a router component; defaults to <a href>. */
  renderLink?: (link: FooterLink) => ReactNode;
}

export function Footer({ brand, tagline, columns, legal, renderLink }: FooterProps) {
  return (
    <footer className="ds-footer">
      <div className="ds-footer__inner">
        <div className="ds-footer__top">
          <div>
            <div className="ds-footer__brand">{brand}</div>
            {tagline && <p className="ds-footer__tagline">{tagline}</p>}
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <div className="ds-footer__title">{col.title}</div>
              <ul className="ds-footer__links">
                {col.links.map((l) => (
                  <li key={l.label}>{renderLink ? renderLink(l) : <a href={l.href}>{l.label}</a>}</li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {legal && <div className="ds-footer__legal">{legal}</div>}
      </div>
    </footer>
  );
}
