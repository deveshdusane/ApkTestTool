/**
 * Log Analyzer Utility
 * Scans logcat files for crashes, errors, ANRs, and TestMate SDK events.
 */

const fs = require('fs');

// ── TestMate SDK event definitions ────────────────────────────────────────────
const TESTMATE_TAG = '[TESTMATE]';

/**
 * Extracts a TestMate SDK event from a logcat line.
 * Returns null if the line doesn't contain the TESTMATE tag.
 * @param {string} line
 * @returns {{ name: string, metadata: string } | null}
 */
function extractTestMateEvent(line) {
    const idx = line.indexOf(TESTMATE_TAG);
    if (idx === -1) return null;

    const payload = line.slice(idx + TESTMATE_TAG.length).trim();
    const pipeIdx = payload.indexOf('|');
    const name = (pipeIdx === -1 ? payload : payload.slice(0, pipeIdx)).trim();
    const metadata = pipeIdx === -1 ? '' : payload.slice(pipeIdx + 1).trim();

    return { name, metadata };
}

// ── Issue classifier ──────────────────────────────────────────────────────────
/**
 * Classifies an issue based on line content.
 * @param {string} line
 * @returns {Object|null}
 */
function classifyIssue(line) {
    const message = line.trim();

    // 1. Crash (Fatal)
    if (line.includes('FATAL EXCEPTION') || line.includes('backtrace:') || line.includes('DEBUG  : *** *** ***'))
        return { type: 'Crash', priority: 'HIGH', message };

    // 2. ANR
    if (line.includes('ANR') || line.includes('Application Not Responding'))
        return { type: 'Crash', priority: 'HIGH', message: 'Application Not Responding (ANR) detected in main thread' };

    // 3. Memory / OOM
    if (line.includes('OutOfMemoryError') || (line.includes('GC_FOR_ALLOC') && line.includes('paused')))
        return { type: 'Memory', priority: 'HIGH', message: 'Low memory or OutOfMemoryError detected' };

    // 4. Security / Permissions
    if (line.includes('SecurityException') || line.includes('Permission denied'))
        return { type: 'Security', priority: 'HIGH', message };

    // 5. Database
    if (line.includes('SQLiteException') || line.includes('database is locked'))
        return { type: 'Database', priority: 'MEDIUM', message };

    // 6. Network
    if (line.toLowerCase().includes('timeout') || line.toLowerCase().includes('failed to connect') ||
        line.toLowerCase().includes('http') || line.includes('UnknownHostException'))
        return { type: 'Network', priority: 'MEDIUM', message };

    // 7. UI/Rendering
    if (line.toLowerCase().includes('rendering') || line.toLowerCase().includes('view') ||
        line.toLowerCase().includes('layout') || line.includes('Choreographer: Skipped'))
        return { type: 'UI', priority: 'LOW', message };

    // 8. Runtime Error / Exception
    if (line.includes('Exception') || line.includes('Error'))
        return { type: 'Runtime Error', priority: 'MEDIUM', message };

    return null;
}

// ── Main analyzer ─────────────────────────────────────────────────────────────
/**
 * Analyzes a log file and returns structured results including SDK events.
 * @param {string} logFilePath Path to the logs.txt file.
 * @returns {Object} Analysis results.
 */
const analyzeLogFile = (logFilePath) => {
    if (!fs.existsSync(logFilePath)) {
        return {
            crashDetected: false,
            anrDetected: false,
            lifecycleResumed: false,
            errorCount: 0,
            crashCount: 0,
            anrCount: 0,
            issues: [],
            sdkEvents: [],
            sdkEventNames: [],
            sdkEventCounts: {}
        };
    }

    const content = fs.readFileSync(logFilePath, 'utf8');
    const lines = content.split('\n');

    const results = {
        crashDetected: false,
        anrDetected: false,
        lifecycleResumed: false,
        errorCount: 0,
        crashCount: 0,
        anrCount: 0,
        issues: [],
        // SDK event tracking
        sdkEvents: [],          // raw ordered list: { name, metadata }
        sdkEventNames: [],          // deduplicated name-only list for report
        sdkEventCounts: {}           // { EVENT_NAME: count }
    };

    const seenIssues = new Set();

    const seenErrors = new Set();
    const seenCrashes = new Set();
    const seenAnrs = new Set();

    lines.forEach(line => {
        // ── TestMate SDK events (priority — extracted before issue classifier) ──
        const sdkEvent = extractTestMateEvent(line);
        if (sdkEvent) {
            results.sdkEvents.push(sdkEvent);
            results.sdkEventCounts[sdkEvent.name] = (results.sdkEventCounts[sdkEvent.name] || 0) + 1;
            if (!results.sdkEventNames.includes(sdkEvent.name)) {
                results.sdkEventNames.push(sdkEvent.name);
            }
            return; 
        }

        // ── Standard log counts (Improved accuracy with deduplication) ──
        if (line.includes('FATAL EXCEPTION') || line.includes('backtrace:')) {
            const crashKey = line.substring(0, 50); 
            if (!seenCrashes.has(crashKey)) {
                results.crashCount++;
                seenCrashes.add(crashKey);
            }
        }
        // Count distinct ANR events. The canonical per-event marker is the
        // ActivityManager line "ANR in <pkg>"; the rest of the ANR dump is
        // context. Match that (and the long-form text) and dedup so the
        // multi-line dump doesn't inflate the count — but multiple separate
        // ANRs in one session are now counted individually (was hardcoded 1).
        if (/\bANR in\b/i.test(line) || line.includes('Application Not Responding')) {
            const anrKey = line.substring(0, 80);
            if (!seenAnrs.has(anrKey)) {
                results.anrCount++;
                seenAnrs.add(anrKey);
            }
        }
        if (line.includes('Exception') || line.includes('Error')) {
            const errorKey = line.substring(0, 80);
            if (!seenErrors.has(errorKey)) {
                results.errorCount++;
                seenErrors.add(errorKey);
            }
        }

        // ── Lifecycle detection ────────────────────────────────────────────
        if (line.toLowerCase().includes('onresume') ||
            line.toLowerCase().includes('displayed') ||
            line.toLowerCase().includes('oncreate')) {
            results.lifecycleResumed = true;
        }

        // ── Also treat SCENE_LOADED / SESSION_START as lifecycle signal
        //    (even without SDK, if detected from earlier scan pass — N/A here
        //    but kept for clarity)

        // ── Issue classification ───────────────────────────────────────────
        const issue = classifyIssue(line);
        if (issue) {
            const shortMsg = issue.message.substring(0, 100);
            if (!seenIssues.has(shortMsg)) {
                results.issues.push(issue);
                seenIssues.add(shortMsg);
            }
        }
    });

    results.crashDetected = results.crashCount > 0;
    results.anrDetected = results.anrCount > 0;

    // If SDK reported SCENE_LOADED, treat lifecycle as resumed
    if (results.sdkEventCounts['SCENE_LOADED'] > 0 || results.sdkEventCounts['SESSION_START'] > 0) {
        results.lifecycleResumed = true;
    }

    // Sort issues by priority (HIGH first)
    const priorityMap = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    results.issues.sort((a, b) => priorityMap[b.priority] - priorityMap[a.priority]);

    return results;
};

module.exports = { analyzeLogFile };
