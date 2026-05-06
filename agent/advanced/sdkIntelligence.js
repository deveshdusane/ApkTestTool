const unzipper = require('unzipper');

const SDK_DEFINITIONS = [
    {
        id: 'admob',
        name: 'AdMob',
        category: 'ADS',
        classSignatures: ['com/google/android/gms/ads', 'com.google.android.gms.ads'],
        manifestSignatures: ['com.google.android.gms.ads'],
        logPatterns: [/AdMob/i, /\bAds\b.*(?:AdRequest|AdLoaded|AdImpression|onAdLoaded|onAdShown)/i, /Publisher provided Google AdMob App ID/i],
        keyPatterns: [
            { name: 'AdMob App ID',    keyType: 'App ID',    regex: /ca-app-pub-\d{16}~\d{10}/g,  stringKeys: ['ca_app_id', 'admob_app_id', 'com.google.android.gms.ads.APPLICATION_ID'] },
            { name: 'AdMob Ad Unit',   keyType: 'Ad Unit ID', regex: /ca-app-pub-\d{16}\/\d{10}/g, stringKeys: ['admob_banner_unit_id', 'admob_interstitial_unit_id', 'admob_rewarded_unit_id'] }
        ]
    },
    {
        id: 'unity_ads',
        name: 'UnityAds',
        category: 'ADS',
        classSignatures: ['com/unity3d/ads', 'com.unity3d.ads', 'com/unity3d/services/ads'],
        manifestSignatures: ['com.unity3d.ads', 'com.unity3d.services.ads'],
        logPatterns: [/UnityAds/i, /com\.unity3d\.(?:ads|services\.ads)/i],
        keyPatterns: [
            { name: 'UnityAds Game ID', keyType: 'Game ID', stringKeys: ['unity_game_id', 'unityads_game_id', 'UNITY_GAME_ID'] }
        ]
    },
    {
        id: 'applovin',
        name: 'AppLovin',
        category: 'ADS',
        classSignatures: ['com/applovin', 'com.applovin'],
        manifestSignatures: ['com.applovin'],
        logPatterns: [/AppLovin/i, /MAX Ads/i],
        keyPatterns: [
            { name: 'AppLovin SDK Key',    keyType: 'SDK Key',    stringKeys: ['applovin_sdk_key', 'com.applovin.sdk.key'] },
            { name: 'AppLovin Report Key', keyType: 'Report Key', stringKeys: ['applovin_report_key'] }
        ]
    },
    {
        id: 'ironsource',
        name: 'IronSource',
        category: 'ADS',
        classSignatures: ['com/ironsource', 'com.ironsource', 'com/unity3d/mediation'],
        manifestSignatures: ['com.ironsource', 'com.ironsource.mediationsdk'],
        logPatterns: [/IronSource/i, /ironSource/i, /com\.ironsource/i],
        keyPatterns: [
            { name: 'IronSource App Key', keyType: 'App Key', stringKeys: ['ironsource_app_key', 'is_app_key', 'iron_source_app_key'] }
        ]
    },
    {
        id: 'firebase_analytics',
        name: 'Firebase Analytics',
        category: 'ANALYTICS',
        classSignatures: ['com/google/firebase/analytics', 'com.google.firebase.analytics'],
        manifestSignatures: ['com.google.firebase.analytics'],
        logPatterns: [/FirebaseAnalytics/i, /\bFA\b.*(?:Logging event|Event recorded|App measurement initialized)/i, /FA-Event/i],
        keyPatterns: [
            { name: 'Firebase Google App ID', keyType: 'Google App ID', regex: /\b1:\d{5,}:android:[0-9a-fA-F]{8,}\b/g,                    stringKeys: ['google_app_id', 'firebase_app_id', 'mobilesdk_app_id'] },
            { name: 'Firebase API Key',       keyType: 'API Key',       regex: /AIzaSy[A-Za-z0-9_\-]{33}/g,                               stringKeys: ['google_api_key', 'current_key'] },
            { name: 'Firebase Project ID',    keyType: 'Project ID',                                                                         stringKeys: ['project_id', 'firebase_project_id'] },
            { name: 'Firebase Sender ID',     keyType: 'Sender ID',                                                                         stringKeys: ['gcm_defaultSenderId', 'google_project_number', 'firebase_sender_id'] }
        ]
    },
    {
        id: 'appsflyer',
        name: 'AppsFlyer',
        category: 'ATTRIBUTION',
        classSignatures: ['com/appsflyer', 'com.appsflyer'],
        manifestSignatures: ['com.appsflyer'],
        logPatterns: [/AppsFlyer/i, /\baf_(?:event|start|purchase)\b/i],
        keyPatterns: [
            { name: 'AppsFlyer Dev Key', keyType: 'Dev Key', stringKeys: ['appsflyer_dev_key', 'appsflyer_key', 'AF_DEV_KEY'] }
        ]
    },
    {
        id: 'adjust',
        name: 'Adjust',
        category: 'ATTRIBUTION',
        classSignatures: ['com/adjust', 'com.adjust.sdk'],
        manifestSignatures: ['com.adjust'],
        logPatterns: [/\bAdjust\b/i, /Adjust SDK/i],
        keyPatterns: [
            { name: 'Adjust App Token', keyType: 'App Token', stringKeys: ['adjust_app_token', 'adjust_token', 'com.adjust.sdk.appToken'] }
        ]
    },
    {
        id: 'branch',
        name: 'Branch',
        category: 'ATTRIBUTION',
        classSignatures: ['io/branch', 'io.branch'],
        manifestSignatures: ['io.branch'],
        // Require Branch SDK-specific markers — bare word "Branch" causes false positives
        // (matches BranchManager, BackBranch, /branch/, etc. in unrelated logs)
        logPatterns: [/io\.branch\.referral/i, /BranchSDK/i, /BNC_LOG/i, /branchio/i, /branch\.io/i],
        keyPatterns: [
            { name: 'Branch Live Key', keyType: 'Live Key', regex: /key_live_[A-Za-z0-9]{20,}/g, stringKeys: ['branch_key_live', 'io.branch.sdk.BranchKey', 'branch_key'] },
            { name: 'Branch Test Key', keyType: 'Test Key', regex: /key_test_[A-Za-z0-9]{20,}/g, stringKeys: ['branch_key_test'] }
        ]
    },
    {
        id: 'facebook',
        name: 'Facebook SDK',
        category: 'ATTRIBUTION',
        classSignatures: ['com/facebook', 'com.facebook'],
        manifestSignatures: ['com.facebook'],
        logPatterns: [/FacebookSdk/i, /Facebook SDK/i],
        keyPatterns: [
            { name: 'Facebook App ID',     keyType: 'App ID',       stringKeys: ['facebook_app_id', 'com.facebook.sdk.ApplicationId'] },
            { name: 'Facebook Client Token', keyType: 'Client Token', stringKeys: ['facebook_client_token'] }
        ]
    },
    {
        id: 'firebase',
        name: 'Firebase',
        category: 'BACKEND',
        classSignatures: ['com/google/firebase', 'com.google.firebase'],
        manifestSignatures: ['com.google.firebase'],
        logPatterns: [/FirebaseApp/i, /FirebaseInitProvider/i],
        keyPatterns: [
            { name: 'Firebase Google App ID',  keyType: 'Google App ID',  regex: /\b1:\d{5,}:android:[0-9a-fA-F]{8,}\b/g,                                          stringKeys: ['google_app_id', 'firebase_app_id', 'mobilesdk_app_id'] },
            { name: 'Firebase Storage Bucket', keyType: 'Storage Bucket', regex: /\b[a-z][a-z0-9-]{3,50}\.appspot\.com\b/g,                                          stringKeys: ['firebase_storage_bucket', 'google_storage_bucket', 'storage_bucket'] },
            { name: 'Firebase Database URL',   keyType: 'Database URL',   regex: /https:\/\/[a-z][a-z0-9-]{3,50}(?:-default-rtdb)?\.(?:firebaseio\.com|firebasedatabase\.app)/g, stringKeys: ['firebase_database_url', 'google_firebase_database', 'firebase_url'] }
        ]
    },
    {
        id: 'playfab',
        name: 'PlayFab',
        category: 'BACKEND',
        classSignatures: ['com/playfab', 'com.playfab'],
        manifestSignatures: ['com.playfab'],
        logPatterns: [/PlayFab/i],
        keyPatterns: [
            { name: 'PlayFab Title ID', keyType: 'Title ID', stringKeys: ['playfab_title_id', 'PlayFabTitleId', 'PLAYFAB_TITLE_ID'] }
        ]
    },
    {
        id: 'google_billing',
        name: 'Google Play Billing',
        category: 'IAP',
        classSignatures: ['com/android/billingclient', 'com.android.billingclient'],
        manifestSignatures: ['com.android.vending.BILLING'],
        logPatterns: [/BillingClient/i, /InAppBilling/i, /com\.android\.billingclient/i],
        keyPatterns: [
            { name: 'Play License Key', keyType: 'License Key', stringKeys: ['google_play_license_key', 'play_billing_key', 'billing_public_key'] }
        ]
    },
    {
        id: 'crashlytics',
        name: 'Crashlytics',
        category: 'MONITORING',
        classSignatures: ['com/google/firebase/crashlytics', 'com.google.firebase.crashlytics'],
        manifestSignatures: ['com.google.firebase.crashlytics'],
        logPatterns: [/Crashlytics/i, /FirebaseCrashlytics/i],
        keyPatterns: [
            { name: 'Crashlytics Firebase App ID', keyType: 'Firebase App ID', regex: /\b1:\d{5,}:android:[0-9a-fA-F]{8,}\b/g, stringKeys: ['crashlytics_app_id'] }
        ]
    },
    {
        id: 'sentry',
        name: 'Sentry',
        category: 'MONITORING',
        classSignatures: ['io/sentry', 'io.sentry'],
        manifestSignatures: ['io.sentry'],
        logPatterns: [/Sentry/i, /io\.sentry/i],
        keyPatterns: [
            { name: 'Sentry DSN', keyType: 'DSN', regex: /https:\/\/[0-9a-f]{32}@o\d+\.ingest\.sentry\.io\/\d+/g, stringKeys: ['sentry_dsn', 'io.sentry.dsn', 'SENTRY_DSN'] }
        ]
    }
];

const CATEGORY_ORDER = ['ADS', 'ANALYTICS', 'ATTRIBUTION', 'BACKEND', 'IAP', 'MONITORING'];
const KEY_PATTERN_COUNT = SDK_DEFINITIONS.reduce((sum, sdk) => sum + sdk.keyPatterns.length, 0);

function createEmptySdk(definition) {
    return {
        id: definition.id,
        name: definition.name,
        category: definition.category,
        detected: false,
        active: false,
        status: 'Not detected',
        sources: [],
        runtime: {
            count: 0,
            firstEventTime: null,
            events: [],
            adTypes: [],
            adUnitIds: []
        }
    };
}

function createEmptyIntelligence() {
    const sdks = {};
    for (const definition of SDK_DEFINITIONS) {
        sdks[definition.id] = createEmptySdk(definition);
    }
    return {
        sdks,
        categories: {},
        keys: [],
        keyStats: {
            detectedSDKs: 0,
            keysFound: 0,
            keyPatternsChecked: KEY_PATTERN_COUNT,
            dangerKeys: 0
        },
        keyMessage: 'No keys found in strings.xml or text files.\nThis APK may store keys in native code or fetch them remotely.',
        timeline: [],
        summary: {}
    };
}

function addSource(sdk, source) {
    if (!sdk.sources.includes(source)) sdk.sources.push(source);
    sdk.detected = true;
}

function getTextFromBuffer(buffer) {
    return `${buffer.toString('utf8')}\n${buffer.toString('latin1')}\n${buffer.toString('utf16le')}`;
}

function collectManifestText(manifest, permissions = []) {
    const chunks = [...permissions];
    const app = manifest?.application || {};
    const groups = [
        app.activities || [],
        app.activityAliases || [],
        app.services || [],
        app.receivers || [],
        app.providers || [],
        app.metaData || []
    ];
    for (const group of groups) {
        for (const item of group) {
            chunks.push(item.name, item.authorities, item.permission, item.readPermission, item.writePermission);
            if (item.name && item.value != null) {
                chunks.push(`${item.name}=${item.value}`);
            }
            for (const filter of item.intentFilters || []) {
                for (const action of filter.actions || []) chunks.push(action.name);
                for (const category of filter.categories || []) chunks.push(category.name);
            }
        }
    }
    return chunks.filter(Boolean).join('\n');
}

const PLACEHOLDER_PATTERNS = [
    /^ca-app-pub-0{16}[~\/]/,      // AdMob all-zeros App ID
    /^ca-app-pub-\d+\/0{9,}/,      // AdMob all-zeros Ad Unit
    /^1:0+:android:0+$/,           // Firebase all-zeros App ID
    /^AIzaSy0{33}$/,               // Firebase placeholder API Key
    /^0{9,15}$/,                   // all-zero numeric IDs
    /^(test|sample|example|dummy|placeholder|your[-_]?key|insert[-_]?key)/i
];

// Heuristic: detect snake_case-style Android resource names that the .arsc adjacent-pairing
// scan accidentally extracts as values. These follow a strict pattern: lowercase letters,
// digits, and underscores only, no dashes/dots/slashes/colons/uppercase.
// Real keys/IDs almost always include dashes, dots, slashes, colons, or uppercase letters.
const STRING_RES_NAME_PATTERNS = [
    /^[a-z][a-z0-9_]*$/,           // pure snake_case (google_api_key, range_end, mtrl_picker_a11y)
    /^##/,                          // resource name prefixes (##hide_bottom_view...)
    /^@[a-z]/                       // resource references (@string/foo)
];

// Real values must contain at least one of these "non-resname" markers
// (dash, dot, colon, slash, tilde, uppercase letter, or be very long pure-numeric)
function looksLikeStringResName(value) {
    if (!value) return true;
    const v = String(value);
    // Reject obvious resource-name patterns
    if (STRING_RES_NAME_PATTERNS.some(re => re.test(v))) return true;
    // Pure numeric is fine (Sender IDs are numeric like 405480883303), but only if 8+ digits
    if (/^\d+$/.test(v)) return v.length < 8;
    return false;
}

// Google's official AdMob test publisher — any key from this ID must not ship in production
const ADMOB_TEST_PUBLISHER = 'ca-app-pub-3940256099942544';

// Server-side secrets that should never appear inside a client APK
const DANGER_SCAN_PATTERNS = [
    {
        name: 'AWS Access Key ID', keyType: 'Access Key ID',
        sdk: 'AWS', category: 'SECURITY',
        regex: /\bAKIA[A-Z0-9]{16}\b/g,
        danger: 'Server Key Exposed'
    },
    {
        name: 'Stripe Live Secret Key', keyType: 'Secret Key',
        sdk: 'Stripe', category: 'SECURITY',
        regex: /\bsk_live_[A-Za-z0-9]{24,}\b/g,
        danger: 'Server Key Exposed'
    }
];

function isPlaceholder(value) {
    return PLACEHOLDER_PATTERNS.some(re => re.test(value));
}

// Format validators for stringKey-only patterns (no regex) — enforce expected shape
// so we don't mark snake_case garbage as "Valid" just because there's no regex check.
const KEY_TYPE_VALIDATORS = {
    'Sender ID':    v => /^\d{6,15}$/.test(v),                                  // pure numeric, 6-15 digits
    'Project ID':   v => /^[a-z][a-z0-9-]{3,29}$/.test(v) && !/^[a-z][a-z0-9_]*$/.test(v),  // dashed, not pure snake_case
    'Dev Key':      v => /^[A-Za-z0-9]{15,40}$/.test(v),                        // alphanumeric token
    'App Token':    v => /^[A-Za-z0-9]{8,40}$/.test(v),
    'Title ID':     v => /^[A-Z0-9]{4,8}$/.test(v),                             // PlayFab title IDs
    'License Key':  v => v.length >= 100,                                       // base64 RSA pub key, very long
    'Game ID':      v => /^\d{5,20}$/.test(v),                                  // UnityAds game IDs
    'SDK Key':      v => v.length >= 30 && /[A-Z]/.test(v) && /[0-9]/.test(v),
    'App Key':      v => v.length >= 16 && /[A-Za-z0-9]/.test(v),
    'App ID':       v => v.length >= 8 && (/^fb\d+$/.test(v) || /^ca-app-pub-/.test(v) || /^\d+:/.test(v) || /^\d{10,}$/.test(v)),
    'Client Token': v => /^[A-Fa-f0-9]{30,}$/.test(v) || v.length >= 30
};

// Returns the danger/validity status for a key value
function classifyKey(keyPattern, value) {
    // AdMob test publisher ID — ships in Google docs/samples, must not reach production
    if (value.startsWith(ADMOB_TEST_PUBLISHER)) {
        return 'Test Key in Production';
    }
    // Branch test keys should not ship in a release build
    if (keyPattern.name === 'Branch Test Key') {
        return 'Test Key in Production';
    }
    // Firebase demo project IDs
    if (value.startsWith('demo-') &&
        (keyPattern.keyType === 'Project ID' || keyPattern.keyType === 'Google App ID')) {
        return 'Test Key in Production';
    }
    // Format check (non-destructive — only runs when a regex is defined)
    if (keyPattern.regex) {
        keyPattern.regex.lastIndex = 0;
        const valid = keyPattern.regex.test(value);
        keyPattern.regex.lastIndex = 0;
        return valid ? 'Valid' : 'Format Issue';
    }
    // Apply keyType-based validator for stringKey-only patterns
    const validator = KEY_TYPE_VALIDATORS[keyPattern.keyType];
    if (validator) {
        return validator(value) ? 'Valid' : 'Format Issue';
    }
    return 'Valid';
}

function addKey(result, sdk, keyPattern, value, source, fromStringKey = false) {
    if (!value || String(value).length < 3) return;
    const valStr = String(value);
    if (isPlaceholder(valStr)) return;

    // Reject Android resource-name strings that get picked up by the adjacent-string
    // heuristic in resources.arsc — these are key NAMES, not key VALUES.
    // Only filter when source is the adjacent-string heuristic (resources.arsc / native-lib);
    // regex-based hits are always valid because their format is verified.
    if (fromStringKey && (source === 'resources.arsc' || source === 'native-lib')) {
        if (looksLikeStringResName(valStr)) return;
    }

    // Deduplicate: same value + same key pattern across any SDK
    if (result.keys.some(k => k.value === valStr && k.keyName === keyPattern.name)) return;
    result.keys.push({
        sdk: sdk.name,
        category: sdk.category,
        keyName: keyPattern.name,
        keyType: keyPattern.keyType || keyPattern.name,
        value: valStr,
        source,
        status: classifyKey(keyPattern, valStr)
    });
}

function scanTextForKeys(result, text, source) {
    for (const definition of SDK_DEFINITIONS) {
        for (const keyPattern of definition.keyPatterns) {
            if (!keyPattern.regex) continue;
            keyPattern.regex.lastIndex = 0;
            let match;
            while ((match = keyPattern.regex.exec(text)) !== null) {
                addKey(result, result.sdks[definition.id], keyPattern, match[0], source);
            }
        }
    }

    // Scan for server-side secrets that should never be in a client APK
    for (const dp of DANGER_SCAN_PATTERNS) {
        dp.regex.lastIndex = 0;
        let match;
        while ((match = dp.regex.exec(text)) !== null) {
            const valStr = match[0];
            if (result.keys.some(k => k.value === valStr)) continue;
            result.keys.push({
                sdk: dp.sdk,
                category: dp.category,
                keyName: dp.name,
                keyType: dp.keyType,
                value: valStr,
                source,
                status: dp.danger
            });
        }
    }
}

function flattenJson(obj, out = {}) {
    if (!obj || typeof obj !== 'object') return out;
    if (Array.isArray(obj)) {
        for (const item of obj) flattenJson(item, out);
    } else {
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.length > 0 && v.length < 600) out[k] = v;
            else if (typeof v === 'object') flattenJson(v, out);
        }
    }
    return out;
}

// Extract readable ASCII strings ≥4 chars from binary buffer (for .arsc string pools)
function extractBinaryStrings(buffer) {
    const results = [];
    let start = -1;
    for (let i = 0; i < buffer.length; i++) {
        const b = buffer[i];
        const printable = (b >= 0x20 && b < 0x7f);
        if (printable) {
            if (start === -1) start = i;
        } else {
            if (start !== -1 && i - start >= 4) {
                results.push(buffer.slice(start, i).toString('ascii'));
            }
            start = -1;
        }
    }
    return results;
}

// Try to pair consecutive extracted strings as name=value for key extraction
function scanArscStrings(result, buffer, source) {
    const strings = extractBinaryStrings(buffer);
    // Build a lookup of all string key names we care about
    const keyIndex = new Map();
    for (const definition of SDK_DEFINITIONS) {
        for (const kp of definition.keyPatterns) {
            if (!kp.stringKeys) continue;
            for (const keyName of kp.stringKeys) {
                keyIndex.set(keyName, { definition, kp });
            }
        }
    }
    // Adjacent strings heuristic: if strings[i] is a known key name and strings[i+1] looks like a value.
    // This is fragile — .arsc string pools are often alphabetically sorted, not name→value pairs.
    // The fromStringKey=true flag lets addKey reject snake_case resource-name strings that get
    // accidentally paired (e.g., google_api_key followed by google_app_id).
    for (let i = 0; i < strings.length - 1; i++) {
        const entry = keyIndex.get(strings[i]);
        if (!entry) continue;
        const value = strings[i + 1];
        if (value && value.length >= 3 && value.length < 500) {
            addKey(result, result.sdks[entry.definition.id], entry.kp, value, source, true);
        }
    }
}

function scanJsonKV(result, kv, source) {
    for (const definition of SDK_DEFINITIONS) {
        const sdk = result.sdks[definition.id];
        for (const kp of definition.keyPatterns) {
            if (!kp.stringKeys) continue;
            for (const keyName of kp.stringKeys) {
                if (kv[keyName]) addKey(result, sdk, kp, kv[keyName], source);
            }
        }
    }
}

function scanManifestMetaData(result, manifest) {
    const metaData = manifest?.application?.metaData || [];
    for (const meta of metaData) {
        if (!meta.name || meta.value == null) continue;
        const nameStr = String(meta.name);
        const valueStr = String(meta.value);
        for (const definition of SDK_DEFINITIONS) {
            const sdk = result.sdks[definition.id];
            for (const kp of definition.keyPatterns) {
                if (!kp.stringKeys) continue;
                if (kp.stringKeys.some(s => s === nameStr || nameStr.endsWith('.' + s) || nameStr.endsWith('/' + s))) {
                    addKey(result, sdk, kp, valueStr, 'manifest');
                }
            }
        }
    }
}

function finalize(result) {
    const summary = {};
    const categories = {};
    for (const category of CATEGORY_ORDER) {
        const detected = Object.values(result.sdks).filter(sdk => sdk.category === category && sdk.detected);
        categories[category] = detected;
        summary[category] = detected.length ? detected.map(sdk => sdk.name).join(', ') : 'Not detected';
    }

    for (const sdk of Object.values(result.sdks)) {
        if (sdk.active) {
            sdk.status = 'Active';
        } else if (sdk.detected) {
            sdk.status = 'Installed (Not Active)';
        } else {
            sdk.status = 'Not detected';
        }
    }

    result.categories = categories;
    result.summary = summary;
    result.keyStats.detectedSDKs = Object.values(result.sdks).filter(sdk => sdk.detected).length;
    result.keyStats.keysFound = result.keys.length;
    result.keyStats.dangerKeys = result.keys.filter(key =>
        key.status === 'Test Key in Production' || key.status === 'Server Key Exposed'
    ).length;
    return result;
}

async function scanApk(apkPath, manifest = null, permissions = []) {
    const result = createEmptyIntelligence();
    const manifestText = collectManifestText(manifest, permissions);

    for (const definition of SDK_DEFINITIONS) {
        const sdk = result.sdks[definition.id];
        if (definition.manifestSignatures.some(signature => manifestText.includes(signature))) {
            addSource(sdk, 'manifest');
        }
    }
    scanTextForKeys(result, manifestText, 'manifest');
    scanManifestMetaData(result, manifest);

    const directory = await unzipper.Open.file(apkPath);
    for (const file of directory.files) {
        if (file.type !== 'File') continue;
        const lowerPath = file.path.toLowerCase();
        const shouldScan = lowerPath.endsWith('.dex') ||
            lowerPath.endsWith('.xml') ||
            lowerPath.endsWith('.json') ||
            lowerPath.endsWith('.txt') ||
            lowerPath.endsWith('.arsc') ||           // resources.arsc: compiled string resources (Firebase config)
            lowerPath.endsWith('.so') ||             // native libraries: IL2CPP/C++ string constants
            lowerPath.includes('/raw/') ||
            lowerPath.includes('/assets/');
        if (!shouldScan) continue;

        let buffer;
        try {
            buffer = await file.buffer();
        } catch {
            continue;
        }

        // JSON files: parse and extract key-value pairs by name
        if (lowerPath.endsWith('.json')) {
            try {
                const json = JSON.parse(buffer.toString('utf8'));
                scanJsonKV(result, flattenJson(json), file.path);
            } catch {}
        }

        // Binary files: extract string pool via adjacent-string pairing
        if (lowerPath.endsWith('.arsc')) {
            scanArscStrings(result, buffer, 'resources.arsc');
        } else if (lowerPath.endsWith('.so')) {
            scanArscStrings(result, buffer, 'native-lib');
        }

        const text = getTextFromBuffer(buffer);
        const source = lowerPath.endsWith('.dex') ? 'dex'
                     : lowerPath.endsWith('.arsc') ? 'resources.arsc'
                     : lowerPath.endsWith('.so') ? 'native-lib'
                     : file.path;

        for (const definition of SDK_DEFINITIONS) {
            const sdk = result.sdks[definition.id];
            if (definition.classSignatures.some(signature => text.includes(signature))) {
                addSource(sdk, lowerPath.endsWith('.dex') ? 'dex' : 'apk-file');
            }
        }
        scanTextForKeys(result, text, source);
    }

    return finalize(result);
}

function cloneStatic(staticIntel) {
    return JSON.parse(JSON.stringify(staticIntel || createEmptyIntelligence()));
}

function markRuntime(result, sdkId, event) {
    const sdk = result.sdks[sdkId];
    if (!sdk) return;
    addSource(sdk, 'runtime');
    sdk.active = true;
    sdk.runtime.count += 1;
    if (event.time != null && sdk.runtime.firstEventTime == null) sdk.runtime.firstEventTime = event.time;
    sdk.runtime.events.push(event);
}

function matchRuntimeLine(line) {
    const matches = [];
    for (const definition of SDK_DEFINITIONS) {
        if (definition.logPatterns.some(pattern => pattern.test(line))) {
            matches.push(definition.id);
        }
    }
    return matches;
}

module.exports = {
    SDK_DEFINITIONS,
    CATEGORY_ORDER,
    KEY_PATTERN_COUNT,
    createEmptyIntelligence,
    scanApk,
    finalize,
    cloneStatic,
    markRuntime,
    matchRuntimeLine,
    scanTextForKeys
};
