# Project Notes — ErgonSite

Context for anyone (human or AI) picking this project up.

## Outstanding issues — fix before this site goes public

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
