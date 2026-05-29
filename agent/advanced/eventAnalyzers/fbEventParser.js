/**
 * Facebook App Events logcat line parser.
 *
 * Three FB SDK logcat formats are known to exist in the wild; this parser
 * handles all of them. Format is auto-detected from the first matching line
 * and remembered for the session (a single build only ever emits one).
 *
 *   FORMAT_JSON_INLINE   FB SDK 4.x / 13.x / current default with debug on.
 *                        Event JSON sits on the same line as the tag.
 *                        Example:
 *                          D/AppEvents( 1234): { "_eventName":"fb_mobile_purchase",
 *                            "_valueToSum":9.99, "fb_currency":"USD", "_logTime":1700000000 }
 *
 *   FORMAT_VERBOSE       FB SDK with LoggingBehavior.APP_EVENTS enabled. One
 *                        "header" line names the event; the JSON follows on
 *                        the next line (sometimes the same).
 *                        Example:
 *                          D/FacebookSDK.AppEvents: SDKApp Event Logged: fb_mobile_purchase
 *                          D/FacebookSDK.AppEvents: { "_valueToSum": 9.99, ... }
 *
 *   FORMAT_KV_LINES      Some SDK wrappers (especially Unity bridges) print
 *                        events as line-per-field. We handle the most common
 *                        shape: a "Event Name:" line then "Parameters:" line.
 *
 * Public API:
 *   const p = createFbEventParser();
 *   const r = p.parseLine(line);  // -> null | { kind: 'event'|'flush', ... }
 *   p.getFormat();                // -> 'unknown' | one of the FORMAT_* values
 *   p.getSdkVersion();            // -> string | null (from init logs)
 *
 * Returned event shape:
 *   {
 *     kind: 'event',
 *     name: string,
 *     params: Object,
 *     logcatTime: string,         // "MM-DD HH:MM:SS.mmm" as captured
 *     logcatTimeMs: number|null,  // parsed to ms (null if no timestamp)
 *     pid: number|null,
 *     raw: string,
 *     partialParse: boolean,      // true = name extracted but params incomplete
 *     formatUsed: string
 *   }
 *
 * Flush events:
 *   { kind: 'flush', count: number, logcatTime, logcatTimeMs, raw }
 */

const FORMAT_UNKNOWN     = 'unknown';
const FORMAT_JSON_INLINE = 'json-inline';
const FORMAT_VERBOSE     = 'verbose';
const FORMAT_KV_LINES    = 'kv-lines';
const FORMAT_UNITY       = 'unity-wrapper';   // FB SDK for Unity — com.facebook.unity.FB

// Unity FB SDK wraps events as LogAppEvent({...}) where the JSON uses
// `logEvent`/`valueToSum` (no underscore prefix) and nests app params under
// `parameters`. We normalize to canonical FB shape so the validator/catalog
// path works the same as native Android SDK builds.
const UNITY_LOG_APP_EVENT_RE = /LogAppEvent\s*\(\s*(\{[\s\S]*\})\s*\)\s*$/;
const UNITY_SDK_VERSION_RE   = /SetUserAgentSuffix\s*\(\s*Unity\.([0-9][\w.\-]+)\s*\)/;

// FB SDK uses several tag spellings depending on version + wrapper. We match
// any of them. Tag families: AppEvents, FBSDKAppEvents, FacebookSDK.AppEvents,
// FBSDKCoreKit (rare), FBTRACE (rare), com.facebook.unity.FB (Unity wrapper),
// com.facebook.appevents.* (current Android SDK package), com.facebook.* (broad
// catch-all for any FB-namespaced tag).
const FB_TAG = /(?:AppEvents|FBSDKAppEvents|FacebookSDK\.AppEvents|FBSDKCoreKit|FBTRACE|com\.facebook(?:\.[\w.]+)?|FB)/;

// Standard threadtime logcat line shape: "MM-DD HH:MM:SS.mmm  PID  TID L TAG: msg"
// We accept either threadtime ("D AppEvents:") or brief ("D/AppEvents:") format
// because some setups switch. The level-tag separator is either a slash OR
// whitespace — without that, threadtime logs (the `adb logcat` default since
// Android 7) fail to parse and downstream regexes get fed the whole line.
const LINE_HEADER = new RegExp(
    '^' +
    '(?<time>\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d{3})?\\s*' +
    '(?<pid>\\d{1,7})?\\s*' +
    '(?:\\d{1,7})?\\s*' +
    '(?:[VDIWEF](?:\\/|\\s+))?' +
    '(?<tag>[A-Za-z0-9_.]+)' +
    '(?:\\(\\s*(?<pidParen>\\d+)\\s*\\))?' +
    '\\s*:\\s*' +
    '(?<msg>.*)$'
);

// Init/version logs we listen for to surface SDK version in the UI
const VERSION_RE = /FacebookSdk\s+initialized.*?version\s*[=:]\s*([0-9][\w.\-]+)/i;
const VERSION_RE2 = /\bFacebook(?:Sdk)?\s+v(?:ersion)?\s*[:=]\s*([0-9][\w.\-]+)/i;
// Unity FB SDK prints "SetUserAgentSuffix(Unity.<version>)" during init.
const VERSION_RE3 = UNITY_SDK_VERSION_RE;

// Flush-line patterns. Different SDK versions phrase the flush differently;
// we accept any of these and pull the count when present.
const FLUSH_RES = [
    /Flush(?:ing|ed)?\s+(\d+)\s+event/i,
    /persistAndSendAllEvents\s*-\s*persisted\s+(\d+)\s+event/i,
    /Flush complete\s*\((\d+)\s+event/i
];

// Verbose-format event header: "SDKApp Event Logged: <name>" / "Logged event: <name>"
const VERBOSE_HEADER_RES = [
    /SDKApp Event Logged:\s*([\w.]+)/i,
    /Logged event:\s*([\w.]+)/i,
    /AppEvent\s+logEvent\s*\(\s*"([^"]+)"/
];

// KV-format pieces
const KV_NAME_RE   = /Event Name\s*[:=]\s*([\w.]+)/i;
const KV_PARAMS_RE = /Parameters\s*[:=]\s*(\{.*)/i;

const CURRENT_YEAR = new Date().getFullYear();

function parseLogcatTimeMs(timeStr) {
    if (!timeStr) return null;
    // Expecting "MM-DD HH:MM:SS.mmm" — no year, no TZ. We assume current year
    // and local TZ since that's how `adb logcat` emits.
    const m = timeStr.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
    if (!m) return null;
    const [, mm, dd, hh, mi, ss, ms] = m;
    const d = new Date(CURRENT_YEAR, +mm - 1, +dd, +hh, +mi, +ss, +ms);
    return d.getTime();
}

// Extract the first balanced JSON object out of a string. Naive but tolerant
// of FB's habit of trailing commas / embedded curly-strings.
function extractFirstJson(s) {
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
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

function tryJsonParse(jsonStr) {
    try {
        return JSON.parse(jsonStr);
    } catch (_) {
        // FB occasionally emits malformed json (unquoted numbers in strings,
        // trailing commas). Try a couple of forgiving fixes before giving up.
        try {
            const fixed = jsonStr
                .replace(/,\s*([}\]])/g, '$1')          // trailing commas
                .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":'); // bare keys
            return JSON.parse(fixed);
        } catch (_) {
            return null;
        }
    }
}

function createFbEventParser() {
    let format = FORMAT_UNKNOWN;
    let sdkVersion = null;
    let pendingVerbose = null;   // { name, headerLine, headerTime } awaiting next-line JSON
    let pendingKv = null;        // { name, time } awaiting "Parameters: {...}"

    function setFormatOnce(f) {
        if (format === FORMAT_UNKNOWN) format = f;
    }

    function makeEvent({ name, params, time, pid, raw, partialParse, formatUsed }) {
        // _eventName lives in the JSON the SDK emits, but it's just a copy of
        // the event name. Strip it before exposing params so the validator
        // doesn't flag it as "reserved key used as custom param" — the SDK
        // wrote it, not the app, and the renderer's params column doesn't
        // need to repeat the name.
        const cleanParams = params ? Object.assign({}, params) : {};
        delete cleanParams._eventName;
        return {
            kind: 'event',
            name,
            params: cleanParams,
            logcatTime: time || null,
            logcatTimeMs: parseLogcatTimeMs(time),
            pid: pid != null ? Number(pid) : null,
            raw,
            partialParse: !!partialParse,
            formatUsed
        };
    }

    function parseLine(line) {
        if (!line || typeof line !== 'string') return null;
        const header = line.match(LINE_HEADER);
        const msg  = header?.groups?.msg ?? line;
        const tag  = header?.groups?.tag ?? '';
        const time = header?.groups?.time ?? null;
        const pid  = header?.groups?.pid ?? header?.groups?.pidParen ?? null;

        // Cheap pre-filter: skip lines whose tag clearly isn't FB. A few rare
        // wrappers log without a recognizable tag, so we also let lines
        // through that mention "_eventName" anywhere.
        const tagMatches = tag && FB_TAG.test(tag);
        const looksLikeEventBody = msg.includes('"_eventName"') || msg.includes('_eventName=');
        const looksLikeVerbose = VERBOSE_HEADER_RES.some(re => re.test(msg));
        const looksLikeKv = KV_NAME_RE.test(msg) || KV_PARAMS_RE.test(msg);
        const looksLikeUnity = msg.includes('LogAppEvent(');

        if (!tagMatches && !looksLikeEventBody && !looksLikeVerbose && !looksLikeKv && !looksLikeUnity) {
            // Not FB-related. But still capture SDK version if it ever leaks
            // through a different tag.
            const vMatch = msg.match(VERSION_RE) || msg.match(VERSION_RE2) || msg.match(VERSION_RE3);
            if (vMatch) sdkVersion = vMatch[1];
            return null;
        }

        // Version sniff (cheap; runs once per session in practice)
        if (!sdkVersion) {
            const vMatch = msg.match(VERSION_RE) || msg.match(VERSION_RE2) || msg.match(VERSION_RE3);
            if (vMatch) sdkVersion = vMatch[1];
        }

        // ── Flush detection ────────────────────────────────────────────────
        for (const re of FLUSH_RES) {
            const m = msg.match(re);
            if (m) {
                return {
                    kind: 'flush',
                    count: Number(m[1]) || 0,
                    logcatTime: time,
                    logcatTimeMs: parseLogcatTimeMs(time),
                    raw: line
                };
            }
        }

        // ── Format 4: Unity FB SDK wrapper ─────────────────────────────────
        // Lines look like:
        //   V com.facebook.unity.FB: LogAppEvent({"logEvent":"AdImpression",
        //     "valueToSum":"0.0027","parameters":{"fb_currency":"USD"}})
        // The Unity bridge uses `logEvent`/`valueToSum` (no underscore) and
        // nests app params under `parameters`. We normalize to canonical FB
        // shape so the rest of the pipeline (validator, catalog) is reused.
        if (looksLikeUnity) {
            const m = msg.match(UNITY_LOG_APP_EVENT_RE);
            if (m) {
                const obj = tryJsonParse(m[1]);
                if (obj && (obj.logEvent || obj.eventName || obj._eventName)) {
                    const eventName = obj.logEvent || obj.eventName || obj._eventName;
                    const params = {};
                    // Spread `parameters` first (lowest precedence)
                    if (obj.parameters && typeof obj.parameters === 'object') {
                        for (const [k, v] of Object.entries(obj.parameters)) params[k] = v;
                    }
                    // Map top-level Unity keys to canonical underscored names
                    if ('valueToSum' in obj) params._valueToSum = obj.valueToSum;
                    // Preserve any other top-level keys that aren't the wrapper
                    // metadata. Unity SDK occasionally adds `flush`/`isImplicit`.
                    for (const [k, v] of Object.entries(obj)) {
                        if (k === 'logEvent' || k === 'eventName' || k === '_eventName' ||
                            k === 'valueToSum' || k === 'parameters') continue;
                        if (!(k in params)) params[k] = v;
                    }
                    setFormatOnce(FORMAT_UNITY);
                    return makeEvent({
                        name: eventName,
                        params,
                        time, pid, raw: line,
                        formatUsed: FORMAT_UNITY
                    });
                }
                // Wrapper found but JSON didn't parse — partial-extract the
                // event name with a focused regex so we still surface it.
                const nameOnly = m[1].match(/"logEvent"\s*:\s*"([^"]+)"/);
                if (nameOnly) {
                    setFormatOnce(FORMAT_UNITY);
                    return makeEvent({
                        name: nameOnly[1],
                        params: {},
                        time, pid, raw: line,
                        partialParse: true,
                        formatUsed: FORMAT_UNITY
                    });
                }
            }
        }

        // ── Format 1: JSON inline ──────────────────────────────────────────
        // Body contains a JSON object with "_eventName". Most common.
        if (msg.includes('"_eventName"')) {
            const jsonStr = extractFirstJson(msg);
            if (jsonStr) {
                const obj = tryJsonParse(jsonStr);
                if (obj && obj._eventName) {
                    setFormatOnce(FORMAT_JSON_INLINE);
                    return makeEvent({
                        name: obj._eventName,
                        params: obj,
                        time, pid, raw: line,
                        formatUsed: FORMAT_JSON_INLINE
                    });
                }
                // JSON-shaped but couldn't parse — partial event, still useful
                const fallbackName = (msg.match(/"_eventName"\s*:\s*"([^"]+)"/) || [])[1];
                if (fallbackName) {
                    setFormatOnce(FORMAT_JSON_INLINE);
                    return makeEvent({
                        name: fallbackName,
                        params: {},
                        time, pid, raw: line,
                        partialParse: true,
                        formatUsed: FORMAT_JSON_INLINE
                    });
                }
            }
        }

        // ── Format 2: Verbose header ───────────────────────────────────────
        for (const re of VERBOSE_HEADER_RES) {
            const m = msg.match(re);
            if (m) {
                // Does the same line carry a JSON body? Some verbose builds do both.
                const jsonStr = extractFirstJson(msg);
                if (jsonStr) {
                    const obj = tryJsonParse(jsonStr);
                    setFormatOnce(FORMAT_VERBOSE);
                    return makeEvent({
                        name: m[1],
                        params: obj || {},
                        time, pid, raw: line,
                        partialParse: !obj,
                        formatUsed: FORMAT_VERBOSE
                    });
                }
                // Buffer; the next line should have "{...}". If a buffer is
                // already pending, flush it as a partial event (no params).
                if (pendingVerbose) {
                    const stale = pendingVerbose;
                    pendingVerbose = { name: m[1], time, pid, raw: line };
                    setFormatOnce(FORMAT_VERBOSE);
                    return makeEvent({
                        name: stale.name,
                        params: {},
                        time: stale.time, pid: stale.pid, raw: stale.raw,
                        partialParse: true,
                        formatUsed: FORMAT_VERBOSE
                    });
                }
                pendingVerbose = { name: m[1], time, pid, raw: line };
                return null;
            }
        }

        // If a verbose header is pending and this line is "just JSON", attach
        if (pendingVerbose) {
            const jsonStr = extractFirstJson(msg);
            if (jsonStr) {
                const obj = tryJsonParse(jsonStr);
                const v = pendingVerbose;
                pendingVerbose = null;
                setFormatOnce(FORMAT_VERBOSE);
                return makeEvent({
                    name: v.name,
                    params: obj || {},
                    time: v.time, pid: v.pid, raw: v.raw + '\n' + line,
                    partialParse: !obj,
                    formatUsed: FORMAT_VERBOSE
                });
            }
        }

        // ── Format 3: KV-lines ─────────────────────────────────────────────
        const kvName = msg.match(KV_NAME_RE);
        if (kvName) {
            // Look for params on same line first
            const sameLineParams = msg.match(KV_PARAMS_RE);
            if (sameLineParams) {
                const jsonStr = extractFirstJson(sameLineParams[1]);
                const obj = jsonStr ? tryJsonParse(jsonStr) : null;
                setFormatOnce(FORMAT_KV_LINES);
                return makeEvent({
                    name: kvName[1],
                    params: obj || {},
                    time, pid, raw: line,
                    partialParse: !obj,
                    formatUsed: FORMAT_KV_LINES
                });
            }
            pendingKv = { name: kvName[1], time, pid, raw: line };
            return null;
        }
        if (pendingKv) {
            const kvParams = msg.match(KV_PARAMS_RE);
            if (kvParams) {
                const jsonStr = extractFirstJson(kvParams[1]);
                const obj = jsonStr ? tryJsonParse(jsonStr) : null;
                const v = pendingKv;
                pendingKv = null;
                setFormatOnce(FORMAT_KV_LINES);
                return makeEvent({
                    name: v.name,
                    params: obj || {},
                    time: v.time, pid: v.pid, raw: v.raw + '\n' + line,
                    partialParse: !obj,
                    formatUsed: FORMAT_KV_LINES
                });
            }
        }

        return null;
    }

    return {
        parseLine,
        getFormat: () => format,
        getSdkVersion: () => sdkVersion,
        // For tests
        _internal: { extractFirstJson, tryJsonParse, parseLogcatTimeMs }
    };
}

module.exports = {
    createFbEventParser,
    FORMAT_UNKNOWN,
    FORMAT_JSON_INLINE,
    FORMAT_VERBOSE,
    FORMAT_KV_LINES,
    FORMAT_UNITY
};
