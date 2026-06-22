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
const testValidationAggregator = require('./advanced/testValidationAggregator');
const preflightAnalyzer = require('./staticAnalyzer/preflightAnalyzer');
const iapValidationEngine = require('./advanced/iapValidationEngine');
const deviceMatcher = require('./utils/deviceMatcher');
const performanceScaler = require('./utils/performanceScaler');
const qaChecklistManager = require('./manager/qaChecklistManager');
const scrcpyManager = require('./cast/scrcpyManager');
const { fbEventTracker } = require('./advanced/eventAnalyzers/fbEventTracker');
const { choiceEventTracker } = require('./advanced/eventAnalyzers/choiceEventTracker');
const { progressionTracker } = require('./advanced/eventAnalyzers/progressionTracker');
const scriptSheet = require('./advanced/narrative/scriptSheet');
const autoPlayer = require('./advanced/narrative/autoPlayer');
const scriptMatcher = require('./advanced/narrative/scriptMatcher');
const saveStateMonitor = require('./advanced/saveStateMonitor');
const textOverflowDetector = require('./advanced/textOverflowDetector');
const platformDispatch = require('./platformDispatch');
const ipaAnalyzer = require('./ios/ipaAnalyzer');


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
        this.preflightCache = { apkPath: null, result: null };
        this.sessionRun = false; // true once a session has fully started
    }

    /**
     * Creates a unique session directory inside the active project.
     * @returns {string} sessionId
     */
    createSession() {
        if (!this.currentProject) throw new Error('No active project selected.');

        const sessionId = `session_${Date.now()}`;
        // Resolve via projectManager so packaged builds write to userData (asar is read-only).
        const sessionDir = path.join(
            projectManager.getProjectPath(this.currentProject), 'sessions', sessionId
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
        // Load this project's branch-coverage manifest + analytics tracking plan.
        this.loadChoiceManifest();
        this.loadTrackingPlan();
    }

    // ── Analytics tracking plan (expected event names) ───────────────────────
    // Parse: JSON ["evt1","evt2"] | [{event}] | {events:[...]}; CSV/TXT one
    // event name per line, or a column named "event"/"name".
    parseTrackingPlan(text, ext) {
        const t = (text || '').trim();
        if (!t) return [];
        if (ext === '.json' || t.startsWith('[') || t.startsWith('{')) {
            try {
                const data = JSON.parse(t);
                const arr = Array.isArray(data) ? data : (Array.isArray(data.events) ? data.events : []);
                return arr.map(x => typeof x === 'string' ? x : (x.event || x.name || '')).map(s => String(s).trim()).filter(Boolean);
            } catch { return []; }
        }
        const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return [];
        // If first line is a header naming the event column, skip it.
        const first = lines[0].toLowerCase().replace(/[\s_-]/g, '');
        const hasHeader = ['event', 'eventname', 'name'].includes(first.split(',')[0]);
        const out = [];
        for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
            const cell = lines[i].split(',')[0].trim();  // first column = event name
            if (cell) out.push(cell);
        }
        return out;
    }

    trackingPlanPath() {
        return path.join(projectManager.getProjectPath(this.currentProject), 'tracking-plan.json');
    }

    importTrackingPlan(filePath) {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
            const ext = path.extname(filePath).toLowerCase();
            const events = this.parseTrackingPlan(fs.readFileSync(filePath, 'utf8'), ext);
            const res = runtimeIntelligence.setTrackingPlan(events);
            if (!res.ok) return { ok: false, error: 'No valid event names found in the file.' };
            fs.writeFileSync(this.trackingPlanPath(), JSON.stringify(events, null, 2));
            logger.logInfo(`Imported tracking plan: ${res.total} events`);
            return { ok: true, total: res.total };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    loadTrackingPlan() {
        try {
            if (!this.currentProject) return;
            const p = this.trackingPlanPath();
            if (!fs.existsSync(p)) { runtimeIntelligence.clearTrackingPlan(); return; }
            runtimeIntelligence.setTrackingPlan(JSON.parse(fs.readFileSync(p, 'utf8')));
        } catch (_) { /* leave plan unset on parse error */ }
    }

    clearTrackingPlan() {
        try {
            runtimeIntelligence.clearTrackingPlan();
            if (this.currentProject && fs.existsSync(this.trackingPlanPath())) fs.unlinkSync(this.trackingPlanPath());
            return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // ── Branch-coverage manifest (full set of authored choices) ──────────────
    // Parse CSV or JSON. Accepted shapes:
    //   JSON: ["id1","id2"] | [{choiceId, chapter}] | {choices:[...]}
    //   CSV : header row with choiceId/chapter columns, or "chapter,choiceId",
    //         or a single choiceId column.
    parseChoiceManifest(text, ext) {
        const t = (text || '').trim();
        if (!t) return [];
        if (ext === '.json' || t.startsWith('[') || t.startsWith('{')) {
            try {
                const data = JSON.parse(t);
                const arr = Array.isArray(data) ? data : (Array.isArray(data.choices) ? data.choices : []);
                return arr.map(x => typeof x === 'string'
                    ? { choiceId: x, chapter: null }
                    : { choiceId: x.choiceId ?? x.id ?? x.choice_id ?? '', chapter: x.chapter ?? x.ch ?? x.chapterId ?? null }
                ).filter(e => e.choiceId);
            } catch { return []; }
        }
        const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return [];
        let start = 0, chapIdx = -1, idIdx = 0;
        // Header detection by EXACT column names (normalized) — not a loose
        // substring, so a data row like "day4,choice1_selected2" (which contains
        // "choice") is NOT mistaken for a header and dropped.
        const norm = s => s.toLowerCase().replace(/[\s_-]/g, '');
        const ID_NAMES   = ['choiceid', 'choice', 'id', 'choicekey', 'branch', 'branchid', 'optionid'];
        const CHAP_NAMES = ['chapter', 'chapterid', 'scene', 'sceneid', 'day', 'level', 'episode'];
        const cols0 = lines[0].split(',').map(c => norm(c.trim()));
        const isHeader = cols0.some(c => ID_NAMES.includes(c) || CHAP_NAMES.includes(c));
        if (isHeader) {
            idIdx = cols0.findIndex(c => ID_NAMES.includes(c)); if (idIdx < 0) idIdx = 0;
            chapIdx = cols0.findIndex(c => CHAP_NAMES.includes(c));
            start = 1;
        } else if (lines[0].includes(',')) {
            chapIdx = 0; idIdx = 1; // headerless 2-col → assume "chapter,choiceId"
        }
        const entries = [];
        for (let i = start; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const choiceId = cols[idIdx] || '';
            const chapter = chapIdx >= 0 ? (cols[chapIdx] || null) : null;
            if (choiceId) entries.push({ choiceId, chapter });
        }
        return entries;
    }

    manifestPath() {
        return path.join(projectManager.getProjectPath(this.currentProject), 'choice-manifest.json');
    }

    importChoiceManifest(filePath) {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
            const ext = path.extname(filePath).toLowerCase();
            const entries = this.parseChoiceManifest(fs.readFileSync(filePath, 'utf8'), ext);
            const res = choiceEventTracker.setManifest(entries);
            if (!res.ok) return { ok: false, error: 'No valid choice entries found in the file.' };
            fs.writeFileSync(this.manifestPath(), JSON.stringify(entries, null, 2));
            logger.logInfo(`Imported choice manifest: ${res.total} entries`);
            return { ok: true, total: res.total };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    loadChoiceManifest() {
        try {
            if (!this.currentProject) return;
            const p = this.manifestPath();
            if (!fs.existsSync(p)) { choiceEventTracker.clearManifest(); return; }
            choiceEventTracker.setManifest(JSON.parse(fs.readFileSync(p, 'utf8')));
        } catch (_) { /* leave manifest unset on parse error */ }
    }

    clearChoiceManifest() {
        try {
            choiceEventTracker.clearManifest();
            if (this.currentProject && fs.existsSync(this.manifestPath())) fs.unlinkSync(this.manifestPath());
            return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // ── Narrative script sheet (deviceless dialog/choice QA) ──────────────────
    scriptSheetPath() {
        return path.join(projectManager.getProjectPath(this.currentProject), 'narrative-script.csv');
    }

    // Parse + analyze a dialog sheet, persist the raw CSV per project, return
    // both the parse summary and the findings. Deviceless — no session needed.
    importScriptSheet(filePath) {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };
            const text = fs.readFileSync(filePath, 'utf8');
            const parsed = scriptSheet.parseScriptCsv(text);
            if (parsed.error) return { ok: false, error: parsed.error };
            const analysis = scriptSheet.analyzeScript(parsed);
            fs.writeFileSync(this.scriptSheetPath(), text);
            logger.logInfo(`Imported narrative script: ${parsed.summary.totalDays} days, ${parsed.summary.totalChoices} choices`);
            return { ok: true, loaded: true, parse: parsed.summary, analysis };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // Re-run parse+analyze from the persisted CSV (on project load / tab open).
    getScriptAnalysis() {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            const p = this.scriptSheetPath();
            if (!fs.existsSync(p)) return { ok: true, loaded: false };
            const parsed = scriptSheet.parseScriptCsv(fs.readFileSync(p, 'utf8'));
            if (parsed.error) return { ok: false, error: parsed.error };
            return { ok: true, loaded: true, parse: parsed.summary, analysis: scriptSheet.analyzeScript(parsed) };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    clearScriptSheet() {
        try {
            if (this.currentProject && fs.existsSync(this.scriptSheetPath())) fs.unlinkSync(this.scriptSheetPath());
            return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // ── Narrative auto-player (calibration + drive the game) ──────────────────
    autoplayProfilePath() {
        return path.join(projectManager.getProjectPath(this.currentProject), 'narrative-autoplay-profile.json');
    }

    getAutoplayProfile() {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            const p = this.autoplayProfilePath();
            if (!fs.existsSync(p)) return { ok: true, profile: null };
            return { ok: true, profile: JSON.parse(fs.readFileSync(p, 'utf8')) };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    saveAutoplayProfile(profile) {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            if (!profile || !profile.next || typeof profile.next.x !== 'number')
                return { ok: false, error: 'Profile must include a Next button position.' };
            fs.writeFileSync(this.autoplayProfilePath(), JSON.stringify(profile, null, 2));
            return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // Capture one frame for the calibration UI: base64 PNG + screen size, so the
    // renderer can show it and let the tester click the Next/choice positions.
    async captureCalibrationFrame() {
        try {
            const size = await autoPlayer.getScreenSize(true);
            const buf = await autoPlayer.screencap();
            if (!buf || buf.length === 0) return { ok: false, error: 'Empty screenshot — is a device connected?' };
            return { ok: true, png: 'data:image/png;base64,' + buf.toString('base64'), w: size.w, h: size.h };
        } catch (e) { return { ok: false, error: e.message }; }
    }

    // Drive the game from the saved profile. onStep streams each frame record.
    async runNarrativeAutoPlay(opts = {}, onStep = null) {
        try {
            if (!this.currentProject) return { ok: false, error: 'No project selected.' };
            const pr = this.getAutoplayProfile();
            if (!pr.ok) return pr;
            if (!pr.profile) return { ok: false, error: 'Not calibrated yet — set the Next button first.' };
            this._autoplayStop = false;
            const res = await autoPlayer.runAutoPlay(pr.profile, {
                steps: opts.steps || 30,
                settleMs: opts.settleMs || 800,
                ocr: opts.ocr !== false,
                onStep: rec => { try { if (onStep) onStep(rec); } catch (_) {} },
                shouldStop: () => this._autoplayStop
            });
            // Increment 4: if a dialog sheet is imported, match the captured frames
            // against it → per-frame verdicts + a run report (placeholders, coverage).
            if (res.ok && res.frames && fs.existsSync(this.scriptSheetPath())) {
                try {
                    const parsed = scriptSheet.parseScriptCsv(fs.readFileSync(this.scriptSheetPath(), 'utf8'));
                    if (!parsed.error) {
                        const m = scriptMatcher.matchRun(res.frames, parsed);
                        if (m.ok) res.match = m;
                    }
                } catch (_) { /* matching is best-effort — never fail the run on it */ }
            }
            return res;
        } catch (e) { return { ok: false, error: e.message }; }
    }

    stopNarrativeAutoPlay() { this._autoplayStop = true; return { ok: true }; }

    async startSession(apkPath, onLiveData = null) {
        try {
            if (!this.currentProject) throw new Error('No project selected. Create or select a project first.');

            // Platform gate — iOS runtime sessions aren't implemented yet (Phase 1
            // is static-only). Throw early with a clear message rather than
            // letting the Android adb path silently fail on an IPA.
            const platform = platformDispatch.detectPlatform(apkPath);
            if (platform === platformDispatch.PLATFORM_IOS) {
                throw new Error(
                    'iOS test sessions are not yet implemented (Phase 1 is static analysis only). ' +
                    'Use the Static Analysis tab to view IPA contents. Runtime support is planned for Phase 2 (Mac-only).'
                );
            }
            if (platform === platformDispatch.PLATFORM_UNKNOWN && apkPath) {
                throw new Error('Unrecognized file type. Supported: .apk (Android), .ipa (iOS — static only).');
            }

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

            scrcpyManager.start(deviceId);



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
                projectManager.getProjectPath(this.currentProject), 'sessions', this.currentSessionId
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

            // Start gameplay blocker detector. It consumes log lines + FPS/PSS/ping samples
            // already produced by realtimeMonitor and networkAnalyzer.
            const sessionCtx = this._buildSessionContext();
            gameplayBlockerDetector.startSession(targetPackage, { hasAuthSdk: sessionCtx.hasAuthSdk });
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

            // Start Save State Monitor — background-only, never blocks startSession.
            // If the app isn't debuggable the monitor self-disables gracefully.
            try { saveStateMonitor.start({ deviceId: this.activeDeviceId, packageName: targetPackage }); }
            catch (e) { logger.logWarning(`SaveStateMonitor failed to start: ${e.message}`); }

            // Start Text Overflow Detector — uiautomator-based, no extra deps,
            // ~15s cadence. Doesn't compete with the screenshot manager.
            try { textOverflowDetector.start({ deviceId: this.activeDeviceId, packageName: targetPackage }); }
            catch (e) { logger.logWarning(`TextOverflowDetector failed to start: ${e.message}`); }

            return { success: true, sessionId: this.currentSessionId };
        } catch (error) {
            logger.logError(`Start Error: ${error.message}`);
            throw error;
        }
    }

    async stopSession() {
        if (!this.currentSessionId) throw new Error('No active session to stop');

        try {
            scrcpyManager.stop();
            screenshotManager.stopScreenshotCapture();
            const sessionDir = path.join(
                projectManager.getProjectPath(this.currentProject), 'sessions', this.currentSessionId
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

            // Capture final save-state snapshot for the report.
            try { await saveStateMonitor.stop(); } catch (e) { logger.logWarning(`SaveStateMonitor.stop: ${e.message}`); }
            try { await textOverflowDetector.stop(); } catch (e) { logger.logWarning(`TextOverflowDetector.stop: ${e.message}`); }

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
                projectManager.getProjectPath(this.currentProject), 'sessions', sessionId
            );
            const logPath = path.join(sessionDir, 'logs.txt');
            const analysis = logAnalyzer.analyzeLogFile(logPath);

            // Snapshot FB events so the saved report includes them; tracker
            // keeps the snapshot until the next session resets it, but we
            // capture here to guarantee the report is consistent with this run.
            let fbEventsSnapshot = null;
            try { fbEventsSnapshot = fbEventTracker.getReportSummary(); } catch (_) {}
            let choiceEventsSnapshot = null;
            try { choiceEventsSnapshot = choiceEventTracker.getReportSummary(); } catch (_) {}
            let saveStateSnapshot = null;
            try { saveStateSnapshot = saveStateMonitor.getReportSummary(); } catch (_) {}
            let textOverflowSnapshot = null;
            try { textOverflowSnapshot = textOverflowDetector.getReportSummary(); } catch (_) {}
            let progressionSnapshot = null;
            try { progressionSnapshot = progressionTracker.getReportSummary(); } catch (_) {}

            // UI evaluation is derived from the real text-overflow / view-hierarchy
            // findings captured during the session (textOverflowSnapshot) — not from
            // image analysis. Computed after the snapshot so it has real data to use.
            const uiAnalysis = uiAnalyzer.analyzeUI(sessionDir, analysis, textOverflowSnapshot);

            // Snapshot the unified Test Validation result at report-time so the saved
            // session JSON has automated checks + manual ticks + summary in one block.
            const testValidationSnapshot = await this.getTestValidation(this.preflightCache.apkPath);
            // Snapshot the QA Checklist (manual 111-item list) for this project. This
            // is the new source of truth for the manual portion of the saved report.
            const qaChecklistSnapshot = qaChecklistManager.exportReport(this.currentProject);

            const reportData = reportGenerator.generateReport(
                analysis,
                this.launchResult,
                duration,
                this.performanceData,
                uiAnalysis,
                this.advancedAuditData,
                this.currentApkInfo,
                { testValidation: testValidationSnapshot, qaChecklistSnapshot, fbEvents: fbEventsSnapshot, choiceEvents: choiceEventsSnapshot, saveState: saveStateSnapshot, textOverflow: textOverflowSnapshot, progression: progressionSnapshot }
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
                // versionCode/Name needed by buildRegressionComparator to diff perf across builds.
                apkVersionCode: this.currentApkInfo?.versionCode || null,
                apkVersionName: this.currentApkInfo?.versionName || null,
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

    /**
     * Live snapshot of Facebook App Events captured during the current session.
     * Returns an empty snapshot before the session starts, and the final
     * session snapshot until a new session resets the tracker.
     */
    getFbEvents() {
        try {
            return fbEventTracker.getSnapshot();
        } catch (err) {
            logger.logError(`getFbEvents error: ${err.message}`);
            return null;
        }
    }

    /**
     * Live snapshot of narrative-game choice events captured during the
     * current session. Mirrors getFbEvents shape — safe to call any time;
     * returns an empty snapshot when nothing has been captured.
     */
    getChoiceEvents() {
        try {
            return choiceEventTracker.getSnapshot();
        } catch (err) {
            logger.logError(`getChoiceEvents error: ${err.message}`);
            return null;
        }
    }

    /**
     * Live snapshot of chapter/level progression (starts & completes) observed
     * during the session. Same contract as getChoiceEvents.
     */
    getProgression() {
        try {
            return progressionTracker.getSnapshot();
        } catch (err) {
            logger.logError(`getProgression error: ${err.message}`);
            return null;
        }
    }

    /**
     * Live snapshot of save-state monitor results. Returns counts of tracked
     * files + diff findings + the latest snapshot's file inventory (metadata
     * only — no file content). Safe to call any time.
     */
    getSaveState() {
        try {
            return saveStateMonitor.getSnapshot();
        } catch (err) {
            logger.logError(`getSaveState error: ${err.message}`);
            return null;
        }
    }

    /**
     * Live snapshot of text-overflow detector results. Returns per-finding
     * details (truncated, clipped, missing-string, empty TextView) plus
     * counts by severity. Safe to call any time.
     */
    getTextOverflow() {
        try {
            return textOverflowDetector.getSnapshot();
        } catch (err) {
            logger.logError(`getTextOverflow error: ${err.message}`);
            return null;
        }
    }

    async analyzeAPK(apkPath) {
        // Backwards-compatible entry point. Renderer/IPC still calls "analyzeAPK"
        // and "apkPath" even when the file is an IPA; we dispatch by extension
        // and adapt the result shape so the rest of the agent + UI stay uniform.
        try {
            const platform = platformDispatch.detectPlatform(apkPath);

            if (platform === platformDispatch.PLATFORM_IOS) {
                // Static IPA analysis works on any host OS (it's pure file parsing).
                // Runtime / session features will refuse later if not on macOS.
                const raw = await ipaAnalyzer.analyzeIpa(apkPath);
                this.currentApkInfo = adaptIpaToCommonShape(raw, apkPath);
            } else if (platform === platformDispatch.PLATFORM_ANDROID) {
                this.currentApkInfo = await apkAnalyzer.analyze(apkPath);
            } else {
                logger.logWarning(`Unknown file type for ${apkPath} — defaulting to APK analyzer`);
                this.currentApkInfo = await apkAnalyzer.analyze(apkPath);
            }

            this.currentApkName = apkPath ? path.basename(apkPath) : null;
            if (this.currentApkInfo) {
                this.currentApkInfo.apkName = this.currentApkName;
                this.currentApkInfo.platform = platform;
            }
            // New APK / IPA → drop preflight cache + session-run flag so the QA
            // Checklist's Automated pane re-runs static checks for the new build.
            this.preflightCache = { apkPath: null, result: null };
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

    /**
     * Run preflight on the supplied APK and cache the result.
     * Re-uses the cache so we don't keep re-running AAPT on every UI poll.
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
     * Powers the QA Checklist tab's Automated pane. Returns categorised PASS/WARN/FAIL
     * items derived from preflight, runtime blockers, SDK lifecycle, and IAP. Safe to
     * call before, during, or after a session — empty-state when nothing's available.
     *
     * If `apkPath` is provided and no preflight has been cached yet, runs preflight
     * lazily in the background. The first poll may return without preflight rows; the
     * next poll picks them up.
     */
    async getTestValidation(apkPath = null) {
        if (apkPath && (!this.preflightCache.result || this.preflightCache.apkPath !== apkPath)) {
            this.runPreflight(apkPath).catch(() => {});
        }

        return testValidationAggregator.aggregate({
            preflightResult:       this.preflightCache.result,
            gameplayBlockerResult: gameplayBlockerDetector.getResult(),
            runtimeIntel:          (typeof runtimeIntelligence.getResult === 'function') ? runtimeIntelligence.getResult() : null,
            iapData:               (typeof iapValidationEngine.getResult === 'function') ? iapValidationEngine.getResult() : null,
            sessionCtx:            this._buildSessionContext(),
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


// ── IPA → APK-shape adapter ────────────────────────────────────────────────
// Translates ipaAnalyzer's native iOS output into the same shape the renderer
// already understands (packageName / versionName / minSdk / sdkInfo etc.) so
// the existing Static Analysis tab and report generator work unchanged.
// iOS-specific fields stay tucked under iosInfo for any future iOS-aware UI.
function adaptIpaToCommonShape(raw, ipaPath) {
    if (!raw) return null;
    const adsSdks = ['AdMob', 'AppLovin/MAX', 'IronSource', 'Facebook SDK'];
    return {
        // APK-equivalent surface
        packageName:   raw.bundleId || null,
        appLabel:      raw.displayName || raw.bundleName || null,
        versionName:   raw.version || null,
        versionCode:   raw.build || null,
        minSdk:        raw.minimumOSVersion ? `iOS ${raw.minimumOSVersion}` : null,
        targetSdk:     raw.platformVersion ? `iOS ${raw.platformVersion}` : null,
        permissions:   (raw.permissions || []).map(p => p.key),
        permissionsWithReason: raw.permissions || [],
        exportedComponents: [],
        security: raw.ats ? {
            allowCleartextTraffic: raw.ats.allowsArbitraryLoads,
            allowsLocalNetworking: raw.ats.allowsLocalNetworking,
            usesCleartextTraffic:  raw.ats.allowsArbitraryLoads,
            atsExceptionDomains:   raw.ats.exceptionDomains || []
        } : null,
        sdkInfo: {
            engine:   raw.engine || 'Native',
            firebase: raw.sdks.includes('Firebase'),
            ads:      raw.sdks.some(s => adsSdks.includes(s))
        },
        sdkIntelligence: null,    // populated by separate iOS SDK intel scan later
        // iOS-only surface (rendered when available)
        iosInfo: {
            ipaPath,
            appName: raw.appName,
            appBundlePath: raw.appBundlePath,
            deviceFamily: raw.deviceFamily,
            supportedPlatforms: raw.supportedPlatforms,
            urlSchemes: raw.urlSchemes,
            executable: raw.executable,
            frameworks: raw.frameworks,
            sdks: raw.sdks,
            provisioning: raw.provisioning,
            locales: raw.locales,
            appExtensions: raw.appExtensions,
            bundleSize: raw.bundleSize,
            fileCount: raw.fileCount
        },
        assetIntegrity: raw.assetIntegrity || null,
        analysisErrors: raw.errors || []
    };
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
