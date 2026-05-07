// Test Validation Aggregator — pure function.
//
// Combines deterministic outputs from three sources into a single, evidence-cited
// validation result for the unified Test Validation UI:
//   • preflightAnalyzer       — static APK compliance (6 checks)
//   • gameplayBlockerDetector — runtime stability/perf/network/auth blockers
//   • runtimeIntelligence     — SDK lifecycle (Firebase init, ad events, billing)
//
// The aggregator NEVER infers or invents results. Every emitted item traces back
// to a concrete signal: a manifest attribute, a logcat line, or a metric sample.
// If a signal is absent, the item either says NOT_DETECTED or is omitted — never
// fabricated as PASS.
//
// Confidence taxonomy (used by the UI):
//   Verified                 — deterministic from a single observable source
//                              (e.g. AAPT manifest value, FATAL EXCEPTION line).
//   Runtime Detected         — observed during the session (log pattern or metric).
//   Partial                  — heuristic; may not fire on every app structure
//                              (e.g. splash_stuck, oom_kill memory threshold).
//   Needs Manual Validation  — the tool can confirm a callback fired but cannot
//                              verify the visual/UX correctness — defer to tester.

const CATEGORIES = [
    'APK Compliance',
    'Security',
    'Runtime Stability',
    'Performance',
    'SDK Integrations',
    'Network Validation'
];

const STATUS_TO_SEVERITY = {
    PASS: 'INFO',
    INFO: 'INFO',
    WARN: 'MEDIUM',
    FAIL: 'HIGH'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem({ id, category, title, description, status, severity, confidence, evidence, source }) {
    return {
        id,
        category,
        title,
        description: description || '',
        status,
        severity: severity || STATUS_TO_SEVERITY[status] || 'INFO',
        confidence: confidence || 'Verified',
        evidence: Array.isArray(evidence) ? evidence : (evidence ? [evidence] : []),
        source
    };
}

function cmpSeverity(a, b) {
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
}

// ─── Source: Preflight (static APK compliance) ────────────────────────────────
//
// Preflight emits issues only — passing checks are implicit. We turn that into
// explicit pass/fail rows so the tester sees what was checked, not just what failed.

function fromPreflight(preflightResult) {
    if (!preflightResult || preflightResult.error) return [];

    const issues = preflightResult.issues || [];
    const seen = new Set(issues.map(i => i.id));
    const items = [];

    // Map issue.id → which validation category it belongs to.
    const COMPLIANCE_IDS = new Set(['arm64_missing', 'target_sdk_low', 'legacy_signing']);
    const SECURITY_IDS   = new Set(['debuggable', 'cleartext_http', 'dangerous_perms']);

    // Failures from preflight.
    for (const issue of issues) {
        const cat = COMPLIANCE_IDS.has(issue.id) ? 'APK Compliance'
                  : SECURITY_IDS.has(issue.id)   ? 'Security'
                  : 'APK Compliance';
        items.push(makeItem({
            id: `preflight_${issue.id}`,
            category: cat,
            title: issue.title,
            description: issue.desc,
            status: 'FAIL',
            severity: issue.severity,
            confidence: 'Verified',
            evidence: [issue.evidence, `Fix: ${issue.fix}`].filter(Boolean),
            source: 'preflight'
        }));
    }

    // Passing checks — each preflight rule that did NOT fire becomes a PASS row,
    // so the tester sees the full audit, not just the failures.
    const ALL_PREFLIGHT_CHECKS = [
        { id: 'arm64_missing',     title: '64-bit native architecture (arm64-v8a) present',  category: 'APK Compliance' },
        { id: 'target_sdk_low',    title: 'Target SDK meets Play Store minimum',             category: 'APK Compliance' },
        { id: 'legacy_signing',    title: 'APK uses v2/v3 signing scheme',                   category: 'APK Compliance' },
        { id: 'debuggable',        title: 'Release build (android:debuggable=false)',        category: 'Security' },
        { id: 'cleartext_http',    title: 'Cleartext HTTP traffic disallowed',               category: 'Security' },
        { id: 'dangerous_perms',   title: 'No high-risk permissions requested',              category: 'Security' }
    ];
    for (const c of ALL_PREFLIGHT_CHECKS) {
        if (seen.has(c.id)) continue;
        items.push(makeItem({
            id: `preflight_${c.id}_ok`,
            category: c.category,
            title: c.title,
            status: 'PASS',
            severity: 'INFO',
            confidence: 'Verified',
            evidence: ['Static APK analysis passed for this rule.'],
            source: 'preflight'
        }));
    }
    return items;
}

// ─── Source: Gameplay Blocker Detector (runtime) ──────────────────────────────

// Blocker id → category mapping. Keep in sync with gameplayBlockerDetector ids.
// splash_stuck is intentionally excluded: it relies on activity naming conventions
// that are too fragile to surface as an automated finding. It may still appear in
// the raw blocker list used by reports, but not in the Validation UI.
const BLOCKER_CATEGORY = {
    crash_play:         'Runtime Stability',
    anr_play:           'Runtime Stability',
    native_crash:       'Runtime Stability',
    no_ui:              'Runtime Stability',
    oom_kill:           'Runtime Stability',
    low_fps_sustained:  'Performance',
    network_loss_play:  'Network Validation',
    auth_failure:       'SDK Integrations'
};

const BLOCKER_CONFIDENCE = {
    crash_play:         'Verified',
    anr_play:           'Verified',
    native_crash:       'Verified',
    no_ui:              'Runtime Detected',
    oom_kill:           'Partial',           // heuristic: requires PSS threshold + process death
    low_fps_sustained:  'Runtime Detected',  // real FPS samples, not logcat estimates
    network_loss_play:  'Runtime Detected',
    auth_failure:       'Runtime Detected'
};

// Blockers excluded from automated validation UI (too fragile / naming-convention-based).
// They still appear in session reports via the raw blocker list.
const EXCLUDED_BLOCKER_IDS = new Set(['splash_stuck']);

function fromGameplayBlockers(result, sessionRun) {
    if (!result || !result.blockers) return [];
    const items = [];

    // FAIL rows for every detected blocker (skip excluded ones).
    for (const b of result.blockers) {
        if (EXCLUDED_BLOCKER_IDS.has(b.id)) continue;
        const cat = BLOCKER_CATEGORY[b.id] || 'Runtime Stability';
        items.push(makeItem({
            id: `runtime_${b.id}`,
            category: cat,
            title: b.name,
            description: '',
            status: 'FAIL',
            severity: b.severity,
            confidence: BLOCKER_CONFIDENCE[b.id] || 'Runtime Detected',
            evidence: b.evidence,
            source: 'runtime'
        }));
    }

    // PASS rows for the core stability checks IF a session ran without firing them.
    // Don't emit PASS rows when no session has happened — that would lie.
    if (sessionRun) {
        const fired = new Set(result.blockers.map(b => b.id));
        const pass = (id, title, category, confidence = 'Runtime Detected') => {
            if (fired.has(id)) return;
            items.push(makeItem({
                id: `runtime_${id}_ok`,
                category, title,
                status: 'PASS', severity: 'INFO',
                confidence,
                evidence: [`No matching log/metric pattern observed during the ${result.counts?.logLines || 0}-line session.`],
                source: 'runtime'
            }));
        };
        pass('crash_play',        'No crash during play',                         'Runtime Stability', 'Verified');
        pass('anr_play',          'No ANR during play',                           'Runtime Stability', 'Verified');
        pass('native_crash',      'No native crash (tombstone)',                  'Runtime Stability', 'Verified');
        pass('low_fps_sustained', 'Frame rate stayed above sustained-low threshold', 'Performance');
        pass('network_loss_play', 'Network stayed reachable during play',         'Network Validation');
    }
    return items;
}

// ─── Source: Runtime Intelligence (SDK lifecycle) ─────────────────────────────
//
// We turn the runtimeIntelligence flags into discrete validation rows so QA can
// see exactly which SDKs initialised at runtime — but we never claim more than
// what the logs confirm. A detected callback is an *event*, not a UI render —
// items requiring visual confirmation get confidence "Needs Manual Validation".

function fromRuntimeIntel(intel, sessionRun, sessionCtx) {
    if (!intel) return [];
    const items = [];
    const ck = intel.checklist || {};
    const fb = intel.firebase || {};
    const ads = intel.ads || {};

    // ── Firebase Analytics ──
    if (sessionCtx?.hasFirebaseAnalytics || intel.staticFirebase) {
        if (ck.firebase_init || (fb.status === 'Detected' && fb.count > 0)) {
            items.push(makeItem({
                id: 'sdk_firebase_init',
                category: 'SDK Integrations',
                title: 'Firebase Analytics initialised at runtime',
                description: 'Firebase logged at least one event during the session.',
                status: 'PASS', severity: 'INFO',
                confidence: 'Runtime Detected',
                evidence: [`Firebase events seen: ${fb.count}`, fb.firstEventTime ? `First at ${fb.firstEventTime}s` : null].filter(Boolean),
                source: 'sdk_lifecycle'
            }));
        } else if (sessionRun) {
            items.push(makeItem({
                id: 'sdk_firebase_no_events',
                category: 'SDK Integrations',
                title: 'Firebase declared in APK but no analytics events seen',
                description: 'The APK includes Firebase Analytics, but no event log lines fired during this session.',
                status: 'WARN', severity: 'MEDIUM',
                confidence: 'Runtime Detected',
                evidence: ['firebase.count === 0 over the session.'],
                source: 'sdk_lifecycle'
            }));
        }
    }

    // ── Ads SDK lifecycle ──
    // Only emit when ad callbacks are actually observed. A missing ad event is not
    // meaningful — ads require specific gameplay triggers (level complete, timer, etc.)
    // that a QA session may not hit. Visual confirmation is always required regardless.
    if ((sessionCtx?.hasAds || intel.staticAds) && ads.status === 'Detected' && ads.count > 0) {
        items.push(makeItem({
            id: 'sdk_ads_callback',
            category: 'SDK Integrations',
            title: `Ads SDK lifecycle observed (${ads.type || 'detected'})`,
            description: 'Ad SDK emitted runtime callbacks. Visual rendering still needs manual confirmation.',
            status: 'PASS', severity: 'INFO',
            confidence: 'Needs Manual Validation',
            evidence: [
                `Ad events: ${ads.count}`,
                ads.firstEventTime ? `First at ${ads.firstEventTime}s` : null,
                Array.isArray(ads.adTypes) && ads.adTypes.length ? `Types: ${ads.adTypes.join(', ')}` : null
            ].filter(Boolean),
            source: 'sdk_lifecycle'
        }));
    }

    // ── Crashlytics ──
    if (ck.crashlytics_init) {
        items.push(makeItem({
            id: 'sdk_crashlytics_init',
            category: 'SDK Integrations',
            title: 'Crashlytics initialised',
            status: 'PASS', severity: 'INFO',
            confidence: 'Runtime Detected',
            evidence: ['Crashlytics SDK marked active at runtime.'],
            source: 'sdk_lifecycle'
        }));
    }

    // ── Lifecycle: app reached gameplay (game_start) ──
    // Only emit when the signal is actually observed. Absence is not meaningful —
    // most engines only emit this signal if explicitly instrumented to do so.
    if (sessionRun && ck.game_start) {
        const ev = intel.checklistEvidence?.game_start;
        items.push(makeItem({
            id: 'lifecycle_game_start',
            category: 'Runtime Stability',
            title: 'App reached gameplay (game_start observed)',
            status: 'PASS', severity: 'INFO',
            confidence: 'Verified',
            evidence: [ev ? `Detected at ${ev.time}s — ${ev.evidence}` : 'game_start signal logged.'],
            source: 'sdk_lifecycle'
        }));
    }
    return items;
}

// ─── Source: IAP Validation Engine (billing lifecycle) ────────────────────────

function fromIapEngine(iapData, sessionCtx) {
    if (!iapData || iapData.system === 'Not Detected' || !sessionCtx?.hasIap) return [];
    const items = [];

    if (iapData.events && iapData.events.length > 0) {
        const initiated = iapData.events.find(e => e.name === 'Purchase Initiated');
        if (initiated) {
            items.push(makeItem({
                id: 'sdk_iap_initiated',
                category: 'SDK Integrations',
                title: 'Billing flow initiated (launchBillingFlow observed)',
                status: 'PASS', severity: 'INFO',
                confidence: 'Verified',
                evidence: [`launchBillingFlow at ${initiated.time}s`],
                source: 'sdk_lifecycle'
            }));
        }
        if (iapData.purchaseFinalized === 'OK') {
            items.push(makeItem({
                id: 'sdk_iap_finalized',
                category: 'SDK Integrations',
                title: 'Purchase finalised (acknowledge or consume detected)',
                description: 'Required by Google Play; without it, purchases are auto-refunded after 3 days.',
                status: 'PASS', severity: 'INFO',
                confidence: 'Verified',
                evidence: [
                    iapData.acknowledgeDetected ? 'acknowledgePurchase observed' : null,
                    iapData.consumeDetected     ? 'consumeAsync observed'        : null
                ].filter(Boolean),
                source: 'sdk_lifecycle'
            }));
        } else if (iapData.purchaseFinalized === 'MISSING') {
            items.push(makeItem({
                id: 'sdk_iap_unfinalized',
                category: 'SDK Integrations',
                title: 'Completed purchase NOT finalised',
                description: 'Purchase resolved but no acknowledge/consume seen within the 60s observation window. Could indicate a real bug or a delayed network retry — verify manually.',
                status: 'FAIL', severity: 'CRITICAL',
                confidence: 'Partial',   // timing-window heuristic, not a deterministic guarantee
                evidence: ['PURCHASED event seen; no acknowledgePurchase/consumeAsync within 60s.'],
                source: 'sdk_lifecycle'
            }));
        }
    }
    return items;
}

// ─── Categoriser + summary ────────────────────────────────────────────────────

function groupAndSummarise(items) {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: items.length, pass: 0, fail: 0, warn: 0 };
    for (const it of items) {
        const k = (it.severity || 'INFO').toLowerCase();
        if (summary[k] !== undefined) summary[k]++;
        if (it.status === 'PASS') summary.pass++;
        else if (it.status === 'FAIL') summary.fail++;
        else if (it.status === 'WARN') summary.warn++;
    }
    const groups = new Map(CATEGORIES.map(c => [c, []]));
    for (const it of items) {
        const k = it.category && groups.has(it.category) ? it.category : 'Runtime Stability';
        groups.get(k).push(it);
    }
    // Sort each group: failures first (by severity), then warnings, then passes.
    for (const arr of groups.values()) {
        arr.sort((a, b) => {
            const statusOrder = { FAIL: 0, WARN: 1, PASS: 2, INFO: 3 };
            const sa = statusOrder[a.status] ?? 4;
            const sb = statusOrder[b.status] ?? 4;
            if (sa !== sb) return sa - sb;
            return cmpSeverity(a, b);
        });
    }
    const categories = [...groups.entries()]
        .filter(([, arr]) => arr.length > 0)
        .map(([category, arr]) => ({ category, items: arr }));
    return { categories, summary };
}

/**
 * @param {Object} params
 * @param {Object} params.preflightResult       — preflightAnalyzer.analyze() output (or null)
 * @param {Object} params.gameplayBlockerResult — gameplayBlockerDetector.getResult()
 * @param {Object} params.runtimeIntel          — runtimeIntelligence.getResult() (or null)
 * @param {Object} params.iapData               — iapValidationEngine.getResult() (or null)
 * @param {Object} params.sessionCtx            — { engine, sdks, targetSdk, hasAds, hasIap, ... }
 * @param {boolean}params.sessionRun            — true if a runtime session has actually been recorded
 */
function aggregate({
    preflightResult = null,
    gameplayBlockerResult = null,
    runtimeIntel = null,
    iapData = null,
    sessionCtx = {},
    sessionRun = false
} = {}) {
    const automatedItems = [
        ...fromPreflight(preflightResult),
        ...fromGameplayBlockers(gameplayBlockerResult, sessionRun),
        ...fromRuntimeIntel(runtimeIntel, sessionRun, sessionCtx),
        ...fromIapEngine(iapData, sessionCtx)
    ];
    const automated = groupAndSummarise(automatedItems);

    // Manual block is kept zero-shaped for back-compat: old session reports stored
    // `testValidation.manual` and the renderer's legacy fallback still reads it.
    // The active manual checklist now lives in qaChecklistManager — not here.
    const manual = {
        progress: { total: 0, checked: 0, passed: 0, failed: 0, skipped: 0 },
        categories: []
    };

    return {
        generatedAt: Date.now(),
        apkAnalyzed: !!preflightResult && !preflightResult.error,
        sessionRun,
        automated,
        manual
    };
}

module.exports = { aggregate, CATEGORIES };
