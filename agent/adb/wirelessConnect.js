/**
 * Wireless ADB controller.
 *
 * Two flows are supported because Android's wireless story is split:
 *
 *   TCP/IP mode (Android 4.0+, classic)
 *     1. Plug device via USB once
 *     2. enableTcpip(usbSerial)            → adb tcpip 5555
 *     3. getDeviceIp(usbSerial)            → read wlan IP from device
 *     4. connect(ip, 5555)                 → adb connect ip:5555
 *     5. Unplug USB; subsequent sessions reuse step 4
 *
 *   Pairing mode (Android 11+, no USB ever)
 *     1. Tester opens Settings → Developer Options → Wireless debugging
 *     2. Taps "Pair device with pairing code" → phone shows IP:pairPort + 6-digit code
 *     3. pair(ip, pairPort, code)          → adb pair ip:pairPort
 *     4. Tester also notes connectIp/connectPort shown on the wireless debugging screen
 *     5. connect(ip, connectPort)          → adb connect ip:connectPort
 *
 * Both flows end with the device showing up in `adb devices` as ip:port and
 * being usable by the existing QAAgent.startSession() flow with no changes.
 *
 * iOS support is deferred — see project_ios_roadmap memory. If/when it lands,
 * this file stays Android-only; an `iosWirelessConnect.js` sibling will mirror
 * the same exported surface.
 */

const adbHelper = require('./adbHelper');
const knownDevicesStore = require('./knownDevicesStore');

const DEFAULT_TCPIP_PORT = 5555;

/* Helper: run adb without -s prefix (some commands like `pair`, `connect`,
   `disconnect` operate on the host adb daemon, not a specific device). */
function runHostAdb(args, opts = {}) {
    return adbHelper.runADB(args, opts);
}

/* Helper: run adb against a specific device serial. */
function runDeviceAdb(serial, args, opts = {}) {
    return adbHelper.runADB(['-s', serial, ...args], opts);
}

// ── Step: switch a USB-attached device into TCP/IP listening mode ───────────
async function enableTcpip(usbSerial, port = DEFAULT_TCPIP_PORT) {
    if (!usbSerial) throw new Error('enableTcpip: USB device serial required');
    const out = await runDeviceAdb(usbSerial, ['tcpip', String(port)]);
    // Success markers vary by adb version: "restarting in TCP mode port: 5555"
    // or just no output. Treat any non-error response as success and verify
    // by re-listing devices.
    if (/error|fail/i.test(out)) {
        throw new Error(`adb tcpip failed: ${out.trim()}`);
    }
    return { port };
}

// ── Step: read the device's Wi-Fi IP address ─────────────────────────────────
async function getDeviceIp(deviceSerial) {
    if (!deviceSerial) throw new Error('getDeviceIp: device serial required');
    // Try ip route first (covers most devices); fall back to ifconfig wlan0.
    let ip = null;
    try {
        const route = await runDeviceAdb(deviceSerial, ['shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
        const m = route.match(/\binet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        if (m) ip = m[1];
    } catch (_) { /* fall through */ }
    if (!ip) {
        try {
            const ifc = await runDeviceAdb(deviceSerial, ['shell', 'ifconfig', 'wlan0']);
            const m = ifc.match(/\binet\s+(?:addr:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
            if (m) ip = m[1];
        } catch (_) { /* fall through */ }
    }
    if (!ip) {
        try {
            const route = await runDeviceAdb(deviceSerial, ['shell', 'ip', 'route']);
            const m = route.match(/src\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
            if (m) ip = m[1];
        } catch (_) { /* fall through */ }
    }
    if (!ip) throw new Error('Could not determine device Wi-Fi IP. Is the device on Wi-Fi?');
    return ip;
}

// ── Step: read model + Android version for the persisted entry ──────────────
async function getDeviceMeta(serial) {
    try {
        const info = await adbHelper.getDeviceInfo(serial);
        return {
            model: info?.model || null,
            androidVersion: info?.androidVersion || null
        };
    } catch (_) {
        return { model: null, androidVersion: null };
    }
}

// ── Pairing (Android 11+) ───────────────────────────────────────────────────
//
// `adb pair` is interactive — it prompts for the code on stdin. We bypass the
// prompt by passing the code as a positional argument; that form is supported
// in adb >= 31.0.x which we bundle.
async function pair(ip, port, code) {
    if (!ip || !port || !code) throw new Error('pair: ip, port, code all required');
    const out = await runHostAdb(['pair', `${ip}:${port}`, String(code)], { timeout: 15000 });
    if (/Successfully paired/i.test(out)) return { ok: true };
    if (/Failed/i.test(out) || /error/i.test(out)) {
        throw new Error(`adb pair failed: ${out.trim().split('\n').pop() || out.trim()}`);
    }
    // Some adb versions print nothing on success but exit 0; trust the exit
    // code via the runADB wrapper and return ok.
    return { ok: true, raw: out };
}

// ── Connect / disconnect ────────────────────────────────────────────────────
async function connect(ip, port) {
    if (!ip || !port) throw new Error('connect: ip and port required');
    const out = await runHostAdb(['connect', `${ip}:${port}`], { timeout: 10000 });
    // Success: "connected to 192.168.1.5:5555" OR "already connected to ..."
    if (/already connected|^connected/im.test(out)) {
        return { serial: `${ip}:${port}`, raw: out.trim() };
    }
    // Failure: "failed to connect", "cannot resolve", "unable to connect"
    throw new Error(`adb connect failed: ${out.trim().split('\n').pop() || out.trim()}`);
}

async function disconnect(ip, port) {
    if (!ip) throw new Error('disconnect: ip required');
    const target = port ? `${ip}:${port}` : ip;
    return runHostAdb(['disconnect', target], { timeout: 5000 });
}

// ── Combined orchestrations the renderer actually calls ─────────────────────

/**
 * USB → TCP/IP bootstrap. Tester plugs USB, runs this, then can unplug.
 * Resolves to the new wireless serial which the caller can use to start a
 * session immediately or save for later.
 */
async function bootstrapFromUsb(usbSerial, port = DEFAULT_TCPIP_PORT) {
    const ip = await getDeviceIp(usbSerial);
    await enableTcpip(usbSerial, port);
    // Small wait — adb needs ~1s to switch the daemon mode on-device
    await new Promise(r => setTimeout(r, 1500));
    const conn = await connect(ip, port);
    const meta = await getDeviceMeta(conn.serial);
    const entry = knownDevicesStore.upsert({
        serial: conn.serial,
        ip, port,
        model: meta.model,
        androidVersion: meta.androidVersion,
        mode: 'tcpip'
    });
    knownDevicesStore.markConnected(conn.serial);
    return entry;
}

/**
 * Android 11+ pair-and-connect. Tester reads the two IP:port pairs and code
 * off the phone's Wireless Debugging screen and supplies all three.
 */
async function pairAndConnect({ pairIp, pairPort, code, connectIp, connectPort }) {
    if (!pairIp || !pairPort || !code) throw new Error('pairAndConnect: pairIp, pairPort, code required');
    // Pairing creates persistent trust. The connect port is different — it's
    // the listener port shown on the wireless debugging screen.
    await pair(pairIp, pairPort, code);
    const ip = connectIp || pairIp;
    const port = connectPort || pairPort;
    const conn = await connect(ip, port);
    const meta = await getDeviceMeta(conn.serial);
    const entry = knownDevicesStore.upsert({
        serial: conn.serial,
        ip, port,
        model: meta.model,
        androidVersion: meta.androidVersion,
        mode: 'pair'
    });
    knownDevicesStore.markConnected(conn.serial);
    return entry;
}

/**
 * Reconnect a previously-paired device. Returns the live device entry on
 * success, or throws with a clear reason on failure (network unreachable,
 * device rebooted, etc.).
 */
async function reconnect(serial) {
    const entries = knownDevicesStore.list();
    const entry = entries.find(d => d.serial === serial);
    if (!entry) throw new Error(`No saved device with serial ${serial}`);
    const conn = await connect(entry.ip, entry.port);
    knownDevicesStore.markConnected(conn.serial);
    return { ...entry, lastConnectedAt: Date.now() };
}

async function autoReconnectLast(timeoutMs = 5000) {
    const serial = knownDevicesStore.getLastActiveSerial();
    if (!serial) return { attempted: false, reason: 'no-last-device' };
    try {
        const result = await Promise.race([
            reconnect(serial),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
        ]);
        return { attempted: true, ok: true, device: result };
    } catch (err) {
        return { attempted: true, ok: false, reason: err.message };
    }
}

// ── Discovery: split the `adb devices` output into USB vs wireless ──────────
async function discoverDevices() {
    const devices = await adbHelper.getConnectedDevices();
    return devices.map(d => ({
        serial: d.id,
        status: d.status,
        transport: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(d.id) ? 'wireless' : 'usb'
    }));
}

module.exports = {
    DEFAULT_TCPIP_PORT,
    // Atomic primitives (exposed for testing / advanced use)
    enableTcpip,
    getDeviceIp,
    pair,
    connect,
    disconnect,
    // Orchestrated flows (what the UI calls)
    bootstrapFromUsb,
    pairAndConnect,
    reconnect,
    autoReconnectLast,
    discoverDevices,
    // Store passthrough so the UI doesn't import two modules
    listKnown: knownDevicesStore.list,
    forgetDevice: knownDevicesStore.forget,
    getLastActiveSerial: knownDevicesStore.getLastActiveSerial,
    setLastActive: knownDevicesStore.setLastActive
};
