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

    // IAP Validation
    iapDetectSDK:     (pkg, deviceId, apkPath) => ipcRenderer.invoke('iap-detect-sdk', { pkg, deviceId, apkPath }),
    iapStartTest:     (pkg)           => ipcRenderer.invoke('iap-start-test', { pkg }),
    iapStopTest:      ()              => ipcRenderer.invoke('iap-stop-test'),
    iapGetResult:     ()              => ipcRenderer.invoke('iap-get-result'),

    // Test Validation — unified Pre-flight + Runtime + SDK Lifecycle + Manual checklist.
    // The renderer polls `getTestValidation` for live updates; tester ticks go via
    // `setManualCheckResult`.
    getTestValidation:    (apkPath) => ipcRenderer.invoke('get-test-validation', { apkPath }),
    runPreflight:         (apkPath) => ipcRenderer.invoke('run-preflight', apkPath),
    setManualCheckResult: (itemId, status, notes) =>
        ipcRenderer.invoke('set-manual-check-result', { itemId, status, notes }),
    // Custom manual tests
    addCustomTest:    (label, why) => ipcRenderer.invoke('add-custom-test', { label, why }),
    removeCustomTest: (itemId)     => ipcRenderer.invoke('remove-custom-test', { itemId }),

    // Kept for backwards compatibility; new code should use getTestValidation.
    runPreflightScan: (apkPath) => ipcRenderer.invoke('run-preflight-scan', apkPath),

    // Build Regression Comparator
    selectSecondApk: () => ipcRenderer.invoke('select-second-apk'),
    buildRegressionCompare: (oldApkPath, newApkPath, projectName) =>
        ipcRenderer.invoke('build-regression-compare', { oldApkPath, newApkPath, projectName }),
});
