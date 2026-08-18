# Project Notes — ErgonSite

Context for anyone (human or AI) picking this project up.

## Outstanding issues — THE SITE IS NOW PUBLIC (GitHub Pages), so these are live incidents, not future risks

### 1. Hardcoded admin password in `server.js`

`server.js` sets a fallback default for the back-office login:

```js
const ADMIN_PASS = process.env.ADMIN_PASS || '<hardcoded-password>';   // see server.js line 70
```

This password is committed to git and lives in the repo history, so it is
readable by anyone with access to the repository — including after the line
is changed.

**Fix:** read the password from an environment variable only, with no
fallback, and refuse to start if it is missing. Then rotate the password,
since the old one must be treated as compromised.

### 2. Real contact submissions committed to git

`data/submissions.json` contains real names, email addresses, and messages
submitted through the contact form, and the file is tracked in git.

Personal data in a repository is a GDPR problem if the repo is public or
shared with third parties.

**Fix:** add `data/submissions.json` to `.gitignore`, remove it from
tracking (`git rm --cached`), and purge it from history if the repo has ever
been public.

## Local development

```
node server.js        # serves on http://localhost:3000 (falls back to 3001-3003)
```

- HTML / CSS / JS changes: hard-refresh the browser (Ctrl+F5).
- `server.js` changes: stop with Ctrl+C and restart — Node does not hot-reload.

## Status update — 2026-08-18

The site went live on GitHub Pages before the two issues above were
fixed, which turned both into real exposures:

- `data/submissions.json` (16 real enquiries) was publicly downloadable
  at ergonsite.com/data/submissions.json.
- The fallback admin password was in the public repo and its history.

What has been fixed in the code:

- `server.js` no longer has any fallback password. Admin endpoints are
  disabled unless `ADMIN_PASS` is set in the environment.
- `data/submissions.json` added to `.gitignore`.
- The contact form now posts to Web3Forms in production (GitHub Pages
  cannot run the Node backend) and to `/api/contact` locally. Needs a
  free access key pasted into `WEB3FORMS_ACCESS_KEY` in `script.js`.

What still needs a human:

1. `git rm --cached data/submissions.json && git commit && git push` —
   removes the file from the repo and from the live site.
2. Purge the repo history (both the submissions file and the old
   password live in past commits): either delete and recreate the
   GitHub repo from a clean copy, or use `git filter-repo`.
3. Treat the old password as burned. If it was reused anywhere else,
   change it there too.
4. Consider removing `admin.html` / `admin.js` / `server.js` from the
   published branch — harmless on Pages now, but they advertise the
   back office.

## EmailJS auto-confirmation template (paste into the EmailJS dashboard)

Template settings:
- To Email:   {{email}}
- From Name:  ErgonSite
- Reply To:   info@ergonsite.com
- Subject:    We received your enquiry — ErgonSite

Body:

Dear {{name}},

Thank you for getting in touch with ErgonSite. This is a confirmation
that we have received your enquiry, and a copy of your message is
included below for your records.

We will come back to you as soon as possible, within 24 hours.

Your message:
{{message}}

Best regards,

[PASTE THE ERGONSITE SIGNATURE HERE — the signature set in the mail
client does not apply to emails sent through EmailJS, so it has to
live in this template]

ErgonSite
info@ergonsite.com
https://ergonsite.com
