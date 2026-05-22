/**
 * Cherry Proxy — Railway/Node.js fallback
 *
 * GET /proxy?url=https://target-site.com/path
 * GET /proxy?url=https://target-site.com/path&key=YOUR_SECRET
 *
 * Deploy to Railway: connect GitHub repo, set PORT and PROXY_KEY env vars.
 * Railway stays warm (no cold starts) within the free $5/month credit.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.PROXY_KEY || '';
const TIMEOUT_MS = 15000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
};

function sendError(res, status, message) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
  res.end(message);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed');

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const targetUrl = reqUrl.searchParams.get('url');

  if (!targetUrl) return sendError(res, 400, 'Missing ?url= parameter');

  if (SECRET_KEY && reqUrl.searchParams.get('key') !== SECRET_KEY) {
    return sendError(res, 403, 'Forbidden');
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) throw new Error();
  } catch {
    return sendError(res, 400, 'Invalid target URL');
  }

  const driver = parsedTarget.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsedTarget.hostname,
    port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
    path: parsedTarget.pathname + parsedTarget.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1',
      'Accept': '*/*',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
    timeout: TIMEOUT_MS,
  };

  const proxyReq = driver.request(options, (proxyRes) => {
    const responseHeaders = { ...CORS_HEADERS };
    if (proxyRes.headers['content-type'])   responseHeaders['Content-Type']   = proxyRes.headers['content-type'];
    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    sendError(res, 504, 'Upstream timeout');
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) sendError(res, 502, 'Upstream error: ' + err.message);
  });

  proxyReq.end();
});

server.listen(PORT, () => {
  console.log(`cherry-proxy listening on port ${PORT}`);
});
