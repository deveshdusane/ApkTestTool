/**
 * Progression Tracker — chapter/level start & completion coverage.
 *
 * Narrative/level games log progression as GameAnalytics design events. This
 * tracker observes the START and COMPLETE markers in the same logcat stream the
 * choiceEventTracker uses, so QA can see which chapters/levels were reached and
 * which actually finished during a session.
 *
 * IMPORTANT — accuracy over coverage:
 *   • Patterns are ANCHORED and conservative. Real games mix vocabularies
 *     (day-based "2_start" vs level-based "level_end_time:level_005"), and ad
 *     events look deceptively similar ("interstitial:dayend" is an AD, NOT a
 *     level-end; "CD:Level_6_10" is a cooldown, not a start). We deliberately
 *     do NOT match generic "end"/"level" substrings, to avoid false positives.
 *   • We report OBSERVED starts and completes (two lists + counts + a time-
 *     ordered timeline). We do NOT fabricate a matched start→complete funnel
 *     when the two use different id schemes — that would be a guess.
 *   • Never throws; empty stream → clean "nothing observed" snapshot.
 *
 * Fed exactly like choiceEventTracker: init() on session start, processLines()
 * per logcat batch, getSnapshot()/getReportSummary() to read.
 */

const MAX_EVENTS = 500;

// ── START markers ───────────────────────────────────────────────────────────
// "2_start", "4_start" (day/level N), "day3_start", "chapter2 start",
// "level_start", "chapter_start". Anchored so "restart_button" etc. don't match.
const START_PATTERNS = [
    /^(\d+)_start$/i,                                              // 2_start, 4_start
    /^(?:day|chapter|chap|level|lvl|stage|episode|ep|scene|act)[ _-]?([A-Za-z0-9]+?)[ _-]?start$/i, // day3_start
    /^(?:level|chapter|stage|episode|scene|act)_start$/i          // level_start (no id)
];

// ── COMPLETE markers ──────────────────────────────────────────────────────────
// "level_end_time:level_005", "level_end", "level_complete",
// "day3_complete", "chapter2 cleared". We anchor on level_end / explicit
// complete-keywords; we DO NOT match a bare "end" token (so "interstitial:dayend"
// and similar ad events are correctly ignored).
const COMPLETE_PATTERNS = [
    /^level_end(?:_time)?(?:[ :_-]+(.+))?$/i,                     // level_end_time:level_005
    /^(\d+)_(?:complete|finish|finished|cleared|done)$/i,         // 3_complete
    /^(?:day|chapter|chap|level|lvl|stage|episode|ep|scene|act)[ _-]?([A-Za-z0-9]+?)[ _-]?(?:complete|finish|finished|cleared|end)$/i, // day3_complete, chapter2_end
    /^(?:level|chapter|stage|episode|scene|act)_(?:complete|finish|finished|cleared)$/i // level_complete (no id)
];

function classify(name) {
    if (!name) return null;
    const n = String(name).trim();
    for (const re of START_PATTERNS) {
        const m = n.match(re);
        if (m) return { kind: 'start', unit: (m[1] || '').trim() || null };
    }
    for (const re of COMPLETE_PATTERNS) {
        const m = n.match(re);
        if (m) return { kind: 'complete', unit: (m[1] || '').trim() || null };
    }
    return null;
}

function createProgressionTracker() {
    let packageName = null;
    const events = [];                 // { name, kind, unit, source, recordedAt }
    const startedUnits = new Map();    // unit -> count
    const completedUnits = new Map();  // unit -> count
    const counts = { starts: 0, completes: 0, uniqueStarted: 0, uniqueCompleted: 0 };

    function init({ packageName: pkg } = {}) {
        packageName = pkg || null;
        events.length = 0;
        startedUnits.clear();
        completedUnits.clear();
        counts.starts = counts.completes = counts.uniqueStarted = counts.uniqueCompleted = 0;
    }

    function reset() { init({ packageName }); }

    // Accepts a parsed event { name, source, recordedAt } — designed to be called
    // by the same code that feeds choiceEventTracker, OR standalone via the GA
    // design-event id. Returns the recorded progression event or null.
    function record({ name, source, recordedAt }) {
        const c = classify(name);
        if (!c) return null;
        const evt = {
            name,
            kind: c.kind,
            unit: c.unit,
            source: source || 'gameanalytics',
            recordedAt: recordedAt || null
        };
        events.push(evt);
        if (events.length > MAX_EVENTS) events.shift();

        const bag = c.kind === 'start' ? startedUnits : completedUnits;
        const key = c.unit || '(unlabeled)';
        if (!bag.has(key)) {
            if (c.kind === 'start') counts.uniqueStarted++; else counts.uniqueCompleted++;
        }
        bag.set(key, (bag.get(key) || 0) + 1);
        if (c.kind === 'start') counts.starts++; else counts.completes++;
        return evt;
    }

    function getSnapshot() {
        const started = {};
        const completed = {};
        for (const [k, v] of startedUnits) started[k] = v;
        for (const [k, v] of completedUnits) completed[k] = v;
        // Informational: units that were started but never seen completing.
        const incomplete = Object.keys(started).filter(u => !(u in completed));
        return {
            status: { packageName },
            counts: { ...counts, incomplete: incomplete.length },
            started,
            completed,
            incomplete,
            events: events.slice()
        };
    }

    function getReportSummary() {
        const snap = getSnapshot();
        return {
            packageName,
            counts: snap.counts,
            startedUnits: Object.keys(snap.started),
            completedUnits: Object.keys(snap.completed),
            incomplete: snap.incomplete,
            timeline: events.slice(-50).map(e => ({ name: e.name, kind: e.kind, unit: e.unit, recordedAt: e.recordedAt }))
        };
    }

    // Feed raw logcat lines (same call site as choiceEventTracker). Progression
    // markers for this genre are GameAnalytics design events — extract the
    // eventId and classify. Non-GA / non-progression lines are ignored cheaply.
    function processLine(line) {
        if (!line) return null;
        const m = line.match(/\{eventId:([^,}]+)/i);
        if (!m) return null;
        const name = m[1].trim();
        if (!classify(name)) return null;
        const tm = line.match(/(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
        return record({ name, source: 'gameanalytics', recordedAt: tm ? tm[1] : null });
    }

    function processLines(lines) {
        if (!Array.isArray(lines)) return;
        for (const line of lines) processLine(line);
    }

    return { init, reset, record, processLine, processLines, classify, getSnapshot, getReportSummary };
}

const progressionTracker = createProgressionTracker();

module.exports = {
    createProgressionTracker,   // for unit tests
    progressionTracker,         // singleton
    classify                    // exposed for tests
};
