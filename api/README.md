# ErgonSite API

Live chat, enquiries and the team console for ergonsite.com. The website
stays on GitHub Pages; this folder is the only part that runs on Render.

## Run it locally

```bash
cd api
npm install
ADMIN_EMAIL=you@ergonsite.com ADMIN_PASSWORD='a-long-password' ADMIN_NAME=You node server.mjs
```

Console: http://localhost:4000/admin/ . With no SMTP settings, emails are
printed in the terminal instead of sent. Data is kept in `api/data/`
(ignored by git, it holds personal data).

## Render

`render.yaml` in the repository root describes the service (Starter plan,
Frankfurt, a 1 GB disk at /var/data). Type the secrets into the Render
dashboard: SMTP_PASS (a Google app password for info@ergonsite.com),
ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME. The first owner account is
created from those on the first start; add the rest of the team from the
console's Team page.

The service is reachable at https://webergon.onrender.com (console:
/admin/). The website's chat bubble (`chat.js`), the contact form copy
(`script.js`) and the pages' Content-Security-Policy all use that address.
If you later give it a custom domain such as api.ergonsite.com, change it
in those three places and in PUBLIC_URL.

The existing Render service starts `node server.js` from the repository
root; on Render that file hands over to `api/server.mjs`, so no build or
start command needs changing.

## Chat behaviour

- Every visitor gets an automatic first reply, and every answer is signed "ErgonSite Team".
- The first message of a new or reopened chat is emailed to NOTIFY_EMAIL at once;
  follow-ups within 30 seconds are sent as one email.
- After the team replies, a chat with no answer from the visitor for
  CHAT_IDLE_MINUTES (default 10) is closed with a short message, and the visitor
  is emailed the conversation with a link that reopens it (#chat=ID.KEY on the
  website). "Chatted with us before?" in the bubble emails the same kind of link.
- MAIL_LOG_BODY=1 prints whole emails in the terminal when SMTP is not set
  (local testing only).
