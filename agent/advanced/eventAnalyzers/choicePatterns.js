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

function isChoiceEventName(name) {
    if (!name) return false;
    return CHOICE_EVENT_PATTERNS.some(re => re.test(name));
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
    findFirst,
    looksLikeChoiceLine
};
