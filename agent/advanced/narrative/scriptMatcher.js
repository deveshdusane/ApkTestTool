/**
 * Script Matcher — match OCR'd in-game text against the dialog sheet.
 *
 * Increment 4 of the Narrative Auto-Test feature, the payoff: takes the frames
 * captured + OCR'd by the auto-player and compares each line to the imported
 * sheet (SCRIPT lines, choice labels, branch outcomes). Produces a per-frame
 * verdict and a run report:
 *   - ✓ matched   — line seen in-game matches an authored line (which day/where)
 *   - ⚠ literal placeholder — game showed "*Name*" / "{x}" literally (NOT filled)
 *   - ✗ no match  — OCR line didn't match any authored line (OCR noise, or text
 *                   on screen that isn't in the sheet — worth a human look)
 *
 * Fuzzy by design: OCR drops apostrophes and reads "I" as "|", so exact compare
 * would false-flag. Uses character-trigram Dice similarity, which tolerates that
 * noise while still distinguishing genuinely different lines.
 *
 * Pure module — no device, no I/O. Deviceless-testable.
 */

function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Character-trigram set (padded) for Dice similarity.
function trigrams(s) {
    const t = '  ' + norm(s) + '  ';
    const set = new Set();
    for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
    return set;
}

function dice(aSet, bSet) {
    if (!aSet.size || !bSet.size) return 0;
    let inter = 0;
    for (const g of aSet) if (bSet.has(g)) inter++;
    return (2 * inter) / (aSet.size + bSet.size);
}

// Visible placeholder markers that should have been substituted at runtime.
// If OCR reads one of these on screen, the placeholder was NOT filled.
const LITERAL_PLACEHOLDER = /\*[A-Za-z]|\{\{?\s*[a-z_]|%[0-9]*\$?[sd@]|<[a-z_]+>|\[[a-z_]+\]/i;

function hasLiteralPlaceholder(text) {
    return LITERAL_PLACEHOLDER.test(String(text || ''));
}

// Flatten the parsed sheet into one searchable list of authored lines.
function buildIndex(parsed) {
    const entries = [];
    if (!parsed || !parsed.days) return entries;
    for (const d of parsed.days) {
        for (const b of d.beats) {
            if (b.script) entries.push({ day: d.label, where: 'dialog', text: b.script });
            (b.choices || []).forEach(c => entries.push({ day: d.label, where: 'choice ' + c.slot, text: c.text }));
            (b.outcomes || []).forEach(o => entries.push({ day: d.label, where: 'outcome ' + o.slot, text: o.text }));
        }
    }
    for (const e of entries) { e.norm = norm(e.text); e.tris = trigrams(e.text); }
    return entries;
}

// Best authored line for one OCR'd line. Returns null if nothing is close.
function matchLine(ocrText, index, minScore = 0.45) {
    const q = trigrams(ocrText);
    if (q.size === 0) return null;
    let best = null, bestScore = 0;
    for (const e of index) {
        const s = dice(q, e.tris);
        if (s > bestScore) { bestScore = s; best = e; }
    }
    if (!best || bestScore < minScore) return null;
    return { day: best.day, where: best.where, text: best.text, score: +bestScore.toFixed(2) };
}

/**
 * Match a whole auto-play run against the sheet.
 *
 * @param {Array} frames  the auto-player's frame records (each has .lines / .text)
 * @param {Object} parsed parseScriptCsv() result
 * @returns {Object} per-frame verdicts + a run report
 */
function matchRun(frames, parsed, opts = {}) {
    const index = buildIndex(parsed);
    if (index.length === 0) return { ok: false, error: 'No sheet imported — import the dialog sheet first.' };
    const minScore = opts.minScore != null ? opts.minScore : 0.45;

    const results = [];
    const matchedKeys = new Set();   // unique authored lines confirmed on screen
    const daysSeen = new Set();
    let framesWithDialog = 0, matchedFrames = 0, unmatchedLines = 0;
    const placeholders = [];          // literal-placeholder bugs found on screen
    const unmatched = [];             // on-screen lines not found in the sheet

    for (const f of frames || []) {
        const lines = (f.lines && f.lines.length) ? f.lines.map(l => l.text) : (f.text ? [f.text] : []);
        if (lines.length === 0) { results.push({ step: f.step, noDialog: true }); continue; }
        framesWithDialog++;

        const lineResults = [];
        let frameMatched = false;
        for (const ln of lines) {
            const literal = hasLiteralPlaceholder(ln);
            const m = matchLine(ln, index, minScore);
            if (literal) placeholders.push({ step: f.step, line: ln, match: m });
            if (m) {
                frameMatched = true;
                matchedKeys.add(m.day + '|' + m.where + '|' + norm(m.text));
                daysSeen.add(m.day);
            } else {
                unmatchedLines++;
                unmatched.push({ step: f.step, line: ln });
            }
            lineResults.push({ line: ln, match: m, literalPlaceholder: literal });
        }
        if (frameMatched) matchedFrames++;
        results.push({ step: f.step, lines: lineResults, matched: frameMatched });
    }

    return {
        ok: true,
        results,
        report: {
            framesWithDialog,
            matchedFrames,
            unmatchedLines,
            uniqueAuthoredMatched: matchedKeys.size,
            sheetTotalLines: index.length,
            daysSeen: [...daysSeen],
            literalPlaceholders: placeholders,
            unmatched: unmatched.slice(0, 50)
        }
    };
}

module.exports = { buildIndex, matchLine, matchRun, hasLiteralPlaceholder, _internal: { norm, dice, trigrams } };
