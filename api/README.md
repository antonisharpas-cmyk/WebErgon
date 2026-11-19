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

## Expenses (owners only)

The console's **Expenses** section keeps what ErgonSite pays for, month by month, with totals in euro.

- **Recurring costs** (Google Workspace, the domain, ...): set the price, how often it repeats and the first charge date. A new price applies from a chosen month on; earlier months keep the old one. One month can be changed or skipped on its own. **Stop** ends it from a month on and keeps the history; **Delete completely** removes it.
- **Reminders**: "Remind me N days before" shows the renewal under *Coming up*, puts an orange count on the Expenses menu item and emails the team once, N days before each renewal (to the address under Settings, or `NOTIFY_EMAIL`).
- **One-off expenses**: anything paid once.
- **Render hosting**: in Render, *Billing*, download the usage CSV for each month and use *Import Render CSV*. The current month's "unbilled charges" file is an estimate: import it again to update it, and import the final file once the month is billed. Each Render service is linked to a client, so hosting cost per client shows up.
- **Currencies**: amounts stay in their own currency (EUR, USD, ...). Rates come from the European Central Bank every day, or can be typed in by hand under Settings. Each month keeps the rates it was converted with.
- **More**: download a month or a year as CSV (for the accountant), download a backup, or restore one.

The data lives in the same data file as the chats (`expenses` key), on the Render disk.

## Clients (owners only)

The console's **Clients** section keeps every client's contact details, charges and payments, their domain's expiry, and the logins to their admin page.

- **Charges**: Website, CRM or Other (one-off, can be paid in parts), **Maintenance** (a yearly fee with start and end) and **Domain** (the client's own domain in their own registrar account; they pay the registrar, we only remind them). Record payments as they come in; the status (Pending, Partly paid, Paid, Unpaid after the due date) follows.
- **Emails to approve**: every day the console prepares renewal notices (30 days before a maintenance year or a domain ends) and payment reminders (on the due date, then every 14 days while unpaid). Nothing is sent to a client until an owner presses **Send**; the team gets one email when new drafts are waiting. Sending a maintenance renewal also opens next year's charge.
- **Profit & costs**: per client and per year, money received against the costs tagged with that client in Expenses (Render hosting and so on), and ErgonSite's own costs.
- **Logins**: link, username and password for each client's admin page. Passwords are encrypted with `VAULT_KEY` (set it once in Render's Environment as a long random text and never change it). Only owners can show or copy them; the console notes who opened one last.

## Reports (owners only)

The console's **Reports** section puts money in (payments recorded in Clients) against costs (everything in Expenses, in euro) for any period: this month, last month, the last 3 months, this year, last year, or any from-to range. Filter by one client (or ErgonSite's own costs) and by cost category. It shows the totals, a month-by-month chart and table, profit per client, costs per category, every line behind the numbers, and a CSV download with the same filters for the accountant.
