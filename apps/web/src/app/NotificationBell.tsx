import { TextLink } from '@pf/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import type { NotificationItem, NotificationPage } from '../types';

const POLL_MS = 60_000;

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function NotificationRow({ n, onOpen }: { n: NotificationItem; onOpen: (n: NotificationItem) => void }) {
  const cls = `pf-note${n.readAt ? '' : ' pf-note--unread'}${n.severity === 'WARNING' ? ' pf-note--warning' : ''}`;
  const body = (
    <>
      <span className="pf-note__dot" aria-hidden="true" />
      <span className="pf-stack pf-stack--none">
        <span className="pf-note__title">
          {!n.readAt && <span className="ds-visually-hidden">Unread: </span>}
          {n.title}
        </span>
        <span className="pf-note__body">{n.body}</span>
        <span className="pf-note__time">{relativeTime(n.createdAt)}</span>
      </span>
    </>
  );
  return n.link ? (
    <Link to={n.link} className={cls} onClick={() => onOpen(n)}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => onOpen(n)}>
      {body}
    </button>
  );
}

/** Bell with unread count; polls every minute and on navigation. */
export function NotificationBell() {
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api<NotificationPage>('/notifications?limit=6').then(setPage).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    setOpen(false);
    load();
  }, [location.pathname, load]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (n: NotificationItem) => {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    load();
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load();
  };

  const unread = page?.unread ?? 0;
  return (
    <div className="pf-bell" ref={wrap}>
      <button type="button" className="pf-bell__button" aria-expanded={open} aria-haspopup="dialog" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="pf-bell__badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="pf-bell__panel" role="dialog" aria-label="Notifications">
          <div className="pf-bell__head">
            <span className="pf-strong">Notifications</span>
            {unread > 0 && (
              <TextLink as="button" arrow={false} onClick={readAll}>
                Mark all read
              </TextLink>
            )}
          </div>
          {page && page.items.length === 0 ? (
            <p className="pf-subtle" style={{ padding: 'var(--sp-3)' }}>
              You’re all caught up. We’ll tell you when a price change or retirement affects one of your portfolios.
            </p>
          ) : (
            <ul className="pf-notes">
              {page?.items.map((n) => (
                <li key={n.id}>
                  <NotificationRow n={n} onOpen={markRead} />
                </li>
              ))}
            </ul>
          )}
          <div className="pf-bell__head">
            <TextLink as="button" onClick={() => navigate('/notifications')}>
              View all
            </TextLink>
          </div>
        </div>
      )}
    </div>
  );
}
