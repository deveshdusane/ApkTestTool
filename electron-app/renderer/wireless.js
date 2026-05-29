// ─── WIRELESS ADB CONTROL ────────────────────────────────────────────────────
// Sidebar device list + Connect Wireless modal.
//
// Polls discover() every 5s while the app is open to keep the sidebar list
// fresh. Auto-reconnect to the last-active wireless device fires once on
// startup with a 5s timeout — if it fails the UI falls back to whatever USB
// device is plugged in.

let _wlPollTimer = null;
let _wlLastSnapshot = { connected: [], known: [] };

function wlEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function refreshDevices() {
    if (!window.api || !window.api.wireless) return;
    try {
        const [discRes, knownRes] = await Promise.all([
            window.api.wireless.discover(),
            window.api.wireless.listKnown()
        ]);
        _wlLastSnapshot = {
            connected: (discRes && discRes.data) || [],
            known: (knownRes && knownRes.data) || []
        };
        renderDeviceList();
    } catch (e) { /* silent — never noisy on transient ADB hiccups */ }
}

function renderDeviceList() {
    const root = document.getElementById('device-list');
    if (!root) return;
    const connected = _wlLastSnapshot.connected;
    const known = _wlLastSnapshot.known;

    const connectedSerials = new Set(connected.map(function (d) { return d.serial; }));
    const items = [];

    for (const d of connected) {
        const k = known.find(function (x) { return x.serial === d.serial; });
        const wirelessParts = d.transport === 'wireless' ? d.serial.split(':') : null;
        items.push({
            serial: d.serial,
            transport: d.transport,
            status: d.status,
            online: true,
            model: k ? k.model : null,
            ip: (k && k.ip) || (wirelessParts ? wirelessParts[0] : null),
            port: (k && k.port) || (wirelessParts ? Number(wirelessParts[1]) : null)
        });
    }
    for (const k of known) {
        if (connectedSerials.has(k.serial)) continue;
        items.push({
            serial: k.serial,
            transport: 'wireless',
            status: 'offline',
            online: false,
            model: k.model,
            ip: k.ip,
            port: k.port
        });
    }

    if (items.length === 0) {
        root.innerHTML = '<div class="device-empty">No device. Plug USB or pair wireless.</div>';
        return;
    }

    root.innerHTML = items.map(function (d) {
        const icon = d.transport === 'wireless' ? '\u{1F4E1}' : '\u{1F4F1}';
        const label = d.model ? d.model
            : (d.transport === 'wireless' ? d.serial : d.serial.slice(0, 12));
        const sub = d.transport === 'wireless'
            ? (d.ip || '—') + (d.port ? ':' + d.port : '')
            : d.serial;
        const statusCls = d.online
            ? (d.status === 'device' ? 'device-online' : 'device-warn')
            : 'device-offline';
        const statusLbl = d.online
            ? (d.status === 'device' ? '● Connected' : '⚠ ' + d.status)
            : '○ Offline';
        const actions = d.transport === 'wireless' && !d.online
            ? '<button class="device-action" onclick="reconnectWireless(\'' + d.serial + '\')" title="Reconnect">↻</button>' +
              '<button class="device-action device-action-danger" onclick="forgetWireless(\'' + d.serial + '\')" title="Forget">×</button>'
            : '';
        return '<div class="device-row ' + statusCls + '">' +
            '<div class="device-icon">' + icon + '</div>' +
            '<div class="device-meta">' +
                '<div class="device-label">' + wlEscape(label) + '</div>' +
                '<div class="device-sub">' + wlEscape(sub) + '</div>' +
            '</div>' +
            '<div class="device-status">' + statusLbl + '</div>' +
            '<div class="device-actions">' + actions + '</div>' +
        '</div>';
    }).join('');
}

async function reconnectWireless(serial) {
    const res = await window.api.wireless.reconnect(serial);
    if (res && res.success) {
        if (typeof addLog === 'function') addLog('✓ Reconnected ' + serial, 'success');
    } else {
        if (typeof addLog === 'function') addLog('✗ Reconnect failed: ' + (res && res.message), 'error');
    }
    refreshDevices();
}

async function forgetWireless(serial) {
    if (!confirm('Forget ' + serial + '? You will need to pair it again.')) return;
    await window.api.wireless.forget(serial);
    refreshDevices();
}

function startDevicePolling() {
    if (_wlPollTimer) clearInterval(_wlPollTimer);
    refreshDevices();
    _wlPollTimer = setInterval(refreshDevices, 5000);
}

// ─── Connect Wireless modal ───────────────────────────────────────────────
function openWirelessModal() {
    const m = document.getElementById('wl-modal');
    if (m) m.classList.remove('hidden');
    selectWirelessTab('usb');
    refreshUsbBootstrapList();
}
function closeWirelessModal() {
    const m = document.getElementById('wl-modal');
    if (m) m.classList.add('hidden');
    ['wl-usb-result', 'wl-pair-result'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.textContent = ''; }
    });
}
function selectWirelessTab(name) {
    document.querySelectorAll('.wl-tab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.wlTab === name);
    });
    document.querySelectorAll('.wl-tab-body').forEach(function (b) {
        b.classList.toggle('hidden', b.id !== ('wl-tab-' + name));
    });
}

async function refreshUsbBootstrapList() {
    const root = document.getElementById('wl-usb-list');
    if (!root) return;
    const res = await window.api.wireless.discover();
    const usbDevices = ((res && res.data) || []).filter(function (d) {
        return d.transport === 'usb' && d.status === 'device';
    });
    if (usbDevices.length === 0) {
        root.innerHTML = '<div class="wl-empty">No authorized USB device. Plug one in and allow USB debugging on the device.</div>';
        return;
    }
    root.innerHTML = usbDevices.map(function (d) {
        return '<div class="wl-usb-row">' +
            '<span class="wl-usb-icon">\u{1F4F1}</span>' +
            '<span class="wl-usb-serial">' + wlEscape(d.serial) + '</span>' +
            '<button class="wl-submit wl-submit-inline" onclick="submitUsbBootstrap(\'' + d.serial + '\')">Switch to Wi-Fi</button>' +
        '</div>';
    }).join('');
}

async function submitUsbBootstrap(usbSerial) {
    const out = document.getElementById('wl-usb-result');
    if (out) {
        out.classList.remove('hidden');
        out.textContent = 'Working… reading IP, switching to TCP/IP, connecting…';
        out.className = 'wl-result wl-result-info';
    }
    const res = await window.api.wireless.bootstrapUsb(usbSerial);
    if (res && res.success) {
        if (out) {
            out.textContent = '✓ Connected wirelessly as ' + res.data.serial + '. You can unplug USB.';
            out.className = 'wl-result wl-result-ok';
        }
        if (typeof addLog === 'function') addLog('✓ Wireless bootstrap success: ' + res.data.serial, 'success');
        refreshDevices();
    } else {
        if (out) {
            out.textContent = '✗ ' + ((res && res.message) || 'Unknown error');
            out.className = 'wl-result wl-result-err';
        }
    }
}

function parseAddr(input) {
    if (!input) return null;
    const m = String(input).trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
    if (!m) return null;
    return { ip: m[1], port: Number(m[2]) };
}

async function submitWirelessPair() {
    const pairAddr   = parseAddr(document.getElementById('wl-pair-addr') && document.getElementById('wl-pair-addr').value);
    const code       = String((document.getElementById('wl-pair-code') && document.getElementById('wl-pair-code').value) || '').trim();
    const connectRaw = document.getElementById('wl-connect-addr') && document.getElementById('wl-connect-addr').value;
    const connectAddr = parseAddr(connectRaw) || pairAddr;

    const out = document.getElementById('wl-pair-result');
    function show(txt, cls) {
        if (!out) return;
        out.textContent = txt;
        out.className = 'wl-result ' + cls;
        out.classList.remove('hidden');
    }

    if (!pairAddr)             return show('Pairing IP:Port format invalid. Use 192.168.x.x:12345.', 'wl-result-err');
    if (!/^\d{6}$/.test(code)) return show('Pairing code must be 6 digits.', 'wl-result-err');
    if (!connectAddr)          return show('Connect IP:Port format invalid.', 'wl-result-err');

    show('Pairing… (this can take 5–10 seconds)', 'wl-result-info');
    const res = await window.api.wireless.pairAndConnect({
        pairIp: pairAddr.ip, pairPort: pairAddr.port, code: code,
        connectIp: connectAddr.ip, connectPort: connectAddr.port
    });
    if (res && res.success) {
        show('✓ Paired & connected as ' + res.data.serial, 'wl-result-ok');
        if (typeof addLog === 'function') addLog('✓ Wireless pair success: ' + res.data.serial, 'success');
        refreshDevices();
    } else {
        show('✗ ' + ((res && res.message) || 'Unknown error'), 'wl-result-err');
    }
}

async function attemptAutoReconnect() {
    if (!window.api || !window.api.wireless) return;
    try {
        const res = await window.api.wireless.autoReconnect();
        if (res && res.success && res.data && res.data.ok) {
            if (typeof addLog === 'function') addLog('✓ Auto-reconnected ' + (res.data.device && res.data.device.serial), 'success');
        }
    } catch (e) {}
    refreshDevices();
}

document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('open-wireless-modal-btn');
    if (btn) btn.addEventListener('click', openWirelessModal);
    attemptAutoReconnect();
    startDevicePolling();
});

window.openWirelessModal     = openWirelessModal;
window.closeWirelessModal    = closeWirelessModal;
window.selectWirelessTab     = selectWirelessTab;
window.submitUsbBootstrap    = submitUsbBootstrap;
window.submitWirelessPair    = submitWirelessPair;
window.reconnectWireless     = reconnectWireless;
window.forgetWireless        = forgetWireless;
