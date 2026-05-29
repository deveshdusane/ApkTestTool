/**
 * Stateful per-session Facebook event tracker.
 *
 * Sits behind the live monitor's logcat consumer. For each line the consumer
 * already produces (PID-filtered to the app under test), call:
 *
 *     tracker.processLine(line);
 *
 * and the tracker maintains a queryable snapshot:
 *
 *     tracker.getSnapshot();
 *
 * Snapshot shape is what the renderer consumes for the live UI and what the
 * report generator embeds at session-stop. Keep it small and JSON-serializable
 * — the IPC layer round-trips it.
 *
 * Heuristics worth knowing:
 *   • SDK debug logging detector: if 60s after first FB log line we've only
 *     seen flushes (no per-event JSON), we set debugLoggingOn=false and the
 *     UI shows a "enable debug logging for full visibility" hint.
 *   • Recorded vs Flushed: events start status='recorded'. When a Flush line
 *     reports N events, we mark the N most recently-recorded pending events
 *     as flushed (best-effort — FB doesn't tell us WHICH events flushed).
 *   • Cap: at most MAX_EVENTS retained in memory; older events drop. The
 *     count totals are correct regardless of the cap.
 */

const { createFbEventParser } = require('./fbEventParser');
const { validateEvent } = require('./fbEventValidator');

const MAX_EVENTS = 500;
const MAX_PARSER_ISSUES = 50;
const DEBUG_DETECT_WINDOW_MS = 60_000;
const INACTIVE_DETECT_WINDOW_MS = 30_000;

function createFbEventTracker() {
    let parser = createFbEventParser();
    let packageName = null;
    let startedAtMs = null;
    let firstFbLineAtMs = null;

    const events = [];          // newest-last
    const flushBatches = [];
    const parserIssues = [];    // lines that looked like FB events but failed parse

    // Counters maintained independently of the events array (which is capped).
    const counts = {
        total: 0,
        standard: 0,
        custom: 0,
        auto: 0,
        flushed: 0,
        pending: 0,
        warnings: 0,
        parserIssues: 0
    };

    let eventIdSeq = 0;
    let sawAnyEventBody = false;   // distinguishes "logging on" from "flush-only logs"

    function init({ packageName: pkg } = {}) {
        parser = createFbEventParser();
        packageName = pkg || null;
        startedAtMs = Date.now();
        firstFbLineAtMs = null;
        events.length = 0;
        flushBatches.length = 0;
        parserIssues.length = 0;
        for (const k of Object.keys(counts)) counts[k] = 0;
        eventIdSeq = 0;
        sawAnyEventBody = false;
    }

    function reset() { init({ packageName }); }

    function processLine(line) {
        if (!line) return null;

        // Cheap pre-screen for "this line might be FB" before paying for full
        // regex. Saves cycles on log floods. The list intentionally includes
        // both the Android SDK's native tags AND the Unity wrapper substrings
        // (com.facebook, LogAppEvent, SetUserAgentSuffix) so Unity builds —
        // which use entirely different log shapes — still reach the parser.
        if (
            !line.includes('AppEvents') &&
            !line.includes('AppEvent') &&        // covers Unity "LogAppEvent"
            !line.includes('FacebookSDK') &&
            !line.includes('FBSDK') &&
            !line.includes('FBTRACE') &&
            !line.includes('com.facebook') &&    // catches unity.FB, appevents.*, ads.*
            !line.includes('_eventName') &&
            !line.includes('fb_mobile') &&
            !line.includes('Flush')
        ) {
            return null;
        }

        // Start the inactivity clock as soon as ANY FB-related line is seen —
        // including SDK init lines that don't produce an event (e.g.
        // "SetUserAgentSuffix(Unity.18.0.0)"). Without this, the inactive
        // detector waits for an event before starting the timer, which
        // defeats the whole point.
        if (firstFbLineAtMs == null) firstFbLineAtMs = Date.now();

        const parsed = parser.parseLine(line);
        if (!parsed) {
            // Only flag as a parser issue when the line looks like an inline
            // JSON event body — those are the ones we definitively failed on.
            // Multi-line formats legitimately return null on header lines
            // while buffering, so flagging on "fb_mobile" alone produces a
            // flood of false positives.
            if (
                line.includes('"_eventName"')
                && parserIssues.length < MAX_PARSER_ISSUES
            ) {
                parserIssues.push({
                    at: Date.now(),
                    raw: line.length > 500 ? line.slice(0, 500) + '…' : line,
                    reason: 'inline FB event body could not be parsed'
                });
                counts.parserIssues++;
            }
            return null;
        }

        if (parsed.kind === 'flush') {
            flushBatches.push({
                at: Date.now(),
                logcatTime: parsed.logcatTime,
                count: parsed.count
            });
            // Mark up to `count` most recent pending events as flushed.
            let toFlush = parsed.count;
            for (let i = events.length - 1; i >= 0 && toFlush > 0; i--) {
                const ev = events[i];
                if (ev.status === 'recorded') {
                    ev.status = 'flushed';
                    ev.flushedAt = parsed.logcatTime;
                    ev.flushedAtMs = parsed.logcatTimeMs;
                    counts.flushed++;
                    counts.pending--;
                    toFlush--;
                }
            }
            return { kind: 'flush', count: parsed.count };
        }

        // It's an event
        sawAnyEventBody = true;

        const validation = validateEvent(parsed);
        const evt = {
            id: ++eventIdSeq,
            name: parsed.name,
            type: validation.type,
            params: parsed.params,
            recordedAt: parsed.logcatTime,
            recordedAtMs: parsed.logcatTimeMs,
            flushedAt: null,
            flushedAtMs: null,
            status: 'recorded',
            warnings: validation.warnings,
            valid: validation.valid,
            partialParse: parsed.partialParse,
            pid: parsed.pid,
            raw: parsed.raw
        };

        events.push(evt);
        if (events.length > MAX_EVENTS) events.shift();

        counts.total++;
        if (validation.type === 'standard') counts.standard++;
        else if (validation.type === 'auto') counts.auto++;
        else counts.custom++;
        if (validation.warnings.length > 0) counts.warnings++;
        counts.pending++;

        return { kind: 'event', event: evt };
    }

    function detectDebugLoggingStatus() {
        // Three distinguishable states. Order matters — "inactive" outranks
        // "debug off" because telling a tester to enable debug logging is
        // wrong advice when the SDK isn't firing events at all.
        //
        //   active:   we parsed at least one event JSON — SDK is firing AND
        //             logging full detail.
        //   debug_off: we saw flush summary lines but never an event body —
        //             SDK is firing but verbose logging is disabled.
        //   inactive: SDK was loaded (we saw at least one FB-tagged line so
        //             the version probably surfaced) but no events AND no
        //             flushes after the inactivity window. App likely uses a
        //             different analytics SDK (e.g. GameAnalytics, Firebase).
        if (sawAnyEventBody) return { on: true, inactive: false, message: null };
        if (firstFbLineAtMs == null) return { on: 'unknown', inactive: 'unknown', message: null };

        const elapsed = Date.now() - firstFbLineAtMs;

        // Inactive check first — only requires 30s and "zero everything".
        if (elapsed >= INACTIVE_DETECT_WINDOW_MS &&
            events.length === 0 &&
            flushBatches.length === 0) {
            const v = parser.getSdkVersion();
            return {
                on: 'unknown',
                inactive: true,
                message: `Facebook SDK${v ? ' v' + v : ''} detected, but no App Events fired in this session. ` +
                         `This game may not use Facebook for event tracking — check the events feed below ` +
                         `for other analytics SDKs (GameAnalytics, Firebase, etc.) or confirm with the game team.`
            };
        }

        // Debug-off check — needs the longer window and at least one flush
        if (elapsed >= DEBUG_DETECT_WINDOW_MS && flushBatches.length > 0) {
            return {
                on: false,
                inactive: false,
                message: 'FB SDK debug logging appears OFF — only flush summaries visible, ' +
                         'no per-event parameters. Call FacebookSdk.setIsDebugEnabled(true) ' +
                         '+ addLoggingBehavior(LoggingBehavior.APP_EVENTS) in the test build.'
            };
        }

        return { on: 'unknown', inactive: 'unknown', message: null };
    }

    function getSnapshot() {
        const debug = detectDebugLoggingStatus();
        return {
            status: {
                packageName,
                sdkVersion: parser.getSdkVersion(),
                formatDetected: parser.getFormat(),
                debugLoggingOn: debug.on,
                debugLoggingMessage: debug.message,
                sdkInactive: debug.inactive,
                startedAt: startedAtMs,
                firstFbLineAt: firstFbLineAtMs
            },
            counts: { ...counts, retainedEvents: events.length },
            events: events.slice(),               // shallow copy
            flushBatches: flushBatches.slice(),
            parserIssues: parserIssues.slice()
        };
    }

    function getReportSummary() {
        // Smaller serializable shape for the saved session report.
        const debug = detectDebugLoggingStatus();
        const eventNames = {};
        for (const ev of events) {
            eventNames[ev.name] = (eventNames[ev.name] || 0) + 1;
        }
        return {
            packageName,
            sdkVersion: parser.getSdkVersion(),
            formatDetected: parser.getFormat(),
            debugLoggingOn: debug.on,
            debugLoggingMessage: debug.message,
            sdkInactive: debug.inactive,
            counts: { ...counts },
            uniqueEventNames: Object.keys(eventNames).length,
            byEventName: eventNames,
            // Up to 50 sample events so reports don't bloat
            sampleEvents: events.slice(-50).map(e => ({
                name: e.name,
                type: e.type,
                recordedAt: e.recordedAt,
                flushedAt: e.flushedAt,
                params: e.params,
                warnings: e.warnings,
                partialParse: e.partialParse
            })),
            flushBatchCount: flushBatches.length
        };
    }

    function processLines(lines) {
        if (!Array.isArray(lines)) return;
        for (const line of lines) processLine(line);
    }

    return {
        init,
        reset,
        processLine,
        processLines,
        getSnapshot,
        getReportSummary
    };
}

// Single shared instance — there's only one active session at a time, same
// pattern as scrcpyManager / performanceMonitor in this codebase.
const fbEventTracker = createFbEventTracker();

module.exports = {
    createFbEventTracker,        // exposed for unit tests
    fbEventTracker               // singleton used by monitorEngine + main
};
