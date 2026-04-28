const adbHelper = require('../adb/adbHelper');

let interval = null;

async function getFPS(deviceId, pkg) {
  try {
    const output = await adbHelper.runADB([
      '-s', deviceId,
      'shell',
      'dumpsys',
      'gfxinfo',
      pkg
    ]);

    let total = 0;
    let jank = 0;

    output.split('\n').forEach(line => {
      if (line.includes('Total frames rendered')) {
        const parts = line.split(':');
        if (parts[1]) total = parseInt(parts[1].trim());
      }
      if (line.includes('Janky frames')) {
        const parts = line.split(':');
        if (parts[1]) {
          const jankVal = parts[1].trim().split(' ')[0];
          jank = parseInt(jankVal);
        }
      }
    });

    if (!total) return 60; // Assume smooth if no data

    return Math.max(1, Math.round(60 - (jank / total) * 60));
  } catch (e) {
    return 0;
  }
}

async function getPing(deviceId) {
  try {
    const output = await adbHelper.runADB([
      '-s', deviceId,
      'shell',
      'ping',
      '-c',
      '1',
      '8.8.8.8'
    ]);

    const match = output.match(/time=([\d.]+)\s*ms/) || output.match(/([\d.]+)\s*ms/);
    return match ? Math.round(parseFloat(match[1])) : null;

  } catch {
    return null;
  }
}

function calculateStress(fps, ping) {
  if (fps < 30 || (ping && ping > 200)) return 'HIGH';
  if (fps < 45 || (ping && ping > 100)) return 'MEDIUM';
  return 'LOW';
}

async function collectMetrics(deviceId, pkg) {
  const fps = await getFPS(deviceId, pkg);
  const ping = await getPing(deviceId);
  const stress = calculateStress(fps, ping);

  return {
    fps,
    ping,
    stress,
    timestamp: Date.now()
  };
}

function startMonitoring(deviceId, pkg, sendToUI) {
  if (interval) clearInterval(interval);

  console.log(`[LiveMonitor] Starting real-time tracking for ${pkg} on ${deviceId}`);

  interval = setInterval(async () => {
    try {
      const data = await collectMetrics(deviceId, pkg);
      sendToUI(data);
    } catch (e) {
      console.log('Monitor error:', e);
    }
  }, 2000);
}

function stopMonitoring() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    console.log('[LiveMonitor] Monitoring stopped.');
  }
}

module.exports = {
  startMonitoring,
  stopMonitoring
};
