const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');

/* Both ports are served at once, from one process and one set of
   handlers, so http://<ip>:3000 and http://<ip>:8080 are the same site
   — API included. 8080 is here because that is the URL already in use
   around the office; if a static file server is squatting on it, that
   port is skipped with a warning rather than taking the whole server
   down with it.

   PORT=xxxx overrides the pair with a single port. */
const PORTS = process.env.PORT ? [Number(process.env.PORT)] : [3000, 8080];

// only used if every port above is occupied
const FALLBACK_PORTS = [3001, 3002, 3003];
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

// Mirrors the client-side rule: a real domain, at least one dot, and an
// alphabetic TLD of two characters or more.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }
}

function readSubmissions() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeSubmissions(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'text/plain; charset=utf-8';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

/* No fallback password, deliberately. The old hardcoded default sat in
   a public GitHub repo, which means it is compromised and must never
   come back. With ADMIN_PASS unset, the admin endpoints are switched
   off entirely — the contact form still works, so day-to-day local
   development needs no setup. To use the back office:

     PowerShell:  $env:ADMIN_USER='you'; $env:ADMIN_PASS='<new secret>'; node server.js
     bash:        ADMIN_USER=you ADMIN_PASS=<new secret> node server.js  */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || null;
const ADMIN_ENABLED = Boolean(ADMIN_PASS);
const AUTH_TOKEN = ADMIN_ENABLED
  ? Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')
  : null;

function adminDisabled(res) {
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    success: false,
    message: 'Admin is disabled: start the server with the ADMIN_PASS environment variable set.'
  }));
}

function isAuthenticated(req) {
  if (!ADMIN_ENABLED) return false;
  const authHeader = req.headers['authorization'];
  if (!authHeader) return false;
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (authHeader.startsWith('Basic ')) {
    token = authHeader.slice(6);
  } else {
    token = authHeader;
  }
  return token === AUTH_TOKEN;
}

function createServer() {
  const server = http.createServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && requestUrl.pathname === '/api/login') {
      if (!ADMIN_ENABLED) { adminDisabled(res); return; }

      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (data.username === ADMIN_USER && data.password === ADMIN_PASS) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, token: AUTH_TOKEN, username: ADMIN_USER }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, message: 'Invalid username or password.' }));
          }
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: 'Invalid request body.' }));
        }
      });

      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/contact') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');

          // The browser validates too, but that is a convenience for the
          // visitor. This is the check that actually counts — anything can
          // POST to this endpoint.
          const name = String(data.name || '').trim();
          const email = String(data.email || '').trim();
          const company = String(data.company || '').trim();
          const phone = String(data.phone || '').trim();
          const message = String(data.message || '').trim();

          const problems = [];
          if (!name) problems.push('name');
          if (!company) problems.push('company');
          if (message.length < 10) problems.push('project details');
          if (!EMAIL_RE.test(email) || email.length > 254) problems.push('email');
          if (phone && !/^\+?[0-9\s().-]{6,24}$/.test(phone)) problems.push('phone');

          if (problems.length) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: false,
              message: 'Please check these fields: ' + problems.join(', ') + '.'
            }));
            return;
          }

          if (name.length > 120 || company.length > 160 || message.length > 5000) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, message: 'One of the fields is too long.' }));
            return;
          }

          const submissions = readSubmissions();

          submissions.push({
            id: Date.now(),
            name: name,
            email: email,
            company: company,
            phone: phone,
            message: message,
            createdAt: new Date().toISOString()
          });

          writeSubmissions(submissions);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, message: 'Submission saved successfully.' }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: 'Invalid request body.' }));
        }
      });

      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/submissions') {
      if (!isAuthenticated(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Unauthorized. Credentials required.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readSubmissions()));
      return;
    }

    if (req.method === 'DELETE') {
      const match = requestUrl.pathname.match(/^\/api\/submissions\/(\d+)$/);
      if (match) {
        if (!isAuthenticated(req)) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: 'Unauthorized. Credentials required.' }));
          return;
        }

        const targetId = Number(match[1]);
        const submissions = readSubmissions();
        const filtered = submissions.filter(item => Number(item.id) !== targetId);
        writeSubmissions(filtered);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, deletedId: targetId }));
        return;
      }
    }

    // Catch unmatched /api/ requests with a proper JSON 404 error
    if (requestUrl.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'API endpoint not found.' }));
      return;
    }

    let filePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\//, '');
    if (filePath === 'team.html') {
      filePath = 'team.html';
    }

    if (filePath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const resolvedPath = path.join(__dirname, filePath);

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      serveStaticFile(res, resolvedPath);
      return;
    }

    const defaultFile = path.join(__dirname, 'index.html');
    serveStaticFile(res, defaultFile);
  });

  return server;
}

/* Open the site in the default browser once the port is actually bound.

   The point is to stop anyone reaching for VS Code Live Server (or any
   other static server) out of habit: those serve the HTML happily but
   have no /api/contact, so the enquiry form fails with a 405. Landing
   on the right origin automatically is the cheapest way to prevent it.

   Set NO_OPEN=1 to skip — useful on a real server, or when nodemon is
   restarting this file every few seconds. */
function openBrowser(url) {
  if (process.env.NO_OPEN) return;

  const command =
    process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;

  // Windows needs the shell for `start`, which is a cmd builtin, not a
  // program. A failure here is not worth crashing the server over — the
  // URL is printed above either way.
  exec(command, { windowsHide: true }, (error) => {
    if (error) console.log('Could not open a browser automatically. Open the URL above.');
  });
}

/* Bind one port. Resolves with the server, or with null if something
   else already owns that port — a busy port is a thing to report, not
   a reason to refuse to start. */
function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${port} is already in use — skipping it.`);
        resolve(null);
        return;
      }
      reject(error);
    });

    server.listen(port, '0.0.0.0', () => resolve(port));
  });
}

async function startServer() {
  const live = [];

  for (const port of PORTS) {
    const bound = await listenOn(port);
    if (bound) live.push(bound);
  }

  // nothing wanted was free — fall back so there is at least one URL
  if (!live.length && !process.env.PORT) {
    for (const port of FALLBACK_PORTS) {
      const bound = await listenOn(port);
      if (bound) { live.push(bound); break; }
    }
  }

  if (!live.length) {
    console.error('Could not bind any port. Tried:', PORTS.concat(FALLBACK_PORTS).join(', '));
    process.exit(1);
  }

  const ipAddress = Object.values(require('os').networkInterfaces())
    .flat()
    .find(iface => iface.family === 'IPv4' && !iface.internal)?.address || 'localhost';

  console.log('ErgonSite is running. Every URL below serves the site AND the API:');
  live.forEach((port) => {
    console.log(`  http://localhost:${port}`);
    console.log(`  http://${ipAddress}:${port}   (other devices on this network)`);
  });

  openBrowser(`http://localhost:${live[0]}`);
}

startServer();
