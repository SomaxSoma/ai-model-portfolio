import { Alert, Badge, Button, Card, TextLink } from '@pf/design-system';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { LoadError, Loading, PageHead, PfInput } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatDate, plural } from '../format';
import { useSession } from '../state/session';
import type { Team, TeamInvite } from '../types';

interface TeamsPayload {
  teams: Team[];
  invites: TeamInvite[];
}

const errorText = (err: unknown) => (err instanceof ApiError ? (Object.values(err.errors)[0] ?? err.message) : 'Something went wrong. Please try again.');

function TeamCard({ team, meId, onChange, onGone }: { team: Team; meId: number; onChange: (t: Team) => void; onGone: () => void }) {
  const owner = team.role === 'OWNER';
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const invite = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      onChange(await api<Team>(`/teams/${team.id}/invites`, { method: 'POST', body: { email: email.trim() } }));
      setEmail('');
    });
  };

  return (
    <Card padding="lg" className="pf-stack">
      <div className="pf-section-head">
        <div className="pf-stack pf-stack--none">
          <h2 className="pf-card-title">{team.name}</h2>
          <span className="pf-subtle pf-small">
            {plural(team.members.length, 'member')} · {plural(team.portfolioCount, 'shared portfolio')}
          </span>
        </div>
        <Badge variant="status" tone={owner ? 'positive' : 'neutral'}>
          {owner ? 'Owner' : 'Member'}
        </Badge>
      </div>

      <ul className="pf-team-members pf-list-reset">
        {team.members.map((m) => (
          <li key={m.userId}>
            <span className="pf-avatar" aria-hidden="true">
              {m.name
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="pf-stack pf-stack--none" style={{ minWidth: 0 }}>
              <span className="pf-strong">
                {m.name}
                {m.userId === meId && ' (you)'}
              </span>
              <span className="pf-subtle pf-small">{m.email}</span>
            </span>
            <span className="pf-row" style={{ gap: 'var(--sp-3)', marginLeft: 'auto' }}>
              <span className="pf-subtle pf-small">{m.role === 'OWNER' ? 'Owner' : 'Member'}</span>
              {owner && m.userId !== meId && (
                <>
                  <TextLink
                    as="button"
                    arrow={false}
                    disabled={busy}
                    onClick={() => void run(async () => onChange(await api<Team>(`/teams/${team.id}/members/${m.userId}`, { method: 'PATCH', body: { role: m.role === 'OWNER' ? 'MEMBER' : 'OWNER' } })))}
                  >
                    {m.role === 'OWNER' ? 'Make member' : 'Make owner'}
                  </TextLink>
                  <TextLink
                    as="button"
                    arrow={false}
                    variant="muted"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/teams/${team.id}/members/${m.userId}`, { method: 'DELETE' });
                        onChange({ ...team, members: team.members.filter((x) => x.userId !== m.userId) });
                      })
                    }
                  >
                    Remove
                  </TextLink>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {owner && team.invites.length > 0 && (
        <div className="pf-stack pf-stack--sm">
          <span className="pf-field__label">Invitations waiting</span>
          <ul className="pf-list-reset pf-stack pf-stack--sm">
            {team.invites.map((i) => (
              <li key={i.id} className="pf-row pf-row--between">
                <span>
                  {i.email} <span className="pf-subtle pf-small">· sent {formatDate(i.createdAt)}</span>
                </span>
                <TextLink
                  as="button"
                  arrow={false}
                  variant="muted"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/teams/${team.id}/invites/${i.id}`, { method: 'DELETE' });
                      onChange({ ...team, invites: team.invites.filter((x) => x.id !== i.id) });
                    })
                  }
                >
                  Cancel
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {owner && (
        <form className="pf-row" style={{ alignItems: 'flex-end' }} onSubmit={invite} noValidate>
          <PfInput label="Invite by email" type="email" inputMode="email" value={email} onChange={(v) => (setEmail(v), setError(''))} hint="They join after signing in with this address." />
          <Button type="submit" variant="ghost" disabled={busy || !email.includes('@')}>
            Send invitation
          </Button>
        </form>
      )}
      {error && (
        <p className="pf-field__error" role="alert">
          {error}
        </p>
      )}

      <div className="pf-row">
        <TextLink as={Link} to="/portfolio?saved" arrow={false}>
          Shared portfolios
        </TextLink>
        <TextLink
          as="button"
          arrow={false}
          variant="muted"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api(`/teams/${team.id}/members/${meId}`, { method: 'DELETE' });
              onGone();
            })
          }
        >
          Leave team
        </TextLink>
        {owner && (
          <TextLink
            as="button"
            arrow={false}
            variant="muted"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete “${team.name}”? Its portfolios go back to the people who made them.`)) return;
              void run(async () => {
                await api(`/teams/${team.id}`, { method: 'DELETE' });
                onGone();
              });
            }}
          >
            Delete team
          </TextLink>
        )}
      </div>
    </Card>
  );
}

/** /teams — workspaces for planning together. */
export function TeamsScreen() {
  const { user } = useSession();
  const { data, error, loading, reload, setData } = useApi<TeamsPayload>('/teams');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (loading && !data) return <Loading what="Loading your teams" />;
  if (!data || !user) return null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const t = await api<Team>('/teams', { method: 'POST', body: { name: name.trim() } });
      setData({ ...data, teams: [...data.teams, t] });
      setName('');
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const answer = async (inviteId: number, a: 'accept' | 'decline') => {
    try {
      setData(await api<TeamsPayload>(`/invites/${inviteId}/${a}`, { method: 'POST' }));
    } catch (err) {
      setFormError(errorText(err));
    }
  };

  return (
    <div className="pf-stack pf-stack--lg">
      <PageHead title="Teams" subtitle="Plan together: share a portfolio with a team, and everyone in it can open, adjust and stress-test it — and hears about price changes that affect it." />

      {data.invites.map((i) => (
        <Alert key={i.id} variant="info" title={`Invitation to ${i.teamName}`}>
          <div className="pf-row">
            <span>{i.invitedBy ? `${i.invitedBy} invited you.` : 'You’ve been invited.'}</span>
            <Button size="sm" variant="primary" onClick={() => void answer(i.id, 'accept')} disabled={user.isDemo}>
              Join
            </Button>
            <TextLink as="button" arrow={false} variant="muted" onClick={() => void answer(i.id, 'decline')}>
              Decline
            </TextLink>
          </div>
        </Alert>
      ))}

      {data.teams.length === 0 && (
        <Card tint padding="lg" className="pf-empty">
          <h2>No teams yet</h2>
          <p className="pf-subtle">Start one and invite colleagues by email. Your portfolios stay private until you share one with a team.</p>
        </Card>
      )}
      <div className="pf-team-grid">
        {data.teams.map((t) => (
          <TeamCard
            key={t.id}
            team={t}
            meId={user.id}
            onChange={(next) => setData({ ...data, teams: data.teams.map((x) => (x.id === next.id ? next : x)) })}
            onGone={() => setData({ ...data, teams: data.teams.filter((x) => x.id !== t.id) })}
          />
        ))}
      </div>

      <Card tint padding="lg">
        <form className="pf-stack" onSubmit={create} noValidate>
          <h2 className="pf-card-title">Start a team</h2>
          {user.isDemo ? (
            <p className="pf-subtle">
              Demo accounts can’t start teams. <Link to="/register">Create a free account</Link> to plan with colleagues.
            </p>
          ) : (
            <div className="pf-row" style={{ alignItems: 'flex-end' }}>
              <PfInput label="Team name" value={name} onChange={(v) => (setName(v), setFormError(''))} placeholder="e.g. Platform team" />
              <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>
                {busy ? 'Creating…' : 'Create team'}
              </Button>
            </div>
          )}
          {formError && (
            <p className="pf-field__error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
