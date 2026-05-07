#!/usr/bin/env node
// server.js — HTTPS static file server + WebSocket bridge for iPhone sensor data
// Usage:  node server.js [port]
// Default port: 3443

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || '3443', 10);
const ROOT = __dirname;

// ── Self-signed TLS certificate ───────────────────────────────────────────────
// Auto-generates cert.pem + key.pem on first run using openssl (must be installed)

function ensureCert() {
  const certPath = path.join(ROOT, 'cert.pem');
  const keyPath  = path.join(ROOT, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  console.log('Generating self-signed certificate (first run)…');
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 825 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe' }
    );
    console.log('Certificate generated: cert.pem + key.pem');
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  } catch (e) {
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

  // API: return LAN IPs so the editor can display the correct phone URL
  if (urlPath === '/api/server-info') {
    const ifaces = require('os').networkInterfaces();
    const ips = Object.values(ifaces).flat()
      .filter(i => i.family === 'IPv4' && !i.internal)
      .map(i => i.address);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ port: PORT, ips }));
    return;
  }

  const filePath = path.join(ROOT, urlPath);
  // Prevent directory traversal
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
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ── Start servers ─────────────────────────────────────────────────────────────

const tls = ensureCert();

const server = https.createServer(tls, onRequest);

// ── WebSocket bridge ──────────────────────────────────────────────────────────
// Phones connect with role='phone', editors connect with role='editor'
// All data from phones is broadcast to all editors

const wss = new WebSocketServer({ server, path: '/ws' });
const editors = new Set();
const phones  = new Set();
let phoneCount = 0;

wss.on('connection', (ws) => {
  let role = 'editor';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.role === 'phone') {
      if (!phones.has(ws)) {
        phones.add(ws);
        editors.delete(ws);
        phoneCount++;
        console.log(`Phone connected (${phoneCount} active)`);
        // Tell all editors a phone is now connected
        broadcast(editors, JSON.stringify({ type: 'phone-status', connected: phones.size }));
      }
      // Forward sensor payload to all editors
      broadcast(editors, raw.toString());
    } else {
      if (!editors.has(ws)) {
        editors.add(ws);
        phones.delete(ws);
        // Tell editor current phone count
        ws.send(JSON.stringify({ type: 'phone-status', connected: phones.size }));
      }
    }
  });

  ws.on('close', () => {
    if (phones.has(ws)) {
      phones.delete(ws);
      console.log(`Phone disconnected (${phones.size} remaining)`);
      broadcast(editors, JSON.stringify({ type: 'phone-status', connected: phones.size }));
    }
    editors.delete(ws);
  });

  ws.on('error', () => {});
});

function broadcast(set, data) {
  for (const ws of set) {
    try { if (ws.readyState === 1) ws.send(data); } catch {}
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = require('os').networkInterfaces();
  const ips = Object.values(interfaces).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  console.log('\n=== SVG Oscillator Editor — HTTPS Server ===');
  console.log(`\nEditor: https://localhost:${PORT}`);
  if (ips.length) {
    console.log(`\nPhone sensor page (open in Safari on iPhone):`);
    for (const ip of ips) {
      console.log(`  https://${ip}:${PORT}/phone.html`);
    }
  }
  console.log('\nNote: Accept the self-signed certificate warning in your browser.');
  console.log('On iPhone: Settings → Safari → Advanced → allow insecure certs (or trust the cert in Settings → General → About → Certificate Trust).\n');
});

// Also start a plain HTTP server on 8080 that redirects to HTTPS
const redir = http.createServer((req, res) => {
  const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
  res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
  res.end();
});
redir.listen(8080, () => console.log('HTTP redirect: http://localhost:8080 → HTTPS'));

process.on('SIGINT',  () => { console.log('\nShutting down…'); process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
