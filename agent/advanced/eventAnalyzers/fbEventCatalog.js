/**
 * Facebook App Events catalog.
 *
 * Static reference data extracted from Facebook's official Android SDK
 * documentation (developers.facebook.com/docs/app-events). Used by the
 * validator to classify events as standard/custom/auto and to flag missing
 * required parameters or use of reserved keys.
 *
 * Keep this file framework-free: pure data + small helper functions. No
 * runtime state, no I/O.
 */

// ── Standard events ─────────────────────────────────────────────────────────
// Names that FB SDK predefines. AppEventsLogger.logEvent("fb_mobile_purchase",..)
// gets special treatment server-side (better attribution, currency conversion).
//
// `required` is the minimum param set FB validates. Missing required keys are a
// real correctness bug — events will record but degrade in Events Manager.
const STANDARD_EVENTS = {
    fb_mobile_activate_app:           { required: [] },
    fb_mobile_deactivate_app:         { required: [] },
    fb_mobile_app_install:            { required: [] },
    fb_mobile_complete_registration:  { required: ['fb_registration_method'] },
    fb_mobile_content_view:           { required: ['_valueToSum', 'fb_currency'] },
    fb_mobile_search:                 { required: ['fb_search_string'] },
    fb_mobile_rate:                   { required: ['_valueToSum', 'fb_max_rating_value'] },
    fb_mobile_tutorial_completion:    { required: ['fb_success'] },
    fb_mobile_add_to_cart:            { required: ['_valueToSum', 'fb_currency', 'fb_content_type', 'fb_content_id'] },
    fb_mobile_add_to_wishlist:        { required: ['_valueToSum', 'fb_currency', 'fb_content_type', 'fb_content_id'] },
    fb_mobile_initiated_checkout:     { required: ['_valueToSum', 'fb_currency', 'fb_num_items', 'fb_payment_info_available'] },
    fb_mobile_add_payment_info:       { required: ['fb_success'] },
    fb_mobile_purchase:               { required: ['_valueToSum', 'fb_currency'] },
    fb_mobile_level_achieved:         { required: ['fb_level'] },
    fb_mobile_achievement_unlocked:   { required: ['fb_description'] },
    fb_mobile_spent_credits:          { required: ['_valueToSum'] },
    fb_mobile_obtain_push_token:      { required: [] },
    fb_mobile_push_opened:            { required: [] },
    fb_mobile_login:                  { required: [] },
    fb_mobile_share:                  { required: ['fb_content_type', 'fb_content_id'] },
    fb_mobile_invite:                 { required: ['fb_content_type', 'fb_content_id'] },
    fb_ad_impression:                 { required: [] },
    fb_ad_click:                      { required: [] }
};

// ── Auto-logged events ──────────────────────────────────────────────────────
// SDK records these without app code. They're noise for testers verifying that
// THEIR events fire correctly, so the UI hides them by default. We still
// capture them for completeness — useful for debugging "why am I not seeing my
// events" (if these aren't appearing either, debug logging is off).
const AUTO_EVENTS = new Set([
    'fb_mobile_activate_app',
    'fb_mobile_deactivate_app',
    'fb_mobile_app_install',
    '_fb_event_setVerboseLoggingEnabled',
    'fb_sdk_initialize',
    'fb_sdk_settings_changed',
    'fb_dialogs_native_login_dialog_show',
    'fb_dialogs_native_login_dialog_complete'
]);

// ── Reserved parameter keys ─────────────────────────────────────────────────
// FB SDK uses these internally. Custom events using these as param keys get
// SILENTLY dropped or merged by FB — the most common source of "my event is in
// logcat but not in Events Manager" QA complaints. Flag in the UI.
const RESERVED_PARAM_KEYS = new Set([
    '_logTime',
    '_eventName',
    '_session_id',
    '_appVersion',
    '_inBackground',
    '_isTimedEvent',
    '_timeStart',
    '_timeEnd',
    '_dataProcessingOptions',
    '_implicitlyLogged',
    '_ui',
    '_appUserId'
]);

// ── Standard parameter keys ────────────────────────────────────────────────
// Documented FB SDK parameter names. Custom events SHOULD avoid these unless
// they semantically mean the same thing as the standard usage.
const STANDARD_PARAM_KEYS = new Set([
    '_valueToSum',
    'fb_currency',
    'fb_content_type',
    'fb_content_id',
    'fb_content',
    'fb_description',
    'fb_level',
    'fb_max_rating_value',
    'fb_num_items',
    'fb_payment_info_available',
    'fb_registration_method',
    'fb_search_string',
    'fb_success',
    'fb_order_id'
]);

// ── Helper functions ────────────────────────────────────────────────────────

function isStandardEvent(name) {
    return Object.prototype.hasOwnProperty.call(STANDARD_EVENTS, name);
}

function isAutoEvent(name) {
    return AUTO_EVENTS.has(name);
}

function isReservedKey(key) {
    return RESERVED_PARAM_KEYS.has(key);
}

function isStandardKey(key) {
    return STANDARD_PARAM_KEYS.has(key);
}

function getRequiredParams(eventName) {
    return STANDARD_EVENTS[eventName]?.required || [];
}

/**
 * Classify an event by name only (no param inspection).
 * - 'standard' — predefined FB event with defined semantics
 * - 'auto'     — recorded by SDK itself, hidden by default in UI
 * - 'custom'   — app-defined, may be anything
 */
function classify(name) {
    if (isAutoEvent(name)) return 'auto';
    if (isStandardEvent(name)) return 'standard';
    return 'custom';
}

module.exports = {
    STANDARD_EVENTS,
    AUTO_EVENTS,
    RESERVED_PARAM_KEYS,
    STANDARD_PARAM_KEYS,
    isStandardEvent,
    isAutoEvent,
    isReservedKey,
    isStandardKey,
    getRequiredParams,
    classify
};
