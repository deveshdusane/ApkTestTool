const adbHelper = require('./adb/adbHelper');
const config = require('./config/config');
const { spawn, exec } = require('child_process');
const fs = require('fs');


const networkAnalyzer = require('./metrics/networkAnalyzer');
const memoryAnalyzer = require('./advanced/memoryAnalyzer'); // Keeping this in advanced for now
const runtimeIntelligence = require('./advanced/runtimeIntelligence');
const iapValidationEngine = require('./advanced/iapValidationEngine');
const gameplayBlockerDetector = require('./advanced/gameplayBlockerDetector');
const proxyServer = require('./proxy/proxyServer');

let logcatInterval = null;
let monitorInterval = null;
let permissionInterval = null;
let networkIntelInterval = null;
let lastLogPosition = 0;
let logPathRef = null;
let isFetching = false;

const telemetry = {
    fps: [],
    memory: [],
    ping: [],
    disconnects: 0,
    peakMemory: 0
};

const getMemory = async (deviceId, pkg) => {
    try {
        const out = await adbHelper.runADB(["-s", deviceId, "shell", "dumpsys", "meminfo", pkg]);
        // Step 4: Parse TOTAL PSS
        const match = out.match(/TOTAL\s+PSS:\s+(\d+)/i) || out.match(/TOTAL:\s+(\d+)/i) || out.match(/TOTAL\s+(\d+)/i);
        if (match && match[1]) {
            const memMB = Math.round(parseInt(match[1]) / 1024);
            if (memMB > telemetry.peakMemory) telemetry.peakMemory = memMB;
            telemetry.memory.push(memMB);
            return memMB;
        }
        return 0;
    } catch (e) { return 0; }
};

const getNetworkStatus = async (deviceId) => {
    try {
        const out = await adbHelper.runADB(["-s", deviceId, "shell", "dumpsys", "wifi"]);
        if (out.includes('state: CONNECTED')) return "WiFi";
        return "Mobile/Other";
    } catch (e) { return "Disconnected"; }
};

const getFPS = async (deviceId, pkg) => {
    try {
        const out = await adbHelper.runADB(["-s", deviceId, "shell", "dumpsys", "gfxinfo", pkg]);

        // Method 1: Percentage based (more accurate for 60fps baseline)
        const matchJanky = out.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)\s*%\)/i);
        if (matchJanky) {
            const jankPct = parseFloat(matchJanky[2]);
            const fps = Math.max(1, Math.round(60 * (1 - (jankPct / 100))));
            telemetry.fps.push(fps);
            return fps;
        }

        // Method 2: Total vs Janky count (Fallback)
        const totalMatch = out.match(/Total frames rendered:\s*(\d+)/i);
        const jankMatch = out.match(/Janky frames:\s*(\d+)(?!\s*\()/i);

        if (totalMatch && jankMatch) {
            const total = parseInt(totalMatch[1]);
            const janky = parseInt(jankMatch[1]);
            if (total > 0) {
                const fps = Math.max(1, Math.round(60 * (1 - (janky / total))));
                telemetry.fps.push(fps);
                return fps;
            }
        }

        return telemetry.fps.length ? telemetry.fps[telemetry.fps.length - 1] : 60;
    } catch (e) {
        return telemetry.fps.length ? telemetry.fps[telemetry.fps.length - 1] : 0;
    }
};

const start = async (packageName, onData, logPath, deviceId = null) => {
    if (monitorInterval) clearInterval(monitorInterval);
    logPathRef = logPath;
    lastLogPosition = 0;

    // Reset telemetry
    telemetry.fps = [];
    telemetry.memory = [];
    telemetry.ping = [];
    telemetry.disconnects = 0;
    telemetry.peakMemory = 0;

    try {
        if (!deviceId) {
            await adbHelper.runADB(['start-server']);
            const devices = await adbHelper.getConnectedDevices();

            if (devices.length === 0) {
                onData({ error: "No device connected", status: "Disconnected" });
                return;
            }

            deviceId = devices[0].id;
        }

        console.log("🚀 Starting Session Telemetry on Device:", deviceId);

        // Force verbose logging for all tracked SDKs
        try {
            // Firebase
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'debug.firebase.analytics.app', packageName]);
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.FA', 'VERBOSE']);
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.FA-SVC', 'VERBOSE']);
            // Ads
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.AdMob', 'VERBOSE']);
            // GameAnalytics
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.GameAnalytics', 'VERBOSE']);
            // Facebook SDK
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.FacebookSDK', 'VERBOSE']);
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.FBTRACE', 'VERBOSE']);
            // AppsFlyer
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.AppsFlyerLib', 'VERBOSE']);
            // Adjust
            await adbHelper.runADB(['-s', deviceId, 'shell', 'setprop', 'log.tag.Adjust', 'VERBOSE']);
        } catch (e) {
            console.warn("Failed to enable debug properties on device:", e.message);
        }

        // Reset advanced analyzers
        try { if (networkAnalyzer) networkAnalyzer.reset(); } catch (e) { }
        try { if (memoryAnalyzer) memoryAnalyzer.reset(); } catch (e) { }
        try {
            if (runtimeIntelligence) {
                runtimeIntelligence.reset();
                runtimeIntelligence.runBinaryScan(packageName, deviceId);
                // Pre-resolve known SDK hosts (AppsFlyer, Firebase, Crashlytics) so
                // their short-lived beacons get matched even if reverse-DNS races us.
                try {
                    const networkDomainMonitor = require('./metrics/networkDomainMonitor');
                    networkDomainMonitor.preWarmKnownHosts().catch(() => {});
                } catch (e) {}
            }
        } catch (e) { }

        // Start MITM proxy (Phase 3) — non-blocking, graceful if openssl unavailable
        proxyServer.start(deviceId, (ev) => {
            try { runtimeIntelligence.addProxyEvent(ev); } catch {}
        }).catch(() => {});

        // Note: networkAnalyzer ping/usage tracking is started by main.js — do NOT start here to avoid triple polling

        // Initial fetch
        fetchAndSend(deviceId, packageName, onData);

        // FPS & Core Monitoring -> every 3 seconds
        monitorInterval = setInterval(() => {
            fetchAndSend(deviceId, packageName, onData);
        }, 3000);

        // Network Intelligence -> every 5 seconds (stored for cleanup)
        if (networkAnalyzer) {
            networkIntelInterval = setInterval(async () => {
                if (isFetching) return;
                await networkAnalyzer.getCurrentMetrics();
            }, 5000);
        }

        // Permission & Runtime Intelligence -> every 10 seconds
        permissionInterval = setInterval(() => {
            if (runtimeIntelligence) runtimeIntelligence.updateRuntimePermissions(packageName, deviceId);
        }, 10000);

    } catch (err) {
        onData({ error: "ADB connection error", status: "Disconnected" });
    }
};

const fetchAndSend = async (deviceId, pkg, onData) => {
    if (isFetching) return;
    isFetching = true;

    try {
        // Runtime intelligence ADB checks (sequential, lightweight)
        try {
            if (runtimeIntelligence) {
                await runtimeIntelligence.updateAppPid(deviceId, pkg);
                // Network intelligence collection removed per user request
                // await runtimeIntelligence.updateNetworkAwareness(deviceId, pkg);
                await runtimeIntelligence.updateAdsActivation(deviceId);
                await runtimeIntelligence.updateActivityFlow(deviceId, pkg);
                await runtimeIntelligence.updateNetworkDetection(deviceId, pkg);
            }
        } catch (err) { }

        // Read log file and feed to intelligence engine
        let newLogs = "";
        try {
            if (logPathRef && fs.existsSync(logPathRef)) {
                const stats = fs.statSync(logPathRef);
                if (stats.size > lastLogPosition) {
                    const buffer = Buffer.alloc(stats.size - lastLogPosition);
                    const fd = fs.openSync(logPathRef, 'r');
                    fs.readSync(fd, buffer, 0, buffer.length, lastLogPosition);
                    fs.closeSync(fd);

                    newLogs = buffer.toString('utf8');
                    const lines = newLogs.split('\n').filter(l => l.trim() !== '');
                    lastLogPosition = stats.size;

                    if (runtimeIntelligence) {
                        runtimeIntelligence.analyzeLogs(lines, pkg);
                    }
                    if (iapValidationEngine && iapValidationEngine.data.isActive) {
                        iapValidationEngine.analyzeLogs(lines);
                    }
                    if (gameplayBlockerDetector && gameplayBlockerDetector.data.isActive) {
                        gameplayBlockerDetector.analyzeLogs(lines);
                    }
                }
            }
        } catch (err) { }

        // Live Audit Analytics - Performance & Interaction Sampling
        try {
            const fps = await getFPS(deviceId, pkg);
            const mem = await getMemory(deviceId, pkg);

            if (memoryAnalyzer) {
                memoryAnalyzer.analyze(mem);
            }
            if (gameplayBlockerDetector && gameplayBlockerDetector.data.isActive) {
                if (Number.isFinite(fps) && fps > 0) gameplayBlockerDetector.recordFps(fps);
                if (Number.isFinite(mem) && mem > 0) gameplayBlockerDetector.recordPss(mem);
            }
        } catch (err) {
            console.error("[RealtimeMonitor] Audit sampling failed:", err.message);
        }

    } finally {
        isFetching = false;
    }
};

const stop = (deviceId = null) => {
    if (monitorInterval) clearInterval(monitorInterval);
    if (permissionInterval) clearInterval(permissionInterval);
    if (networkIntelInterval) clearInterval(networkIntelInterval);
    monitorInterval = null;
    permissionInterval = null;
    networkIntelInterval = null;

    // Stop MITM proxy and clean up device proxy settings
    proxyServer.stop(deviceId).catch(() => {});
};

const getAdvancedAudit = () => {
    try {
        return {
            network: networkAnalyzer ? networkAnalyzer.generateNetworkReport() : { status: "OFF", avgPing: 0 },
            memory: memoryAnalyzer ? memoryAnalyzer.getResult() : { peakMemory: 0, idleMemory: 0, issues: [] },
            runtime: runtimeIntelligence ? runtimeIntelligence.getResult() : {},
            proxy: {
                active: proxyServer.isActive(),
                port: proxyServer.getPort(),
                intercepted: proxyServer.getIntercepted()
            }
        };
    } catch (e) {
        return { network: { history: [] }, memory: { issues: [] }, runtime: {}, proxy: { active: false } };
    }
};

const getLastFPS = () => telemetry.fps.length ? telemetry.fps[telemetry.fps.length - 1] : null;

module.exports = { start, stop, getAdvancedAudit, getLastFPS };
