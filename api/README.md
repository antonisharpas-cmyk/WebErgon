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

Point `api.ergonsite.com` at the service (Render > Settings > Custom
Domains, then a CNAME record at the DNS provider). The website's chat
bubble (`chat.js`) and the pages' Content-Security-Policy both use that
address.
