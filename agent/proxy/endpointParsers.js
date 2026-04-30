'use strict';

// All analytics hostnames we intercept
const ANALYTICS_HOSTS = [
    'firebaselogging.googleapis.com',
    'app-measurement.com',
    'collect.gameanalytics.com',
    'graph.facebook.com',
    'inapppurchase.googleapis.com',
    'play.googleapis.com',
    'api2.appsflyer.com',
    'api.appsflyer.com',
    'app.adjust.com',
    'analytics.amplitude.com',
    'mobile-sdk.singular.net',
];

function isAnalyticsHost(hostname) {
    return ANALYTICS_HOSTS.some(h => hostname === h || hostname.endsWith(`.${h}`));
}

// Safe JSON parse — never throws
function tryJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
}

// Parse body based on content-type
function parseBody(contentType, raw) {
    if (!raw || !raw.trim()) return null;
    const ct = (contentType || '').toLowerCase();
    if (ct.includes('application/json')) return tryJSON(raw);
    if (ct.includes('x-www-form-urlencoded')) {
        try { return Object.fromEntries(new URLSearchParams(raw)); } catch {}
    }
    return tryJSON(raw) || raw;
}

// ── GameAnalytics ──────────────────────────────────────────────────────────
// POST https://collect.gameanalytics.com/v2/{game_key}/events
// Body: JSON array of event objects
function parseGameAnalytics(path, body, ct) {
    const data = parseBody(ct, body);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 30).reduce((acc, item) => {
        const category = (item.category || '').toLowerCase();
        const evId     = item.event_id || item.eventId || '';
        if (!evId && !category) return acc;
        const nameParts = evId.split(':').slice(0, 3).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        acc.push({
            name:     `ga_${nameParts || category}`,
            category: 'GA',
            detail:   `${item.category || 'EVENT'}: ${evId}`.trim(),
            source:   'network'
        });
        return acc;
    }, []);
}

// ── Facebook ──────────────────────────────────────────────────────────────
// POST https://graph.facebook.com/activities  (form-encoded)
// custom_events = JSON array of {_eventName, ...}
function parseFacebook(path, body, ct) {
    if (!path.includes('activities') && !path.includes('app_events')) return [];
    const data = parseBody('application/x-www-form-urlencoded', body) || {};
    const events = [];

    const ceStr = data.custom_events;
    if (ceStr) {
        const ce = tryJSON(ceStr);
        const arr = Array.isArray(ce) ? ce : (ce ? [ce] : []);
        for (const ev of arr.slice(0, 20)) {
            const name = ev._eventName || ev.event_name || 'fb_event';
            events.push({ name, category: 'FACEBOOK', detail: name, source: 'network' });
        }
    } else if (data.event) {
        events.push({ name: data.event, category: 'FACEBOOK', detail: data.event, source: 'network' });
    }
    return events;
}

// ── AppsFlyer ─────────────────────────────────────────────────────────────
// POST https://api2.appsflyer.com/inappevent/{app_id}
// Body: { eventName, eventValue, ... }
function parseAppsFlyer(path, body, ct) {
    const data = parseBody(ct, body);
    if (!data || !data.eventName) return [];
    const valStr = typeof data.eventValue === 'object'
        ? JSON.stringify(data.eventValue).slice(0, 80)
        : String(data.eventValue || '');
    return [{
        name:     data.eventName,
        category: 'APPSFLYER',
        detail:   valStr,
        source:   'network'
    }];
}

// ── Adjust ────────────────────────────────────────────────────────────────
// POST https://app.adjust.com/event  (form-encoded)
// Body: event_token=abc123&...
function parseAdjust(path, body, ct) {
    const data = parseBody('application/x-www-form-urlencoded', body) || {};
    const token = data.event_token || data.token;
    if (!token) return [];
    return [{
        name:     `adjust_${token}`,
        category: 'ADJUST',
        detail:   `token: ${token}`,
        source:   'network'
    }];
}

// ── Firebase ──────────────────────────────────────────────────────────────
// POST https://firebaselogging.googleapis.com/v1/projects/{proj}/logEvents
// Also: https://app-measurement.com/a  (protobuf — extract readable strings)
const KNOWN_FIREBASE_EVENTS = new Set([
    'screen_view','session_start','app_open','first_open','app_update','app_remove',
    'purchase','in_app_purchase','ad_impression','ad_click','user_engagement',
    'login','signup','level_up','level_start','level_end','tutorial_begin','tutorial_complete',
    'select_content','share','search','view_item','add_to_cart','begin_checkout'
]);

function parseFirebase(path, body, ct) {
    const events = [];
    const data = parseBody(ct, body);

    // JSON payload (some Firebase versions use JSON)
    if (data && typeof data === 'object') {
        const list = data.events || data.logEvents || [];
        for (const ev of list.slice(0, 20)) {
            const name = ev.name || ev.event_name || '';
            if (name) events.push({ name, category: 'FIREBASE', detail: name, source: 'network' });
        }
        if (events.length) return events;
    }

    // Binary/protobuf: scan for known event name strings
    const raw = typeof body === 'string' ? body : '';
    const seen = new Set();
    for (const evName of KNOWN_FIREBASE_EVENTS) {
        if (raw.includes(evName) && !seen.has(evName)) {
            seen.add(evName);
            events.push({ name: evName, category: 'FIREBASE', detail: `Network: ${evName}`, source: 'network' });
        }
    }
    // Also scan for any [a-z_]+ patterns that look like event names after "name":"
    const jsonNameMatches = raw.matchAll(/"(?:name|event_name|event_type)"\s*:\s*"([a-z_][a-z_0-9]{2,50})"/g);
    for (const m of jsonNameMatches) {
        if (!seen.has(m[1])) { seen.add(m[1]); events.push({ name: m[1], category: 'FIREBASE', detail: m[1], source: 'network' }); }
    }
    return events;
}

// ── IAP / Google Play ─────────────────────────────────────────────────────
// POST https://inapppurchase.googleapis.com/...  or play.googleapis.com/...
function parseIAP(path, body, ct) {
    const productMatch = path.match(/\/products\/([^/?#\s]{2,50})/) ||
                         path.match(/[?&]productId=([^&\s]+)/);
    const productId = productMatch ? decodeURIComponent(productMatch[1]) : 'unknown';
    return [{
        name:     'iap_purchase',
        category: 'IAP',
        detail:   productId,
        source:   'network'
    }];
}

// ── Amplitude ─────────────────────────────────────────────────────────────
function parseAmplitude(path, body, ct) {
    const data = parseBody(ct, body);
    if (!data) return [];
    const list = data.events || data.api_payload || [];
    return (Array.isArray(list) ? list : []).slice(0, 20).map(ev => ({
        name:     ev.event_type || ev.event_name || 'amplitude_event',
        category: 'CUSTOM',
        detail:   `Amplitude: ${ev.event_type || ''}`,
        source:   'network'
    }));
}

// ── Main dispatcher ────────────────────────────────────────────────────────
function parse(hostname, path, method, contentType, body) {
    if (!isAnalyticsHost(hostname)) return [];

    if (hostname.includes('gameanalytics.com'))  return parseGameAnalytics(path, body, contentType);
    if (hostname.includes('facebook.com'))       return parseFacebook(path, body, contentType);
    if (hostname.includes('appsflyer.com'))      return parseAppsFlyer(path, body, contentType);
    if (hostname.includes('adjust.com'))         return parseAdjust(path, body, contentType);
    if (hostname.includes('firebase') || hostname === 'app-measurement.com') return parseFirebase(path, body, contentType);
    if (hostname.includes('inapppurchase') || hostname.includes('play.googleapis')) return parseIAP(path, body, contentType);
    if (hostname.includes('amplitude.com'))      return parseAmplitude(path, body, contentType);

    return [];
}

module.exports = { parse, isAnalyticsHost };
