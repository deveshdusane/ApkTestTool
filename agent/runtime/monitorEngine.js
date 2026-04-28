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

// Step 3: Store last values for smooth UI refresh
let lastFPS = 60;
let lastPing = 0;
let _lastTotalFrames = -1;
let _lastJankyFrames = -1;

const telemetry = {
    fps: 60,
    jank: 0,
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
 * Step 4: Smoothing function for fluid UI experience
 */
function smoothValue(oldVal, newVal) {
    return Math.round(oldVal * 0.7 + newVal * 0.3);
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
        
        // Step 4: Apply smoothing to FPS
        lastFPS = smoothValue(lastFPS, fpsData.fps);
        telemetry.fps = lastFPS;
        
        telemetry.jank = fpsData.jank;
        telemetry.stability = fpsData.stability;
    } catch (e) {
        console.error('[MonitorEngine] Heavy loop error:', e.message);
    } finally {
        isHeavyRunning = false;
    }
}

/**
 * Step 5: Improved FPS Calculation Logic
 */
async function getFPSData() {
    if (!currentDeviceId || !currentPackage) return { fps: 60, jank: 0, stability: 1.0 };

    try {
        const output = await adbHelper.runADB([
            "-s", currentDeviceId,
            'shell',
            'dumpsys',
            'gfxinfo',
            currentPackage
        ], { timeout: 8000 });

        let total = 0;
        let jank = 0;

        output.split('\n').forEach(line => {
            if (line.includes('Total frames rendered')) {
                const match = line.match(/:\s*(\d+)/);
                if (match) total = parseInt(match[1]);
            }
            if (line.includes('Janky frames')) {
                const match = line.match(/:\s*(\d+)/);
                if (match) jank = parseInt(match[1]);
            }
        });

        // Step 5: Safer FPS Logic (Delta-based)
        if (total > 0 && jank >= 0) {
            // If it's the first reading or the stats reset, just baseline it
            if (_lastTotalFrames === -1 || total < _lastTotalFrames) {
                _lastTotalFrames = total;
                _lastJankyFrames = jank;
                return { fps: 60, jank: 0, stability: 1.0 };
            }

            const deltaTotal = total - _lastTotalFrames;
            const deltaJank = jank - _lastJankyFrames;
            
            _lastTotalFrames = total;
            _lastJankyFrames = jank;

            if (deltaTotal > 0) {
                const dropRatio = Math.max(0, Math.min(1, deltaJank / deltaTotal));
                const fps = Math.max(1, Math.round(60 * (1 - dropRatio)));

                return {
                    fps,
                    jank: deltaJank,
                    stability: parseFloat((1 - dropRatio).toFixed(2))
                };
            }
        }

        return { fps: lastFPS || 60, jank: 0, stability: 1.0 };
    } catch (err) {
        return { fps: lastFPS || 60, jank: 0, stability: 1.0 };
    }
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

    // Step 2: Setup UI refresh loop (Every 1s)
    loops.refresh = setInterval(uiRefreshLoop, 1000);

    // Setup background ADB loops (Throttled)
    loops.light = setInterval(lightLoop, 5000);   
    loops.medium = setInterval(mediumLoop, 7000); 
    loops.heavy = setInterval(heavyLoop, 10000);  
}

/**
 * Stop all loops cleanly
 */
function stopMonitoring() {
    console.log('[MonitorEngine] Stopping Monitoring Engine...');
    Object.values(loops).forEach(clearInterval);
    loops = {};
    isHeavyRunning = false;
    isMediumRunning = false;
    isLightRunning = false;
    currentPackage = null;
    currentDeviceId = null;
    _lastTotalFrames = -1;
    _lastJankyFrames = -1;
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getTelemetry: () => telemetry
};
