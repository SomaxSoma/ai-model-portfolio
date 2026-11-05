import { config } from '../config.js';
import type { Db } from '../db.js';
import { purgeDemoUsers } from '../repositories/users.js';
import { mailEnabled, sendMail } from './mailer.js';

const MAX_ITEMS = 20;

/**
 * One email per opted-in user listing their unread alerts that haven't been
 * emailed yet. Runs from the scheduler (after any transaction that created the
 * alerts has committed), so a rolled-back change never produces an email.
 * Notifications are marked emailed only when the send succeeds.
 */
export async function sendAlertDigests(db: Db, log: (msg: string) => void = () => {}): Promise<number> {
  if (!mailEnabled()) return 0;
  const r = await db.query(
    `SELECT u.user_id, u.email, u.name,
            json_agg(json_build_object('id', n.notification_id, 'title', n.title, 'body', n.body, 'link', n.link) ORDER BY n.created_at DESC) AS items
       FROM notification n JOIN app_user u ON u.user_id = n.user_id
      WHERE u.email_alerts AND NOT u.is_demo AND n.emailed_at IS NULL AND n.read_at IS NULL
      GROUP BY u.user_id`,
  );
  let sent = 0;
  for (const row of r.rows as { user_id: number; email: string; name: string; items: { id: number; title: string; body: string; link: string | null }[] }[]) {
    const shown = row.items.slice(0, MAX_ITEMS);
    const lines = shown.map((i) => `• ${i.title}\n  ${i.body}${i.link ? `\n  ${config.appUrl}${i.link}` : ''}`).join('\n\n');
    const more = row.items.length > shown.length ? `\n\n…and ${row.items.length - shown.length} more.` : '';
    const ok = await sendMail(
      {
        to: row.email,
        subject: `${row.items.length} new ${row.items.length === 1 ? 'alert' : 'alerts'} on Model Portfolio`,
        text: `Hi ${row.name},\n\n${lines}${more}\n\nSee them all: ${config.appUrl}/notifications\nTurn these emails off in your account settings: ${config.appUrl}/account\n`,
      },
      log,
    );
    if (ok) {
      await db.query(`UPDATE notification SET emailed_at = now() WHERE notification_id = ANY($1::bigint[])`, [row.items.map((i) => i.id)]);
      sent++;
    }
  }
  if (sent) log(`alert digests sent: ${sent}`);
  return sent;
}

/** Daily housekeeping: disposable demo accounts past their lifetime. */
export async function housekeeping(db: Db, log: (msg: string) => void = () => {}): Promise<{ demoAccountsRemoved: number }> {
  const demoAccountsRemoved = await purgeDemoUsers(db, config.demoTtlHours);
  if (demoAccountsRemoved) log(`demo accounts removed: ${demoAccountsRemoved}`);
  return { demoAccountsRemoved };
}
