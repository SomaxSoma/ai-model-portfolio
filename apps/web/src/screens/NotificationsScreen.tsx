import { Button, Card, TextLink } from '@pf/design-system';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { LoadError, Loading, PageHead } from '../app/controls';
import { NotificationRow } from '../app/NotificationBell';
import type { NotificationItem, NotificationPage } from '../types';

const PAGE = 20;

export function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await api<NotificationPage>(`/notifications?limit=${PAGE}&offset=${offset}`);
      setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
      setTotal(page.total);
      setUnread(page.unread);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'Couldn’t load notifications.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  const open = async (n: NotificationItem) => {
    if (n.readAt) return;
    await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    void load(0);
  };

  return (
    <>
      <PageHead
        overline={<span className="pf-eyebrow">Alerts</span>}
        title="Notifications"
        subtitle="Price changes, budget breaches and retirements that affect your portfolios — and, for admins, ingestion and data-quality problems."
        actions={
          unread > 0 && (
            <TextLink as="button" arrow={false} onClick={readAll}>
              Mark all {unread} as read
            </TextLink>
          )
        }
      />
      {error && <LoadError error={error} onRetry={() => load(0)} />}
      <Card padding="sm">
        {loading && items.length === 0 ? (
          <Loading what="Loading notifications" />
        ) : items.length === 0 ? (
          <p className="pf-subtle" style={{ padding: 'var(--sp-4)' }}>
            Nothing yet. When a catalogue change affects one of your saved portfolios, you’ll see it here.
          </p>
        ) : (
          <ul className="pf-notes">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationRow n={n} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {items.length < total && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Button variant="ghost" onClick={() => load(items.length)} disabled={loading}>
            {loading ? 'Loading…' : `Show more (${total - items.length})`}
          </Button>
        </div>
      )}
    </>
  );
}
