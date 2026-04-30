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
    report: null,
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
const logsContainer = document.getElementById('status-logs');
const liveDashboard = document.getElementById('live-dashboard');
const liveFps = document.getElementById('live-fps');
const liveNetwork = document.getElementById('live-network');
const liveDevice = document.getElementById('live-device');
const liveFpsCtx = document.getElementById('live-fps-chart');
const liveIssuesPanel = document.getElementById('live-issues-panel');
const liveIssuesList = document.getElementById('live-issues-list');
const clearLogsBtn = document.getElementById('clear-logs-btn');
const reportContainer = document.getElementById('report-container');
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
const runtimeAds = document.getElementById('runtime-ads-badge');
const runtimeFirebase = document.getElementById('runtime-firebase-badge');
const runtimePermissions = document.getElementById('runtime-permissions-list');
const runtimeResponseTime = document.getElementById('runtime-response-time');
const runtimeUiStress = document.getElementById('runtime-ui-stress');

const runtimeAvgPing = document.getElementById('runtime-avg-ping');
const runtimeDataUsed = document.getElementById('runtime-data-used');
const runtimeDisconnects = document.getElementById('runtime-disconnects');
const runtimeNetworkStatus = document.getElementById('runtime-network-status');

const allPermissionsList = document.getElementById('all-permissions-list');

const reportEmptyState = document.getElementById('report-empty-state');
const eventsContent = document.getElementById('events-content');
const eventsEmptyState = document.getElementById('events-empty-state');
const navReport = document.getElementById('nav-report');

const securityRiskLevel = document.getElementById('security-risk-level');
const dangerousPermissionsList = document.getElementById('dangerous-permissions-list');
const privacyPermissionsList = document.getElementById('privacy-permissions-list');
const exportedComponentsList = document.getElementById('exported-components-list');
const securityDebugStatus = document.getElementById('security-debug-status');
const securityBackupStatus = document.getElementById('security-backup-status');
const securityCleartextStatus = document.getElementById('security-cleartext-status');

// ─── AI SETTINGS ─────────────────────────────────────────────────────────────
const aiApiKeyInput   = document.getElementById('ai-api-key-input');
const aiSaveBtn       = document.getElementById('ai-save-btn');
const aiStatusBadge   = document.getElementById('ai-status-badge');
const aiStatusMsg     = document.getElementById('ai-status-msg');

function updateAIStatusBadge(hasKey) {
    if (!aiStatusBadge) return;
    if (hasKey) {
        aiStatusBadge.textContent = 'ENABLED';
        aiStatusBadge.style.background = 'rgba(74,222,128,0.12)';
        aiStatusBadge.style.color = '#4ade80';
    } else {
        aiStatusBadge.textContent = 'DISABLED';
        aiStatusBadge.style.background = 'rgba(63,63,70,0.6)';
        aiStatusBadge.style.color = '#71717a';
    }
}

(async () => {
    try {
        const settings = await window.api.getSettings();
        if (settings && settings.geminiApiKey) {
            if (aiApiKeyInput) aiApiKeyInput.value = settings.geminiApiKey;
            updateAIStatusBadge(true);
        }
    } catch (e) {}
})();

if (aiSaveBtn) {
    aiSaveBtn.addEventListener('click', async () => {
        const key = aiApiKeyInput ? aiApiKeyInput.value.trim() : '';
        const res = await window.api.saveSettings({ geminiApiKey: key });
        if (res && res.success) {
            updateAIStatusBadge(!!key);
            if (aiStatusMsg) {
                aiStatusMsg.style.display = '';
                aiStatusMsg.textContent = key ? '✔ API key saved. AI classification is active.' : 'API key cleared.';
                aiStatusMsg.style.color = key ? '#4ade80' : '#a1a1aa';
                setTimeout(() => { if (aiStatusMsg) aiStatusMsg.style.display = 'none'; }, 3000);
            }
        }
    });
}

// ─── PROXY STATUS (PHASE 3) ──────────────────────────────────────────────────
const proxyStatusBadge    = document.getElementById('proxy-status-badge');
const proxyInterceptInfo  = document.getElementById('proxy-intercepted-info');
const proxyInterceptCount = document.getElementById('proxy-intercept-count');
const proxyCertHint       = document.getElementById('proxy-cert-hint');
const installCertBtn      = document.getElementById('install-cert-btn');

function updateProxyUI(status) {
    if (!proxyStatusBadge) return;
    if (status && status.active) {
        proxyStatusBadge.textContent = 'ACTIVE';
        proxyStatusBadge.style.background = 'rgba(45,212,191,0.15)';
        proxyStatusBadge.style.color = '#2dd4bf';
        if (proxyInterceptInfo) proxyInterceptInfo.style.display = '';
        if (proxyInterceptCount) proxyInterceptCount.textContent = status.intercepted || 0;
        if (proxyCertHint) proxyCertHint.style.display = status.certExists ? 'none' : '';
    } else {
        proxyStatusBadge.textContent = 'INACTIVE';
        proxyStatusBadge.style.background = 'rgba(63,63,70,0.6)';
        proxyStatusBadge.style.color = '#71717a';
        if (proxyInterceptInfo) proxyInterceptInfo.style.display = 'none';
        if (status && status.lastError) {
            if (proxyCertHint) {
                proxyCertHint.style.display = '';
                proxyCertHint.textContent = `⚠ Proxy error: ${status.lastError}`;
            }
            if (status.lastError !== _proxyLastError) {
                _proxyLastError = status.lastError;
                addLog(`⚠ MITM Proxy inactive: ${status.lastError}`, 'warn');
            }
        }
    }
}

// Poll proxy status every 4 seconds when session is running
let _proxyPollInterval = null;
let _proxyLastError = null;
function startProxyPoll() {
    if (_proxyPollInterval) return;
    // Check once after 1.5s to show proxy status right after session starts
    setTimeout(async () => {
        try {
            const s = await window.api.getProxyStatus();
            updateProxyUI(s);
        } catch {}
    }, 1500);
    _proxyPollInterval = setInterval(async () => {
        try {
            const s = await window.api.getProxyStatus();
            updateProxyUI(s);
            if (proxyInterceptCount && s) proxyInterceptCount.textContent = s.intercepted || 0;
        } catch {}
    }, 4000);
}
function stopProxyPoll() {
    if (_proxyPollInterval) { clearInterval(_proxyPollInterval); _proxyPollInterval = null; }
    _proxyLastError = null;
    updateProxyUI({ active: false });
}

function showCertInstallGuide() {
    const guide = document.getElementById('cert-install-guide');
    if (guide) { guide.style.display = ''; return; }

    // Create the guide div dynamically and insert after the proxy card
    const card = document.getElementById('proxy-status-card');
    if (!card) return;
    const div = document.createElement('div');
    div.id = 'cert-install-guide';
    div.style.cssText = 'margin-bottom:12px;padding:10px 16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;font-size:11px;color:#d4a017;line-height:1.7;';
    div.innerHTML =
        '<b>📱 Cert saved to device Internal Storage → testmate-ca.crt</b><br>' +
        'Install it as a CA certificate:<br>' +
        '<b>Samsung:</b> Settings → Biometrics &amp; Security → Other Security Settings → Install from Device Storage<br>' +
        '<b>Pixel / Stock Android:</b> Settings → Security → Encryption &amp; Credentials → Install a Certificate → CA Certificate<br>' +
        '<b>Xiaomi / MIUI:</b> Settings → Privacy → Encryption &amp; Credentials → Install a Certificate<br>' +
        '<small style="color:#a16207">Select <em>testmate-ca.crt</em> from Internal Storage and name it "TestMate AI"</small>';
    card.insertAdjacentElement('afterend', div);
}

if (installCertBtn) {
    installCertBtn.addEventListener('click', async () => {
        installCertBtn.disabled = true;
        installCertBtn.textContent = 'Installing…';
        try {
            const res = await window.api.installCACert();
            if (res.success) {
                if (res.result === 'installed') {
                    installCertBtn.textContent = '✔ Installed';
                    if (proxyCertHint) proxyCertHint.style.display = 'none';
                } else {
                    installCertBtn.textContent = '✔ Cert Pushed';
                    showCertInstallGuide();
                }
            } else {
                installCertBtn.textContent = 'Failed';
                addLog(`❌ CA cert install failed: ${res.message}`, 'error');
            }
        } catch { installCertBtn.textContent = 'Error'; }
        setTimeout(() => { installCertBtn.textContent = 'Install CA Cert'; installCertBtn.disabled = false; }, 4000);
    });
}

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

    if (tabId === 'report') {
        console.log("Report Data State:", currentSession.report);
        if (currentSession.report) {
            reportContainer.innerHTML = '';
            renderReport(currentSession.report, reportContainer);
            reportContainer.classList.remove('hidden');
            reportEmptyState.classList.add('hidden');
        } else {
            reportContainer.classList.add('hidden');
            reportEmptyState.classList.remove('hidden');
        }
    }

    if (tabId === 'history' && activeProject) loadHistory();

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
    const confirmed = confirm(`Are you sure you want to delete project "${activeProject}"? This will permanently remove all sessions and reports.`);
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
    if (file?.name.endsWith('.apk')) {
        setApk(file.path, file.name);
    } else {
        addLog('❌ Please drop a valid .apk file', 'error');
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

    apkInfoPkg.textContent = info.packageName || 'Unknown';
    apkInfoVer.textContent = `${info.versionName || 'N/A'} (Build ${info.versionCode || 'N/A'})`;
    apkInfoMin.textContent = info.minSdk || 'N/A';
    apkInfoTarget.textContent = info.targetSdk || 'N/A';

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

    staticContent.classList.remove('hidden');
    staticEmptyState.classList.add('hidden');
}

function updateSessionState(newState) {
    sessionState = newState;

    // Toggle button visibility
    if (sessionState === 'idle') {
        startBtn.classList.remove('hidden');
        runningControls.classList.add('hidden');
        reportBtn.classList.add('hidden');
        startBtn.disabled = !selectedApkPath; // Keep disabled if no APK
        stopTimer();
    } else if (sessionState === 'running') {
        startBtn.classList.add('hidden');
        runningControls.classList.remove('hidden');
        stopBtn.disabled = false;
        stopBtn.textContent = '■ Stop Test';
        reportBtn.classList.add('hidden');
        startTimer();
    } else if (sessionState === 'stopped') {
        startBtn.classList.remove('hidden');
        startBtn.disabled = !selectedApkPath;
        runningControls.classList.add('hidden');
        reportBtn.classList.add('hidden');
        stopTimer();
    }
}

function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    sessionTimer.textContent = '00:00';
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
        const secs = (secondsElapsed % 60).toString().padStart(2, '0');
        sessionTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
}

// ─── SESSION CONTROL ─────────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
    if (!selectedApkPath) return;
    addLog(`🚀 Starting QA session for: ${fileNameDisplay.textContent}`, 'info');
    startBtn.disabled = true;
    reportContainer.classList.add('hidden');
    liveDashboard.classList.remove('hidden');
    liveIssuesPanel.classList.add('hidden');
    liveFps.textContent = '--';
    liveNetwork.textContent = '--';
    liveDevice.textContent = '--';
    if (livePing) livePing.textContent = '-- ms';
    const _battLive = document.getElementById('status-battery-live');
    if (_battLive) _battLive.textContent = '--%';
    // Reset FPS tracker for new session
    window._fpsTracker = null;
    const _fpsResetEls = ['fps-min', 'fps-avg', 'fps-peak'];
    _fpsResetEls.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '--'; });
    const _ql = document.getElementById('fps-quality-label');
    if (_ql) { _ql.textContent = 'WAITING'; _ql.style.color = '#52525b'; _ql.style.background = 'rgba(63,63,70,0.5)'; }
    const _bar = document.getElementById('fps-bar');
    if (_bar) _bar.style.width = '0%';
    const _dot = document.getElementById('fps-indicator-dot');
    if (_dot) { _dot.style.background = '#3f3f46'; _dot.style.boxShadow = 'none'; }
    initLiveChart();

    // Fetch device info once per session
    try {
        const deviceInfo = await window.api.getDeviceInfo();
        statusDeviceName.textContent = deviceInfo.model;
        statusAndroidVer.textContent = deviceInfo.androidVersion;
        statusBattery.textContent = deviceInfo.battery;
        statusConnected.textContent = deviceInfo.status;
        statusConnected.style.color = deviceInfo.status === 'Connected' ? '#2dd4bf' : '#f87171';
        deviceStatusBar.classList.remove('hidden');
    } catch (err) {
        console.error('Failed to fetch device info', err);
    }

    const res = await window.api.startTest(selectedApkPath);
    if (res.success) {
        addLog(res.message, 'success');
        updateSessionState('running');
        startProxyPoll();

        // Reset Global Session State
        currentSession.runtime = null;
        currentSession.report = null;

        // Reset Runtime UI
        renderRuntimeTab(null);

        // Reset Prediction Session
        if (window.DevicePrediction) window.DevicePrediction.resetSession();
    } else {
        addLog(res.message, 'error');
        updateSessionState('idle');
        deviceStatusBar.classList.add('hidden');
    }
});

stopBtn.addEventListener('click', async () => {
    addLog('ℹ Stopping session…', 'info');
    stopBtn.disabled = true;
    const originalText = stopBtn.textContent;
    stopBtn.textContent = 'Stopping…';

    // Stop timer immediately for better UX
    stopTimer();

    const res = await window.api.stopTest();
    stopBtn.textContent = originalText;
    stopProxyPoll();

    if (res.success) {
        addLog(res.message, 'success');
        updateSessionState('stopped');

        if (res.report) {
            currentSession.report = res.report;
            if (res.report.advancedInsights?.runtime) {
                currentSession.runtime = res.report.advancedInsights.runtime;
            }
            switchTab('report');
        }

        // Always refresh history so the new session appears immediately
        refreshHistory();
    } else {
        addLog(res.message, 'error');
        stopBtn.disabled = false;
    }
});

reportBtn.addEventListener('click', async () => {
    addLog('ℹ Generating QA report…', 'info');
    const res = await window.api.generateReport();
    if (res.success && res.report) {
        addLog(res.message, 'success');

        // Save to global state
        currentSession.report = res.report;
        if (res.report.advancedInsights?.runtime) {
            currentSession.runtime = res.report.advancedInsights.runtime;
        }

        console.log("Report Generated. Data Saved:", currentSession);
        switchTab('report');

        setTimeout(() => {
            refreshHistory();
        }, 800);
        updateSessionState('idle');
    } else {
        addLog(res.message || '❌ Report generation failed', 'error');
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
            const summary = getSummaryText(item);
            const failed = isSessionFailed(item);
            const warning = !failed && summary.toLowerCase().includes('instability');
            const dot = failed ? '🔴' : warning ? '🟡' : '🟢';
            const status = failed ? 'FAIL' : warning ? 'WARNING' : 'PASS';
            const apkName = item.apkName || item.packageName || 'Unknown APK';
            const dateTime = formatSessionDate(item.timestamp);

            const div = document.createElement('div');
            div.className = 'history-item';
            div.style.position = 'relative';
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h4>${dot} ${item.sessionId || `Session #${item.index}`}</h4>
                    <button class="delete-session-btn btn-xs ghost" title="Delete session" style="opacity: 0.5;">🗑</button>
                </div>
                <p style="margin-top: 4px; opacity: 0.8; font-size: 13px;">${dateTime}</p>
                <p style="margin-top: 4px; opacity: 0.8; font-size: 13px;">${apkName}</p>
                <div style="display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; align-items: center;">
                    <span class="metric" style="font-size: 10px; background: ${failed ? 'rgba(239,68,68,0.12)' : warning ? 'rgba(251,191,36,0.12)' : 'rgba(45,212,191,0.12)'}; color: ${failed ? '#fca5a5' : warning ? '#fde047' : '#2dd4bf'};">${status}</span>
                    <span style="font-size: 11px; color: #71717a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${summary || 'Report available'}</span>
                </div>
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

async function loadHistoryItem(sessionId, el) {
    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');

    historyDetail.innerHTML = '<p class="empty-state">Loading…</p>';
    const report = await window.api.getSessionReport(activeProject, sessionId);
    if (report) {
        historyDetail.innerHTML = '';
        renderReport(report, historyDetail);
    } else {
        historyDetail.innerHTML = '<p class="empty-state">Report not found.</p>';
    }
}

// ─── LIVE FPS CHART ───────────────────────────────────────────────────────────
let liveFpsChart = null;
let _fpsPointColors = [];
const FPS_WINDOW = 60;
const REF_LINE = Array(FPS_WINDOW).fill(null);

function initLiveChart() {
    if (liveFpsChart) liveFpsChart.destroy();
    _fpsPointColors = [];
    liveFpsChart = new Chart(liveFpsCtx, {
        type: 'line',
        data: {
            labels: Array(FPS_WINDOW).fill(''),
            datasets: [
                {
                    label: 'FPS',
                    data: Array(FPS_WINDOW).fill(null),
                    borderColor: '#2dd4bf',
                    backgroundColor: 'rgba(45,212,191,0.07)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0,
                    pointRadius: 2,
                    pointBackgroundColor: Array(FPS_WINDOW).fill('#2dd4bf'),
                    pointBorderWidth: 0,
                    spanGaps: false
                },
                {
                    label: '60fps',
                    data: Array(FPS_WINDOW).fill(60),
                    borderColor: 'rgba(45,212,191,0.2)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: '30fps',
                    data: Array(FPS_WINDOW).fill(30),
                    borderColor: 'rgba(248,113,113,0.3)',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { 
                duration: 400,
                easing: 'linear'
            },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    min: 0,
                    max: 120,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#71717a',
                        font: { size: 10 },
                        stepSize: 30,
                        callback: v => v === 0 ? '' : `${v}`
                    }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
    _fpsPointColors = Array(FPS_WINDOW).fill('#2dd4bf');
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

            if (!isNaN(fpsNum)) {
                // Color thresholds: smooth ≥55, playable ≥30, choppy <30
                const fpsColor  = fpsNum >= 55 ? '#2dd4bf' : fpsNum >= 30 ? '#fbbf24' : '#f87171';
                const fpsLabel  = fpsNum >= 55 ? 'SMOOTH'  : fpsNum >= 30 ? 'PLAYABLE' : 'CHOPPY';
                const fpsBarPct = Math.min(100, Math.round((fpsNum / 120) * 100));

                if (liveFps) { liveFps.style.color = fpsColor; liveFps.style.textShadow = `0 0 12px ${fpsColor}55`; }

                const dot = document.getElementById('fps-indicator-dot');
                if (dot) { dot.style.background = fpsColor; dot.style.boxShadow = `0 0 6px ${fpsColor}`; }

                const bar = document.getElementById('fps-bar');
                if (bar) { bar.style.width = `${fpsBarPct}%`; bar.style.background = fpsColor; }

                const ql = document.getElementById('fps-quality-label');
                if (ql) {
                    ql.textContent = fpsLabel;
                    ql.style.color = fpsColor;
                    ql.style.background = `${fpsColor}18`;
                }

                // Track min/avg/max across session
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
                    if (avgEl) { avgEl.textContent = avg; avgEl.style.color = avg >= 55 ? '#2dd4bf' : avg >= 30 ? '#fbbf24' : '#f87171'; }
                    if (peakEl) peakEl.textContent = t.max;
                }
            }

            liveNetwork.textContent = data.network;
            liveDevice.textContent = data.device;

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
                        ...data.advanced.runtime,
                        peakMemory: data.advanced.memory?.peakMemory || 0,
                        networkIntel: data.advanced.networkIntel
                    };

                    // Update UI immediately if tab is active
                    if (document.getElementById('tab-runtime').classList.contains('active')) {
                        renderRuntimeTab(currentSession.runtime);
                    }
                    if (document.getElementById('tab-events').classList.contains('active')) {
                        renderEventsTab(currentSession.runtime);
                    }
                }
            }

            // FPS chart — 60-second sliding window, per-point jank coloring
            if (liveFpsChart && !isNaN(fpsNum)) {
                const ptColor = fpsNum >= 55 ? '#2dd4bf' : fpsNum >= 30 ? '#fbbf24' : '#f87171';
                const ds = liveFpsChart.data.datasets[0];
                ds.data.push(fpsNum);
                ds.pointBackgroundColor.push(ptColor);
                liveFpsChart.data.labels.push('');
                if (ds.data.length > FPS_WINDOW) {
                    ds.data.shift();
                    ds.pointBackgroundColor.shift();
                    liveFpsChart.data.labels.shift();
                }
                liveFpsChart.update();
            }

            // Memory stat - removed from dashboard
            
            // CPU / Jank / FrameTime from advanced telemetry - removed from dashboard
            if (data.advanced) {
                // We keep the advanced insights data gathering but stop updating the removed UI elements
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

            // ─── DEVICE PREDICTION REAL-TIME UPDATE ───────────────────────
            if (window.DevicePrediction && data.fps !== '--') {
                const fpsNum = parseInt(data.fps);
                if (!isNaN(fpsNum)) {
                    const emptyState = document.getElementById('prediction-empty-state');
                    const contentState = document.getElementById('prediction-content');
                    if (emptyState) emptyState.classList.add('hidden');
                    if (contentState) contentState.classList.remove('hidden');

                    const deviceNameStr = (data.deviceName || data.device || 'Unknown Device');
                    const currentDeviceEl = document.getElementById('pred-current-device');
                    const currentFpsEl = document.getElementById('pred-current-fps');
                    const currentMemEl = document.getElementById('pred-current-mem');

                    if (currentDeviceEl) currentDeviceEl.textContent = deviceNameStr;
                    if (currentFpsEl) currentFpsEl.textContent = data.fps;
                    if (currentMemEl) currentMemEl.textContent = data.memory + ' MB';

                    const result = window.DevicePrediction.predictPerformance(fpsNum, deviceNameStr, parseInt(data.memory) || 512);
                    const { predictions, confidence, insights } = result;

                    const tbody = document.getElementById('prediction-table-body');
                    const confidenceBadge = document.getElementById('pred-confidence-badge');
                    const insightsList = document.getElementById('pred-insights-list');
                    const recsList = document.getElementById('pred-recommendations-list');

                    if (confidenceBadge) confidenceBadge.textContent = `Confidence: ${confidence}%`;

                    if (tbody) {
                        tbody.innerHTML = predictions.map(p => {
                            const badgeClass = p.riskLevel.includes('LOW') ? 'low' : (p.riskLevel.includes('MEDIUM') ? 'medium' : 'high');
                            return `
                                <tr>
                                    <td>
                                        <div style="font-weight: 500;">${p.name}</div>
                                        <div style="font-size: 10px; color: #71717a;">GPU: ${p.gpuName}</div>
                                    </td>
                                    <td>
                                        <div style="font-size: 11px; color: #d4d4d8;">${p.os} • ${p.cpuName}</div>
                                        <div style="font-size: 10px; color: #a1a1aa;">RAM: ${p.ram}GB • ${p.res}</div>
                                    </td>
                                    <td style="color: #38bdf8; font-weight: bold; font-family: 'JetBrains Mono', monospace;">${p.predictedFPS} FPS</td>
                                    <td style="color: #a1a1aa; font-family: 'JetBrains Mono';">${p.frameTime}ms</td>
                                    <td><span class="pred-badge ${badgeClass}">${p.verdict}</span></td>
                                </tr>
                            `;
                        }).join('');
                    }

                    if (insightsList) {
                        if (insights.length > 0) {
                            insightsList.innerHTML = insights.map(i => `
                                <div style="font-size: 13px; color: #e4e4e7; display: flex; align-items: flex-start; gap: 8px;">
                                    <span style="color: #2dd4bf;">•</span>
                                    <span>${i}</span>
                                </div>
                            `).join('');
                        } else {
                            insightsList.innerHTML = '<div style="color: #71717a; font-size: 13px;">Collecting more data for deep insights...</div>';
                        }
                    }

                    if (recsList) {
                        // Consolidate recommendations from all targets
                        const allRecs = [...new Set(predictions.flatMap(p => p.recommendations))];
                        if (allRecs.length > 0) {
                            recsList.innerHTML = allRecs.map(r => `
                                <div style="font-size: 13px; color: #e4e4e7; display: flex; align-items: flex-start; gap: 8px;">
                                    <span style="color: #a78bfa;">→</span>
                                    <span>${r}</span>
                                </div>
                            `).join('');
                        } else {
                            recsList.innerHTML = '<div style="color: #2dd4bf; font-size: 13px;">✔ No performance bottlenecks predicted for target hardware.</div>';
                        }
                    }
                }
            }
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
                const CAT_COLOR = { SYSTEM: '#71717a', FIREBASE: '#38bdf8', ADS: '#2dd4bf' };
                const CAT_BG    = { SYSTEM: 'rgba(113,113,122,0.1)', FIREBASE: 'rgba(56,189,248,0.1)', ADS: 'rgba(45,212,191,0.1)' };
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


    // Network Intelligence
    if (runtime.networkIntel) {
        if (runtimeAvgPing) runtimeAvgPing.textContent = `${runtime.networkIntel.ping || 0} ms`;
        if (runtimeDataUsed) runtimeDataUsed.textContent = `${runtime.networkIntel.dataUsedMB || 0} MB`;
        if (runtimeDisconnects) runtimeDisconnects.textContent = runtime.networkIntel.disconnects || 0;
        if (runtimeNetworkStatus) {
            const status = runtime.networkIntel.status || 'OFFLINE';
            runtimeNetworkStatus.textContent = status;
            runtimeNetworkStatus.style.color = status === 'ONLINE' ? '#2dd4bf' : '#fb7185';
        }
    }

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

    feed.innerHTML = visible.map((ev, idx) => {
        const cat      = ev.category || 'SYSTEM';
        const color    = EV_COLOR[cat] || '#a1a1aa';
        const bg       = EV_BG[cat]   || 'rgba(255,255,255,0.04)';
        const isAI     = ev.confidence === 'AI';
        const isNet    = ev.source === 'network' || ev.confidence === 'NETWORK';
        const evName   = String(ev.name || 'event').replace(/_/g, ' ');
        const aiBadge  = isAI  ? `<span class="ev-ai-badge">🤖 AI</span>`  : '';
        const netBadge = isNet ? `<span class="ev-net-badge">🌐 NET</span>` : '';
        const rowClass = isNet ? 'ev-row ev-row-net' : isAI ? 'ev-row ev-row-ai' : 'ev-row';
        const rawId    = `ev-raw-${idx}`;
        const rawText  = ev.raw
            ? escapeHtml(ev.raw)
            : isAI  ? escapeHtml(`AI classified: ${ev.detail || ''}`)
            : isNet ? escapeHtml(`Network → ${ev.detail || ''}`)
            : escapeHtml(ev.detail || '');
        return `<div class="${rowClass}" onclick="toggleEvRaw('${rawId}')" style="cursor:pointer;">
            <span class="ev-time-col">${ev.time}s</span>
            <span class="ev-cat-col" style="background:${bg};color:${color};">${escapeHtml(cat)}</span>
            <span class="ev-name-col">${escapeHtml(evName)}${aiBadge}${netBadge}</span>
            <span class="ev-detail-col">${escapeHtml(String(ev.detail || ''))}</span>
        </div>
        <div id="${rawId}" class="ev-raw-row" style="display:none;"><pre class="ev-raw-pre">${rawText}</pre></div>`;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
}

function toggleEvRaw(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function renderReport(report, container) {
    const { checklist, summary, metrics } = report;
    const summaryText = typeof summary === 'string'
        ? summary
        : (report.summaryText || `Crash: ${summary?.crash ? 'Yes' : 'No'} | ANR: ${summary?.anr ? 'Yes' : 'No'} | SDK: ${summary?.sdkStatus || 'Unknown'}`);

    const statusClass = s => {
        if (s === 'PASS') return 'text-success';
        if (s === 'WARNING' || s === 'NOT TESTED') return 'text-warning';
        if (s === 'N/A' || s === 'INFO') return '';
        return 'text-error';
    };
    const statusIcon = s => {
        if (s === 'PASS') return '✔';
        if (s === 'WARNING' || s === 'NOT TESTED') return '⚠';
        if (s === 'N/A') return '—';
        if (s === 'INFO') return 'ℹ';
        return '✖';
    };
    const perfClass = s => s === 'Stable' ? 'text-success' : s === 'Minor lag' ? 'text-warning' : 'text-error';

    const peakMem = report.performance?.memory?.length > 0
        ? Math.max(...report.performance.memory)
        : 0;

    // SDK event rows
    const sdkRows = (report.sdkChecklist || []).map(item => `
        <tr>
            <td><span class="sdk-badge">SDK</span> ${item.label}</td>
            <td class="${statusClass(item.status)}">${statusIcon(item.status)} ${item.status} <small style="color:#555">×${item.count}</small></td>
        </tr>`).join('');

    const sdkPanel = report.sdkEnabled ? `
        <div class="sdk-events-panel">
            <div class="sdk-events-header">⚡ TestMate SDK Events <span class="sdk-badge">LIVE</span></div>
            <div class="sdk-events-list">
                ${(report.events || []).map(name => `
                    <div class="sdk-event-chip">
                        <span class="sdk-event-name">${name}</span>
                        <span class="sdk-event-count">×${report.sdkCounts?.[name] ?? 0}</span>
                    </div>`).join('')}
            </div>
        </div>` : '';

    container.innerHTML = `
        <div class="report-header">📊 QA Evaluation Report</div>

        <div class="report-summary"><strong>Summary:</strong><br>${summaryText}</div>

        <div class="metrics-row">
            <div class="metric">Errors: ${metrics?.errorCount ?? 0}</div>
            <div class="metric">Crashes: ${metrics?.crashCount ?? 0}</div>
            <div class="metric">ANR: ${metrics?.anrCount ?? 0}</div>
            <div class="metric">Peak Mem: ${report.performance?.peakMemory ?? peakMem}MB</div>
            <div class="metric">Avg CPU: ${report.performance?.avgCPU ?? 0}%</div>
        </div>

        <div class="performance-section" style="margin-bottom: 20px;">
            <strong>Performance Status:</strong>
            <span class="${perfClass(report.performance?.status)}">${report.performance?.status ?? 'N/A'}</span>
        </div>

        ${report.network ? `
        <div class="report-header" style="margin-top: 20px;">🌐 Network Intelligence Report</div>
        <div class="card" style="background: rgba(232, 121, 249, 0.05); border: 1px solid rgba(232, 121, 249, 0.2); margin-bottom: 20px; padding: 15px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;">
                <span style="color: #a1a1aa; font-size: 13px;">Connectivity Status:</span>
                <span style="padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 11px; background: ${report.network.status === 'STABLE' ? '#10b981' : '#f43f5e'}; color: #fff;">
                    ${report.network.status}
                </span>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; text-align: center;">
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase;">Avg Ping</div>
                    <div style="font-size: 16px; font-weight: bold; color: #60a5fa;">${report.network.avgPing}ms</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase;">Data Used</div>
                    <div style="font-size: 16px; font-weight: bold; color: #e879f9;">${report.network.dataUsedMB}MB</div>
                </div>
                <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                    <div style="font-size: 10px; color: #a1a1aa; text-transform: uppercase;">Disconnects</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fb7185;">${report.network.disconnects}</div>
                </div>
            </div>
        </div>
        ` : ''}

        <table class="report-table">
            <thead><tr><th>Category</th><th>Result</th></tr></thead>
            <tbody>
                <tr><td>Installation & Launch</td><td class="${statusClass(checklist.installation)}">${statusIcon(checklist.installation)} ${checklist.installation}</td></tr>
                <tr><td>Crash Stability</td>      <td class="${statusClass(checklist.crash)}">${statusIcon(checklist.crash)} ${checklist.crash}</td></tr>
                <tr><td>ANR Handling</td>          <td class="${statusClass(checklist.anr)}">${statusIcon(checklist.anr)} ${checklist.anr}</td></tr>
                <tr><td>Lifecycle Events</td>      <td class="${statusClass(checklist.lifecycle)}">${statusIcon(checklist.lifecycle)} ${checklist.lifecycle}</td></tr>
                <tr><td>Error Stability</td>       <td class="${statusClass(checklist.error)}">${statusIcon(checklist.error)} ${checklist.error}</td></tr>
            </tbody>
        </table>

        ${sdkPanel}
        
        ${report.uiEvaluation ? `
            <div class="report-header" style="margin-top: 20px;">👁️ Visual Frame-by-Frame AI Analysis</div>
            <div class="card" style="background: rgba(45, 212, 191, 0.05); border: 1px solid rgba(45, 212, 191, 0.2); margin-bottom: 20px; padding: 15px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                    <span style="color: #a1a1aa;">UI Stability Score:</span>
                    <strong style="color: #2dd4bf;">${report.uiEvaluation.score}%</strong>
                </div>
                <div style="color: #d4d4d8; font-size: 13px; margin-bottom: 10px;">Analysed Frames: ${report.uiEvaluation.frameCount}</div>
                ${report.uiEvaluation.findings.length > 0 ? `
                    <div style="margin-top:10px;">
                        <div style="font-size: 11px; text-transform: uppercase; color: #a1a1aa; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px;">Visual Anomalies Detailed Root-Cause:</div>
                        ${report.uiEvaluation.findings.map(f => `
                            <div style="margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 2px solid #fca5a5;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <strong style="color: #fca5a5; font-size: 13px;">▶ ${f.type}</strong>
                                    <span style="font-size: 11px; color: #a1a1aa; font-family: 'JetBrains Mono';">${f.timestamp}</span>
                                </div>
                                <div style="font-size: 12px; color: #d4d4d8; margin-bottom: 6px;">${f.detail}</div>
                                <div style="display: flex; gap: 12px; font-size: 10px; text-transform: uppercase; color: #38bdf8;">
                                    <span>📍 Scene: ${f.scene}</span>
                                    <span>🎯 Region: ${f.location}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div style="color: #2dd4bf; font-size: 13px;">✔ No visual inconsistencies detected across frames.</div>'}
            </div>
        ` : ''}

        ${currentSession.runtime ? `
        <div class="report-header" style="margin-top: 20px;">🧠 Runtime Intelligence Summary</div>
        <div class="card" style="background: rgba(45, 212, 191, 0.05); border: 1px solid rgba(45, 212, 191, 0.2); margin-bottom: 20px; padding: 15px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; color: #a1a1aa; margin-bottom: 6px;">Verified Game Engine:</div>
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">${currentSession.runtime.engine || 'Native'}</div>
                </div>
                <div>
                    <div style="font-size: 11px; text-transform: uppercase; color: #a1a1aa; margin-bottom: 6px;">Traffic Metrics:</div>
                    <div style="font-size: 13px; color: #d4d4d8;">Intercepted Calls: <span style="color: #38bdf8; font-weight: bold;">${currentSession.runtime.networkCalls || 0}</span></div>
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05);">
                <span class="metric" style="background: ${currentSession.runtime.adsDetected ? 'rgba(234, 179, 8, 0.1)' : 'rgba(255,255,255,0.05)'}; color: ${currentSession.runtime.adsDetected ? '#eab308' : '#71717a'}; border: 1px solid rgba(255,255,255,0.1);">ADS: ${currentSession.runtime.adsDetected ? 'ACTIVE' : 'NOT SEEN'}</span>
                <span class="metric" style="background: ${currentSession.runtime.firebaseDetected ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255,255,255,0.05)'}; color: ${currentSession.runtime.firebaseDetected ? '#38bdf8' : '#71717a'}; border: 1px solid rgba(255,255,255,0.1);">FIREBASE: ${currentSession.runtime.firebaseDetected ? 'ACTIVE' : 'NOT SEEN'}</span>
            </div>

            ${currentSession.runtime.grantedPermissions && currentSession.runtime.grantedPermissions.length > 0 ? `
            <div style="margin-top: 15px;">
                <div style="font-size: 11px; text-transform: uppercase; color: #a1a1aa; margin-bottom: 8px;">Runtime Granted Permissions:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${currentSession.runtime.grantedPermissions.map(p => {
        const s = p.split('.').pop();
        return `<span style="font-size: 10px; color: #2dd4bf; background: rgba(45, 212, 191, 0.05); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(45, 212, 191, 0.1);">${s}</span>`;
    }).join('')}
                </div>
            </div>
            ` : ''}
        </div>
        ` : ''}

        ${report.advancedInsights ? `
            <div class="report-header" style="margin-top: 20px;">⚡ Advanced QA Intelligence Audit</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                <!-- Network Stats -->
                <div class="card" style="padding: 12px; background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2);">
                    <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 8px;">Network Stability</div>
                    <div style="font-size: 20px; font-weight: bold; color: #38bdf8;">${report.advancedInsights.network?.lastStatus || 'N/A'}</div>
                    <div style="font-size: 12px; color: #d4d4d8; margin-top: 4px;">Peak Latency: ${Math.max(...(report.advancedInsights.network?.history?.map(h => h.ping) || [0]))}ms</div>
                </div>
                <!-- Memory Audit -->
                <div class="card" style="padding: 12px; background: rgba(167, 139, 250, 0.05); border: 1px solid rgba(167, 139, 250, 0.2);">
                    <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 8px;">Memory Efficiency</div>
                    <div style="font-size: 20px; font-weight: bold; color: #a78bfa;">${report.advancedInsights.memory?.ratio || 0}x</div>
                    <div style="font-size: 12px; color: #d4d4d8; margin-top: 4px;">Peak: ${report.advancedInsights.memory?.peakMemory || 0}MB / Idle: ${report.advancedInsights.memory?.idleMemory || 0}MB</div>
                </div>
                <!-- Interaction Audit -->
                <div class="card" style="padding: 12px; background: rgba(244, 63, 94, 0.05); border: 1px solid rgba(244, 63, 94, 0.2);">
                    <div style="font-size: 11px; color: #a1a1aa; text-transform: uppercase; margin-bottom: 8px;">Interaction Flow</div>
                    <div style="font-size: 20px; font-weight: bold; color: #f43f5e;">${report.advancedInsights.interaction?.interactionStress || 'LOW'}</div>
                    <div style="font-size: 12px; color: #d4d4d8; margin-top: 4px;">Avg Response: ${report.advancedInsights.interaction?.responseTime || 0}ms</div>
                </div>
            </div>
            ${report.advancedInsights.memory?.leakDetected ? `
                <div style="padding: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 4px; color: #fca5a5; font-size: 13px; margin-bottom: 20px;">
                    ⚠️ <strong>Memory Leak Warning:</strong> Probable memory leak detected due to continuous growth trend.
                </div>
            ` : ''}
        ` : ''}
    `;
}

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
