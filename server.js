const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORTS = process.env.PORT ? [Number(process.env.PORT)] : [3000, 3001, 3002, 3003];
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');
let portIndex = 0;

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

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'ronaldo7';
const AUTH_TOKEN = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

function isAuthenticated(req) {
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
          const submissions = readSubmissions();

          const record = {
            id: Date.now(),
            name: data.name || '',
            email: data.email || '',
            company: data.company || '',
            message: data.message || '',
            createdAt: new Date().toISOString()
          };

          submissions.push(record);
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

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = PORTS[portIndex + 1];
      if (nextPort) {
        portIndex += 1;
        console.log(`Port ${PORTS[portIndex - 1]} is busy. Trying ${nextPort}...`);
        startServer();
        return;
      }

      console.error('All requested ports are in use:', PORTS);
      process.exit(1);
    }

    throw error;
  });

  return server;
}

function startServer() {
  const port = PORTS[portIndex];
  const server = createServer();
  server.listen(port, () => {
    console.log(`ErgonSite backend running at http://localhost:${port}`);
  });
}

startServer();
