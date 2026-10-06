import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell, RequireAuth } from './app/AppShell';
import { AboutScreen } from './screens/AboutScreen';
import { AdminScreen } from './screens/AdminScreen';
import { AuthScreen } from './screens/AuthScreen';
import { CompareScreen } from './screens/CompareScreen';
import { ModelDetailScreen } from './screens/ModelDetailScreen';
import { ModelsScreen } from './screens/ModelsScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { PortfolioEntryScreen, PortfolioScreen } from './screens/PortfolioScreen';
import { WorkloadScreen } from './screens/WorkloadScreen';
import { PlannerProvider } from './state/planner';
import { SessionProvider, useSession } from './state/session';

const TITLES: [RegExp, string][] = [
  [/^\/login/, 'Log in'],
  [/^\/register/, 'Create an account'],
  [/^\/models\/\d+/, 'Model details'],
  [/^\/models/, 'Model catalogue'],
  [/^\/compare/, 'Compare models'],
  [/^\/workload/, 'Define workload'],
  [/^\/(portfolio|recommendations|portfolios)/, 'Portfolio'],
  [/^\/admin/, 'Admin console'],
  [/^\/about/, 'How it works'],
];

function RouteEffects() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = t ? `${t} · Model Portfolio` : 'Model Portfolio';
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

/** Comparison set and drafts belong to one account: reset them when the user changes. */
function UserScopedPlanner({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return <PlannerProvider key={user?.id ?? 'signed-out'}>{children}</PlannerProvider>;
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <UserScopedPlanner>
          <RouteEffects />
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/login" element={<AuthScreen mode="login" />} />
              <Route path="/register" element={<AuthScreen mode="register" />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Navigate to="/models" replace />} />
                <Route path="/models" element={<ModelsScreen />} />
                <Route path="/models/:id" element={<ModelDetailScreen />} />
                <Route path="/compare" element={<CompareScreen />} />
                <Route path="/workload" element={<WorkloadScreen />} />
                <Route path="/portfolio" element={<PortfolioEntryScreen />} />
                <Route path="/recommendations/:id" element={<PortfolioScreen source="recommendation" />} />
                <Route path="/portfolios/:id" element={<PortfolioScreen source="portfolio" />} />
                <Route path="/about" element={<AboutScreen />} />
                <Route element={<RequireAuth admin />}>
                  <Route path="/admin" element={<AdminScreen />} />
                </Route>
                <Route path="*" element={<NotFoundScreen />} />
              </Route>
            </Route>
          </Routes>
        </UserScopedPlanner>
      </SessionProvider>
    </BrowserRouter>
  );
}
