// Static template for the "QA Checklist — Production Ready" page.
// Sections and items are intentionally hard-coded so the same template ships
// across every project. State (pass/fail/pending per item) is persisted
// per-project via qaChecklistManager.

const SECTIONS = [
    {
        id: 'core_gameplay',
        title: 'Core Gameplay Testing',
        icon: '🎮',
        accent: 'blue',
        items: [
            'Game loop is functional from start → mid → end',
            'No blockers — player always has something to do',
            'FTUE (First Time User Experience) is clear and guided',
            'Difficulty progression is smooth — no sudden spikes',
            'All mechanics work as intended (tap, drag, merge, etc.)',
            'Win/Loss conditions trigger correctly',
            'Idle systems generate earnings correctly over time'
        ]
    },
    {
        id: 'progression_economy',
        title: 'Progression & Economy Balance',
        icon: '🧠',
        accent: 'purple',
        items: [
            'Currency earning vs spending is balanced',
            'No infinite currency exploit possible',
            'Upgrades feel meaningful — visible impact on gameplay',
            'Progress speed is neither too fast nor too slow',
            'Late game does not feel stuck or boring',
            'Rewards scale properly — early vs late game comparison',
            'Prestige/reset systems work correctly (if applicable)'
        ]
    },
    {
        id: 'monetization',
        title: 'Monetization QA',
        icon: '💰',
        accent: 'green',
        items: [
            'All IAPs trigger correctly and show correct price by region',
            'Purchase success flow handled — item credited immediately',
            'Purchase failure flow handled — no charge without item',
            'Restore Purchases works on re-install',
            'Rewarded Ads — reward given only after full watch',
            'Rewarded Ads — no reward if ad skipped or closed early',
            'Interstitial Ads — not too frequent, no spam',
            'Interstitial Ads — do not interrupt critical gameplay',
            'Remove Ads IAP works properly — no ads shown after purchase'
        ]
    },
    {
        id: 'ads_integration',
        title: 'Ads Integration',
        icon: '📺',
        accent: 'orange',
        items: [
            'Ad loads successfully with acceptable fill rate',
            'Fallback / no-fill handled gracefully — no crash or blank',
            'No crashes or ANRs caused by ad SDK',
            'Ad frequency follows design rules — no over-serving',
            'Ad placement correct — not overlapping UI elements',
            'Network switch (WiFi → Mobile data) handled during ad play'
        ]
    },
    {
        id: 'offline_idle',
        title: 'Offline & Idle Systems',
        icon: '📴',
        accent: 'teal',
        items: [
            'Offline earnings calculated correctly on resume',
            'Time cap enforced (e.g., 2hr / 8hr / 15hr cap)',
            'Device time-change exploit blocked — no cheat via clock',
            'Resume game shows correct offline reward popup',
            'Offline UI displays correct time away and earnings value',
            'AI bot / automation works correctly during offline period'
        ]
    },
    {
        id: 'localization',
        title: 'Localization QA',
        icon: '🌐',
        accent: 'purple',
        items: [
            'All visible text is translated — no raw key strings visible',
            'No missing strings — "KEY_123" or "MISSING" not visible',
            'Text fits all UI containers — no overflow or clipping',
            'Special characters render properly (€ ₹ ¥ % & etc.)',
            'RTL layout works for Arabic/Hebrew (if supported)',
            'Fonts are readable across all supported languages'
        ]
    },
    {
        id: 'device_compat',
        title: 'Device Compatibility',
        icon: '📱',
        accent: 'blue',
        items: [
            'Game runs stable on low-end devices (2-3GB RAM)',
            'No overheating or excessive battery drain during session',
            'Supports different screen sizes — phones and tablets',
            'Safe area respected on notch and punch-hole displays',
            'Portrait and/or landscape orientation works properly'
        ]
    },
    {
        id: 'performance',
        title: 'Performance Testing',
        icon: '⚡',
        accent: 'yellow',
        items: [
            'FPS stable — no persistent frame drops during normal play',
            'No lag during heavy scenes — explosions, animations, spawns',
            'Loading/startup time acceptable (under 8 seconds)',
            'Memory usage stable — no progressive leak over session',
            'No ANR (Application Not Responding) errors'
        ]
    },
    {
        id: 'crash_stability',
        title: 'Crash & Stability',
        icon: '💥',
        accent: 'red',
        items: [
            'No crash on startup — cold and warm launch tested',
            'No crash during active gameplay session',
            'No crash when ad plays or ad SDK initializes',
            'No crash during or after IAP purchase flow',
            'App recovers properly after a crash — no corrupted state',
            'Crash logs captured and sent to analytics/Crashlytics'
        ]
    },
    {
        id: 'save_load',
        title: 'Save / Load System',
        icon: '🔄',
        accent: 'teal',
        items: [
            'Progress saves correctly — verified after forced close',
            'Game resumes from exact correct state on relaunch',
            'Cloud save syncs properly (if implemented)',
            'No data loss on reinstall or app update'
        ]
    },
    {
        id: 'notifications',
        title: 'Notifications',
        icon: '🔔',
        accent: 'amber',
        items: [
            'Push notifications trigger correctly at scheduled times',
            'Deep links from notifications open the correct screen',
            'No notification spam — frequency capped appropriately',
            'Time-based notification content is accurate'
        ]
    },
    {
        id: 'ui_ux',
        title: 'UI / UX QA',
        icon: '🎨',
        accent: 'orange',
        items: [
            'All buttons are tappable with correct hitbox size',
            'No overlapping or z-fighting UI elements',
            'Animations are smooth and polished — no jank',
            'Visual feedback present on all interactions (tap, reward, upgrade)',
            'Design is consistent across all screens — fonts, colors, spacing'
        ]
    },
    {
        id: 'edge_case',
        title: 'Edge Case Testing',
        icon: '🧪',
        accent: 'green',
        items: [
            'Rapid tapping / spam input does not break game state',
            'Switching apps mid-session — state preserved on return',
            'Internet ON → OFF mid-session handled gracefully',
            'Internet OFF → ON reconnects properly without restart',
            'Low battery mode does not cause crashes or save loss',
            'Incoming call during gameplay — resumes correctly after',
            'Device clock change (cheat test) — handled correctly',
            'Background → foreground transition — no black screen / freeze'
        ]
    },
    {
        id: 'analytics',
        title: 'Analytics & Tracking',
        icon: '📊',
        accent: 'purple',
        items: [
            'All key events firing correctly — verified in dashboard',
            'No duplicate event fire on single action',
            'Full funnel tracked: FTUE → D1 → D3 → D7 retention events',
            'Ad events tracked properly (impression, click, reward)',
            'Purchase events tracked with correct SKU and value'
        ]
    },
    {
        id: 'store_readiness',
        title: 'Store Readiness',
        icon: '🏪',
        accent: 'green',
        items: [
            'App icon and screenshots match actual gameplay',
            'No misleading content in store listing',
            'Store description matches actual game mechanics',
            'Privacy policy URL added and accessible',
            'All permissions are justified in store listing',
            'No Google Play / App Store policy violations'
        ]
    },
    {
        id: 'security_anticheat',
        title: 'Security & Anti-Cheat',
        icon: '🔐',
        accent: 'red',
        items: [
            'No easy currency/resource hack via memory editor',
            'Server-side validation for purchases (if applicable)',
            'Time manipulation prevention working correctly',
            'APK tamper protection active (if implemented)'
        ]
    },
    {
        id: 'live_ops',
        title: 'Live Ops & Events',
        icon: '🧩',
        accent: 'green',
        items: [
            'Events trigger on correct scheduled dates and times',
            'Event rewards distributed correctly on completion',
            'Countdown timers show accurate real-time values',
            'Event UI loads and works without crashes or bugs'
        ]
    },
    {
        id: 'idle_economy_deep',
        title: 'Idle Economy Deep Checks',
        icon: '🏆',
        accent: 'yellow',
        items: [
            'Income per second vs upgrade cost curve is correct',
            'Time to next milestone feels rewarding — not too long',
            'Offline vs online earning ratio is balanced',
            'No dead zones — player never waiting too long with nothing'
        ]
    },
    {
        id: 'puzzle_level',
        title: 'Puzzle / Level QA (if applicable)',
        icon: '🧱',
        accent: 'blue',
        items: [
            'Every level is solvable — no impossible states',
            'No soft-lock states — player cannot get permanently stuck',
            'Grid/tile movement works correctly in all directions',
            'Difficulty ramp tested across 100+ levels'
        ]
    },
    {
        id: 'release_signoff',
        title: 'Release Sign-Off Checks',
        icon: '🚀',
        accent: 'green',
        items: [
            'Day 1 experience manually played through completely',
            'Day 3 experience simulated — retention hooks present',
            'Day 7 experience simulated — meta progression tested',
            'Whale player journey simulated — all IAPs purchaseable',
            'F2P player journey simulated — ads and free progression work',
            'Economy spreadsheet validated against in-game numbers'
        ]
    }
];

// Expand items into objects with stable IDs (`<sectionId>__<index>`).
// IDs are stable across runs so saved state always rejoins to the right item.
function buildTemplate() {
    return SECTIONS.map(section => ({
        id: section.id,
        title: section.title,
        icon: section.icon,
        accent: section.accent,
        items: section.items.map((label, idx) => ({
            id: `${section.id}__${idx}`,
            label
        }))
    }));
}

function totalItemCount() {
    return SECTIONS.reduce((n, s) => n + s.items.length, 0);
}

module.exports = { buildTemplate, totalItemCount };
