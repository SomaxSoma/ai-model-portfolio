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
import { TeamsScreen } from './screens/TeamsScreen';
import { AccountScreen, ForgotPasswordScreen, ResetPasswordScreen } from './screens/AccountScreens';
import { PortfolioEntryScreen, PortfolioScreen } from './screens/PortfolioScreen';
import { WorkloadScreen } from './screens/WorkloadScreen';
import { PlannerProvider } from './state/planner';
import { LANDING_TITLE, pageTitle } from './format';
import { SessionProvider, useSession } from './state/session';

const TITLES: [RegExp, string | null][] = [
  [/^\/login/, null], // the landing page
  [/^\/register/, 'Sign up'],
  [/^\/forgot-password/, 'Reset password'],
  [/^\/reset-password/, 'Choose a new password'],
  [/^\/dashboard/, 'Dashboard'],
  [/^\/notifications/, 'Notifications'],
  [/^\/portfolios\/\d+\/what-if/, 'What-if simulator'],
  [/^\/models\/\d+/, 'Model details'], // replaced by the model's name once it loads
  [/^\/models/, 'AI model pricing & benchmarks'],
  [/^\/compare/, 'Compare AI models'],
  [/^\/workload/, 'New workload'],
  [/^\/(portfolio|recommendations|portfolios)/, 'Portfolios'],
  [/^\/teams/, 'Teams'],
  [/^\/account/, 'Account settings'],
  [/^\/admin/, 'Admin'],
  [/^\/about/, 'How it works'],
  [/^\/privacy/, 'Privacy & data'],
];

function RouteEffects() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const match = TITLES.find(([re]) => re.test(pathname));
    document.title = match ? (match[1] ? pageTitle(match[1]) : LANDING_TITLE) : pathname === '/' ? LANDING_TITLE : pageTitle('Page not found');
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

/** "/": visitors see the landing page; signed-in users go straight to their dashboard. */
function Home() {
  const { user, loading } = useSession();
  if (loading) return null;
  return user ? <Navigate to="/dashboard" replace /> : <AuthScreen mode="login" />;
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
              {/* The landing page lives at the root address; /login stays for links and redirects. */}
              <Route index element={<Home />} />
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
                <Route path="/dashboard" element={<DashboardScreen />} />
                <Route path="/notifications" element={<NotificationsScreen />} />
                <Route path="/account" element={<AccountScreen />} />
                <Route path="/teams" element={<TeamsScreen />} />
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
