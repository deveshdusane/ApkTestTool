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
    return meta ? meta.apks : [];
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
