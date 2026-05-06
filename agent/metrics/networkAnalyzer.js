const { runADB } = require("../adb/adbHelper");
const fs = require("fs");
const gameplayBlockerDetector = require('../advanced/gameplayBlockerDetector');

let pingSamples = [];
let totalDataUsed = 0;
let disconnectCount = 0;
let lastRx = 0;
let lastTx = 0;

let pingInterval;
let netProcess;
let logcatProcess;

function startPingTracking(deviceId) {
  const pollPing = async () => {
    let success = false;
    try {
      // Use a faster ping with smaller payload
      const output = await runADB(["-s", deviceId, "shell", "ping", "-c", "1", "-w", "2", "8.8.8.8"]);
      const match = output.match(/time=([\d.]+)\s*ms/) || output.match(/([\d.]+)\s*ms/);
      if (match) {
        const ping = Math.round(parseFloat(match[1]));
        if (ping > 0) {
          pingSamples.push(ping);
          success = true;
        }
      } else {
        // Only count as disconnect if it's truly unreachable
        if (output.includes("100% packet loss") || output.includes("unreachable")) {
           disconnectCount++;
        }
      }
    } catch (err) {
      disconnectCount++;
    }
    if (gameplayBlockerDetector && gameplayBlockerDetector.data.isActive) {
      gameplayBlockerDetector.recordPing(success);
    }
  };

  pollPing();
  pingInterval = setInterval(pollPing, 4000); 
}

function stopPingTracking() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function startNetworkUsageTracking(deviceId, packageName) {
  if (!deviceId || !packageName) return;

  let uid = null;

  const pollUsage = async () => {
    try {
      if (!uid) {
        const pkgInfo = await runADB(["-s", deviceId, "shell", "dumpsys", "package", packageName]);
        const match = pkgInfo.match(/userId=(\d+)/);
        if (match) uid = match[1];
        else return;
      }

      // Optimization: Using 'dumpsys netstats --uid <uid>' if possible, or parsing detail more efficiently
      const stdout = await runADB(["-s", deviceId, "shell", "dumpsys", "netstats", "detail"]);
      if (!stdout) return;

      const lines = stdout.split("\n");
      let currentRx = 0;
      let currentTx = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(`uid=${uid}`)) {
            // Find the most recent bucket or the totals line
            const rbMatch = line.match(/rb=(\d+)/) || line.match(/rxBytes=(\d+)/);
            const tbMatch = line.match(/tb=(\d+)/) || line.match(/txBytes=(\d+)/);
            
            if (rbMatch) currentRx += parseInt(rbMatch[1]);
            if (tbMatch) currentTx += parseInt(tbMatch[1]);
        }
      }

      if (lastRx > 0 || lastTx > 0) {
        const deltaRx = currentRx - lastRx;
        const deltaTx = currentTx - lastTx;
        
        // Handle counter resets (reboots or stats clear)
        if (deltaRx >= 0 && deltaTx >= 0) {
            // Cap at 100MB per 5s as a safety check for corrupted output
            if (deltaRx + deltaTx < 100 * 1024 * 1024) {
               totalDataUsed += (deltaRx + deltaTx);
            }
        }
      }

      lastRx = currentRx;
      lastTx = currentTx;
      
    } catch (err) {}
  };

  pollUsage();
  netProcess = setInterval(pollUsage, 5000);
}

function stopNetworkUsageTracking() {
  if (netProcess) {
    clearInterval(netProcess);
    netProcess = null;
  }
}

function startNetworkDropDetection(deviceId, packageName) {
  if (!deviceId) return;

  const pollDrops = async () => {
    try {
      const stdout = await runADB(["-s", deviceId, "logcat", "-d", "-t", "100", "*:W"]);
      if (!stdout) return;

      const output = stdout.toString();
      const dropKeywords = ["Network lost", "NO_NETWORK", "DNS_FAILURE", "SocketTimeoutException"];

      // Only count drops that appear in lines referencing our package, or on lines
      // immediately following a line that references our package (stack traces).
      const lines = output.split('\n');
      let prevLineWasOurs = false;
      for (const line of lines) {
        const isOurLine = !packageName || line.includes(packageName);
        if (isOurLine || prevLineWasOurs) {
          if (dropKeywords.some(kw => line.includes(kw))) {
            disconnectCount++;
          }
        }
        prevLineWasOurs = isOurLine;
      }
    } catch (err) {}
  };

  logcatProcess = setInterval(pollDrops, 8000);
}

function stopNetworkDropDetection() {
  if (logcatProcess) {
    clearInterval(logcatProcess);
    logcatProcess = null;
  }
}

function generateNetworkReport() {
  const validSamples = pingSamples.filter(p => p > 0);
  const avgPing = validSamples.length
    ? Math.round(validSamples.reduce((a, b) => a + b, 0) / validSamples.length)
    : 0;

  const dataMB = (totalDataUsed / (1024 * 1024)).toFixed(2);

  let status = "ONLINE";
  if (avgPing === 0 && disconnectCount > 0) {
    status = "OFFLINE";
  } else if (avgPing > 500) {
    status = "STABLE (HIGH LATENCY)";
  }

  return {
    avgPing,
    dataUsedMB: dataMB,
    disconnects: Math.floor(disconnectCount / 2), // Normalized as some drops report multiple logs
    status
  };
}

function getCurrentMetrics() {
  const latestPing = pingSamples.length ? pingSamples[pingSamples.length - 1] : 0;
  const dataMB = (totalDataUsed / (1024 * 1024)).toFixed(2);

  return {
    ping: latestPing,
    dataUsedMB: dataMB,
    disconnects: disconnectCount
  };
}

// Reset function for new sessions
function reset() {
  pingSamples = [];
  totalDataUsed = 0;
  disconnectCount = 0;
  lastRx = 0;
  lastTx = 0;
}

module.exports = {
  startPingTracking,
  stopPingTracking,
  startNetworkUsageTracking,
  stopNetworkUsageTracking,
  startNetworkDropDetection,
  stopNetworkDropDetection,
  generateNetworkReport,
  getCurrentMetrics,
  reset
};
