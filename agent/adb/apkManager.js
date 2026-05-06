/**
 * APK Manager Utility
 * Handles APK installation and app launching via ADB.
 */

const adbHelper = require('./adbHelper');
const config = require('../config/config');
const AppInfoParser = require('app-info-parser');

/**
 * Installs an APK on the connected device.
 * @param {string} apkPath Path to the APK file.
 * @returns {Promise<boolean|string>} Returns true on success, or an error message on failure.
 */
const installApk = async (apkPath, deviceId = null) => {
    try {
        // Validation: Check if apkPath is provided
        if (!apkPath) {
            return 'APK path not provided in config';
        }

        // Step 2 & 3: Use -r flag for faster reinstall and a 60s timeout for large APKs
        const targetArgs = deviceId ? ['-s', deviceId] : [];
        const output = await adbHelper.runADB([...targetArgs, 'install', '-r', apkPath], { timeout: 60000 });
        
        if (output.includes('Success')) {
            return true;
        } else {
            return output || 'Installation failed with unknown error';
        }
    } catch (err) {
        const errorMsg = err.message || err.toString() || 'Unknown error';
        
        if (errorMsg.includes('INSTALL_FAILED_ALREADY_EXISTS')) {
            return 'App already exists on device';
        }
        if (errorMsg.includes('no devices/emulators found')) {
            return 'No device connected';
        }
        
        return errorMsg;
    }
};

/**
 * Launches an application using its package name.
 * @param {string} packageName Package name of the app (e.g., com.example.game).
 * @returns {Promise<boolean>}
 */
const launchApp = async (packageName, deviceId = null) => {
    try {
        if (!packageName) {
            throw new Error('Package name not provided in config');
        }

        const targetArgs = deviceId ? ['-s', deviceId] : [];
        const output = await adbHelper.runADB([...targetArgs, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
        if (!output || /Error|No activities found|monkey aborted/i.test(output)) return false;
        return /Events injected:\s*1/i.test(output);
    } catch (err) {
        return false;
    }
};

/**
 * Extracts the package name from an APK.
 * @param {string} apkPath
 * @returns {Promise<string>}
 */
const getPackageInfo = async (apkPath) => {
    try {
        const parser = new AppInfoParser(apkPath);
        const result = await parser.parse();
        return result.package;
    } catch (err) {
        throw new Error(`Failed to parse APK: ${err.message}`);
    }
};

/**
 * Step 2: Waits for the app to be fully ready by checking for its PID.
 * @param {string} packageName 
 * @returns {Promise<void>}
 */
const waitForAppReady = (packageName, deviceId = null) => {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const interval = setInterval(async () => {
            try {
                const targetArgs = deviceId ? ['-s', deviceId] : [];
                const output = await adbHelper.runADB([...targetArgs, 'shell', 'pidof', packageName]);
                if (output && output.trim() !== '') {
                    clearInterval(interval);
                    resolve();
                    return;
                }
            } catch (e) {
                // Ignore errors during polling
            }

            attempts++;
            if (attempts > 10) {
                clearInterval(interval);
                reject(new Error('App failed to start within timeout'));
            }
        }, 1000);
    });
};

module.exports = {
    installApk,
    launchApp,
    waitForAppReady,
    getPackageInfo
};
