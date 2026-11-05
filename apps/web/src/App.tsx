import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell, RequireAuth } from './app/AppShell';
import { AboutScreen } from './screens/AboutScreen';
import { AdminScreen } from './screens/AdminScreen';
import { AuthScreen } from './screens/AuthScreen';
import { CompareScreen } from './screens/CompareScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { WhatIfScreen } from './screens/WhatIfScreen';
import { ModelDetailScreen } from './screens/ModelDetailScreen';
import { ModelsScreen } from './screens/ModelsScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { AccountScreen, ForgotPasswordScreen, ResetPasswordScreen } from './screens/AccountScreens';
import { PortfolioEntryScreen, PortfolioScreen } from './screens/PortfolioScreen';
import { WorkloadScreen } from './screens/WorkloadScreen';
import { PlannerProvider } from './state/planner';
import { SessionProvider, useSession } from './state/session';

const TITLES: [RegExp, string][] = [
  [/^\/login/, 'Log in'],
  [/^\/register/, 'Create an account'],
  [/^\/dashboard/, 'Dashboard'],
  [/^\/notifications/, 'Notifications'],
  [/^\/portfolios\/\d+\/what-if/, 'What-if simulator'],
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
              {/* Public: the catalogue is market data, and the explanations are static. */}
              <Route path="/about" element={<AboutScreen />} />
              <Route path="/privacy" element={<PrivacyScreen />} />
              <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
              <Route path="/reset-password" element={<ResetPasswordScreen />} />
              <Route path="/models" element={<ModelsScreen />} />
              <Route path="/models/:id" element={<ModelDetailScreen />} />
              <Route path="/compare" element={<CompareScreen />} />
              <Route element={<RequireAuth />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardScreen />} />
                <Route path="/notifications" element={<NotificationsScreen />} />
                <Route path="/account" element={<AccountScreen />} />
                <Route path="/portfolios/:id/what-if" element={<WhatIfScreen />} />
                <Route path="/workload" element={<WorkloadScreen />} />
                <Route path="/portfolio" element={<PortfolioEntryScreen />} />
                <Route path="/recommendations/:id" element={<PortfolioScreen source="recommendation" />} />
                <Route path="/portfolios/:id" element={<PortfolioScreen source="portfolio" />} />
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
