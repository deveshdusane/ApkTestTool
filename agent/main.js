const adbHelper = require('./adb/adbHelper');
const apkManager = require('./adb/apkManager');
const logcatManager = require('./adb/logcatManager');
const videoManager = require('./videoManager');
const screenshotManager = require('./adb/screenshotManager');
const performanceMonitor = require('./adb/performanceMonitor');
const logAnalyzer = require('./analyzer/logAnalyzer');
const reportGenerator = require('./analyzer/reportGenerator');
const projectManager = require('./manager/projectManager');
const logger = require('./utils/logger');
const config = require('./config/config');
const fs = require('fs');
const path = require('path');
const uiAnalyzer = require('./analyzer/uiAnalyzer');
const realtimeMonitor = require('./realtimeMonitor');
const apkAnalyzer = require('./staticAnalyzer/apkAnalyzer');
const networkAnalyzer = require('./metrics/networkAnalyzer');
const deviceHelper = require('./utils/deviceHelper');
const runtimeIntelligence = require('./advanced/runtimeIntelligence');
const gameplayBlockerDetector = require('./advanced/gameplayBlockerDetector');
const manualTestChecklistBuilder = require('./advanced/manualTestChecklistBuilder');
const testValidationAggregator = require('./advanced/testValidationAggregator');
const preflightAnalyzer = require('./staticAnalyzer/preflightAnalyzer');
const iapValidationEngine = require('./advanced/iapValidationEngine');
const deviceMatcher = require('./utils/deviceMatcher');
const performanceScaler = require('./utils/performanceScaler');


class QAAgent {
    constructor() {
        this.currentSessionId = null;
        this.currentProject = null;
        this.launchResult = false;
        this.startTime = null;
        this.performanceData = null;
        this.advancedAuditData = null;
        this.currentApkInfo = null;
        this.currentApkName = null;
        this.activeDeviceId = null;
        this.connectionFailCount = 0;
        // Test Validation feature state — manual checklist + tester ticks for the active session,
        // plus a cached preflight result so the validation page doesn't keep re-running AAPT.
        this.currentManualChecklist = [];
        this.manualChecklistResults = {}; // { itemId: { status: 'pass'|'fail'|'skip', notes, ts } }
        // User-added manual tests under the "Custom" category. Same shape as built
        // items so the aggregator and renderer don't need a special path.
        this.customManualItems = []; // [{ id, label, why, category: 'Custom', custom: true }]
        this.preflightCache = { apkPath: null, result: null }; // { apkPath, result }
        this.sessionRun = false; // true once a session has fully started
    }

    /**
     * Creates a unique session directory inside the active project.
     * @returns {string} sessionId
     */
    createSession() {
        if (!this.currentProject) throw new Error('No active project selected.');

        const sessionId = `session_${Date.now()}`;
        const sessionDir = path.join(
            __dirname, '../projects', this.currentProject, 'sessions', sessionId
        );
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.mkdirSync(path.join(sessionDir, 'screenshots'), { recursive: true });
        return sessionId;
    }

    /**
     * Sets the active project.
     */
    setProject(projectName) {
        this.currentProject = projectName;
        logger.logInfo(`Active project set to: ${projectName}`);
    }

    async startSession(apkPath, onLiveData = null) {
        try {
            if (!this.currentProject) throw new Error('No project selected. Create or select a project first.');

            // Step 6: Verify Flow on Start Test
            logger.logInfo("Initializing ADB session...");
            try {
                // Ensure server is running, but don't kill it every time as it disrupts connectivity
                await adbHelper.runADB(['start-server']);
                // Small delay to allow server to re-detect devices if it was just started
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                logger.logError(`ADB initialization failed: ${err.message}`);
            }

            // Step 1 & 2: Use retry-based device detection
            logger.logInfo("🔍 Detecting device...");
            let deviceCheck;
            try {
                deviceCheck = await this.waitForDevice(5000); // Wait up to 5 seconds
                logger.logInfo("🟢 Device connected!");
            } catch (err) {
                throw new Error("No device connected. Please plug in your phone and enable USB debugging.");
            }
            
            if (deviceCheck.status === "UNAUTHORIZED") {
                throw new Error('Please allow USB debugging on your phone.');
            }

            const deviceId = deviceCheck.deviceId;
            this.activeDeviceId = deviceId;
            console.log(`Using device: ${deviceId}`);



            // 3. Install APK
            let targetPackage = config.packageName;
            if (apkPath) {
                logger.logInfo(`Installing APK: ${apkPath}...`);
                const storedApkPath = projectManager.addApkToProject(this.currentProject, apkPath);
                this.currentApkName = path.basename(storedApkPath);
                
                logger.logInfo(`Extracting package name from APK...`);
                targetPackage = await apkManager.getPackageInfo(storedApkPath);
                this.currentApkInfo = {
                    ...(this.currentApkInfo || {}),
                    apkName: this.currentApkName,
                    packageName: targetPackage
                };
                
                const installResult = await apkManager.installApk(storedApkPath, this.activeDeviceId);
                if (installResult !== true) throw new Error(`Installation failed: ${installResult}`);
            }

            // 4. Launch App & Wait for Ready
            logger.logInfo(`Launching App: ${targetPackage}...`);
            this.launchResult = await apkManager.launchApp(targetPackage, this.activeDeviceId);
            
            // Step 5: Do not fail session on uncertain launch
            if (!this.launchResult) {
                logger.logWarning("Launch uncertain, continuing monitoring...");
            }

            // Step 2: Ensure app fully launches before monitoring starts
            logger.logInfo(`Waiting for ${targetPackage} to be ready...`);
            let appReady = false;
            try {
                await apkManager.waitForAppReady(targetPackage, this.activeDeviceId);
                appReady = true;
                logger.logInfo(`App is ready!`);
            } catch (e) {
                logger.logWarning(`Wait for ready timed out: ${e.message}. Starting monitoring anyway...`);
            }
            if (!this.launchResult && !appReady) {
                throw new Error(`App launch failed for package "${targetPackage}". Check that the APK has a launcher activity and can run on this device.`);
            }

            // 5. Initialize session
            this.currentSessionId = this.createSession();
            this.startTime = Date.now();

            // 6. Start Captures (pass session dir inside project)
            const sessionDir = path.join(
                __dirname, '../projects', this.currentProject, 'sessions', this.currentSessionId
            );
            logcatManager.startLogcat(this.currentSessionId, sessionDir, targetPackage, this.activeDeviceId);
            await videoManager.startRecording();
            screenshotManager.startScreenshotCapture(this.currentSessionId, sessionDir);
            
            // Step 3: Delay monitoring start to allow game to stabilize
            setTimeout(async () => {
                // Fetch and broadcast initial device info
                try {
                    const deviceInfo = await adbHelper.getDeviceInfo(this.activeDeviceId);
                    if (onLiveData) {
                        onLiveData({
                            type: 'device-info',
                            deviceName: deviceInfo.model,
                            androidVersion: `Android ${deviceInfo.androidVersion}`,
                            battery: deviceInfo.battery
                        });
                    }
                } catch (e) {}

                const monitorEngine = require('./runtime/monitorEngine');
                monitorEngine.startMonitoring(targetPackage, this.activeDeviceId, (data) => {
                    if (onLiveData) onLiveData(data);
                });
            }, 3000);
            
            // Pass static SDK info to runtime intelligence
            if (this.currentApkInfo) {
                runtimeIntelligence.setStaticSDKs(this.currentApkInfo);
            }

            // Start gameplay blocker detector + build initial manual checklist for this session.
            // The detector consumes log lines + FPS/PSS/ping samples already produced by
            // realtimeMonitor and networkAnalyzer — no new instrumentation needed.
            const sessionCtx = this._buildSessionContext();
            gameplayBlockerDetector.startSession(targetPackage, { hasAuthSdk: sessionCtx.hasAuthSdk });
            this.currentManualChecklist = manualTestChecklistBuilder.build(sessionCtx);
            this.manualChecklistResults = {};
            this.sessionRun = true;

            // Still start the old realtimeMonitor for Logcat-based interaction tracking
            const logPath = path.join(sessionDir, 'logs.txt');
            realtimeMonitor.start(targetPackage, () => {}, logPath, this.activeDeviceId);

            // Start Network Intelligence
            networkAnalyzer.reset();
            networkAnalyzer.startPingTracking(deviceId);
            networkAnalyzer.startNetworkUsageTracking(deviceId, targetPackage);
            networkAnalyzer.startNetworkDropDetection(deviceId, targetPackage);

            // Start Performance Monitoring for the Report
            performanceMonitor.start(targetPackage, 5000);


            return { success: true, sessionId: this.currentSessionId };
        } catch (error) {
            logger.logError(`Start Error: ${error.message}`);
            throw error;
        }
    }

    async stopSession() {
        if (!this.currentSessionId) throw new Error('No active session to stop');

        try {
            screenshotManager.stopScreenshotCapture();
            const sessionDir = path.join(
                __dirname, '../projects', this.currentProject, 'sessions', this.currentSessionId
            );
            await videoManager.stopRecording(sessionDir);
            logcatManager.stopLogcat();
            
            const monitorEngine = require('./runtime/monitorEngine');
            // Capture stable avg FPS before stopMonitoring clears the rolling history.
            const capturedAvgFPS = monitorEngine.getStableFPS() || 0;
            monitorEngine.stopMonitoring();

            this.performanceData = performanceMonitor.stop();
            this.performanceData.avgFPS = capturedAvgFPS;
            this.advancedAuditData = realtimeMonitor.getAdvancedAudit();
            realtimeMonitor.stop();
            // Finalize gameplay blocker detector. userInitiated=true tells it the session
            // ended on a Stop click, so it won't misattribute that as an OOM kill.
            this.gameplayBlockerResult = gameplayBlockerDetector.stopSession({ userInitiated: true });

            // Stop Network Intelligence
            networkAnalyzer.stopPingTracking();
            networkAnalyzer.stopNetworkUsageTracking();
            networkAnalyzer.stopNetworkDropDetection();

            const sessionId = this.currentSessionId;
            const duration = Math.floor((Date.now() - this.startTime) / 1000);

            this.currentSessionId = null;
            this.activeDeviceId = null;

            // Cleanup: keep only last 5 sessions
            projectManager.cleanupProjectSessions(this.currentProject, 5);

            return { success: true, sessionId, duration };
        } catch (error) {
            logger.logError(`Stop Error: ${error.message}`);
            throw error;
        }
    }

    async generateReport(sessionId, duration) {
        try {
            if (!this.currentProject) throw new Error('No active project.');

            const sessionDir = path.join(
                __dirname, '../projects', this.currentProject, 'sessions', sessionId
            );
            const logPath = path.join(sessionDir, 'logs.txt');
            const analysis = logAnalyzer.analyzeLogFile(logPath);
            const uiAnalysis = uiAnalyzer.analyzeUI(sessionDir, analysis);
            // Snapshot the unified Test Validation result at report-time so the saved
            // session JSON has automated checks + manual ticks + summary in one block.
            const testValidationSnapshot = await this.getTestValidation(this.preflightCache.apkPath);

            const reportData = reportGenerator.generateReport(
                analysis,
                this.launchResult,
                duration,
                this.performanceData,
                uiAnalysis,
                this.advancedAuditData,
                this.currentApkInfo,
                { testValidation: testValidationSnapshot }
            );

            const memorySamples = this.performanceData?.memory || [];
            const avgMemory = memorySamples.length
                ? Math.round(memorySamples.reduce((sum, value) => sum + value, 0) / memorySamples.length)
                : 0;
            const summaryText = typeof reportData.summary === 'string'
                ? reportData.summary
                : (reportData.summaryText || '');
            const sdkStatus = reportData.sdkEnabled ? 'ENABLED' : 'NOT_DETECTED';
            const apkName = this.currentApkName || this.currentApkInfo?.apkName || 'N/A';
            const packageName = this.currentApkInfo?.packageName || reportData.apkInfo?.packageName || 'N/A';

            Object.assign(reportData, {
                sessionId,
                apkName,
                packageName,
                summaryText,
                summary: {
                    crash: reportData.checklist?.crash === 'FAIL',
                    anr: reportData.checklist?.anr === 'FAIL',
                    sdkStatus
                },
                metrics: {
                    ...(reportData.metrics || {}),
                    avgFPS: this.performanceData?.avgFPS || reportData.metrics?.avgFPS || 0,
                    memory: {
                        average: avgMemory,
                        peak: reportData.performance?.peakMemory || 0
                    },
                    network: reportData.network || { avgPing: 0, dataUsedMB: '0.00', disconnects: 0, status: 'ONLINE' }
                }
            });

            // Save report to project/reports/
            console.log('Saving session:', sessionId);
            const reportsDir = projectManager.getReportsPath(this.currentProject);
            fs.mkdirSync(reportsDir, { recursive: true });
            const reportPath = path.join(reportsDir, `${sessionId}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

            projectManager.appendHistory(this.currentProject, {
                sessionId,
                timestamp: reportData.timestamp,
                apkName,
                packageName,
                duration,
                metrics: reportData.metrics,
                summary: reportData.summary,
                summaryText
            });
            return { success: true, reportData };
        } catch (error) {
            logger.logError(`Report Error: ${error.message}`);
            throw error;
        }
    }

    async analyzeAPK(apkPath) {
        try {
            this.currentApkInfo = await apkAnalyzer.analyze(apkPath);
            this.currentApkName = apkPath ? path.basename(apkPath) : null;
            if (this.currentApkInfo) this.currentApkInfo.apkName = this.currentApkName;
            // New APK → drop preflight cache + manual checklist + session-run flag so the
            // validation page rebuilds everything for the new build. Custom tests reset
            // too — they're per-build additions, not global preferences.
            this.preflightCache = { apkPath: null, result: null };
            this.currentManualChecklist = manualTestChecklistBuilder.build(this._buildSessionContext());
            this.manualChecklistResults = {};
            this.customManualItems = [];
            this.sessionRun = false;
            return this.currentApkInfo;
        } catch (error) {
            logger.logError(`Analysis Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Checks the current device status.
     */
    async checkDevice() {
        if (this.activeDeviceId) {
            const devices = await adbHelper.getConnectedDevices();
            const isStillConnected = devices.some(d => d.id === this.activeDeviceId);
            
            if (isStillConnected) {
                this.connectionFailCount = 0;
                return {
                    connected: true,
                    status: "CONNECTED",
                    deviceId: this.activeDeviceId,
                    isSessionActive: true
                };
            } else {
                this.connectionFailCount++;
                // Allow 3 consecutive failures (approx 6 seconds of grace) before clearing
                if (this.connectionFailCount >= 3) {
                    console.warn("[Agent] Active device confirmed lost:", this.activeDeviceId);
                    this.activeDeviceId = null;
                    this.connectionFailCount = 0;
                } else {
                    // Temporarily return CONNECTED to avoid UI flicker/log spam during transient errors
                    return {
                        connected: true,
                        status: "CONNECTED",
                        deviceId: this.activeDeviceId,
                        isSessionActive: true
                    };
                }
            }
        }
        return await deviceHelper.checkDeviceStatus();
    }

    /**
     * Polls for a connected device and returns when ready.
     */
    async waitForDevice(timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const status = await this.checkDevice();
            if (status.status === "CONNECTED" || status.status === "UNAUTHORIZED") {
                return status;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error("Device detection timed out.");
    }

    /**
     * Derive the session context the blocker detector and manual checklist builder need
     * from currentApkInfo. Kept as one method so the two consumers can't drift in what
     * they each compute about the session.
     */
    _buildSessionContext() {
        const info = this.currentApkInfo || {};
        const sdkInfo = info.sdkInfo || {};
        const detectedSdks = (info.sdkIntelligence && info.sdkIntelligence.sdks) || {};

        const sdks = [];
        for (const [key, val] of Object.entries(detectedSdks)) {
            if (val && val.detected) sdks.push(key);
        }
        if (sdkInfo.firebase) sdks.push('firebase');
        if (sdkInfo.ads)      sdks.push('ads');

        const hasIap = !!detectedSdks.iap?.detected ||
                       !!detectedSdks.google_play_billing?.detected ||
                       sdks.some(s => /iap|billing/i.test(s));
        const hasAds = !!sdkInfo.ads ||
                       sdks.some(s => /admob|unityads|applovin|ironsource|levelplay|chartboost|max/i.test(s));
        const hasFirebaseAnalytics = !!sdkInfo.firebase ||
                       !!detectedSdks.firebase?.detected ||
                       !!detectedSdks.firebase_analytics?.detected;
        const hasAuthSdk = !!detectedSdks.firebase?.detected ||
                       !!detectedSdks.firebase_auth?.detected ||
                       !!detectedSdks.play_games?.detected ||
                       !!detectedSdks.google_play_games?.detected;

        return {
            engine: sdkInfo.engine || 'Native',
            sdks,
            targetSdk: info.targetSdk,
            permissions: info.permissions || [],
            hasIap,
            hasAds,
            hasFirebaseAnalytics,
            hasAuthSdk,
            cleartextAllowed: !!info.security?.usesCleartextTraffic
        };
    }

    /** Returns the current detector result. Safe to call any time. */
    getGameplayBlockerResult() {
        return gameplayBlockerDetector.getResult();
    }

    /** Returns the merged checklist (built-in tailored items + tester-added custom items). */
    getManualChecklist() {
        return {
            items: [...(this.currentManualChecklist || []), ...(this.customManualItems || [])],
            results: this.manualChecklistResults || {}
        };
    }

    /** Tester ticked / changed an item. status ∈ {'pass','fail','skip'}. */
    setManualCheckResult(itemId, status, notes = '') {
        if (!itemId) return { success: false, error: 'itemId required' };
        if (!['pass', 'fail', 'skip'].includes(status)) {
            return { success: false, error: `invalid status: ${status}` };
        }
        const allItems = [...(this.currentManualChecklist || []), ...(this.customManualItems || [])];
        const exists = allItems.some(it => it.id === itemId);
        if (!exists) return { success: false, error: `unknown item: ${itemId}` };
        this.manualChecklistResults[itemId] = { status, notes: String(notes || ''), ts: Date.now() };
        return { success: true };
    }

    /**
     * Tester adds a custom manual test to the active session.
     * The item goes into the "Custom" category and supports pass/fail/skip + notes
     * exactly like a built-in item — no special-casing downstream.
     */
    addCustomTest(label, why = '') {
        const trimmed = String(label || '').trim();
        if (!trimmed) return { success: false, error: 'label required' };
        if (trimmed.length > 160) return { success: false, error: 'label too long (max 160 chars)' };
        const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const item = {
            id,
            category: 'Custom',
            label: trimmed,
            why: String(why || '').trim() || 'Custom check added by tester for this session.',
            conditional: false,
            custom: true
        };
        this.customManualItems.push(item);
        return { success: true, item };
    }

    /** Remove a custom test (and its result, if any). Returns {success}. */
    removeCustomTest(itemId) {
        if (!itemId) return { success: false, error: 'itemId required' };
        const before = this.customManualItems.length;
        this.customManualItems = this.customManualItems.filter(it => it.id !== itemId);
        if (this.customManualItems.length === before) {
            return { success: false, error: `unknown custom test: ${itemId}` };
        }
        if (this.manualChecklistResults[itemId]) delete this.manualChecklistResults[itemId];
        return { success: true };
    }

    /**
     * Run preflight on the supplied APK and cache the result.
     * The Test Validation page calls this on first open, then re-uses the cache so
     * we don't keep re-running AAPT on every UI poll.
     */
    async runPreflight(apkPath) {
        if (!apkPath) return { error: 'No APK path provided.' };
        if (this.preflightCache.apkPath === apkPath && this.preflightCache.result) {
            return this.preflightCache.result;
        }
        const result = await preflightAnalyzer.analyze(apkPath);
        this.preflightCache = { apkPath, result };
        return result;
    }

    /**
     * The unified Test Validation page consumes this. Returns automated checks
     * (preflight + runtime + SDK lifecycle) AND the manual checklist with tester
     * ticks, in one shot. Safe to call before, during, or after a session.
     *
     * If `apkPath` is provided and no preflight has been cached yet, this will
     * lazily run preflight in the background. The first call may return without
     * preflight rows; the next poll picks them up.
     */
    async getTestValidation(apkPath = null) {
        // Lazy-cache preflight so the renderer doesn't have to manage it.
        if (apkPath && (!this.preflightCache.result || this.preflightCache.apkPath !== apkPath)) {
            // Don't await — let the next poll pick up the cached result so the UI feels responsive.
            this.runPreflight(apkPath).catch(() => {});
        }

        const sessionCtx = this._buildSessionContext();
        const builtItems = this.sessionRun ? (this.currentManualChecklist || [])
                                           : manualTestChecklistBuilder.build(sessionCtx);
        // Merge built-in tailored items with any custom tests the tester added.
        const manualItems = [...builtItems, ...(this.customManualItems || [])];

        return testValidationAggregator.aggregate({
            preflightResult:       this.preflightCache.result,
            gameplayBlockerResult: gameplayBlockerDetector.getResult(),
            runtimeIntel:          (typeof runtimeIntelligence.getResult === 'function') ? runtimeIntelligence.getResult() : null,
            iapData:               (typeof iapValidationEngine.getResult === 'function') ? iapValidationEngine.getResult() : null,
            manualItems,
            manualResults:         this.manualChecklistResults || {},
            sessionCtx,
            sessionRun:            this.sessionRun
        });
    }

    /**
     * PRODUCTION-GRADE Hardware-Aware Performance Forecast
     */
    async getPerformancePredictions() {
        if (!this.currentProject) return { error: 'No active project' };

        const monitorEngine = require('./runtime/monitorEngine');
        const telemetry = monitorEngine.getTelemetry();
        const duration = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

        // Require at least 10s of session time
        if (duration < 10) {
            return { error: 'Insufficient runtime data (min 10s required)' };
        }

        // Prefer stable (outlier-trimmed) FPS over the instantaneous reading so that
        // a single bad measurement (counter reset, ADB glitch) doesn't skew all predictions.
        // Falls back through: stableFPS → EMA fps → realtimeMonitor → 30 FPS baseline.
        const stableFPS = monitorEngine.getStableFPS();
        const hasMeasuredFPS = (stableFPS && stableFPS > 0) || (telemetry.fps && telemetry.fps > 0);
        let fps = (stableFPS && stableFPS > 0) ? stableFPS : (telemetry.fps && telemetry.fps > 0) ? telemetry.fps : null;
        if (!fps) {
            const rtLastFPS = realtimeMonitor.getLastFPS();
            fps = (rtLastFPS && rtLastFPS > 0) ? rtLastFPS : 30;
        }

        try {
            const deviceInfo = await adbHelper.getDeviceInfo(this.activeDeviceId);
            const currentProfile = deviceMatcher.findMatch(deviceInfo);
            const allProfiles = deviceMatcher.getAllProfiles();

            const predictions = allProfiles.map(targetProfile => {
                return performanceScaler.predict(
                    {
                        fps,
                        memory: telemetry.memory,
                        cpuUsage: telemetry.avgCPU || 0
                    },
                    currentProfile,
                    targetProfile
                );
            });

            const bottleneck = performanceScaler.detectBottleneck(
                telemetry.avgCPU || 0,
                currentProfile?.gpuScore || 100,
                telemetry.memory
            );

            const confidence = performanceScaler.calculateConfidence({
                fpsStable: hasMeasuredFPS && telemetry.stability > 0.8,
                deviceMatchedInDB: !!currentProfile,
                duration: duration
            });

            return {
                currentDevice: {
                    name: deviceInfo.model,
                    fps,
                    memory: telemetry.memory,
                    ram: deviceInfo.ram
                },
                predictions,
                bottleneck,
                confidence,
                duration
            };
        } catch (err) {
            logger.logError(`Prediction Error: ${err.message}`);
            return { error: err.message };
        }
    }
}


if (require.main === module) {
    const agent = new QAAgent();
    const runCli = async () => {
        agent.setProject('default');
        const { sessionId } = await agent.startSession(config.apkPath);
        await new Promise(r => setTimeout(r, config.recordDuration));
        const { duration } = await agent.stopSession();
        await agent.generateReport(sessionId, duration);
    };
    runCli();
}

module.exports = QAAgent;
