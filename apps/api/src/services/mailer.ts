import { config } from '../config.js';

/**
 * Outgoing email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Enabled only when RESEND_API_KEY and MAIL_FROM are set; otherwise features
 * that need email (password reset, alert digests) are switched off, and in
 * development the message is written to the log instead so the flow can be tried.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const mailEnabled = (): boolean => !!(config.mail.resendApiKey && config.mail.from);

/** Sends one email. Returns true when it was accepted for delivery. Never throws. */
export async function sendMail(mail: Mail, log: (msg: string) => void = console.log): Promise<boolean> {
  if (!mailEnabled()) {
    if (process.env.NODE_ENV !== 'production') log(`[mail disabled] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.mail.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`mail to ${mail.to} rejected: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    log(`mail to ${mail.to} failed: ${(err as Error).message}`);
    return false;
  }
}
