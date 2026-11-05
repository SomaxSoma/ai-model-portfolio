import { Alert, Button, Card, TextLink } from '@pf/design-system';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { PageHead, PfInput } from '../app/controls';
import { useApi } from '../app/useApi';
import { useSession } from '../state/session';
import type { AuthOptions, User } from '../types';

/** Clears one field's error as the user edits it. */
function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clear = (key: string) => setErrors((p) => (key in p ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : p));
  return { errors, setErrors, clear };
}

// ---------------------------------------------------------------------------
// /forgot-password
// ---------------------------------------------------------------------------
export function ForgotPasswordScreen() {
  const options = useApi<AuthOptions>('/auth/options');
  const [email, setEmail] = useState('');
  const { errors, setErrors, clear } = useFieldErrors();
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!email.includes('@')) return setErrors({ email: 'Enter a valid email address.' });
    setBusy(true);
    try {
      const r = await api<{ message: string }>('/auth/forgot', { method: 'POST', body: { email: email.trim() } });
      setDone(r.message);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(err.errors);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-narrow">
      <Card padding="lg" className="pf-stack">
        <div className="pf-stack pf-stack--sm">
          <h1 className="pf-h2">Reset your password</h1>
          <p className="pf-subtle">We’ll email you a link to choose a new one.</p>
        </div>
        {options.data && !options.data.passwordReset ? (
          <Alert variant="info" title="Not available on this site yet">
            Password reset needs email, which hasn’t been set up here. Ask the site’s administrator for help, or sign in with Google or GitHub if your account uses one.
          </Alert>
        ) : done ? (
          <Alert variant="success">{done}</Alert>
        ) : (
          <form className="pf-stack" onSubmit={submit} noValidate>
            <PfInput
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(v) => {
                setEmail(v);
                clear('email');
              }}
              error={errors.email}
            />
            {formError && <p className="pf-field__error">{formError}</p>}
            <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </Button>
          </form>
        )}
        <TextLink as={Link} to="/login" arrow={false}>
          Back to log in
        </TextLink>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /reset-password?token=…
// ---------------------------------------------------------------------------
export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { adopt } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { errors, setErrors, clear } = useFieldErrors();
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const next: Record<string, string> = {};
    if (password.length < 8) next.password = 'Use at least 8 characters for your password.';
    if (confirm !== password) next.confirm = 'The two passwords don’t match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const r = await api<{ user: User; token: string }>('/auth/reset', { method: 'POST', body: { token, password } });
      await adopt(r.token, r.user);
      navigate('/dashboard', { replace: true, state: { notice: 'Password changed. You’ve been signed out everywhere else.' } });
    } catch (err) {
      if (err instanceof ApiError && err.errors.token) setFormError(err.errors.token);
      else if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(err.errors);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-narrow">
      <Card padding="lg" className="pf-stack">
        <h1 className="pf-h2">Choose a new password</h1>
        {!token ? (
          <Alert variant="danger">This link is incomplete. Open the link from the email again, or ask for a new one.</Alert>
        ) : (
          <form className="pf-stack" onSubmit={submit} noValidate>
            <PfInput label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." value={password} onChange={(v) => (setPassword(v), clear('password'))} error={errors.password} />
            <PfInput label="Repeat the new password" type="password" autoComplete="new-password" value={confirm} onChange={(v) => (setConfirm(v), clear('confirm'))} error={errors.confirm} />
            {formError && (
              <p className="pf-field__error" role="alert">
                {formError} <Link to="/forgot-password">Ask for a new link</Link>
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /account
// ---------------------------------------------------------------------------
export function AccountScreen() {
  const { user, setUser, logout } = useSession();
  const options = useApi<AuthOptions>('/auth/options');
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const { errors, setErrors, clear } = useFieldErrors();
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login?next=%2Faccount" replace />;

  const patch = async (body: Partial<Pick<User, 'name' | 'emailAlerts'>>, message: string) => {
    setBusy(true);
    setNotice('');
    try {
      setUser(await api<User>('/me', { method: 'PATCH', body }));
      setNotice(message);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.errors);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api('/me', { method: 'DELETE', body: user.hasPassword ? { password } : {} });
      logout();
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.keys(err.errors).length ? err.errors : { account: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-stack pf-stack--lg" style={{ maxWidth: 720 }}>
      <PageHead title="Your account" subtitle={user.email} />
      {user.isDemo && (
        <Alert variant="info" title="This is a demo account">
          It’s removed automatically within a day, with everything in it. <Link to="/register">Create a free account</Link> to keep your work.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <Card padding="lg" className="pf-stack">
        <h2 className="pf-card-title">Profile</h2>
        <form
          className="pf-row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ name }, 'Name saved.');
          }}
        >
          <PfInput label="Name" value={name} onChange={(v) => (setName(v), clear('name'))} error={errors.name} autoComplete="name" />
          <Button type="submit" variant="ghost" disabled={busy || name.trim() === user.name}>
            Save name
          </Button>
        </form>
      </Card>

      <Card padding="lg" className="pf-stack">
        <h2 className="pf-card-title">Email alerts</h2>
        <p className="pf-subtle">A digest of new alerts — price changes, budget breaks and retirements in your portfolios — sent to {user.email}.</p>
        {options.data && !options.data.emailAlerts ? (
          <p className="pf-subtle pf-small">Email isn’t set up on this site yet, so alerts appear in the app only.</p>
        ) : (
          <label className="pf-check">
            <input type="checkbox" checked={user.emailAlerts} disabled={busy || user.isDemo} onChange={(e) => void patch({ emailAlerts: e.target.checked }, e.target.checked ? 'Email alerts on.' : 'Email alerts off.')} />
            <span>Email me a digest of new alerts</span>
          </label>
        )}
        {errors.emailAlerts && <span className="pf-field__error">{errors.emailAlerts}</span>}
      </Card>

      <Card padding="lg" className="pf-stack">
        <h2 className="pf-card-title">Delete account</h2>
        <p className="pf-subtle">Deletes your account and everything in it — workloads, recommendations, portfolios, alerts and feedback. This can’t be undone. <Link to="/privacy">What we store</Link></p>
        {!confirmDelete ? (
          <span>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete my account…
            </Button>
          </span>
        ) : (
          <form
            className="pf-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            {user.hasPassword && <PfInput label="Your password, to confirm" type="password" autoComplete="current-password" value={password} onChange={(v) => (setPassword(v), clear('password'))} error={errors.password} />}
            {errors.account && <p className="pf-field__error">{errors.account}</p>}
            <div className="pf-row">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Deleting…' : 'Delete everything permanently'}
              </Button>
              <TextLink as="button" arrow={false} onClick={() => setConfirmDelete(false)}>
                Cancel
              </TextLink>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
