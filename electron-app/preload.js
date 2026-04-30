const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Projects
    listProjects:     ()              => ipcRenderer.invoke('list-projects'),
    createProject:    (name)          => ipcRenderer.invoke('create-project', name),
    selectProject:    (name)          => ipcRenderer.invoke('select-project', name),
    getProjectApks:   (name)          => ipcRenderer.invoke('get-project-apks', name),

    // Files
    selectFile:       ()              => ipcRenderer.invoke('select-file'),
    getDeviceInfo:    ()              => ipcRenderer.invoke('get-device-info'),
    checkDevice:      ()              => ipcRenderer.invoke('check-device'),
    analyzeAPK:       (apkPath)       => ipcRenderer.invoke('analyze-apk', apkPath),


    // Session
    startTest:        (apkPath)       => ipcRenderer.invoke('start-test', apkPath),
    stopTest:         ()              => ipcRenderer.invoke('stop-test'),
    generateReport:   ()              => ipcRenderer.invoke('generate-report'),
    onLiveData:       (callback)      => ipcRenderer.on('live-data', (_event, data) => callback(data)),

    // History & Reports
    getHistory:       (projectName)   => ipcRenderer.invoke('get-history', projectName),
    deleteSession:    (projectName, sessionId) => ipcRenderer.invoke('delete-session', { projectName, sessionId }),
    getSessionReport: (projectName, sessionId) =>
                                         ipcRenderer.invoke('get-session-report', { projectName, sessionId }),

    // Predictions
    getPredictions:   ()              => ipcRenderer.invoke('get-predictions'),

    // Cleanup
    deleteProject:    (name)          => ipcRenderer.invoke('delete-project', name),

    // Settings
    getSettings:      ()              => ipcRenderer.invoke('get-settings'),
    saveSettings:     (settings)      => ipcRenderer.invoke('save-settings', settings),

    // Proxy (Phase 3)
    getProxyStatus:   ()              => ipcRenderer.invoke('get-proxy-status'),
    installCACert:    ()              => ipcRenderer.invoke('install-ca-cert'),
});
