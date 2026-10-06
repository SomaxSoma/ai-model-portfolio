import { Button, Card, TextLink } from '@pf/design-system';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api';
import { PfInput } from '../app/controls';
import { useSession } from '../state/session';

/**
 * Login / register. Role comes from the account on the server — there is no
 * role choice here (the prototype's demo role switch is intentionally gone).
 */
export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/models';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
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
    <div className="pf-auth">
      <Card className="pf-auth__card" padding="lg">
        <form className="pf-stack" onSubmit={submit} noValidate>
          <div className="pf-stack pf-stack--sm">
            <h1>{isRegister ? 'Create your account' : 'Log in'}</h1>
            <p className="pf-subtle">{isRegister ? 'Compare models and build a portfolio that fits your budget.' : 'Welcome back. Pick up where you left off.'}</p>
          </div>
          {isRegister && <PfInput label="Name" value={name} onChange={setName} error={errors.name} autoComplete="name" />}
          <PfInput label="Email" type="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" />
          <PfInput
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
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
            <TextLink as={Link} to={isRegister ? '/login' : '/register'} state={location.state} arrow={false}>
              {isRegister ? 'Log in' : 'Create an account'}
            </TextLink>
          </p>
        </form>
      </Card>
    </div>
  );
}
