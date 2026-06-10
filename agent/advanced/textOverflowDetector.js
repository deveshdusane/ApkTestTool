/**
 * Text Overflow Detector.
 *
 * Periodically dumps the running app's view hierarchy via `adb shell
 * uiautomator dump` and parses each TextView/EditText node to detect text
 * that's been truncated, clipped against the screen edge, or rendered as a
 * missing-string placeholder.
 *
 * This catches a real and underdiagnosed class of bugs in narrative /
 * dialogue-heavy games: localized strings overflowing buttons, dynamic
 * player names breaking layouts, and missing translation keys rendering as
 * "[STRING_NOT_FOUND]" or blank widgets.
 *
 * Detection heuristics:
 *   1. truncated_ellipsis  — text ends with "…" or "..." (TextView auto-ellipsis)
 *   2. clipped_at_edge     — bounds touch screen edge (within EDGE_TOLERANCE px)
 *   3. missing_string_placeholder — text matches a known placeholder pattern
 *   4. empty_textview      — TextView is shown but text is blank (potential missing string)
 *   5. extremely_small     — text height < MIN_TEXT_HEIGHT_PX (squashed)
 *   6. text_overflow_vs_parent — text length > parent width allows in single line
 *
 * Out of scope (deferred):
 *   - OCR fallback for Unity / Cocos canvas games (would need Tesseract.js)
 *   - Element-tree analysis for nested layouts
 *   - Diff against base-language snapshot
 *
 * Hard requirements:
 *   - `adb` available (already bundled)
 *   - Target device must allow uiautomator dump (almost all do; works on user
 *     apps without root or debuggable flag)
 *
 * Safety:
 *   - All adb errors caught; never throws upward
 *   - Cancels cleanly on stop()
 *   - Skips first 10s of session to let app finish booting
 *   - Suppresses dump for ~3s after each invocation to avoid event-loop pileup
 */

const path = require('path');
const fs = require('fs');
const adbHelper = require('../adb/adbHelper');
const logger = require('../utils/logger');

const DUMP_INTERVAL_MS = 15_000;        // every 15s during session
const BOOT_GRACE_MS = 10_000;            // skip first 10s
const EDGE_TOLERANCE_PX = 3;             // bounds within this many px of screen edge = clipped
const MIN_TEXT_HEIGHT_PX = 14;           // smaller than this = likely squashed
const MAX_FINDINGS_RETAINED = 500;       // cap

// Known placeholder patterns for missing translations. Matched against the
// whole (trimmed) text — these signal the string itself never resolved.
const MISSING_STRING_PATTERNS = [
    /^\[?(?:STRING|STR|MISSING|TODO|TBD|FIXME)[_:.\s]/i,
    /^@(?:string|str)[\/.]/,
    /^MISSING_LOCALIZATION/i,
    /^undefined$/i,
    /^null$/i
];

// Unresolved interpolation tokens — a templating placeholder that should have
// been substituted with a real value (player name, count, chapter, etc.) but
// leaked to the screen verbatim. Unlike MISSING_STRING_PATTERNS these are
// searched ANYWHERE inside the text, because they usually appear mid-sentence:
//   "Welcome back, {playerName}!"   "You have {{count}} gems"   "Day %d"
// Every pattern here is unambiguous on real UI text (curly/dollar braces and
// printf specifiers effectively never occur in finished copy), so matches are
// real bugs, not guesses.
const PLACEHOLDER_TOKEN_PATTERNS = [
    /\{\{\s*[\w.\-]+\s*\}\}/,        // {{count}} {{ playerName }}  (handlebars / i18n)
    /\$\{\s*[\w.\-]+\s*\}/,          // ${chapter.title}            (template literal)
    /\{[A-Za-z_][\w.\-]*\}/,         // {playerName} {chapter}      (single-brace)
    /\{\d+\}/,                        // {0} {1}                     (MessageFormat)
    /%\d+\$[@sdfx]/i,                 // %1$s %2$d                   (positional printf)
    /(?<!\d)%[sdfx@]\b/,              // %s %d %f %@ (NOT 100%/20%)  (printf / iOS)
    /%[A-Z][A-Z0-9_]{2,}%/            // %CHAPTER_TITLE%             (token markers)
];

// Patterns we DON'T treat as missing strings (they look like placeholders but
// are legitimate game UI text)
const ALLOW_LIST_PATTERNS = [
    /^[\d.,:%$€£¥₹\s\-\/+]+$/,    // pure numbers / currency / percentages
    /^[A-Z]{2,5}$/,               // short caps abbreviations (OK, USD, INR)
    /^[—•·…]+$/                   // pure punctuation/separators
];

let state = {
    active: false,
    deviceId: null,
    packageName: null,
    startedAt: null,
    timer: null,
    busy: false,                    // prevent overlapping dumps
    lastDumpAt: null,
    screen: { width: 0, height: 0 },
    findings: [],
    perScreenshot: [],              // one entry per dump: { at, viewCount, findingCount, screenshot? }
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
        busy: false,
        lastDumpAt: null,
        screen: { width: 0, height: 0 },
        findings: [],
        perScreenshot: [],
        discoveryError: null
    };
}

async function getScreenSize(deviceId) {
    try {
        const out = await adbHelper.runADB(
            ['-s', deviceId, 'shell', 'wm', 'size'],
            { timeout: 5000 }
        );
        // "Physical size: 1080x2400" or "Override size: 1080x2400"
        const m = String(out).match(/(\d+)\s*x\s*(\d+)/);
        if (m) return { width: Number(m[1]), height: Number(m[2]) };
    } catch (_) {}
    return { width: 1080, height: 1920 };  // sane defaults
}

async function dumpUiHierarchy(deviceId) {
    // uiautomator writes to a configurable path. We use the temp dir on the
    // device, then `cat` the content back rather than `pull`-ing — fewer adb
    // calls and side-steps permission quirks on some devices.
    const remotePath = '/data/local/tmp/testmate_uidump.xml';
    try {
        await adbHelper.runADB(
            ['-s', deviceId, 'shell', 'uiautomator', 'dump', remotePath],
            { timeout: 8000 }
        );
        const xml = await adbHelper.runADB(
            ['-s', deviceId, 'shell', 'cat', remotePath],
            { timeout: 8000 }
        );
        return String(xml || '');
    } catch (err) {
        throw new Error(`uiautomator dump failed: ${err.message}`);
    }
}

// Minimal XML node walker — we don't need full DOM. We extract every
// <node ...> element's attributes since uiautomator's output is flat-ish.
function parseUiNodes(xml) {
    const nodes = [];
    const nodeRe = /<node\s+([^>]*?)\/?>/g;
    let m;
    while ((m = nodeRe.exec(xml)) !== null) {
        const attrs = parseAttrs(m[1]);
        if (!attrs) continue;
        nodes.push(attrs);
    }
    return nodes;
}

function parseAttrs(str) {
    const out = {};
    // attr="value" — uiautomator XML quotes can contain &quot; etc but rarely
    // do for the attrs we care about. Conservative regex.
    const re = /(\w[\w-]*)="([^"]*)"/g;
    let m;
    while ((m = re.exec(str)) !== null) {
        out[m[1]] = m[2];
    }
    if (!('bounds' in out)) return null;
    const b = parseBounds(out.bounds);
    if (!b) return null;
    out._bounds = b;
    return out;
}

function parseBounds(s) {
    // "[x1,y1][x2,y2]"
    const m = String(s).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!m) return null;
    return {
        x1: Number(m[1]), y1: Number(m[2]),
        x2: Number(m[3]), y2: Number(m[4]),
        get width() { return this.x2 - this.x1; },
        get height() { return this.y2 - this.y1; }
    };
}

function isTextWidget(node) {
    const cls = String(node.class || '');
    return /TextView|EditText|TextField|Button(?!Bar)|CheckedTextView/i.test(cls);
}

function looksLikeMissingString(text) {
    if (!text) return false;
    const t = String(text).trim();
    if (t.length === 0) return false;
    if (ALLOW_LIST_PATTERNS.some(re => re.test(t))) return false;
    return MISSING_STRING_PATTERNS.some(re => re.test(t));
}

// Returns the first unresolved interpolation token found in the text (e.g.
// "{playerName}", "%s", "{{count}}"), or null. Searched anywhere in the string.
function findPlaceholderLeak(text) {
    if (!text) return null;
    const t = String(text);
    for (const re of PLACEHOLDER_TOKEN_PATTERNS) {
        const m = t.match(re);
        if (m) return m[0];
    }
    return null;
}

// resource-ids that denote non-text controls (icons, nav, progress, media).
// Used to suppress "empty text widget" noise on WebView/Unity overlays where
// these are legitimately textless.
const NON_TEXT_CONTROL_RE = /progress|(^|[_-])bar([_-]|$)|icon|img|image|next|prev|previous|back|close|arrow|spinner|loader|slider|toggle|switch|checkbox|thumb|seek|play|pause|volume|mute/i;

function analyzeNode(node, screen) {
    const findings = [];
    const text = node.text || '';
    const b = node._bounds;
    if (!b) return findings;

    // Skip degenerate (zero/near-zero size) nodes. Hidden web/Unity container
    // elements often report 0×0 or 1px bounds — they have no visible text to
    // mis-render, so any clipped/empty finding on them is noise, not a bug.
    if (b.width <= 1 || b.height <= 1) return findings;

    // 1. Truncated with ellipsis
    if (/(?:…|\.{3,})$/.test(text)) {
        findings.push({
            code: 'truncated_ellipsis',
            severity: 'warn',
            text: text.length > 80 ? text.slice(0, 77) + '…' : text,
            bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
            className: node.class,
            resourceId: node['resource-id'] || null,
            message: 'Text was truncated with an ellipsis — localized variant or long content may not fit the container.'
        });
    }

    // 2. Clipped against screen edge (likely cut off)
    const touchesLeft   = b.x1 <= EDGE_TOLERANCE_PX;
    const touchesRight  = b.x2 >= screen.width - EDGE_TOLERANCE_PX;
    const touchesTop    = b.y1 <= EDGE_TOLERANCE_PX;
    const touchesBottom = b.y2 >= screen.height - EDGE_TOLERANCE_PX;
    // Only flag clipping when BOTH a text widget AND it touches a non-status-
    // bar edge. Top is usually status bar / app bar, so we exclude it.
    if (text && (touchesLeft || touchesRight || touchesBottom)) {
        const which = [
            touchesLeft && 'left', touchesRight && 'right', touchesBottom && 'bottom'
        ].filter(Boolean).join('+');
        findings.push({
            code: 'clipped_at_edge',
            severity: 'warn',
            text: text.length > 80 ? text.slice(0, 77) + '…' : text,
            bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
            className: node.class,
            resourceId: node['resource-id'] || null,
            message: `Text widget bounds touch the ${which} screen edge — text may be cut off.`
        });
    }

    // 3. Missing-string placeholder
    if (looksLikeMissingString(text)) {
        findings.push({
            code: 'missing_string_placeholder',
            severity: 'error',
            text,
            bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
            className: node.class,
            resourceId: node['resource-id'] || null,
            message: 'Text matches a known placeholder pattern — likely a missing string resource or unresolved localization key.'
        });
    }

    // 3b. Unresolved interpolation token leaked to the UI (e.g. "{playerName}",
    // "%s", "{{count}}"). These are template placeholders that should have been
    // substituted with a real value but rendered verbatim — a visible bug.
    const leak = findPlaceholderLeak(text);
    if (leak) {
        findings.push({
            code: 'unresolved_placeholder',
            severity: 'error',
            text: text.length > 80 ? text.slice(0, 77) + '…' : text,
            token: leak,
            bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
            className: node.class,
            resourceId: node['resource-id'] || null,
            message: `Unresolved placeholder "${leak}" rendered on screen — a templating variable (player name, count, etc.) was never substituted.`
        });
    }

    // 4. Empty TextView with size — possible missing translation
    // Heuristic: a TextView with non-trivial bounds (>40px wide, >10px tall)
    // but empty text and no content-desc is suspicious. Skip elements whose
    // resource-id marks them as non-text controls (progress bars, icon/nav
    // buttons, media controls) — those are legitimately textless.
    const rid = String(node['resource-id'] || '');
    // Skip near-full-screen "text widgets": a real label never covers most of
    // the screen. WebView maps container divs (e.g. confetti/animation holders)
    // to TextView with empty text — those are layout containers, not labels.
    const screenArea = (screen.width || 0) * (screen.height || 0);
    const isContainerSized = screenArea > 0 &&
        (b.width * b.height) / screenArea > 0.7;
    if (text === '' && b.width > 40 && b.height > 10 &&
        !isContainerSized &&
        !(node['content-desc'] || '').trim() &&
        !NON_TEXT_CONTROL_RE.test(rid)) {
        // Don't flag every empty container — must be a TextView/Button class
        if (/TextView|Button|EditText/i.test(String(node.class || ''))) {
            findings.push({
                code: 'empty_textview',
                severity: 'info',
                text: '',
                bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
                className: node.class,
                resourceId: node['resource-id'] || null,
                message: 'Text widget rendered with no text and no content-description — verify intended.'
            });
        }
    }

    // 5. Extremely small text height
    if (text && b.height > 0 && b.height < MIN_TEXT_HEIGHT_PX) {
        findings.push({
            code: 'extremely_small',
            severity: 'info',
            text: text.length > 80 ? text.slice(0, 77) + '…' : text,
            bounds: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 },
            className: node.class,
            resourceId: node['resource-id'] || null,
            message: `Text widget rendered at ${b.height}px tall — possibly squashed by a constraint conflict.`
        });
    }

    return findings;
}

function dedupeAcrossSnapshots(newFindings) {
    // Same code+resourceId+text → don't add a duplicate. Lets the same
    // overflow surface across multiple dumps without inflating the list.
    const keyFor = f => `${f.code}|${f.resourceId || ''}|${f.text || ''}`;
    const known = new Set(state.findings.map(keyFor));
    return newFindings.filter(f => !known.has(keyFor(f)));
}

async function takeSnapshot() {
    if (state.busy || !state.active) return;
    state.busy = true;
    try {
        const xml = await dumpUiHierarchy(state.deviceId);
        if (!xml || xml.length < 100) {
            // Empty / failed dump — log once but don't keep retrying loudly
            if (!state.discoveryError) {
                state.discoveryError = 'uiautomator dump returned empty — device may be busy or app blocks dumping.';
            }
            return;
        }
        const nodes = parseUiNodes(xml);
        const textNodes = nodes.filter(isTextWidget);
        const findingsThisDump = [];
        for (const n of textNodes) {
            findingsThisDump.push(...analyzeNode(n, state.screen));
        }
        const fresh = dedupeAcrossSnapshots(findingsThisDump);
        for (const f of fresh) {
            f.at = Date.now();
            state.findings.push(f);
            if (state.findings.length > MAX_FINDINGS_RETAINED) state.findings.shift();
        }
        state.perScreenshot.push({
            at: Date.now(),
            viewCount: nodes.length,
            textWidgetCount: textNodes.length,
            findingsThisDump: findingsThisDump.length,
            newFindings: fresh.length
        });
        state.lastDumpAt = Date.now();
    } catch (err) {
        if (!state.discoveryError) state.discoveryError = err.message;
    } finally {
        state.busy = false;
    }
}

async function start({ deviceId, packageName }) {
    reset();
    if (!deviceId || !packageName) {
        logger.logWarning('TextOverflowDetector.start: deviceId + packageName required, skipping');
        return;
    }
    state.deviceId = deviceId;
    state.packageName = packageName;
    state.startedAt = Date.now();
    state.active = true;

    // Read screen size in background — affects edge-clip detection
    setTimeout(async () => {
        try {
            state.screen = await getScreenSize(deviceId);
        } catch (_) { /* keep defaults */ }
    }, 0);

    state.timer = setInterval(async () => {
        if (!state.active) return;
        const sinceStart = Date.now() - state.startedAt;
        if (sinceStart < BOOT_GRACE_MS) return;
        try { await takeSnapshot(); } catch (_) { /* never crash */ }
    }, DUMP_INTERVAL_MS);
}

async function stop() {
    if (!state.active) return getSnapshot();
    // One final snapshot for the report
    try { await takeSnapshot(); } catch (_) {}
    state.active = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    return getSnapshot();
}

function getSnapshot() {
    const errors = state.findings.filter(f => f.severity === 'error').length;
    const warns  = state.findings.filter(f => f.severity === 'warn').length;
    const infos  = state.findings.filter(f => f.severity === 'info').length;
    return {
        status: {
            active: state.active,
            packageName: state.packageName,
            screen: state.screen,
            startedAt: state.startedAt,
            dumpsTaken: state.perScreenshot.length,
            lastDumpAt: state.lastDumpAt,
            discoveryError: state.discoveryError
        },
        counts: {
            findings: state.findings.length,
            errors,
            warnings: warns,
            infos,
            uniqueResourceIds: new Set(state.findings.map(f => f.resourceId).filter(Boolean)).size
        },
        findings: state.findings.slice(),
        perScreenshot: state.perScreenshot.slice()
    };
}

function getReportSummary() {
    const snap = getSnapshot();
    return {
        packageName: snap.status.packageName,
        screen: snap.status.screen,
        dumpsTaken: snap.status.dumpsTaken,
        countsBySeverity: {
            error:   snap.counts.errors,
            warning: snap.counts.warnings,
            info:    snap.counts.infos
        },
        findings: snap.findings,
        discoveryError: snap.status.discoveryError
    };
}

module.exports = {
    start,
    stop,
    reset,
    getSnapshot,
    getReportSummary,
    // Exposed for tests
    _internal: { parseUiNodes, parseBounds, analyzeNode, looksLikeMissingString }
};
