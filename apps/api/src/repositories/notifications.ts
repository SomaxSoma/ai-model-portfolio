import type { Queryable } from '../db.js';

export type NotificationKind = 'COST_CHANGE' | 'OVER_BUDGET' | 'MODEL_RETIRED' | 'MODEL_DEPRECATION' | 'INGESTION_FAILED' | 'DATA_QUALITY' | 'TEAM_INVITE';

export interface NewNotification {
  userId: number;
  kind: NotificationKind;
  severity: 'INFO' | 'WARNING';
  title: string;
  body: string;
  link?: string | null;
}

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  severity: 'INFO' | 'WARNING';
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export async function insertNotifications(db: Queryable, items: NewNotification[]): Promise<number> {
  for (const n of items) {
    await db.query(
      `INSERT INTO notification (user_id, kind, severity, title, body, link) VALUES ($1, $2, $3, $4, $5, $6)`,
      [n.userId, n.kind, n.severity, n.title, n.body, n.link ?? null],
    );
  }
  return items.length;
}

export async function listNotifications(db: Queryable, userId: number, limit: number, offset: number) {
  const [rows, counts] = await Promise.all([
    db.query(`SELECT * FROM notification WHERE user_id = $1 ORDER BY created_at DESC, notification_id DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]),
    db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notification WHERE user_id = $1`, [userId]),
  ]);
  const items: NotificationDto[] = rows.rows.map((r) => ({
    id: r.notification_id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.created_at.toISOString(),
    readAt: r.read_at ? r.read_at.toISOString() : null,
  }));
  return { items, total: counts.rows[0].total as number, unread: counts.rows[0].unread as number };
}

export async function markRead(db: Queryable, userId: number, id: number): Promise<boolean> {
  const r = await db.query(`UPDATE notification SET read_at = coalesce(read_at, now()) WHERE notification_id = $1 AND user_id = $2`, [id, userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function markAllRead(db: Queryable, userId: number): Promise<void> {
  await db.query(`UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
}

export async function adminIds(db: Queryable): Promise<number[]> {
  return (await db.query(`SELECT user_id FROM app_user WHERE role = 'ADMIN'`)).rows.map((r) => r.user_id);
}
