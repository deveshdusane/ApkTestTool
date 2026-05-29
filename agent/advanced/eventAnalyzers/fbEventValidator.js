/**
 * Facebook event validator.
 *
 * Given a parsed event (from fbEventParser) returns:
 *   { type: 'standard'|'auto'|'custom'|'unknown',
 *     valid: boolean,
 *     warnings: string[] }
 *
 * Validations performed:
 *   1. Standard event missing required parameters → warning per missing key.
 *   2. Custom event uses a reserved param key → warning (FB drops/merges these
 *      silently server-side; common cause of "event shows in logcat but not in
 *      Events Manager" tickets).
 *   3. _valueToSum must be numeric.
 *   4. fb_currency must be a 3-letter ISO code (uppercase).
 *   5. Event name length (FB rejects > 40 chars).
 *   6. Param key length (FB rejects > 40 chars) and value length (FB rejects
 *      > 100 chars for string values).
 *
 * Pure function — no state, no I/O.
 */

const catalog = require('./fbEventCatalog');

const ISO_CURRENCY = /^[A-Z]{3}$/;
const MAX_EVENT_NAME_LEN = 40;
const MAX_PARAM_KEY_LEN  = 40;
const MAX_PARAM_VAL_LEN  = 100;

function validateEvent(event) {
    const warnings = [];
    const name = event?.name || '';
    const params = event?.params || {};

    const type = catalog.classify(name);

    // (1) Required-params for standard events
    if (type === 'standard') {
        const required = catalog.getRequiredParams(name);
        for (const key of required) {
            const present = Object.prototype.hasOwnProperty.call(params, key)
                         && params[key] !== null
                         && params[key] !== undefined
                         && params[key] !== '';
            if (!present) {
                warnings.push(`Missing required param "${key}" for standard event "${name}"`);
            }
        }
    }

    // (2) Reserved keys used as custom params
    //     Standard FB events legitimately include underscore-prefixed keys
    //     (the SDK adds them). For CUSTOM events, the app shouldn't.
    if (type === 'custom') {
        for (const key of Object.keys(params)) {
            if (catalog.isReservedKey(key)) {
                warnings.push(`Reserved key "${key}" used as custom param — FB may drop this event silently`);
            }
        }
    }

    // (3) _valueToSum numeric check
    if ('_valueToSum' in params) {
        const v = params._valueToSum;
        const isNum = typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v)));
        if (!isNum) {
            warnings.push(`"_valueToSum" must be numeric, got ${JSON.stringify(v)}`);
        }
    }

    // (4) fb_currency ISO format
    if ('fb_currency' in params) {
        const c = String(params.fb_currency || '');
        if (!ISO_CURRENCY.test(c)) {
            warnings.push(`"fb_currency" should be a 3-letter ISO code (uppercase), got "${c}"`);
        }
    }

    // (5) Event name length
    if (name.length > MAX_EVENT_NAME_LEN) {
        warnings.push(`Event name exceeds ${MAX_EVENT_NAME_LEN} chars — FB will reject`);
    }

    // (6) Param key/value length
    for (const [k, v] of Object.entries(params)) {
        if (k.length > MAX_PARAM_KEY_LEN) {
            warnings.push(`Param key "${k}" exceeds ${MAX_PARAM_KEY_LEN} chars — FB will reject`);
        }
        if (typeof v === 'string' && v.length > MAX_PARAM_VAL_LEN) {
            warnings.push(`Param "${k}" value exceeds ${MAX_PARAM_VAL_LEN} chars — FB will truncate or reject`);
        }
    }

    return {
        type,
        valid: warnings.length === 0,
        warnings
    };
}

module.exports = { validateEvent };
