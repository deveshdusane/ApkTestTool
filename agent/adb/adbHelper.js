const { spawn, execFile } = require('child_process');
const fs = require('fs');
const { getToolPath } = require('../utils/toolPaths');

const adbExecName = process.platform === 'win32' ? 'adb.exe' : 'adb';
let adbPath = getToolPath(adbExecName);

// Fallback to system adb if bundled one is missing
if (!fs.existsSync(adbPath)) {
    try {
        const { execSync } = require('child_process');
        execSync('adb version', { stdio: 'ignore' });
        adbPath = 'adb';
    } catch (e) {
        // Leave as is so error is logged
    }
}

let adbQueue = Promise.resolve();

/**
 * Unified ADB runner using bundled tools/adb.exe
 * Uses async queue to serialize commands instead of silently dropping them
 */
async function runADB(args, options = {}) {
  const { timeout = 5000 } = options;
  
  // Queue commands sequentially to prevent ADB collisions
  const result = new Promise((resolve) => {
    adbQueue = adbQueue.then(async () => {
      try {
        if (adbPath !== 'adb' && !fs.existsSync(adbPath)) {
          console.error("ADB tool missing at:", adbPath);
          resolve('');
          return;
        }

        const output = await new Promise((innerResolve) => {
          execFile(adbPath, args, { timeout }, (error, stdout, stderr) => {
            if (error) {
              innerResolve(stderr ? stderr.toString().trim() : '');
            } else {
              innerResolve(stdout.toString());
            }
          });
        });
        resolve(output);
      } catch (e) {
        resolve('');
      }
    }).catch(() => {
      resolve('');
    });
  });

  return result;
}

/**
 * Step 2: Fix device check logic
 */
const getConnectedDevices = async () => {
    try {
        const output = await runADB(['devices']);
        const lines = output.split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith("List of devices attached") && !l.startsWith("* daemon"));

        const devices = [];
        for (const line of lines) {
            if (line.includes("device") || line.includes("unauthorized") || line.includes("offline")) {
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    devices.push({ id: parts[0], status: parts[1] });
                }
            }
        }
        return devices;
    } catch (err) {
        return [];
    }
};

/**
 * Simple check for ADB binary existence
 */
const checkAdbInstalled = async () => {
    return adbPath === 'adb' || fs.existsSync(adbPath);
};

const getDeviceInfo = async (deviceId = null) => {
    try {
        const prefix = deviceId ? ['-s', deviceId] : [];
        
        // Fetch sequentially to respect adbBusy lock and avoid collisions
        const model = await runADB([...prefix, 'shell', 'getprop', 'ro.product.model']);
        const version = await runADB([...prefix, 'shell', 'getprop', 'ro.build.version.release']);
        const sdk = await runADB([...prefix, 'shell', 'getprop', 'ro.build.version.sdk']);
        const cpu = await runADB([...prefix, 'shell', 'getprop', 'ro.product.cpu.abi']);
        const memInfo = await runADB([...prefix, 'shell', 'cat', '/proc/meminfo']);
        const batteryData = await runADB([...prefix, 'shell', 'dumpsys', 'battery']);

        const levelMatch = batteryData.match(/level:\s+(\d+)/);
        const batteryLevel = levelMatch ? levelMatch[1] : 'Unknown';

        const totalMemMatch = memInfo.match(/MemTotal:\s+(\d+)\s+kB/);
        const totalRAM = totalMemMatch ? Math.round(parseInt(totalMemMatch[1]) / (1024 * 1024)) : 'Unknown';

        const devices = await getConnectedDevices();
        const isConnected = devices.length > 0;
        const selectedDevice = deviceId || (isConnected ? devices[0].id : null);

        return {
            id: selectedDevice,
            model: model.trim() || 'Unknown Device',
            androidVersion: version.trim() || 'Unknown',
            apiLevel: sdk.trim() || 'N/A',
            cpu: cpu.trim() || 'Unknown',
            ram: totalRAM,
            battery: batteryLevel,
            status: isConnected ? 'CONNECTED' : 'DISCONNECTED'
        };
    } catch (err) {
        return { 
            id: deviceId,
            model: 'Unknown', 
            androidVersion: 'Unknown', 
            apiLevel: 'N/A', 
            cpu: 'Unknown',
            ram: 'Unknown',
            battery: 'Unknown', 
            status: 'Disconnected' 
        };
    }
};

/**
 * Spawns a child process for long-running commands.
 * @param {string[]} args Array of arguments.
 * @returns {ChildProcess}
 */
const spawnCommand = (args) => {
    if (adbPath !== 'adb' && !fs.existsSync(adbPath)) {
        console.error("ADB tool missing at:", adbPath);
        return null;
    }
    return spawn(adbPath, args);
};

module.exports = {
    adbPath,
    runADB,
    spawnCommand,
    checkAdbInstalled,
    getConnectedDevices,
    getDeviceInfo
};
