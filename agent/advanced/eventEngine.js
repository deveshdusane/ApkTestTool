'use strict';

const CATEGORY_COLORS = {
    GA: '#a78bfa',
    FIREBASE: '#38bdf8',
    FACEBOOK: '#818cf8',
    IAP: '#34d399',
    APPSFLYER: '#fb923c',
    ADJUST: '#f59e0b',
    ADS: '#2dd4bf',
    LIFECYCLE: '#71717a',
    SYSTEM: '#52525b'
};

const CATEGORY_BG = {
    GA: 'rgba(167,139,250,0.12)',
    FIREBASE: 'rgba(56,189,248,0.12)',
    FACEBOOK: 'rgba(129,140,248,0.12)',
    IAP: 'rgba(52,211,153,0.12)',
    APPSFLYER: 'rgba(251,146,60,0.12)',
    ADJUST: 'rgba(245,158,11,0.12)',
    ADS: 'rgba(45,212,191,0.12)',
    LIFECYCLE: 'rgba(113,113,122,0.12)',
    SYSTEM: 'rgba(82,82,91,0.12)'
};

class EventEngine {
    constructor() {
        this.reset();
    }

    reset() {
        this.events = [];
        this._lastEventTimes = new Map();
        this.counts = {};
        this.sessionStartTime = Date.now();
        this._categoryCounts = {};
    }

    // Per-category soft cap so GA can't crowd out Firebase/Ads/Lifecycle/System
    _categoryFull(category) {
        const caps = { GA: 150, ADS: 80, FIREBASE: 40, FACEBOOK: 20, IAP: 20, APPSFLYER: 20, ADJUST: 20, LIFECYCLE: 20, SYSTEM: 20 };
        const cap = caps[category] || 30;
        return (this._categoryCounts[category] || 0) >= cap;
    }

    /**
     * Parse one logcat line. Returns detected event object or null.
     * @param {string} line
     * @param {string|null} packageName
     * @param {Set|null} activePids
     */
    parseLine(line, packageName = null, activePids = null) {
        if (!line || !line.trim()) return null;

        // PID guard — only process lines belonging to the tested app
        const pidMatch = line.match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+(\d+)\s+/);
        const pid = pidMatch ? pidMatch[1] : null;
        const belongsToApp = packageName
            ? (line.includes(packageName) || (pid && activePids && activePids.has(pid)))
            : true;
        if (!belongsToApp) return null;

        const eventTime = parseFloat(((Date.now() - this.sessionStartTime) / 1000).toFixed(1));
        let name = null, category = null, detail = '';

        // ── GameAnalytics ──────────────────────────────────────────────────────
        // "Add DESIGN event: {eventId:Fish:Sell:Koi, value:10}"
        const gaDesign = line.match(/(?:Add )?DESIGN event.*?eventId[=:]\s*([A-Za-z0-9_:.+-]+)/i)
            || line.match(/GameAnalytics.*?DESIGN.*?:\s*([A-Za-z0-9_]+:[A-Za-z0-9_:.+-]+)/i);
        if (!name && gaDesign) {
            const rawId = gaDesign[1].replace(/[{}'"\s]/g, '');
            const parts = rawId.split(':').slice(0, 3);
            name = parts.join(':') || 'ga_design';
            category = 'GA';
            detail = `DESIGN: ${rawId}`;
        }

        // "Add PROGRESSION event: Complete/Start/Fail, eventId:..."
        if (!name) {
            const gaProgress = line.match(/(?:Add )?PROGRESSION event.*?(Complete|Start|Fail).*?(?:eventId|id)[=:]\s*([A-Za-z0-9_:.+-]+)/i);
            if (gaProgress) {
                name = `ga_${gaProgress[1].toLowerCase()}`;
                category = 'GA';
                detail = gaProgress[2];
            }
        }

        // "Add BUSINESS event: eventId:Shop:Fish_pack, ..."
        if (!name) {
            const gaBiz = line.match(/(?:Add )?BUSINESS event.*?(?:eventId|itemId)[=:]\s*([A-Za-z0-9_:.+-]+)/i);
            if (gaBiz) {
                name = `ga_business_${gaBiz[1].split(':').pop()}`;
                category = 'GA';
                detail = gaBiz[1];
            }
        }

        // ── Facebook SDK ──────────────────────────────────────────────────────
        // "[FB] LogAppEvent called: fb_mobile_purchase"
        // "FacebookSDK: logEvent fb_app_install"
        // "com.facebook.UserSettingsManager: ..."
        if (!name) {
            const fbSDK = line.match(/(?:\[FB\]|FacebookSDK|FBSDKCoreKit|FBTRACE|com\.facebook\.).*?(?:LogAppEvent|logEvent|logPurchase).*?(?:called:?\s*|name=)\s*([a-zA-Z_][a-zA-Z0-9_]+)/i);
            if (fbSDK) {
                name = fbSDK[1];
                category = 'FACEBOOK';
                detail = fbSDK[1];
            }
        }
        // Fallback: any line with "fb_" event name pattern from FB tags
        if (!name && (line.includes('[FB]') || line.includes('FacebookSDK') || line.includes('com.facebook.'))) {
            const fbFallback = line.match(/(fb_[a-zA-Z_][a-zA-Z0-9_]+)/i);
            if (fbFallback) {
                name = fbFallback[1];
                category = 'FACEBOOK';
                detail = fbFallback[1];
            }
        }
        // Facebook SDK init/warning — catch package-based log entries
        if (!name && line.includes('com.facebook.') && !line.includes('com.facebook.katana')) {
            const fbPkg = line.match(/com\.facebook\.([A-Za-z]+)/);
            if (fbPkg) {
                name = 'facebook_sdk_active';
                category = 'FACEBOOK';
                detail = `Facebook SDK: ${fbPkg[1]}`;
            }
        }

        // ── In-App Purchase ───────────────────────────────────────────────────
        // "iap:purchased:AdPack1"
        // "Unity IAP: Purchase succeeded - ProductID"
        // "BillingClient: onPurchasesUpdated ITEM_ID=..."
        if (!name) {
            const iapPurchase = line.match(/iap[: ]+(?:purchased?|success)[: ]+([A-Za-z0-9_.-]+)/i)
                || line.match(/(?:Unity IAP|UnityIAP).*?(?:Purchase|success)[d]?[: -]+([A-Za-z0-9_.-]{2,40})/i)
                || line.match(/BillingClient.*?onPurchasesUpdated.*?(?:ITEM_ID|product)[= ]+([A-Za-z0-9_.-]+)/i);
            if (iapPurchase) {
                name = 'iap_purchase';
                category = 'IAP';
                detail = iapPurchase[1];
            }
        }
        if (!name && (
            line.includes('BillingClient.startConnection') ||
            line.includes('BillingClientImpl') ||
            /(?:UnityIAP|Unity IAP).*?(?:init|start|ready)/i.test(line)
        )) {
            name = 'iap_billing_ready';
            category = 'IAP';
            detail = 'Billing connected';
        }

        // ── AppsFlyer ─────────────────────────────────────────────────────────
        // "AppsFlyerLib: Sending event af_purchase"
        // "AppsFlyerLib: trackEvent af_level_achieved"
        if (!name) {
            const afEv = line.match(/AppsFlyerLib.*?(?:Sending event|trackEvent|logEvent)[: ]+([a-zA-Z_][a-zA-Z0-9_]+)/i);
            if (afEv) {
                name = afEv[1];
                category = 'APPSFLYER';
                detail = afEv[1];
            }
        }
        if (!name && line.includes('AppsFlyerLib') && (
            line.includes('initialized') || line.includes('AppsFlyerLib v') || line.includes('SDK version')
        )) {
            name = 'af_init';
            category = 'APPSFLYER';
            detail = 'SDK ready';
        }

        // ── Adjust ────────────────────────────────────────────────────────────
        // "Adjust: trackEvent token=abcdef"
        // "AdjustEvent token=abc123 sent"
        if (!name) {
            const adjEv = line.match(/Adjust.*?(?:trackEvent|track event|event sent).*?token[= ]+([a-zA-Z0-9]+)/i)
                || line.match(/AdjustEvent.*?token[= ]+([a-zA-Z0-9]+)/i);
            if (adjEv) {
                name = `adjust_${adjEv[1]}`;
                category = 'ADJUST';
                detail = `token: ${adjEv[1]}`;
            }
        }
        if (!name && line.includes('Adjust') && (
            line.includes('SDK initialized') || line.includes('Adjust.onCreate') || line.includes('init success')
        )) {
            name = 'adjust_init';
            category = 'ADJUST';
            detail = 'SDK ready';
        }

        // ── Lifecycle ─────────────────────────────────────────────────────────
        // Unity scene changes: "SceneManager: Loading scene 'Gameplay'"
        if (!name) {
            const sceneLoad = line.match(/(?:SceneManager|UnityPlayer|Unity).*?(?:Loading|Changing|Loaded) scene[: '"]+([A-Za-z0-9_\- ]+)/i);
            if (sceneLoad) {
                const sn = sceneLoad[1].trim().replace(/['"]/g, '').split(/\s+/)[0];
                name = `scene_${sn.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
                category = 'LIFECYCLE';
                detail = `Scene: ${sn}`;
            }
        }
        // Activity lifecycle from ActivityManager/ActivityTaskManager
        if (!name && (line.includes('ActivityManager:') || line.includes('ActivityTaskManager:'))) {
            if (line.includes('Displayed') && packageName && line.includes(packageName)) {
                const actMatch = line.match(/Displayed\s+[\w.]+\/([\w.]+)/);
                const actShort = actMatch ? actMatch[1].split('.').pop() : 'Activity';
                name = 'activity_displayed';
                category = 'LIFECYCLE';
                detail = actShort;
            } else if (line.includes('START') && packageName && line.includes(packageName)) {
                name = 'activity_start';
                category = 'LIFECYCLE';
                detail = 'Activity starting';
            } else if (line.includes('STOP') && packageName && line.includes(packageName)) {
                name = 'activity_stop';
                category = 'LIFECYCLE';
                detail = 'Activity stopped';
            }
        }
        // App process start
        if (!name && line.includes('Start proc') && packageName && line.includes(packageName)) {
            name = 'app_process_start';
            category = 'LIFECYCLE';
            detail = 'App process launched';
        }
        // App crash / ANR lifecycle
        if (!name && packageName && line.includes(packageName) && (line.includes('FATAL EXCEPTION') || line.includes('ANR in'))) {
            name = line.includes('ANR') ? 'anr_detected' : 'fatal_crash';
            category = 'LIFECYCLE';
            detail = line.includes('ANR') ? 'ANR detected' : 'Fatal exception';
        }

        if (!name || !category) return null;

        // Dedup: same event not within 2 seconds
        const lastTime = this._lastEventTimes.get(name);
        if (lastTime !== undefined && (eventTime - lastTime) <= 2.0) return null;

        // Per-category cap: prevent one category (e.g. GA) from filling the entire buffer
        if (this._categoryFull(category)) return null;

        this._lastEventTimes.set(name, eventTime);
        this.counts[category] = (this.counts[category] || 0) + 1;
        this._categoryCounts[category] = (this._categoryCounts[category] || 0) + 1;

        // Preserve the original logcat line (truncated) so the UI can show users the
        // exact source line that triggered detection — needed for verification/debugging.
        const rawLine = line.length > 400 ? line.slice(0, 400) + '…' : line;
        const ev = { name, category, detail, time: eventTime, raw: rawLine };
        this.events.push(ev);
        if (this.events.length > 400) this.events.shift();

        return ev;
    }

    getEvents() { return this.events; }
    getCounts() { return { ...this.counts }; }
}

module.exports = { EventEngine, CATEGORY_COLORS, CATEGORY_BG };
