import { TextLink } from '@pf/design-system';
import { ROLE_LABELS } from '@pf/domain';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { usePlanner } from '../state/planner';
import { useSession } from '../state/session';

/**
 * Application top bar — built locally because the design system ships only
 * marketing bands. 64px, light, active tab in accent with a 2px underline.
 * Collapses to a full-screen sheet below 1080px.
 */
export function AppNav() {
  const { user, logout } = useSession();
  const { compare } = usePlanner();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) return null;

  // Navigation may branch on role; authorisation is enforced by the server.
  const links = [
    { to: '/models', label: 'Catalogue' },
    { to: '/compare', label: 'Compare', count: compare.length },
    { to: '/workload', label: 'Workload' },
    { to: '/portfolio', label: 'Portfolio', also: ['/recommendations', '/portfolios'] },
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

  return (
    <nav className="pf-nav" aria-label="Main">
      <div className="pf-nav__inner">
        <NavLink to="/models" className="pf-nav__brand">
          <svg className="pf-nav__mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" className="pf-nav__mark-bg" />
            <rect x="7" y="17" width="4" height="8" rx="1" className="pf-nav__mark-bar" />
            <rect x="14" y="11" width="4" height="14" rx="1" className="pf-nav__mark-bar" />
            <rect x="21" y="7" width="4" height="18" rx="1" className="pf-nav__mark-accent" />
          </svg>
          Model Portfolio
        </NavLink>
        <ul className="pf-nav__links">{items}</ul>
        <div className="pf-nav__user">
          <span className="pf-subtle">
            {user.name}
            {user.role === 'ADMIN' && ` · ${ROLE_LABELS.ADMIN}`}
          </span>
          <TextLink as="button" arrow={false} onClick={logout}>
            Log out
          </TextLink>
        </div>
        <button type="button" className="pf-nav__burger" aria-expanded={open} aria-controls="pf-nav-sheet" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {open ? (
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <div id="pf-nav-sheet" className="pf-nav__sheet">
          <ul>{items}</ul>
          <div className="pf-nav__sheet-user">
            <span className="pf-subtle">
              Signed in as {user.name} ({user.email})
            </span>
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
