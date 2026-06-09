/* ═══════════════════════════════════════════════════
   TESTMATE AI — RENDERER LOGIC
   Project-based QA session management
   ═══════════════════════════════════════════════════ */

// ─── STATE ──────────────────────────────────────────────────────────────────
let selectedApkPath = null;
let activeProject = null;
let sessionState = 'idle'; // idle | running | stopped
let timerInterval = null;
let secondsElapsed = 0;
let _timelineFilter = 'full';
let _eventsFilter = 'ALL';

// Global persistent state for the active project
let currentSession = {
    runtime: null,
    staticAnalysis: null
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

// ─── SDK KEY REFERENCE TABLE ─────────────────────────────────────────────────
const SDK_KEY_REFERENCE = [
    // ── ADS ──────────────────────────────────────────────────────────────────
    { sdk: 'AdMob',           category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['ca_app_id', 'admob_app_id', 'com.google.android.gms.ads.APPLICATION_ID'],                     expectedFormat: 'ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX' },
    { sdk: 'AdMob',           category: 'ADS',         keyLabel: 'Ad Unit ID',      stringKeyNames: ['admob_banner_unit_id', 'admob_interstitial_unit_id', 'admob_rewarded_unit_id'],                expectedFormat: 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX' },
    { sdk: 'UnityAds',        category: 'ADS',         keyLabel: 'Game ID',         stringKeyNames: ['unity_game_id', 'unityads_game_id', 'UNITY_GAME_ID'],                                         expectedFormat: '7-digit numeric ID' },
    { sdk: 'AppLovin',        category: 'ADS',         keyLabel: 'SDK Key',         stringKeyNames: ['applovin_sdk_key', 'com.applovin.sdk.key'],                                                    expectedFormat: '86-char alphanumeric' },
    { sdk: 'AppLovin',        category: 'ADS',         keyLabel: 'Report Key',      stringKeyNames: ['applovin_report_key'],                                                                         expectedFormat: '32-char hex' },
    { sdk: 'IronSource',      category: 'ADS',         keyLabel: 'App Key',         stringKeyNames: ['ironsource_app_key', 'is_app_key', 'iron_source_app_key'],                                    expectedFormat: '7-8 char alphanumeric (e.g. a1b2c3d)' },
    { sdk: 'Vungle',          category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['vungle_app_id', 'com.vungle.publisher.APP_ID'],                                               expectedFormat: 'Alphanumeric (e.g. 5xxxx_ANDROID…)' },
    { sdk: 'Pangle',          category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['pangle_app_id', 'ttad_app_id', 'com.bytedance.sdk.openadsdk.APPID'],                         expectedFormat: 'Numeric ID (7+ digits)' },
    { sdk: 'InMobi',          category: 'ADS',         keyLabel: 'Account ID',      stringKeyNames: ['inmobi_account_id', 'im_account_id'],                                                         expectedFormat: '32-char hex string' },
    { sdk: 'Chartboost',      category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['chartboost_app_id', 'cb_app_id'],                                                             expectedFormat: '24-char hex' },
    { sdk: 'Chartboost',      category: 'ADS',         keyLabel: 'App Signature',   stringKeyNames: ['chartboost_app_signature', 'cb_app_signature'],                                               expectedFormat: '40-char hex' },
    { sdk: 'Digital Turbine', category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['dt_app_id', 'fyber_app_id', 'digitalturbine_app_id'],                                        expectedFormat: 'Numeric ID' },
    { sdk: 'Mintegral',       category: 'ADS',         keyLabel: 'App ID',          stringKeyNames: ['mintegral_app_id', 'mbridge_app_id', 'mb_app_id'],                                           expectedFormat: '6-digit numeric ID' },
    { sdk: 'Mintegral',       category: 'ADS',         keyLabel: 'App Key',         stringKeyNames: ['mintegral_app_key', 'mbridge_app_key', 'mb_app_key'],                                        expectedFormat: '32-char alphanumeric' },
    { sdk: 'MoPub',           category: 'ADS',         keyLabel: 'Ad Unit ID',      stringKeyNames: ['mopub_ad_unit_id', 'mopub_banner_id', 'mopub_interstitial_id'],                              expectedFormat: '32-char UUID' },
    // ── ANALYTICS ─────────────────────────────────────────────────────────────
    { sdk: 'Firebase',        category: 'ANALYTICS',   keyLabel: 'Google App ID',   stringKeyNames: ['google_app_id', 'firebase_app_id'],                                                           expectedFormat: '1:XXXXXXXXXX:android:XXXXXXXXXXXXXXXX' },
    { sdk: 'Firebase',        category: 'ANALYTICS',   keyLabel: 'API Key',         stringKeyNames: ['google_api_key', 'current_key'],                                                              expectedFormat: 'AIzaSy… (39-char)' },
    { sdk: 'Firebase',        category: 'ANALYTICS',   keyLabel: 'Project ID',      stringKeyNames: ['project_id', 'firebase_project_id'],                                                          expectedFormat: 'lowercase-alpha-with-hyphens' },
    { sdk: 'Firebase',        category: 'ANALYTICS',   keyLabel: 'Sender ID',       stringKeyNames: ['gcm_defaultSenderId', 'google_project_number', 'firebase_sender_id'],                        expectedFormat: '9-12 digit numeric' },
    { sdk: 'Amplitude',       category: 'ANALYTICS',   keyLabel: 'API Key',         stringKeyNames: ['amplitude_api_key', 'amplitude_key', 'com.amplitude.api_key'],                               expectedFormat: '32-char lowercase hex' },
    { sdk: 'MixPanel',        category: 'ANALYTICS',   keyLabel: 'Token',           stringKeyNames: ['mixpanel_token', 'com.mixpanel.android.MPConfig.MixpanelToken'],                             expectedFormat: '32-char hex' },
    { sdk: 'Segment',         category: 'ANALYTICS',   keyLabel: 'Write Key',       stringKeyNames: ['segment_write_key', 'analytics_write_key'],                                                   expectedFormat: '20-char alphanumeric' },
    { sdk: 'Braze',           category: 'ANALYTICS',   keyLabel: 'API Key',         stringKeyNames: ['braze_api_key', 'com_braze_api_key', 'appboy_api_key'],                                      expectedFormat: 'UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' },
    { sdk: 'Braze',           category: 'ANALYTICS',   keyLabel: 'Endpoint',        stringKeyNames: ['braze_custom_endpoint', 'com_braze_custom_endpoint'],                                         expectedFormat: 'sdk.iad-XX.braze.com' },
    { sdk: 'Leanplum',        category: 'ANALYTICS',   keyLabel: 'App ID',          stringKeyNames: ['leanplum_app_id', 'LP_APP_ID'],                                                               expectedFormat: 'app_… alphanumeric' },
    { sdk: 'Leanplum',        category: 'ANALYTICS',   keyLabel: 'Client Key',      stringKeyNames: ['leanplum_client_key', 'LP_CLIENT_KEY'],                                                       expectedFormat: 'dev_… or prod_… prefix' },
    { sdk: 'OneSignal',       category: 'ANALYTICS',   keyLabel: 'App ID',          stringKeyNames: ['onesignal_app_id', 'ONE_SIGNAL_APP_ID', 'com.onesignal.NotificationServiceExtension'],       expectedFormat: 'UUID format' },
    // ── ATTRIBUTION ───────────────────────────────────────────────────────────
    { sdk: 'AppsFlyer',       category: 'ATTRIBUTION', keyLabel: 'Dev Key',         stringKeyNames: ['appsflyer_dev_key', 'appsflyer_key', 'AF_DEV_KEY'],                                          expectedFormat: '20-40 char alphanumeric' },
    { sdk: 'AppsFlyer',       category: 'ATTRIBUTION', keyLabel: 'App ID (Android)',stringKeyNames: ['appsflyer_app_id', 'AF_APP_ID'],                                                              expectedFormat: 'Numeric app ID' },
    { sdk: 'Adjust',          category: 'ATTRIBUTION', keyLabel: 'App Token',       stringKeyNames: ['adjust_app_token', 'adjust_token', 'com.adjust.sdk.appToken'],                               expectedFormat: '12-20 char alphanumeric' },
    { sdk: 'Adjust',          category: 'ATTRIBUTION', keyLabel: 'Environment',     stringKeyNames: ['adjust_environment', 'com.adjust.sdk.Environment'],                                           expectedFormat: '"sandbox" or "production"' },
    { sdk: 'Branch.io',       category: 'ATTRIBUTION', keyLabel: 'Live Key',        stringKeyNames: ['branch_key_live', 'io.branch.sdk.BranchKey', 'branch_key'],                                  expectedFormat: '"key_live_…" prefix' },
    { sdk: 'Branch.io',       category: 'ATTRIBUTION', keyLabel: 'Test Key',        stringKeyNames: ['branch_key_test'],                                                                             expectedFormat: '"key_test_…" prefix' },
    { sdk: 'Singular',        category: 'ATTRIBUTION', keyLabel: 'API Key',         stringKeyNames: ['singular_api_key', 'singular_sdk_key'],                                                       expectedFormat: '16-40 char hex' },
    { sdk: 'Kochava',         category: 'ATTRIBUTION', keyLabel: 'App GUID',        stringKeyNames: ['kochava_app_guid', 'koTracker'],                                                              expectedFormat: 'koAndroid-… prefix' },
    { sdk: 'Facebook SDK',    category: 'ATTRIBUTION', keyLabel: 'App ID',          stringKeyNames: ['facebook_app_id', 'com.facebook.sdk.ApplicationId'],                                         expectedFormat: '15-16 digit numeric' },
    { sdk: 'Facebook SDK',    category: 'ATTRIBUTION', keyLabel: 'Client Token',    stringKeyNames: ['facebook_client_token'],                                                                       expectedFormat: '32-char lowercase hex' },
    { sdk: 'mParticle',       category: 'ATTRIBUTION', keyLabel: 'API Key',         stringKeyNames: ['mparticle_key', 'mp_api_key'],                                                                expectedFormat: '16-char alphanumeric' },
    { sdk: 'mParticle',       category: 'ATTRIBUTION', keyLabel: 'API Secret',      stringKeyNames: ['mparticle_secret', 'mp_api_secret'],                                                          expectedFormat: '32-char alphanumeric' },
    // ── BACKEND ───────────────────────────────────────────────────────────────
    { sdk: 'Firebase',        category: 'BACKEND',     keyLabel: 'Database URL',    stringKeyNames: ['firebase_database_url', 'google_firebase_database'],                                          expectedFormat: 'https://xxx.firebaseio.com' },
    { sdk: 'Firebase',        category: 'BACKEND',     keyLabel: 'Storage Bucket',  stringKeyNames: ['firebase_storage_bucket', 'google_storage_bucket'],                                           expectedFormat: 'projectname.appspot.com' },
    { sdk: 'Firebase',        category: 'BACKEND',     keyLabel: 'Auth Domain',     stringKeyNames: ['firebase_auth_domain'],                                                                        expectedFormat: 'projectname.firebaseapp.com' },
    { sdk: 'PlayFab',         category: 'BACKEND',     keyLabel: 'Title ID',        stringKeyNames: ['playfab_title_id', 'PlayFabTitleId', 'PLAYFAB_TITLE_ID'],                                    expectedFormat: '4-6 char uppercase (e.g. A1B2C)' },
    { sdk: 'PlayFab',         category: 'BACKEND',     keyLabel: 'Dev Secret Key',  stringKeyNames: ['playfab_secret_key', 'PlayFabDevSecretKey'],                                                  expectedFormat: '32+ char alphanumeric' },
    { sdk: 'Photon',          category: 'BACKEND',     keyLabel: 'App ID',          stringKeyNames: ['photon_app_id', 'PhotonAppId', 'PUN_APP_REALTIME'],                                          expectedFormat: 'UUID format' },
    { sdk: 'GameSparks',      category: 'BACKEND',     keyLabel: 'API Key',         stringKeyNames: ['gamesparks_api_key', 'gs_api_key'],                                                           expectedFormat: 'Alphanumeric key string' },
    // ── IAP ───────────────────────────────────────────────────────────────────
    { sdk: 'Google Play Billing', category: 'IAP',     keyLabel: 'License Key',     stringKeyNames: ['google_play_license_key', 'play_billing_key', 'billing_public_key'],                         expectedFormat: 'Base64 RSA public key (400+ chars)' },
    { sdk: 'RevenueCat',      category: 'IAP',         keyLabel: 'Public SDK Key',  stringKeyNames: ['revenuecat_api_key', 'revenue_cat_key', 'com.revenuecat.APIKey'],                            expectedFormat: '"appl_…" or "goog_…" prefix' },
    // ── MONITORING ────────────────────────────────────────────────────────────
    { sdk: 'Crashlytics',     category: 'MONITORING',  keyLabel: 'Firebase App ID', stringKeyNames: ['google_app_id', 'crashlytics_app_id'],                                                        expectedFormat: '1:XXXXXXXXXX:android:XXXXXXXXXXXXXXXX' },
    { sdk: 'Sentry',          category: 'MONITORING',  keyLabel: 'DSN',             stringKeyNames: ['sentry_dsn', 'io.sentry.dsn', 'SENTRY_DSN'],                                                  expectedFormat: 'https://KEY@oXX.ingest.sentry.io/ID' },
    { sdk: 'Instabug',        category: 'MONITORING',  keyLabel: 'App Token',       stringKeyNames: ['instabug_token', 'instabug_api_key', 'INSTABUG_TOKEN'],                                       expectedFormat: '32-char lowercase hex' },
    { sdk: 'New Relic',       category: 'MONITORING',  keyLabel: 'App Token',       stringKeyNames: ['newrelic_token', 'new_relic_app_token', 'com.newrelic.android.AGENT_TOKEN'],                 expectedFormat: 'AA-XXXXXXXX…-NRMA' },
    { sdk: 'Datadog',         category: 'MONITORING',  keyLabel: 'Client Token',    stringKeyNames: ['datadog_client_token', 'DD_CLIENT_TOKEN', 'com.datadog.android.rum.ClientToken'],             expectedFormat: '"pub…" + 32-char hex suffix' },
];

// ─── ELEMENT REFS ────────────────────────────────────────────────────────────
const projectSelect = document.getElementById('project-select');
const createProjectBtn = document.getElementById('create-project-btn');
const newProjectForm = document.getElementById('new-project-form');
const projectNameInput = document.getElementById('project-name-input');
const confirmCreateBtn = document.getElementById('confirm-create-btn');
const cancelCreateBtn = document.getElementById('cancel-create-btn');
const projectMeta = document.getElementById('project-meta');
const activeProjectName = document.getElementById('active-project-name');
const deleteProjectBtn = document.getElementById('delete-project-btn');
const sidebarDeleteBtn = document.getElementById('sidebar-delete-project-btn');
const mainDeleteBtn = document.getElementById('main-delete-project-btn');
const emptyStateCreateBtn = document.getElementById('empty-state-create-btn');
const dropZone = document.getElementById('drop-zone');
const dropText = document.getElementById('drop-text');
const fileNameDisplay = document.getElementById('file-name');
const browseBtn = document.getElementById('browse-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const reportBtn = document.getElementById('report-btn');
const refreshMonitorBtn = document.getElementById('btn-refresh-monitor');

const logsContainer = document.getElementById('status-logs');
const liveDashboard = document.getElementById('live-dashboard');
const liveFps = document.getElementById('live-fps');
const liveNetwork = document.getElementById('live-network');
const liveDevice = document.getElementById('live-device');
const liveFpsCtx = document.getElementById('live-fps-chart');
const liveIssuesPanel = document.getElementById('live-issues-panel');
const liveIssuesList = document.getElementById('live-issues-list');
const clearLogsBtn = document.getElementById('clear-logs-btn');

const deviceStatusBar = document.getElementById('device-status-bar');
const statusDeviceName = document.getElementById('status-device-name');
const statusAndroidVer = document.getElementById('status-android-version');
const statusBattery = document.getElementById('status-battery-level');
const statusConnected = document.getElementById('status-connection');
const livePing = document.getElementById('live-ping');
const liveStress = document.getElementById('live-stress');

const navBtns = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

const historyList = document.getElementById('history-list');
const historyDetail = document.getElementById('history-detail');
const runningControls = document.getElementById('running-controls');
const sessionTimer = document.getElementById('session-timer');

const projectEmptyState = document.getElementById('project-empty-state');
const testContentWrapper = document.getElementById('test-content-wrapper');

const apkInfoDisplay = document.getElementById('apk-info-display');
const apkInfoPkg = document.getElementById('apk-info-pkg');
const apkInfoVer = document.getElementById('apk-info-ver');
const apkInfoMin = document.getElementById('apk-info-min');
const apkInfoTarget = document.getElementById('apk-info-target');

const apkPermissionsList = document.getElementById('apk-permissions-list');

const staticContent = document.getElementById('static-content');
const staticEmptyState = document.getElementById('static-empty-state');
const runtimeContent = document.getElementById('runtime-content');
const runtimeEmptyState = document.getElementById('runtime-empty-state');
const runtimeEngine = document.getElementById('runtime-engine-status');
const runtimeNetwork = document.getElementById('runtime-network-calls');
const runtimePermissions = document.getElementById('runtime-permissions-list');

const allPermissionsList = document.getElementById('all-permissions-list');


const eventsContent = document.getElementById('events-content');
const eventsEmptyState = document.getElementById('events-empty-state');

// IAP Validation references
const iapStartBtn = document.getElementById('iap-start-btn');
const iapStopBtn = document.getElementById('iap-stop-btn');
const iapEmptyState = document.getElementById('iap-empty-state');
const iapContent = document.getElementById('iap-content');
const iapSystemName = document.getElementById('iap-system-name');
const iapStatusBadge = document.getElementById('iap-status-badge');
const iapTimeline = document.getElementById('iap-timeline');
const iapTimer = document.getElementById('iap-timer');
const iapValTime = document.getElementById('iap-val-time');
const iapValBackend = document.getElementById('iap-val-backend');
const iapValError = document.getElementById('iap-val-error');
const iapLibraryVersion = document.getElementById('iap-library-version');
const iapValErrorMessage = document.getElementById('iap-val-error-message');
const iapValErrorMessageRow = document.getElementById('iap-val-error-message-row');
const iapStepInitiate = document.getElementById('iap-step-initiate');
const iapStepResolve  = document.getElementById('iap-step-resolve');
const iapStepAck      = document.getElementById('iap-step-acknowledge');
const iapStepConsume  = document.getElementById('iap-step-consume');
const iapLcVerdict    = document.getElementById('iap-lc-verdict');

const securityRiskLevel = document.getElementById('security-risk-level');
const dangerousPermissionsList = document.getElementById('dangerous-permissions-list');
const privacyPermissionsList = document.getElementById('privacy-permissions-list');
const exportedComponentsList = document.getElementById('exported-components-list');
const securityDebugStatus = document.getElementById('security-debug-status');
const securityBackupStatus = document.getElementById('security-backup-status');
const securityCleartextStatus = document.getElementById('security-cleartext-status');

// ─── TAB NAVIGATION ──────────────────────────────────────────────────────────
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

function switchTab(tabId) {
    const btn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (!btn) return;

    navBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) panel.classList.add('active');

    // Trigger data renders based on tab
    if (tabId === 'runtime') {
        renderRuntimeTab(currentSession.runtime);
    }
    if (tabId === 'events') {
        renderEventsTab(currentSession.runtime);
    }
    if (tabId === 'iap') {
        renderIAPTab();
    }
    if (tabId === 'static') {
        if (currentSession.staticAnalysis) renderStaticAnalysis(currentSession.staticAnalysis);
    }

    if (tabId === 'history' && activeProject) loadHistory();

    if (tabId === 'qa-checklist') {
        renderQAChecklist();
    } else {
        stopQAAutoPolling();
    }

    if (tabId === 'prediction') {
        if (window.DevicePrediction) window.DevicePrediction.start();
    } else {
        if (window.DevicePrediction) window.DevicePrediction.stop();
    }
}

// ─── DEVICE STATUS POLLING ───────────────────────────────────────────────────
let devicePollingInterval = null;
let lastDeviceStatus = null;

async function pollDeviceStatus() {
    const status = await window.api.checkDevice();
    updateDeviceUI(status);

    // Auto-retry/Auto-start logic - Only log on real transition to CONNECTED
    if (lastDeviceStatus && lastDeviceStatus !== 'CONNECTED' && status.status === 'CONNECTED') {
        // Only log if we are not in the middle of a session to avoid noise
        if (sessionState === 'idle') {
            addLog('🟢 Device connected! Ready to start test.', 'success');
        }
    }

    lastDeviceStatus = status.status;
}

function updateDeviceUI(deviceCheck) {
    if (!statusConnected) return;

    let color = '#71717a'; // Gray
    let text = 'Not Connected';
    let icon = '🔴';

    if (deviceCheck.status === 'CONNECTED') {
        color = '#2dd4bf'; // Green
        text = `Connected (${deviceCheck.deviceId})`;
        icon = '🟢';
    } else if (deviceCheck.status === 'UNAUTHORIZED') {
        color = '#fbbf24'; // Yellow
        text = 'Waiting for Authorization';
        icon = '🟡';
    } else {
        color = '#f87171'; // Red
        text = 'No Device Found';
        icon = '🔴';
    }

    statusConnected.textContent = `${icon} ${text}`;
    statusConnected.style.color = color;

    // Update dashboard device info if visible
    if (!liveDashboard.classList.contains('hidden')) {
        liveDevice.textContent = deviceCheck.deviceId || 'No Device';
    }
}

function startDevicePolling() {
    if (devicePollingInterval) clearInterval(devicePollingInterval);
    pollDeviceStatus(); // Initial check
    devicePollingInterval = setInterval(pollDeviceStatus, 2000);
}


// ─── PROJECT MANAGEMENT ──────────────────────────────────────────────────────
async function loadProjects() {
    const projects = await window.api.listProjects();
    projectSelect.innerHTML = '<option value="">— select project —</option>';
    projects.forEach(p => {
        const opt = document.createElement('option');
        const name = p.name || p;
        opt.value = name;
        opt.textContent = name;
        projectSelect.appendChild(opt);
    });
    toggleEmptyState();
}

function toggleEmptyState() {
    if (activeProject) {
        projectEmptyState.classList.add('hidden');
        testContentWrapper.classList.remove('hidden');
        sidebarDeleteBtn.classList.remove('hidden');
    } else {
        projectEmptyState.classList.remove('hidden');
        testContentWrapper.classList.add('hidden');
        sidebarDeleteBtn.classList.add('hidden');
    }
}

async function handleDeleteProject() {
    if (!activeProject) return;
    const confirmed = confirm(`Are you sure you want to delete project "${activeProject}"? This will permanently remove all sessions and data.`);
    if (confirmed) {
        const res = await window.api.deleteProject(activeProject);
        if (res.success) {
            addLog(res.message, 'success');
            activeProject = null;
            projectSelect.value = '';
            projectMeta.classList.add('hidden');
            await loadProjects();
            toggleEmptyState();
        } else {
            addLog(res.message, 'error');
        }
    }
}

deleteProjectBtn.addEventListener('click', handleDeleteProject);
sidebarDeleteBtn.addEventListener('click', handleDeleteProject);
mainDeleteBtn.addEventListener('click', handleDeleteProject);


emptyStateCreateBtn.addEventListener('click', () => {
    newProjectForm.classList.remove('hidden');
    setTimeout(() => {
        projectNameInput.focus();
        projectNameInput.select();
    }, 50);
});

projectSelect.addEventListener('change', async () => {
    const name = projectSelect.value;
    if (!name) {
        activeProject = null;
        projectMeta.classList.add('hidden');
        addLog('ℹ No project selected.', 'info');
        toggleEmptyState();
        return;
    }
    const res = await window.api.selectProject(name);
    if (res.success) {
        activeProject = name;
        activeProjectName.textContent = name;
        projectMeta.classList.remove('hidden');
        newProjectForm.classList.add('hidden'); // Hide form if it was open
        addLog(res.message, 'success');
        toggleEmptyState();
        refreshHistory();
        // If the QA Checklist tab is currently active, repaint with the new project's state.
        if (document.getElementById('tab-qa-checklist')?.classList.contains('active')) {
            renderQAChecklist();
        }
    } else {
        addLog(res.message, 'error');
    }
});

// Show/hide new-project form
createProjectBtn.addEventListener('click', () => {
    const isHidden = newProjectForm.classList.contains('hidden');
    newProjectForm.classList.toggle('hidden');
    if (isHidden) {
        setTimeout(() => {
            projectNameInput.focus();
            projectNameInput.select();
        }, 50);
    }
});

cancelCreateBtn.addEventListener('click', () => {
    newProjectForm.classList.add('hidden');
    projectNameInput.value = '';
});

confirmCreateBtn.addEventListener('click', async () => {
    const name = projectNameInput.value.trim().replace(/\s+/g, '_');
    if (!name) { addLog('❌ Project name cannot be empty.', 'error'); return; }

    const res = await window.api.createProject(name);
    if (res.success) {
        addLog(res.message, 'success');
        await loadProjects();
        projectSelect.value = name;
        projectSelect.dispatchEvent(new Event('change'));
        newProjectForm.classList.add('hidden');
        projectNameInput.value = '';
    } else {
        addLog(res.message, 'error');
    }
});

projectNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmCreateBtn.click();
    if (e.key === 'Escape') cancelCreateBtn.click();
});

// ─── APK SELECTION ───────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('hover');
    const file = e.dataTransfer.files[0];
    const name = (file && file.name) || '';
    if (/\.(apk|ipa)$/i.test(name)) {
        setApk(file.path, file.name);
    } else {
        addLog('❌ Please drop a valid .apk or .ipa file', 'error');
    }
});

browseBtn.addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) {
        const fileName = filePath.split(/[\\/]/).pop();
        setApk(filePath, fileName);
    }
});

async function setApk(filePath, fileName) {
    if (!activeProject) {
        addLog('❌ Please select a project before adding an APK.', 'error');
        return;
    }
    selectedApkPath = filePath;
    fileNameDisplay.textContent = fileName;
    dropText.textContent = '✔ APK ready:';
    startBtn.disabled = false;
    addLog(`✔ APK loaded: ${fileName}`, 'success');

    // Run Static Analysis
    try {
        const info = await window.api.analyzeAPK(filePath);
        if (info) {
            currentSession.staticAnalysis = info;
            renderStaticAnalysis(info);
        } else {
            staticContent.classList.add('hidden');
            staticEmptyState.classList.remove('hidden');
            addLog('⚠️ Static analysis failed (aapt missing?), using basic metadata.', 'info');
        }
    } catch (err) {
        staticContent.classList.add('hidden');
        staticEmptyState.classList.remove('hidden');
    }
}

function renderStaticAnalysis(info) {
    if (!info) return;

    // Platform indicator — show an info banner for iOS builds explaining that
    // runtime session is not yet wired (Phase 1 is static-only).
    showPlatformBanner(info);

    apkInfoPkg.textContent = info.packageName || 'Unknown';
    apkInfoVer.textContent = `${info.versionName || 'N/A'} (Build ${info.versionCode || 'N/A'})`;
    apkInfoMin.textContent = info.minSdk || 'N/A';
    apkInfoTarget.textContent = info.targetSdk || 'N/A';

    // Game Engine
    const engineEl = document.getElementById('apk-info-engine');
    if (engineEl) engineEl.textContent = info.sdkInfo?.engine || 'Native / Unknown';

    // All Permissions List
    allPermissionsList.innerHTML = '';
    if (info.permissions && info.permissions.length > 0) {
        info.permissions.forEach(p => {
            const tag = document.createElement('span');
            tag.className = 'metric';
            tag.style.cssText = 'padding: 2px 6px; font-size: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff;';
            tag.textContent = p;
            allPermissionsList.appendChild(tag);
        });
    } else {
        allPermissionsList.innerHTML = '<span style="font-size: 11px; color: #71717a;">No permissions detected</span>';
    }

    // Security Audit
    if (info.security) {
        const s = info.security;
        securityRiskLevel.textContent = `Risk: ${s.riskLevel}`;
        const riskDetails = [
            ...(s.riskReasons || []).map(reason => `${reason.severity}: ${reason.message}`),
            ...(s.safeFindings || []).map(reason => `SAFE: ${reason.message}`)
        ];
        securityRiskLevel.title = riskDetails.join('\n');
        securityRiskLevel.style.background = s.riskLevel === 'HIGH' ? 'rgba(239, 68, 68, 0.2)' : s.riskLevel === 'MEDIUM' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(34, 197, 94, 0.2)';
        securityRiskLevel.style.color = s.riskLevel === 'HIGH' ? '#fca5a5' : s.riskLevel === 'MEDIUM' ? '#fde047' : '#86efac';

        // Dangerous Permissions
        dangerousPermissionsList.innerHTML = '';
        if (s.dangerousPermissions && s.dangerousPermissions.length > 0) {
            s.dangerousPermissions.forEach(p => {
                const span = document.createElement('span');
                span.style.cssText = 'font-size: 10px; color: #fca5a5; background: rgba(239,68,68,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.2);';
                span.textContent = p.split('.').pop();
                dangerousPermissionsList.appendChild(span);
            });
        } else {
            dangerousPermissionsList.innerHTML = '<span style="font-size: 11px; color: #2dd4bf;">✔ No dangerous permissions found</span>';
        }

        // Privacy-Relevant Permissions
        privacyPermissionsList.innerHTML = '';
        if (s.privacyPermissions && s.privacyPermissions.length > 0) {
            s.privacyPermissions.forEach(p => {
                const span = document.createElement('span');
                span.style.cssText = 'font-size: 10px; color: #c4b5fd; background: rgba(139,92,246,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(139,92,246,0.2);';
                span.textContent = `${p.split('.').pop()} (Low signal)`;
                privacyPermissionsList.appendChild(span);
            });
        } else {
            privacyPermissionsList.innerHTML = '<span style="font-size: 11px; color: #71717a;">None detected</span>';
        }

        // Exported Components
        exportedComponentsList.innerHTML = '';
        if (s.exportedComponents && s.exportedComponents.length > 0) {
            s.exportedComponents.forEach(c => {
                const span = document.createElement('span');
                const isUnprotected = (s.unprotectedExportedComponents || []).some(item => item.fullName === c.fullName);
                span.style.cssText = isUnprotected
                    ? 'font-size: 10px; color: #fca5a5; background: rgba(239,68,68,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.2);'
                    : 'font-size: 10px; color: #38bdf8; background: rgba(56,189,248,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(56,189,248,0.2);';
                const typeLabel = c.type === 'Activity Alias' ? 'AA' : c.type.charAt(0);
                const sourceLabel = c.exportedSource === 'implicit-intent-filter' ? ' implicit' : '';
                span.title = isUnprotected
                    ? `${c.fullName || c.name}\nUnprotected app-exported component (High risk signal)`
                    : `${c.fullName || c.name}\nProtected, launcher, or standard SDK component`;
                span.textContent = `${c.name} (${typeLabel}${sourceLabel}${isUnprotected ? ', High risk signal' : ''})`;
                exportedComponentsList.appendChild(span);
            });
        } else {
            exportedComponentsList.innerHTML = '<span style="font-size: 11px; color: #71717a;">None detected</span>';
        }

        // Debug Status
        securityDebugStatus.textContent = s.debuggable ? 'ENABLED' : 'DISABLED';
        securityDebugStatus.style.color = s.debuggable ? '#fca5a5' : '#2dd4bf';

        securityBackupStatus.textContent = s.allowBackup ? 'ENABLED (Medium risk)' : 'DISABLED';
        securityBackupStatus.style.color = s.allowBackup ? '#fde047' : '#2dd4bf';

        securityCleartextStatus.textContent = s.usesCleartextTraffic ? 'ALLOWED' : 'BLOCKED / DEFAULT';
        securityCleartextStatus.style.color = s.usesCleartextTraffic ? '#fca5a5' : '#2dd4bf';
    }

    renderAssetIntegrity(info.assetIntegrity);
    renderIosInfo(info.iosInfo);

    staticContent.classList.remove('hidden');
    staticEmptyState.classList.add('hidden');
}

// iOS-specific banner shown at the top of the Static Analysis tab so the
// tester immediately knows static-only mode is in effect and the Start Test
// button will not run a real iOS session in Phase 1.
function showPlatformBanner(info) {
    let banner = document.getElementById('platform-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'platform-banner';
        banner.className = 'platform-banner hidden';
        const host = document.getElementById('static-content') || staticContent;
        if (host && host.firstChild) host.insertBefore(banner, host.firstChild);
        else if (host) host.appendChild(banner);
    }
    if (info && info.platform === 'ios') {
        banner.classList.remove('hidden');
        banner.classList.add('platform-banner-ios');
        banner.innerHTML =
            '<span class="platform-banner-icon">🍎</span>' +
            '<div>' +
                '<b>iOS build (.ipa) — static analysis only.</b> ' +
                'Bundle ID, version, frameworks, SDKs, permissions, code signing and provisioning are extracted from the IPA on any host OS. ' +
                'Runtime session (install, syslog, performance) requires a Mac with libimobiledevice + Xcode and is planned for Phase 2.' +
            '</div>';
    } else {
        banner.classList.add('hidden');
        banner.classList.remove('platform-banner-ios');
    }
}

function renderIosInfo(iosInfo) {
    let card = document.getElementById('ios-info-card');
    if (!iosInfo) {
        if (card) card.classList.add('hidden');
        return;
    }
    if (!card) {
        // Build the card lazily so we don't inflate the DOM for Android-only sessions.
        card = document.createElement('div');
        card.id = 'ios-info-card';
        card.className = 'card ios-card';
        const host = document.getElementById('static-content') || staticContent;
        if (host) host.appendChild(card);
    }
    card.classList.remove('hidden');

    const prov = iosInfo.provisioning || {};
    const profileKind = prov.isAppStore ? 'App Store'
                      : prov.isEnterprise ? 'Enterprise'
                      : prov.isAdHoc ? 'Ad Hoc / Development'
                      : 'Unknown';
    const expiresAt = prov.expirationDate ? new Date(prov.expirationDate) : null;
    const expiresStr = expiresAt && !isNaN(expiresAt.getTime())
        ? expiresAt.toLocaleDateString() + ' (' + Math.round((expiresAt - Date.now()) / 86400000) + ' days)'
        : '—';

    card.innerHTML =
        '<div class="ios-header">' +
            '<div class="ios-title"><span class="ios-icon">🍎</span><span>iOS Build Details</span><span class="ios-tag">IPA</span></div>' +
        '</div>' +
        '<div class="ios-kpis">' +
            kpi('Engine',            iosInfo.engine || '—', '') +
            kpi('Architectures',     (iosInfo.executable && iosInfo.executable.archs || []).join(', ') || '—', '') +
            kpi('Bundle Size',       iosInfo.bundleSize ? (iosInfo.bundleSize / 1048576).toFixed(1) + ' MB' : '—', '') +
            kpi('Files',             iosInfo.fileCount || 0, '') +
        '</div>' +
        '<div class="ios-section">' +
            '<div class="ios-section-head">Device Family</div>' +
            '<div>' + (iosInfo.deviceFamily || []).map(d => '<span class="ios-pill">' + escapeHtml(d) + '</span>').join(' ') + '</div>' +
        '</div>' +
        '<div class="ios-section">' +
            '<div class="ios-section-head">Frameworks (' + (iosInfo.frameworks || []).length + ')</div>' +
            '<div class="ios-fw-list">' +
                (iosInfo.frameworks || []).slice(0, 50).map(f => '<code class="ios-fw">' + escapeHtml(f) + '</code>').join('') +
                ((iosInfo.frameworks || []).length > 50 ? '<span class="ios-more">+ ' + ((iosInfo.frameworks || []).length - 50) + ' more</span>' : '') +
            '</div>' +
        '</div>' +
        '<div class="ios-section">' +
            '<div class="ios-section-head">Detected SDKs</div>' +
            '<div>' + (iosInfo.sdks || []).map(s => '<span class="ios-pill ios-pill-sdk">' + escapeHtml(s) + '</span>').join(' ') + '</div>' +
        '</div>' +
        '<div class="ios-section">' +
            '<div class="ios-section-head">Provisioning Profile</div>' +
            '<div class="ios-prov">' +
                '<div><span class="ios-prov-k">Type:</span> <b>' + escapeHtml(profileKind) + '</b></div>' +
                '<div><span class="ios-prov-k">Team:</span> ' + escapeHtml(prov.teamName || '—') + ' <span class="ios-prov-id">(' + escapeHtml(prov.teamId || '—') + ')</span></div>' +
                '<div><span class="ios-prov-k">Devices on profile:</span> ' + (prov.provisionedDeviceCount || 0) + '</div>' +
                '<div><span class="ios-prov-k">Expires:</span> ' + escapeHtml(expiresStr) + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="ios-section">' +
            '<div class="ios-section-head">Localization (' + (iosInfo.locales || []).length + ' .lproj)</div>' +
            '<div>' + (iosInfo.locales || []).map(l => '<span class="ios-pill ios-pill-loc">' + escapeHtml(l) + '</span>').join(' ') + '</div>' +
        '</div>' +
        ((iosInfo.urlSchemes || []).length > 0
            ? '<div class="ios-section"><div class="ios-section-head">URL Schemes</div><div>' +
                iosInfo.urlSchemes.map(u => '<code class="ios-url">' + escapeHtml(u) + '</code>').join(' ') +
              '</div></div>'
            : '');

    function kpi(label, value, sub) {
        return '<div class="ios-kpi">' +
            '<div class="ios-kpi-label">' + escapeHtml(label) + '</div>' +
            '<div class="ios-kpi-value">' + escapeHtml(String(value)) + '</div>' +
            (sub ? '<div class="ios-kpi-sub">' + escapeHtml(sub) + '</div>' : '') +
        '</div>';
    }
}

// ─── Asset Integrity panel ───────────────────────────────────────────────────
// Renders the result from assetIntegrityAnalyzer.analyzeAssets() into the
// dedicated card in the Static Analysis tab. No polling — the data is
// computed once per APK at analyzeAPK time and flows through info.assetIntegrity.
function renderAssetIntegrity(ai) {
    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    const setHTML = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
    const fmtMB = b => (Number(b || 0) / 1048576).toFixed(2);

    if (!ai || !ai.summary) {
        setText('ai-warnings-count', '—');
        setText('ai-zero-byte', '—');
        setText('ai-tiny-audio', '—');
        setText('ai-dups', '—');
        setText('ai-dup-waste', '— MB wasted');
        setText('ai-locales', '—');
        setText('ai-loc-completeness', '—');
        setHTML('ai-cat-grid', '<div class="ai-empty">Analyze an APK to populate.</div>');
        setHTML('ai-warn-list', '<div class="ai-empty">No findings yet.</div>');
        setHTML('ai-details', '<div class="ai-empty">Analyze an APK to see details.</div>');
        return;
    }

    const s = ai.summary;
    const warnCount = (ai.warnings || []).length;
    const warnCountEl = document.getElementById('ai-warnings-count');
    if (warnCountEl) {
        warnCountEl.textContent = warnCount === 0 ? '✓ clean' : warnCount + ' finding' + (warnCount === 1 ? '' : 's');
        warnCountEl.className = 'ai-warnings-count ' + (warnCount === 0 ? 'ai-clean' : 'ai-has-warnings');
    }

    setText('ai-zero-byte', s.zeroByteCount);
    setText('ai-tiny-audio', s.suspiciousAudioCount);
    setText('ai-dups', s.duplicateGroupCount);
    setText('ai-dup-waste', fmtMB(s.dupWastedBytes) + ' MB wasted');
    setText('ai-locales', s.localesCount);
    setText('ai-loc-completeness', s.localesCount > 0 ? s.localizationCompleteness + '%' : '—');

    // Categories grid
    const cats = ai.categories || {};
    const catOrder = Object.entries(cats).sort((a, b) => b[1].bytes - a[1].bytes);
    if (catOrder.length === 0) {
        setHTML('ai-cat-grid', '<div class="ai-empty">No assets classified.</div>');
    } else {
        const totalBytes = Object.values(cats).reduce((sum, c) => sum + c.bytes, 0);
        setHTML('ai-cat-grid', catOrder.map(([cat, c]) => {
            const pct = totalBytes > 0 ? (c.bytes / totalBytes * 100) : 0;
            return '<div class="ai-cat">' +
                '<div class="ai-cat-name">' + escapeHtml(cat) + '</div>' +
                '<div class="ai-cat-bar"><div class="ai-cat-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
                '<div class="ai-cat-meta"><span>' + c.count + ' files</span><span>' + fmtMB(c.bytes) + ' MB</span></div>' +
            '</div>';
        }).join(''));
    }

    // Warnings (findings) list
    const warnings = ai.warnings || [];
    if (warnings.length === 0) {
        setHTML('ai-warn-list', '<div class="ai-warn ai-warn-clean">✓ No integrity issues found.</div>');
    } else {
        setHTML('ai-warn-list', warnings.map(w => {
            const icon = w.level === 'error' ? '✗' : w.level === 'warn' ? '⚠' : 'ℹ';
            return '<div class="ai-warn ai-warn-' + escapeHtml(w.level) + '">' +
                '<span class="ai-warn-icon">' + icon + '</span>' +
                '<div class="ai-warn-body">' +
                    '<div class="ai-warn-msg">' + escapeHtml(w.message) + '</div>' +
                    '<div class="ai-warn-code">' + escapeHtml(w.code) + '</div>' +
                '</div>' +
            '</div>';
        }).join(''));
    }

    // Details: collapsibles for zero-byte / tiny audio / duplicates / locales
    const blocks = [];
    if ((ai.zeroByteFiles || []).length > 0) {
        blocks.push(buildAiDetailsBlock('Zero-byte files (' + ai.zeroByteFiles.length + ')',
            ai.zeroByteFiles.map(p => '<div class="ai-detail-row"><code>' + escapeHtml(p) + '</code></div>').join('')));
    }
    if ((ai.suspiciousAudio || []).length > 0) {
        blocks.push(buildAiDetailsBlock('Tiny audio (' + ai.suspiciousAudio.length + ')',
            ai.suspiciousAudio.map(a => '<div class="ai-detail-row"><span class="ai-detail-meta">' + a.bytes + ' B</span><code>' + escapeHtml(a.path) + '</code></div>').join('')));
    }
    if ((ai.duplicates || []).length > 0) {
        const dupHtml = ai.duplicates.slice(0, 30).map(d =>
            '<div class="ai-dup-group">' +
                '<div class="ai-dup-header"><span>' + d.files.length + ' copies · ' + fmtMB(d.wastedBytes) + ' MB wasted</span><span class="ai-sha">' + escapeHtml(d.sha1.slice(0, 10)) + '</span></div>' +
                d.files.slice(0, 5).map(p => '<div class="ai-detail-row"><code>' + escapeHtml(p) + '</code></div>').join('') +
                (d.files.length > 5 ? '<div class="ai-detail-more">+' + (d.files.length - 5) + ' more</div>' : '') +
            '</div>'
        ).join('');
        const extra = ai.duplicates.length > 30 ? '<div class="ai-detail-more">+' + (ai.duplicates.length - 30) + ' more groups</div>' : '';
        blocks.push(buildAiDetailsBlock('Duplicate groups (' + ai.duplicates.length + ')', dupHtml + extra));
    }
    if ((ai.localization?.locales || []).length > 0) {
        const locHtml = ai.localization.locales.map(l => {
            const m = (l.missing || []).slice(0, 8).map(k => '<code>' + escapeHtml(k) + '</code>').join(', ');
            const extra = (l.missing || []).length > 8 ? ' <span class="ai-detail-more">+' + (l.missing.length - 8) + ' more</span>' : '';
            return '<div class="ai-locale-row">' +
                '<div class="ai-locale-head"><b>' + escapeHtml(l.locale) + '</b> — ' + l.keyCount + ' keys, ' + (l.missing || []).length + ' missing</div>' +
                ((l.missing || []).length > 0 ? '<div class="ai-locale-missing">Missing: ' + m + extra + '</div>' : '') +
            '</div>';
        }).join('');
        blocks.push(buildAiDetailsBlock('Localization (' + ai.localization.locales.length + ' locale' + (ai.localization.locales.length === 1 ? '' : 's') + ')', locHtml));
    }

    setHTML('ai-details', blocks.length === 0
        ? '<div class="ai-empty">No detail-level issues to surface — clean build.</div>'
        : blocks.join(''));
}

function buildAiDetailsBlock(title, bodyHtml) {
    return '<details class="ai-details-block">' +
        '<summary class="ai-details-summary">' + escapeHtml(title) + '</summary>' +
        '<div class="ai-details-body">' + bodyHtml + '</div>' +
    '</details>';
}

function updateSessionState(newState) {
    sessionState = newState;

    // Toggle button visibility
    if (sessionState === 'idle') {
        startBtn.classList.remove('hidden');
        runningControls.classList.add('hidden');
        if (reportBtn) reportBtn.classList.add('hidden');
        startBtn.disabled = !selectedApkPath; // Keep disabled if no APK
        stopTimer();
    } else if (sessionState === 'running') {
        startBtn.classList.add('hidden');
        runningControls.classList.remove('hidden');
        stopBtn.disabled = false;
        stopBtn.textContent = '■ Stop Test';
        if (reportBtn) reportBtn.classList.add('hidden');
        startTimer();
        if (typeof startFbEventsPolling === 'function') startFbEventsPolling();
        if (typeof startChoiceEventsPolling === 'function') startChoiceEventsPolling();
        if (typeof startSaveStatePolling === 'function') startSaveStatePolling();
        if (typeof startTextOverflowPolling === 'function') startTextOverflowPolling();
    } else if (sessionState === 'stopped') {
        startBtn.classList.remove('hidden');
        startBtn.disabled = !selectedApkPath;
        runningControls.classList.add('hidden');
        if (reportBtn) reportBtn.classList.add('hidden');
        stopTimer();
        // Keep polling once more after stop so the final flushed state lands
        // in the UI; then stop the timer.
        if (typeof pollFbEventsOnce === 'function') pollFbEventsOnce();
        if (typeof stopFbEventsPolling === 'function') stopFbEventsPolling();
        if (typeof pollChoiceEventsOnce === 'function') pollChoiceEventsOnce();
        if (typeof stopChoiceEventsPolling === 'function') stopChoiceEventsPolling();
        if (typeof pollSaveStateOnce === 'function') pollSaveStateOnce();
        if (typeof stopSaveStatePolling === 'function') stopSaveStatePolling();
        if (typeof pollTextOverflowOnce === 'function') pollTextOverflowOnce();
        if (typeof stopTextOverflowPolling === 'function') stopTextOverflowPolling();
    }
}

function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    sessionTimer.textContent = '00:00';
    resetMilestones();
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        sessionTimer.textContent = `${mins}:${secs}`;
        tickMilestones(secondsElapsed);
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
}

// ─── SESSION MILESTONES ───────────────────────────────────────────────────────

const SESSION_MILESTONES = [
    { id: 'launch',   secs: 30,   label: 'Launch verified', detail: 'No crash in first 30s' },
    { id: 'sdk',      secs: 60,   label: 'SDK init',        detail: 'Firebase / analytics SDKs' },
    { id: 'network',  secs: 180,  label: 'Network active',  detail: 'First analytics calls' },
    { id: 'memory',   secs: 180,  label: 'Memory baseline', detail: 'Stable PSS established' },
    { id: 'leak',     secs: 600,  label: 'Leak detection',  detail: '10-min memory trend' },
    { id: 'complete', secs: 1200, label: 'Full coverage',   detail: 'All checks complete' },
];

let _milestoneState = {};

function resetMilestones() {
    SESSION_MILESTONES.forEach(m => { _milestoneState[m.id] = 'pending'; });
    renderMilestones();
}

function tickMilestones(secs, signals = {}) {
    let changed = false;
    for (const m of SESSION_MILESTONES) {
        if (_milestoneState[m.id] === 'done') continue;

        // Signal-based early completion
        if (m.id === 'sdk' && signals.hasSdkData && _milestoneState[m.id] !== 'done') {
            _milestoneState[m.id] = 'done'; changed = true; continue;
        }
        if (m.id === 'network' && signals.hasNetwork && _milestoneState[m.id] !== 'done') {
            _milestoneState[m.id] = 'done'; changed = true; continue;
        }

        // Time-based completion
        if (secs >= m.secs) {
            _milestoneState[m.id] = 'done'; changed = true; continue;
        }

        // Approaching: pulsing dot when within 30s of milestone
        const prev = _milestoneState[m.id];
        const next = secs >= m.secs - 30 ? 'active' : 'pending';
        if (prev !== next) { _milestoneState[m.id] = next; changed = true; }
    }
    if (changed) renderMilestones();
}

function renderMilestones() {
    const list = document.getElementById('session-milestones-list');
    if (!list) return;

    const done = SESSION_MILESTONES.filter(m => _milestoneState[m.id] === 'done').length;
    const pct  = Math.round((done / SESSION_MILESTONES.length) * 100);

    list.innerHTML = SESSION_MILESTONES.map(m => {
        const state = _milestoneState[m.id] || 'pending';
        const mins  = Math.floor(m.secs / 60);
        const secs  = m.secs % 60;
        const t     = mins > 0 ? (secs > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : `${mins}m`) : `${m.secs}s`;
        const dotCls = state === 'done' ? 'ms-dot ms-dot--done'
                     : state === 'active' ? 'ms-dot ms-dot--active'
                     : 'ms-dot';
        const rowCls = `ms-row ms-row--${state}`;
        return `<div class="${rowCls}" title="${m.detail}">
            <span class="${dotCls}"></span>
            <span class="ms-time">${t}</span>
            <span class="ms-label">${m.label}</span>
        </div>`;
    }).join('');

    const bar = document.getElementById('session-milestones-bar');
    if (bar) bar.style.width = `${pct}%`;
    const pctEl = document.getElementById('session-milestones-pct');
    if (pctEl) pctEl.textContent = pct >= 100 ? '✓ Done' : `${pct}%`;
}

// ─── SESSION CONTROL ─────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
    if (!selectedApkPath) return;
    addLog(`🚀 Starting QA session for: ${fileNameDisplay.textContent}`, 'info');
    startBtn.disabled = true;
    const reportContainer = document.getElementById('report-container');
    if (reportContainer) reportContainer.classList.add('hidden');
    liveDashboard.classList.remove('hidden');
    liveIssuesPanel.classList.add('hidden');
    if (liveFps) { liveFps.textContent = '--'; liveFps.style.color = ''; }
    if (liveNetwork) liveNetwork.textContent = '--';
    if (liveDevice) liveDevice.textContent = '--';
    if (livePing) livePing.textContent = '-- ms';
    ['live-frame-time','live-cpu','live-memory'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '--';
    });
    window._fpsTracker = null;
    ['fps-min','fps-avg','fps-peak'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
    initLiveChart();

    // Fetch device info once per session
    try {
        const deviceInfo = await window.api.getDeviceInfo();
        statusDeviceName.textContent = deviceInfo.model;
        statusAndroidVer.textContent = deviceInfo.androidVersion;
        statusBattery.textContent = deviceInfo.battery;
        statusConnected.textContent = deviceInfo.status;
        statusConnected.style.color = String(deviceInfo.status).toUpperCase() === 'CONNECTED' ? '#2dd4bf' : '#f87171';
        deviceStatusBar.classList.remove('hidden');
    } catch (err) {
        console.error('Failed to fetch device info', err);
    }

    let res;
    try {
        res = await window.api.startTest(selectedApkPath);
    } catch (err) {
        addLog(`❌ Error: ${err.message}`, 'error');
        updateSessionState('idle');
        deviceStatusBar.classList.add('hidden');
        return;
    }

    if (res.success) {
        addLog(res.message, 'success');
        updateSessionState('running');

        // Reset Global Session State
        currentSession.runtime = null;

        // Reset Runtime UI
        renderRuntimeTab(null);
    } else {
        addLog(res.message, 'error');
        updateSessionState('idle');
        deviceStatusBar.classList.add('hidden');
    }
});

if (refreshMonitorBtn) {
    refreshMonitorBtn.addEventListener('click', () => location.reload());
    refreshMonitorBtn.addEventListener('mouseenter', () => {
        refreshMonitorBtn.style.background = '#3f3f46';
        refreshMonitorBtn.style.color = '#e4e4e7';
    });
    refreshMonitorBtn.addEventListener('mouseleave', () => {
        refreshMonitorBtn.style.background = '#27272a';
        refreshMonitorBtn.style.color = '#a1a1aa';
    });
}

stopBtn.addEventListener('click', async () => {
    addLog('ℹ Stopping session…', 'info');
    stopBtn.disabled = true;
    const originalText = stopBtn.textContent;
    stopBtn.textContent = 'Stopping…';

    // Stop timer immediately for better UX
    stopTimer();

    const res = await window.api.stopTest();
    stopBtn.textContent = originalText;

    if (res.success) {
        addLog(res.message, 'success');
        updateSessionState('stopped');

        // Always refresh history so the new session appears immediately
        refreshHistory();
    } else {
        addLog(res.message, 'error');
        stopBtn.disabled = false;
    }
});



clearLogsBtn.addEventListener('click', () => { logsContainer.innerHTML = ''; });

// ─── HISTORY ─────────────────────────────────────────────────────────────────
async function loadHistory() {
    return refreshHistory();
}

function getSummaryText(item) {
    if (!item) return '';
    if (typeof item.summary === 'string') return item.summary;
    return item.summaryText || '';
}

function isSessionFailed(item) {
    if (!item) return false;
    if (item.crash || item.anr) return true;
    if (typeof item.summary === 'object' && item.summary) {
        return !!(item.summary.crash || item.summary.anr);
    }
    return getSummaryText(item).toLowerCase().includes('critical');
}

function formatSessionDate(timestamp) {
    if (!timestamp) return 'Unknown date';
    const normalizedTimestamp = typeof timestamp === 'number' && timestamp < 1000000000000
        ? timestamp * 1000
        : timestamp;
    const date = new Date(normalizedTimestamp);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

function getTimestampMs(timestamp) {
    if (!timestamp) return 0;
    if (typeof timestamp === 'number') return timestamp < 1000000000000 ? timestamp * 1000 : timestamp;
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

async function refreshHistory() {
    console.log('refreshHistory called, activeProject:', activeProject);
    if (!activeProject) {
        if (historyList) historyList.innerHTML = '<p class="empty-state">Select a project to view history.</p>';
        return;
    }
    
    if (!historyList) {
        console.error('historyList element not found!');
        return;
    }

    try {
        const history = await window.api.getHistory(activeProject);
        console.log('Fetched history for', activeProject, ':', history);

        historyList.innerHTML = '';
        if (!history || history.length === 0) {
            console.log('History is empty or null');
            historyList.innerHTML = '<p class="empty-state">No test sessions yet</p>';
            return;
        }

        const sortedHistory = [...history]
            .filter(item => item && typeof item === 'object')
            .map((item, i) => ({ ...item, index: i + 1 }))
            .sort((a, b) => {
                const timeA = getTimestampMs(a.timestamp);
                const timeB = getTimestampMs(b.timestamp);
                return timeB - timeA;
            });

        console.log('Sorted history count:', sortedHistory.length);

        sortedHistory.forEach(item => {
            const failed = isSessionFailed(item);
            const summary = getSummaryText(item);
            const warning = !failed && summary.toLowerCase().includes('instability');
            const statusColor = failed ? '#ef4444' : warning ? '#f59e0b' : '#22c55e';
            const statusLabel = failed ? 'FAIL' : warning ? 'WARN' : 'PASS';
            const apkName = item.apkName || item.packageName || 'Unknown APK';
            const dateTime = formatSessionDate(item.timestamp);
            const durationStr = item.duration ? `${Math.floor(item.duration / 60)}m ${item.duration % 60}s` : '';
            const avgFPS = item.metrics?.avgFPS || 0;

            const div = document.createElement('div');
            div.className = 'history-item';
            div.style.position = 'relative';
            div.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <div style="font-size:12px;font-weight:600;color:#e4e4e7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:155px;">${escapeHtml(apkName)}</div>
                    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                        <span style="font-size:9px;font-weight:700;color:${statusColor};background:${statusColor}18;padding:2px 7px;border-radius:10px;">${statusLabel}</span>
                        <button class="delete-session-btn" title="Delete session" style="background:none;border:none;cursor:pointer;color:#52525b;padding:0;line-height:1;display:flex;align-items:center;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                    </div>
                </div>
                <div style="font-size:10px;color:#52525b;">${dateTime}${durationStr ? ' · ' + durationStr : ''}</div>
                ${avgFPS > 0 ? `<div style="font-size:10px;color:#3f3f46;margin-top:2px;">${avgFPS} FPS avg</div>` : ''}
            `;

            const delBtn = div.querySelector('.delete-session-btn');
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete Session #${item.index}?`)) {
                    await window.api.deleteSession(activeProject, item.sessionId);
                    refreshHistory();
                    historyDetail.innerHTML = '<p class="empty-state">Session deleted.</p>';
                }
            });

            div.addEventListener('click', () => loadHistoryItem(item.sessionId, div));
            historyList.appendChild(div);
        });
    } catch (err) {
        console.error('Error in refreshHistory:', err);
        historyList.innerHTML = `<p class="empty-state" style="color: #fca5a5;">Error loading history: ${err.message}</p>`;
    }
}


// ─── HISTORY: REPORT DETAIL VIEW ─────────────────────────────────────────────
// Renders one saved session report. Two-part layout matching the QA Checklist tab:
//   • Verdict banner + executive summary + key metrics
//   • Automated section — categorized PASS/WARN/FAIL with evidence
//   • Manual section — per-section progress (passed/failed/pending) + failed-item list
//   • Build info + recommendations
// Falls back gracefully for old session JSONs that pre-date the qaReport field.

// Synthesize a qaReport-shaped object from old reports so the renderer below
// has one code path. Old JSONs have testValidation.{automated,manual} and a
// flat checklist — we map them onto the new shape rather than branching.
function buildLegacyQaReport(r) {
    const tv = r.testValidation || null;
    const auto = tv?.automated || { summary: { pass: 0, warn: 0, fail: 0 }, categories: [] };
    const summary = auto.summary || { pass: 0, warn: 0, fail: 0 };

    let verdict;
    if (auto.categories?.some(c => c.items?.some(it => it.status === 'FAIL' && (it.severity === 'CRITICAL' || it.severity === 'HIGH')))) {
        verdict = { code: 'CRITICAL', label: 'Critical Failures', color: '#ef4444', tagline: 'High-severity issues detected — do not ship.' };
    } else if (summary.fail > 0) {
        verdict = { code: 'NEEDS_FIXES', label: 'Needs Fixes', color: '#f97316', tagline: `${summary.fail} automated check(s) failed.` };
    } else if (summary.warn > 0) {
        verdict = { code: 'NEEDS_REVIEW', label: 'Needs Review', color: '#facc15', tagline: `${summary.warn} warning(s) need review.` };
    } else {
        verdict = { code: 'PRODUCTION_READY', label: 'Production Ready', color: '#22c55e', tagline: 'All automated checks pass.' };
    }
    const met = r.metrics || {};
    return {
        verdict,
        executiveSummary: r.summaryText || (typeof r.summary === 'string' ? r.summary : `${verdict.label}. ${verdict.tagline}`),
        keyMetrics: {
            avgFPS: met.avgFPS || 0,
            peakMemory: r.performance?.peakMemory || met.memory?.peak || 0,
            avgCPU: r.performance?.avgCPU || 0,
            crashCount: met.crashCount || 0,
            anrCount: met.anrCount || 0,
            errorCount: met.errorCount || 0,
            duration: r.duration || 0
        },
        automated: auto,
        manual: { totals: { total: 0, passed: 0, failed: 0, pending: 0, progressPct: 0 }, sections: [] }
    };
}


const VERDICT_CLASS = {
    PRODUCTION_READY: 'is-ready',
    NEEDS_REVIEW:     'is-review',
    NEEDS_FIXES:      'is-fixes',
    CRITICAL:         'is-critical'
};

async function loadHistoryItem(sessionId, el) {
    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    historyDetail.innerHTML = '<p class="empty-state">Loading…</p>';
    const r = await window.api.getSessionReport(activeProject, sessionId);
    if (!r) {
        historyDetail.innerHTML = '<p class="empty-state">Report not found.</p>';
        return;
    }

    const qa = r.qaReport || buildLegacyQaReport(r);
    const v  = qa.verdict;
    const km = qa.keyMetrics;
    const apk = r.apkInfo || {};
    const net = r.metrics?.network || r.advancedInsights?.network || {};

    const durationStr = km.duration ? `${Math.floor(km.duration / 60)}m ${km.duration % 60}s` : '—';
    const fpsClass    = km.avgFPS >= 55 ? 'good' : km.avgFPS >= 30 ? 'warn' : km.avgFPS > 0 ? 'bad' : 'muted';
    const cpuClass    = km.avgCPU >= 70 ? 'bad' : km.avgCPU >= 40 ? 'warn' : km.avgCPU > 0 ? 'good' : 'muted';
    const verdictClass = VERDICT_CLASS[v.code] || '';

    // ── Verdict banner ───────────────────────────────────────────────────
    const verdictHtml = `
        <header class="report-verdict ${verdictClass}">
            <div class="report-verdict__row">
                <span class="report-verdict__chip">${escapeHtml(v.label)}</span>
                <h2 class="report-verdict__title">${escapeHtml(r.apkName || r.packageName || sessionId)}</h2>
            </div>
            <p class="report-verdict__tagline">${escapeHtml(v.tagline || '')}</p>
            <div class="report-verdict__meta">
                <span>${formatSessionDate(r.timestamp)}</span>
                <span>·</span>
                <span>${durationStr}</span>
            </div>
        </header>`;

    // ── Executive summary ────────────────────────────────────────────────
    const summaryHtml = qa.executiveSummary ? `
        <section>
            <h3 class="report-eyebrow">Summary</h3>
            <div class="report-block">
                <p class="report-summary__text">${escapeHtml(qa.executiveSummary)}</p>
            </div>
        </section>` : '';

    // ── Key metrics ──────────────────────────────────────────────────────
    const peakMem = km.peakMemory || 0;
    const avgPing = net.avgPing || 0;
    const metric = (label, value, cls = 'muted', unit = '') => `
        <div class="report-metric">
            <div class="report-metric__value ${cls}">${value || '—'}${unit ? `<span class="report-metric__unit">${unit}</span>` : ''}</div>
            <div class="report-metric__label">${label}</div>
        </div>`;
    const metricsHtml = `
        <section>
            <h3 class="report-eyebrow">Key Metrics</h3>
            <div class="report-metrics-grid">
                ${metric('Avg FPS',   km.avgFPS, fpsClass)}
                ${metric('Peak MB',   peakMem, peakMem ? 'muted' : 'muted')}
                ${metric('Crashes',   km.crashCount, km.crashCount > 0 ? 'bad' : 'muted')}
                ${metric('ANRs',      km.anrCount,   km.anrCount   > 0 ? 'bad' : 'muted')}
                ${metric('CPU Avg',   km.avgCPU || 0, cpuClass, km.avgCPU ? '%' : '')}
                ${metric('Ping ms',   avgPing, 'muted')}
            </div>
        </section>`;

    // ── Automated section ────────────────────────────────────────────────
    const auto = qa.automated || { summary: { pass: 0, warn: 0, fail: 0 }, categories: [] };
    const autoSum = auto.summary;
    let automatedBody;
    if (auto.categories?.length) {
        const CAT_ORDER = ['APK Compliance', 'Security', 'Runtime Stability', 'Performance', 'SDK Integrations', 'Network Validation'];
        const ordered = CAT_ORDER
            .map(name => auto.categories.find(c => c.category === name))
            .filter(Boolean);

        const itemRow = (it) => {
            const cls = it.status === 'FAIL' ? 'report-item--fail'
                      : it.status === 'WARN' ? 'report-item--warn'
                      : 'report-item--pass';
            const icon = it.status === 'FAIL' ? '✗' : it.status === 'WARN' ? '⚠' : '✓';
            const evid = (it.evidence || []).find(e => e && !e.startsWith('Fix:') && !e.startsWith('Static APK')) || '';
            return `<div class="report-item ${cls}">
                <span class="report-item__icon">${icon}</span>
                <div class="report-item__body">
                    <div class="report-item__title">${escapeHtml(it.title)}</div>
                    ${evid ? `<div class="report-item__evidence">${escapeHtml(evid)}</div>` : ''}
                </div>
            </div>`;
        };

        const groupHtml = ordered.map(group => {
            const fails  = group.items.filter(i => i.status === 'FAIL');
            const warns  = group.items.filter(i => i.status === 'WARN');
            const passes = group.items.filter(i => i.status === 'PASS');
            if (!fails.length && !warns.length && !passes.length) return '';
            const critItems = [...fails, ...warns];
            return `<div class="report-cat">
                <h4 class="report-cat__title">${escapeHtml(group.category)}</h4>
                ${critItems.map(itemRow).join('')}
                ${passes.length ? `<div class="report-item report-item--pass">
                    <span class="report-item__icon">✓</span>
                    <div class="report-item__count"><strong>${passes.length}</strong> check${passes.length > 1 ? 's' : ''} passed</div>
                </div>` : ''}
            </div>`;
        }).join('');

        automatedBody = `<div class="report-cats">${groupHtml}</div>`;
    } else {
        automatedBody = `<div class="report-empty">No automated checks recorded for this session.</div>`;
    }
    const autoChips = [
        autoSum.pass > 0 ? `<span class="chip pass">${autoSum.pass} pass</span>` : '',
        autoSum.warn > 0 ? `<span class="chip warn">${autoSum.warn} warn</span>` : '',
        autoSum.fail > 0 ? `<span class="chip fail">${autoSum.fail} fail</span>` : ''
    ].filter(Boolean).join('');
    const automatedHtml = `
        <section class="report-section">
            <header class="report-section__head">
                <span class="report-section__icon">🤖</span>
                <h3 class="report-section__title">Automated</h3>
                <span class="report-section__sub">tool runs</span>
                <div class="report-section__counts">${autoChips}</div>
            </header>
            ${automatedBody}
        </section>`;

    // ── Manual section ───────────────────────────────────────────────────
    const man = qa.manual || { totals: { total: 0, passed: 0, failed: 0, pending: 0, progressPct: 0 }, sections: [] };
    let manualBody;
    if (man.totals.total > 0) {
        const t = man.totals;
        const fillClass = t.failed > 0 ? 'bad' : t.progressPct >= 90 ? 'good' : 'warn';
        const activeSections = man.sections.filter(s => s.totals.passed + s.totals.failed > 0);
        const failedItems = man.sections
            .flatMap(s => s.items.filter(it => it.status === 'fail').map(it => ({ ...it, section: s.title })));

        const sectionRowHtml = activeSections.map(s => {
            const pct = s.totals.progressPct;
            const fillCls = s.totals.failed > 0 ? 'fail' : pct === 100 ? '' : 'warn';
            return `<div class="report-section-row">
                <div class="report-section-row__head">
                    <span class="report-section-row__title">${s.icon} ${escapeHtml(s.title)}</span>
                    <span class="report-section-row__count">${s.totals.passed + s.totals.failed}/${s.totals.total}</span>
                </div>
                <div class="report-section-row__bar">
                    <div class="report-section-row__fill ${fillCls}" style="width: ${pct}%"></div>
                </div>
                <div class="report-section-row__legend">
                    ${s.totals.passed   ? `<span class="pass">✓ ${s.totals.passed}</span>` : ''}
                    ${s.totals.failed   ? `<span class="fail">✗ ${s.totals.failed}</span>` : ''}
                    ${s.totals.pending  ? `<span class="pending">○ ${s.totals.pending}</span>` : ''}
                </div>
            </div>`;
        }).join('');

        const failedHtml = failedItems.length ? `
            <div class="report-failed">
                <h4 class="report-failed__title">Failed items (${failedItems.length})</h4>
                ${failedItems.slice(0, 8).map(it => `<div class="report-item report-item--fail">
                    <span class="report-item__icon">✗</span>
                    <div class="report-item__body">
                        <div class="report-item__title">${escapeHtml(it.label)}</div>
                        <div class="report-item__sub">${escapeHtml(it.section)}${it.notes ? ` · ${escapeHtml(it.notes)}` : ''}</div>
                    </div>
                </div>`).join('')}
                ${failedItems.length > 8 ? `<div class="report-failed__overflow">+ ${failedItems.length - 8} more failed item(s)</div>` : ''}
            </div>` : '';

        manualBody = `<div class="report-manual">
            <div class="report-manual__totals">
                <span><span class="num">${t.passed + t.failed}</span> / ${t.total} checked · <span class="num">${t.progressPct}%</span></span>
                ${t.passed  ? `<span class="pass">✓ ${t.passed} passed</span>` : ''}
                ${t.failed  ? `<span class="fail">✗ ${t.failed} failed</span>` : ''}
                ${t.pending ? `<span class="pending">○ ${t.pending} pending</span>` : ''}
            </div>
            <div class="report-manual__progress">
                <div class="report-manual__progress-fill ${fillClass}" style="width: ${t.progressPct}%"></div>
            </div>
            ${activeSections.length ? `<div class="report-section-list">${sectionRowHtml}</div>` : ''}
            ${failedHtml}
        </div>`;
    } else {
        manualBody = `<div class="report-empty">No manual QA Checklist activity recorded for this session.</div>`;
    }
    const manualChips = man.totals.total > 0
        ? `<span class="chip">${man.totals.progressPct}%</span>`
        : '';
    const manualHtml = `
        <section class="report-section">
            <header class="report-section__head">
                <span class="report-section__icon">✋</span>
                <h3 class="report-section__title">Manual</h3>
                <span class="report-section__sub">tester runs</span>
                <div class="report-section__counts">${manualChips}</div>
            </header>
            ${manualBody}
        </section>`;

    // ── Build info ───────────────────────────────────────────────────────
    const buildRows = [];
    if (apk.versionName) buildRows.push(['Version', `${apk.versionName}${apk.versionCode ? ` (build ${apk.versionCode})` : ''}`]);
    if (apk.sdkInfo?.engine && apk.sdkInfo.engine !== 'Unknown') buildRows.push(['Engine', apk.sdkInfo.engine]);
    if (apk.targetSdk) buildRows.push(['Target SDK', `API ${apk.targetSdk}`]);
    if (apk.minSdk)    buildRows.push(['Min SDK', `API ${apk.minSdk}`]);
    const buildHtml = buildRows.length ? `
        <section>
            <h3 class="report-eyebrow">Build Info</h3>
            <dl class="report-block report-build">
                ${buildRows.map(([k, val]) => `<div class="report-build__row">
                    <dt>${escapeHtml(k)}</dt>
                    <dd>${escapeHtml(String(val))}</dd>
                </div>`).join('')}
            </dl>
        </section>` : '';

    // ── Recommendations ──────────────────────────────────────────────────
    const recs = (r.aiInsights?.recommendations || []).slice(0, 3);
    const recsHtml = recs.length ? `
        <section>
            <h3 class="report-eyebrow">Recommendations</h3>
            <div class="report-block report-recs">
                ${recs.map(rec => `<div class="report-recs__row">${escapeHtml(rec)}</div>`).join('')}
            </div>
        </section>` : '';

    historyDetail.innerHTML = `
        <article class="report">
            ${verdictHtml}
            ${summaryHtml}
            ${metricsHtml}
            ${automatedHtml}
            ${manualHtml}
            ${buildHtml}
            ${recsHtml}
            ${apk.packageName ? `<div class="report-footer">${escapeHtml(apk.packageName)}</div>` : ''}
        </article>`;
}

// ─── LIVE FPS CHART ───────────────────────────────────────────────────────────
let liveFpsChart = null;
let _fpsPointColors = [];
const FPS_WINDOW = 60;
const REF_LINE = Array(FPS_WINDOW).fill(null);

function initLiveChart() {
    if (liveFpsChart) liveFpsChart.destroy();
    _fpsPointColors = [];

    // Gradient fill — built on first draw via plugin so chartArea is defined
    const gradientPlugin = {
        id: 'lmGradient',
        beforeDatasetDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const ds = chart.data.datasets[0];
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.28)');
            gradient.addColorStop(0.6, 'rgba(59, 130, 246, 0.08)');
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
            ds.backgroundColor = gradient;
        }
    };

    liveFpsChart = new Chart(liveFpsCtx, {
        type: 'line',
        plugins: [gradientPlugin],
        data: {
            labels: Array.from({ length: FPS_WINDOW }, (_, i) => i),
            datasets: [
                {
                    label: 'FPS',
                    data: Array(FPS_WINDOW).fill(null),
                    borderColor: '#3B82F6',
                    backgroundColor: 'transparent', // filled by plugin above
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#3B82F6',
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300, easing: 'linear' },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(100,116,139,0.7)',
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        maxRotation: 0,
                        autoSkip: false,
                        callback: (_, i) => i % 5 === 0 ? i : ''
                    }
                },
                y: {
                    display: true,
                    position: 'left',
                    min: 0,
                    suggestedMax: 65,
                    grid: {
                        color: 'rgba(255,255,255,0.05)',
                        drawBorder: false
                    },
                    border: { display: false, dash: [2, 4] },
                    ticks: {
                        color: 'rgba(100,116,139,0.8)',
                        font: { size: 10, family: "'JetBrains Mono', monospace" },
                        stepSize: 5,
                        padding: 8,
                        callback: v => v % 5 === 0 && v > 0 ? v : ''
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.9)',
                    borderColor: 'rgba(59,130,246,0.3)',
                    borderWidth: 1,
                    titleColor: '#94A3B8',
                    bodyColor: '#F1F5F9',
                    titleFont: { size: 10 },
                    bodyFont: { size: 12, weight: '700', family: "'JetBrains Mono', monospace" },
                    padding: 8,
                    displayColors: false,
                    callbacks: {
                        title: items => `t = ${items[0].label}s`,
                        label: item => `${item.raw} FPS`
                    }
                }
            }
        }
    });
    _fpsPointColors = Array(FPS_WINDOW).fill('#3B82F6');
}

if (window.api.onLiveData) {
    window.api.onLiveData((data) => {
        // Handle initial device info broadcast
        if (data.type === 'device-info') {
            if (statusDeviceName) statusDeviceName.textContent = data.deviceName;
            if (statusAndroidVer) statusAndroidVer.textContent = data.androidVersion;
            if (statusBattery) statusBattery.textContent = `${data.battery}%`;
            return;
        }

        if (!liveDashboard.classList.contains('hidden')) {
            // FPS gauge — color coding, quality label, progress bar, min/avg/max
            const fpsNum = parseInt(data.fps);
            if (liveFps) liveFps.textContent = isNaN(fpsNum) ? '--' : fpsNum;

            // FPS source badge — when FPS comes from SurfaceFlinger (compositor),
            // it's device-refresh, not true game render FPS. Warn the tester.
            const fpsFromCompositor = data.fpsSource === 'surfaceflinger';
            const fpsSrcBadge = document.getElementById('live-fps-src');
            if (fpsSrcBadge) fpsSrcBadge.classList.toggle('hidden', !fpsFromCompositor);

            if (!isNaN(fpsNum)) {
                // Color the big FPS number: smooth ≥55, playable ≥30, choppy <30.
                // When the value is compositor-sourced (not game-accurate), grey it
                // so testers don't read it as a real performance signal.
                const fpsColor = fpsFromCompositor ? '#9CA3AF'
                               : fpsNum >= 55 ? '#22C55E' : fpsNum >= 30 ? '#F59E0B' : '#EF4444';
                if (liveFps) liveFps.style.color = fpsColor;

                // Track min/avg/max for report (hidden elements still updated)
                if (!window._fpsTracker) window._fpsTracker = { min: fpsNum, max: fpsNum, sum: fpsNum, count: 1 };
                else {
                    const t = window._fpsTracker;
                    t.min = Math.min(t.min, fpsNum);
                    t.max = Math.max(t.max, fpsNum);
                    t.sum += fpsNum;
                    t.count++;
                    const avg = Math.round(t.sum / t.count);
                    const minEl = document.getElementById('fps-min');
                    const avgEl = document.getElementById('fps-avg');
                    const peakEl = document.getElementById('fps-peak');
                    if (minEl) minEl.textContent = t.min;
                    if (avgEl) avgEl.textContent = avg;
                    if (peakEl) peakEl.textContent = t.max;
                }
            }

            // Network stat — show actual status from telemetry
            const netType = data.network === 'ONLINE' ? 'Online'
                          : data.network === 'OFFLINE' ? 'Offline'
                          : (data.network || '--');
            if (liveNetwork) {
                liveNetwork.textContent = netType;
                liveNetwork.style.color = data.network === 'OFFLINE' ? '#EF4444' : '';
            }
            if (liveDevice) liveDevice.textContent = data.device;

            if (data.battery && data.battery !== 'Unknown') {
                if (statusBattery) statusBattery.textContent = `${data.battery}%`;
                const battLive = document.getElementById('status-battery-live');
                if (battLive) {
                    battLive.textContent = `${data.battery}%`;
                    const pct = parseInt(data.battery);
                    battLive.style.color = pct > 50 ? '#4ade80' : pct > 20 ? '#fbbf24' : '#f87171';
                }
            }

            if (data.advanced) {
                if (livePing) livePing.textContent = `${data.advanced.ping} ms`;
                // Save to Global State for cross-tab persistence
                if (data.advanced.runtime) {
                    currentSession.runtime = {
                        ...data.advanced.runtime
                    };

                    // Update UI immediately if tab is active
                    if (document.getElementById('tab-runtime').classList.contains('active')) {
                        renderRuntimeTab(currentSession.runtime);
                    }
                    if (document.getElementById('tab-events').classList.contains('active')) {
                        renderEventsTab(currentSession.runtime);
                    }
                }

                // Tick signal-based milestones
                tickMilestones(secondsElapsed, {
                    hasSdkData: !!(data.advanced.runtime?.sdkIntelligence),
                    hasNetwork: data.network && data.network !== '--' && data.network !== 'Offline'
                });
            }

            // FPS chart — slide data left→right (new on left, oldest drops off right)
            if (liveFpsChart && !isNaN(fpsNum)) {
                const ds = liveFpsChart.data.datasets[0];
                ds.data.unshift(fpsNum);
                if (ds.data.length > FPS_WINDOW) ds.data.pop();
                // Dynamic Y-max: give 10% headroom above peak
                const peak = Math.max(...ds.data.filter(v => v !== null));
                if (!isNaN(peak) && peak > 0) {
                    liveFpsChart.options.scales.y.suggestedMax = Math.ceil(peak * 1.12 / 5) * 5;
                }
                liveFpsChart.update('none'); // skip animation for smooth streaming
            }

            // Stats bar — Memory
            const memEl = document.getElementById('live-memory');
            if (memEl && data.memory) memEl.textContent = data.memory;

            // Stats bar — Frame Time, CPU from advanced
            if (data.advanced) {
                const ftEl = document.getElementById('live-frame-time');
                const cpuEl = document.getElementById('live-cpu');
                if (ftEl && data.advanced.frameTime != null) {
                    ftEl.textContent = Number(data.advanced.frameTime).toFixed(1);
                }
                if (cpuEl && data.advanced.cpuUsage != null) {
                    cpuEl.textContent = `${Math.round(data.advanced.cpuUsage)}%`;
                }
            }

            if (data.issues && data.issues.length > 0) {
                liveIssuesPanel.classList.remove('hidden');
                let html = '';
                data.issues.forEach(iss => {
                    const color = iss.severity === 'HIGH' ? '#fca5a5' : '#fde047';
                    const bg = iss.severity === 'HIGH' ? 'rgba(239,68,68,0.1)' : 'rgba(250,204,21,0.1)';
                    html += `<div style="padding: 8px 12px; margin-bottom: 8px; border-left: 3px solid ${color}; background: ${bg}; border-radius: 0 4px 4px 0;">
                        <strong style="color: ${color};">${iss.type}:</strong> <span style="color: #d4d4d8;">${iss.message}</span>
                    </div>`;
                });
                liveIssuesList.innerHTML = html;
            } else {
                liveIssuesPanel.classList.add('hidden');
            }

            // Device Prediction owns its own DOM via devicePrediction.js (started/stopped
            // by switchTab). It polls getPredictions() every 3 s while mounted — no need
            // to mirror live data into the prediction table from here.
        }
    });
}

/**
 * Renders the Runtime Intelligence tab from persistent state.
 */
function renderRuntimeTab(runtime) {
    if (!runtime) {
        runtimeContent.classList.add('hidden');
        runtimeEmptyState.classList.remove('hidden');
        return;
    }

    runtimeContent.classList.remove('hidden');
    runtimeEmptyState.classList.add('hidden');

    runtimeEngine.textContent = runtime.engine || 'Native';
    runtimeNetwork.textContent = runtime.networkCalls || 0;



    const sdkIntel = runtime.sdkIntelligence || null;
    const sdkList = sdkIntel?.sdks ? Object.values(sdkIntel.sdks) : [];
    const sdkByCategory = (category) => sdkList.filter(sdk => sdk.category === category && sdk.detected);
    const detectedSDKs = sdkList.filter(s => s.detected);
    const activeSDKs = detectedSDKs.filter(s => s.status === 'Active');

    // Category badge styling
    const CATEGORY_STYLE = {
        ADS:         { bg: 'rgba(45,212,191,0.15)',   color: '#2dd4bf', border: 'rgba(45,212,191,0.3)' },
        ANALYTICS:   { bg: 'rgba(56,189,248,0.15)',   color: '#38bdf8', border: 'rgba(56,189,248,0.3)' },
        ATTRIBUTION: { bg: 'rgba(167,139,250,0.15)',  color: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
        BACKEND:     { bg: 'rgba(251,146,60,0.15)',   color: '#fb923c', border: 'rgba(251,146,60,0.3)' },
        IAP:         { bg: 'rgba(74,222,128,0.15)',   color: '#4ade80', border: 'rgba(74,222,128,0.3)' },
        MONITORING:  { bg: 'rgba(244,114,182,0.15)',  color: '#f472b6', border: 'rgba(244,114,182,0.3)' },
        SECURITY:    { bg: 'rgba(248,113,113,0.15)',  color: '#f87171', border: 'rgba(248,113,113,0.3)' }
    };

    // Stats strip
    const statDetected = document.getElementById('sdk-stat-detected');
    const statActive   = document.getElementById('sdk-stat-active');
    const statKeys     = document.getElementById('sdk-stat-keys');
    const statDanger   = document.getElementById('sdk-stat-danger');
    if (statDetected) statDetected.textContent = sdkIntel ? detectedSDKs.length : '—';
    if (statActive)   statActive.textContent   = sdkIntel ? activeSDKs.length  : '—';
    if (statKeys)     statKeys.textContent     = sdkIntel ? (sdkIntel.keyStats?.keysFound ?? 0) : '—';
    if (statDanger)   statDanger.textContent   = sdkIntel ? (sdkIntel.keyStats?.dangerKeys ?? 0) : '—';

    // SDK two-column split: Found in APK | Active During Gameplay
    const sdkApkList      = document.getElementById('sdk-apk-list');
    const sdkGameplayList = document.getElementById('sdk-gameplay-list');

    if (sdkApkList) {
        if (!sdkIntel || detectedSDKs.length === 0) {
            sdkApkList.innerHTML = '<div style="font-size:13px;color:#71717a;padding:14px;text-align:center;">No SDKs detected — run static analysis first</div>';
        } else {
            const apkRows = [];
            for (const category of ['ADS', 'ANALYTICS', 'ATTRIBUTION', 'BACKEND', 'IAP', 'MONITORING']) {
                const sdks = sdkByCategory(category);
                if (!sdks.length) continue;
                const c = CATEGORY_STYLE[category] || CATEGORY_STYLE.ADS;
                for (const sdk of sdks) {
                    const sdkKeys = (sdkIntel.keys || []).filter(k => k.sdk === sdk.name);
                    const keyBadges = sdkKeys.map(k =>
                        `<span style="font-size:11px;font-weight:600;background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3);padding:2px 6px;border-radius:3px;white-space:nowrap;">${escapeHtml(k.keyType)}</span>`
                    ).join('');
                    const sources = [...new Set((sdk.sources || [])
                        .filter(s => s !== 'runtime')
                        .map(s => s === 'dex' ? 'DEX' : s === 'manifest' ? 'Manifest' : 'APK')
                    )].join(' · ');
                    apkRows.push(`
                        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:7px;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;background:${c.bg};color:${c.color};border:1px solid ${c.border};padding:3px 6px;border-radius:4px;min-width:68px;text-align:center;letter-spacing:0.04em;flex-shrink:0;margin-top:2px;">${escapeHtml(category)}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:13px;font-weight:600;color:#e4e4e7;">${escapeHtml(sdk.name)}</div>
                                <div style="font-size:11px;color:#a1a1aa;margin-top:3px;">${escapeHtml(sources)}</div>
                                ${keyBadges ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${keyBadges}</div>` : ''}
                            </div>
                        </div>`);
                }
            }
            sdkApkList.innerHTML = apkRows.join('');
        }
    }

    if (sdkGameplayList) {
        const activeSDKsList = detectedSDKs.filter(s => s.status === 'Active');
        if (!sdkIntel || !runtime.hasRuntimeData) {
            sdkGameplayList.innerHTML = '<div style="font-size:13px;color:#71717a;padding:14px;text-align:center;">Run a test session to see runtime activity…</div>';
        } else if (activeSDKsList.length === 0) {
            sdkGameplayList.innerHTML = '<div style="font-size:13px;color:#71717a;padding:14px;text-align:center;">No SDK activity detected during gameplay</div>';
        } else {
            const gameplayRows = activeSDKsList.map(sdk => {
                const c  = CATEGORY_STYLE[sdk.category] || CATEGORY_STYLE.ADS;
                const rt = sdk.runtime || {};
                const meta = [
                    rt.count > 0 ? `${rt.count} events` : null,
                    rt.firstEventTime != null ? `First: ${rt.firstEventTime}s` : null,
                    rt.adTypes?.length ? rt.adTypes.join('/') : null
                ].filter(Boolean).join(' · ');
                return `
                    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:rgba(45,212,191,0.04);border:1px solid rgba(45,212,191,0.15);border-radius:7px;">
                        <div style="font-size:11px;font-weight:700;text-transform:uppercase;background:${c.bg};color:${c.color};border:1px solid ${c.border};padding:3px 6px;border-radius:4px;min-width:68px;text-align:center;letter-spacing:0.04em;flex-shrink:0;margin-top:2px;">${escapeHtml(sdk.category)}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:#e4e4e7;">${escapeHtml(sdk.name)}</div>
                            ${meta ? `<div style="font-size:11px;color:#a1a1aa;margin-top:3px;">${escapeHtml(meta)}</div>` : ''}
                        </div>
                        <div style="font-size:11px;font-weight:700;color:#2dd4bf;background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.2);padding:3px 9px;border-radius:10px;flex-shrink:0;margin-top:2px;">ACTIVE</div>
                    </div>`;
            });
            sdkGameplayList.innerHTML = gameplayRows.join('');
        }
    }

    // Extracted Keys list
    const sdkExtractedSection = document.getElementById('sdk-extracted-keys-section');
    if (sdkExtractedSection) {
        if (!sdkIntel) {
            sdkExtractedSection.innerHTML = '<span style="font-size:11px;color:#52525b;">Waiting for APK analysis…</span>';
        } else if (sdkIntel.keys && sdkIntel.keys.length > 0) {
            const stats = sdkIntel.keyStats || {};
            // Group keys by category for visual sections
            const keysByCategory = {};
            for (const key of sdkIntel.keys) {
                const cat = key.category || (SDK_KEY_REFERENCE.find(r => r.sdk === key.sdk)?.category) || 'OTHER';
                if (!keysByCategory[cat]) keysByCategory[cat] = [];
                keysByCategory[cat].push(key);
            }
            const catOrder = ['SECURITY', 'ADS', 'ANALYTICS', 'ATTRIBUTION', 'BACKEND', 'IAP', 'MONITORING', 'OTHER'];
            const sections = [];
            for (const cat of catOrder) {
                const keys = keysByCategory[cat];
                if (!keys?.length) continue;
                const c = CATEGORY_STYLE[cat] || { bg: 'rgba(113,113,122,0.15)', color: '#a1a1aa', border: 'rgba(113,113,122,0.3)' };
                sections.push(`<div data-sdk-row="1" data-sdk-text="" data-sdk-cat="${escapeHtml(cat)}" style="font-size:11px;font-weight:700;text-transform:uppercase;color:${c.color};letter-spacing:0.08em;padding:6px 2px;border-bottom:1px solid ${c.border};margin-top:8px;">${escapeHtml(cat)}</div>`);
                for (const key of keys) {
                    const statusColor = key.status === 'Valid'                  ? '#2dd4bf'
                                      : key.status === 'Server Key Exposed'     ? '#f87171'
                                      : key.status === 'Test Key in Production' ? '#f97316'
                                      : '#fbbf24';
                    const statusBg    = key.status === 'Valid'                  ? 'rgba(45,212,191,0.12)'
                                      : key.status === 'Server Key Exposed'     ? 'rgba(248,113,113,0.12)'
                                      : key.status === 'Test Key in Production' ? 'rgba(249,115,22,0.12)'
                                      : 'rgba(251,191,36,0.12)';
                    const valueMask   = key.value.length > 56 ? key.value.substring(0, 56) + '…' : key.value;
                    const keyType     = key.keyType || key.keyName || '';
                    const searchText  = `${key.sdk} ${key.keyName} ${key.value} ${cat} ${keyType}`.toLowerCase();
                    const src         = key.source || '';
                    const sourceLabel = src === 'manifest' ? 'Manifest'
                                      : src === 'dex' ? 'DEX'
                                      : src === 'resources.arsc' ? 'resources.arsc'
                                      : src === 'native-lib' ? 'Native (.so)'
                                      : src === 'logcat' ? 'Logcat (Runtime)'
                                      : src === 'memory' ? 'Memory Scan'
                                      : src.includes('google-services') ? 'google-services.json'
                                      : src.includes('assets/') ? src.split('assets/')[1] || 'Assets'
                                      : src ? src.split('/').pop() || 'APK' : 'APK';
                    sections.push(`
                    <div data-sdk-row="1" data-sdk-text="${escapeHtml(searchText)}" data-sdk-cat="${escapeHtml(cat)}"
                         style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:7px;">
                        <div style="flex:1;min-width:0;">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span style="font-size:13px;font-weight:600;color:#e4e4e7;">${escapeHtml(key.sdk)}</span>
                                <span style="font-size:11px;font-weight:700;text-transform:uppercase;background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3);padding:2px 7px;border-radius:4px;letter-spacing:0.05em;">${escapeHtml(keyType)}</span>
                            </div>
                            <div style="font-size:12px;color:#c4b5fd;font-family:monospace;margin-top:6px;word-break:break-all;letter-spacing:0.01em;">${escapeHtml(valueMask)}</div>
                            <div style="font-size:11px;color:#71717a;margin-top:4px;">Found in: <span style="color:#a1a1aa;">${escapeHtml(sourceLabel)}</span></div>
                        </div>
                        <div style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;background:${statusBg};color:${statusColor};flex-shrink:0;white-space:nowrap;margin-top:2px;">${escapeHtml(key.status)}</div>
                    </div>`);
                }
            }
            const keyRows = sections.join('');
            sdkExtractedSection.innerHTML = keyRows + `
                <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);">
                    <span style="font-size:12px;color:#a1a1aa;">Patterns checked: <strong style="color:#d4d4d8;">${stats.keyPatternsChecked || 0}+</strong></span>
                    <span style="font-size:12px;color:#a1a1aa;">Danger keys: <strong style="color:${(stats.dangerKeys || 0) > 0 ? '#f87171' : '#4ade80'};">${stats.dangerKeys || 0}</strong></span>
                </div>`;
        } else {
            const stats = sdkIntel.keyStats || {};
            sdkExtractedSection.innerHTML = `
                <div style="padding:16px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:8px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:20px;">🔍</span>
                        <div style="font-size:13px;color:#a1a1aa;">No keys found in strings.xml or text files.</div>
                    </div>
                    <div style="font-size:12px;color:#71717a;">This APK stores keys in native code or fetches them remotely.</div>
                    <div style="font-size:12px;color:#71717a;margin-top:5px;">Use jadx/apktool for deeper static analysis.</div>
                </div>
                <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px;">
                    <span style="font-size:12px;color:#a1a1aa;">Patterns checked: <strong style="color:#d4d4d8;">${stats.keyPatternsChecked || 0}+</strong></span>
                    <span style="font-size:12px;color:#a1a1aa;">Danger keys: <strong style="color:#4ade80;">0</strong></span>
                </div>`;
        }
    }

    // QA Checklist Validation
    if (runtime.checklist) {
        const updateQA = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val ? '✅' : '❌';
        };
        updateQA('qa-game-start', runtime.checklist.game_start);
        updateQA('qa-splash-screen', runtime.checklist.splash_screen);
        updateQA('qa-build-64bit', runtime.checklist.build_64bit);
        updateQA('qa-build-release', runtime.checklist.build_release);
        updateQA('qa-firebase-init', runtime.checklist.firebase_init);
        updateQA('qa-ads-sdk', runtime.checklist.ads_sdk);
        updateQA('qa-appsflyer', runtime.checklist.appsflyer);
        updateQA('qa-safe-permissions', runtime.checklist.safe_permissions);
        updateQA('qa-no-crashes', runtime.checklist.no_crashes);
        updateQA('qa-no-anrs', runtime.checklist.no_anrs);
        updateQA('qa-network-active', runtime.checklist.network_active);
        updateQA('qa-crashlytics-init', runtime.checklist.crashlytics_init);
        updateQA('qa-target-sdk-compliant', runtime.checklist.target_sdk_compliant);

        const tsdEl = document.getElementById('qa-target-sdk-detail');
        if (tsdEl) {
            tsdEl.textContent = runtime.targetSdk ? `(target=${runtime.targetSdk})` : '';
        }
    }

    // Event Timeline (Live)
    {
        const tlDuration = document.getElementById('tl-stat-duration');
        const tlTotal    = document.getElementById('tl-stat-total');
        const tlAds      = document.getElementById('tl-stat-ads');
        const tlFirebase = document.getElementById('tl-stat-firebase');
        const liveBadge  = document.getElementById('timeline-live-badge');

        const allEvents = runtime.events || [];
        const adsCount  = allEvents.filter(e => e.category === 'ADS'      || (!e.category && e.name?.includes('ad_'))).length;
        const fbCount   = allEvents.filter(e => e.category === 'FIREBASE' || (!e.category && e.name?.includes('firebase'))).length;

        if (tlTotal)    tlTotal.textContent    = allEvents.length;
        if (tlAds)      tlAds.textContent      = adsCount;
        if (tlFirebase) tlFirebase.textContent = fbCount;
        if (liveBadge)  liveBadge.style.display = sessionState === 'running' ? '' : 'none';

        if (tlDuration) {
            const m = Math.floor(secondsElapsed / 60);
            const s = secondsElapsed % 60;
            tlDuration.textContent = m > 0 ? `${m}m ${s}s` : `${secondsElapsed}s`;
        }

        // Apply time filter
        const latestTime = allEvents.length ? allEvents[allEvents.length - 1].time : 0;
        let visibleEvents = allEvents;
        if (_timelineFilter === '1min')  visibleEvents = allEvents.filter(e => e.time >= latestTime - 60);
        else if (_timelineFilter === '5min') visibleEvents = allEvents.filter(e => e.time >= latestTime - 300);

        const timelineContainer = document.getElementById('runtime-event-timeline');
        if (timelineContainer) {
            if (!visibleEvents.length) {
                timelineContainer.innerHTML = '<span style="color:#3f3f46;font-size:11px;font-family:\'JetBrains Mono\',monospace;">Waiting for runtime activity...</span>';
            } else {
                const CAT_COLOR = { GA: '#a78bfa', FIREBASE: '#38bdf8', FACEBOOK: '#818cf8', IAP: '#34d399', APPSFLYER: '#fb923c', ADJUST: '#f59e0b', ADS: '#2dd4bf', LIFECYCLE: '#71717a', SYSTEM: '#52525b' };
                const CAT_BG    = { GA: 'rgba(167,139,250,0.1)', FIREBASE: 'rgba(56,189,248,0.1)', FACEBOOK: 'rgba(129,140,248,0.1)', IAP: 'rgba(52,211,153,0.1)', APPSFLYER: 'rgba(251,146,60,0.1)', ADJUST: 'rgba(245,158,11,0.1)', ADS: 'rgba(45,212,191,0.1)', LIFECYCLE: 'rgba(113,113,122,0.1)', SYSTEM: 'rgba(82,82,91,0.1)' };
                timelineContainer.innerHTML = visibleEvents.map(ev => {
                    const cat   = ev.category || (ev.name?.includes('ad_') ? 'ADS' : ev.name?.includes('firebase') ? 'FIREBASE' : 'SYSTEM');
                    const color = CAT_COLOR[cat] || '#a1a1aa';
                    const bg    = CAT_BG[cat]    || 'rgba(255,255,255,0.04)';
                    const label = ev.detail
                        ? `${String(ev.name || '').replace(/_/g, ' ')} · ${escapeHtml(String(ev.detail))}`
                        : String(ev.name || 'event').replace(/_/g, ' ');
                    return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
                        <span style="font-size:11px;color:#71717a;min-width:40px;font-family:'JetBrains Mono',monospace;flex-shrink:0;">${ev.time}s</span>
                        <span style="font-size:11px;font-weight:700;text-transform:uppercase;background:${bg};color:${color};padding:2px 7px;border-radius:3px;letter-spacing:0.05em;flex-shrink:0;">${cat}</span>
                        <span style="font-size:12px;color:#d4d4d8;font-family:'JetBrains Mono',monospace;">${escapeHtml(label)}</span>
                    </div>`;
                }).join('');
                timelineContainer.scrollTop = timelineContainer.scrollHeight;
            }
        }
    }

    // Audit Stats




    // Permissions
    if (runtime.grantedPermissions && runtime.grantedPermissions.length > 0) {
        runtimePermissions.innerHTML = runtime.grantedPermissions.map(p => {
            const short = p.split('.').pop();
            return `<span style="font-size: 10px; color: #2dd4bf; background: rgba(45, 212, 191, 0.1); padding: 2px 6px; border-radius: 3px; border: 1px solid rgba(45, 212, 191, 0.2);">${short}</span>`;
        }).join('');
    } else {
        runtimePermissions.innerHTML = '<span style="color: #71717a; font-size: 13px;">No runtime permissions granted.</span>';
    }
}

// ─── EVENTS TAB ──────────────────────────────────────────────────────────────

const EV_COLOR = {
    GA:        '#a78bfa',
    FIREBASE:  '#38bdf8',
    FACEBOOK:  '#818cf8',
    IAP:       '#34d399',
    APPSFLYER: '#fb923c',
    ADJUST:    '#f59e0b',
    ADS:       '#2dd4bf',
    LIFECYCLE: '#71717a',
    SYSTEM:    '#52525b',
    CUSTOM:    '#c084fc'
};
const EV_BG = {
    GA:        'rgba(167,139,250,0.12)',
    FIREBASE:  'rgba(56,189,248,0.12)',
    FACEBOOK:  'rgba(129,140,248,0.12)',
    IAP:       'rgba(52,211,153,0.12)',
    APPSFLYER: 'rgba(251,146,60,0.12)',
    ADJUST:    'rgba(245,158,11,0.12)',
    ADS:       'rgba(45,212,191,0.12)',
    LIFECYCLE: 'rgba(113,113,122,0.12)',
    SYSTEM:    'rgba(82,82,91,0.12)',
    CUSTOM:    'rgba(192,132,252,0.12)'
};

function setEventFilter(cat) {
    _eventsFilter = cat;
    document.querySelectorAll('.ev-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cat === cat);
    });
    renderEventsTab(currentSession.runtime);
}

function renderEventsTab(runtime) {
    const emptyState  = document.getElementById('events-empty-state');
    const content     = document.getElementById('events-content');
    const liveBadge   = document.getElementById('events-live-badge');
    const feed        = document.getElementById('events-feed');
    const statTotal   = document.getElementById('ev-stat-total');
    const statGA      = document.getElementById('ev-stat-ga');
    const statFB      = document.getElementById('ev-stat-firebase');
    const statIAP     = document.getElementById('ev-stat-iap');
    const statAttr    = document.getElementById('ev-stat-attr');
    const statAI      = document.getElementById('ev-stat-ai');

    const hasData = runtime && runtime.hasRuntimeData;
    if (!runtime) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (content)    content.classList.add('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');
    if (content)    content.classList.remove('hidden');

    if (liveBadge) liveBadge.style.display = sessionState === 'running' ? '' : 'none';

    const allEvents = runtime.events || [];

    // Stats
    const gaCount   = allEvents.filter(e => e.category === 'GA').length;
    const fbCount   = allEvents.filter(e => e.category === 'FIREBASE').length;
    const iapCount  = allEvents.filter(e => e.category === 'IAP').length;
    const attrCount = allEvents.filter(e => e.category === 'APPSFLYER' || e.category === 'ADJUST' || e.category === 'FACEBOOK').length;
    const aiCount   = allEvents.filter(e => e.confidence === 'AI').length;
    if (statTotal)  statTotal.textContent  = allEvents.length;
    if (statGA)     statGA.textContent     = gaCount;
    if (statFB)     statFB.textContent     = fbCount;
    if (statIAP)    statIAP.textContent    = iapCount;
    if (statAttr)   statAttr.textContent   = attrCount;
    if (statAI)     statAI.textContent     = aiCount;

    if (!feed) return;

    // Filter — NETWORK = source:network, others = category match
    const visible = _eventsFilter === 'ALL'
        ? allEvents
        : _eventsFilter === 'NETWORK'
            ? allEvents.filter(e => e.source === 'network' || e.confidence === 'NETWORK')
            : allEvents.filter(e => e.category === _eventsFilter);

    if (!visible.length) {
        feed.innerHTML = `<div style="padding: 32px; text-align: center; font-size: 12px; color: #52525b; font-family: 'JetBrains Mono', monospace;">${hasData ? 'No events in this category yet.' : 'Waiting for runtime events…'}</div>`;
        return;
    }

    feed.innerHTML = visible.map((ev) => {
        const cat      = ev.category || 'SYSTEM';
        const color    = EV_COLOR[cat] || '#a1a1aa';
        const bg       = EV_BG[cat]   || 'rgba(255,255,255,0.04)';
        const isAI     = ev.confidence === 'AI';
        const isNet    = ev.source === 'network' || ev.confidence === 'NETWORK';
        const evName   = String(ev.name || 'event').replace(/_/g, ' ');
        const aiBadge  = isAI  ? `<span class="ev-ai-badge">🤖 AI</span>`  : '';
        const netBadge = isNet ? `<span class="ev-net-badge">🌐 NET</span>` : '';
        const rowClass = isNet ? 'ev-row ev-row-net' : isAI ? 'ev-row ev-row-ai' : 'ev-row';
        const rawText  = ev.raw
            ? escapeHtml(ev.raw)
            : isAI  ? escapeHtml(`AI classified: ${ev.detail || ''}`)
            : isNet ? escapeHtml(`Network → ${ev.detail || ''}`)
            : escapeHtml(ev.detail || '');
        return `<div class="${rowClass}">
            <span class="ev-time-col">${ev.time}s</span>
            <span class="ev-cat-col" style="background:${bg};color:${color};">${escapeHtml(cat)}</span>
            <span class="ev-name-col">${escapeHtml(evName)}${aiBadge}${netBadge}</span>
            <span class="ev-detail-col">${escapeHtml(String(ev.detail || ''))}</span>
            <span class="ev-log-col">${rawText}</span>
        </div>`;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
}



// ─── FACEBOOK APP EVENTS PANEL ───────────────────────────────────────────────
// Polls the agent's fbEventTracker via window.api.getFbEvents() every 2s
// while a session is running and renders into the dedicated FB panel inside
// the Runtime Events tab. Independent of the generic event feed below it —
// shows richer detail (recorded vs flushed, validation warnings, raw params)
// that the generic feed doesn't carry.

let _fbPollTimer = null;
let _fbFilter = 'visible';     // 'visible' = hide auto, 'all', 'warnings'
let _fbLastSnapshot = null;

function startFbEventsPolling() {
    stopFbEventsPolling();
    pollFbEventsOnce();
    _fbPollTimer = setInterval(pollFbEventsOnce, 2000);
}

function stopFbEventsPolling() {
    if (_fbPollTimer) clearInterval(_fbPollTimer);
    _fbPollTimer = null;
}

async function pollFbEventsOnce() {
    if (!window.api || typeof window.api.getFbEvents !== 'function') return;
    try {
        const snap = await window.api.getFbEvents();
        if (snap) {
            _fbLastSnapshot = snap;
            renderFbEvents(snap);
        }
    } catch (e) { /* silent — never noisy on transient IPC */ }
}

function setFbFilter(f) {
    _fbFilter = f;
    document.querySelectorAll('.fb-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fbFilter === f);
    });
    if (_fbLastSnapshot) renderFbEvents(_fbLastSnapshot);
}

function copyFbEventsJson() {
    if (!_fbLastSnapshot) return;
    try {
        const json = JSON.stringify(_fbLastSnapshot, null, 2);
        navigator.clipboard.writeText(json);
        const btn = document.getElementById('fb-copy-btn');
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        }
    } catch (_) {}
}

function fbFormatTime(logcatTime, logcatTimeMs, sessionStartMs) {
    // Prefer logcat-native time so it matches what testers see in Android Studio
    if (logcatTime) return logcatTime;
    if (logcatTimeMs && sessionStartMs) {
        const sec = Math.max(0, Math.floor((logcatTimeMs - sessionStartMs) / 1000));
        return `+${sec}s`;
    }
    return '—';
}

function fbParamsPreview(params) {
    // Compact one-line preview: key=value, key=value...
    if (!params) return '';
    const entries = Object.entries(params).filter(([k]) => k !== '_eventName');
    if (entries.length === 0) return '<em class="fb-empty">no params</em>';
    return entries.slice(0, 5).map(([k, v]) => {
        const vs = typeof v === 'object' ? JSON.stringify(v) : String(v);
        const vTrim = vs.length > 30 ? vs.slice(0, 30) + '…' : vs;
        return `<span class="fb-kv"><span class="fb-k">${escapeHtml(k)}</span>=<span class="fb-v">${escapeHtml(vTrim)}</span></span>`;
    }).join(' ') + (entries.length > 5 ? `<span class="fb-more">+${entries.length - 5}</span>` : '');
}

function renderFbEvents(snap) {
    const card = document.getElementById('fb-events-card');
    if (!card) return;

    const status = snap.status || {};
    const counts = snap.counts || {};
    const events = snap.events || [];

    // ── Top badges ──────────────────────────────────────────────
    const setText = (id, t) => {
        const el = document.getElementById(id);
        if (el) el.textContent = t;
    };
    setText('fb-stat-total',    counts.total    || 0);
    setText('fb-stat-standard', counts.standard || 0);
    setText('fb-stat-custom',   counts.custom   || 0);
    setText('fb-stat-auto',     counts.auto     || 0);
    setText('fb-stat-flushed',  counts.flushed  || 0);
    setText('fb-stat-warnings', counts.warnings || 0);

    // ── Status row ──────────────────────────────────────────────
    setText('fb-sdk-version',     status.sdkVersion || '—');
    setText('fb-format-detected', status.formatDetected === 'unknown' ? '—' : (status.formatDetected || '—'));
    setText('fb-package-name',    status.packageName || '—');

    const debugEl = document.getElementById('fb-debug-status');
    const banner  = document.getElementById('fb-events-banner');
    const bannerTxt = document.getElementById('fb-banner-text');
    if (debugEl) {
        if (status.debugLoggingOn === true) {
            debugEl.textContent = 'ON';
            debugEl.className = 'fb-status-value fb-status-good';
        } else if (status.debugLoggingOn === false) {
            debugEl.textContent = 'OFF';
            debugEl.className = 'fb-status-value fb-status-bad';
        } else {
            debugEl.textContent = 'checking…';
            debugEl.className = 'fb-status-value';
        }
    }
    if (banner && bannerTxt) {
        const bannerIcon = banner.querySelector('.fb-banner-icon');
        // Two distinct conditions can produce a banner. Inactive ranks higher
        // because the "enable debug logging" message would be wrong advice
        // when the SDK isn't firing events at all.
        if (status.sdkInactive === true && status.debugLoggingMessage) {
            banner.classList.remove('hidden');
            banner.classList.add('fb-events-banner--info');
            if (bannerIcon) bannerIcon.textContent = 'ℹ';
            bannerTxt.textContent = status.debugLoggingMessage;
        } else if (status.debugLoggingOn === false && status.debugLoggingMessage) {
            banner.classList.remove('hidden');
            banner.classList.remove('fb-events-banner--info');
            if (bannerIcon) bannerIcon.textContent = '⚠';
            bannerTxt.textContent = status.debugLoggingMessage;
        } else {
            banner.classList.add('hidden');
            banner.classList.remove('fb-events-banner--info');
        }
    }

    // ── Filtered events ─────────────────────────────────────────
    const filtered = (() => {
        switch (_fbFilter) {
            case 'all':      return events;
            case 'warnings': return events.filter(e => (e.warnings || []).length > 0);
            case 'visible':
            default:         return events.filter(e => e.type !== 'auto');
        }
    })();

    setText('fb-filter-count-visible',  events.filter(e => e.type !== 'auto').length);
    setText('fb-filter-count-all',      events.length);
    setText('fb-filter-count-warnings', events.filter(e => (e.warnings || []).length > 0).length);

    const body = document.getElementById('fb-events-body');
    if (!body) return;

    if (filtered.length === 0) {
        body.innerHTML = `<div class="fb-events-empty">${
            events.length === 0
                ? 'Waiting for Facebook events…'
                : _fbFilter === 'warnings'
                    ? 'No events with warnings — looks clean.'
                    : 'No events match this filter.'
        }</div>`;
        return;
    }

    const sessionStart = status.startedAt || null;
    body.innerHTML = filtered.slice().reverse().map(e => {
        const time = fbFormatTime(e.recordedAt, e.recordedAtMs, sessionStart);
        const typeCls = `fb-type-${e.type || 'custom'}`;
        const statusCls = e.status === 'flushed' ? 'fb-stat-flushed' : 'fb-stat-recorded';
        const statusLbl = e.status === 'flushed' ? 'flushed' : 'recorded';
        const warns = (e.warnings || []);
        const warnHtml = warns.length === 0
            ? '<span class="fb-no-warn">—</span>'
            : warns.map(w => `<span class="fb-warn">⚠ ${escapeHtml(w)}</span>`).join('');
        const partialBadge = e.partialParse ? '<span class="fb-partial" title="Parser extracted name but params were unreadable">partial</span>' : '';
        return `<div class="fb-event-row${warns.length ? ' fb-event-row-warn' : ''}">
            <div class="fb-col-time">${escapeHtml(time)}</div>
            <div class="fb-col-name">${escapeHtml(e.name)}${partialBadge}</div>
            <div class="fb-col-type"><span class="fb-type-pill ${typeCls}">${escapeHtml(e.type || 'custom')}</span></div>
            <div class="fb-col-status"><span class="fb-status-pill ${statusCls}">${statusLbl}</span></div>
            <div class="fb-col-params">${fbParamsPreview(e.params)}</div>
            <div class="fb-col-warn">${warnHtml}</div>
        </div>`;
    }).join('');

    // ── Parser issues — hidden when empty, shown with line samples otherwise ─
    const issuesEl = document.getElementById('fb-parser-issues');
    const issuesCount = document.getElementById('fb-parser-issues-count');
    const issuesList = document.getElementById('fb-parser-issues-list');
    const parserIssues = snap.parserIssues || [];
    if (issuesEl) {
        if (parserIssues.length === 0) {
            issuesEl.classList.add('hidden');
        } else {
            issuesEl.classList.remove('hidden');
            if (issuesCount) issuesCount.textContent = parserIssues.length;
            if (issuesList) {
                issuesList.innerHTML = parserIssues.slice(-30).reverse().map(it => {
                    const when = it.at ? new Date(it.at).toLocaleTimeString() : '—';
                    return `<div class="fb-parser-issue-row">
                        <div class="fb-parser-issue-time">${escapeHtml(when)}</div>
                        <div class="fb-parser-issue-reason">${escapeHtml(it.reason || 'no reason')}</div>
                        <code class="fb-parser-issue-raw">${escapeHtml(it.raw || '')}</code>
                    </div>`;
                }).join('');
            }
        }
    }
}

// Expose so HTML inline handlers can reach them
window.setFbFilter = setFbFilter;
window.copyFbEventsJson = copyFbEventsJson;
window.startFbEventsPolling = startFbEventsPolling;
window.stopFbEventsPolling = stopFbEventsPolling;

// ─── CHOICE BRANCH TRACKER PANEL ─────────────────────────────────────────────
// Mirrors the FB events polling pattern: refresh every 2s while session runs,
// stop on session stop. Designed to no-op cleanly when game doesn't fire
// recognizable choice events (most non-narrative games) — UI shows zeros +
// an info banner after 30s of inactivity rather than looking broken.

let _cePollTimer = null;
let _ceLastSnapshot = null;

function startChoiceEventsPolling() {
    stopChoiceEventsPolling();
    pollChoiceEventsOnce();
    _cePollTimer = setInterval(pollChoiceEventsOnce, 2000);
}
function stopChoiceEventsPolling() {
    if (_cePollTimer) clearInterval(_cePollTimer);
    _cePollTimer = null;
}
async function pollChoiceEventsOnce() {
    if (!window.api || typeof window.api.getChoiceEvents !== 'function') return;
    try {
        const snap = await window.api.getChoiceEvents();
        if (snap) {
            _ceLastSnapshot = snap;
            renderChoiceEvents(snap);
        }
    } catch (e) { /* silent */ }
}

function renderChoiceEvents(snap) {
    if (!snap) return;
    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

    const counts = snap.counts || {};
    const status = snap.status || {};
    const events = snap.events || [];
    const byChapter = snap.byChapter || {};

    setText('ce-stat-total',    counts.total    || 0);
    setText('ce-stat-unique',   counts.unique   || 0);
    setText('ce-stat-chapters', counts.chapters || 0);
    setText('ce-stat-premium',  counts.premium  || 0);

    // Banner: if session has been running 30s+ and no choice events, suggest
    // this game may not fire recognizable choice events.
    const banner   = document.getElementById('ce-banner');
    const bannerTx = document.getElementById('ce-banner-text');
    if (banner && bannerTx) {
        const startMs = status.startedAt || 0;
        const elapsed = startMs > 0 ? (Date.now() - startMs) : 0;
        if (counts.total === 0 && elapsed > 30000) {
            banner.classList.remove('hidden');
            bannerTx.textContent = 'No choice events detected. This game may not fire ' +
                'standard choice-pattern events (choice_made / decision_made / branch_selected / etc.). ' +
                'Confirm with the game team that narrative analytics events are being logged.';
        } else {
            banner.classList.add('hidden');
        }
    }

    // Chapter breakdown
    const chapterEl = document.getElementById('ce-chapter-grid');
    if (chapterEl) {
        const entries = Object.entries(byChapter).sort((a, b) => b[1] - a[1]);
        if (entries.length === 0) {
            chapterEl.innerHTML = '<div class="ce-empty">No chapter data yet.</div>';
        } else {
            const max = Math.max(...entries.map(e => e[1]));
            chapterEl.innerHTML = entries.map(([ch, n]) => {
                const pct = max > 0 ? (n / max * 100) : 0;
                return '<div class="ce-chapter">' +
                    '<div class="ce-chapter-name">' + escapeHtml(ch) + '</div>' +
                    '<div class="ce-chapter-bar"><div class="ce-chapter-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
                    '<div class="ce-chapter-count">' + n + ' choice' + (n === 1 ? '' : 's') + '</div>' +
                '</div>';
            }).join('');
        }
    }

    // Recent events table
    const body = document.getElementById('ce-events-body');
    if (body) {
        if (events.length === 0) {
            body.innerHTML = '<div class="ce-empty">No choice events captured yet.</div>';
        } else {
            body.innerHTML = events.slice().reverse().slice(0, 80).map(e => {
                const time = e.recordedAt || '—';
                const premium = e.isPremium ? '<span class="ce-pill ce-pill-premium">premium</span>' : '';
                return '<div class="ce-event-row">' +
                    '<div class="ce-col-time">' + escapeHtml(time) + '</div>' +
                    '<div class="ce-col-name">' + escapeHtml(e.name || '—') + premium + '</div>' +
                    '<div class="ce-col-id">' + escapeHtml(e.choiceId || '—') + '</div>' +
                    '<div class="ce-col-ch">' + escapeHtml(e.chapter || '—') + '</div>' +
                    '<div class="ce-col-text">' + escapeHtml((e.text || '').slice(0, 60)) + '</div>' +
                    '<div class="ce-col-src"><span class="ce-pill ce-pill-' + escapeHtml(e.source || 'generic') + '">' + escapeHtml(e.source || 'generic') + '</span></div>' +
                '</div>';
            }).join('');
        }
    }
}

window.startChoiceEventsPolling = startChoiceEventsPolling;
window.stopChoiceEventsPolling  = stopChoiceEventsPolling;

// ─── SAVE STATE MONITOR PANEL ────────────────────────────────────────────────
// Polls every 5s while session is running (snapshots themselves run every 60s
// on the backend, so polling more often than that doesn't surface new data).

let _ssPollTimer = null;
let _ssLastSnapshot = null;

function startSaveStatePolling() {
    stopSaveStatePolling();
    pollSaveStateOnce();
    _ssPollTimer = setInterval(pollSaveStateOnce, 5000);
}
function stopSaveStatePolling() {
    if (_ssPollTimer) clearInterval(_ssPollTimer);
    _ssPollTimer = null;
}
async function pollSaveStateOnce() {
    if (!window.api || typeof window.api.getSaveState !== 'function') return;
    try {
        const snap = await window.api.getSaveState();
        if (snap) {
            _ssLastSnapshot = snap;
            renderSaveState(snap);
        }
    } catch (e) { /* silent */ }
}

function ssBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
}

function renderSaveState(snap) {
    if (!snap) return;
    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

    const status  = snap.status || {};
    const counts  = snap.counts || {};
    const findings = snap.findings || [];
    const latest  = snap.latest || [];

    setText('ss-stat-files', counts.trackedFiles || 0);
    setText('ss-stat-snaps', status.snapshotCount || 0);
    setText('ss-stat-err',   counts.errors || 0);
    setText('ss-stat-warn',  counts.warnings || 0);

    // Status row
    const debugEl = document.getElementById('ss-debuggable');
    if (debugEl) {
        if (status.debuggable === true) {
            debugEl.textContent = 'Yes';
            debugEl.className = 'ss-status-value ss-status-good';
        } else if (status.debuggable === false) {
            debugEl.textContent = 'No';
            debugEl.className = 'ss-status-value ss-status-bad';
        } else {
            debugEl.textContent = 'checking…';
            debugEl.className = 'ss-status-value';
        }
    }
    setText('ss-package', status.packageName || '—');

    // Banner: only shown when non-debuggable
    const banner   = document.getElementById('ss-banner');
    const bannerTx = document.getElementById('ss-banner-text');
    if (banner && bannerTx) {
        if (status.debuggable === false && status.discoveryError) {
            banner.classList.remove('hidden');
            bannerTx.textContent = status.discoveryError;
        } else {
            banner.classList.add('hidden');
        }
    }

    // Findings list — group by severity (error first)
    const findingsEl = document.getElementById('ss-findings');
    if (findingsEl) {
        if (findings.length === 0) {
            findingsEl.innerHTML = '<div class="ss-clean">✓ No corruption or unexpected changes detected.</div>';
        } else {
            const order = ['error', 'warn', 'info'];
            const sorted = findings.slice().sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
            findingsEl.innerHTML = sorted.map(f => {
                const icon = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '⚠' : 'ℹ';
                const pathBasename = (f.path || '').split('/').pop() || f.path;
                return '<div class="ss-finding ss-finding-' + escapeHtml(f.severity) + '">' +
                    '<span class="ss-finding-icon">' + icon + '</span>' +
                    '<div class="ss-finding-body">' +
                        '<div class="ss-finding-msg">' + escapeHtml(f.message || f.code) + '</div>' +
                        '<div class="ss-finding-path"><code>' + escapeHtml(pathBasename) + '</code> · ' + escapeHtml(f.code) + '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
    }

    // Tracked files inventory
    const summaryEl = document.getElementById('ss-files-summary');
    const listEl    = document.getElementById('ss-files-list');
    if (summaryEl) summaryEl.textContent = latest.length > 0
        ? latest.length + ' files tracked'
        : 'No files tracked yet';
    if (listEl) {
        if (latest.length === 0) {
            listEl.innerHTML = '<div class="ss-empty">App is not debuggable, or no save files exist yet.</div>';
        } else {
            listEl.innerHTML = latest.slice(0, 100).map(f => {
                const parseable = f.parseable === true ? '<span class="ss-parse ss-parse-ok">parses</span>'
                                : f.parseable === false ? '<span class="ss-parse ss-parse-bad">invalid</span>'
                                : '';
                const skipped = f.skipped ? '<span class="ss-skip">' + escapeHtml(f.skipped) + '</span>' : '';
                return '<div class="ss-file-row">' +
                    '<code class="ss-file-path">' + escapeHtml(f.path) + '</code>' +
                    '<span class="ss-file-size">' + ssBytes(f.size) + '</span>' +
                    parseable + skipped +
                '</div>';
            }).join('') + (latest.length > 100 ? '<div class="ss-detail-more">+ ' + (latest.length - 100) + ' more</div>' : '');
        }
    }
}

window.startSaveStatePolling = startSaveStatePolling;
window.stopSaveStatePolling  = stopSaveStatePolling;

// ─── TEXT OVERFLOW DETECTOR PANEL ────────────────────────────────────────────
// Polls every 5s while session runs. Backend dumps uiautomator every 15s, so
// the panel surfaces new findings within a few seconds of each dump.

let _toPollTimer = null;
let _toLastSnapshot = null;

function startTextOverflowPolling() {
    stopTextOverflowPolling();
    pollTextOverflowOnce();
    _toPollTimer = setInterval(pollTextOverflowOnce, 5000);
}
function stopTextOverflowPolling() {
    if (_toPollTimer) clearInterval(_toPollTimer);
    _toPollTimer = null;
}
async function pollTextOverflowOnce() {
    if (!window.api || typeof window.api.getTextOverflow !== 'function') return;
    try {
        const snap = await window.api.getTextOverflow();
        if (snap) {
            _toLastSnapshot = snap;
            renderTextOverflow(snap);
        }
    } catch (e) { /* silent */ }
}

function toRelativeTime(ms, startedAt) {
    if (!ms) return '—';
    if (startedAt && startedAt > 0) {
        const sec = Math.max(0, Math.floor((ms - startedAt) / 1000));
        return '+' + sec + 's';
    }
    return new Date(ms).toLocaleTimeString();
}

function renderTextOverflow(snap) {
    if (!snap) return;
    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

    const status = snap.status || {};
    const counts = snap.counts || {};
    const findings = snap.findings || [];

    setText('to-stat-dumps', status.dumpsTaken || 0);
    setText('to-stat-err',   counts.errors || 0);
    setText('to-stat-warn',  counts.warnings || 0);
    setText('to-stat-info',  counts.infos || 0);

    // Status row
    if (status.screen && status.screen.width) {
        setText('to-screen', status.screen.width + ' × ' + status.screen.height);
    } else {
        setText('to-screen', '—');
    }
    setText('to-last-dump', toRelativeTime(status.lastDumpAt, status.startedAt));
    setText('to-package', status.packageName || '—');

    // Banner: only when discovery error
    const banner   = document.getElementById('to-banner');
    const bannerTx = document.getElementById('to-banner-text');
    if (banner && bannerTx) {
        if (status.discoveryError) {
            banner.classList.remove('hidden');
            bannerTx.textContent = status.discoveryError;
        } else {
            banner.classList.add('hidden');
        }
    }

    // Findings list (severity-sorted)
    const list = document.getElementById('to-findings');
    if (list) {
        if (findings.length === 0) {
            list.innerHTML = '<div class="to-clean">✓ No text overflow / clipping / missing-string issues detected.</div>';
        } else {
            const order = ['error', 'warn', 'info'];
            const sorted = findings.slice().sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
            list.innerHTML = sorted.slice(0, 100).map(f => {
                const icon = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '⚠' : 'ℹ';
                const txt = (f.text || '').length > 0 ? '"' + (f.text || '').slice(0, 100) + '"' : '<em class="to-empty-text">(empty)</em>';
                const cls = f.className ? f.className.split('.').pop() : '';
                const rid = f.resourceId || '';
                const bounds = f.bounds ? f.bounds.x1 + ',' + f.bounds.y1 + ' → ' + f.bounds.x2 + ',' + f.bounds.y2 : '';
                return '<div class="to-finding to-finding-' + escapeHtml(f.severity) + '">' +
                    '<span class="to-finding-icon">' + icon + '</span>' +
                    '<div class="to-finding-body">' +
                        '<div class="to-finding-text">' + (typeof txt === 'string' && txt.startsWith('<em') ? txt : escapeHtml(txt)) + '</div>' +
                        '<div class="to-finding-msg">' + escapeHtml(f.message || f.code) + '</div>' +
                        '<div class="to-finding-meta">' +
                            (rid ? '<span class="to-meta-rid">' + escapeHtml(rid) + '</span>' : '') +
                            (cls ? '<span class="to-meta-class">' + escapeHtml(cls) + '</span>' : '') +
                            (bounds ? '<span class="to-meta-bounds">' + escapeHtml(bounds) + '</span>' : '') +
                            '<span class="to-meta-code">' + escapeHtml(f.code) + '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('') + (findings.length > 100 ? '<div class="to-detail-more">+ ' + (findings.length - 100) + ' more</div>' : '');
        }
    }
}

window.startTextOverflowPolling = startTextOverflowPolling;
window.stopTextOverflowPolling  = stopTextOverflowPolling;

// ─── LOG HELPER ──────────────────────────────────────────────────────────────
function addLog(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = message;
    logsContainer.appendChild(entry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

// ─── SDK KEY REFERENCE TABLE LOGIC ───────────────────────────────────────────
const CATEGORY_STYLE_REF = {
    ADS:         { bg: 'rgba(45,212,191,0.15)',  color: '#2dd4bf',  border: 'rgba(45,212,191,0.3)' },
    ANALYTICS:   { bg: 'rgba(56,189,248,0.15)',  color: '#38bdf8',  border: 'rgba(56,189,248,0.3)' },
    ATTRIBUTION: { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa',  border: 'rgba(167,139,250,0.3)' },
    BACKEND:     { bg: 'rgba(251,146,60,0.15)',  color: '#fb923c',  border: 'rgba(251,146,60,0.3)' },
    IAP:         { bg: 'rgba(74,222,128,0.15)',  color: '#4ade80',  border: 'rgba(74,222,128,0.3)' },
    MONITORING:  { bg: 'rgba(244,114,182,0.15)', color: '#f472b6',  border: 'rgba(244,114,182,0.3)' }
};

function renderReferenceRows(entries) {
    const tbody = document.getElementById('sdk-ref-table-body');
    if (!tbody) return;
    if (!entries.length) {
        tbody.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:#71717a;">No matching entries</div>';
        return;
    }
    const categoryOrder = ['ADS', 'ANALYTICS', 'ATTRIBUTION', 'BACKEND', 'IAP', 'MONITORING'];
    // Group entries by category
    const grouped = {};
    for (const entry of entries) {
        if (!grouped[entry.category]) grouped[entry.category] = [];
        grouped[entry.category].push(entry);
    }
    let html = '';
    for (const cat of categoryOrder) {
        const catEntries = grouped[cat];
        if (!catEntries || !catEntries.length) continue;
        const c = CATEGORY_STYLE_REF[cat] || CATEGORY_STYLE_REF.ADS;
        // Category section header
        html += `<div style="display:flex;align-items:center;gap:12px;padding:8px 16px;background:${c.bg};border-left:3px solid ${c.color};border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="font-size:11px;font-weight:800;text-transform:uppercase;color:${c.color};letter-spacing:0.1em;">${cat}</span>
            <span style="font-size:11px;color:#71717a;">${catEntries.length} key${catEntries.length !== 1 ? 's' : ''}</span>
        </div>`;
        // Entries for this category
        catEntries.forEach((entry, i) => {
            const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.013)' : 'transparent';
            const keyTags = entry.stringKeyNames.map(k =>
                `<code style="font-size:11px;color:${c.color};background:${c.bg};border:1px solid ${c.border};padding:2px 7px;border-radius:3px;white-space:nowrap;opacity:0.88;">${k}</code>`
            ).join(' ');
            html += `<div style="display:grid;grid-template-columns:150px 120px 1fr 175px;gap:0;padding:10px 16px 10px 20px;background:${rowBg};border-left:3px solid transparent;border-bottom:1px solid rgba(255,255,255,0.03);">
                <div style="font-size:13px;font-weight:600;color:#e4e4e7;align-self:center;">${entry.sdk}</div>
                <div style="font-size:12px;color:#a1a1aa;align-self:center;">${entry.keyLabel}</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding-right:8px;">${keyTags}</div>
                <div style="font-size:11px;color:#a1a1aa;align-self:center;font-family:'JetBrains Mono',monospace;word-break:break-word;line-height:1.5;">${entry.expectedFormat}</div>
            </div>`;
        });
    }
    tbody.innerHTML = html;
}

function initSdkKeyReference() {
    const countEl = document.getElementById('sdk-ref-count');
    if (countEl) countEl.textContent = SDK_KEY_REFERENCE.length;
    renderReferenceRows(SDK_KEY_REFERENCE);
}

window.setTimelineFilter = function (filter) {
    _timelineFilter = filter;
    const all = ['1min', '5min', 'full'];
    all.forEach(f => {
        const btn = document.getElementById(`tl-filter-${f}`);
        if (!btn) return;
        if (f === filter) {
            btn.style.borderColor = 'rgba(139,92,246,0.4)';
            btn.style.background  = 'rgba(139,92,246,0.15)';
            btn.style.color       = '#a78bfa';
        } else {
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
            btn.style.background  = 'rgba(255,255,255,0.04)';
            btn.style.color       = '#a1a1aa';
        }
    });
    if (currentSession.runtime) renderRuntimeTab(currentSession.runtime);
};

window.filterReferenceTable = function () {
    const q = (document.getElementById('sdk-ref-filter')?.value || '').toLowerCase();
    if (!q) { renderReferenceRows(SDK_KEY_REFERENCE); return; }
    const filtered = SDK_KEY_REFERENCE.filter(e =>
        e.sdk.toLowerCase().includes(q) ||
        e.keyLabel.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.stringKeyNames.some(k => k.toLowerCase().includes(q)) ||
        e.expectedFormat.toLowerCase().includes(q)
    );
    renderReferenceRows(filtered);
};

window.filterExtractedKeys = function () {
    const q = (document.getElementById('sdk-key-search')?.value || '').toLowerCase();
    const cat = document.getElementById('sdk-key-category')?.value || '';
    const rows = document.querySelectorAll('#sdk-extracted-keys-section [data-sdk-row]');
    rows.forEach(row => {
        const text  = (row.dataset.sdkText || '').toLowerCase();
        const rowCat = row.dataset.sdkCat || '';
        const matchQ   = !q   || text.includes(q);
        const matchCat = !cat || rowCat === cat;
        row.style.display = matchQ && matchCat ? '' : 'none';
    });
};

// ─── INIT ────────────────────────────────────────────────────────────────────
loadProjects();
startDevicePolling();
updateSessionState('idle');
initSdkKeyReference();

// ─── IAP VALIDATION LOGIC ───────────────────────────────────────────────────
let iapInterval = null;

async function getActiveApkContext() {
    if (selectedApkPath) {
        if (!currentSession.staticAnalysis) {
            try {
                currentSession.staticAnalysis = await window.api.analyzeAPK(selectedApkPath);
            } catch (e) {}
        }
        return {
            path: selectedApkPath,
            name: selectedApkPath.split(/[\\/]/).pop(),
            packageName: currentSession.staticAnalysis?.packageName || null
        };
    }

    if (!activeProject) return null;
    const apks = await window.api.getProjectApks(activeProject);
    if (!apks || apks.length === 0) return null;

    const item = apks[apks.length - 1];
    const apk = typeof item === 'string'
        ? { name: item, path: null, packageName: null }
        : item;

    if (apk.path && !apk.packageName) {
        try {
            const info = await window.api.analyzeAPK(apk.path);
            apk.packageName = info?.packageName || null;
            currentSession.staticAnalysis = info || currentSession.staticAnalysis;
        } catch (e) {}
    }

    return apk;
}

async function renderIAPTab() {
    if (!activeProject) return;
    
    // Check if IAP is already running
    const state = await window.api.iapGetResult();
    if (state && (state.isActive || (state.events && state.events.length > 0))) {
        iapEmptyState.classList.add('hidden');
        iapContent.classList.remove('hidden');
        updateIAPUI(state);
        if (state.isActive) startIAPPolling();
    } else {
        iapEmptyState.classList.remove('hidden');
        iapContent.classList.add('hidden');
    }
}

iapStartBtn.addEventListener('click', async () => {
    if (!activeProject) return;

    if (sessionState !== 'running') {
        addLog('❌ Start a Test Session first, then start IAP Validation.', 'error');
        return;
    }

    const apk = await getActiveApkContext();
    const pkg = apk?.packageName || null;

    if (!pkg) {
        addLog('❌ Could not resolve the APK package name. Upload/analyze the APK again.', 'error');
        return;
    }

    const device = await window.api.checkDevice();
    const deviceId = device?.deviceId || device?.id;
    if (!deviceId) {
        addLog('❌ No device connected for IAP test.', 'error');
        return;
    }

    addLog('🛒 Starting IAP Validation Engine...', 'info');

    // Detect SDK + Billing Library version (apk.path enables aapt-based version read).
    iapSystemName.textContent = 'Scanning SDK...';
    const detect = await window.api.iapDetectSDK(pkg, deviceId, apk?.path || null);
    const system = (typeof detect === 'string') ? detect : (detect?.system || 'Not Detected');
    const libVersion = (typeof detect === 'object') ? detect?.libraryVersion : null;
    iapSystemName.textContent = system;
    if (libVersion) {
        iapLibraryVersion.textContent = `Library version ${libVersion}`;
        iapLibraryVersion.style.display = '';
    } else {
        iapLibraryVersion.style.display = 'none';
    }

    const res = await window.api.iapStartTest(pkg);
    if (res.success) {
        iapEmptyState.classList.add('hidden');
        iapContent.classList.remove('hidden');
        startIAPPolling();
        addLog('✅ IAP Test Mode Active. Perform purchase on device.', 'success');
    }
});

iapStopBtn.addEventListener('click', async () => {
    const res = await window.api.iapStopTest();
    stopIAPPolling();
    addLog('🏁 IAP Test Finalized.', 'info');
    updateIAPUI(res);
});

function startIAPPolling() {
    if (iapInterval) clearInterval(iapInterval);
    iapInterval = setInterval(async () => {
        const res = await window.api.iapGetResult();
        updateIAPUI(res);
    }, 1000);
}

function stopIAPPolling() {
    if (iapInterval) clearInterval(iapInterval);
    iapInterval = null;
}

function updateIAPUI(data) {
    if (!data) return;

    // Status Badge
    const statusLc = (data.status || 'INCOMPLETE').toLowerCase();
    iapStatusBadge.textContent = data.status || 'INCOMPLETE';
    iapStatusBadge.className = `badge ${statusLc === 'pass' ? 'success' : statusLc === 'fail' ? 'danger' : statusLc === 'pending' ? 'info' : statusLc === 'cancelled' ? 'warning' : 'warning'}`;

    // Library version
    if (data.libraryVersion) {
        iapLibraryVersion.textContent = `Library version ${data.libraryVersion}`;
        iapLibraryVersion.style.display = '';
    } else {
        iapLibraryVersion.style.display = 'none';
    }

    // Timer
    if (data.startTime && data.isActive) {
        const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
        iapTimer.textContent = `${elapsed}s`;
    }

    // Summary
    iapValTime.textContent = data.duration > 0 ? `${data.duration}s` : '—';
    iapValBackend.textContent = data.backendVerifyAttempted ? '✔ Verify call seen' : 'Not Detected';
    iapValBackend.style.color = data.backendVerifyAttempted ? 'var(--success)' : 'var(--text-muted)';
    iapValError.textContent = data.error || 'None';
    if (data.errorMessage) {
        iapValErrorMessage.textContent = data.errorMessage;
        iapValErrorMessageRow.style.display = '';
    } else {
        iapValErrorMessageRow.style.display = 'none';
    }

    // Lifecycle step states — derived from real events + flags
    const evs = data.events || [];
    const hasInitiated = !!evs.find(e => e.name === 'Purchase Initiated');
    const hasCompleted = !!evs.find(e => e.name === 'Purchase Completed');
    const hasFailed    = !!evs.find(e => /Purchase Failed/.test(e.name));
    const hasCancelled = !!evs.find(e => /Purchase Cancelled/.test(e.name));

    setLifecycleStep(iapStepInitiate, hasInitiated ? 'ok' : 'pending', hasInitiated ? 'Detected' : 'Waiting…');

    if (hasCompleted)         setLifecycleStep(iapStepResolve, 'ok',    'Completed');
    else if (hasFailed)       setLifecycleStep(iapStepResolve, 'fail',  data.error || 'Failed');
    else if (hasCancelled)    setLifecycleStep(iapStepResolve, 'warn',  'Cancelled');
    else if (hasInitiated)    setLifecycleStep(iapStepResolve, 'pending', 'Awaiting…');
    else                       setLifecycleStep(iapStepResolve, 'pending', '—');

    // Acknowledge / Consume — only meaningful after a PURCHASED event.
    if (data.acknowledgeDetected) {
        setLifecycleStep(iapStepAck, 'ok', 'Detected');
    } else if (hasCompleted && data.purchaseFinalized === 'MISSING' && !data.consumeDetected) {
        setLifecycleStep(iapStepAck, 'fail', 'Missing');
    } else if (hasCompleted) {
        setLifecycleStep(iapStepAck, 'pending', 'Awaiting…');
    } else {
        setLifecycleStep(iapStepAck, 'pending', '—');
    }

    if (data.consumeDetected) {
        setLifecycleStep(iapStepConsume, 'ok', 'Detected');
    } else if (hasCompleted && data.purchaseFinalized === 'MISSING' && !data.acknowledgeDetected) {
        setLifecycleStep(iapStepConsume, 'fail', 'Missing');
    } else if (hasCompleted) {
        setLifecycleStep(iapStepConsume, 'pending', 'Awaiting…');
    } else {
        setLifecycleStep(iapStepConsume, 'pending', '—');
    }

    // Lifecycle verdict banner — surfaces dead-callback + missing-finalize states clearly.
    iapLcVerdict.style.display = 'none';
    if (data.deadCallbackDetected) {
        iapLcVerdict.style.background = 'rgba(239, 68, 68, 0.08)';
        iapLcVerdict.style.border = '1px solid rgba(239, 68, 68, 0.25)';
        iapLcVerdict.style.color = '#fca5a5';
        iapLcVerdict.innerHTML = '⚠️ <strong>Dead callback suspected.</strong> launchBillingFlow fired but no result and no BillingClient activity for 60s. Common cause: app forgot to register onPurchasesUpdated listener.';
        iapLcVerdict.style.display = '';
    } else if (hasCompleted && data.purchaseFinalized === 'MISSING') {
        iapLcVerdict.style.background = 'rgba(239, 68, 68, 0.08)';
        iapLcVerdict.style.border = '1px solid rgba(239, 68, 68, 0.25)';
        iapLcVerdict.style.color = '#fca5a5';
        iapLcVerdict.innerHTML = '⚠️ <strong>Purchase not finalized.</strong> 60s+ since PURCHASED with no acknowledge or consume call. <strong>Google will auto-refund this purchase in 3 days</strong> — direct revenue loss.';
        iapLcVerdict.style.display = '';
    } else if (hasCompleted && data.purchaseFinalized === 'OK') {
        iapLcVerdict.style.background = 'rgba(34, 197, 94, 0.08)';
        iapLcVerdict.style.border = '1px solid rgba(34, 197, 94, 0.25)';
        iapLcVerdict.style.color = '#86efac';
        iapLcVerdict.innerHTML = '✓ Purchase fully finalized — ' + (data.consumeDetected ? 'consume call detected (consumable item).' : 'acknowledge call detected (non-consumable item).');
        iapLcVerdict.style.display = '';
    }

    // Timeline — show event hint/message when present.
    if (evs.length > 0) {
        iapTimeline.innerHTML = evs.map(ev => `
            <div class="iap-event ${ev.type}">
                <span class="time">${ev.time}s</span>
                <span class="name">${escapeHtml(ev.name)}${ev.message ? `<small style="display:block; font-size:10px; color:#a1a1aa; font-weight:normal; margin-top:2px;">${escapeHtml(ev.message)}</small>` : ev.hint ? `<small style="display:block; font-size:10px; color:#71717a; font-weight:normal; margin-top:2px;">${escapeHtml(ev.hint)}</small>` : ''}</span>
                <span class="status-icon">${ev.type === 'success' ? '✔' : ev.type === 'danger' ? '✖' : '⚠'}</span>
            </div>
        `).join('');
    } else {
        iapTimeline.innerHTML = '<p class="empty-state">Waiting for IAP signals...</p>';
    }
}

function setLifecycleStep(el, state, text) {
    if (!el) return;
    el.classList.remove('ok', 'warn', 'fail', 'pending');
    el.classList.add(state);
    const stateEl = el.querySelector('.lc-state');
    if (stateEl) stateEl.textContent = text;
}

// ─── AUTOMATED VALIDATION RENDER HELPERS ─────────────────────────────────────
// Used by the QA Checklist tab's "Automated" mode. Pulls from getTestValidation()
// and renders the categorized PASS/WARN/FAIL items with evidence. Reuses .tv-cat
// / .tv-item styles (defined in style.css for the original Test Validation tab).

const validationCollapsed = new Set();

const STATUS_BADGE_CLASS = { PASS: 'success', FAIL: 'danger', WARN: 'warning', INFO: 'info' };
const STATUS_ITEM_CLASS  = { PASS: 'is-pass', FAIL: 'is-fail', WARN: 'is-warn', INFO: '' };

function categorySummary(items) {
    const fail = items.filter(it => it.status === 'FAIL').length;
    const warn = items.filter(it => it.status === 'WARN').length;
    const pass = items.filter(it => it.status === 'PASS').length;
    return { fail, warn, pass };
}

function evidenceBlock(evidence) {
    if (!evidence || evidence.length === 0) return '';
    return evidence.map(e => `<pre class="tv-evidence">${escapeHtml(String(e))}</pre>`).join('');
}

function automatedItemHtml(it) {
    const badgeClass = STATUS_BADGE_CLASS[it.status] || 'info';
    const itemClass  = STATUS_ITEM_CLASS[it.status]  || '';
    return `
        <div class="tv-item ${itemClass}">
            <div class="tv-item-head">
                <span class="badge ${badgeClass}">${it.status}</span>
                <span class="tv-item-title">${escapeHtml(it.title)}</span>
                <span class="tv-confidence" title="Confidence level — how directly observable this check is.">${escapeHtml(it.confidence || 'Verified')}</span>
            </div>
            ${it.description ? `<div class="tv-item-desc">${escapeHtml(it.description)}</div>` : ''}
            ${evidenceBlock(it.evidence)}
        </div>`;
}

// Render automated categories into the supplied container. Pure function on `automated`,
// re-runs on every poll. Container ID is parameterised so this can be reused if more
// surfaces want to render automated checks later.
function renderAutomatedSection(automated, containerId, emptyHtml) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const cats = automated?.categories || [];
    if (cats.length === 0) {
        wrap.innerHTML = emptyHtml || `<p class="empty-state">No automated checks yet.</p>`;
        return;
    }
    wrap.innerHTML = cats.map(cat => {
        const sum = categorySummary(cat.items);
        const collapsed = validationCollapsed.has('auto:' + cat.category);
        const sumChips = [
            sum.fail ? `<span class="badge danger">${sum.fail} FAIL</span>` : '',
            sum.warn ? `<span class="badge warning">${sum.warn} WARN</span>` : '',
            sum.pass ? `<span class="badge success">${sum.pass} PASS</span>` : ''
        ].filter(Boolean).join(' ');
        return `
            <div class="tv-cat ${collapsed ? 'collapsed' : ''}" data-cat-key="auto:${escapeHtml(cat.category)}">
                <button class="tv-cat-head" type="button">
                    <span class="tv-cat-caret">▾</span>
                    <span class="tv-cat-title">${escapeHtml(cat.category)}</span>
                    <span class="tv-cat-count">${cat.items.length}</span>
                    <span class="tv-cat-chips">${sumChips}</span>
                </button>
                <div class="tv-cat-body">
                    ${cat.items.map(automatedItemHtml).join('')}
                </div>
            </div>`;
    }).join('');
    wrap.querySelectorAll('.tv-cat').forEach(el => {
        el.querySelector('.tv-cat-head').addEventListener('click', () => {
            const key = el.dataset.catKey;
            if (validationCollapsed.has(key)) {
                validationCollapsed.delete(key);
                el.classList.remove('collapsed');
            } else {
                validationCollapsed.add(key);
                el.classList.add('collapsed');
            }
        });
    });
}

// ─── BUILD REGRESSION COMPARATOR ────────────────────────────────────────────
const regOldName = document.getElementById('reg-old-name');
const regNewName = document.getElementById('reg-new-name');
const regPickOld = document.getElementById('reg-pick-old');
const regPickNew = document.getElementById('reg-pick-new');
const regUseActiveOld = document.getElementById('reg-use-active-old');
const regUseActiveNew = document.getElementById('reg-use-active-new');
const regCompareBtn = document.getElementById('reg-compare-btn');
const regEmpty = document.getElementById('reg-empty');
const regResults = document.getElementById('reg-results');

let regOldPath = null;
let regNewPath = null;

function regUpdateButtonState() {
    if (regCompareBtn) regCompareBtn.disabled = !(regOldPath && regNewPath);
}

function regSetOld(p) {
    regOldPath = p;
    if (regOldName) regOldName.textContent = p ? p.split('/').pop() : 'No file selected';
    regUpdateButtonState();
}

function regSetNew(p) {
    regNewPath = p;
    if (regNewName) regNewName.textContent = p ? p.split('/').pop() : 'No file selected';
    regUpdateButtonState();
}

if (regPickOld) regPickOld.addEventListener('click', async () => {
    const p = await window.api.selectSecondApk();
    if (p) regSetOld(p);
});
if (regPickNew) regPickNew.addEventListener('click', async () => {
    const p = await window.api.selectSecondApk();
    if (p) regSetNew(p);
});
if (regUseActiveOld) regUseActiveOld.addEventListener('click', async () => {
    const apk = await getActiveApkContext();
    if (apk?.path) regSetOld(apk.path);
    else addLog('❌ No active APK in project.', 'error');
});
if (regUseActiveNew) regUseActiveNew.addEventListener('click', async () => {
    const apk = await getActiveApkContext();
    if (apk?.path) regSetNew(apk.path);
    else addLog('❌ No active APK in project.', 'error');
});

if (regCompareBtn) {
    regCompareBtn.addEventListener('click', async () => {
        if (!regOldPath || !regNewPath) return;
        regCompareBtn.disabled = true;
        regCompareBtn.textContent = 'Comparing...';
        regEmpty?.classList.add('hidden');
        if (regResults) {
            regResults.classList.remove('hidden');
            regResults.innerHTML = '<p class="empty-state">Analyzing both APKs (parsing manifest, scanning SDKs, computing diff)…</p>';
        }
        addLog('🔬 Running build regression diff...', 'info');
        try {
            const result = await window.api.buildRegressionCompare(regOldPath, regNewPath, activeProject);
            renderRegressionResults(result);
            if (result?.success) {
                const v = result.verdict;
                addLog(`✅ Regression diff complete — ${v.status}: ${v.blockers.length} blocker(s), ${v.warnings.length} warning(s).`, v.status === 'BLOCK' ? 'error' : v.status === 'CAUTION' ? 'warning' : 'success');
            } else {
                addLog(`❌ Regression diff failed: ${result?.error || 'Unknown'}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Regression diff failed: ${e.message}`, 'error');
            if (regResults) regResults.innerHTML = `<p class="empty-state">Failed: ${escapeHtml(e.message)}</p>`;
        } finally {
            regCompareBtn.disabled = false;
            regCompareBtn.textContent = 'Compare Builds';
        }
    });
}

function renderRegressionResults(r) {
    if (!regResults) return;
    if (!r || !r.success) {
        regResults.innerHTML = `<div class="card" style="border-left: 4px solid var(--danger);"><div style="color: var(--danger); font-weight: 600;">Comparison failed</div><div style="font-size: 12px; color: #a1a1aa; margin-top: 6px;">${escapeHtml(r?.error || 'Unknown error')}</div></div>`;
        return;
    }

    const v = r.verdict;
    const verdictColor = v.status === 'BLOCK' ? 'var(--danger)' : v.status === 'CAUTION' ? 'var(--warning)' : 'var(--success)';
    const verdictBg = v.status === 'BLOCK' ? 'rgba(239,68,68,0.08)' : v.status === 'CAUTION' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)';
    const verdictIcon = v.status === 'BLOCK' ? '🚨' : v.status === 'CAUTION' ? '⚠️' : '✅';

    const sd = r.sizeDelta;
    const sizeColor = sd.severity === 'HIGH' ? 'var(--danger)' : sd.severity === 'MEDIUM' ? 'var(--warning)' : sd.deltaBytes < 0 ? 'var(--success)' : 'var(--text-muted)';

    const pkgWarning = !r.packageMatch ? `
        <div style="padding: 10px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; margin-bottom: 16px;">
            <strong style="color: var(--danger);">⚠ Package name mismatch:</strong>
            <div style="font-size: 11px; color: #a1a1aa; margin-top: 4px;">Old: <code>${escapeHtml(r.old.packageName)}</code> · New: <code>${escapeHtml(r.new.packageName)}</code></div>
            <div style="font-size: 11px; color: #fbbf24; margin-top: 4px;">Diff is computed but these may be different apps, not different builds of the same app.</div>
        </div>
    ` : '';

    regResults.innerHTML = `
        ${pkgWarning}

        <div class="card" style="background: ${verdictBg}; border-left: 4px solid ${verdictColor}; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 10px;">
                <div style="font-size: 32px;">${verdictIcon}</div>
                <div>
                    <div style="font-size: 11px; color: #71717a; text-transform: uppercase;">Verdict</div>
                    <div style="font-size: 24px; font-weight: 800; color: ${verdictColor};">${escapeHtml(v.status)}</div>
                </div>
            </div>
            ${v.blockers.length ? `<div style="margin-top: 10px;"><div style="font-size: 11px; color: var(--danger); font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Blockers</div>${v.blockers.map(b => `<div style="font-size: 12px; color: #fca5a5; padding: 4px 0;">• ${escapeHtml(b)}</div>`).join('')}</div>` : ''}
            ${v.warnings.length ? `<div style="margin-top: 10px;"><div style="font-size: 11px; color: var(--warning); font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Warnings</div>${v.warnings.map(b => `<div style="font-size: 12px; color: #fde68a; padding: 4px 0;">• ${escapeHtml(b)}</div>`).join('')}</div>` : ''}
            ${v.wins.length ? `<div style="margin-top: 10px;"><div style="font-size: 11px; color: var(--success); font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Wins</div>${v.wins.map(b => `<div style="font-size: 12px; color: #86efac; padding: 4px 0;">• ${escapeHtml(b)}</div>`).join('')}</div>` : ''}
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div class="card">
                <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 6px;">APK Size</div>
                <div style="font-size: 20px; font-weight: 700; color: ${sizeColor};">${escapeHtml(sd.deltaHuman)} (${sd.percent >= 0 ? '+' : ''}${sd.percent}%)</div>
                <div style="font-size: 10px; color: #71717a; margin-top: 6px;">${escapeHtml(r.old.sizeHuman)} → ${escapeHtml(r.new.sizeHuman)}</div>
            </div>
            <div class="card">
                <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 6px;">Version</div>
                <div style="font-size: 16px; font-weight: 700; color: #fff;">${escapeHtml(r.old.versionName)} → ${escapeHtml(r.new.versionName)}</div>
                <div style="font-size: 10px; color: ${r.versionDelta.versionCodeDelta < 0 ? 'var(--danger)' : '#71717a'}; margin-top: 6px;">versionCode: ${escapeHtml(String(r.old.versionCode))} → ${escapeHtml(String(r.new.versionCode))} (${r.versionDelta.versionCodeDelta >= 0 ? '+' : ''}${r.versionDelta.versionCodeDelta})</div>
            </div>
            <div class="card">
                <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 6px;">SDK Levels</div>
                <div style="font-size: 13px; color: #fff;">min: ${escapeHtml(String(r.sdkLevelDelta.oldMinSdk))} → ${escapeHtml(String(r.sdkLevelDelta.newMinSdk))}</div>
                <div style="font-size: 13px; color: #fff;">target: ${escapeHtml(String(r.sdkLevelDelta.oldTargetSdk))} → ${escapeHtml(String(r.sdkLevelDelta.newTargetSdk))}</div>
            </div>
        </div>

        ${renderRegSection('Permissions', r.permissionsDelta.added, r.permissionsDelta.removed, r.permissionsDelta.addedRisky)}
        ${renderRegSdks(r.sdksDelta)}
        ${renderRegManifest(r.manifestDelta, r.securityDelta)}
        ${renderRegPerformance(r.performanceDelta)}
    `;
}

function renderRegSection(title, added, removed, riskyAdded) {
    if (!added.length && !removed.length) {
        return `<div class="card" style="margin-bottom: 16px;"><div style="font-size: 11px; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">${escapeHtml(title)}</div><div style="font-size: 12px; color: var(--success);">✓ No changes</div></div>`;
    }
    const riskySet = new Set(riskyAdded || []);
    return `
        <div class="card" style="margin-bottom: 16px;">
            <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 10px;">${escapeHtml(title)} (${added.length} added · ${removed.length} removed)</div>
            ${added.length ? `<div style="margin-bottom: 8px;"><div style="font-size: 10px; color: var(--success); font-weight: 700; margin-bottom: 4px;">+ ADDED</div>${added.map(p => {
                const risky = riskySet.has(p);
                return `<div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${risky ? 'var(--danger)' : '#86efac'}; padding: 2px 0;">${risky ? '⚠ ' : '+ '}${escapeHtml(p)}${risky ? ' (risky)' : ''}</div>`;
            }).join('')}</div>` : ''}
            ${removed.length ? `<div><div style="font-size: 10px; color: #f87171; font-weight: 700; margin-bottom: 4px;">− REMOVED</div>${removed.map(p => `<div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #fca5a5; padding: 2px 0;">− ${escapeHtml(p)}</div>`).join('')}</div>` : ''}
        </div>
    `;
}

function renderRegSdks(sd) {
    const empty = !sd.added.length && !sd.removed.length && !sd.versionChanges.length && !sd.engineChanged;
    if (empty) {
        return `<div class="card" style="margin-bottom: 16px;"><div style="font-size: 11px; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">SDKs</div><div style="font-size: 12px; color: var(--success);">✓ No SDK changes</div></div>`;
    }
    return `
        <div class="card" style="margin-bottom: 16px;">
            <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 10px;">SDKs (${sd.added.length} added · ${sd.removed.length} removed · ${sd.versionChanges.length} version-changed)</div>
            ${sd.engineChanged ? `<div style="padding: 8px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; margin-bottom: 10px;"><strong style="color: var(--danger);">⚠ Engine changed:</strong> <span style="font-family: 'JetBrains Mono', monospace; color: #fff;">${escapeHtml(sd.oldEngine || '')} → ${escapeHtml(sd.newEngine || '')}</span></div>` : ''}
            ${sd.added.length ? `<div style="margin-bottom: 8px;"><div style="font-size: 10px; color: var(--success); font-weight: 700; margin-bottom: 4px;">+ ADDED</div>${sd.added.map(s => `<div style="font-size: 11px; color: #86efac; padding: 2px 0;">+ ${escapeHtml(s.name)}${s.version ? ` <span style="color: #71717a;">v${escapeHtml(s.version)}</span>` : ''}${s.category ? ` <span style="color: #a78bfa;">[${escapeHtml(s.category)}]</span>` : ''}</div>`).join('')}</div>` : ''}
            ${sd.removed.length ? `<div style="margin-bottom: 8px;"><div style="font-size: 10px; color: #f87171; font-weight: 700; margin-bottom: 4px;">− REMOVED</div>${sd.removed.map(s => `<div style="font-size: 11px; color: #fca5a5; padding: 2px 0;">− ${escapeHtml(s.name)}${s.version ? ` <span style="color: #71717a;">v${escapeHtml(s.version)}</span>` : ''}</div>`).join('')}</div>` : ''}
            ${sd.versionChanges.length ? `<div><div style="font-size: 10px; color: var(--warning); font-weight: 700; margin-bottom: 4px;">≠ VERSION CHANGED</div>${sd.versionChanges.map(s => `<div style="font-size: 11px; color: #fde68a; padding: 2px 0;">${escapeHtml(s.name)}: <span style="color: #71717a;">${escapeHtml(s.oldVersion)}</span> → <span style="color: #fff;">${escapeHtml(s.newVersion)}</span></div>`).join('')}</div>` : ''}
        </div>
    `;
}

function renderRegManifest(md, sec) {
    const flagsHtml = (md.flags || []).map(f => {
        const color = f.severity === 'HIGH' ? 'var(--danger)' : 'var(--success)';
        return `<div style="padding: 8px; background: ${f.severity === 'HIGH' ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)'}; border-radius: 6px; margin-bottom: 6px;">
            <div style="font-size: 11px; color: ${color}; font-weight: 700;">${escapeHtml(f.key)}: ${escapeHtml(String(f.oldValue))} → ${escapeHtml(String(f.newValue))}</div>
            <div style="font-size: 10px; color: #a1a1aa; margin-top: 2px;">${escapeHtml(f.note)}</div>
        </div>`;
    }).join('');
    const exportsHtml = (md.addedExports?.length || md.removedExports?.length) ? `
        <div style="margin-top: 10px;">
            <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px;">Exported Components</div>
            ${(md.addedExports || []).map(e => `<div style="font-size: 10px; color: #86efac; font-family: 'JetBrains Mono', monospace;">+ ${escapeHtml(e)}</div>`).join('')}
            ${(md.removedExports || []).map(e => `<div style="font-size: 10px; color: #fca5a5; font-family: 'JetBrains Mono', monospace;">− ${escapeHtml(e)}</div>`).join('')}
        </div>
    ` : '';
    const secColor = sec.direction === 'WORSENED' ? 'var(--danger)' : sec.direction === 'IMPROVED' ? 'var(--success)' : '#71717a';
    if (!flagsHtml && !exportsHtml && sec.direction === 'UNCHANGED') {
        return `<div class="card" style="margin-bottom: 16px;"><div style="font-size: 11px; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">Manifest & Security</div><div style="font-size: 12px; color: var(--success);">✓ No manifest or risk-level changes</div></div>`;
    }
    return `
        <div class="card" style="margin-bottom: 16px;">
            <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 10px;">Manifest & Security</div>
            <div style="font-size: 11px; color: ${secColor}; margin-bottom: 10px;">Risk level: ${escapeHtml(sec.oldRisk)} → ${escapeHtml(sec.newRisk)} (${escapeHtml(sec.direction)})</div>
            ${flagsHtml}
            ${exportsHtml}
        </div>
    `;
}

function renderRegPerformance(pd) {
    if (!pd) return '';
    if (!pd.available) {
        return `<div class="card" style="margin-bottom: 16px;"><div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px;">Performance Delta</div><div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(pd.reason || 'Unavailable')} — run a Test Session on each version to enable this comparison.</div></div>`;
    }
    const fmt = (v, suffix = '') => v == null ? '—' : (typeof v === 'number' ? v.toFixed(1) + suffix : v + suffix);
    const o = pd.old || {};
    const n = pd.new || {};
    return `
        <div class="card" style="margin-bottom: 16px;">
            <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 10px;">Performance Delta (from session history)</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                <thead>
                    <tr style="background: rgba(255,255,255,0.03);">
                        <th style="padding: 6px; text-align: left; color: #a1a1aa; font-size: 9px; text-transform: uppercase;">Metric</th>
                        <th style="padding: 6px; text-align: right; color: #a1a1aa; font-size: 9px; text-transform: uppercase;">Old</th>
                        <th style="padding: 6px; text-align: right; color: #a1a1aa; font-size: 9px; text-transform: uppercase;">New</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td style="padding: 6px; color: #d4d4d8;">Avg FPS</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(o.avgFps)}</td><td style="padding: 6px; text-align: right; color: ${typeof n.avgFps === 'number' && typeof o.avgFps === 'number' && n.avgFps < o.avgFps - 3 ? 'var(--danger)' : '#fff'};">${fmt(n.avgFps)}</td></tr>
                    <tr><td style="padding: 6px; color: #d4d4d8;">Min FPS</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(o.minFps)}</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(n.minFps)}</td></tr>
                    <tr><td style="padding: 6px; color: #d4d4d8;">Avg Memory (MB)</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(o.avgMemoryMb)}</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(n.avgMemoryMb)}</td></tr>
                    <tr><td style="padding: 6px; color: #d4d4d8;">Peak Memory (MB)</td><td style="padding: 6px; text-align: right; color: #fff;">${fmt(o.peakMemoryMb)}</td><td style="padding: 6px; text-align: right; color: ${typeof n.peakMemoryMb === 'number' && typeof o.peakMemoryMb === 'number' && n.peakMemoryMb > o.peakMemoryMb + 30 ? 'var(--danger)' : '#fff'};">${fmt(n.peakMemoryMb)}</td></tr>
                    <tr><td style="padding: 6px; color: #d4d4d8;">Crashes</td><td style="padding: 6px; text-align: right; color: #fff;">${o.crashes ?? 0}</td><td style="padding: 6px; text-align: right; color: ${(n.crashes || 0) > (o.crashes || 0) ? 'var(--danger)' : '#fff'};">${n.crashes ?? 0}</td></tr>
                    <tr><td style="padding: 6px; color: #d4d4d8;">ANRs</td><td style="padding: 6px; text-align: right; color: #fff;">${o.anrs ?? 0}</td><td style="padding: 6px; text-align: right; color: ${(n.anrs || 0) > (o.anrs || 0) ? 'var(--danger)' : '#fff'};">${n.anrs ?? 0}</td></tr>
                </tbody>
            </table>
            ${pd.issues?.length ? `<div style="margin-top: 10px; padding: 8px; background: rgba(245,158,11,0.06); border-radius: 6px;">${pd.issues.map(i => `<div style="font-size: 11px; color: #fde68a; padding: 2px 0;">⚠ ${escapeHtml(i)}</div>`).join('')}</div>` : ''}
        </div>
    `;
}


// ─── QA CHECKLIST ────────────────────────────────────────────────────────────
// Manual checklist (20 sections / 111 items). State persists per-project via IPC
// to projects/<name>/qa-checklist.json. The static structure (header, stat cards,
// toolbar, overall progress bar) lives in index.html under #tab-qa-checklist.
// This module fills #qa-sections and reacts to UI events.

const QA = {
    sections: [],
    state: {},
    lastProject: null,
    bound: false,
    search: '',
    filterSection: '',
    filterStatus: '',
    mode: 'automated',          // 'automated' | 'manual' — defaults to automated since the tool runs that itself
    autoPollInterval: null      // setInterval handle for automated polling
};

async function renderQAChecklist() {
    const empty   = document.getElementById('qa-empty-project');
    const content = document.getElementById('qa-content');
    if (!activeProject) {
        empty?.classList.remove('hidden');
        content?.classList.add('hidden');
        stopQAAutoPolling();
        return;
    }
    empty?.classList.add('hidden');
    content?.classList.remove('hidden');

    // Manual data: re-fetch on every entry so any external writes are reflected.
    const projectChanged = QA.lastProject !== activeProject;
    const data = await window.api.qaChecklistGet(activeProject);
    QA.sections = data.sections || [];
    QA.state    = data.state || {};
    QA.lastProject = activeProject;

    if (projectChanged) {
        populateSectionFilter();
    }

    renderQASections();
    updateQAStats();

    if (!QA.bound) {
        bindQAEvents();
        QA.bound = true;
    }

    // Apply current mode (UI state + polling).
    setQAMode(QA.mode);
}

function setQAMode(mode) {
    if (mode !== 'automated' && mode !== 'manual') return;
    QA.mode = mode;

    // Toggle button + pane visibility. Both are controlled here so the buttons
    // stay in sync even when the mode changes via something other than a click.
    document.querySelectorAll('.qa-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.qa-pane').forEach(p => {
        p.classList.toggle('active', p.dataset.pane === mode);
    });

    if (mode === 'automated') {
        refreshQAAutomated();
        startQAAutoPolling();
    } else {
        stopQAAutoPolling();
    }
}

// Polls getTestValidation() every 2 s while the Automated pane is active so
// runtime detections (crash, ANR, low FPS) appear without a manual refresh.
function startQAAutoPolling() {
    stopQAAutoPolling();
    QA.autoPollInterval = setInterval(refreshQAAutomated, 2000);
}
function stopQAAutoPolling() {
    if (QA.autoPollInterval) clearInterval(QA.autoPollInterval);
    QA.autoPollInterval = null;
}

async function refreshQAAutomated() {
    try {
        const data = await window.api.getTestValidation(selectedApkPath || null);
        renderQAAutoSummary(data);
        renderAutomatedSection(
            data.automated,
            'qa-auto-categories',
            `<p class="qa-auto-empty">Pick an APK in Test Session and (optionally) run a session — automated validation populates here.</p>`
        );
    } catch (e) {
        // Handler may not be ready on the first call after reload — ignore.
    }
}

function renderQAAutoSummary(data) {
    const s = data?.automated?.summary || { pass: 0, fail: 0, warn: 0 };
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('qa-auto-pass', `${s.pass} PASS`);
    set('qa-auto-warn', `${s.warn} WARN`);
    set('qa-auto-fail', `${s.fail} FAIL`);
    const stateText = data?.sessionRun
        ? 'Session recorded — runtime checks active'
        : (data?.apkAnalyzed ? 'APK analysed — start a session for runtime checks' : 'No APK selected');
    set('qa-auto-state', stateText);
}

function populateSectionFilter() {
    const sel = document.getElementById('qa-filter-section');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Sections</option>' +
        QA.sections.map(s =>
            `<option value="${s.id}">${escapeHtml(s.icon + ' ' + s.title)}</option>`
        ).join('');
    sel.value = current && QA.sections.some(s => s.id === current) ? current : '';
}

function qaItemStatus(itemId) {
    return QA.state[itemId]?.status || 'pending';
}

function qaSectionTotals(section) {
    let passed = 0, failed = 0;
    for (const it of section.items) {
        const s = qaItemStatus(it.id);
        if (s === 'pass') passed++;
        else if (s === 'fail') failed++;
    }
    return { passed, failed, total: section.items.length };
}

function qaOverallTotals() {
    let total = 0, passed = 0, failed = 0;
    for (const s of QA.sections) {
        total += s.items.length;
        for (const it of s.items) {
            const st = qaItemStatus(it.id);
            if (st === 'pass') passed++;
            else if (st === 'fail') failed++;
        }
    }
    const decided = passed + failed;
    const pending = Math.max(0, total - decided);
    const pct = total === 0 ? 0 : Math.round((decided / total) * 100);
    return { total, passed, failed, pending, pct };
}

// Items currently shown given search + filters. Used by Pass/Fail-All-Visible
// so those buttons act on what the user actually sees.
function qaVisibleItems() {
    const q = QA.search.toLowerCase();
    const out = [];
    for (const s of QA.sections) {
        if (QA.filterSection && s.id !== QA.filterSection) continue;
        for (const it of s.items) {
            const status = qaItemStatus(it.id);
            if (QA.filterStatus && status !== QA.filterStatus) continue;
            if (q && !it.label.toLowerCase().includes(q)) continue;
            out.push(it);
        }
    }
    return out;
}

function renderQASections() {
    const container = document.getElementById('qa-sections');
    if (!container) return;

    const q = QA.search.toLowerCase();
    const filtersActive = !!(QA.search || QA.filterSection || QA.filterStatus);
    let html = '';

    for (const section of QA.sections) {
        if (QA.filterSection && section.id !== QA.filterSection) continue;

        const totals = qaSectionTotals(section);
        const items = section.items.filter(it => {
            const status = qaItemStatus(it.id);
            if (QA.filterStatus && status !== QA.filterStatus) return false;
            if (q && !it.label.toLowerCase().includes(q)) return false;
            return true;
        });
        if (filtersActive && items.length === 0) continue;

        const allPassed = totals.passed === totals.total;
        const hasFailed = totals.failed > 0;
        const countClass = allPassed ? 'all-passed' : (hasFailed ? 'has-failed' : '');
        const sectionPct = totals.total === 0 ? 0
            : Math.round(((totals.passed + totals.failed) / totals.total) * 100);

        const itemsHtml = items.map(it => {
            const status = qaItemStatus(it.id);
            const passActive = status === 'pass' ? ' active' : '';
            const failActive = status === 'fail' ? ' active' : '';
            const pillLabel = status.toUpperCase();
            return `
                <div class="qa-item">
                    <div class="qa-item-actions">
                        <button class="qa-tick tick-pass${passActive}" data-action="pass" data-id="${it.id}" title="Mark Pass">✓</button>
                        <button class="qa-tick tick-fail${failActive}" data-action="fail" data-id="${it.id}" title="Mark Fail">✗</button>
                    </div>
                    <div class="qa-item-label">${escapeHtml(it.label)}</div>
                    <span class="qa-status-pill ${status}">${pillLabel}</span>
                </div>`;
        }).join('');

        html += `
            <div class="qa-section" data-section="${section.id}">
                <div class="qa-section-header">
                    <span class="qa-section-icon">${section.icon}</span>
                    <h3 class="qa-section-title">${escapeHtml(section.title)}</h3>
                    <span class="qa-section-count ${countClass}">${totals.passed}/${totals.total} passed</span>
                    <div class="qa-section-spacer"></div>
                    <div class="qa-section-mini-track"><div class="qa-section-mini-fill" style="width: ${sectionPct}%"></div></div>
                    <span class="qa-section-pct">${sectionPct}%</span>
                    <button class="qa-section-pass-all" data-section="${section.id}">pass all</button>
                </div>
                ${itemsHtml}
            </div>`;
    }

    container.innerHTML = html || `<div class="qa-no-results">No tests match the current filters.</div>`;
}

function updateQAStats() {
    const t = qaOverallTotals();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('qa-stat-total',   t.total);
    set('qa-stat-passed',  t.passed);
    set('qa-stat-failed',  t.failed);
    set('qa-stat-pending', t.pending);
    set('qa-stat-progress', t.pct + '%');
    set('qa-stat-progress-sub', `${t.passed + t.failed} of ${t.total}`);
    set('qa-overall-pct', t.pct + '%');
    const fill = document.getElementById('qa-overall-fill');
    if (fill) fill.style.width = t.pct + '%';
}

function bindQAEvents() {
    const root = document.getElementById('tab-qa-checklist');
    if (!root) return;

    // Mode toggle (Automated | Manual). Delegated so re-renders don't drop bindings.
    root.addEventListener('click', (e) => {
        const modeBtn = e.target.closest('.qa-mode-btn');
        if (modeBtn && modeBtn.dataset.mode) {
            setQAMode(modeBtn.dataset.mode);
        }
    });

    root.addEventListener('input', (e) => {
        if (e.target.id === 'qa-search') {
            QA.search = e.target.value;
            renderQASections();
        }
    });
    root.addEventListener('change', (e) => {
        if (e.target.id === 'qa-filter-section') {
            QA.filterSection = e.target.value;
            renderQASections();
        } else if (e.target.id === 'qa-filter-status') {
            QA.filterStatus = e.target.value;
            renderQASections();
        }
    });

    // Item ticks + per-section "pass all". Single delegated listener so the
    // dynamic re-renders inside #qa-sections don't drop event bindings.
    root.addEventListener('click', async (e) => {
        const tick = e.target.closest('.qa-tick');
        if (tick) {
            const id = tick.dataset.id;
            const action = tick.dataset.action;
            const current = qaItemStatus(id);
            const next = current === action ? 'pending' : action;
            await applyQAStatus([id], next);
            return;
        }
        const passSection = e.target.closest('.qa-section-pass-all');
        if (passSection) {
            const sectionId = passSection.dataset.section;
            const section = QA.sections.find(s => s.id === sectionId);
            if (!section) return;
            await applyQAStatus(section.items.map(i => i.id), 'pass');
            return;
        }
    });

    document.getElementById('qa-pass-all-visible')?.addEventListener('click', async () => {
        const ids = qaVisibleItems().map(i => i.id);
        if (!ids.length) return;
        await applyQAStatus(ids, 'pass');
    });
    document.getElementById('qa-fail-all-visible')?.addEventListener('click', async () => {
        const ids = qaVisibleItems().map(i => i.id);
        if (!ids.length) return;
        await applyQAStatus(ids, 'fail');
    });
    document.getElementById('qa-reset')?.addEventListener('click', async () => {
        if (!confirm('Reset all checklist statuses to PENDING?')) return;
        const res = await window.api.qaChecklistReset(activeProject);
        if (res?.success) {
            QA.state = {};
            renderQASections();
            updateQAStats();
        }
    });
    document.getElementById('qa-export')?.addEventListener('click', async () => {
        const res = await window.api.qaChecklistExport(activeProject);
        if (res?.success) {
            addLog(`✓ QA checklist exported to ${res.filePath}`, 'success');
        } else if (res?.message && !/cancelled/i.test(res.message)) {
            addLog(`❌ Export failed: ${res.message}`, 'error');
        }
    });
}

async function applyQAStatus(itemIds, status) {
    if (!activeProject || !itemIds.length) return;
    // Optimistic update so the UI feels instant. If IPC fails we re-fetch.
    const ts = Date.now();
    for (const id of itemIds) {
        if (status === 'pending') {
            delete QA.state[id];
        } else {
            QA.state[id] = { status, notes: QA.state[id]?.notes || '', ts };
        }
    }
    renderQASections();
    updateQAStats();
    const res = itemIds.length === 1
        ? await window.api.qaChecklistSetItem(activeProject, itemIds[0], status)
        : await window.api.qaChecklistBulkSet(activeProject, itemIds, status);
    if (!res?.success) {
        const data = await window.api.qaChecklistGet(activeProject);
        QA.state = data.state || {};
        renderQASections();
        updateQAStats();
    }
}
