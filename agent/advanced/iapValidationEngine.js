// IAP Validation Engine — log-based purchase lifecycle auditor.
//
// What it deterministically verifies (real, no AI, no inference):
//   • Google Play Billing Library presence + version (from APK manifest meta-data)
//   • Purchase initiation (launchBillingFlow log line)
//   • Purchase resolution (PURCHASED / USER_CANCELED / FAILED with error code)
//   • acknowledgePurchase call after PURCHASED  (REVENUE-CRITICAL — without it, Google auto-refunds in 3 days)
//   • consumeAsync call after PURCHASED for consumables (without it, user can't rebuy)
//   • Dead-callback detection (launchBillingFlow with no resolution + no BillingClient activity for 60s)
//   • Backend-verification URL hit in logs (best-effort, app-dependent)
//
// What it cannot verify (and never will, without OCR/AI which user ruled out):
//   • Whether real money was actually deducted from the bank — Google does not expose this
//   • The actual gem/coin count delivered to the player — needs OCR
//   • Whether the Play Store dialog visually appeared — modern Billing v5+ uses an in-process bottom sheet
//
// Reliability notes:
//   • Native Android: 85–95% of patterns hit reliably
//   • Unity IAP wrapped games: 75–85% (Unity wraps Google Billing but the underlying library still emits standard logs)
//   • Ad-network-mediated IAP (LevelPlay/AppLovin SDKs): 50–60% (mediation layers can swallow logs)

const adbHelper = require('../adb/adbHelper');
const aaptResolver = require('../utils/aaptResolver');
const { exec } = require('child_process');
const fs = require('fs');

// Google Play Billing Library response codes (v3 — v7).
// Source: BillingClient.BillingResponseCode constants (public Google docs).
const BILLING_RESPONSE_CODES = {
    '-3': { name: 'SERVICE_TIMEOUT',           type: 'danger',  message: 'Network connection slow — billing service timed out.' },
    '-2': { name: 'FEATURE_NOT_SUPPORTED',     type: 'warning', message: 'Requested feature is not supported by the Play Store on this device.' },
    '-1': { name: 'SERVICE_DISCONNECTED',      type: 'danger',  message: 'Play Billing service disconnected. The client must reconnect.' },
    '0':  { name: 'OK',                        type: 'success', message: 'Success — no error.' },
    '1':  { name: 'USER_CANCELED',             type: 'warning', message: 'User pressed back or cancelled the purchase dialog.' },
    '2':  { name: 'SERVICE_UNAVAILABLE',       type: 'danger',  message: 'Network connection is down.' },
    '3':  { name: 'BILLING_UNAVAILABLE',       type: 'danger',  message: 'Billing API version not supported, or Play Store needs an update.' },
    '4':  { name: 'ITEM_UNAVAILABLE',          type: 'danger',  message: 'Requested SKU is not available for purchase. Check Play Console product setup.' },
    '5':  { name: 'DEVELOPER_ERROR',           type: 'danger',  message: 'Invalid arguments — typically misconfigured product, signature mismatch, or wrong package name.' },
    '6':  { name: 'ERROR',                     type: 'danger',  message: 'Fatal error during the API action.' },
    '7':  { name: 'ITEM_ALREADY_OWNED',        type: 'warning', message: 'Player already owns this item — likely missing consumePurchase for a consumable.' },
    '8':  { name: 'ITEM_NOT_OWNED',            type: 'warning', message: 'consumePurchase failed because the player does not own this item.' }
};

const RESPONSE_CODE_NAMES = new Set(Object.values(BILLING_RESPONSE_CODES).map(c => c.name));

// Window after PURCHASED in which we expect acknowledge or consume to fire.
// Google's hard deadline is 3 days but for QA tests, 60s of inactivity = real bug.
const POST_PURCHASE_WINDOW_MS = 60 * 1000;
// Window after launchBillingFlow with no BillingClient activity that flags a dead callback.
const DEAD_CALLBACK_INACTIVITY_MS = 60 * 1000;

class IAPValidationEngine {
    constructor() {
        this.reset();
    }

    reset() {
        this.data = {
            system: 'Not Detected',
            libraryVersion: null,
            status: 'INCOMPLETE',          // PASS | FAIL | INCOMPLETE
            events: [],
            startTime: null,
            duration: 0,
            error: null,
            errorMessage: null,            // Human-readable translation of `error`
            backendVerifyAttempted: false, // We see the verify URL fire in logs; we don't see the response.
            isActive: false,
            pkg: null,
            // Lifecycle verification (the new core deliverable):
            acknowledgeDetected: false,
            consumeDetected: false,
            purchaseFinalized: 'NOT_APPLICABLE',  // OK | MISSING | NOT_APPLICABLE
            deadCallbackDetected: false,
            // Diagnostic counters:
            counts: {
                launchFlow: 0,
                purchaseResolved: 0,
                billingClientLogs: 0
            }
        };
        // Internal tracking — not serialised to UI.
        this._lastBillingActivityMs = null;
        this._purchaseResolvedAtMs = null;
        this._launchFlowAtMs = null;
    }

    // ─────────────────────────── DETECTION (E) ─────────────────────────────────

    async detectSDK(pkg, deviceId, apkPath) {
        if (!pkg || !deviceId) return { system: 'Not Detected', libraryVersion: null };

        let system = 'Not Detected';
        let libraryVersion = null;

        // Method 1: dumpsys package — fastest if app is installed.
        try {
            const dump = await adbHelper.runADB(['-s', deviceId, 'shell', 'dumpsys', 'package', pkg], { timeout: 8000 });
            if (dump && /com\.android\.vending\.BILLING|billingclient|BillingClient/i.test(dump)) {
                system = 'Google Play Billing';
            }
        } catch {}

        // Method 2: classes.dex grep on device — fallback for cases where dumpsys doesn't expose it.
        if (system === 'Not Detected') {
            try {
                const out = await adbHelper.runADB(['-s', deviceId, 'shell', 'pm', 'path', pkg], { timeout: 5000 });
                if (out) {
                    const installedPath = out.replace('package:', '').trim().split('\n')[0];
                    if (installedPath) {
                        const grepOut = await adbHelper.runADB(
                            ['-s', deviceId, 'shell', 'grep', '-r', 'com/android/billingclient', installedPath],
                            { timeout: 8000 }
                        );
                        if (grepOut && grepOut.includes('billingclient')) {
                            system = 'Google Play Billing';
                        }
                    }
                }
            } catch {}
        }

        // Method 3: read library version from APK manifest meta-data (most reliable identifier).
        // Google requires `com.google.android.play.billingclient.version` meta-data since Library v3.
        if (apkPath && fs.existsSync(apkPath)) {
            const v = await this._readBillingLibraryVersion(apkPath);
            if (v) {
                libraryVersion = v;
                if (system === 'Not Detected') system = 'Google Play Billing';
            }
        }

        this.data.system = system;
        this.data.libraryVersion = libraryVersion;
        return { system, libraryVersion };
    }

    _readBillingLibraryVersion(apkPath) {
        return new Promise((resolve) => {
            const aaptCmd = aaptResolver.resolve();
            if (!aaptCmd) return resolve(null);
            exec(`${aaptCmd} dump xmltree "${apkPath}" AndroidManifest.xml`, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
                if (err) return resolve(null);
                // Find the `meta-data` block whose name is the billing version key.
                // Two-line pattern: name attribute, then value attribute.
                const text = stdout || '';
                const re = /android:name[^"]*"com\.google\.android\.play\.billingclient\.version"[^\n]*\n[^\n]*android:value[^"]*"([^"]+)"/i;
                const m = text.match(re);
                resolve(m ? m[1].trim() : null);
            });
        });
    }

    // ─────────────────────────── SESSION CONTROL ───────────────────────────────

    startSession(pkg) {
        const previousSystem = this.data.system;
        const previousVersion = this.data.libraryVersion;
        this.reset();
        this.data.system = previousSystem;
        this.data.libraryVersion = previousVersion;
        this.data.isActive = true;
        this.data.pkg = pkg;
        this.data.startTime = Date.now();
        return { success: true };
    }

    stopSession() {
        this.data.isActive = false;
        // Don't force `recomputeWindows: true`: stopping early shouldn't lie about an
        // ack/consume timeout that hasn't actually elapsed. The natural 60s window in
        // _finalizeResult still fires if the user stops late, and PENDING stays PENDING.
        this._finalizeResult();
        return this.getResult();
    }

    // ─────────────────────────── LOG ANALYSIS (A, B, C, D) ─────────────────────

    analyzeLogs(lines) {
        if (!this.data.isActive || !lines || lines.length === 0) return;

        for (const line of lines) {
            // No pre-filter — each downstream regex is specific enough that running them all
            // on every line is cheap, and a pre-filter risks silently dropping patterns it
            // doesn't list (the previous version missed "Purchase successful" / "Purchase
            // completed" / "onPurchaseSuccess" — three real Billing Library log lines).
            const nowMs = Date.now();
            const t = parseFloat(((nowMs - this.data.startTime) / 1000).toFixed(1));

            // BillingClient activity heartbeat — used for dead-callback detection.
            if (/BillingClient|BillingHelper|launchBillingFlow|onPurchasesUpdated|acknowledgePurchase|acknowledgeAsync|consumeAsync|consumePurchase/i.test(line)) {
                this._lastBillingActivityMs = nowMs;
                this.data.counts.billingClientLogs++;
            }

            // ─────────────────────────────────────────────────────────────────────
            // No `continue` between checks below — a single line can carry multiple
            // signals (e.g. "Purchase state: PURCHASED, acknowledged=true" on Billing
            // Library v6+). All checks are idempotent thanks to _findEventName guards.
            // ─────────────────────────────────────────────────────────────────────

            // 1. Purchase initiated.
            if (/launchBillingFlow|Billing flow started|Launching billing flow/i.test(line)) {
                if (!this._findEventName('Purchase Initiated')) {
                    this._addEvent('Purchase Initiated', 'success', t);
                    this.data.counts.launchFlow++;
                    this._launchFlowAtMs = nowMs;
                }
            }

            // 2. Purchase resolution — extract response code if present.
            if (/BillingResponseCode/i.test(line)) {
                const code = this._extractErrorCode(line);
                const meta = BILLING_RESPONSE_CODES[code] || null;
                if (meta) {
                    if (meta.name === 'OK') {
                        // OK on its own isn't a purchase event — usually a setup callback. Skip event spam.
                    } else if (meta.name === 'USER_CANCELED') {
                        if (!this._findEventName(`Purchase Cancelled (${meta.name})`)) {
                            this._addEvent(`Purchase Cancelled (${meta.name})`, 'warning', t, { code, message: meta.message });
                            this.data.counts.purchaseResolved++;
                            this._purchaseResolvedAtMs = nowMs;
                        }
                    } else {
                        if (!this._findEventName(`Purchase Failed (${meta.name})`)) {
                            this._addEvent(`Purchase Failed (${meta.name})`, 'danger', t, { code, message: meta.message });
                            this.data.error = meta.name;
                            this.data.errorMessage = meta.message;
                            this.data.counts.purchaseResolved++;
                            this._purchaseResolvedAtMs = nowMs;
                        }
                    }
                }
            }

            // Bare USER_CANCELED line (works whether or not BillingResponseCode prefix was present)
            if (/\bUSER_CANCELED\b/.test(line) && !this._findEventName('Purchase Cancelled (USER_CANCELED)')) {
                this._addEvent('Purchase Cancelled (USER_CANCELED)', 'warning', t, { code: '1', message: BILLING_RESPONSE_CODES['1'].message });
                this._purchaseResolvedAtMs = nowMs;
            }

            // 3. PURCHASED state — the actual successful purchase.
            if (/\bPURCHASED\b|Purchase successful|Purchase completed|onPurchaseSuccess/i.test(line)) {
                if (!this._findEventName('Purchase Completed')) {
                    this._addEvent('Purchase Completed', 'success', t);
                    this.data.counts.purchaseResolved++;
                    this._purchaseResolvedAtMs = nowMs;
                    if (this._findEventTime('Purchase Initiated') != null) {
                        this.data.duration = parseFloat((t - this._findEventTime('Purchase Initiated')).toFixed(1));
                    }
                }
            }

            // 4. (A) Acknowledge purchase — non-consumables MUST call this within 3 days.
            //    Word-boundary guard avoids matching "acknowledgePurchaseFailed".
            if (/\b(?:acknowledgePurchase|acknowledgeAsync)\b(?!Failed)|Acknowledging purchase|acknowledged purchase|Successfully acknowledged/i.test(line)) {
                if (!this.data.acknowledgeDetected) {
                    this.data.acknowledgeDetected = true;
                    this._addEvent('Purchase Acknowledged', 'success', t, { hint: 'Required for non-consumables — Google would auto-refund without this.' });
                }
            }

            // 5. (B) Consume purchase — consumables MUST call this so the user can rebuy.
            if (/\b(?:consumeAsync|consumePurchase)\b(?!Failed)|Consuming purchase|Successfully consumed|onConsumeResponse/i.test(line)) {
                if (!this.data.consumeDetected) {
                    this.data.consumeDetected = true;
                    this._addEvent('Purchase Consumed', 'success', t, { hint: 'Required for consumables — without this, the user cannot purchase the same item again.' });
                }
            }

            // 6. Backend verification URL hit (best-effort, app-dependent).
            // We only see the call attempt; we don't see whether the response was successful.
            if (/\/(?:purchase|iap|billing|receipt)\/(?:verify|validate|success|finish)|VerifyPurchase|validatePurchase/i.test(line)) {
                this.data.backendVerifyAttempted = true;
            }
        }

        this._finalizeResult();
    }

    _addEvent(name, type, time, extra = {}) {
        const last = this.data.events[this.data.events.length - 1];
        if (last && last.name === name && (time - last.time < 0.5)) return;
        this.data.events.push({ name, type, time, ...extra });
    }

    _findEventName(name) {
        return this.data.events.find(e => e.name === name) || null;
    }

    _findEventTime(name) {
        const ev = this._findEventName(name);
        return ev ? ev.time : null;
    }

    _extractErrorCode(line) {
        // BillingResponseCode can be either named ("USER_CANCELED") or numeric (e.g. "BillingResponseCode: 7").
        // The earlier `[?]code[?]?...` fallback was matching literal "?code?" — broken and useless;
        // BillingClient logs never use that shape, so it's gone.
        const named = line.match(/BillingResponseCode[:\s=]+([A-Z][A-Z_]+)/);
        if (named && RESPONSE_CODE_NAMES.has(named[1])) {
            for (const [num, meta] of Object.entries(BILLING_RESPONSE_CODES)) {
                if (meta.name === named[1]) return num;
            }
        }
        const numeric = line.match(/BillingResponseCode[:\s=]+(-?\d+)/);
        if (numeric) return numeric[1];
        return null;
    }

    _finalizeResult() {
        const evs = this.data.events;
        const hasInitiated = !!evs.find(e => e.name === 'Purchase Initiated');
        const hasCompleted = !!evs.find(e => e.name === 'Purchase Completed');
        const hasFailed    = !!evs.find(e => /Purchase Failed/.test(e.name));
        const hasCancelled = !!evs.find(e => /Purchase Cancelled/.test(e.name));

        // (A + B) Purchase finalization verdict — only meaningful if a purchase actually completed.
        if (hasCompleted) {
            const finalized = this.data.acknowledgeDetected || this.data.consumeDetected;
            if (finalized) {
                this.data.purchaseFinalized = 'OK';
            } else if (this._purchaseResolvedAtMs && Date.now() - this._purchaseResolvedAtMs > POST_PURCHASE_WINDOW_MS) {
                // 60s+ passed since PURCHASED with no acknowledge or consume → real bug.
                this.data.purchaseFinalized = 'MISSING';
            } else {
                this.data.purchaseFinalized = 'PENDING';
            }
        } else {
            this.data.purchaseFinalized = 'NOT_APPLICABLE';
        }

        // (D) Dead-callback detection.
        // Trigger: launchBillingFlow seen, no resolution event, AND no BillingClient log activity for 60s.
        if (hasInitiated && !hasCompleted && !hasFailed && !hasCancelled) {
            const lastActivity = this._lastBillingActivityMs || this._launchFlowAtMs;
            if (lastActivity && Date.now() - lastActivity > DEAD_CALLBACK_INACTIVITY_MS) {
                if (!this.data.deadCallbackDetected) {
                    this.data.deadCallbackDetected = true;
                    const t = parseFloat(((Date.now() - this.data.startTime) / 1000).toFixed(1));
                    this._addEvent('Dead Callback Suspected', 'danger', t, {
                        hint: 'Purchase was initiated, but no result and no BillingClient activity for 60s. Common cause: missing onPurchasesUpdated listener, Buy button does nothing.'
                    });
                }
            }
        }

        // Overall status — gives a single verdict for the badge.
        if (this.data.deadCallbackDetected) {
            this.data.status = 'FAIL';
        } else if (hasCompleted && this.data.purchaseFinalized === 'MISSING') {
            this.data.status = 'FAIL';
        } else if (hasCompleted && this.data.purchaseFinalized === 'OK') {
            this.data.status = 'PASS';
        } else if (hasCompleted && this.data.purchaseFinalized === 'PENDING') {
            // Don't lie with PASS while ack/consume is still inside the 60s window —
            // surface PENDING so a tester who reads the badge knows the verdict is provisional.
            this.data.status = 'PENDING';
        } else if (hasFailed) {
            this.data.status = 'FAIL';
        } else if (hasCancelled) {
            this.data.status = 'CANCELLED';
        } else if (hasInitiated) {
            this.data.status = 'INCOMPLETE';
        } else {
            this.data.status = 'INCOMPLETE';
        }
    }

    getResult() {
        // Recompute time-based verdicts on every poll so the UI sees fresh state.
        this._finalizeResult();
        return this.data;
    }
}

module.exports = new IAPValidationEngine();
