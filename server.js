const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORTS = process.env.PORT ? [Number(process.env.PORT)] : [3000, 3001, 3002, 3003];
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');
let portIndex = 0;

function ensureDataFile() {
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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

function createServer() {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readSubmissions()));
      return;
    }

    if (req.method === 'DELETE') {
      const match = requestUrl.pathname.match(/^\/api\/submissions\/(\d+)$/);
      if (match) {
        const targetId = Number(match[1]);
        const submissions = readSubmissions();
        const filtered = submissions.filter(item => Number(item.id) !== targetId);
        writeSubmissions(filtered);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, deletedId: targetId }));
        return;
      }
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
    console.log(`WebErgon backend running at http://localhost:${port}`);
  });
}

startServer();
