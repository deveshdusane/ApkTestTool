/**
 * Screenshot Manager Utility
 * Handles periodic screenshot capture during a test session.
 */

const adbHelper = require('./adbHelper');
const config = require('../config/config');
const path = require('path');
const fs = require('fs');


let screenshotIntervalId = null;

/**
 * Starts periodic screenshot capture.
 * @param {string} sessionId The session ID.
 * @param {string} [sessionDir] Optional explicit path for the session directory.
 */
const startScreenshotCapture = (sessionId, sessionDir) => {
    const dir = sessionDir || path.join(__dirname, '../../sessions', sessionId);
    const screenshotsDir = path.join(dir, 'screenshots');

    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    screenshotIntervalId = setInterval(async () => {
        const timestamp = Date.now();
        const localPath = path.join(screenshotsDir, `shot_${timestamp}.png`);
        
        try {
            // Using exec-out to get the binary stream directly for better performance
            const proc = adbHelper.spawnCommand(['exec-out', 'screencap', '-p']);
            if (proc) {
                const writeStream = fs.createWriteStream(localPath);
                proc.stdout.pipe(writeStream);
                proc.on('error', (err) => {
                    console.error('Screencap stream error:', err);
                });
            }
        } catch (err) {
            console.error('Screenshot failed:', err.message);
        }

    }, config.screenshotInterval);
};

/**
 * Stops the periodic screenshot capture.
 */
const stopScreenshotCapture = () => {
    if (screenshotIntervalId) {
        clearInterval(screenshotIntervalId);
        screenshotIntervalId = null;
    }
};

module.exports = {
    startScreenshotCapture,
    stopScreenshotCapture
};
