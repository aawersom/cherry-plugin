'use strict';

/**
 * Cherry Proxy VPS — rotating residential proxy server
 *
 * Same interface as CF Worker: GET /proxy?url=...&key=...&referer=...
 * Routes through rotating Dutch HTTPS proxies (CONNECT tunnel for HTTPS targets).
 * On failure: tries next proxy; on success: starts from that proxy next time.
 *
 * Deploy on Beget VPS:
 *   node index.js
 *   PORT=3000 PROXY_KEY=1206 node index.js
 *
 * Set up as systemd service or use pm2.
 */

const http  = require('http');
const https = require('https');
const net   = require('net');
const tls   = require('tls');
const { URL } = require('url');

const PORT       = process.env.PORT       || 3000;
const PROXY_KEY  = process.env.PROXY_KEY  || '1206';
const TIMEOUT_MS = 20000;

// ---- Rotating residential proxies (HTTPS CONNECT / SOCKS5) ----
const PROXIES = [
  { host: '45.91.209.155', port: 11750, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11751, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11752, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11753, user: 'hgTr0m', pass: '6H3nY1' },
  { host: '45.91.209.155', port: 11756, user: 'hgTr0m', pass: '6H3nY1' },
];

let proxyIdx = 0; // current best proxy index; rotates on failure

// ---- CORS headers ----
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
};

// ----------------------------------------------------------------
// Fetch targetUrl through an HTTP CONNECT tunnel proxy.
// Returns { statusCode, headers, body } or throws on error.
// ----------------------------------------------------------------
function fetchViaProxy(targetUrl, referer, proxy) {
  return new Promise(function (resolve, reject) {
    var parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error('Bad target URL')); }

    var isHttps   = parsed.protocol === 'https:';
    var tgtPort   = parseInt(parsed.port) || (isHttps ? 443 : 80);
    var proxyAuth = Buffer.from(proxy.user + ':' + proxy.pass).toString('base64');

    function abort(err) { reject(err instanceof Error ? err : new Error(String(err))); }

    if (isHttps) {
      // ---- CONNECT tunnel ----
      var connectOpts = {
        hostname: proxy.host,
        port:     proxy.port,
        method:   'CONNECT',
        path:     parsed.hostname + ':' + tgtPort,
        headers:  {
          'Host':               parsed.hostname + ':' + tgtPort,
          'Proxy-Authorization': 'Basic ' + proxyAuth,
          'Proxy-Connection':   'Keep-Alive',
        },
      };

      var connectReq = http.request(connectOpts);
      connectReq.setTimeout(TIMEOUT_MS, function () { connectReq.destroy(new Error('CONNECT timeout')); });
      connectReq.on('error', abort);

      connectReq.on('connect', function (connectRes, socket) {
        if (connectRes.statusCode !== 200) {
          socket.destroy();
          return abort(new Error('CONNECT ' + connectRes.statusCode));
        }

        var tlsSock = tls.connect({ socket: socket, servername: parsed.hostname, rejectUnauthorized: false });
        tlsSock.setTimeout(TIMEOUT_MS, function () { tlsSock.destroy(new Error('TLS timeout')); });
        tlsSock.on('error', abort);

        tlsSock.on('secureConnect', function () {
          var reqPath = parsed.pathname + parsed.search;
          tlsSock.write(
            'GET ' + reqPath + ' HTTP/1.1\r\n' +
            'Host: ' + parsed.hostname + '\r\n' +
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n' +
            'Accept: */*\r\n' +
            'Accept-Language: ru,en;q=0.9\r\n' +
            (referer ? 'Referer: ' + referer + '\r\n' : '') +
            'Connection: close\r\n' +
            '\r\n'
          );

          var chunks = [];
          tlsSock.on('data', function (c) { chunks.push(c); });
          tlsSock.on('end', function () {
            var raw = Buffer.concat(chunks);
            parseRawHttp(raw, resolve, abort);
          });
        });
      });

      connectReq.end();

    } else {
      // ---- Plain HTTP through proxy ----
      var reqOpts = {
        hostname: proxy.host,
        port:     proxy.port,
        method:   'GET',
        path:     targetUrl,        // full URL as path for proxy
        headers:  {
          'Host':               parsed.hostname,
          'Proxy-Authorization': 'Basic ' + proxyAuth,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          ...(referer ? { 'Referer': referer } : {}),
        },
        timeout: TIMEOUT_MS,
      };

      var req = http.request(reqOpts, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', abort);
      });
      req.on('timeout', function () { req.destroy(new Error('HTTP proxy timeout')); });
      req.on('error', abort);
      req.end();
    }
  });
}

// ----------------------------------------------------------------
// Parse a raw HTTP/1.1 response buffer into { statusCode, headers, body }
// ----------------------------------------------------------------
function parseRawHttp(raw, resolve, reject) {
  var sep = raw.indexOf('\r\n\r\n');
  if (sep === -1) return reject(new Error('No HTTP header separator'));

  var headerBlock = raw.slice(0, sep).toString('utf8');
  var body        = raw.slice(sep + 4);

  var lines = headerBlock.split('\r\n');
  var statusLine = lines[0];
  var statusCode = parseInt((statusLine.match(/HTTP\/[\d.]+ (\d+)/) || [])[1]) || 0;

  if (!statusCode) return reject(new Error('Cannot parse status: ' + statusLine));

  var headers = {};
  for (var i = 1; i < lines.length; i++) {
    var col = lines[i].indexOf(':');
    if (col > 0) headers[lines[i].slice(0, col).trim().toLowerCase()] = lines[i].slice(col + 1).trim();
  }

  // Handle chunked body
  if (headers['transfer-encoding'] === 'chunked') {
    body = unchunk(body);
  }

  resolve({ statusCode: statusCode, headers: headers, body: body });
}

// ---- minimal chunked-transfer decoder ----
function unchunk(buf) {
  var out = [];
  var pos = 0;
  while (pos < buf.length) {
    var crlf = buf.indexOf('\r\n', pos);
    if (crlf === -1) break;
    var size = parseInt(buf.slice(pos, crlf).toString(), 16);
    if (isNaN(size) || size === 0) break;
    out.push(buf.slice(crlf + 2, crlf + 2 + size));
    pos = crlf + 2 + size + 2;
  }
  return Buffer.concat(out);
}

// ----------------------------------------------------------------
// Rotation: try proxies starting from proxyIdx; advance on failure
// ----------------------------------------------------------------
async function fetchWithRotation(targetUrl, referer) {
  var lastError;
  for (var i = 0; i < PROXIES.length; i++) {
    var tryIdx = (proxyIdx + i) % PROXIES.length;
    var proxy  = PROXIES[tryIdx];
    try {
      var result = await fetchViaProxy(targetUrl, referer, proxy);
      if (result.statusCode >= 200 && result.statusCode < 500) {
        proxyIdx = tryIdx; // remember working proxy for next request
        return result;
      }
      throw new Error('HTTP ' + result.statusCode);
    } catch (e) {
      lastError = e;
      console.warn('[cherry-proxy-vps] proxy #' + tryIdx + ' (port ' + proxy.port + ') failed:', e.message);
    }
  }
  // all failed — advance index anyway so we start fresh next time
  proxyIdx = (proxyIdx + 1) % PROXIES.length;
  throw lastError || new Error('All proxies failed');
}

// ----------------------------------------------------------------
// HTTP server
// ----------------------------------------------------------------
function sendError(res, status, msg) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
  res.end(msg);
}

var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'GET')     return sendError(res, 405, 'Method not allowed');

  var reqUrl    = new URL(req.url, 'http://localhost:' + PORT);
  var targetUrl = reqUrl.searchParams.get('url');
  var referer   = reqUrl.searchParams.get('referer') || '';
  var key       = reqUrl.searchParams.get('key') || '';

  if (PROXY_KEY && key !== PROXY_KEY) return sendError(res, 403, 'Forbidden');
  if (!targetUrl)                     return sendError(res, 400, 'Missing ?url=');

  fetchWithRotation(targetUrl, referer)
    .then(function (result) {
      var respHeaders = Object.assign({}, CORS);
      if (result.headers['content-type'])   respHeaders['Content-Type']   = result.headers['content-type'];
      if (result.headers['content-length']) respHeaders['Content-Length'] = result.headers['content-length'];
      res.writeHead(result.statusCode, respHeaders);
      res.end(result.body);
    })
    .catch(function (e) {
      console.error('[cherry-proxy-vps] all proxies failed for', targetUrl, e.message);
      sendError(res, 502, 'All proxies failed: ' + e.message);
    });
});

server.listen(PORT, function () {
  console.log('[cherry-proxy-vps] listening on :' + PORT + '  key=' + (PROXY_KEY || '(none)'));
  console.log('[cherry-proxy-vps] ' + PROXIES.length + ' proxies configured, starting from index 0');
});
