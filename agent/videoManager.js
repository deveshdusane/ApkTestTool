const path = require('path');
const adbHelper = require('./adb/adbHelper');
const logger = require('./utils/logger');
const config = require('./config/config');

class VideoManager {
    constructor() {
        this.recordingProcess = null;
        this.remotePath = '/data/local/tmp/testmate_video.mp4';
        this.isRecording = false;
    }

    async startRecording() {
        if (!config.videoRecording) return;

        this.isRecording = false;
        this.recordingProcess = null;

        logger.logInfo('🎬 Starting video recording...');

        const proc = adbHelper.spawnCommand([
            'shell', 'screenrecord', '--bit-rate', '4M', this.remotePath
        ]);

        if (!proc) {
            logger.logWarning('⚠ Video recording skipped (ADB unavailable).');
            return;
        }

        proc.on('error', (err) => {
            logger.logWarning(`⚠ Video recording unavailable: ${err.message}`);
            this.recordingProcess = null;
            this.isRecording = false;
        });

        proc.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (
                output.toLowerCase().includes('permission denied') ||
                output.toLowerCase().includes('inaccessible') ||
                output.toLowerCase().includes('error')
            ) {
                logger.logWarning(`⚠ Video recording unavailable: ${output}`);
                proc.kill();
                this.recordingProcess = null;
                this.isRecording = false;
                return;
            }
            logger.logInfo(`Screenrecord: ${output}`);
        });

        this.recordingProcess = proc;
        this.isRecording = true;
    }

    async stopRecording(sessionDir) {
        if (!this.isRecording || !this.recordingProcess) return;

        try {
            logger.logInfo('🛑 Stopping video recording...');
            this.recordingProcess.kill('SIGINT');
            await this.sleep(3000);

            const localPath = path.join(sessionDir, 'video.mp4');
            await this.pullFile(localPath);
            await this.cleanupRemoteFile();
        } catch (err) {
            logger.logWarning(`Stop recording: ${err.message}`);
        } finally {
            this.recordingProcess = null;
            this.isRecording = false;
        }
    }

    async pullFile(localPath) {
        try {
            logger.logInfo(`📥 Pulling video to: ${localPath}`);
            await adbHelper.runADB(['pull', this.remotePath, localPath]);
        } catch (err) {
            logger.logWarning('⚠ Could not pull recording file.');
        }
    }

    async cleanupRemoteFile() {
        try {
            await adbHelper.runADB(['shell', 'rm', this.remotePath]);
        } catch (err) {}
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new VideoManager();
