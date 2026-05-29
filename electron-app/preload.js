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
    onLiveData:       (callback)      => ipcRenderer.on('live-data', (_event, data) => callback(data)),

    // History & Reports
    getHistory:       (projectName)   => ipcRenderer.invoke('get-history', projectName),
    deleteSession:    (projectName, sessionId) => ipcRenderer.invoke('delete-session', { projectName, sessionId }),
    getSessionReport: (projectName, sessionId) =>
                                         ipcRenderer.invoke('get-session-report', { projectName, sessionId }),

    // Predictions
    getPredictions:   ()              => ipcRenderer.invoke('get-predictions'),

    // Facebook App Events live snapshot
    getFbEvents:      ()              => ipcRenderer.invoke('get-fb-events'),

    // Narrative-game choice events live snapshot
    getChoiceEvents:  ()              => ipcRenderer.invoke('get-choice-events'),

    // Save-state monitor live snapshot
    getSaveState:     ()              => ipcRenderer.invoke('get-save-state'),

    // Text overflow detector live snapshot
    getTextOverflow:  ()              => ipcRenderer.invoke('get-text-overflow'),

    // Wireless ADB — connection management
    wireless: {
        discover:        ()                  => ipcRenderer.invoke('wireless-discover'),
        listKnown:       ()                  => ipcRenderer.invoke('wireless-list-known'),
        bootstrapUsb:    (usbSerial)         => ipcRenderer.invoke('wireless-bootstrap-usb', { usbSerial }),
        pairAndConnect:  (input)             => ipcRenderer.invoke('wireless-pair-connect', input),
        reconnect:       (serial)            => ipcRenderer.invoke('wireless-reconnect', { serial }),
        autoReconnect:   ()                  => ipcRenderer.invoke('wireless-auto-reconnect'),
        disconnect:      (ip, port)          => ipcRenderer.invoke('wireless-disconnect', { ip, port }),
        forget:          (serial)            => ipcRenderer.invoke('wireless-forget', { serial }),
        setLastActive:   (serial)            => ipcRenderer.invoke('wireless-set-last-active', { serial })
    },

    // Cleanup
    deleteProject:    (name)          => ipcRenderer.invoke('delete-project', name),

    // IAP Validation
    iapDetectSDK:     (pkg, deviceId, apkPath) => ipcRenderer.invoke('iap-detect-sdk', { pkg, deviceId, apkPath }),
    iapStartTest:     (pkg)           => ipcRenderer.invoke('iap-start-test', { pkg }),
    iapStopTest:      ()              => ipcRenderer.invoke('iap-stop-test'),
    iapGetResult:     ()              => ipcRenderer.invoke('iap-get-result'),

    // QA Checklist Automated mode polls this for tool-run validation results.
    getTestValidation: (apkPath) => ipcRenderer.invoke('get-test-validation', { apkPath }),

    // Build Regression Comparator
    selectSecondApk: () => ipcRenderer.invoke('select-second-apk'),
    buildRegressionCompare: (oldApkPath, newApkPath, projectName) =>
        ipcRenderer.invoke('build-regression-compare', { oldApkPath, newApkPath, projectName }),

    // QA Checklist (per-project manual checklist, 20 sections / 111 items)
    qaChecklistGet:     (projectName) => ipcRenderer.invoke('qa-checklist-get', { projectName }),
    qaChecklistSetItem: (projectName, itemId, status, notes) =>
        ipcRenderer.invoke('qa-checklist-set-item', { projectName, itemId, status, notes }),
    qaChecklistBulkSet: (projectName, itemIds, status) =>
        ipcRenderer.invoke('qa-checklist-bulk-set', { projectName, itemIds, status }),
    qaChecklistReset:   (projectName) => ipcRenderer.invoke('qa-checklist-reset', { projectName }),
    qaChecklistExport:  (projectName) => ipcRenderer.invoke('qa-checklist-export', { projectName }),
});
