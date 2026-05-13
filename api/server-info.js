// api/server-info.js — Vercel serverless function
// Returns deployment context info. On local dev, server.js serves this same
// endpoint with real LAN IPs so OscillatorPanel can show the phone URL.
// On Vercel there are no LAN IPs; phone sensors require running server.js locally
// OR an external WebSocket relay URL set via the WS_RELAY_URL environment variable.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).json({
    port: null,
    ips: [],
    vercel: true,
    wsRelayUrl: process.env.WS_RELAY_URL || null,
  });
}
