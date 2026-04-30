'use strict';

const http    = require('http');
const net     = require('net');
const tls     = require('tls');
const adbHelper    = require('../adb/adbHelper');
const certManager  = require('./certManager');
const parsers      = require('./endpointParsers');

const PROXY_PORT = 8877;

let _server         = null;
let _onEvent        = null;
let _deviceId       = null;
let _active         = false;
let _sessionStart   = Date.now();
let _interceptCount = 0;
let _lastError      = null;

// ── HTTP request parser ───────────────────────────────────────────────────
function parseHTTP(buf) {
    const str = buf.toString('utf8');
    const sep = str.indexOf('\r\n\r\n');
    if (sep === -1) return null;

    const headerStr = str.slice(0, sep);
    const body      = str.slice(sep + 4);
    const lines     = headerStr.split('\r\n');
    const [method, rawPath] = lines[0].split(' ');

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
        const ci = lines[i].indexOf(':');
        if (ci > 0) {
            headers[lines[i].slice(0, ci).toLowerCase().trim()] = lines[i].slice(ci + 1).trim();
        }
    }

    const cl = parseInt(headers['content-length'] || '0', 10);
    if (cl > 0 && buf.length < sep + 4 + cl) return null; // incomplete

    return { method, path: rawPath, headers, body: body.slice(0, cl || undefined) };
}

function now() {
    return parseFloat(((Date.now() - _sessionStart) / 1000).toFixed(1));
}

function emitEvents(hostname, events) {
    if (!_onEvent || !events.length) return;
    const t = now();
    for (const ev of events) {
        _onEvent({ ...ev, time: t, confidence: 'NETWORK' });
    }
    _interceptCount += events.length;
}

// ── MITM handler for a known analytics host ───────────────────────────────
async function mitmConnect(hostname, port, clientSocket, head) {
    let certCtx;
    try {
        const { key, cert } = await certManager.getOrCreate(hostname);
        certCtx = { key, cert };
    } catch {
        return null; // cert not ready → caller falls back to tunnel
    }

    // Tell client the tunnel is open
    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: TestMate-AI/3.0\r\n\r\n');
    if (head && head.length) clientSocket.unshift(head);

    // Wrap client socket as a TLS server — we present our forged cert
    const serverTLS = new tls.TLSSocket(clientSocket, {
        isServer: true,
        key:  certCtx.key,
        cert: certCtx.cert,
        rejectUnauthorized: false
    });
    serverTLS.on('error', () => {});

    serverTLS.once('secure', () => {
        // Connect to real analytics server
        const targetTLS = tls.connect({
            host: hostname,
            port,
            servername: hostname,
            rejectUnauthorized: false // analytics servers sometimes use wildcard / CDN certs
        });

        let reqBuf     = Buffer.alloc(0);
        let pendingOut = []; // client data buffered until target connects
        let targetUp   = false;

        targetTLS.on('secureConnect', () => {
            targetUp = true;
            for (const chunk of pendingOut) {
                if (!targetTLS.destroyed) targetTLS.write(chunk);
            }
            pendingOut = [];
        });

        serverTLS.on('data', (chunk) => {
            // Buffer & try to parse a complete HTTP request for interception
            reqBuf = Buffer.concat([reqBuf, chunk]);
            const parsed = parseHTTP(reqBuf);
            if (parsed) {
                const events = parsers.parse(
                    hostname,
                    parsed.path,
                    parsed.method,
                    parsed.headers['content-type'] || '',
                    parsed.body
                );
                emitEvents(hostname, events);
                reqBuf = Buffer.alloc(0); // reset for next keep-alive request
            }

            if (targetUp) { if (!targetTLS.destroyed) targetTLS.write(chunk); }
            else pendingOut.push(chunk);
        });

        targetTLS.on('data', chunk => { if (!serverTLS.destroyed) serverTLS.write(chunk); });

        serverTLS.on('end', () => targetTLS.end());
        targetTLS.on('end', () => serverTLS.end());
        serverTLS.on('error', () => targetTLS.destroy());
        targetTLS.on('error', () => serverTLS.destroy());
    });

    return true;
}

// ── Direct tunnel (non-analytics HTTPS) ───────────────────────────────────
function directTunnel(hostname, port, clientSocket, head) {
    const target = net.connect(port, hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) target.write(head);
        target.pipe(clientSocket);
        clientSocket.pipe(target);
    });
    target.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => target.destroy());
}

// ── CONNECT handler ───────────────────────────────────────────────────────
async function onConnect(req, clientSocket, head) {
    const [hostname, portStr] = req.url.split(':');
    const port = parseInt(portStr) || 443;

    if (parsers.isAnalyticsHost(hostname)) {
        const ok = await mitmConnect(hostname, port, clientSocket, head);
        if (ok) return;
    }

    directTunnel(hostname, port, clientSocket, head);
}

// ── Plain HTTP proxy ───────────────────────────────────────────────────────
function onRequest(req, res) {
    try {
        const url  = new URL(req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`);
        const opts = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: req.method,
            headers: req.headers
        };

        const proxyReq = http.request(opts, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });
        proxyReq.on('error', () => res.end());
        req.pipe(proxyReq);
    } catch { res.end(); }
}

// ── Public API ────────────────────────────────────────────────────────────
async function start(deviceId, onEvent) {
    if (_server) return { success: true, alreadyRunning: true };

    _onEvent       = onEvent;
    _deviceId      = deviceId;
    _sessionStart  = Date.now();
    _interceptCount = 0;
    _active        = false;

    // Init CA cert (fails gracefully if openssl unavailable)
    try {
        await certManager.init();
    } catch (e) {
        console.warn('[Proxy] Disabled —', e.message);
        _lastError = e.message;
        return { success: false, error: e.message };
    }

    // Pre-generate known-host certs in background
    certManager.preGenerate().catch(() => {});

    // Create HTTP proxy server
    _server = http.createServer(onRequest);
    _server.on('connect', onConnect);
    _server.on('error', () => {});

    try {
        await new Promise((resolve, reject) => {
            _server.listen(PROXY_PORT, '127.0.0.1', resolve);
            _server.once('error', reject);
        });
    } catch (e) {
        _server = null;
        return { success: false, error: `Port ${PROXY_PORT} in use` };
    }

    // ADB: reverse-map port and set device proxy
    try {
        await adbHelper.runADB(['-s', deviceId, 'reverse', `tcp:${PROXY_PORT}`, `tcp:${PROXY_PORT}`]);
        await adbHelper.runADB(['-s', deviceId, 'shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${PROXY_PORT}`]);
        _active    = true;
        _lastError = null;
        console.log(`[Proxy] Active on port ${PROXY_PORT} — device proxy set`);
        return { success: true, port: PROXY_PORT };
    } catch (e) {
        _lastError = e.message;
        console.warn('[Proxy] ADB proxy setup failed:', e.message);
        return { success: false, error: e.message };
    }
}

async function stop(deviceId) {
    const did = deviceId || _deviceId;

    // Clean up device proxy settings
    if (did) {
        try { await adbHelper.runADB(['-s', did, 'shell', 'settings', 'put', 'global', 'http_proxy', ':0']); } catch {}
        try { await adbHelper.runADB(['-s', did, 'reverse', '--remove', `tcp:${PROXY_PORT}`]); } catch {}
    }

    if (_server) {
        _server.close();
        _server = null;
    }

    _active    = false;
    _lastError = null;
    _onEvent   = null;
    console.log('[Proxy] Stopped, device proxy cleared');
}

const isActive       = () => _active;
const getPort        = () => PROXY_PORT;
const getIntercepted = () => _interceptCount;
const getLastError   = () => _lastError;

module.exports = { start, stop, isActive, getPort, getIntercepted, getLastError };
