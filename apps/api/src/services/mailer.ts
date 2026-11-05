import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

/**
 * Outgoing email, through whichever transport is configured:
 *  - SMTP (Nodemailer): Gmail with GMAIL_USER + GMAIL_APP_PASSWORD (an App
 *    Password, needs 2-step verification; ~500 messages/day), or any provider
 *    via SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS. Port 465 uses implicit TLS.
 *  - Resend's HTTP API: RESEND_API_KEY + MAIL_FROM.
 * SMTP wins when both are set. With neither, features that need email
 * (password reset, alert digests) are switched off, and in development the
 * message is written to the log instead so the flow can still be tried.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export const mailEnabled = (): boolean => !!((config.mail.smtp || config.mail.resendApiKey) && config.mail.from);

let transport: Transporter | null = null;
function smtp(): Transporter {
  const s = config.mail.smtp!;
  transport ??= nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.port === 465,
    auth: { user: s.user, pass: s.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

/** Sends one email. Returns true when it was accepted for delivery. Never throws. */
export async function sendMail(mail: Mail, log: (msg: string) => void = console.log): Promise<boolean> {
  if (!mailEnabled()) {
    if (process.env.NODE_ENV !== 'production') log(`[mail disabled] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`);
    return false;
  }
  try {
    if (config.mail.smtp) {
      await smtp().sendMail({ from: config.mail.from, to: mail.to, subject: mail.subject, text: mail.text });
      return true;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.mail.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.mail.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`mail to ${mail.to} rejected: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    // Never log credentials; the transport error message doesn't include them.
    log(`mail to ${mail.to} failed: ${(err as Error).message}`);
    return false;
  }
}
