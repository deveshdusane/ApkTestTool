/**
 * Logcat Manager Utility
 * Handles capturing and saving device logs during a session.
 */

const fs = require('fs');
const path = require('path');
const adbHelper = require('./adbHelper');
const config = require('../config/config');


let logcatProcess = null;

/**
 * Starts capturing logcat output and streaming it to a file.
 * @param {string} sessionId The unique ID for the current session.
 * @param {string} [sessionDir] Optional explicit path for the session directory.
 * @returns {Promise<void>}
 */
const startLogcat = (sessionId, sessionDir) => {
    const dir = sessionDir || path.join(__dirname, '../../sessions', sessionId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const logFilePath = path.join(dir, 'logs.txt');

    try {
        // Add filtering to keep logcat lightweight and relevant to game testing
        logcatProcess = adbHelper.spawnCommand([
            'logcat',
            'Unity:V',
            'ActivityManager:I',
            'AndroidRuntime:E',
            // SDK Detection tags
            'FA:V', 'FA-SVC:V', 'FirebaseApp:V', 'FirebaseAnalytics:V',
            // Ads - broad list to capture events from GMS and all major SDK tags
            'Ads:V', 'AdMob:V', 'UnityAds:V',
            'GoogleMobileAds:V', 'MobileAds:V', 'GAds:V',
            'MAX:V', 'AppLovin:V', 'applovin:V',
            'IronSource:V', 'IS:V',
            'AudienceNetwork:V', 'FBInterstitialAd:V',
            'Vungle:V', 'Chartboost:V',
            // Network tags
            'ConnectivityService:I', 'NetworkMonitor:I',
            '*:S'
        ]);

        if (logcatProcess) {
            const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
            logcatProcess.stdout.pipe(logStream);
            logcatProcess.stderr.pipe(logStream);

            logcatProcess.on('exit', () => {
                logStream.end();
            });

            logcatProcess.on('error', (err) => {
                console.error('Logcat process error:', err);
            });
        } else {
            console.error('ADB logcat spawn returned null (adb.exe may be missing)');
        }
    } catch (err) {
        console.error("ADB logcat spawn failed:", err.message);
    }
};

/**
 * Stops the logcat capture process.
 */
const stopLogcat = () => {
    if (logcatProcess) {
        logcatProcess.kill();
        logcatProcess = null;
    }
};

module.exports = {
    startLogcat,
    stopLogcat
};
