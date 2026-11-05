import { Button, Card, TextLink } from '@pf/design-system';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { useApi } from '../app/useApi';
import type { AuthOptions, User } from '../types';
import { PfInput } from '../app/controls';
import { WorkflowShowcase } from '../app/Workflow';
import { DotWave, Scene3D } from '../three';
import { useSession } from '../state/session';

/**
 * Login / register. Role comes from the account on the server — there is no
 * role choice here (the prototype's demo role switch is intentionally gone).
 */
/** Google's "G" in its brand colours (decorative: the button text names the provider). */
function GoogleLogo() {
  return (
    <svg className="pf-sso__logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The GitHub mark, in the text colour (decorative). */
function GitHubLogo() {
  return (
    <svg className="pf-sso__logo" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
      />
    </svg>
  );
}

/** Only same-site paths: never an absolute or protocol-relative URL (open redirect). */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login') || raw.startsWith('/register')) return null;
  return raw;
}

const isRegisterMode = (mode: 'login' | 'register') => mode === 'register';

export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, adopt } = useSession();
  const options = useApi<AuthOptions>('/auth/options');
  const navigate = useNavigate();
  const location = useLocation();
  // Where to go after signing in: ?next= survives reloads and the login/register switch.
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  const from = next ?? '/dashboard';
  const switchTo = `${isRegisterMode(mode) ? '/login' : '/register'}${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Typing in a field clears its error (and any form-level message).
  const field = (key: string, setter: (v: string) => void) => (v: string) => {
    setter(v);
    setFormError('');
    setErrors((prev) => (key in prev ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)) : prev));
  };
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  // Back from Google/GitHub: the token (or an error) arrives in the URL fragment, never in server logs.
  useEffect(() => {
    if (!location.hash) return;
    const h = new URLSearchParams(location.hash.slice(1));
    const token = h.get('token');
    const error = h.get('error');
    window.history.replaceState(null, '', location.pathname + location.search);
    if (token) void adopt(token).then(() => navigate(safeNext(h.get('next')) ?? '/dashboard', { replace: true }));
    else if (error) setFormError(error);
  }, [location.hash, location.pathname, location.search, adopt, navigate]);

  const tryDemo = async () => {
    setBusy(true);
    setFormError('');
    try {
      const r = await api<{ user: User; token: string }>('/auth/demo', { method: 'POST' });
      await adopt(r.token, r.user);
      navigate(next ?? '/dashboard', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Couldn’t start the demo. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const providers = options.data?.providers ?? [];

  if (user) return <Navigate to={from} replace />;

  const isRegister = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Convenience mirror of the server's checks.
    const next: Record<string, string> = {};
    if (isRegister && name.trim().length < 2) next.name = 'Your name needs at least 2 characters.';
    if (!email.includes('@')) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Enter your password.';
    else if (isRegister && password.length < 8) next.password = 'Use at least 8 characters for your password.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      if (isRegister) await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors);
        setFormError(Object.keys(err.errors).length ? '' : err.message);
      } else setFormError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="pf-auth">
      <section className="pf-auth__hero" aria-label="About Model Portfolio">
        <Scene3D className="pf-hero__wave" fallback={null}>
          <DotWave />
        </Scene3D>
        <span className="pf-live">Live catalogue · OpenRouter</span>
        <h1 className="pf-hero__title">
          Every model. <span className="pf-gradient-text">One budget.</span>
        </h1>
        <p className="pf-hero__lead">Compare AI models on live prices, benchmark indices, uptime and lifecycle — then split each workload across the mix that fits your monthly budget, with the trade-offs explained.</p>
        <div className="pf-auth__points">
          <div className="pf-auth__point">
            <strong>Exact costs</strong>
            <span className="pf-subtle pf-small">One decimal-exact cost function everywhere.</span>
          </div>
          <div className="pf-auth__point">
            <strong>Risk-aware</strong>
            <span className="pf-subtle pf-small">Provider concentration and retirements flagged.</span>
          </div>
          <div className="pf-auth__point">
            <strong>What-if ready</strong>
            <span className="pf-subtle pf-small">Simulate price rises and outages before they bite.</span>
          </div>
        </div>
      </section>
      <Card className="pf-auth__card" padding="lg">
        <form className="pf-stack" onSubmit={submit} noValidate>
          <div className="pf-stack pf-stack--sm">
            <h2>{isRegister ? 'Create your account' : 'Log in'}</h2>
            <p className="pf-subtle">{isRegister ? 'Compare models and build a portfolio that fits your budget.' : 'Welcome back. Pick up where you left off.'}</p>
          </div>
          {isRegister && <PfInput label="Name" value={name} onChange={field('name', setName)} error={errors.name} autoComplete="name" />}
          <PfInput label="Email" type="email" inputMode="email" value={email} onChange={field('email', setEmail)} error={errors.email} autoComplete="email" />
          <PfInput
            label="Password"
            type="password"
            value={password}
            onChange={field('password', setPassword)}
            error={errors.password}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            hint={isRegister ? 'At least 8 characters.' : undefined}
          />
          {!isRegister && options.data?.passwordReset && (
            <span className="pf-small" style={{ marginTop: 'calc(var(--sp-2) * -1)' }}>
              <Link to="/forgot-password">Forgot your password?</Link>
            </span>
          )}
          {formError && (
            <p className="pf-field__error" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
            {busy ? (isRegister ? 'Creating account…' : 'Logging in…') : isRegister ? 'Create account' : 'Log in'}
          </Button>
          {providers.length > 0 && (
            <div className="pf-stack pf-stack--sm">
              <span className="pf-or" aria-hidden="true">
                or
              </span>
              {providers.map((p) => (
                <a key={p} className="pf-sso" href={`/api/auth/oauth/${p}/start${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
                  {p === 'google' ? <GoogleLogo /> : <GitHubLogo />}
                  <span>Continue with {p === 'google' ? 'Google' : 'GitHub'}</span>
                </a>
              ))}
            </div>
          )}
          <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={() => void tryDemo()}>
            Try the demo — no sign-up
          </Button>
          <p className="pf-subtle">
            {isRegister ? 'Already have an account? ' : 'New here? '}
            <TextLink as={Link} to={switchTo} arrow={false}>
              {isRegister ? 'Log in' : 'Create an account'}
            </TextLink>
          </p>
        </form>
      </Card>
    </div>
    <div className="pf-seam" aria-hidden="true" />
    <WorkflowShowcase />
    </>
  );
}
