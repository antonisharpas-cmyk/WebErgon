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
- **One-off expenses**: anything paid once. **+ Instagram ad** adds an ad campaign with the post it promoted, when it ran and what it cost; edit it any time the cost changes.
- **Render hosting**: in Render, *Billing*, download the usage CSV for each month and use *Import Render CSV*. The current month's "unbilled charges" file is an estimate: import it again to update it, and import the final file once the month is billed. Each Render service is linked to a client, so hosting cost per client shows up.
- **Currencies**: amounts stay in their own currency (EUR, USD, ...). Rates come from the European Central Bank every day, or can be typed in by hand under Settings. Each month keeps the rates it was converted with.
- **More**: download a month or a year as CSV (for the accountant), download a backup, or restore one.

The data lives in the same data file as the chats (`expenses` key), on the Render disk.

## Dashboard (owners only)

The first screen for owners. It lists what is **unpaid** (late ones highlighted), **domains expiring** (marked *Client pays* or *We pay*) and **maintenance renewals** coming up (highlighted 30 days before), **our own renewals** from Expenses, and **things to check** (a domain with no expiry date, a client with no email, a charge with no due date), with the month's and the year's money at the top. The orange number on the menu counts late payments and renewals due soon. Next to each item, **Write email** / **Remind client** opens your own mail program with a suggested text to change and send yourself: the console never emails a client. The only automatic email is to us, for domains ErgonSite pays.

## Clients (owners only)

Every client as a card, with a search box. A client's page has the contact details, charges, payments and logins.

- **Domain** (its own card on the client's page): the domain, when it expires, who pays the registrar, and the reminder. **The client pays** from their own registrar account: the dashboard lists it under *Domains expiring* and **Remind client** writes them an email in your mail program. **ErgonSite pays**: enter what it costs us (it goes into Expenses and Reports under that client, in the month we paid) and, if we charge the client back, how much; the dashboard lists it as *We pay* and info@ergonsite.com gets an email to renew it. After a renewal, **Mark renewed** sets the new expiry date.
- **Charges**: Website, CRM or Other (one-off, can be paid in parts) and **Maintenance** (a yearly fee with start and end; **Renew** opens the next year).
- **Settings**: how many days before a renewal the dashboard highlights it, and the wording used in the suggested emails.
- **Logins**: link, username and password for each client's admin page. Passwords are encrypted with `VAULT_KEY` (set once in Render's Environment as a long random text; never change it). Only owners can show or copy them; the console notes who opened one last.

## Reports (owners only)

The console's **Reports** section puts money in (payments recorded in Clients) against costs (everything in Expenses, in euro) for any period: this month, last month, the last 3 months, this year, last year, or any from-to range. Filter by one client (or ErgonSite's own costs) and by cost category. It shows the totals, a month-by-month chart and table, profit per client, costs per category, every line behind the numbers, and a CSV download with the same filters for the accountant.
