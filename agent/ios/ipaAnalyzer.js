/**
 * IPA Static Analyzer.
 *
 * Mirror of apkAnalyzer but for iOS .ipa files. Works on ANY host OS — pure
 * file parsing, no device or libimobiledevice required. This is the only
 * Path D feature that's fully testable without a Mac + iPhone, so we lean on
 * it heavily for the QA tester's "drop the IPA, see what's inside" flow.
 *
 * IPA structure:
 *   MyApp.ipa  (ZIP)
 *   └── Payload/
 *       └── MyApp.app/
 *           ├── Info.plist            (binary plist usually)
 *           ├── MyApp                 (Mach-O executable)
 *           ├── embedded.mobileprovision (CMS-signed XML payload)
 *           ├── Frameworks/
 *           │   ├── FBSDKCoreKit.framework/
 *           │   ├── UnityFramework.framework/
 *           │   └── …
 *           ├── _CodeSignature/
 *           ├── *.lproj/              (per-locale dirs)
 *           └── PlugIns/              (App Extensions)
 *
 * What we extract:
 *   - Bundle identity (id, version, build, name)
 *   - Minimum iOS, supported devices
 *   - Permissions strings (NSCameraUsageDescription, etc.)
 *   - ATS settings (NSAppTransportSecurity)
 *   - URL schemes
 *   - Frameworks list + engine detection (Unity, Cocos2d-Swift, etc.)
 *   - SDK detection (FB, Firebase, AppsFlyer, Adjust, etc.) by Framework + binary signatures
 *   - Architectures (read Mach-O magic + cpu_type)
 *   - Mobileprovision: team, devices, expiry, entitlements
 *   - Asset integrity: 0-byte / suspiciously small files
 *
 * What we don't extract (out of scope for Phase 1):
 *   - Symbol-level analysis (would need Mach-O symbol table parsing)
 *   - Code-sign verification (cryptographic, defer to codesign on Mac)
 *   - Live runtime info (needs device)
 */

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const plistParser = require('./plistParser');

// Mach-O magic numbers
const MACHO_MAGIC = {
    0xfeedface: { arch: 'arm',   bits: 32, endian: 'be' },
    0xcefaedfe: { arch: 'arm',   bits: 32, endian: 'le' },
    0xfeedfacf: { arch: 'arm64', bits: 64, endian: 'be' },
    0xcffaedfe: { arch: 'arm64', bits: 64, endian: 'le' },
    0xcafebabe: { arch: 'fat',   bits: null, endian: null },
    0xbebafeca: { arch: 'fat',   bits: null, endian: null }
};

// Known SDK frameworks we surface in the report
const FRAMEWORK_SDKS = [
    { match: /FBSDK|FacebookSDK|FBAEMKit/i, name: 'Facebook SDK', category: 'ATTRIBUTION' },
    { match: /Firebase/i,                   name: 'Firebase',     category: 'BACKEND' },
    { match: /GoogleMobileAds/i,            name: 'AdMob',        category: 'ADS' },
    { match: /AppLovin|MAX/i,               name: 'AppLovin/MAX', category: 'ADS' },
    { match: /IronSource|LevelPlay/i,       name: 'IronSource',   category: 'ADS' },
    { match: /AppsFlyer/i,                  name: 'AppsFlyer',    category: 'ATTRIBUTION' },
    { match: /Adjust/i,                     name: 'Adjust',       category: 'ATTRIBUTION' },
    { match: /Branch/i,                     name: 'Branch',       category: 'ATTRIBUTION' },
    { match: /GameAnalytics/i,              name: 'GameAnalytics',category: 'ANALYTICS' },
    { match: /Crashlytics/i,                name: 'Crashlytics',  category: 'MONITORING' },
    { match: /Sentry/i,                     name: 'Sentry',       category: 'MONITORING' },
    { match: /Unity(?:Framework)?/i,        name: 'Unity Engine', category: 'ENGINE' },
    { match: /UnrealEngine|libUE4/i,        name: 'Unreal Engine',category: 'ENGINE' },
    { match: /Cocos2d/i,                    name: 'Cocos2d',      category: 'ENGINE' },
    { match: /Godot/i,                      name: 'Godot',        category: 'ENGINE' },
    { match: /Flutter/i,                    name: 'Flutter',      category: 'ENGINE' }
];

// Permission usage description keys to surface
const PERMISSION_KEYS = [
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSContactsUsageDescription',
    'NSCalendarsUsageDescription',
    'NSRemindersUsageDescription',
    'NSAppleMusicUsageDescription',
    'NSMotionUsageDescription',
    'NSHealthShareUsageDescription',
    'NSHealthUpdateUsageDescription',
    'NSFaceIDUsageDescription',
    'NSUserTrackingUsageDescription',     // ATT consent (iOS 14+)
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSLocalNetworkUsageDescription',
    'NSSpeechRecognitionUsageDescription'
];

// Suspiciously small asset thresholds (same idea as Android assetIntegrityAnalyzer)
const TINY_AUDIO_BYTES = 10 * 1024;
const ASSET_EXT = {
    image:  ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'],
    audio:  ['.mp3', '.m4a', '.aac', '.wav', '.caf'],
    video:  ['.mp4', '.mov', '.m4v'],
    font:   ['.ttf', '.otf']
};

async function analyzeIpa(ipaPath) {
    const result = newResultShape(ipaPath);
    if (!fs.existsSync(ipaPath)) {
        result.errors.push({ code: 'file_missing', message: `IPA not found at ${ipaPath}` });
        return result;
    }

    let directory;
    try { directory = await unzipper.Open.file(ipaPath); }
    catch (err) {
        result.errors.push({ code: 'unreadable', message: `Could not open IPA: ${err.message}` });
        return result;
    }

    // Find the .app inside Payload/
    const appRoot = findAppRoot(directory.files);
    if (!appRoot) {
        result.errors.push({ code: 'no_app_bundle', message: 'No Payload/<App>.app/ directory found inside IPA.' });
        return result;
    }
    result.appName = path.basename(appRoot).replace(/\.app$/, '');
    result.appBundlePath = appRoot;

    // Group entries by category for later passes
    const appFiles = directory.files.filter(f => f.path.startsWith(appRoot + '/') && f.type === 'File');
    const infoEntry = appFiles.find(f => f.path === `${appRoot}/Info.plist`);
    const execEntry = appFiles.find(f => f.path === `${appRoot}/${result.appName}`);
    const mobileprovisionEntry = appFiles.find(f => f.path === `${appRoot}/embedded.mobileprovision`);

    // ── 1. Info.plist ──────────────────────────────────────────────────────
    if (infoEntry) {
        try {
            const buf = await infoEntry.buffer();
            const info = plistParser.parsePlist(buf);
            populateFromInfoPlist(result, info);
        } catch (err) {
            result.errors.push({ code: 'info_plist_parse', message: err.message });
        }
    } else {
        result.errors.push({ code: 'info_plist_missing', message: 'Info.plist not found in .app bundle' });
    }

    // ── 2. Mach-O executable: architecture detection ───────────────────────
    if (execEntry) {
        try {
            const buf = await execEntry.buffer();
            result.executable = analyzeMachO(buf);
        } catch (err) {
            result.errors.push({ code: 'macho_parse', message: err.message });
        }
    }

    // ── 3. Frameworks ─────────────────────────────────────────────────────
    const frameworkDirs = new Set();
    for (const f of directory.files) {
        const m = f.path.match(new RegExp(`^${escapeRe(appRoot)}/Frameworks/([^/]+\\.framework)/`));
        if (m) frameworkDirs.add(m[1]);
    }
    result.frameworks = Array.from(frameworkDirs).sort();

    // SDK detection from framework names + bundle id
    const detected = new Set();
    for (const fw of result.frameworks) {
        for (const sdk of FRAMEWORK_SDKS) {
            if (sdk.match.test(fw)) detected.add(sdk.name);
        }
    }
    result.sdks = Array.from(detected);
    result.engine = pickEngine(result.frameworks, result.sdks);

    // ── 4. embedded.mobileprovision ───────────────────────────────────────
    if (mobileprovisionEntry) {
        try {
            const buf = await mobileprovisionEntry.buffer();
            result.provisioning = parseMobileProvision(buf);
        } catch (err) {
            result.errors.push({ code: 'mobileprovision_parse', message: err.message });
        }
    }

    // ── 5. Localization directories ───────────────────────────────────────
    const lprojSet = new Set();
    for (const f of directory.files) {
        const m = f.path.match(new RegExp(`^${escapeRe(appRoot)}/([\\w-]+)\\.lproj/`));
        if (m) lprojSet.add(m[1]);
    }
    result.locales = Array.from(lprojSet).sort();

    // ── 6. PlugIns / Extensions ───────────────────────────────────────────
    const plugins = new Set();
    for (const f of directory.files) {
        const m = f.path.match(new RegExp(`^${escapeRe(appRoot)}/PlugIns/([^/]+\\.appex)/`));
        if (m) plugins.add(m[1]);
    }
    result.appExtensions = Array.from(plugins).sort();

    // ── 7. Asset integrity (narrative-game side benefit) ──────────────────
    result.assetIntegrity = await collectAssetIntegrity(appFiles, appRoot);

    // ── 8. Bundle size + file count ───────────────────────────────────────
    let total = 0;
    for (const f of appFiles) total += f.uncompressedSize || 0;
    result.bundleSize = total;
    result.fileCount = appFiles.length;

    return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function newResultShape(ipaPath) {
    return {
        ipaPath,
        appName: null,
        appBundlePath: null,
        bundleId: null,
        bundleName: null,
        displayName: null,
        version: null,
        build: null,
        minimumOSVersion: null,
        platformVersion: null,
        supportedPlatforms: [],
        deviceFamily: [],
        urlSchemes: [],
        permissions: [],
        ats: null,
        executable: null,           // { archs: [], encrypted: bool, fileType: '' }
        frameworks: [],
        sdks: [],
        engine: 'Native',
        provisioning: null,
        locales: [],
        appExtensions: [],
        assetIntegrity: null,
        bundleSize: 0,
        fileCount: 0,
        errors: []
    };
}

function findAppRoot(files) {
    // Look for Payload/<X>.app/Info.plist; appRoot is everything before /Info.plist
    for (const f of files) {
        const m = f.path.match(/^(Payload\/[^/]+\.app)\/Info\.plist$/);
        if (m) return m[1];
    }
    // Fallback — find any *.app/ directory entry
    for (const f of files) {
        const m = f.path.match(/^(Payload\/[^/]+\.app)\//);
        if (m) return m[1];
    }
    return null;
}

function populateFromInfoPlist(result, info) {
    if (!info || typeof info !== 'object') return;
    result.bundleId        = info.CFBundleIdentifier            || null;
    result.bundleName      = info.CFBundleName                   || null;
    result.displayName     = info.CFBundleDisplayName            || result.bundleName;
    result.version         = info.CFBundleShortVersionString     || null;
    result.build           = info.CFBundleVersion                || null;
    result.minimumOSVersion = info.MinimumOSVersion              || info.LSMinimumSystemVersion || null;
    result.platformVersion = info.DTPlatformVersion              || null;
    result.supportedPlatforms = info.CFBundleSupportedPlatforms || [];

    const family = info.UIDeviceFamily;
    if (Array.isArray(family)) {
        result.deviceFamily = family.map(n => {
            if (n === 1) return 'iPhone';
            if (n === 2) return 'iPad';
            if (n === 3) return 'AppleTV';
            if (n === 6) return 'Mac';
            return String(n);
        });
    }

    // URL schemes
    const urlTypes = info.CFBundleURLTypes || [];
    if (Array.isArray(urlTypes)) {
        for (const t of urlTypes) {
            if (t && Array.isArray(t.CFBundleURLSchemes)) {
                for (const sch of t.CFBundleURLSchemes) result.urlSchemes.push(sch);
            }
        }
    }

    // Permissions: only surface keys that have a description set (i.e. app declares the permission)
    for (const key of PERMISSION_KEYS) {
        if (key in info && typeof info[key] === 'string' && info[key].trim().length > 0) {
            result.permissions.push({ key, reason: info[key] });
        }
    }

    // ATS (App Transport Security)
    if (info.NSAppTransportSecurity && typeof info.NSAppTransportSecurity === 'object') {
        const a = info.NSAppTransportSecurity;
        result.ats = {
            allowsArbitraryLoads:       !!a.NSAllowsArbitraryLoads,
            allowsLocalNetworking:      !!a.NSAllowsLocalNetworking,
            allowsArbitraryLoadsInMedia: !!a.NSAllowsArbitraryLoadsInMedia,
            exceptionDomains: a.NSExceptionDomains
                ? Object.keys(a.NSExceptionDomains).slice(0, 20)
                : []
        };
    }
}

function analyzeMachO(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    const magicBe = buf.readUInt32BE(0);
    const magicLe = buf.readUInt32LE(0);
    const machoBe = MACHO_MAGIC[magicBe];
    const machoLe = MACHO_MAGIC[magicLe];

    if (machoBe && machoBe.arch === 'fat') {
        // FAT (universal) binary — multiple archs concatenated
        const archCount = buf.readUInt32BE(4);
        const archs = [];
        for (let i = 0; i < archCount && i < 32; i++) {
            const headerOff = 8 + i * 20;
            if (headerOff + 20 > buf.length) break;
            const cpuType = buf.readUInt32BE(headerOff);
            archs.push(cpuTypeName(cpuType));
        }
        return { archs, fat: true, fileType: 'mach-o-universal' };
    }

    if (machoBe || machoLe) {
        const m = machoBe || machoLe;
        // cpu_type at offset 4 (post-magic)
        const cpuType = m.endian === 'be'
            ? buf.readUInt32BE(4)
            : buf.readUInt32LE(4);
        return {
            archs: [cpuTypeName(cpuType)],
            fat: false,
            fileType: m.bits ? `mach-o-${m.bits}` : 'mach-o',
            bits: m.bits
        };
    }
    return { archs: [], fileType: 'unknown', error: `unrecognized magic 0x${magicBe.toString(16)}` };
}

function cpuTypeName(t) {
    // From <mach/machine.h>
    const TYPES = {
        7:         'x86',
        0x01000007:'x86_64',
        12:        'arm',
        0x0100000c:'arm64',
        0x0200000c:'arm64_32'
    };
    return TYPES[t] || `cpu_0x${t.toString(16)}`;
}

function parseMobileProvision(buf) {
    // mobileprovision is a CMS (PKCS#7) signed envelope. The inner payload is
    // an XML plist. We don't validate the signature — just extract the plist.
    const text = buf.toString('binary');
    const plistStart = text.indexOf('<?xml');
    const plistEnd   = text.lastIndexOf('</plist>');
    if (plistStart < 0 || plistEnd < 0) return { error: 'no plist payload in mobileprovision' };
    const xml = text.slice(plistStart, plistEnd + '</plist>'.length);
    let plist;
    try { plist = plistParser.parsePlist(xml); }
    catch (e) { return { error: 'plist parse: ' + e.message }; }

    return {
        appIDName:           plist.AppIDName            || null,
        teamName:            plist.TeamName             || null,
        teamId:              (plist.TeamIdentifier && plist.TeamIdentifier[0]) || null,
        platform:            plist.Platform             || null,
        creationDate:        plist.CreationDate         || null,
        expirationDate:      plist.ExpirationDate       || null,
        provisionedDevices:  Array.isArray(plist.ProvisionedDevices) ? plist.ProvisionedDevices : null,
        provisionedDeviceCount: Array.isArray(plist.ProvisionedDevices) ? plist.ProvisionedDevices.length : 0,
        provisionsAllDevices: !!plist.ProvisionsAllDevices,
        isAdHoc:             !!(Array.isArray(plist.ProvisionedDevices) && plist.ProvisionedDevices.length > 0 && !plist.ProvisionsAllDevices),
        isEnterprise:        !!plist.ProvisionsAllDevices,
        isAppStore:          !plist.ProvisionedDevices && !plist.ProvisionsAllDevices,
        entitlements:        plist.Entitlements         || null
    };
}

function pickEngine(frameworks, sdks) {
    if (sdks.includes('Unity Engine')) return 'Unity';
    if (sdks.includes('Unreal Engine')) return 'Unreal';
    if (sdks.includes('Cocos2d')) return 'Cocos2d';
    if (sdks.includes('Godot')) return 'Godot';
    if (sdks.includes('Flutter')) return 'Flutter';
    // Heuristic: presence of dynamic framework with engine name in lowercase
    for (const fw of frameworks) {
        if (/unity/i.test(fw)) return 'Unity';
        if (/unreal|UE4/i.test(fw)) return 'Unreal';
    }
    return 'Native';
}

function classifyAsset(p) {
    const lower = p.toLowerCase();
    for (const [cat, exts] of Object.entries(ASSET_EXT)) {
        if (exts.some(e => lower.endsWith(e))) return cat;
    }
    return 'other';
}

async function collectAssetIntegrity(appFiles, appRoot) {
    const out = {
        totalFiles: 0,
        totalBytes: 0,
        zeroByteCount: 0,
        zeroByteFiles: [],
        suspiciousAudioCount: 0,
        suspiciousAudio: [],
        categories: {}
    };
    for (const f of appFiles) {
        const size = f.uncompressedSize || 0;
        const cat = classifyAsset(f.path);
        if (!out.categories[cat]) out.categories[cat] = { count: 0, bytes: 0 };
        out.categories[cat].count++;
        out.categories[cat].bytes += size;
        out.totalFiles++;
        out.totalBytes += size;
        if (size === 0 && cat !== 'other') {
            out.zeroByteCount++;
            if (out.zeroByteFiles.length < 50) out.zeroByteFiles.push(f.path.slice(appRoot.length + 1));
        }
        if (cat === 'audio' && size > 0 && size < TINY_AUDIO_BYTES) {
            out.suspiciousAudioCount++;
            if (out.suspiciousAudio.length < 30) out.suspiciousAudio.push({
                path: f.path.slice(appRoot.length + 1),
                bytes: size
            });
        }
    }
    return out;
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { analyzeIpa };
