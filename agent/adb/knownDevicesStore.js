/**
 * Known wireless devices store.
 *
 * Persists the list of devices the tester has paired/connected wirelessly so
 * subsequent sessions can auto-reconnect without re-running the pairing flow.
 *
 * Storage location:
 *   - Packaged build: %APPDATA%\TestMate AI\known-devices.json    (Win)
 *                     ~/Library/Application Support/TestMate AI/known-devices.json (Mac)
 *   - Dev: <repo>/known-devices.json
 *
 * Shape:
 *   {
 *     devices: [
 *       {
 *         serial: "192.168.1.5:5555",     // ADB serial = id used by `adb -s`
 *         ip: "192.168.1.5",
 *         port: 5555,
 *         model: "RMX3944",
 *         androidVersion: "16",
 *         mode: "tcpip" | "pair",          // how it was first set up
 *         lastConnectedAt: 1747497823000,
 *         createdAt: 1747497800000
 *       }
 *     ],
 *     lastActiveSerial: "192.168.1.5:5555"  // for auto-reconnect on app start
 *   }
 */

const fs = require('fs');
const path = require('path');

function resolveStorePath() {
    const base = process.env.TESTMATE_USER_DATA
        ? process.env.TESTMATE_USER_DATA
        : path.join(__dirname, '..', '..');
    return path.join(base, 'known-devices.json');
}

function load() {
    const file = resolveStorePath();
    if (!fs.existsSync(file)) return { devices: [], lastActiveSerial: null };
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.devices)) return { devices: [], lastActiveSerial: null };
        return data;
    } catch (err) {
        // Corrupt JSON — start fresh rather than crash the app
        return { devices: [], lastActiveSerial: null };
    }
}

function save(data) {
    const file = resolveStorePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function list() {
    return load().devices.slice();
}

function getLastActiveSerial() {
    return load().lastActiveSerial;
}

function setLastActive(serial) {
    const data = load();
    data.lastActiveSerial = serial || null;
    save(data);
}

/**
 * Insert or update a device. Dedup is by `serial` (ip:port). If a device with
 * the same IP but different port already exists, the new entry replaces it
 * because the old port has likely been recycled.
 */
function upsert({ serial, ip, port, model, androidVersion, mode }) {
    if (!serial) throw new Error('upsert requires serial');
    const data = load();
    const now = Date.now();
    const idx = data.devices.findIndex(d => d.serial === serial || d.ip === ip);
    const entry = {
        serial,
        ip: ip || null,
        port: port || null,
        model: model || null,
        androidVersion: androidVersion || null,
        mode: mode || 'tcpip',
        lastConnectedAt: now,
        createdAt: idx >= 0 ? data.devices[idx].createdAt : now
    };
    if (idx >= 0) data.devices[idx] = entry;
    else data.devices.push(entry);
    save(data);
    return entry;
}

function markConnected(serial) {
    const data = load();
    const dev = data.devices.find(d => d.serial === serial);
    if (dev) {
        dev.lastConnectedAt = Date.now();
        data.lastActiveSerial = serial;
        save(data);
    }
}

function forget(serial) {
    const data = load();
    const before = data.devices.length;
    data.devices = data.devices.filter(d => d.serial !== serial);
    if (data.lastActiveSerial === serial) data.lastActiveSerial = null;
    save(data);
    return data.devices.length !== before;
}

module.exports = {
    list,
    upsert,
    markConnected,
    forget,
    getLastActiveSerial,
    setLastActive,
    // Exposed for tests/debug
    _resolveStorePath: resolveStorePath
};
