/* =====================================================================
   Outgoing email through info@ergonsite.com's own mailbox (SMTP).

   With the SMTP_* variables unset, nothing is sent and each email is
   printed to the log instead, so the server runs locally with no setup.
   ===================================================================== */
import nodemailer from 'nodemailer';

export function makeMailer(env) {
  const from = env.MAIL_FROM || (env.SMTP_USER ? `ErgonSite <${env.SMTP_USER}>` : 'ErgonSite <info@ergonsite.com>');

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP is not configured: emails will be logged, not sent.');
    return {
      enabled: false,
      async send(msg) {
        console.log('[mail:not-sent]', JSON.stringify({ to: msg.to, subject: msg.subject }));
        if (env.MAIL_LOG_BODY === '1') console.log(msg.text);   // local testing only
        return { logged: true };
      }
    };
  }

  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });

  return {
    enabled: true,
    async send(msg) {
      return transport.sendMail({ from, ...msg });
    }
  };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/* One plain, readable layout for every email we send. */
export function layout(title, bodyHtml, footer) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1b3a9e">ErgonSite</td></tr>
<tr><td style="padding-top:10px;font-size:22px;font-weight:700;letter-spacing:-.02em">${esc(title)}</td></tr>
<tr><td style="padding-top:16px;font-size:15px;line-height:1.6;color:#424245">${bodyHtml}</td></tr>
${footer ? `<tr><td style="padding-top:22px;font-size:12.5px;line-height:1.5;color:#6e6e73;border-top:1px solid #e8e8ed">${footer}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

export function textToHtml(text) {
  return esc(text).replace(/\n/g, '<br>');
}
