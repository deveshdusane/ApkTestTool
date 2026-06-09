const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Set user data path BEFORE requiring any agent modules so projectManager and
// settingsManager pick it up immediately. On Mac: ~/Library/Application Support/TestMate AI
// On Windows: %APPDATA%\TestMate AI
process.env.TESTMATE_USER_DATA = app.getPath('userData');

// In packaged builds the agent/ folder is bundled inside the asar at <asar>/agent/
// (sibling of main.js). In dev it lives at <repo>/agent/ (one level up). Compute
// the right base path once so the require sites below stay readable.
const AGENT_ROOT = app.isPackaged
    ? path.join(__dirname, 'agent')
    : path.join(__dirname, '..', 'agent');

const QAAgent                  = require(path.join(AGENT_ROOT, 'main'));
const projectManager           = require(path.join(AGENT_ROOT, 'manager/projectManager'));
const adbHelper                = require(path.join(AGENT_ROOT, 'adb/adbHelper'));
const iapValidationEngine      = require(path.join(AGENT_ROOT, 'advanced/iapValidationEngine'));
const buildRegressionComparator = require(path.join(AGENT_ROOT, 'staticAnalyzer/buildRegressionComparator'));
const qaChecklistManager       = require(path.join(AGENT_ROOT, 'manager/qaChecklistManager'));

const agent = new QAAgent();
let mainWindow;


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
        filters: [
            { name: 'App Bundles', extensions: ['apk', 'ipa'] },
            { name: 'Android APK',  extensions: ['apk'] },
            { name: 'iOS IPA',      extensions: ['ipa'] }
        ]
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

        return { success: true, message: `✔ Session started: ${result.sessionId}` };
    } catch (err) {
        return { success: false, message: `❌ Error: ${err.message}` };
    }
});

ipcMain.handle('stop-test', async () => {
    try {
        const result = await agent.stopSession();

        // Auto-generate report on stop
        const { reportData } = await agent.generateReport(result.sessionId, result.duration);

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

ipcMain.handle('get-fb-events', async () => {
    return agent.getFbEvents();
});

ipcMain.handle('get-choice-events', async () => {
    return agent.getChoiceEvents();
});

ipcMain.handle('get-progression', async () => {
    return agent.getProgression();
});

ipcMain.handle('get-save-state', async () => {
    return agent.getSaveState();
});

ipcMain.handle('get-text-overflow', async () => {
    return agent.getTextOverflow();
});

// ─── WIRELESS ADB IPC HANDLERS ───────────────────────────────────────────────
// All routes go through agent/adb/wirelessConnect. Errors are surfaced to the
// renderer as { success: false, message } so the UI can render a toast/banner
// without falling into an exception.

const wireless = require(path.join(AGENT_ROOT, 'adb/wirelessConnect'));

function wrap(fn) {
    return async (...args) => {
        try {
            const result = await fn(...args);
            return { success: true, data: result };
        } catch (err) {
            return { success: false, message: err && err.message ? err.message : String(err) };
        }
    };
}

ipcMain.handle('wireless-discover',         wrap(async ()                   => wireless.discoverDevices()));
ipcMain.handle('wireless-list-known',       wrap(async ()                   => wireless.listKnown()));
ipcMain.handle('wireless-bootstrap-usb',    wrap(async (_e, { usbSerial })  => wireless.bootstrapFromUsb(usbSerial)));
ipcMain.handle('wireless-pair-connect',     wrap(async (_e, input)          => wireless.pairAndConnect(input)));
ipcMain.handle('wireless-reconnect',        wrap(async (_e, { serial })     => wireless.reconnect(serial)));
ipcMain.handle('wireless-auto-reconnect',   wrap(async ()                   => wireless.autoReconnectLast()));
ipcMain.handle('wireless-disconnect',       wrap(async (_e, { ip, port })   => wireless.disconnect(ip, port)));
ipcMain.handle('wireless-forget',           wrap(async (_e, { serial })     => wireless.forgetDevice(serial)));
ipcMain.handle('wireless-set-last-active',  wrap(async (_e, { serial })     => wireless.setLastActive(serial)));

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

ipcMain.handle('select-second-apk', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'App Bundles', extensions: ['apk', 'ipa'] }],
        title: 'Select build to compare'
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('build-regression-compare', async (event, { oldApkPath, newApkPath, projectName }) => {
    return buildRegressionComparator.compare({ oldApkPath, newApkPath, projectName });
});

// ─── QA CHECKLIST IPC HANDLERS ───────────────────────────────────────────────
// All handlers take projectName explicitly so the renderer controls scope.
ipcMain.handle('qa-checklist-get', async (_event, { projectName } = {}) => {
    return qaChecklistManager.getChecklist(projectName);
});

ipcMain.handle('qa-checklist-set-item', async (_event, { projectName, itemId, status, notes } = {}) => {
    return qaChecklistManager.setItemStatus(projectName, itemId, status, notes);
});

ipcMain.handle('qa-checklist-bulk-set', async (_event, { projectName, itemIds, status } = {}) => {
    return qaChecklistManager.bulkSetStatus(projectName, itemIds, status);
});

ipcMain.handle('qa-checklist-reset', async (_event, { projectName } = {}) => {
    return qaChecklistManager.resetAll(projectName);
});

// Export the report. The renderer prompts the user for a save location, then
// we serialize the report and write it ourselves so we can keep file IO out
// of the renderer process.
ipcMain.handle('qa-checklist-export', async (_event, { projectName } = {}) => {
    if (!projectName) return { success: false, message: 'No active project.' };
    const report = qaChecklistManager.exportReport(projectName);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultName = `qa-checklist-${projectName}-${stamp}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export QA Checklist Report',
        defaultPath: defaultName,
        filters: [{ name: 'JSON Report', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { success: false, message: 'Export cancelled.' };
    try {
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
        return { success: true, filePath };
    } catch (err) {
        return { success: false, message: err.message };
    }
});
