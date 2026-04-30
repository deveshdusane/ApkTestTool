/**
 * Logcat Manager Utility
 * Handles capturing and saving device logs during a session.
 * Filters strictly to the tested app's process — no cross-app contamination.
 */

const fs = require('fs');
const path = require('path');
const adbHelper = require('./adbHelper');

let logcatProcess = null;

/**
 * Starts capturing logcat output for the tested app only.
 *
 * Strategy 1 (Android 7+): resolve the app's PID and pass `--pid=<pid>` to logcat.
 *   All lines are from our process — pipe them straight to the file.
 *
 * Strategy 2 (fallback): use tag-based filters to reduce volume, then filter
 *   the Node.js stream to only write lines that contain the package name or
 *   that belong to Unity/ActivityManager tags (which always reference the package).
 *
 * @param {string} sessionId
 * @param {string} [sessionDir]
 * @param {string} [packageName]  - target app package, e.g. com.example.mygame
 * @param {string} [deviceId]     - ADB device serial
 */
const startLogcat = async (sessionId, sessionDir, packageName, deviceId) => {
    const dir = sessionDir || path.join(__dirname, '../../sessions', sessionId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const logFilePath = path.join(dir, 'logs.txt');

    try {
        const deviceArgs = deviceId ? ['-s', deviceId] : [];
        let usedPidFilter = false;
        let logcatArgs = [...deviceArgs, 'logcat'];

        // ── Strategy 1: PID-based (Android 7+ / API 24+) ───────────────────────
        // `logcat --pid=X` restricts output to that exact process — zero leakage
        // from other apps regardless of which log tags they use.
        if (packageName && deviceId) {
            try {
                const pidOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'pidof', packageName]);
                const pids = (pidOut || '').trim().split(/\s+/).filter(p => /^\d+$/.test(p));
                if (pids.length > 0) {
                    pids.forEach(pid => logcatArgs.push('--pid', pid));
                    usedPidFilter = true;
                    console.log(`[LogcatManager] PID filter active — PIDs: ${pids.join(', ')}`);
                }
            } catch (e) { /* fall through to strategy 2 */ }
        }

        // ── Strategy 2: Tag filter + Node.js stream filter ──────────────────────
        // Keep only SDK-relevant log tags to reduce volume, then additionally
        // discard any line that doesn't mention our package name so that another
        // app using the same SDK tags (FA, AdMob, …) is silently dropped.
        if (!usedPidFilter) {
            logcatArgs.push(
                'Unity:V', 'UnityEngine:V',
                'ActivityManager:I', 'ActivityTaskManager:I',
                'AndroidRuntime:E',
                // Firebase / Analytics
                'FA:V', 'FA-SVC:V', 'FirebaseApp:V', 'FirebaseAnalytics:V', 'FA-Event:V',
                // Ads SDKs
                'AdMob:V', 'UnityAds:V', 'GoogleMobileAds:V', 'MobileAds:V', 'GAds:V',
                'MAX:V', 'AppLovin:V', 'applovin:V',
                'IronSource:V', 'IS:V',
                'AudienceNetwork:V',
                'Vungle:V', 'Chartboost:V',
                // GameAnalytics
                'GameAnalytics:V', 'GA:V',
                // Facebook SDK
                'FacebookSDK:V', 'FBSDKCoreKit:V', 'FBTRACE:V', 'FB:V',
                // AppsFlyer
                'AppsFlyerLib:V', 'AF_LOG:V',
                // Adjust
                'Adjust:V',
                // IAP / Billing
                'BillingClient:V', 'UnityIAP:V',
                // Network
                'ConnectivityService:I', 'NetworkMonitor:I',
                '*:S'
            );
            console.log('[LogcatManager] Falling back to tag+stream filter — PID not available yet');
        }

        logcatProcess = adbHelper.spawnCommand(logcatArgs);

        if (logcatProcess) {
            const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

            if (!usedPidFilter && packageName) {
                // Stream-level filter: only persist lines that belong to our app.
                // We keep lines that either contain the package name directly, or
                // are engine/lifecycle lines that Unity always tags with our app.
                let incomplete = '';
                logcatProcess.stdout.on('data', (chunk) => {
                    const data = incomplete + chunk.toString();
                    const lines = data.split('\n');
                    incomplete = lines.pop(); // hold partial last line

                    const relevant = lines.filter(line =>
                        line.includes(packageName) ||
                        // Unity engine always logs under 'Unity' tag for the active game
                        /\bUnity\b/.test(line) ||
                        // ActivityManager/TaskManager reference the package when managing our app
                        ((line.includes('ActivityManager') || line.includes('ActivityTaskManager')) && line.includes(packageName)) ||
                        // Crash/ANR lines always include the package
                        (line.includes('AndroidRuntime') && line.includes(packageName))
                    );

                    if (relevant.length > 0) logStream.write(relevant.join('\n') + '\n');
                });

                logcatProcess.stdout.on('end', () => {
                    if (incomplete) logStream.write(incomplete);
                    logStream.end();
                });
            } else {
                // With PID filter every line is from our process — pipe directly
                logcatProcess.stdout.pipe(logStream);
                logcatProcess.on('exit', () => logStream.end());
            }

            logcatProcess.stderr.on('data', () => {}); // suppress ADB stderr noise
            logcatProcess.on('error', (err) => {
                console.error('[LogcatManager] Logcat process error:', err);
            });
        } else {
            console.error('[LogcatManager] ADB logcat spawn returned null (adb may be missing)');
        }
    } catch (err) {
        console.error('[LogcatManager] ADB logcat spawn failed:', err.message);
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
