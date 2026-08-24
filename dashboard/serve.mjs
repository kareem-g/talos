/**
 * Production server: serves the built dashboard AND proxies /api + /ws
 * to the backend on port 9120. Run with: node serve.mjs
 */
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 9120;
const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

function isApiOrWs(req) {
  return req.url.startsWith('/api/') || req.url === '/api' || req.url.startsWith('/ws');
}

const server = http.createServer((req, res) => {
  if (isApiOrWs(req)) {
    // Proxy to backend
    const opts = {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('proxy error:', err.message);
      res.writeHead(502);
      res.end('Backend offline');
    });
    req.pipe(proxyReq);
    return;
  }

  // Serve static files
  let filePath = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

// WebSocket upgrade proxy
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return;

  const backendSocket = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
    // Forward the upgrade request
    const rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n';
    backendSocket.write(rawReq);
    if (head.length > 0) backendSocket.write(head);

    socket.pipe(backendSocket);
    backendSocket.pipe(socket);
  });

  backendSocket.on('error', (err) => {
    console.error('ws proxy error:', err.message);
    socket.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AgentDeck dashboard → http://localhost:${PORT}`);
  console.log(`  API/WS proxy → ${BACKEND_HOST}:${BACKEND_PORT}\n`);
});
