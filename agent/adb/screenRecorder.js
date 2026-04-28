/**
 * Screen Recorder Utility
 * Handles video recording of the device screen using ADB.
 */

const adbHelper = require('./adbHelper');
const config = require('../config/config');
const path = require('path');
const fs = require('fs');


let recordingProcess = null;
const remotePath = '/data/local/tmp/recording.mp4';

const startRecording = async () => {
    try {
        console.log("RECORDING START (Spawn)");
        recordingProcess = adbHelper.spawnCommand(['shell', 'screenrecord', remotePath]);
    } catch (err) {
        console.error("ADB recording spawn failed:", err.message);
    }


    recordingProcess.on('error', (err) => {
        console.error('Recording process error:', err);
    });
};

/**
 * Stops the recording and pulls the file to the local session folder.
 * @param {string} sessionId The session ID.
 * @param {string} [sessionDir] Optional explicit path for the session directory.
 * @returns {Promise<boolean>}
 */
const stopRecording = (sessionId, sessionDir) => {
    return new Promise(async (resolve, reject) => {
        if (!recordingProcess) {
            resolve(false);
            return;
        }

        recordingProcess.kill('SIGINT');

        setTimeout(async () => {
            try {
                const dir = sessionDir || path.join(__dirname, '../../sessions', sessionId);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const localPath = path.join(dir, 'video.mp4');

                await adbHelper.runADB(['pull', remotePath, localPath]);
                await adbHelper.runADB(['shell', 'rm', remotePath]);

                resolve(true);
            } catch (err) {
                console.error('Failed to pull video:', err);
                resolve(false);
            }
        }, 2000);
    });
};

module.exports = {
    startRecording,
    stopRecording
};
