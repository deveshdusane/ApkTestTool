const adbHelper = require('../adb/adbHelper');

/**
 * Correctly detects connected Android devices using unified adbHelper.
 */
async function getConnectedDevices() {
  const devices = await adbHelper.getConnectedDevices();
  return devices.map(d => d.id);
}

let lastCheck = 0;

/**
 * Step 3: SAFE version of checkDeviceStatus
 */
async function checkDeviceStatus() {
    try {
        const output = await adbHelper.runADB(['devices']);
        
        // Step 2: Safe Parsing - Handle null or non-string output
        if (!output || typeof output !== 'string') {
            return { connected: false, status: "NO_DEVICE", deviceId: null };
        }

        const lines = output.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith("List of devices") && !l.startsWith("* daemon"));

        if (lines.length === 0) {
            return { connected: false, status: "NO_DEVICE", deviceId: null };
        }

        const deviceLine = lines.find(line => line.includes('device') && !line.includes('unauthorized') && !line.includes('offline'));
        const unauthorizedLine = lines.find(line => line.includes('unauthorized'));

        if (deviceLine) {
            return { 
                connected: true, 
                status: "CONNECTED", 
                deviceId: deviceLine.split(/\s+/)[0] 
            };
        } else if (unauthorizedLine) {
            return { 
                connected: false, 
                status: "UNAUTHORIZED", 
                deviceId: unauthorizedLine.split(/\s+/)[0] 
            };
        }

        return { connected: false, status: "NO_DEVICE", deviceId: null };
    } catch (e) {
        return { connected: false, status: "NO_DEVICE", deviceId: null };
    }
}

/**
 * Step 4: Throttled device check to prevent command spamming
 */
async function safeCheckDevice() {
    const now = Date.now();
    if (now - lastCheck < 1000) return null; // Too fast, skip
    lastCheck = now;
    return await checkDeviceStatus();
}

module.exports = { getConnectedDevices, checkDeviceStatus, safeCheckDevice };

