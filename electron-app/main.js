const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const QAAgent = require('../agent/main');
const projectManager = require('../agent/manager/projectManager');
const adbHelper = require('../agent/adb/adbHelper');
const settingsManager = require('../agent/config/settingsManager');
const aiEventClassifier = require('../agent/advanced/aiEventClassifier');
const proxyServer = require('../agent/proxy/proxyServer');
const certManager = require('../agent/proxy/certManager');
const iapValidationEngine = require('../agent/advanced/iapValidationEngine');
const preflightAnalyzer = require('../agent/staticAnalyzer/preflightAnalyzer');
const buildRegressionComparator = require('../agent/staticAnalyzer/buildRegressionComparator');

const agent = new QAAgent();
let mainWindow;
let lastSessionInfo = { sessionId: null, duration: 0 };

// Load saved API key on startup
const savedApiKey = settingsManager.get('geminiApiKey', '');
if (savedApiKey) aiEventClassifier.setApiKey(savedApiKey);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 780,
        backgroundColor: '#111118',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─── PROJECT IPC HANDLERS ────────────────────────────────────────────────────

ipcMain.handle('list-projects', async () => {
    const names = projectManager.listProjects();
    return names.map(name => ({
        name,
        metadata: projectManager.getProjectMetadata(name)
    }));
});

ipcMain.handle('create-project', async (event, projectName) => {
    try {
        const result = projectManager.createProject(projectName);
        return { success: true, message: `✔ Project "${projectName}" created.`, project: result };
    } catch (err) {
        return { success: false, message: `❌ ${err.message}` };
    }
});

ipcMain.handle('select-project', async (event, projectName) => {
    try {
        agent.setProject(projectName);
        return { success: true, message: `✔ Switched to project: ${projectName}` };
    } catch (err) {
        return { success: false, message: `❌ ${err.message}` };
    }
});

// ─── APK IPC HANDLERS ────────────────────────────────────────────────────────

ipcMain.handle('select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'APK Files', extensions: ['apk'] }]
    });
    if (canceled) return null;
    return filePaths[0];
});

// ─── TEST SESSION IPC HANDLERS ───────────────────────────────────────────────

ipcMain.handle('start-test', async (event, apkPath) => {
    try {
        const result = await agent.startSession(apkPath, (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('live-data', data);
            }
        });

        // Start MITM proxy now that we have an active device
        if (agent.activeDeviceId) {
            proxyServer.start(agent.activeDeviceId, (eventData) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('live-data', eventData);
                }
            }).catch(e => console.warn('[Proxy] Start failed:', e.message));
        }

        return { success: true, message: `✔ Session started: ${result.sessionId}` };
    } catch (err) {
        return { success: false, message: `❌ Error: ${err.message}` };
    }
});

ipcMain.handle('stop-test', async () => {
    try {
        const result = await agent.stopSession();

        // Stop MITM proxy and clear device proxy settings
        proxyServer.stop().catch(e => console.warn('[Proxy] Stop failed:', e.message));

        // Auto-generate report on stop
        const { reportData } = await agent.generateReport(result.sessionId, result.duration);

        // Persist so generate-report handler can regenerate on demand
        lastSessionInfo = { sessionId: result.sessionId, duration: result.duration };

        return {
            success: true,
            message: `✔ Session stopped. Report auto-generated.`,
            sessionId: result.sessionId,
            duration: result.duration,
            report: reportData
        };
    } catch (err) {
        return { success: false, message: `❌ Error: ${err.message}` };
    }
});

ipcMain.handle('generate-report', async () => {
    try {
        if (!lastSessionInfo.sessionId) throw new Error('No session data found');
        const { reportData } = await agent.generateReport(lastSessionInfo.sessionId, lastSessionInfo.duration);
        return { success: true, message: '✔ Report generated.', report: reportData };
    } catch (err) {
        return { success: false, message: `❌ Error: ${err.message}` };
    }
});

// ─── HISTORY & DATA IPC HANDLERS  ────────────────────────────────────────────

ipcMain.handle('get-history', async (event, projectName) => {
    if (!projectName) return [];
    return projectManager.getHistory(projectName);
});

ipcMain.handle('get-session-report', async (event, { projectName, sessionId }) => {
    const reportPath = path.join(projectManager.getReportsPath(projectName), `${sessionId}.json`);
    if (fs.existsSync(reportPath)) {
        return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    }
    return null;
});

ipcMain.handle('get-project-apks', async (event, projectName) => {
    const meta = projectManager.getProjectMetadata(projectName);
    if (!meta || !Array.isArray(meta.apks)) return [];
    const projectPath = projectManager.getProjectPath(projectName);
    return meta.apks.map(apk => {
        if (apk && typeof apk === 'object') return apk;
        const name = String(apk);
        return {
            name,
            path: path.join(projectPath, 'apks', name),
            packageName: null
        };
    });
});

ipcMain.handle('get-device-info', async () => {
    return adbHelper.getDeviceInfo();
});

ipcMain.handle('check-device', async () => {
    return agent.checkDevice();
});

ipcMain.handle('delete-project', async (event, projectName) => {

    return projectManager.deleteProject(projectName);
});

ipcMain.handle('delete-session', async (event, { projectName, sessionId }) => {
    projectManager.removeFromHistory(projectName, sessionId);
    return projectManager.deleteSession(projectName, sessionId);
});

ipcMain.handle('analyze-apk', async (event, apkPath) => {
    return agent.analyzeAPK(apkPath);
});

ipcMain.handle('get-predictions', async () => {
    return agent.getPerformancePredictions();
});

// ─── SETTINGS IPC HANDLERS ────────────────────────────────────────────────────

ipcMain.handle('get-settings', async () => {
    return {
        geminiApiKey: settingsManager.get('geminiApiKey', '')
    };
});

ipcMain.handle('save-settings', async (event, settings) => {
    try {
        if (settings.geminiApiKey !== undefined) {
            settingsManager.set('geminiApiKey', settings.geminiApiKey);
            aiEventClassifier.setApiKey(settings.geminiApiKey);
        }
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ─── PROXY / PHASE 3 IPC HANDLERS ────────────────────────────────────────────

ipcMain.handle('get-proxy-status', async () => {
    return {
        active:      proxyServer.isActive(),
        port:        proxyServer.getPort(),
        intercepted: proxyServer.getIntercepted(),
        certExists:  certManager.caCertExists(),
        lastError:   proxyServer.getLastError()
    };
});

ipcMain.handle('install-ca-cert', async () => {
    try {
        // Resolve connected device automatically
        const devices = await adbHelper.getConnectedDevices();
        if (!devices || devices.length === 0) {
            return { success: false, message: 'No device connected via ADB' };
        }
        const did = devices[0].id;
        await certManager.init();
        const result = await certManager.pushToDevice(did);
        return { success: true, result, deviceId: did };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// ─── IAP VALIDATION IPC HANDLERS ─────────────────────────────────────────────

ipcMain.handle('iap-detect-sdk', async (event, { pkg, deviceId, apkPath }) => {
    return iapValidationEngine.detectSDK(pkg, deviceId, apkPath);
});

ipcMain.handle('iap-start-test', async (event, { pkg }) => {
    return iapValidationEngine.startSession(pkg);
});

ipcMain.handle('iap-stop-test', async () => {
    return iapValidationEngine.stopSession();
});

ipcMain.handle('iap-get-result', async () => {
    return iapValidationEngine.getResult();
});

// ── TEST VALIDATION (unified Pre-flight + Gameplay + Manual) ─────────────────
//
// Single source of truth for the new Test Validation page. Returns automated
// checks (preflight + runtime + SDK lifecycle) AND the manual checklist with
// tester ticks, all in one payload. The renderer polls this and re-paints.
ipcMain.handle('get-test-validation', async (_event, { apkPath } = {}) => {
    return agent.getTestValidation(apkPath);
});

ipcMain.handle('run-preflight', async (_event, apkPath) => {
    return agent.runPreflight(apkPath);
});

ipcMain.handle('set-manual-check-result', async (_event, { itemId, status, notes }) => {
    return agent.setManualCheckResult(itemId, status, notes);
});

// Tester-added "Custom" tests inside Manual QA. Pass/fail/skip + notes flow
// through the existing set-manual-check-result handler — no special-casing.
ipcMain.handle('add-custom-test', async (_event, { label, why } = {}) => {
    return agent.addCustomTest(label, why);
});
ipcMain.handle('remove-custom-test', async (_event, { itemId } = {}) => {
    return agent.removeCustomTest(itemId);
});

// Legacy `preflightAnalyzer` direct call kept available for any caller still on
// the old API; new callers should use `get-test-validation`.
ipcMain.handle('run-preflight-scan', async (_event, apkPath) => {
    return preflightAnalyzer.analyze(apkPath);
});

ipcMain.handle('select-second-apk', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'APK Files', extensions: ['apk'] }],
        title: 'Select APK to compare'
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('build-regression-compare', async (event, { oldApkPath, newApkPath, projectName }) => {
    return buildRegressionComparator.compare({ oldApkPath, newApkPath, projectName });
});
