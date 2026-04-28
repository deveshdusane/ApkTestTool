const unzipper = require('unzipper');

const SDK_DEFINITIONS = [
    {
        id: 'admob',
        name: 'AdMob',
        category: 'ADS',
        classSignatures: ['com/google/android/gms/ads', 'com.google.android.gms.ads'],
        manifestSignatures: ['com.google.android.gms.ads'],
        logPatterns: [/AdMob/i, /\bAds\b.*(?:AdRequest|AdLoaded|AdImpression|onAdLoaded|onAdShown)/i, /Publisher provided Google AdMob App ID/i],
        keyPatterns: [{ name: 'AdMob App ID', regex: /ca-app-pub-\d{16}~\d{10}/g }]
    },
    {
        id: 'unity_ads',
        name: 'UnityAds',
        category: 'ADS',
        classSignatures: ['com/unity3d/ads', 'com.unity3d.ads', 'com/unity3d/services/ads'],
        manifestSignatures: ['com.unity3d.ads', 'com.unity3d.services.ads'],
        logPatterns: [/UnityAds/i, /com\.unity3d\.(?:ads|services\.ads)/i],
        keyPatterns: []
    },
    {
        id: 'applovin',
        name: 'AppLovin',
        category: 'ADS',
        classSignatures: ['com/applovin', 'com.applovin'],
        manifestSignatures: ['com.applovin'],
        logPatterns: [/AppLovin/i, /MAX Ads/i],
        keyPatterns: []
    },
    {
        id: 'firebase_analytics',
        name: 'Firebase Analytics',
        category: 'ANALYTICS',
        classSignatures: ['com/google/firebase/analytics', 'com.google.firebase.analytics'],
        manifestSignatures: ['com.google.firebase.analytics'],
        logPatterns: [/FirebaseAnalytics/i, /\bFA\b.*(?:Logging event|Event recorded|App measurement initialized)/i, /FA-Event/i],
        keyPatterns: [{ name: 'Firebase Google App ID', regex: /\b1:\d{5,}:android:[0-9a-fA-F]{8,}\b/g }]
    },
    {
        id: 'appsflyer',
        name: 'AppsFlyer',
        category: 'ATTRIBUTION',
        classSignatures: ['com/appsflyer', 'com.appsflyer'],
        manifestSignatures: ['com.appsflyer'],
        logPatterns: [/AppsFlyer/i, /\baf_(?:event|start|purchase)\b/i],
        keyPatterns: [{ name: 'AppsFlyer Dev Key Reference', regex: /appsflyer_dev_key/gi }]
    },
    {
        id: 'adjust',
        name: 'Adjust',
        category: 'ATTRIBUTION',
        classSignatures: ['com/adjust', 'com.adjust.sdk'],
        manifestSignatures: ['com.adjust'],
        logPatterns: [/\bAdjust\b/i, /Adjust SDK/i],
        keyPatterns: []
    },
    {
        id: 'branch',
        name: 'Branch',
        category: 'ATTRIBUTION',
        classSignatures: ['io/branch', 'io.branch'],
        manifestSignatures: ['io.branch'],
        logPatterns: [/\bBranch\b/i, /branch init/i],
        keyPatterns: [{ name: 'Branch Live Key Reference', regex: /branch_key_live/gi }]
    },
    {
        id: 'facebook',
        name: 'Facebook SDK',
        category: 'ATTRIBUTION',
        classSignatures: ['com/facebook', 'com.facebook'],
        manifestSignatures: ['com.facebook'],
        logPatterns: [/FacebookSdk/i, /Facebook SDK/i],
        keyPatterns: []
    },
    {
        id: 'firebase',
        name: 'Firebase',
        category: 'BACKEND',
        classSignatures: ['com/google/firebase', 'com.google.firebase'],
        manifestSignatures: ['com.google.firebase'],
        logPatterns: [/FirebaseApp/i, /FirebaseInitProvider/i],
        keyPatterns: [{ name: 'Firebase Google App ID', regex: /\b1:\d{5,}:android:[0-9a-fA-F]{8,}\b/g }]
    },
    {
        id: 'playfab',
        name: 'PlayFab',
        category: 'BACKEND',
        classSignatures: ['com/playfab', 'com.playfab'],
        manifestSignatures: ['com.playfab'],
        logPatterns: [/PlayFab/i],
        keyPatterns: []
    },
    {
        id: 'google_billing',
        name: 'Google Play Billing',
        category: 'IAP',
        classSignatures: ['com/android/billingclient', 'com.android.billingclient'],
        manifestSignatures: ['com.android.vending.BILLING'],
        logPatterns: [/BillingClient/i, /InAppBilling/i, /com\.android\.billingclient/i],
        keyPatterns: []
    },
    {
        id: 'crashlytics',
        name: 'Crashlytics',
        category: 'MONITORING',
        classSignatures: ['com/google/firebase/crashlytics', 'com.google.firebase.crashlytics'],
        manifestSignatures: ['com.google.firebase.crashlytics'],
        logPatterns: [/Crashlytics/i, /FirebaseCrashlytics/i],
        keyPatterns: []
    },
    {
        id: 'sentry',
        name: 'Sentry',
        category: 'MONITORING',
        classSignatures: ['io/sentry', 'io.sentry'],
        manifestSignatures: ['io.sentry'],
        logPatterns: [/Sentry/i, /io\.sentry/i],
        keyPatterns: []
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
            for (const filter of item.intentFilters || []) {
                for (const action of filter.actions || []) chunks.push(action.name);
                for (const category of filter.categories || []) chunks.push(category.name);
            }
        }
    }
    return chunks.filter(Boolean).join('\n');
}

function addKey(result, sdk, keyPattern, value, source) {
    if (result.keys.some(key => key.value === value && key.sdk === sdk.name)) return;
    keyPattern.regex.lastIndex = 0;
    const valid = keyPattern.regex.test(value);
    keyPattern.regex.lastIndex = 0;
    result.keys.push({
        sdk: sdk.name,
        keyName: keyPattern.name,
        value,
        source,
        status: valid ? 'Valid format' : 'Suspicious'
    });
}

function scanTextForKeys(result, text, source) {
    for (const sdk of SDK_DEFINITIONS) {
        for (const keyPattern of sdk.keyPatterns) {
            keyPattern.regex.lastIndex = 0;
            let match;
            while ((match = keyPattern.regex.exec(text)) !== null) {
                addKey(result, sdk, keyPattern, match[0], source);
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
    result.keyStats.dangerKeys = result.keys.filter(key => key.status === 'Suspicious').length;
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

    const directory = await unzipper.Open.file(apkPath);
    for (const file of directory.files) {
        if (file.type !== 'File') continue;
        const lowerPath = file.path.toLowerCase();
        const shouldScan = lowerPath.endsWith('.dex') ||
            lowerPath.endsWith('.xml') ||
            lowerPath.endsWith('.json') ||
            lowerPath.endsWith('.txt') ||
            lowerPath.includes('/raw/') ||
            lowerPath.includes('/assets/');
        if (!shouldScan) continue;

        let buffer;
        try {
            buffer = await file.buffer();
        } catch {
            continue;
        }
        const text = getTextFromBuffer(buffer);
        const source = lowerPath.endsWith('.dex') ? 'dex' : file.path;

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
