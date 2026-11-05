import { Button, Card, TextLink } from '@pf/design-system';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api';
import { PfInput } from '../app/controls';
import { WorkflowShowcase } from '../app/Workflow';
import { DotWave, Scene3D } from '../three';
import { useSession } from '../state/session';

/**
 * Login / register. Role comes from the account on the server — there is no
 * role choice here (the prototype's demo role switch is intentionally gone).
 */
/** Only same-site paths: never an absolute or protocol-relative URL (open redirect). */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login') || raw.startsWith('/register')) return null;
  return raw;
}

const isRegisterMode = (mode: 'login' | 'register') => mode === 'register';

export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useSession();
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
          {formError && (
            <p className="pf-field__error" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
            {busy ? (isRegister ? 'Creating account…' : 'Logging in…') : isRegister ? 'Create account' : 'Log in'}
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
