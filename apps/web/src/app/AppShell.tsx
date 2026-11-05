import { Footer } from '@pf/design-system';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from '../state/session';
import { AppNav } from './AppNav';
import { Loading } from './controls';

const FOOTER_COLUMNS = [
  {
    title: 'Analysis',
    links: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Model catalogue', href: '/models' },
      { label: 'Compare models', href: '/compare' },
      { label: 'Define a workload', href: '/workload' },
    ],
  },
  {
    title: 'Data',
    links: [
      { label: 'How costs are calculated', href: '/about#costs' },
      { label: 'How models are scored', href: '/about#scores' },
      { label: 'Data sources', href: '/about#data' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'How recommendations work', href: '/about#recommendations' },
      { label: 'Getting started', href: '/about#start' },
    ],
  },
];

export function AppShell() {
  return (
    <div className="pf-shell">
      {/* HUD frame: two rails at the content edges and a faint column grid (decorative). */}
      <div className="pf-rails" aria-hidden="true" />
      <div className="pf-grid-bg" aria-hidden="true" />
      <a className="pf-skip" href="#main">
        Skip to content
      </a>
      <AppNav />
      <main id="main" className="pf-main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer
        brand="Model Portfolio"
        tagline="Compare AI models on price, benchmarks and capabilities, then build a portfolio that fits your monthly budget."
        columns={FOOTER_COLUMNS}
        legal="Live data: prices, context, capabilities and uptime from the OpenRouter public API; coding and intelligence indices by Artificial Analysis (via OpenRouter), refreshed on a schedule. Not affiliated with either."
        renderLink={(l) => <Link to={l.href}>{l.label}</Link>}
      />
    </div>
  );
}

/** Client-side gate for navigation only. The API enforces access on every request. */
export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading what="Checking your session" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/models" replace />;
  return <Outlet />;
}
