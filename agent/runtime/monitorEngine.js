const adbHelper = require('../adb/adbHelper');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

// Global engine state
let loops = {};
let currentPackage = null;
let currentDeviceId = null;
let isHeavyRunning = false;
let isMediumRunning = false;
let isLightRunning = false;
let uiCallback = null;
let failCount = 0;

// Store last measured values — null means "not yet measured"
let lastFPS = null;
let lastPing = 0;
let _lastTotalFrames = -1;
let _lastJankyFrames = -1;
let _lastFPSCallTime = null;       // timestamp of last gfxinfo read, for time-delta FPS
let _lastFrameTimestamp = null;   // latest intendedVsync seen, to detect stale framestats

// EMA smoothing — prevents single noisy readings from dominating the display
let _emaFPS = null;

// Rolling history for stable FPS used by device prediction (trims outliers)
const _fpsHistory = [];
const FPS_HISTORY_SIZE = 8; // ~24 s at 3 s intervals

const telemetry = {
    fps: null,
    jank: 0,
    jankPct: 0,
    frameTime: null,
    stability: 1.0,
    memory: 0,
    avgCPU: 0,
    ping: 0,
    battery: 'Unknown',
    status: 'ONLINE'
};

/**
 * PRODUCTION-GRADE MONITORING ENGINE (V2 - Real-time Feel)
 * 
 * Architecture:
 * - UI Refresh (1s): Fast updates using smoothed cached values
 * - Light Loop (5s): Network & Connectivity (Safe)
 * - Medium Loop (7s): Memory PSS (Moderate)
 * - Heavy Loop (10s): GFXInfo & FPS (Intensive)
 */

async function ensureDevice() {
    const devices = await adbHelper.getConnectedDevices();
    
    if (currentDeviceId) {
        const isStillConnected = devices.some(d => d.id === currentDeviceId);
        if (isStillConnected) return currentDeviceId;
        currentDeviceId = null;
    }

    if (devices.length === 0) {
        throw new Error("No device connected");
    }
    
    currentDeviceId = devices[0].id;
    return currentDeviceId;
}


/**
 * Step 2: UI Refresh Loop (Fast updates without ADB strain)
 */
function uiRefreshLoop() {
    if (uiCallback) {
        broadcastData();
    }
}

/**
 * Light Loop: Network & Status
 */
async function lightLoop() {
    if (isLightRunning) return;
    isLightRunning = true;

    try {
        await ensureDevice();
        const ping = await getPingSafe();
        
        // Step 7: Status Delay Logic
        if (ping === null) {
            failCount++;
            if (failCount >= 2) {
                telemetry.status = 'OFFLINE';
                telemetry.ping = 0;
            }
        } else {
            failCount = 0;
            telemetry.status = 'ONLINE';
            lastPing = ping;
            telemetry.ping = ping;
        }

    } catch (e) {
        console.error('[MonitorEngine] Connection lost or light loop error:', e.message);
        currentDeviceId = null;
        telemetry.status = 'OFFLINE';
        telemetry.ping = 0;
    } finally {
        isLightRunning = false;
    }
}

/**
 * Medium Loop: Memory Usage
 */
async function mediumLoop() {
    if (isMediumRunning || !currentPackage) return;
    isMediumRunning = true;

    try {
        const memory = await getMemory();
        telemetry.memory = memory;

        const cpu = await getCPU();
        telemetry.avgCPU = cpu;

        // Fetch battery level (Sequential to avoid lock)
        if (currentDeviceId) {
            const batteryData = await adbHelper.runADB(['-s', currentDeviceId, 'shell', 'dumpsys', 'battery']);
            const levelMatch = batteryData.match(/level:\s+(\d+)/);
            if (levelMatch) {
                telemetry.battery = levelMatch[1];
            }
        }
    } catch (e) {
    } finally {
        isMediumRunning = false;
    }
}

async function getCPU() {
    if (!currentDeviceId || !currentPackage) return 0;
    try {
        const output = await adbHelper.runADB(['-s', currentDeviceId, 'shell', 'dumpsys', 'cpuinfo'], { timeout: 5000 });
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes(currentPackage)) {
                const match = line.match(/(\d+)%\s+\d+\//);
                if (match) return parseInt(match[1]);
            }
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Heavy Loop: FPS & GFXInfo
 */
async function heavyLoop() {
    if (isHeavyRunning || !currentPackage) return;
    isHeavyRunning = true;

    try {
        const fpsData = await getFPSData();

        // Apply EMA smoothing (α=0.4) so a single noisy reading can't dominate.
        // A game running at 60 FPS that briefly reports 2 will recover in 2-3 cycles
        // rather than flashing an alarming low value in the UI.
        if (fpsData.fps !== null && fpsData.fps > 0) {
            _emaFPS = _emaFPS === null
                ? fpsData.fps
                : Math.round(_emaFPS * 0.6 + fpsData.fps * 0.4);
            lastFPS = _emaFPS;

            _fpsHistory.push(_emaFPS);
            if (_fpsHistory.length > FPS_HISTORY_SIZE) _fpsHistory.shift();
        }

        telemetry.fps = lastFPS;
        telemetry.jank = fpsData.jank;
        telemetry.jankPct = fpsData.jankPct || 0;
        telemetry.frameTime = (lastFPS != null && lastFPS > 0)
            ? parseFloat((1000 / lastFPS).toFixed(1))
            : null;
        telemetry.stability = fpsData.stability;
    } catch (e) {
        console.error('[MonitorEngine] Heavy loop error:', e.message);
    } finally {
        isHeavyRunning = false;
    }
}

/**
 * FPS via three methods in priority order:
 * 1. gfxinfo framestats  — per-frame timestamps (View / hardware-canvas apps)
 * 2. gfxinfo cumulative  — frame count ÷ elapsed time (broader app support)
 * 3. SurfaceFlinger      — compositor-reported FPS (Unity/Unreal/native, Android 10+)
 */
async function getFPSData() {
    if (!currentDeviceId || !currentPackage) return { fps: lastFPS, jank: 0, jankPct: 0, stability: 1.0 };

    // ── Method 1: framestats (View-based / hardware-canvas apps) ─────────────
    try {
        const out = await adbHelper.runADB([
            '-s', currentDeviceId, 'shell', 'dumpsys', 'gfxinfo', currentPackage, 'framestats'
        ], { timeout: 4000 });

        const frames = [];
        let jankCount = 0;
        let inProfile = false;

        for (const raw of out.split('\n')) {
            const line = raw.trim();
            if (line === '---PROFILEDATA---') { inProfile = !inProfile; continue; }
            if (!inProfile || !line || line.startsWith('Flags')) continue;
            const parts = line.split(',');
            if (parts.length < 14) continue;
            const flags = parseInt(parts[0]);
            if (flags > 1 || isNaN(flags)) continue;
            const intendedVsync = parseInt(parts[1]);
            const frameCompleted = parseInt(parts[13]);
            if (!intendedVsync || intendedVsync <= 0) continue;
            frames.push({ intendedVsync, frameCompleted });
            if (frameCompleted - intendedVsync > 16_666_666) jankCount++;
        }

        if (frames.length >= 20) {
            frames.sort((a, b) => a.intendedVsync - b.intendedVsync);
            const latestTs = frames[frames.length - 1].intendedVsync;
            const spanS = (latestTs - frames[0].intendedVsync) / 1_000_000_000;

            // Only reject if truly stale — no new frames since last poll.
            // Removed the spanS > 5s check: it was incorrectly rejecting valid
            // data for games running below ~26 FPS (128 frames / 5s = 25.6 FPS).
            const isStale = _lastFrameTimestamp !== null && latestTs === _lastFrameTimestamp;

            if (!isStale && spanS > 0.1) {
                _lastFrameTimestamp = latestTs;
                const fps = Math.min(120, Math.max(1, Math.round((frames.length - 1) / spanS)));
                const jankPct = Math.round((jankCount / frames.length) * 100);
                lastFPS = fps;
                return { fps, jank: jankCount, jankPct, stability: parseFloat((1 - jankCount / frames.length).toFixed(2)) };
            }
            _lastFrameTimestamp = latestTs;
        }
    } catch (e) { /* fall through */ }

    // ── Method 2: gfxinfo cumulative — actual frame count over elapsed time ──
    try {
        const out = await adbHelper.runADB([
            '-s', currentDeviceId, 'shell', 'dumpsys', 'gfxinfo', currentPackage
        ], { timeout: 4000 });

        let total = 0, jank = 0;
        for (const line of out.split('\n')) {
            if (line.includes('Total frames rendered')) {
                const m = line.match(/:\s*(\d+)/); if (m) total = parseInt(m[1]);
            }
            if (line.includes('Janky frames') && !line.includes('%')) {
                const m = line.match(/:\s*(\d+)/); if (m) jank = parseInt(m[1]);
            }
        }

        if (total > 0) {
            const now = Date.now();
            if (_lastTotalFrames === -1 || total < _lastTotalFrames) {
                _lastTotalFrames = total;
                _lastJankyFrames = jank;
                _lastFPSCallTime = now;
                return { fps: lastFPS, jank: 0, jankPct: 0, stability: 1.0 };
            }
            const dTotal = total - _lastTotalFrames;
            const dJank  = jank  - _lastJankyFrames;
            const dSec   = _lastFPSCallTime ? (now - _lastFPSCallTime) / 1000 : 3;
            _lastTotalFrames = total;
            _lastJankyFrames = jank;
            _lastFPSCallTime = now;

            if (dTotal > 0 && dSec > 0.5) {
                const rawFps = dTotal / dSec;
                // Sanity gate: reject if more than 3× or less than ⅓ of the last
                // known value — these are counter-reset artefacts, not real readings
                const plausible = lastFPS === null
                    || (rawFps >= lastFPS / 3 && rawFps <= lastFPS * 3);
                if (plausible) {
                    const fps = Math.min(120, Math.max(1, Math.round(rawFps)));
                    const dropRatio = Math.max(0, Math.min(1, dJank / dTotal));
                    const jankPct = Math.round(dropRatio * 100);
                    lastFPS = fps;
                    return { fps, jank: dJank, jankPct, stability: parseFloat((1 - dropRatio).toFixed(2)) };
                }
            }
        }
    } catch (e) { /* fall through */ }

    // ── Method 3: SurfaceFlinger compositor FPS (Unity/Unreal/native games) ──
    // Handles multiple Android versions: Android 10 (fps=X), 11 (fps = X),
    // 12+ (fps: X / averageFPS=X). The wider grep catches all known formats.
    try {
        const sfOut = await adbHelper.runADB([
            '-s', currentDeviceId, 'shell',
            `dumpsys SurfaceFlinger | grep -E -i "${currentPackage}" -A 8 | grep -E -i "fps" | head -5`
        ], { timeout: 3000 });

        if (sfOut && sfOut.trim()) {
            // Match fps=X, fps: X, fps = X, averageFPS=X (all common formats)
            const m = sfOut.match(/(?:average)?fps[: =]+([\d.]+)/i);
            if (m) {
                const fps = Math.min(120, Math.max(1, Math.round(parseFloat(m[1]))));
                if (fps > 1) { // 1 FPS from SurfaceFlinger usually means idle/no data
                    lastFPS = fps;
                    return { fps, jank: 0, jankPct: telemetry.jankPct || 0, stability: telemetry.stability || 1.0 };
                }
            }
        }
    } catch (e) { /* fall through */ }

    return { fps: lastFPS, jank: 0, jankPct: 0, stability: 1.0 };
}

async function getPingSafe() {
    if (!currentDeviceId) return null;
    try {
        const out = await adbHelper.runADB(["-s", currentDeviceId, 'shell', 'ping', '-c', '1', '8.8.8.8'], { timeout: 3000 });
        const match = out.match(/time=([\d.]+)/);
        return match ? Math.round(parseFloat(match[1])) : null;
    } catch {
        return null;
    }
}

async function getMemory() {
    if (!currentDeviceId || !currentPackage) return 0;
    try {
        const out = await adbHelper.runADB([
            "-s", currentDeviceId,
            'shell',
            'dumpsys',
            'meminfo',
            currentPackage
        ], { timeout: 5000 });

        const match = out.match(/TOTAL[:\s]+\s+(\d+)/i) || out.match(/TOTAL\s+PSS:\s+(\d+)/i);
        return match ? Math.round(parseInt(match[1]) / 1024) : 0;
    } catch {
        return 0;
    }
}

function broadcastData() {
    if (uiCallback) {
        const runtimeIntelligence = require('../advanced/runtimeIntelligence');
        uiCallback({
            fps: telemetry.fps,
            memory: telemetry.memory,
            network: telemetry.status,
            device: currentDeviceId || "Real Android Device",
            battery: telemetry.battery,
            timestamp: Date.now(),
            advanced: {
                runtime: runtimeIntelligence ? runtimeIntelligence.getResult() : null,
                ping: telemetry.ping || 0,
                jank: telemetry.jank,
                jankPct: telemetry.jankPct,
                frameTime: telemetry.frameTime,
                cpuUsage: telemetry.avgCPU,
                stability: telemetry.stability,
                trend: telemetry.status === 'OFFLINE' ? "DEGRADING" : calculateTrend()
            }
        });
    }
}

/**
 * Step 2: Trend Calculation for UI Refresh
 */
function calculateTrend() {
    if (telemetry.fps > 55 && telemetry.ping < 100) return "STABLE";
    if (telemetry.fps < 40 || telemetry.ping > 200) return "DEGRADING";
    return "NORMAL";
}

/**
 * Start the Production Monitor
 */
async function startMonitoring(pkg, deviceId, onData) {
    stopMonitoring();

    currentPackage = pkg;
    currentDeviceId = deviceId;
    uiCallback = onData;
    failCount = 0;

    console.log(`[MonitorEngine] Starting Enhanced Real-time Monitoring for: ${pkg}`);

    if (!deviceId) {
        try {
            await adbHelper.runADB(['start-server']);
        } catch (e) {
            console.warn('[MonitorEngine] ADB restart failed');
        }
    }

    // Initial background runs
    lightLoop();
    mediumLoop();
    heavyLoop();

    // One-shot memory scan: fires 8 s after start, giving SDKs time to init and write keys to heap
    loops.memoryScan = setTimeout(async () => {
        try {
            const runtimeIntelligence = require('../advanced/runtimeIntelligence');
            if (runtimeIntelligence && pkg && deviceId) {
                await runtimeIntelligence.runMemoryScan(deviceId, pkg);
            }
        } catch (e) {
            console.warn('[MonitorEngine] Memory scan error:', e.message);
        }
    }, 8000);

    // Step 2: Setup UI refresh loop (Every 1s)
    loops.refresh = setInterval(uiRefreshLoop, 1000);

    // Setup background ADB loops (Throttled)
    loops.light = setInterval(lightLoop, 5000);
    loops.medium = setInterval(mediumLoop, 6000);
    loops.heavy = setInterval(heavyLoop, 3000);   // 3s for responsive FPS updates
}

/**
 * Stop all loops cleanly
 */
function stopMonitoring() {
    console.log('[MonitorEngine] Stopping Monitoring Engine...');
    if (loops.memoryScan) clearTimeout(loops.memoryScan);
    Object.values(loops).forEach(clearInterval);
    loops = {};
    isHeavyRunning = false;
    isMediumRunning = false;
    isLightRunning = false;
    currentPackage = null;
    currentDeviceId = null;
    lastFPS = null;
    _lastTotalFrames = -1;
    _lastJankyFrames = -1;
    _lastFPSCallTime = null;
    _lastFrameTimestamp = null;
    _emaFPS = null;
    _fpsHistory.length = 0;
    telemetry.fps = null;
    telemetry.frameTime = null;
    telemetry.jank = 0;
    telemetry.jankPct = 0;
    telemetry.memory = 0;
    telemetry.avgCPU = 0;
    telemetry.ping = 0;
    telemetry.battery = 'Unknown';
    telemetry.status = 'ONLINE';
}

/**
 * Returns a stable FPS value for device prediction by trimming outliers from
 * the rolling history and computing the trimmed mean.
 * Falls back to the current EMA value when history is too short.
 */
function getStableFPS() {
    if (_fpsHistory.length < 3) return telemetry.fps;
    const sorted = [..._fpsHistory].sort((a, b) => a - b);
    // Trim the bottom and top 12.5% to remove burst/stall artefacts
    const trim = Math.max(1, Math.floor(sorted.length * 0.125));
    const trimmed = sorted.slice(trim, sorted.length - trim);
    return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getTelemetry: () => telemetry,
    getStableFPS
};
