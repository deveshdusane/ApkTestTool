const dns = require('dns').promises;
const adbHelper = require('../adb/adbHelper');

// Maps domain suffixes → SDK ID + timeline category
const SDK_DOMAIN_MAP = [
    { sdkId: 'admob',              tlCategory: 'ADS',      patterns: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'mads.gvt2.com', 'admob.googleapis.com'] },
    { sdkId: 'unity_ads',          tlCategory: 'ADS',      patterns: ['unityads.unity3d.com', 'auction.unityads', 'config.unityads', 'cdn.unityads'] },
    { sdkId: 'applovin',           tlCategory: 'ADS',      patterns: ['applovin.com', 'maxads.com'] },
    { sdkId: 'facebook',           tlCategory: 'FACEBOOK', patterns: ['an.facebook.com', 'graph.facebook.com', 'fbcdn.net'] },
    { sdkId: 'firebase_analytics', tlCategory: 'FIREBASE', patterns: ['app-measurement.com', 'firebase.googleapis.com', 'firebaseinstallations.googleapis.com', 'firebaseremoteconfig.googleapis.com'] },
    { sdkId: 'firebase',           tlCategory: 'FIREBASE', patterns: ['firebaseio.com', 'firestore.googleapis.com'] },
    { sdkId: 'crashlytics',        tlCategory: 'FIREBASE', patterns: ['crashlytics.com', 'firebasecrashlytics.googleapis.com'] },
    { sdkId: 'appsflyer',          tlCategory: 'APPSFLYER', patterns: ['appsflyer.com'] },
    { sdkId: 'branch',             tlCategory: 'ATTRIBUTION', patterns: ['branch.io', 'app.link', 'bnc.lt'] },
    { sdkId: 'adjust',             tlCategory: 'ADJUST',   patterns: ['adjust.com', 'adjust.io'] },
    { sdkId: 'sentry',             tlCategory: 'SYSTEM',   patterns: ['sentry.io', 'ingest.sentry.io'] },
];

class NetworkDomainMonitor {
    constructor() {
        this.reset();
    }

    reset() {
        this.seenIPs     = new Set();
        this.dnsCache    = new Map(); // ip → hostname | null
        this.detectedIds = new Set(); // sdkIds already reported this session
        this.cachedUid   = null;
        this._prewarmed  = false;
    }

    /**
     * Pre-resolve known SDK hosts so short-lived beacons (AppsFlyer first-open,
     * Firebase, Crashlytics) get matched even if reverse-DNS fails mid-flight.
     */
    async preWarmKnownHosts() {
        if (this._prewarmed) return;
        this._prewarmed = true;
        const hosts = [
            'app.appsflyer.com', 'events.appsflyer.com', 'launches.appsflyer.com', 'register.appsflyer.com',
            'app-measurement.com', 'firebaselogging-pa.googleapis.com',
            'firebasecrashlytics.googleapis.com', 'crashlyticsreports-pa.googleapis.com',
            'firebaseinstallations.googleapis.com'
        ];
        await Promise.allSettled(hosts.map(async (host) => {
            try {
                const ips = await dns.resolve4(host);
                for (const ip of ips) this.dnsCache.set(ip, host);
            } catch (e) {}
        }));
    }

    async getAppUid(deviceId, packageName) {
        if (this.cachedUid) return this.cachedUid;
        try {
            const out = await adbHelper.runADB(['-s', deviceId, 'shell', 'pm', 'list', 'packages', '-U', packageName]);
            const m = out && out.match(/uid:(\d+)/);
            if (m) this.cachedUid = m[1];
        } catch (e) {}
        return this.cachedUid;
    }

    // /proc/net/tcp stores IPv4 in little-endian hex (e.g. 0100007F = 127.0.0.1)
    _parseIPv4(hexAddrPort) {
        try {
            const hex = (hexAddrPort || '').split(':')[0];
            if (hex.length !== 8) return null;
            return [
                parseInt(hex.substr(6, 2), 16),
                parseInt(hex.substr(4, 2), 16),
                parseInt(hex.substr(2, 2), 16),
                parseInt(hex.substr(0, 2), 16),
            ].join('.');
        } catch (e) { return null; }
    }

    // /proc/net/tcp6 stores IPv6 as 4 little-endian 32-bit words; handles IPv4-mapped
    _parseIPv6(hexAddrPort) {
        try {
            const hex = (hexAddrPort || '').split(':')[0];
            if (hex.length !== 32) return null;
            const words = [];
            for (let i = 0; i < 32; i += 8) {
                const w = hex.substr(i, 8);
                words.push(w.substr(6,2) + w.substr(4,2) + w.substr(2,2) + w.substr(0,2));
            }
            // IPv4-mapped ::ffff:x.x.x.x — first two words zero, third is 0000ffff
            if (words[0] === '00000000' && words[1] === '00000000') {
                const v4 = words[3];
                return [
                    parseInt(v4.substr(0,2), 16),
                    parseInt(v4.substr(2,2), 16),
                    parseInt(v4.substr(4,2), 16),
                    parseInt(v4.substr(6,2), 16),
                ].join('.');
            }
            return null; // skip pure IPv6 (rarely used by ad/analytics SDKs)
        } catch (e) { return null; }
    }

    _isPublicIP(ip) {
        if (!ip) return false;
        return !ip.startsWith('0.') &&
               !ip.startsWith('127.') &&
               !ip.startsWith('10.') &&
               !ip.match(/^192\.168\./) &&
               !ip.match(/^172\.(1[6-9]|2\d|3[01])\./);
    }

    async _readEstablishedIPs(deviceId, uid) {
        const ips = new Set();
        // Accept ESTABLISHED + recently-closed states so we catch short-lived beacons
        // 01=ESTABLISHED, 04=FIN_WAIT1, 05=FIN_WAIT2, 06=TIME_WAIT, 08=CLOSE_WAIT, 09=LAST_ACK
        const acceptedStates = new Set(['01', '04', '05', '06', '08', '09']);
        for (const proto of ['tcp', 'tcp6']) {
            try {
                const content = await adbHelper.runADB(['-s', deviceId, 'shell', 'cat', `/proc/net/${proto}`]);
                for (const line of (content || '').split('\n').slice(1)) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 8) continue;
                    if (!acceptedStates.has(parts[3])) continue;
                    if (parts[7] !== uid) continue;  // filter by app UID
                    const ip = proto === 'tcp' ? this._parseIPv4(parts[2]) : this._parseIPv6(parts[2]);
                    if (this._isPublicIP(ip)) ips.add(ip);
                }
            } catch (e) {}
        }
        return [...ips];
    }

    async _resolveIP(ip) {
        if (this.dnsCache.has(ip)) return this.dnsCache.get(ip);
        try {
            const hostnames = await dns.reverse(ip);
            const host = (hostnames && hostnames[0]) || null;
            this.dnsCache.set(ip, host);
            return host;
        } catch (e) {
            this.dnsCache.set(ip, null);
            return null;
        }
    }

    _matchSdk(hostname) {
        if (!hostname) return null;
        const lower = hostname.toLowerCase();
        for (const entry of SDK_DOMAIN_MAP) {
            if (entry.patterns.some(p => lower.includes(p))) return entry;
        }
        return null;
    }

    async scan(deviceId, packageName) {
        const detections = [];
        try {
            const uid = await this.getAppUid(deviceId, packageName);
            if (!uid) return detections;

            const allIPs = await this._readEstablishedIPs(deviceId, uid);
            const newIPs = allIPs.filter(ip => !this.seenIPs.has(ip));
            newIPs.forEach(ip => this.seenIPs.add(ip)); // mark all seen before async

            // Resolve max 8 new IPs per cycle (DNS is cached after first hit)
            const resolved = await Promise.allSettled(
                newIPs.slice(0, 8).map(ip =>
                    this._resolveIP(ip).then(host => ({ ip, host }))
                )
            );

            for (const r of resolved) {
                if (r.status !== 'fulfilled') continue;
                const { host } = r.value;
                const sdkEntry = this._matchSdk(host);
                if (!sdkEntry) continue;
                const isNew = !this.detectedIds.has(sdkEntry.sdkId);
                if (isNew) this.detectedIds.add(sdkEntry.sdkId);
                detections.push({ sdkId: sdkEntry.sdkId, tlCategory: sdkEntry.tlCategory, hostname: host, isNew });
            }
        } catch (e) {}
        return detections;
    }
}

module.exports = new NetworkDomainMonitor();
