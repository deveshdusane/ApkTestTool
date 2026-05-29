const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getToolPath } = require('../utils/toolPaths');
const logger = require('../utils/logger');

const SCRCPY_BINARY = process.platform === 'win32' ? 'scrcpy/scrcpy.exe' : 'scrcpy/scrcpy';
const ADB_BINARY = process.platform === 'win32' ? 'adb.exe' : 'adb';

const FLAGS = [
    '--max-size', '720',
    '--video-bit-rate', '4M',
    '--audio-bit-rate', '128K',
    '--window-title', 'TestMate Cast'
];

let proc = null;

function start(deviceId) {
    if (proc) {
        logger.logWarning('scrcpy already running — ignoring duplicate start');
        return;
    }
    const binary = getToolPath(SCRCPY_BINARY);
    if (!fs.existsSync(binary)) {
        logger.logWarning(`scrcpy not found at ${binary} — device cast disabled. Download from https://github.com/Genymobile/scrcpy/releases and extract into tools/${process.platform === 'win32' ? 'win' : 'mac'}/scrcpy/`);
        return;
    }

    const args = deviceId ? ['--serial', deviceId, ...FLAGS] : [...FLAGS];

    const adbPath = getToolPath(ADB_BINARY);
    const env = { ...process.env };
    if (fs.existsSync(adbPath)) env.ADB = adbPath;

    try {
        proc = spawn(binary, args, {
            cwd: path.dirname(binary),
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            env
        });
    } catch (err) {
        logger.logWarning(`scrcpy spawn failed: ${err.message}`);
        proc = null;
        return;
    }

    proc.stdout.on('data', d => process.stdout.write(`[scrcpy] ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`[scrcpy] ${d}`));

    proc.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
            logger.logWarning(`scrcpy exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
        }
        proc = null;
    });

    proc.on('error', err => {
        logger.logWarning(`scrcpy process error: ${err.message}`);
        proc = null;
    });

    logger.logInfo(`Device cast started for ${deviceId || 'default device'}`);
}

function stop() {
    if (!proc) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
        } else {
            proc.kill('SIGTERM');
        }
    } catch (err) {
        logger.logWarning(`scrcpy stop failed: ${err.message}`);
    }
    proc = null;
}

function isRunning() {
    return proc !== null;
}

module.exports = { start, stop, isRunning };
