/**
 * Choice event patterns.
 *
 * Static reference data the tracker uses to recognize narrative-game choice
 * events across multiple analytics SDKs and naming conventions. Game teams
 * pick their own event names; this list covers the conventions we've
 * observed in the wild plus the natural English variants.
 *
 * Keep this file framework-free: pure data + small helper functions.
 */

// ── Event names that signal a player choice ─────────────────────────────────
// Matched case-insensitively against the event name (and the param body as a
// loose fallback for SDKs that don't separate name from params on the log line).
const CHOICE_EVENT_PATTERNS = [
    /^choice_(made|selected|taken|picked|chosen)$/i,
    /^player_choice$/i,
    /^decision(_made|_taken)?$/i,
    /^branch_(selected|taken|chosen|picked)$/i,
    /^dialogue_choice$/i,
    /^option_(selected|picked|chosen)$/i,
    /^narrative_choice$/i,
    /^story_choice$/i,
    /^chapter_choice$/i,
    /^scene_choice$/i,
    /^choose_/i,                       // choose_path, choose_response, etc.
    /^select_choice$/i,
    /^make_choice$/i,
    /^story_decision$/i
];

// ── Parameter key names that carry the structured fields we care about ──────
// Looked up case-insensitively; first matching key wins so order matters
// loosely (most specific first).
const CHOICE_ID_KEYS = [
    'choice_id', 'choiceId', 'choice_key', 'choice',
    'branch_id', 'branchId', 'branch',
    'option_id', 'optionId',
    'decision_id', 'decisionId',
    'id'
];

const CHAPTER_KEYS = [
    'chapter_id', 'chapterId', 'chapter', 'chapter_name', 'chapterName',
    'scene_id', 'sceneId', 'scene', 'scene_name',
    'episode_id', 'episodeId', 'episode',
    'level_id', 'levelId'        // some games re-use level terminology
];

const TEXT_KEYS = [
    'choice_text', 'choiceText',
    'option_text', 'optionText',
    'selected_text', 'selectedText',
    'text', 'value', 'label'
];

const PREMIUM_KEYS = [
    'is_premium', 'isPremium', 'premium',
    'is_paid', 'isPaid', 'paid',
    'diamonds', 'gems', 'cost', 'currency_cost'
];

// ── Pre-screen substrings for the tracker's cheap log-line filter ──────────
// If a logcat line doesn't contain any of these, the parser pipeline skips it
// entirely — saves real CPU when 95%+ of lines are irrelevant SDK noise.
const PRE_SCREEN_KEYWORDS = [
    'choice', 'decision', 'branch', 'dialogue',
    'option_selected', 'option_picked',
    'story_', 'narrative_', 'chapter_'
];

// ── Hierarchical (GameAnalytics-style) choice IDs ───────────────────────────
// GameAnalytics, and some custom analytics, log choices as colon/slash/pipe-
// delimited DESIGN-event IDs rather than discrete underscore names. The choice
// keyword can be a bare segment OR embedded (with an index/suffix) inside a
// compound segment. Real examples seen in the wild:
//   "choice:chapter1:help_wife"      → bare keyword segment
//   "decision:s1day1:lie"            → bare keyword segment
//   "day2:choice1_selected1"         → compound: keyword carries index + action
//   "branch/ch2/flee"                → slash-delimited
// So we split into segments on true delimiters (: / | >), then split each
// segment into tokens on _ - . and test the TOKENS for choice keywords. We do
// NOT split the top level on _ . - because those live inside a segment.
const CHOICE_SEGMENT_RE = /^(choices?|decisions?|branch(es)?|options?|narrative_?choice|story_?choice|dialogue_?choice)$/i;
// A single token that means "choice", allowing a trailing index (choice1, decision2).
const CHOICE_TOKEN_RE   = /^(choices?|decisions?|branch(es)?|options?|playerchoice|narrativechoice|storychoice|dialoguechoice)\d*$/i;
const CHAPTERISH_RE     = /^(chapter|chap|ch\d|scene|sc\d|episode|ep\d|level|lvl|stage|act\d?|s\d+|d\d+|day\d*)/i;

function splitHierId(name) {
    if (!name) return [];
    return String(name).split(/[:/|>]+/).map(s => s.trim()).filter(Boolean);
}

function segTokens(seg) {
    return String(seg).split(/[_\-.]+/).filter(Boolean);
}

// Does this segment contain a choice keyword as one of its tokens?
function segHasChoiceToken(seg) {
    return segTokens(seg).some(t => CHOICE_TOKEN_RE.test(t));
}

function isHierChoiceName(name) {
    const segs = splitHierId(name);
    return segs.length >= 2 && segs.some(segHasChoiceToken);
}

// Pull a choiceId + chapter out of a hierarchical id. Deterministic heuristic:
//   • locate the segment carrying the choice keyword
//   • if it's a BARE keyword ("choice"), the id is the last other non-chapter
//     segment (e.g. "choice:chapter1:help_wife" → help_wife)
//   • if it's a COMPOUND segment ("choice1_selected1"), that segment IS the id
//   • chapter = any other segment that looks chapter/day/level-ish
function parseHierChoice(name) {
    const segs = splitHierId(name);
    if (segs.length < 2) return { choiceId: null, chapter: null };
    const kwIdx = segs.findIndex(segHasChoiceToken);
    if (kwIdx < 0) return { choiceId: null, chapter: null };

    const kwSeg = segs[kwIdx];
    const others = segs.filter((_, i) => i !== kwIdx);
    const chapter = others.find(s => CHAPTERISH_RE.test(s)) || null;

    let choiceId;
    if (CHOICE_SEGMENT_RE.test(kwSeg)) {
        // Bare keyword — the real id lives in a sibling segment.
        const idParts = others.filter(s => s !== chapter);
        choiceId = (idParts.length ? idParts[idParts.length - 1] : others[others.length - 1]) || null;
    } else {
        // Compound segment carries the id itself.
        choiceId = kwSeg;
    }
    return { choiceId, chapter };
}

function isChoiceEventName(name) {
    if (!name) return false;
    if (CHOICE_EVENT_PATTERNS.some(re => re.test(name))) return true;
    return isHierChoiceName(name);
}

function findFirst(params, keys) {
    if (!params || typeof params !== 'object') return null;
    for (const k of keys) {
        if (k in params && params[k] != null && params[k] !== '') return params[k];
    }
    // Case-insensitive fallback — game teams sometimes ship camelCase + snake_case
    const lowered = {};
    for (const [k, v] of Object.entries(params)) lowered[String(k).toLowerCase()] = v;
    for (const k of keys) {
        const lc = k.toLowerCase();
        if (lc in lowered && lowered[lc] != null && lowered[lc] !== '') return lowered[lc];
    }
    return null;
}

function looksLikeChoiceLine(line) {
    if (!line) return false;
    const lc = line.toLowerCase();
    return PRE_SCREEN_KEYWORDS.some(kw => lc.includes(kw));
}

module.exports = {
    CHOICE_EVENT_PATTERNS,
    CHOICE_ID_KEYS,
    CHAPTER_KEYS,
    TEXT_KEYS,
    PREMIUM_KEYS,
    PRE_SCREEN_KEYWORDS,
    isChoiceEventName,
    isHierChoiceName,
    parseHierChoice,
    splitHierId,
    findFirst,
    looksLikeChoiceLine
};
