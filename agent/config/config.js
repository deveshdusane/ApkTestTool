const path = require('path');

/**
 * Configuration file for the ADB Agent.
 */

// Dynamically resolve the local ADB path relative to the project root
// This avoids issues with hardcoded absolute paths across different machines
const projectRoot = path.join(__dirname, '..', '..');
const adbExecName = process.platform === 'win32' ? 'adb.exe' : 'adb';
const localAdbPath = path.join(projectRoot, 'tools', adbExecName);


module.exports = {
    // We wrap path in quotes for exec (shell) but keep a raw version for spawn
    adbCommand: `"${localAdbPath}"`, 
    adbRawPath: localAdbPath,
    timeout: 5000,
    apkPath: null,
    packageName: null,
    recordDuration: 15000,
    screenshotInterval: 5000,
    videoRecording: true,
    aaptCommand: process.platform === 'win32' ? 'aapt.exe' : 'aapt'
};
