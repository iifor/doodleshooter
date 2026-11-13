import http from 'node:http';

const port = Number(process.env.PORT || 3000);
const turnKeyId = (process.env.CF_TURN_KEY_ID || '').trim();
const turnApiToken = (process.env.CF_TURN_API_TOKEN || '').trim();
const requestedTtl = Number.parseInt(process.env.CF_TURN_TTL_SECONDS || '3600', 10);
const ttl = Number.isInteger(requestedTtl) && requestedTtl >= 300 && requestedTtl <= 172800 ? requestedTtl : 3600;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const requestsByIp = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cfIp) return cfIp;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function withinRateLimit(ip) {
  const now = Date.now();
  let entry = requestsByIp.get(ip);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) entry = { start: now, count: 0 };
  entry.count++;
  requestsByIp.set(ip, entry);
  if (requestsByIp.size > 5000) {
    for (const [key, value] of requestsByIp) if (now - value.start >= RATE_WINDOW_MS) requestsByIp.delete(key);
  }
  return entry.count <= RATE_LIMIT;
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://turn-api').pathname;
  if (path !== '/api/turn-credentials') return sendJson(res, 404, { error: 'not_found' });
  if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return sendJson(res, 405, { error: 'method_not_allowed' }); }

  if (!withinRateLimit(clientIp(req))) return sendJson(res, 429, { error: 'rate_limited' });
  if (!turnKeyId || !turnApiToken) return sendJson(res, 503, { error: 'turn_not_configured' });

  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${turnApiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl }),
    });
    if (!response.ok) {
      console.error(`Cloudflare TURN credential request failed with HTTP ${response.status}`);
      return sendJson(res, 502, { error: 'turn_credentials_unavailable' });
    }
    const data = await response.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) {
      console.error('Cloudflare TURN credential response did not contain ICE servers');
      return sendJson(res, 502, { error: 'turn_credentials_unavailable' });
    }
    return sendJson(res, 200, { iceServers: data.iceServers, expiresAt: Date.now() + ttl * 1000 });
  } catch (err) {
    console.error(`Cloudflare TURN credential request failed: ${err && err.name || 'unknown error'}`);
    return sendJson(res, 502, { error: 'turn_credentials_unavailable' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`TURN credential API listening on ${port}`));
