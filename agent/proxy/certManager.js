'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { exec } = require('child_process');
const adbHelper = require('../adb/adbHelper');

const CERT_DIR  = path.join(os.homedir(), '.testmate', 'certs');
const HOSTS_DIR = path.join(CERT_DIR, 'hosts');
const CA_KEY    = path.join(CERT_DIR, 'ca.key');
const CA_CERT   = path.join(CERT_DIR, 'ca.crt');

// In-memory cache: hostname → { key: Buffer, cert: Buffer }
const _cache = new Map();

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

async function checkOpenSSL() {
    try { await run('openssl version'); return true; }
    catch { return false; }
}

async function init() {
    if (!await checkOpenSSL()) throw new Error('openssl not found — Phase 3 proxy requires openssl in PATH');

    fs.mkdirSync(HOSTS_DIR, { recursive: true });
    if (fs.existsSync(CA_KEY) && fs.existsSync(CA_CERT)) return;

    await run(`openssl genrsa -out "${CA_KEY}" 2048`);
    await run(`openssl req -new -x509 -days 3650 -key "${CA_KEY}" -out "${CA_CERT}" -subj "/O=TestMate AI/CN=TestMate Root CA"`);
    console.log('[CertManager] CA generated:', CA_CERT);
}

async function getOrCreate(hostname) {
    const safe = hostname.replace(/[^a-z0-9._-]/gi, '_');
    if (_cache.has(safe)) return _cache.get(safe);

    const keyPath = path.join(HOSTS_DIR, `${safe}.key`);
    const crtPath = path.join(HOSTS_DIR, `${safe}.crt`);
    const csrPath = path.join(HOSTS_DIR, `${safe}.csr`);
    const sanPath = path.join(HOSTS_DIR, `${safe}.ext`);

    if (!fs.existsSync(crtPath)) {
        fs.writeFileSync(sanPath, `subjectAltName=DNS:${hostname},DNS:*.${hostname}`);
        await run(`openssl genrsa -out "${keyPath}" 2048`);
        await run(`openssl req -new -key "${keyPath}" -out "${csrPath}" -subj "/CN=${hostname}"`);
        await run(`openssl x509 -req -days 365 -in "${csrPath}" -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial -extfile "${sanPath}" -out "${crtPath}"`);
        try { fs.unlinkSync(csrPath); fs.unlinkSync(sanPath); } catch {}
    }

    const result = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(crtPath) };
    _cache.set(safe, result);
    return result;
}

// Pre-generate certs for all known analytics hosts (non-blocking)
async function preGenerate() {
    const hosts = [
        'firebaselogging.googleapis.com', 'app-measurement.com',
        'collect.gameanalytics.com',
        'graph.facebook.com',
        'inapppurchase.googleapis.com', 'play.googleapis.com',
        'api2.appsflyer.com', 'api.appsflyer.com',
        'app.adjust.com',
        'analytics.amplitude.com'
    ];
    await Promise.allSettled(hosts.map(h => getOrCreate(h)));
}

async function pushToDevice(deviceId) {
    if (!fs.existsSync(CA_CERT)) throw new Error('CA cert not generated');
    await adbHelper.runADB(['-s', deviceId, 'push', CA_CERT, '/sdcard/testmate-ca.crt']);
    // Works on debug / rooted devices
    try {
        await adbHelper.runADB(['-s', deviceId, 'shell', 'security', 'install-certificate', '/sdcard/testmate-ca.crt']);
        return 'installed';
    } catch {
        return 'pushed'; // user must install manually
    }
}

const getCACertPath = () => CA_CERT;
const caCertExists  = () => fs.existsSync(CA_CERT);

module.exports = { init, getOrCreate, preGenerate, pushToDevice, getCACertPath, caCertExists };
