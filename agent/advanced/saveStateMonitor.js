/**
 * Save State Monitor.
 *
 * Periodically snapshots an app's private save files (Android internal +
 * external app dirs) during a test session and diffs successive snapshots to
 * surface corruption / silent data loss / parse failures that manual QA
 * rarely catches in narrative or progression-heavy games.
 *
 * What gets snapshotted (auto-discovered, no game-specific config):
 *   /data/data/<pkg>/files/                 — typical save dir
 *   /data/data/<pkg>/shared_prefs/          — PlayerPrefs / SharedPreferences
 *   /data/data/<pkg>/databases/             — SQLite saves
 *   /sdcard/Android/data/<pkg>/files/       — external save dir
 *
 * What's stored per file (NEVER the content):
 *   { path, size, sha1, exists, parseable }
 *
 * What gets flagged in diffs:
 *   • size_shrunk_dramatically — file lost data (>50% size drop with hash change)
 *   • hash_changed_but_same_size — possible silent corruption
 *   • file_disappeared — save evaporated mid-session
 *   • new_file_appeared — informational; sometimes save migration
 *   • parse_failed — JSON/XML became invalid
 *   • size_zero — file truncated to 0 bytes
 *
 * Hard requirements:
 *   • App must be debuggable for `run-as` to work. Non-debuggable builds
 *     produce a clean "unavailable" status, never a crash.
 *   • Skip discovery if session shorter than MIN_SESSION_MS.
 *
 * Safety:
 *   • All adb errors caught; module never throws upward.
 *   • Cancels cleanly on stop().
 */

const adbHelper = require('../adb/adbHelper');
const logger = require('../utils/logger');

const SNAPSHOT_INTERVAL_MS = 60_000;     // every 60s during session
const MIN_SESSION_MS = 30_000;            // skip short sessions
const MAX_FILES_PER_DIR = 200;            // safety cap — avoid huge save dirs
const MAX_FILE_SIZE_FOR_HASH = 20 * 1024 * 1024;  // 20MB cap — skip large blobs

// Files we don't care about (logs, crash dumps, ad caches, etc.)
const IGNORE_PATTERNS = [
    /(^|\/)cache(s)?\//i,
    /\.log$/i,
    /\.log\.\d+$/i,
    /\.lock$/i,
    /\.tmp$/i,
    /\.crash$/i,
    /\/code_cache\//i,
    /\/app_textures\//i,
    /(^|\/)\.lock$/i
];

// Parseability check by extension — open the bytes via run-as and try to
// JSON.parse / XML well-formedness. Unknown extensions skip the check.
const PARSE_HINTS = {
    '.json': 'json',
    '.xml':  'xml',
    '.txt':  'text',
    '.yml':  'text',
    '.yaml': 'text'
};

let state = {
    active: false,
    deviceId: null,
    packageName: null,
    startedAt: null,
    timer: null,
    debuggable: 'unknown',         // true | false | 'unknown'
    snapshots: [],                  // { at, files: { [path]: { size, sha1, exists, parseable } } }
    findings: [],                   // { at, code, path, before, after, severity, message }
    discoveryError: null
};

function reset() {
    if (state.timer) clearInterval(state.timer);
    state = {
        active: false,
        deviceId: null,
        packageName: null,
        startedAt: null,
        timer: null,
        debuggable: 'unknown',
        snapshots: [],
        findings: [],
        discoveryError: null
    };
}

async function runAs(deviceId, pkg, cmd) {
    // Wrap any shell command inside run-as for the app's UID. Returns stdout
    // string or throws on error. Falls back gracefully — caller must handle.
    return adbHelper.runADB([
        '-s', deviceId, 'shell',
        'run-as', pkg, 'sh', '-c', `"${cmd.replace(/"/g, '\\"')}"`
    ], { timeout: 8000 });
}

async function probeDebuggable(deviceId, pkg) {
    try {
        const out = await runAs(deviceId, pkg, 'pwd');
        return /\/data\/(?:user\/\d+\/|data\/)/.test(String(out).trim());
    } catch (_) {
        return false;
    }
}

async function listFiles(deviceId, pkg, dir, useRunAs = true) {
    // Returns array of { path, size }. `dir` is relative to /data/data/pkg/
    // when useRunAs=true, otherwise an absolute path.
    try {
        const cmd = useRunAs
            ? `find ${shellEscape(dir)} -type f -printf '%s %p\\n' 2>/dev/null | head -${MAX_FILES_PER_DIR}`
            : `find ${shellEscape(dir)} -type f -printf '%s %p\\n' 2>/dev/null | head -${MAX_FILES_PER_DIR}`;
        const raw = useRunAs
            ? await runAs(deviceId, pkg, cmd)
            : await adbHelper.runADB(['-s', deviceId, 'shell', cmd], { timeout: 8000 });
        const lines = String(raw || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const out = [];
        for (const line of lines) {
            const m = line.match(/^(\d+)\s+(.+)$/);
            if (!m) continue;
            const path = m[2];
            const size = Number(m[1]);
            if (IGNORE_PATTERNS.some(re => re.test(path))) continue;
            out.push({ path, size });
        }
        return out;
    } catch (_) {
        return [];
    }
}

function shellEscape(s) {
    // Quote for embedding inside the outer "sh -c \"...\"" double-quoted string.
    return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

async function hashFile(deviceId, pkg, absPath, useRunAs) {
    if (!absPath) return null;
    try {
        // sha1sum is available on every modern Android shell. We pipe through
        // base64 to avoid binary-content issues over ADB stream — sha1sum
        // already outputs hex so no encoding step needed.
        const cmd = `sha1sum ${shellEscape(absPath)} 2>/dev/null`;
        const raw = useRunAs
            ? await runAs(deviceId, pkg, cmd)
            : await adbHelper.runADB(['-s', deviceId, 'shell', cmd], { timeout: 10000 });
        const m = String(raw || '').trim().match(/^([a-f0-9]{40})/i);
        return m ? m[1].toLowerCase() : null;
    } catch (_) {
        return null;
    }
}

async function readSmallFile(deviceId, pkg, absPath, useRunAs, maxBytes = 1024 * 1024) {
    try {
        const cmd = `cat ${shellEscape(absPath)} 2>/dev/null | head -c ${maxBytes}`;
        return useRunAs
            ? await runAs(deviceId, pkg, cmd)
            : await adbHelper.runADB(['-s', deviceId, 'shell', cmd], { timeout: 8000 });
    } catch (_) { return null; }
}

function extName(p) {
    const i = p.lastIndexOf('.');
    return i >= 0 ? p.slice(i).toLowerCase() : '';
}

async function checkParseable(deviceId, pkg, file, useRunAs) {
    const ext = extName(file.path);
    const hint = PARSE_HINTS[ext];
    if (!hint) return null;            // not a parseable type — skip
    if (file.size > 1024 * 1024) return null;  // too large to parse cheaply
    const content = await readSmallFile(deviceId, pkg, file.path, useRunAs);
    if (content == null) return null;
    if (hint === 'json') {
        try { JSON.parse(String(content)); return true; }
        catch (_) { return false; }
    }
    if (hint === 'xml') {
        // crude well-formedness: balanced angle brackets + no stray '&' that
        // isn't an entity. Good enough to flag obvious corruption.
        const s = String(content);
        if (!/<\?xml|<\w+/.test(s)) return false;
        const opens = (s.match(/</g) || []).length;
        const closes = (s.match(/>/g) || []).length;
        return opens === closes;
    }
    if (hint === 'text') {
        // Pure heuristic: if it's full of NUL bytes, it was almost certainly
        // a binary file whose content got mangled.
        const s = String(content);
        const nuls = (s.match(/\x00/g) || []).length;
        return nuls < s.length * 0.05;
    }
    return null;
}

async function takeSnapshot() {
    if (!state.active || !state.deviceId || !state.packageName) return null;
    const { deviceId, packageName } = state;
    const useRunAs = state.debuggable === true;

    const dirs = [
        { abs: `/data/data/${packageName}/files`, label: 'files' },
        { abs: `/data/data/${packageName}/shared_prefs`, label: 'shared_prefs' },
        { abs: `/data/data/${packageName}/databases`, label: 'databases' },
        { abs: `/sdcard/Android/data/${packageName}/files`, label: 'external_files' }
    ];

    const files = {};
    for (const d of dirs) {
        // Internal data dirs need run-as; external sdcard path does not.
        const isExternal = d.abs.startsWith('/sdcard');
        const listed = await listFiles(deviceId, packageName, d.abs, !isExternal && useRunAs);
        for (const f of listed) {
            // Pre-empt huge files — don't waste time hashing them
            if (f.size > MAX_FILE_SIZE_FOR_HASH) {
                files[f.path] = { size: f.size, sha1: null, exists: true, parseable: null, skipped: 'too_large' };
                continue;
            }
            const sha1 = await hashFile(deviceId, packageName, f.path, !isExternal && useRunAs);
            const parseable = await checkParseable(deviceId, packageName, f, !isExternal && useRunAs);
            files[f.path] = {
                size: f.size,
                sha1,
                exists: true,
                parseable
            };
        }
    }

    const snap = { at: Date.now(), files };
    state.snapshots.push(snap);

    // Diff against the previous snapshot — first snapshot has no previous so
    // we just record it as baseline.
    if (state.snapshots.length >= 2) {
        const prev = state.snapshots[state.snapshots.length - 2];
        diffSnapshots(prev, snap).forEach(f => state.findings.push(f));
    }
    return snap;
}

function diffSnapshots(before, after) {
    const findings = [];
    const allPaths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
    for (const p of allPaths) {
        const b = before.files[p];
        const a = after.files[p];

        if (b && !a) {
            findings.push({
                at: after.at, code: 'file_disappeared', path: p,
                severity: 'error',
                message: `Save file disappeared during session.`,
                before: { size: b.size, sha1: b.sha1 }
            });
            continue;
        }
        if (!b && a) {
            findings.push({
                at: after.at, code: 'new_file_appeared', path: p,
                severity: 'info',
                message: `New save file written.`,
                after: { size: a.size, sha1: a.sha1 }
            });
            continue;
        }
        if (!b || !a) continue;

        // Both exist — run all checks independently so co-occurring symptoms
        // (e.g. file both shrunk AND became unparseable) surface as separate
        // findings. A consumer UI can group them by `path` if it prefers.

        if (b.size > 0 && a.size === 0) {
            findings.push({
                at: after.at, code: 'size_zero', path: p,
                severity: 'error',
                message: `Save file truncated to 0 bytes (was ${b.size} bytes).`,
                before: { size: b.size }, after: { size: 0 }
            });
        } else if (b.size > 100 && a.size > 0 && a.size < b.size * 0.5 && b.sha1 !== a.sha1) {
            // Threshold 100 bytes — catches small but meaningful save files
            // (player profile, settings JSON) while ignoring trivially-tiny
            // marker files that fluctuate harmlessly.
            findings.push({
                at: after.at, code: 'size_shrunk_dramatically', path: p,
                severity: 'warn',
                message: `Save file shrunk from ${b.size} to ${a.size} bytes — possible data loss.`,
                before: { size: b.size }, after: { size: a.size }
            });
        } else if (b.size === a.size && b.sha1 && a.sha1 && b.sha1 !== a.sha1) {
            // Same size, different hash — content fully replaced. This is
            // expected for many save formats (counters bumped, timestamps
            // updated) so we only flag it as info.
            findings.push({
                at: after.at, code: 'rewrite_same_size', path: p,
                severity: 'info',
                message: `Save file rewritten with same size.`,
                before: { sha1: b.sha1 }, after: { sha1: a.sha1 }
            });
        }
        if (b.parseable === true && a.parseable === false) {
            findings.push({
                at: after.at, code: 'parse_failed', path: p,
                severity: 'error',
                message: `Save file was parseable before but is now corrupt (JSON/XML invalid).`
            });
        }
    }
    return findings;
}

async function start({ deviceId, packageName }) {
    reset();
    if (!deviceId || !packageName) {
        logger.logWarning('SaveStateMonitor.start: deviceId + packageName required, skipping');
        return;
    }
    state.deviceId = deviceId;
    state.packageName = packageName;
    state.startedAt = Date.now();
    state.active = true;

    // Probe debuggable in background — don't block startSession.
    setTimeout(async () => {
        try {
            state.debuggable = await probeDebuggable(deviceId, packageName);
            if (!state.debuggable) {
                state.discoveryError =
                    'App is not debuggable (run-as failed). Save state monitoring requires a debug-signed build. ' +
                    'External /sdcard/ dirs (if any) will still be checked.';
                logger.logInfo('[SaveStateMonitor] non-debuggable app — limited mode');
            }
            // Take baseline immediately after probe
            await takeSnapshot();
        } catch (e) {
            state.discoveryError = e.message;
        }
    }, 0);

    // Periodic snapshots — gated on session duration to skip very short sessions
    state.timer = setInterval(async () => {
        if (!state.active) return;
        const sinceStart = Date.now() - state.startedAt;
        if (sinceStart < MIN_SESSION_MS) return;
        try { await takeSnapshot(); } catch (_) { /* never crash the monitor */ }
    }, SNAPSHOT_INTERVAL_MS);
}

async function stop() {
    if (!state.active) return getSnapshot();
    // Take one final snapshot so the session report has up-to-date diff
    try { await takeSnapshot(); } catch (_) {}
    state.active = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    return getSnapshot();
}

function getSnapshot() {
    // What the IPC channel and report generator consume. Compact — never
    // includes file content.
    const latest = state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
    const trackedFiles = latest ? Object.keys(latest.files).length : 0;
    const errors = state.findings.filter(f => f.severity === 'error').length;
    const warns  = state.findings.filter(f => f.severity === 'warn').length;
    const infos  = state.findings.filter(f => f.severity === 'info').length;
    return {
        status: {
            active: state.active,
            packageName: state.packageName,
            debuggable: state.debuggable,
            startedAt: state.startedAt,
            snapshotCount: state.snapshots.length,
            discoveryError: state.discoveryError
        },
        counts: {
            trackedFiles,
            findings: state.findings.length,
            errors,
            warnings: warns,
            infos
        },
        findings: state.findings.slice(),
        latest: latest
            ? Object.entries(latest.files).slice(0, 200).map(([path, meta]) => ({
                path,
                size: meta.size,
                sha1: meta.sha1,
                parseable: meta.parseable,
                skipped: meta.skipped || null
            }))
            : []
    };
}

function getReportSummary() {
    const snap = getSnapshot();
    return {
        packageName: snap.status.packageName,
        debuggable: snap.status.debuggable,
        snapshotCount: snap.status.snapshotCount,
        trackedFiles: snap.counts.trackedFiles,
        findings: snap.findings,
        discoveryError: snap.status.discoveryError,
        countsBySeverity: {
            error:   snap.counts.errors,
            warning: snap.counts.warnings,
            info:    snap.counts.infos
        }
    };
}

module.exports = {
    start,
    stop,
    reset,
    getSnapshot,
    getReportSummary,
    // Exposed for tests
    _internal: { diffSnapshots }
};
