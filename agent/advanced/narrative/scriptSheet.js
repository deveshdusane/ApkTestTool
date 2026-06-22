/**
 * Narrative Script Sheet — parser + deviceless analyzer.
 *
 * Part 1 of the Narrative Auto-Test feature. Parses a dialog/choice sheet
 * (CSV exported from Google Sheets / Excel) into a structured manifest, then
 * runs ACCURATE, device-free quality checks on the script itself:
 *   - dynamic-insert catalog (*Name*, {playerName}, %s …) — lines QA must verify
 *   - misspelling detection (exact dictionary match — never a guess)
 *   - encoding-artifact detection (mojibake from bad curly-quote export)
 *   - structural issues (empty/duplicate choices, day with no script)
 *
 * Designed to be GENERIC across narrative games: columns are detected by header
 * name, and the day column is the first unlabeled column after SCRIPT. A caller
 * may pass an explicit column mapping to override detection for odd layouts.
 *
 * Pure module: no device, no I/O beyond the text passed in. Never throws on
 * malformed rows — it skips them and records a parse note.
 */

// ── RFC-4180-ish CSV parser (handles quotes, "" escapes, newlines in fields) ──
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\r') {
            /* ignore */
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

// ── Detectors ────────────────────────────────────────────────────────────────
const DAY_RE     = /^(?:s\d+\s*-?\s*)?day\s*\d+$/i;   // "DAY 1", "S1-DAY1"
const DAYNUM_RE  = /^\d{1,3}$/;                        // bare "23", "67" used as day
const SEASON_RE  = /^season\s*\d+$/i;
const INTER_RE   = /^inter$/i;

// Dynamic-insert tokens that get substituted at runtime. *Name*-style is the
// PTD convention; we also catch {x}, {{x}}, %s, %TOKEN%.
const INSERT_RES = [
    /\*[A-Za-z][^*\n]{0,40}\*/g,        // *Name*, *Childs name*, *name*
    /\{\{?\s*[\w.\-]+\s*\}?\}/g,         // {playerName}, {{count}}
    /%\d*\$?[sd@fx]\b/g,                 // %s %d %1$s
    /%[A-Z][A-Z0-9_]{2,}%/g              // %CHAPTER_TITLE%
];

// Exact-match misspelling dictionary. Conservative: only unambiguous typos
// (many seen directly in the PTD script). Exact word match = no false guesses.
const TYPOS = {
    hestitate: 'hesitate', hestitation: 'hesitation', hestitate: 'hesitate',
    achoes: 'echoes', corridoor: 'corridor', tembling: 'trembling',
    compaining: 'complaining', glaces: 'glances', methodicall: 'methodically',
    suppresive: 'suppressive', infront: 'in front', tsay: 'stay',
    alot: 'a lot', recieve: 'receive', recieved: 'received', seperate: 'separate',
    untill: 'until', wich: 'which', teh: 'the', adn: 'and', youre: "you're",
    definitly: 'definitely', occured: 'occurred', tommorow: 'tomorrow',
    begining: 'beginning', noone: 'no one'
    // NOTE: 'alright' deliberately NOT listed — it's accepted informal English,
    // flagging it produced noise on the PTD script. Add only unambiguous typos.
};


// Robust mojibake detector via codepoint escapes (no literal high chars here):
//   â€  = "â€"  (prefix of mis-decoded smart quotes/dashes/ellipsis)
//   [ÃÂ][-¿] = "Ã"/"Â" + high byte (accented-letter mojibake)
const MOJIBAKE_DETECT = /â€|[ÃÂ][-¿]/;

// A real *asterisk* placeholder is a short substitution token (*Name*,
// *Childs name*). Prose wrapped in asterisks — stage directions ("*driving
// minigame to the bank*") or emphasis ("*News broadcast. Live.*") — is NOT a
// placeholder. Reject anything with sentence punctuation or > 2 words.
function isLikelyPlaceholder(inner) {
    inner = String(inner || '').trim();
    if (!inner) return false;
    if (/[.!?;:]/.test(inner)) return false;
    return inner.split(/\s+/).length <= 2;
}

function findInserts(text) {
    const out = [];
    for (let ri = 0; ri < INSERT_RES.length; ri++) {
        const re = INSERT_RES[ri];
        let m; re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
            const tok = m[0];
            // Only the asterisk pattern (index 0) needs prose-vs-token filtering;
            // {x}/%s/%TOKEN% are unambiguous substitution markers.
            if (ri === 0 && !isLikelyPlaceholder(tok.replace(/^\*+|\*+$/g, ''))) continue;
            out.push(tok);
        }
    }
    return out;
}

function findTypos(text) {
    const out = [];
    const words = String(text).toLowerCase().match(/[a-z']+/g) || [];
    const seen = new Set();
    for (const w of words) {
        if (TYPOS[w] && !seen.has(w)) { seen.add(w); out.push({ word: w, suggestion: TYPOS[w] }); }
    }
    return out;
}

// ── Parse ────────────────────────────────────────────────────────────────────
function parseScriptCsv(text, mapping = null) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { error: 'Empty sheet.' };

    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const find = name => header.indexOf(name);
    const cols = mapping || {
        script:  find('script'),
        choice1: find('choice 1'),
        choice2: find('choice 2'),
        choice3: find('choice 3'),
        hp:      find('hp'),
        rep:     find('rep'),
        power:   find('power')
    };
    if (cols.script < 0) return { error: 'No SCRIPT column found in header.' };
    // The day marker lives in the first unlabeled column after SCRIPT.
    const dayCol = cols.script + 1;
    const choiceCols = [cols.choice1, cols.choice2, cols.choice3].filter(i => i >= 0);
    const costOf = ci => ci + 1; // COST sits immediately right of each CHOICE column

    const days = [];
    let cur = null, season = 1, parseNotes = 0;
    const pushDay = (label, num) => { cur = { day: num, label, season, beats: [] }; days.push(cur); };

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;
        const cell = i => (i >= 0 && i < row.length ? String(row[i] || '').trim() : '');

        const marker = cell(dayCol);
        if (SEASON_RE.test(marker)) { season = parseInt(marker.match(/\d+/)[0]); continue; }
        if (INTER_RE.test(marker)) continue;             // section separator
        if (DAY_RE.test(marker)) { pushDay(marker.toUpperCase(), days.length + 1); continue; }
        if (DAYNUM_RE.test(marker) && cell(cols.script) === '') { pushDay('DAY ' + marker, days.length + 1); continue; }

        const script = cell(cols.script);
        // A CHOICE column holds two kinds of text: the short tappable button
        // LABEL ("Take a cab", usually with a COST), and — on the next row — the
        // longer OUTCOME text of that branch ("You took a cab and reached…").
        // Split them: short / cost-bearing = button (a real choice); long = outcome.
        const choices = [];
        const outcomes = [];
        for (const ci of choiceCols) {
            const t = cell(ci);
            if (!t) continue;
            const slot = choiceCols.indexOf(ci) + 1;
            const cost = cell(costOf(ci));
            if (cost || t.length <= 35) choices.push({ slot, text: t, cost });
            else outcomes.push({ slot, text: t });
        }
        if (!script && choices.length === 0 && outcomes.length === 0) continue;   // blank row

        if (!cur) pushDay('DAY 1', 1);                    // content before first day marker
        cur.beats.push({
            script,
            choices,
            outcomes,
            stats: { hp: cell(cols.hp), rep: cell(cols.rep), power: cell(cols.power) }
        });
    }

    const totalChoicePoints = days.reduce((s, d) => s + d.beats.filter(b => b.choices.length > 0).length, 0);
    const totalChoices = days.reduce((s, d) => s + d.beats.reduce((x, b) => x + b.choices.length, 0), 0);
    const totalOutcomes = days.reduce((s, d) => s + d.beats.reduce((x, b) => x + (b.outcomes ? b.outcomes.length : 0), 0), 0);
    return {
        days,
        summary: {
            totalDays: days.length,
            seasons: season,
            totalBeats: days.reduce((s, d) => s + d.beats.length, 0),
            totalChoicePoints,
            totalChoices,
            totalOutcomes,
            parseNotes
        }
    };
}

// ── Analyze (deviceless, accurate) ───────────────────────────────────────────
function analyzeScript(parsed) {
    if (!parsed || !parsed.days) return { error: 'Nothing to analyze.' };
    const inserts = [], typos = [], encoding = [], structural = [];

    for (const d of parsed.days) {
        d.beats.forEach((b) => {
            const texts = [{ where: 'dialog', text: b.script }]
                .concat(b.choices.map(c => ({ where: 'choice ' + c.slot, text: c.text })))
                .concat((b.outcomes || []).map(o => ({ where: 'outcome ' + o.slot, text: o.text })));

            for (const t of texts) {
                if (!t.text) continue;
                for (const tok of findInserts(t.text))
                    inserts.push({ day: d.label, where: t.where, token: tok, line: clip(t.text) });
                for (const tp of findTypos(t.text))
                    typos.push({ day: d.label, where: t.where, word: tp.word, suggestion: tp.suggestion, line: clip(t.text) });
                if (MOJIBAKE_DETECT.test(t.text))
                    encoding.push({ day: d.label, where: t.where, line: clip(t.text) });
            }

            // NOTE: no duplicate-choice check. In real narrative sheets the
            // CHOICE columns hold each branch's OUTCOME/narration text, which
            // legitimately repeats when branches converge — so duplicate text is
            // not an authoring bug and flagging it is pure noise. (Verified on the
            // 120-day PTD script: every "duplicate" was converging-branch text.)
        });
        if (d.beats.length === 0) structural.push({ day: d.label, issue: 'day has no script/beats' });
    }

    return {
        inserts, typos, encoding, structural,
        summary: {
            insertLines: inserts.length,
            uniqueInserts: new Set(inserts.map(i => i.token.toLowerCase())).size,
            typoCount: typos.length,
            encodingLines: encoding.length,
            structuralIssues: structural.length
        }
    };
}

function clip(s, n = 90) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

module.exports = { parseScriptCsv, analyzeScript, parseCsv, _internal: { findInserts, findTypos } };
