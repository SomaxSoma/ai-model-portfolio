import { TextLink } from '@pf/design-system';
import { ROLE_LABELS } from '@pf/domain';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { usePlanner } from '../state/planner';
import { useSession } from '../state/session';
import { NotificationBell } from './NotificationBell';

/** Below this width the links collapse into the menu sheet (keep in step with theme.css). */
const NAV_COLLAPSE_PX = 959;

/** The brand mark (public/brand/mark.svg). Decorative: the wordmark beside it names the link. */
export function BrandMark() {
  return <img className="pf-nav__mark" src="/brand/mark.svg" alt="" width={28} height={28} />;
}

/**
 * Application top bar — built locally (the design system ships only marketing
 * bands). Glass, sticky, active tab with a glowing underline. Collapses to a
 * full-screen sheet below 1080px.
 */
export function AppNav() {
  const { user, logout } = useSession();
  const { compare } = usePlanner();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  // Widening the window past the collapse point closes the sheet, so it can't linger as a strip.
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${NAV_COLLAPSE_PX + 1}px)`);
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) {
    // Signed out: the public catalogue, comparison and explanations, plus the way in.
    const publicLinks = [
      { to: '/models', label: 'Catalogue' },
      { to: '/compare', label: 'Compare', count: compare.length },
      { to: '/about', label: 'How it works' },
    ];
    return (
      <nav className="pf-nav" aria-label="Main">
        <div className="pf-nav__inner">
          <NavLink to="/login" className="pf-nav__brand">
            <BrandMark />
            Model Portfolio
          </NavLink>
          <ul className="pf-nav__links pf-nav__links--public">
            {publicLinks.map((l) => (
              <li key={l.to}>
                <NavLink to={l.to} className="pf-nav__link">
                  {l.label}
                  {!!l.count && <span className="pf-nav__count">{l.count}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="pf-nav__user">
            <NavLink to="/login" className="pf-nav__link">
              Log in
            </NavLink>
            <NavLink to="/register" className="pf-btn-mini">
              Sign up free
            </NavLink>
          </div>
        </div>
      </nav>
    );
  }

  // Navigation may branch on role; authorisation is enforced by the server.
  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/models', label: 'Catalogue' },
    { to: '/compare', label: 'Compare', count: compare.length },
    { to: '/workload', label: 'Workload' },
    { to: '/portfolio', label: 'Portfolio', also: ['/recommendations', '/portfolios'] },
    { to: '/teams', label: 'Teams' },
    ...(user.role === 'ADMIN' ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  const items = links.map((l) => (
    <li key={l.to}>
      <NavLink
        to={l.to}
        className="pf-nav__link"
        aria-current={location.pathname.startsWith(l.to) || l.also?.some((p) => location.pathname.startsWith(p)) ? 'page' : undefined}
      >
        {l.label}
        {l.count ? (
          <span className="pf-nav__count" aria-label={`${l.count} selected`}>
            {l.count}
          </span>
        ) : null}
      </NavLink>
    </li>
  ));

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <nav className="pf-nav" aria-label="Main">
      <div className="pf-nav__inner">
        <NavLink to="/dashboard" className="pf-nav__brand">
          <BrandMark />
          Model Portfolio
        </NavLink>
        <ul className="pf-nav__links">{items}</ul>
        <div className="pf-nav__user">
          <NotificationBell />
          <NavLink to="/account" className="pf-nav__who pf-row pf-nav__account" style={{ gap: 'var(--sp-2)' }} aria-label={`Your account (${user.name})`}>
            <span className="pf-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="pf-subtle pf-small pf-nav__name">
              {user.name}
              {user.role === 'ADMIN' && ` · ${ROLE_LABELS.ADMIN}`}
              {user.isDemo && ' · Demo'}
            </span>
          </NavLink>
          <span className="pf-nav__who">
            <TextLink as="button" arrow={false} variant="muted" onClick={logout}>
              Log out
            </TextLink>
          </span>
          <button type="button" className="pf-nav__burger" aria-expanded={open} aria-controls="pf-nav-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div id="pf-nav-sheet" className="pf-nav__sheet">
          <ul>{items}</ul>
          <div className="pf-nav__sheet-user">
            <span className="pf-subtle">
              Signed in as {user.name} ({user.isDemo ? 'demo account' : user.email})
            </span>
            <NavLink to="/account" className="pf-nav__link">
              Your account
            </NavLink>
            <span>
              <TextLink as="button" arrow={false} onClick={logout}>
                Log out
              </TextLink>
            </span>
          </div>
        </div>
      )}
    </nav>
  );
}
