/**
 * Report Generator Utility
 * Converts log analysis results into a structured QA report,
 * now including TestMate SDK gameplay events mapped to the checklist.
 */

const logger      = require('../utils/logger');
const bugReporter = require('./bugReporter');
const insightEngine = require('./insightEngine');


// ── SDK event → QA checklist mapping ─────────────────────────────────────────
/**
 * Maps SDK event names to human-readable QA checklist labels.
 */
const SDK_EVENT_QA_MAP = {
    LEVEL_START:    { label: 'Level Progression — Start',    status: 'PASS' },
    LEVEL_COMPLETE: { label: 'Level Progression — Complete', status: 'PASS' },
    PLAYER_DIED:    { label: 'Gameplay — Death Detected',    status: 'INFO' },
    BUTTON_CLICK:   { label: 'UI Interaction — Button',      status: 'PASS' },
    SCENE_LOADED:   { label: 'Lifecycle — Scene Loaded',     status: 'PASS' },
    REWARD_GIVEN:   { label: 'Economy — Reward Delivered',   status: 'PASS' },
    AD_STARTED:     { label: 'Monetisation — Ad Started',    status: 'PASS' },
    AD_COMPLETED:   { label: 'Monetisation — Ad Completed',  status: 'PASS' },
    SESSION_START:  { label: 'SDK — Session Initialised',    status: 'PASS' },
    SESSION_END:    { label: 'SDK — Session Ended',          status: 'PASS' }
};

/**
 * Builds the SDK checklist from detected event names.
 * @param {string[]} eventNames
 * @returns {Array<{ label, status, count }>}
 */
function buildSdkChecklist(eventNames, eventCounts) {
    if (!eventNames || eventNames.length === 0) return [];
    return eventNames.map(name => {
        const mapping = SDK_EVENT_QA_MAP[name] || { label: `SDK — ${name}`, status: 'INFO' };
        return {
            ...mapping,
            event: name,
            count: eventCounts[name] || 0
        };
    });
}

// ── Main generator ────────────────────────────────────────────────────────────
/**
 * Generates a QA report from log analysis results.
 * @param {Object}  analysis         Output from logAnalyzer.
 * @param {boolean} launchSuccessful Whether the app launch was successful.
 * @param {number}  duration         Session duration in seconds.
 * @param {Object}  performanceData  Data from performanceMonitor.
 * @param {Object}  uiAnalysis       Result from uiAnalyzer.
 * @returns {Object} Report data for UI and storage.
 */
const generateReport = (analysis, launchSuccessful, duration, performanceData = null, uiAnalysis = null, advancedAuditData = null, apkInfo = null) => {
    console.log('\n📊 QA REPORT');
    console.log('-------------------------');

    let performance = { status: 'Stable', memory: [], cpu: [], peakMemory: 0, avgCPU: 0, fpsDrops: 0, issues: [] };
    if (performanceData) {
        const perfMonitor = require('../adb/performanceMonitor');
        const perfAnalysis = perfMonitor.getAnalysis();
        performance = {
            status:     perfAnalysis.status,
            memory:     performanceData.memory,
            cpu:        performanceData.cpu,
            peakMemory: perfAnalysis.peakMemory,
            avgCPU:     perfAnalysis.avgCPU,
            fpsDrops:   performanceData.fpsDrops,
            issues:     perfAnalysis.issues
        };
    }

    // ── Core Checklist ────────────────────────────────────────────────────
    const sdkEvents   = analysis.sdkEventNames  || [];
    const sdkCounts   = analysis.sdkEventCounts || {};
    const hasSdk      = sdkEvents.length > 0;

    const progressionPASS = sdkEvents.includes('LEVEL_COMPLETE');

    const getSdkStatus = (passCondition) => {
        if (!hasSdk) return 'NOT TESTED';
        if (passCondition) return 'PASS';
        return 'WARNING';
    };

    const checklist = {
        installation:  launchSuccessful ? 'PASS' : 'FAIL',
        crash:         analysis.crashDetected ? 'FAIL' : 'PASS',
        anr:           analysis.anrDetected   ? 'FAIL' : 'PASS',
        lifecycle:     analysis.lifecycleResumed ? 'PASS' : 'WARNING',
        error:         analysis.errorCount > 0 ? 'WARNING' : 'PASS'
    };

    const metrics = {
        errorCount: analysis.errorCount,
        crashCount: analysis.crashCount,
        anrCount:   analysis.anrCount,
        sdkEventTotal: sdkEvents.reduce((sum, name) => sum + (sdkCounts[name] || 0), 0)
    };



    // ── Summary ───────────────────────────────────────────────────────────
    let summary = '';
    if (checklist.crash === 'FAIL' || checklist.anr === 'FAIL') {
        summary = 'Critical failures detected. Action required.';
    } else if (checklist.installation === 'FAIL') {
        summary = 'App failed to launch correctly.';
    } else if (checklist.error === 'WARNING') {
        summary = 'App is functional but instability was detected in logs.';
    } else if (hasSdk && progressionPASS) {
        summary = 'App passed core stability and gameplay progression tests.';
    } else {
        summary = 'App passed core stability tests.';
    }

    // ── Bug reports ───────────────────────────────────────────────────────
    const bugReports = bugReporter.generateBugReports(analysis.issues);

    // ── SDK checklist entries ─────────────────────────────────────────────
    const sdkChecklist = buildSdkChecklist(sdkEvents, sdkCounts);

    const reportData = {
        duration,
        checklist,
        results:      checklist,
        metrics,
        performance,
        issues:       analysis.issues || [],
        bugReports,
        summary,
        timestamp:    new Date().toISOString(),
        sdkEnabled:   hasSdk,
        events:       sdkEvents,
        sdkCounts,
        sdkChecklist,
        uiEvaluation: uiAnalysis,
        advancedInsights: advancedAuditData || {
            network: { history: [], lastStatus: "OFF" },
            memory: { peakMemory: 0, idleMemory: 0, ratio: 0 }
        },
        apkInfo: {
            packageName: apkInfo?.packageName || "N/A",
            versionName: apkInfo?.versionName || "N/A",
            versionCode: apkInfo?.versionCode || "N/A",
            minSdk: apkInfo?.minSdk || "N/A",
            targetSdk: apkInfo?.targetSdk || "N/A",
            permissions: apkInfo?.permissions || [],
            exportedComponents: apkInfo?.exportedComponents || apkInfo?.security?.exportedComponents || [],
            security: apkInfo?.security || null,
            sdkIntelligence: apkInfo?.sdkIntelligence || null,
            sdkInfo: {
                engine: (advancedAuditData?.runtime?.hasRuntimeData && advancedAuditData.runtime.engine !== "Native") ? 
                        `${advancedAuditData.runtime.engine} (Runtime)` : (apkInfo?.sdkInfo?.engine || "Unknown"),
                firebase: advancedAuditData?.runtime?.firebaseDetected || (apkInfo?.sdkInfo?.firebase || false),
                ads: advancedAuditData?.runtime?.adsDetected || (apkInfo?.sdkInfo?.ads || false)
            }
        },
        runtimeIntelligence: advancedAuditData?.runtime || null,

    };

    reportData.aiInsights = insightEngine.generateInsights(reportData);
    return reportData;
};

module.exports = { generateReport };
