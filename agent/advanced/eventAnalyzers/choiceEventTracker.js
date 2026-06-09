/**
 * Stateful per-session Choice Event Tracker.
 *
 * Subscribes to the same logcat stream that fbEventTracker uses (via
 * realtimeMonitor.processLines). Recognizes choice-related events across the
 * common analytics SDK formats:
 *
 *   • Facebook AppEvents       — `{"_eventName":"choice_made", ...}`
 *   • Firebase Analytics       — `name=choice_made, params=Bundle[{...}]`
 *   • GameAnalytics            — `Add DESIGN event: {eventId:choice_made, ...}`
 *   • AppsFlyer                — `Sending event: choice_made(...)`
 *   • Unity FB wrapper         — `LogAppEvent({"logEvent":"choice_made",...})`
 *   • Generic JSON-in-line     — any line with a "choice"-pattern event name
 *                                 plus parseable JSON params
 *
 * Safety guarantees:
 *   • Never throws — any parse error becomes a counted parser issue, not a
 *     crash. realtimeMonitor wraps the call in try/catch as belt+suspenders.
 *   • Empty/missing data → snapshot returns "no events tracked" cleanly. UI
 *     can render without checking for undefined fields.
 *   • Capped at MAX_EVENTS retained in memory (oldest evicted). Counts stay
 *     accurate regardless of cap.
 *   • Per-session isolation — init() resets all state. No cross-session leak.
 *
 * Designed to be drop-in extensible: future SDK formats are added as one more
 * parser function in the PARSERS array; no other code needs to change.
 */

const patterns = require('./choicePatterns');

const MAX_EVENTS         = 1000;
const MAX_PARSER_ISSUES  = 50;

function createChoiceEventTracker() {
    let packageName = null;
    let startedAtMs = null;
    let firstChoiceLineAtMs = null;

    const events = [];                 // newest-last
    const choiceIdHistogram = new Map();  // choiceId → times tested
    const chapterHistogram  = new Map();  // chapter → times seen
    const parserIssues      = [];

    const counts = {
        total: 0,
        unique: 0,
        chapters: 0,
        premium: 0,         // events flagged as premium/paid
        parserIssues: 0
    };

    let eventIdSeq = 0;

    // Branch-coverage manifest — the full set of authored choices, imported by
    // the tester (CSV/JSON of choiceId [+ chapter]). NOT cleared on init(): it's
    // project config that persists across sessions. Coverage = observed ∩ manifest.
    let manifest = null;   // { entries: [{choiceId, chapter, key}], keys: Set }

    // Normalize a (chapter, choiceId) into a comparison key. Chapter-qualified
    // when a chapter is present (choiceIds repeat across chapters), else id-only.
    function normKey(chapter, choiceId) {
        const c  = choiceId != null ? String(choiceId).trim().toLowerCase() : '';
        const ch = chapter  != null ? String(chapter).trim().toLowerCase()  : '';
        if (!c && !ch) return null;
        return ch ? ch + '::' + c : c;
    }

    function setManifest(entries) {
        if (!Array.isArray(entries) || entries.length === 0) { manifest = null; return { ok: false, total: 0 }; }
        const withKey = entries
            .map(e => ({
                choiceId: e.choiceId != null ? String(e.choiceId).trim() : '',
                chapter:  e.chapter  != null && String(e.chapter).trim() !== '' ? String(e.chapter).trim() : null
            }))
            .filter(e => e.choiceId)
            .map(e => ({ ...e, key: normKey(e.chapter, e.choiceId) }))
            .filter(e => e.key);
        if (withKey.length === 0) { manifest = null; return { ok: false, total: 0 }; }
        manifest = { entries: withKey, keys: new Set(withKey.map(e => e.key)) };
        return { ok: true, total: withKey.length };
    }

    function clearManifest() { manifest = null; }

    // Coverage of the imported manifest by choices observed this session. Returns
    // null when no manifest is loaded (feature is opt-in). Deterministic.
    function getCoverage() {
        if (!manifest || manifest.keys.size === 0) return null;
        const observed = new Set();
        for (const e of events) { const k = normKey(e.chapter, e.choiceId); if (k) observed.add(k); }
        const untested = manifest.entries.filter(e => !observed.has(e.key));
        const covered  = manifest.entries.length - untested.length;
        const unexpected = new Set();
        for (const k of observed) if (!manifest.keys.has(k)) unexpected.add(k);
        return {
            total: manifest.entries.length,
            covered,
            pct: manifest.entries.length > 0 ? Math.round((covered / manifest.entries.length) * 100) : 0,
            untested: untested.slice(0, 500).map(e => ({ choiceId: e.choiceId, chapter: e.chapter })),
            unexpectedCount: unexpected.size  // observed choices not in the manifest (new content / id drift)
        };
    }

    function init({ packageName: pkg } = {}) {
        packageName = pkg || null;
        startedAtMs = Date.now();
        firstChoiceLineAtMs = null;
        events.length = 0;
        choiceIdHistogram.clear();
        chapterHistogram.clear();
        parserIssues.length = 0;
        for (const k of Object.keys(counts)) counts[k] = 0;
        eventIdSeq = 0;
    }

    function reset() { init({ packageName }); }

    function recordEvent({ name, params, source, raw, logcatTime, logcatTimeMs, pid }) {
        let choiceId = patterns.findFirst(params, patterns.CHOICE_ID_KEYS);
        let chapter  = patterns.findFirst(params, patterns.CHAPTER_KEYS);
        const text   = patterns.findFirst(params, patterns.TEXT_KEYS);

        // GameAnalytics-style design events carry the structure in the event ID
        // (e.g. "choice:chapter1:help_wife"), not in params. When params didn't
        // yield a choiceId/chapter and the name is hierarchical, derive them.
        if ((choiceId == null || chapter == null) && patterns.isHierChoiceName(name)) {
            const hier = patterns.parseHierChoice(name);
            if (choiceId == null) choiceId = hier.choiceId;
            if (chapter  == null) chapter  = hier.chapter;
        }
        const premiumRaw = patterns.findFirst(params, patterns.PREMIUM_KEYS);
        const isPremium = premiumRaw === true || premiumRaw === 'true' || premiumRaw === 1
                       || (typeof premiumRaw === 'string' && /^(true|yes|y|1)$/i.test(premiumRaw))
                       || (typeof premiumRaw === 'number' && premiumRaw > 0);

        const evt = {
            id: ++eventIdSeq,
            name,
            choiceId: choiceId != null ? String(choiceId) : null,
            chapter:  chapter  != null ? String(chapter)  : null,
            text:     text     != null ? String(text)     : null,
            isPremium,
            params: params || {},
            source,                  // 'fb' | 'firebase' | 'gameanalytics' | 'appsflyer' | 'generic'
            recordedAt: logcatTime || null,
            recordedAtMs: logcatTimeMs || null,
            pid: pid != null ? Number(pid) : null,
            raw
        };

        if (events.length === 0) firstChoiceLineAtMs = Date.now();
        events.push(evt);
        if (events.length > MAX_EVENTS) events.shift();

        counts.total++;
        if (evt.choiceId && !choiceIdHistogram.has(evt.choiceId)) {
            counts.unique++;
        }
        if (evt.choiceId) {
            choiceIdHistogram.set(evt.choiceId, (choiceIdHistogram.get(evt.choiceId) || 0) + 1);
        }
        if (evt.chapter && !chapterHistogram.has(evt.chapter)) {
            counts.chapters++;
        }
        if (evt.chapter) {
            chapterHistogram.set(evt.chapter, (chapterHistogram.get(evt.chapter) || 0) + 1);
        }
        if (evt.isPremium) counts.premium++;

        return evt;
    }

    function flagParserIssue(line, reason) {
        if (parserIssues.length >= MAX_PARSER_ISSUES) return;
        parserIssues.push({
            at: Date.now(),
            raw: line.length > 500 ? line.slice(0, 500) + '…' : line,
            reason
        });
        counts.parserIssues++;
    }

    // ── Per-SDK parsers ────────────────────────────────────────────────────
    // Each parser receives the raw logcat line and returns a {name, params}
    // object if it recognizes the format AND extracts an event name, OR null
    // if it doesn't match. The caller checks isChoiceEventName(name) after.
    //
    // Order matters: more specific formats first so wrong matches don't
    // happen on lines that match multiple regex.

    function parseFbInlineJson(line) {
        // D/AppEvents( 1234): { "_eventName":"choice_made", "choice_id":"ch01" }
        if (!line.includes('"_eventName"')) return null;
        const m = line.match(/\{[^{}]*"_eventName"\s*:\s*"([^"]+)"[\s\S]*?\}/);
        if (!m) return null;
        try {
            const obj = JSON.parse(m[0]);
            return { name: obj._eventName, params: stripWrapperKeys(obj, ['_eventName']) };
        } catch (_) { return null; }
    }

    function parseUnityFbWrapper(line) {
        // V com.facebook.unity.FB: LogAppEvent({"logEvent":"choice_made",...})
        const m = line.match(/LogAppEvent\s*\(\s*(\{[\s\S]*\})\s*\)\s*$/);
        if (!m) return null;
        try {
            const obj = JSON.parse(m[1]);
            if (!obj.logEvent) return null;
            const params = obj.parameters && typeof obj.parameters === 'object'
                ? Object.assign({}, obj.parameters) : {};
            if ('valueToSum' in obj) params._valueToSum = obj.valueToSum;
            for (const [k, v] of Object.entries(obj)) {
                if (k === 'logEvent' || k === 'valueToSum' || k === 'parameters') continue;
                if (!(k in params)) params[k] = v;
            }
            return { name: obj.logEvent, params };
        } catch (_) { return null; }
    }

    function parseFirebaseEvent(line) {
        // D/FA-Event: Logging event: name=choice_made, params=Bundle[{choice_id=ch01, ...}]
        // OR  D/FA: Logging event (FE): choice_made, ...
        const m = line.match(/name=([\w.]+)[,\s]+params=Bundle\[\{([^}]*)\}/);
        if (m) {
            const params = parseBundleString(m[2]);
            return { name: m[1], params };
        }
        const m2 = line.match(/Logging event[^:]*:\s*([\w.]+)\b/);
        if (m2) return { name: m2[1], params: {} };
        return null;
    }

    function parseGameAnalytics(line) {
        // I GameAnalytics: Info/GameAnalytics: Add DESIGN event: {eventId:choice_made_ch01, value:0.0}
        const m = line.match(/(?:Add\s+(?:DESIGN|BUSINESS|PROGRESSION|RESOURCE)\s+event:\s*)?\{eventId:([^,}]+)/i);
        if (!m) return null;
        const evName = m[1].trim();
        const params = {};
        // Try to capture value
        const v = line.match(/value:\s*([0-9.\-]+)/i);
        if (v) params.value = Number(v[1]);
        return { name: evName, params };
    }

    function parseAppsFlyer(line) {
        // I AF_LOG: Sending event: choice_made, params: {choice_id=ch01}
        // OR D AppsFlyerLib: Event log: choice_made
        const m = line.match(/(?:Sending event|Event log|trackEvent)\s*[:\s]\s*([\w.]+)/i);
        if (!m) return null;
        let params = {};
        const p = line.match(/\{([^}]*)\}/);
        if (p) params = parseBundleString(p[1]);
        return { name: m[1], params };
    }

    function parseGenericJsonName(line) {
        // Last-resort: any JSON-shaped substring with a known choice-name key
        const nameKeyRe = /"(eventName|event_name|name|event)"\s*:\s*"([^"]+)"/;
        const m = line.match(nameKeyRe);
        if (!m) return null;
        const name = m[2];
        if (!patterns.isChoiceEventName(name)) return null;
        // Try to extract a balanced JSON nearby
        const idx = line.indexOf('{');
        if (idx < 0) return { name, params: {} };
        const jsonStr = extractBalancedJson(line, idx);
        if (!jsonStr) return { name, params: {} };
        try {
            const obj = JSON.parse(jsonStr);
            return { name, params: stripWrapperKeys(obj, ['eventName', 'event_name', 'name', 'event']) };
        } catch (_) {
            return { name, params: {} };
        }
    }

    const PARSERS = [
        parseFbInlineJson,
        parseUnityFbWrapper,
        parseFirebaseEvent,
        parseGameAnalytics,
        parseAppsFlyer,
        parseGenericJsonName
    ];

    function processLine(line) {
        if (!line) return null;
        if (!patterns.looksLikeChoiceLine(line)) return null;

        const header = parseLogcatHeader(line);
        const time = header ? header.time : null;
        const timeMs = parseLogcatTimeMs(time);
        const pid = header ? header.pid : null;
        const sourceHint = guessSource(line);

        for (const fn of PARSERS) {
            let parsed;
            try { parsed = fn(line); } catch (_) { continue; }
            if (!parsed || !parsed.name) continue;
            if (!patterns.isChoiceEventName(parsed.name)) continue;

            return recordEvent({
                name: parsed.name,
                params: parsed.params || {},
                source: sourceHint,
                raw: line,
                logcatTime: time,
                logcatTimeMs: timeMs,
                pid
            });
        }

        // Line looked like a choice but no parser caught it — log issue only
        // if line clearly references choice keywords AND has JSON-shape content.
        if ((line.includes('"choice') || /\bchoice_/.test(line)) && line.includes('{')) {
            flagParserIssue(line, 'choice keyword + JSON shape but no parser matched');
        }
        return null;
    }

    function processLines(lines) {
        if (!Array.isArray(lines)) return;
        for (const line of lines) processLine(line);
    }

    function getSnapshot() {
        const byChapter = {};
        const byChoiceId = {};
        for (const [k, v] of chapterHistogram.entries())   byChapter[k]  = v;
        for (const [k, v] of choiceIdHistogram.entries())  byChoiceId[k] = v;
        return {
            status: {
                packageName,
                startedAt: startedAtMs,
                firstChoiceAt: firstChoiceLineAtMs
            },
            counts: { ...counts, retainedEvents: events.length },
            events: events.slice(),
            byChapter,
            byChoiceId,
            coverage: getCoverage(),                 // null unless a manifest is loaded
            manifestLoaded: !!manifest,
            parserIssues: parserIssues.slice()
        };
    }

    function getReportSummary() {
        const byChapter = {};
        const byChoiceId = {};
        for (const [k, v] of chapterHistogram.entries())   byChapter[k]  = v;
        for (const [k, v] of choiceIdHistogram.entries())  byChoiceId[k] = v;
        return {
            packageName,
            counts: { ...counts },
            uniqueChoicesTested: counts.unique,
            chaptersExercised: Object.keys(byChapter),
            byChapter,
            byChoiceId,
            coverage: getCoverage(),                 // null unless a manifest is loaded
            // Sample of recent events for the saved report (capped)
            sampleEvents: events.slice(-50).map(e => ({
                name: e.name,
                choiceId: e.choiceId,
                chapter: e.chapter,
                text: e.text,
                isPremium: e.isPremium,
                source: e.source,
                recordedAt: e.recordedAt
            }))
        };
    }

    return { init, reset, processLine, processLines, getSnapshot, getReportSummary,
             setManifest, clearManifest, getCoverage };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stripWrapperKeys(obj, wrapperKeys) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (wrapperKeys.includes(k)) continue;
        out[k] = v;
    }
    return out;
}

function extractBalancedJson(s, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = false; continue; }
        } else {
            if (c === '"') { inStr = true; continue; }
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return s.slice(start, i + 1);
            }
        }
    }
    return null;
}

// Firebase logs params as Bundle[{key1=val1, key2=val2, ...}]. We turn that
// into a plain object with simple string values.
function parseBundleString(body) {
    const out = {};
    const re = /([\w_]+)=([^,]+?)(?=,\s*[\w_]+=|$)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        out[m[1]] = m[2].trim();
    }
    return out;
}

// Reuse the threadtime/brief header parsing from fbEventParser semantics —
// inlined here so this module has no inter-module coupling.
const LOG_HEADER_RE = new RegExp(
    '^' +
    '(?<time>\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d{3})?\\s*' +
    '(?<pid>\\d{1,7})?\\s*' +
    '(?:\\d{1,7})?\\s*' +
    '(?:[VDIWEF](?:\\/|\\s+))?' +
    '[A-Za-z0-9_.]+' +
    '(?:\\(\\s*\\d+\\s*\\))?' +
    '\\s*:\\s*'
);

function parseLogcatHeader(line) {
    const m = line.match(LOG_HEADER_RE);
    if (!m) return null;
    return {
        time: m.groups?.time || null,
        pid: m.groups?.pid ? Number(m.groups.pid) : null
    };
}

const CURRENT_YEAR = new Date().getFullYear();
function parseLogcatTimeMs(timeStr) {
    if (!timeStr) return null;
    const m = timeStr.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
    if (!m) return null;
    const [, mm, dd, hh, mi, ss, ms] = m;
    return new Date(CURRENT_YEAR, +mm - 1, +dd, +hh, +mi, +ss, +ms).getTime();
}

function guessSource(line) {
    if (line.includes('AppEvents') || line.includes('FacebookSDK') || line.includes('com.facebook')) return 'fb';
    if (line.includes('FA-Event') || line.includes('FirebaseAnalytics') || line.includes('FA-SVC')) return 'firebase';
    if (line.includes('GameAnalytics')) return 'gameanalytics';
    if (line.includes('AppsFlyer') || line.includes('AF_LOG')) return 'appsflyer';
    if (line.includes('Adjust')) return 'adjust';
    return 'generic';
}

// Single shared instance — matches the fbEventTracker singleton pattern used
// elsewhere in this codebase (one active session at a time).
const choiceEventTracker = createChoiceEventTracker();

module.exports = {
    createChoiceEventTracker,    // exposed for unit tests
    choiceEventTracker           // singleton used by realtimeMonitor + main
};
