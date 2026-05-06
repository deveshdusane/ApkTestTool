// Manual Test Checklist Builder — pure function.
//
// The auto-detector and lifecycle aggregator catch what's visible in logs/metrics:
// crashes, ANRs, low FPS, ad/billing/Firebase callbacks, etc. About half of what
// QA teams call "blockers" cannot be seen from logs alone — tap responsiveness,
// missing textures, tutorial soft-locks, audio missing, save corruption, locale
// overflow. The honest move is to surface those as a tester-driven checklist,
// auto-tailored to the engine + SDKs the agent actually detected this session,
// so the list stays short, relevant, and grouped by familiar QA categories.
//
// Each item is `{ id, label, why, category, conditional? }`. The renderer pairs
// each with a pass/fail/skip control + free-text notes; the QA report records
// what the tester actually checked.

// ─── Categories the renderer groups by, in display order ──────────────────────
// "Custom" is always rendered last and ALWAYS included (even when empty), because
// the renderer uses it to host the "Add custom test" inline form.
const CATEGORIES = [
    'Gameplay Flow',
    'UI/UX',
    'Localization',
    'Ads & Monetization',
    'Purchases',
    'Save/Load',
    'Multiplayer',
    'Accessibility',
    'Custom'
];

const ALWAYS_ITEMS = [
    // Gameplay Flow
    {
        id: 'tutorial_completion',
        category: 'Gameplay Flow',
        label: 'First-time-user / tutorial flow can be completed without getting stuck',
        why: 'Tutorial soft-locks (next-button missing, hint not appearing) are semantic and cannot be detected from logs.'
    },
    {
        id: 'level_progression',
        category: 'Gameplay Flow',
        label: 'Player can progress through at least the first 3 levels / scenes',
        why: 'Progression blockers (missing trigger, broken unlock condition) only manifest in real play.'
    },
    // UI/UX
    {
        id: 'tap_responsiveness',
        category: 'UI/UX',
        label: 'Every visible UI button responds to taps within ~1 s',
        why: 'No input-event timestamping in logcat — dead callbacks on UI buttons are invisible to the tool.'
    },
    {
        id: 'asset_integrity',
        category: 'UI/UX',
        label: 'No pink checkerboards, missing textures, or invisible objects',
        why: 'Visual asset integrity needs human eyes (OCR / image AI is unreliable here).'
    },
    {
        id: 'back_button',
        category: 'UI/UX',
        label: 'Android back button does the right thing (no kill mid-tutorial, no skip past confirm)',
        why: 'Back-button policy is per-screen and not visible from logs.'
    },
    {
        id: 'small_screens',
        category: 'UI/UX',
        label: 'UI is readable and tappable on small (≤ 5") screens',
        why: 'Layout collisions and tiny tap targets need physical-device validation.'
    },
    // Localization
    {
        id: 'in_game_text',
        category: 'Localization',
        label: 'In-game text renders correctly in the chosen language (no missing strings)',
        why: 'Missing localisation keys often render as raw IDs and are not log-traceable.'
    },
    {
        id: 'text_overflow',
        category: 'Localization',
        label: 'Localised text fits within UI bounds (no clipping, no overflow into adjacent elements)',
        why: 'Long German / Russian strings are a common QA escape; only visible to the eye.'
    },
    // Audio (lives under UI/UX-adjacent in this taxonomy → Accessibility for hearing checks)
    {
        id: 'audio',
        category: 'Accessibility',
        label: 'Sound effects and background music play correctly; mute/unmute respected',
        why: 'Audio output is not captured or analysed by the tool.'
    },
    // Save/Load
    {
        id: 'save_resume',
        category: 'Save/Load',
        label: 'Force-close the app, reopen — player state restores correctly',
        why: 'Save/load correctness is internal to the game logic.'
    },
    {
        id: 'save_corruption',
        category: 'Save/Load',
        label: 'Quitting mid-level and resuming does not corrupt progress',
        why: 'Mid-level save corruption is a common silent regression.'
    }
];

// ─── Conditional items added based on what the tool detected this session ─────
const CONDITIONAL_ITEMS = [
    {
        when: ({ engine }) => /unity/i.test(engine || ''),
        items: [
            {
                id: 'unity_scene_transitions',
                category: 'Gameplay Flow',
                label: 'Scene transitions complete without freezing or visible gaps',
                why: 'Unity scene loads can stall silently — only obvious to the eye.'
            },
            {
                id: 'unity_asset_bundle',
                category: 'Gameplay Flow',
                label: 'Asset-bundle download completes on a slow / throttled network',
                why: 'Bundle download failures often present as a forever-loading screen, not a crash.'
            }
        ]
    },
    {
        when: ({ engine }) => engine && !/unity/i.test(engine),
        items: [
            {
                id: 'engine_load_screens',
                category: 'Gameplay Flow',
                label: 'Engine load screens behave correctly (no flicker, no infinite spinner)',
                why: 'Native / Unreal / custom-engine load behaviour varies and is not log-traceable.'
            }
        ]
    },
    {
        when: ({ hasAds }) => !!hasAds,
        items: [
            {
                id: 'ad_rewarded_visual',
                category: 'Ads & Monetization',
                label: 'Rewarded ad popup appears visually when triggered',
                why: 'The tool sees the SDK API call but cannot see whether the ad rendered on screen.'
            },
            {
                id: 'ad_banner_overlap',
                category: 'Ads & Monetization',
                label: 'Banner ad does not overlap critical gameplay UI',
                why: 'Layout collisions are visual.'
            },
            {
                id: 'ad_interstitial_dismiss',
                category: 'Ads & Monetization',
                label: 'Interstitial ad dismisses cleanly (close button responsive, no leftover overlay)',
                why: 'Stuck-overlay bugs are common and only visible to the tester.'
            },
            {
                id: 'ad_reward_delivery',
                category: 'Ads & Monetization',
                label: 'Reward currency / item is delivered after a completed rewarded ad',
                why: 'The tool sees onAdShown + rewardGranted, but cannot confirm the in-game inventory updated.'
            }
        ]
    },
    {
        when: ({ hasFirebaseAnalytics }) => !!hasFirebaseAnalytics,
        items: [
            {
                id: 'firebase_events',
                category: 'Ads & Monetization',
                label: 'Key game events (start, tutorial_complete, level_start, purchase) appear in Firebase DebugView',
                why: 'The tool sees event log lines locally but cannot confirm they reached the backend.'
            }
        ]
    },
    {
        when: ({ hasIap }) => !!hasIap,
        items: [
            {
                id: 'iap_dialog_visual',
                category: 'Purchases',
                label: 'Purchase dialog appears visually when triggered',
                why: 'Billing v5+ uses a bottom sheet; the tool sees the API call, not the UI.'
            },
            {
                id: 'iap_inventory_update',
                category: 'Purchases',
                label: 'Player inventory (gems / coins / unlock) updates after a completed purchase',
                why: 'Delivery is internal game state, not loggable.'
            },
            {
                id: 'iap_restore',
                category: 'Purchases',
                label: 'Restore-purchases works on a re-installed build (non-consumables)',
                why: 'Restore flows often regress silently.'
            },
            {
                id: 'iap_understandable',
                category: 'Purchases',
                label: 'Store / purchase flow is understandable to a first-time user',
                why: 'UX comprehension cannot be measured by the tool.'
            }
        ]
    },
    {
        when: ({ hasMultiplayer }) => !!hasMultiplayer,
        items: [
            {
                id: 'mp_reconnect',
                category: 'Multiplayer',
                label: 'Reconnect succeeds within 30 s after a brief network drop',
                why: 'Reconnect logic is application-specific and the tool cannot synthesize a network drop.'
            },
            {
                id: 'mp_session_join',
                category: 'Multiplayer',
                label: 'Two devices can join the same session and see synchronized state',
                why: 'Multiplayer state sync is invisible to a single-device monitor.'
            }
        ]
    },
    {
        when: ({ targetSdk }) => Number(targetSdk) >= 33,
        items: [
            {
                id: 'notif_permission_a13',
                category: 'UI/UX',
                label: 'Notification permission prompt appears on Android 13+ at the right moment',
                why: 'Android 13 introduced runtime POST_NOTIFICATIONS — easy to miss in onboarding.'
            }
        ]
    },
    {
        when: ({ permissions }) => Array.isArray(permissions) && permissions.some(p => /LOCATION/i.test(p)),
        items: [
            {
                id: 'location_prompt_timing',
                category: 'UI/UX',
                label: 'Location prompt appears only when a location-using feature is invoked (not on launch)',
                why: 'Privacy reviews and Play policy expect contextual permission requests.'
            }
        ]
    },
    {
        when: ({ permissions }) => Array.isArray(permissions) && permissions.some(p => /CAMERA|MICROPHONE|RECORD_AUDIO/i.test(p)),
        items: [
            {
                id: 'media_prompt_timing',
                category: 'UI/UX',
                label: 'Camera / mic prompt appears only when the relevant feature is invoked',
                why: 'Same contextual-prompt rule as location.'
            }
        ]
    },
    {
        when: ({ cleartextAllowed }) => !!cleartextAllowed,
        items: [
            {
                id: 'cleartext_captive_portal',
                category: 'UI/UX',
                label: 'On a hostile / captive-portal network, the game still connects or fails gracefully',
                why: 'Cleartext traffic is more vulnerable to interception — verify graceful failure.'
            }
        ]
    }
];

/**
 * Build the manual checklist for a session.
 * @param {Object} ctx
 * @param {string}  [ctx.engine]
 * @param {string[]}[ctx.sdks]
 * @param {number}  [ctx.targetSdk]
 * @param {string[]}[ctx.permissions]
 * @param {boolean} [ctx.hasAds]
 * @param {boolean} [ctx.hasIap]
 * @param {boolean} [ctx.hasFirebaseAnalytics]
 * @param {boolean} [ctx.hasMultiplayer]
 * @param {boolean} [ctx.cleartextAllowed]
 * @returns {Array<{id,label,why,category,conditional?}>}
 */
function build(ctx = {}) {
    const sdks = (ctx.sdks || []).map(s => String(s).toLowerCase());
    const derived = {
        hasAds: ctx.hasAds ?? sdks.some(s => /admob|unityads|applovin|ironsource|levelplay|chartboost/.test(s)),
        hasIap: ctx.hasIap ?? sdks.some(s => /iap|billing/.test(s)),
        hasFirebaseAnalytics: ctx.hasFirebaseAnalytics ?? sdks.includes('firebase'),
        hasMultiplayer: ctx.hasMultiplayer ?? sdks.some(s => /photon|playfab|mirror|netcode|colyseus|nakama|pubnub|epic_online_services/.test(s))
    };
    const merged = { ...ctx, ...derived };

    const items = ALWAYS_ITEMS.map(it => ({ ...it, conditional: false }));
    for (const group of CONDITIONAL_ITEMS) {
        if (group.when(merged)) {
            for (const it of group.items) items.push({ ...it, conditional: true });
        }
    }
    return items;
}

/**
 * Group an item array by category, preserving the canonical category order.
 * Empty categories are omitted EXCEPT for 'Custom', which is always emitted so
 * the UI can host an "Add custom test" form even when the tester hasn't added
 * any items yet.
 */
function groupByCategory(items) {
    const groups = new Map(CATEGORIES.map(c => [c, []]));
    for (const it of items) {
        const k = it.category && groups.has(it.category) ? it.category : 'UI/UX';
        groups.get(k).push(it);
    }
    return [...groups.entries()]
        .filter(([category, arr]) => arr.length > 0 || category === 'Custom')
        .map(([category, arr]) => ({ category, items: arr }));
}

module.exports = { build, groupByCategory, CATEGORIES };
