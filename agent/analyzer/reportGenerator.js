/**
 * Report Generator Utility
 * Converts log analysis results into a structured QA report,
 * now including TestMate SDK gameplay events mapped to the checklist.
 */

const logger      = require('../utils/logger');
const bugReporter = require('./bugReporter');
const insightEngine = require('./insightEngine');

// ── QA Verdict ───────────────────────────────────────────────────────────────
// Single human-readable verdict for the whole session.
//   PRODUCTION_READY — automated checks all pass, manual checklist is ≥90% done with no failures
//   NEEDS_REVIEW     — only WARNs (no FAILs) and/or manual progress 60-89% with no failures
//   NEEDS_FIXES      — at least one automated FAIL or one manual FAIL (no critical-severity automated FAIL)
//   CRITICAL         — automated FAIL with severity CRITICAL or HIGH (crash, ANR, IAP not finalised, etc.)
function computeVerdict(auto, manual) {
    const autoSummary = auto?.summary || { pass: 0, fail: 0, warn: 0 };
    const autoItems = (auto?.categories || []).flatMap(c => c.items || []);
    const criticalAutoFail = autoItems.some(it =>
        it.status === 'FAIL' && (it.severity === 'CRITICAL' || it.severity === 'HIGH')
    );
    const manualFailed = manual?.totals?.failed || 0;
    const manualPct = manual?.totals?.progressPct || 0;

    if (criticalAutoFail) {
        return {
            code: 'CRITICAL',
            label: 'Critical Failures',
            color: '#ef4444',
            tagline: 'High-severity issues detected — do NOT ship until resolved.'
        };
    }
    if (autoSummary.fail > 0 || manualFailed > 0) {
        return {
            code: 'NEEDS_FIXES',
            label: 'Needs Fixes',
            color: '#f97316',
            tagline: `${autoSummary.fail + manualFailed} item(s) failed — review and fix before release.`
        };
    }
    if (autoSummary.warn > 0 || (manualPct > 0 && manualPct < 90)) {
        return {
            code: 'NEEDS_REVIEW',
            label: 'Needs Review',
            color: '#facc15',
            tagline: autoSummary.warn > 0
                ? `${autoSummary.warn} warning(s) — review evidence before sign-off.`
                : `Manual checklist ${manualPct}% complete — finish remaining items.`
        };
    }
    return {
        code: 'PRODUCTION_READY',
        label: 'Production Ready',
        color: '#22c55e',
        tagline: manualPct >= 90
            ? 'All automated checks pass and the QA checklist is signed off.'
            : 'All automated checks pass.'
    };
}

// Reshape the manual snapshot from qaChecklistManager.exportReport into the format
// the renderer expects: section-level totals + per-item status. The exported snapshot
// already has sections + items; we just compute per-section totals here so the UI
// can render progress bars without recomputing.
function shapeManualBlock(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sections)) {
        return { totals: { total: 0, passed: 0, failed: 0, pending: 0, progressPct: 0 }, sections: [] };
    }
    let total = 0, passed = 0, failed = 0;
    const sections = snapshot.sections.map(s => {
        let secPassed = 0, secFailed = 0;
        for (const it of s.items) {
            if (it.status === 'pass') secPassed++;
            else if (it.status === 'fail') secFailed++;
        }
        total  += s.items.length;
        passed += secPassed;
        failed += secFailed;
        const decided = secPassed + secFailed;
        const secPct = s.items.length === 0 ? 0 : Math.round((decided / s.items.length) * 100);
        return {
            id: s.id,
            title: s.title,
            icon: s.icon,
            totals: {
                passed: secPassed,
                failed: secFailed,
                pending: s.items.length - decided,
                total: s.items.length,
                progressPct: secPct
            },
            items: s.items
        };
    });
    const decidedAll = passed + failed;
    return {
        totals: {
            total, passed, failed,
            pending: total - decidedAll,
            progressPct: total === 0 ? 0 : Math.round((decidedAll / total) * 100)
        },
        sections
    };
}

// Plain-language paragraph any non-technical reader can parse. Used as the "Executive Summary"
// at the top of the report.
function buildExecutiveSummary(verdict, metrics, perf, manual, auto) {
    const fps = metrics.avgFPS || 0;
    const peakMem = perf.peakMemory || 0;
    const crashCount = metrics.crashCount || 0;
    const anrCount = metrics.anrCount || 0;
    const parts = [];

    parts.push(`Verdict: ${verdict.label}. ${verdict.tagline}`);

    if (fps > 0 || peakMem > 0) {
        const fpsWord = fps >= 55 ? 'smooth' : fps >= 30 ? 'acceptable' : 'choppy';
        parts.push(`Performance was ${fpsWord} (avg ${fps} FPS, peak memory ${peakMem} MB).`);
    }
    if (crashCount > 0 || anrCount > 0) {
        parts.push(`Stability: ${crashCount} crash(es), ${anrCount} ANR(s) recorded.`);
    } else {
        parts.push('Stability: no crashes or ANRs recorded.');
    }
    if (auto?.summary) {
        const s = auto.summary;
        parts.push(`Automated checks: ${s.pass} passed, ${s.warn} warning(s), ${s.fail} failed.`);
    }
    if (manual?.totals?.total > 0) {
        const t = manual.totals;
        parts.push(`Manual checklist: ${t.passed} passed, ${t.failed} failed, ${t.pending} pending out of ${t.total} (${t.progressPct}% complete).`);
    }
    return parts.join(' ');
}


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
const generateReport = (analysis, launchSuccessful, duration, performanceData = null, uiAnalysis = null, advancedAuditData = null, apkInfo = null, extras = {}) => {
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

        // Legacy field — kept for backwards compatibility with old session JSONs that
        // still read testValidation.{automated,manual}. New consumers should read
        // qaReport instead.
        testValidation: extras.testValidation || null
    };

    // ── QA Report — the structured, human-readable session verdict ────────
    // Built last so all upstream blocks are available. This is the new top-level
    // surface the History tab renders. Two distinct sections:
    //   automated — what the tool verified itself (preflight, runtime, SDK, IAP)
    //   manual    — what the tester ticked in the QA Checklist (20 sections, 111 items)
    const automatedBlock = extras.testValidation?.automated || { summary: { pass: 0, fail: 0, warn: 0, total: 0 }, categories: [] };
    const manualBlock = shapeManualBlock(extras.qaChecklistSnapshot);
    const verdict = computeVerdict(automatedBlock, manualBlock);
    const executiveSummary = buildExecutiveSummary(verdict, reportData.metrics, performance, manualBlock, automatedBlock);

    reportData.qaReport = {
        verdict,
        executiveSummary,
        keyMetrics: {
            avgFPS:     reportData.metrics.avgFPS || performanceData?.avgFPS || 0,
            peakMemory: performance.peakMemory || 0,
            avgCPU:     performance.avgCPU || 0,
            crashCount: reportData.metrics.crashCount || 0,
            anrCount:   reportData.metrics.anrCount || 0,
            errorCount: reportData.metrics.errorCount || 0,
            duration
        },
        automated: {
            summary:    automatedBlock.summary,
            categories: automatedBlock.categories
        },
        manual: manualBlock
    };
    // Mirror summary verdict to the top-level summary string so legacy callers see it.
    reportData.summaryText = `${verdict.label}. ${verdict.tagline}`;

    reportData.aiInsights = insightEngine.generateInsights(reportData);
    return reportData;
};

module.exports = { generateReport };
