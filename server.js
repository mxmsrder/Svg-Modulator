#!/usr/bin/env node
// server.js — Static file server + WebSocket bridge for iPhone sensor data
//
// LOCAL dev (default):  node server.js          → HTTPS on port 3443
// Cloud relay mode:     PLAIN_HTTP=true node server.js  → plain HTTP on $PORT
//   Deploy to Railway/Render and set PLAIN_HTTP=true — they terminate TLS at
//   the load balancer. Set WS_RELAY_URL=wss://your-relay.railway.app/ws in
//   your Vercel project env so phone.html and the editor connect to this relay.

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');

// ── Mode detection ────────────────────────────────────────────────────────────
// PLAIN_HTTP=true  → cloud relay mode (Railway/Render handle TLS)
// Otherwise        → local HTTPS mode with self-signed cert

const CLOUD = process.env.PLAIN_HTTP === 'true';
const PORT  = parseInt(process.env.PORT || process.argv[2] || (CLOUD ? '3000' : '3443'), 10);
const ROOT  = __dirname;

// ── Self-signed TLS certificate (local mode only) ─────────────────────────────

function ensureCert() {
  const certPath = path.join(ROOT, 'cert.pem');
  const keyPath  = path.join(ROOT, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath))
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  console.log('Generating self-signed certificate (first run)…');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 825 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe' }
    );
    console.log('Certificate generated: cert.pem + key.pem');
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  } catch {
    console.error('openssl not found. Install openssl or provide cert.pem + key.pem manually.');
    process.exit(1);
  }
}

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
  '.png':  'image/png',
  '.osc':  'application/json',
  '.ico':  'image/x-icon',
};

// ── HTTP request handler ──────────────────────────────────────────────────────

function onRequest(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // CORS headers so phone.html served from Vercel can fetch this server's endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (urlPath === '/api/server-info') {
    const ifaces = require('os').networkInterfaces();
    const ips = Object.values(ifaces).flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ port: PORT, ips, cloud: CLOUD }));
    return;
  }

  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + urlPath);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = CLOUD
  ? http.createServer(onRequest)
  : https.createServer(ensureCert(), onRequest);

// ── WebSocket bridge ──────────────────────────────────────────────────────────
// Phones connect with role='phone', editors connect with role='editor'.
// All data from phones is broadcast to all editors.

const wss = new WebSocketServer({ server, path: '/ws' });
const editors = new Set();
const phones  = new Set();

wss.on('connection', (ws) => {
  let role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (role === null) {
      if (msg.role === 'phone') {
        role = 'phone';
        phones.add(ws);
        console.log(`Phone connected (${phones.size} active)`);
        broadcast(editors, JSON.stringify({ type: 'phone-status', connected: phones.size }));
      } else {
        role = 'editor';
        editors.add(ws);
        ws.send(JSON.stringify({ type: 'phone-status', connected: phones.size }));
      }
      return;
    }

    if (role === 'phone') broadcast(editors, raw.toString());
  });

  ws.on('close', () => {
    if (role === 'phone') {
      phones.delete(ws);
      console.log(`Phone disconnected (${phones.size} remaining)`);
      broadcast(editors, JSON.stringify({ type: 'phone-status', connected: phones.size }));
    } else {
      editors.delete(ws);
    }
  });

  ws.on('error', () => {});
});

function broadcast(set, data) {
  for (const ws of set) {
    try { if (ws.readyState === 1) ws.send(data); } catch {}
  }
}

server.listen(PORT, '0.0.0.0', () => {
  if (CLOUD) {
    console.log(`\n=== SVG Oscillator Relay (cloud mode) — port ${PORT} ===`);
    console.log('WebSocket endpoint: ws://0.0.0.0:' + PORT + '/ws');
    console.log('Set WS_RELAY_URL=wss://<your-domain>/ws in Vercel env vars.\n');
    return;
  }

  const ips = Object.values(require('os').networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log('\n=== SVG Oscillator Editor — HTTPS Server ===');
  console.log(`\nEditor: https://localhost:${PORT}`);
  if (ips.length) {
    console.log('\nPhone sensor page (open in Safari on iPhone):');
    for (const ip of ips) console.log(`  https://${ip}:${PORT}/phone.html`);
  }
  console.log('\nNote: Accept the self-signed certificate warning in your browser.');
  console.log('On iPhone: trust the cert via Settings → General → About → Certificate Trust.\n');
});

// HTTP→HTTPS redirect (local mode only; cloud proxy handles this)
if (!CLOUD) {
  http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
    res.end();
  }).listen(8080, () => console.log('HTTP redirect: http://localhost:8080 → HTTPS'));
}

process.on('SIGINT',  () => { console.log('\nShutting down…'); process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
