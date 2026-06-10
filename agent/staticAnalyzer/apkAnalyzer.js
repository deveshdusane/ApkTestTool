const fs = require('fs');
const { exec } = require('child_process');
const AppInfoParser = require('app-info-parser');
const securityAnalyzer = require('./securityAnalyzer');
const sdkIntelligence = require('../advanced/sdkIntelligence');
const assetIntegrityAnalyzer = require('./assetIntegrityAnalyzer');

const { getToolPath } = require('../utils/toolPaths');

const aaptExecName = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
let aaptPath = getToolPath(aaptExecName);

if (!fs.existsSync(aaptPath)) {
    try {
        require('child_process').execSync('aapt version', { stdio: 'ignore' });
        aaptPath = 'aapt';
    } catch (e) {}
}

class ApkAnalyzer {
    runAaptCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (err, stdout) => {
                if (err) return reject(err);
                resolve(stdout);
            });
        });
    }

    async detectEngineFromAPK(apkPath) {
        try {
            const unzipper = require('unzipper');
            const directory = await unzipper.Open.file(apkPath);
            const files = directory.files.map(f => f.path);

            const hasUnity = files.some(f => f.toLowerCase().includes('libunity.so') || f.toLowerCase().includes('unity-classes.jar') || f.toLowerCase().includes('assets/bin/data'));
            if (hasUnity) return 'Unity';

            const hasUnreal = files.some(f => f.toLowerCase().includes('libue4.so') || f.toLowerCase().includes('libunreal.so'));
            if (hasUnreal) return 'Unreal Engine';

            const hasCocos = files.some(f => f.toLowerCase().includes('libcocos2d') || f.toLowerCase().includes('cocos2d-js'));
            if (hasCocos) return 'Cocos';

            return 'Native / Unknown';
        } catch (e) {
            console.error('Engine detection failed:', e);
            return 'Unknown';
        }
    }

    async detectSDKsFromAPK(apkPath) {
        try {
            const unzipper = require('unzipper');
            const directory = await unzipper.Open.file(apkPath);
            const files = directory.files.map(f => f.path);

            const sdk = {
                ads: false,
                firebase: false
            };

            // Ads detection
            if (files.some(f => f.includes('com/google/android/gms/ads') || f.includes('lib/ads') || f.includes('unityads'))) {
                sdk.ads = true;
            }

            // Firebase detection
            if (files.some(f => f.includes('com/google/firebase') || f.includes('google-services.json'))) {
                sdk.firebase = true;
            }

            return sdk;
        } catch {
            return { ads: false, firebase: false };
        }
    }

    /**
     * Main analysis entry point.
     * Extracts full metadata using AAPT badging with multiple fallback layers.
     */
    async analyze(apkPath) {
        if (!apkPath) return null;

        // 1. Initialize safe defaults
        const info = {
            packageName: "Analysis in progress...",
            versionName: "N/A",
            versionCode: "N/A",
            minSdk: "N/A",
            targetSdk: "N/A",
            permissions: [],
            debug: false,
            exportedComponents: [],
            sdkInfo: { engine: "Native", firebase: false, ads: false },
            sdkIntelligence: sdkIntelligence.createEmptyIntelligence(),
            security: { riskLevel: "LOW", dangerousPermissions: [], exportedComponents: [], debuggable: false }
        };

        if (!fs.existsSync(apkPath)) return null;

        // 2. APK Manifest Parser (binary AndroidManifest.xml)
        // This is the primary source for manifest facts because it works without
        // a platform-specific aapt binary and reads directly from the APK.
        let manifest = null;
        try {
            manifest = await securityAnalyzer.parseManifest(apkPath);
            const manifestPermissions = securityAnalyzer.getPermissionNames(manifest);
            const sdk = manifest.usesSdk || {};

            info.packageName = manifest.package || info.packageName;
            info.versionName = manifest.versionName || info.versionName;
            info.versionCode = manifest.versionCode || info.versionCode;
            info.minSdk = sdk.minSdkVersion || info.minSdk;
            info.targetSdk = sdk.targetSdkVersion || info.targetSdk;

            // Robust targetSdk fallbacks from manifest root attributes
            if (info.targetSdk === "N/A") {
                info.targetSdk = manifest.compileSdkVersion
                    || manifest.platformBuildVersionCode
                    || manifest.compileSdkVersionCodename
                    || info.targetSdk;
            }

            info.permissions = manifestPermissions;
            info.debug = securityAnalyzer.normalizeBoolean(manifest.application?.debuggable);
            info.exportedComponents = securityAnalyzer.collectExportedComponents(manifest);
            info.security = securityAnalyzer.buildAudit(manifest, info.permissions);
        } catch (err) {
            manifest = null;
        }

        // 3. Baseline Fallback Parser (JS Only)
        try {
            const parser = new AppInfoParser(apkPath);
            const result = await parser.parse();
            info.packageName = result.package || info.packageName;
            info.versionName = result.versionName || result.version || info.versionName;
            info.versionCode = result.versionCode || info.versionCode;
            if (!info.permissions.length) {
                const parsedPermissions = [
                    ...(result.usesPermissions || []),
                    ...(result.usesPermissionsSDK23 || [])
                ].flatMap(permission => permission.name ? [permission.name] : []);
                info.permissions = [...new Set(parsedPermissions)];
            }
            
            // Aggressive Property Scan for Baseline Parser
            const findDeep = (obj, key) => {
                if (!obj || typeof obj !== "object") return undefined;
                if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
                for (let k in obj) {
                    if (obj[k] && typeof obj[k] === 'object') {
                        let found = findDeep(obj[k], key);
                        if (found !== undefined) return found;
                    }
                }
            };


            
            info.minSdk = info.minSdk === "N/A" ? (findDeep(result, 'minSdkVersion') || result.sdkVersion || "N/A") : info.minSdk;
            info.targetSdk = info.targetSdk === "N/A" ? (findDeep(result, 'targetSdkVersion') || result.targetSdkVersion || "N/A") : info.targetSdk;
        } catch (err) {
            // baseline parser unavailable — AAPT will fill these fields below
        }

        // 4. Enhancement with Bundled AAPT
        if (aaptPath === 'aapt' || fs.existsSync(aaptPath)) {
            try {
                const aaptCmdStr = aaptPath === 'aapt' ? 'aapt' : `"${aaptPath}"`;
                const output = await this.runAaptCommand(`${aaptCmdStr} dump badging "${apkPath}"`);

                // Flexible Metadata Parsing (Flexible whitespace and quotes)
                const pkgMatch = output.match(/package: name='([^']+)'/) || output.match(/package:.*name='([^']+)'/);
                const vcMatch = output.match(/versionCode='([^']+)'/);
                const vnMatch = output.match(/versionName='([^']+)'/);
                
                if (pkgMatch) info.packageName = pkgMatch[1];
                if (vcMatch) info.versionCode = vcMatch[1];
                if (vnMatch) info.versionName = vnMatch[1];

                let minSdk = "N/A";
                const minSdkMatch = output.match(/sdkVersion:'(\d+)'/);
                if (minSdkMatch && minSdkMatch[1]) {
                    minSdk = minSdkMatch[1];
                }

                let targetSdk = "N/A";
                const targetSdkMatch = output.match(/targetSdkVersion:\s*'(\d+)'/) || output.match(/targetSdkVersion:'(\d+)'/);
                if (targetSdkMatch && targetSdkMatch[1]) {
                    targetSdk = targetSdkMatch[1];
                }

                if (targetSdk === "N/A") {
                    const altMatch = output.match(/targetSdkVersion:(\d+)/);
                    if (altMatch) targetSdk = altMatch[1];
                }
                
                // Fallback for minSdk if still N/A
                if (minSdk === "N/A") {
                    const altMinMatch = output.match(/sdkVersion:'?(\d+)'?/);
                    if (altMinMatch) minSdk = altMinMatch[1];
                }

                if (minSdk !== "N/A") info.minSdk = minSdk;
                if (targetSdk !== "N/A") info.targetSdk = targetSdk;

                // Debug Flag
                if (output.includes("application-debuggable")) {
                    info.debug = true;
                    info.security.debuggable = true;
                }

                // Do not infer exported components from launchable-activity here.
                // Full component data comes from AndroidManifest.xml parsing.

                // Permissions extraction (Improved Regex to capture all permissions).
                // Dedup with a Set (O(1) membership) instead of array.includes()
                // on every match, which re-scanned the whole list each time.
                const permSeen = new Set(info.permissions);
                const addPerm = (p) => { if (!permSeen.has(p)) { permSeen.add(p); info.permissions.push(p); } };

                const permRegex = /uses-permission:.*?name='([^']+)'/g;
                let match;
                while ((match = permRegex.exec(output)) !== null) addPerm(match[1]);

                // Fallback for different syntax: uses-permission:'...'
                const altPermRegex = /uses-permission:'([^']+)'/g;
                while ((match = altPermRegex.exec(output)) !== null) addPerm(match[1]);

                // Supplementary list check for Engine (inside aapt)
                try {
                    const listOutput = await this.runAaptCommand(`${aaptCmdStr} list "${apkPath}"`);
                    info.sdkInfo.ads = info.sdkInfo.ads || (listOutput.includes('ads') || listOutput.includes('admob') || listOutput.includes('applovin'));
                    info.sdkInfo.firebase = info.sdkInfo.firebase || (listOutput.includes('firebase') || listOutput.includes('google-services.json'));
                } catch (e) {}

            } catch (aaptErr) {
                console.error("[StaticAnalyzer] AAPT enhancement failed:", aaptErr.message);
            }
        }

        // 4b. Engine & SDK Detection (does NOT need aapt — uses unzipper)
        try {
            const engine = await this.detectEngineFromAPK(apkPath);
            info.sdkInfo.engine = engine || 'Native / Unknown';
        } catch (e) {
            console.error("[StaticAnalyzer] Engine detection failed:", e.message);
        }

        try {
            const staticSDK = await this.detectSDKsFromAPK(apkPath);
            info.sdkInfo.ads = info.sdkInfo.ads || staticSDK.ads;
            info.sdkInfo.firebase = info.sdkInfo.firebase || staticSDK.firebase;
        } catch (e) {}

        // 5. Security Audit
        try {
            const securityAudit = await securityAnalyzer.analyze(apkPath, info.permissions, aaptPath);
            if (securityAudit && securityAudit.riskLevel !== "N/A") {
                info.security = securityAudit;
                info.exportedComponents = securityAudit.exportedComponents || info.exportedComponents;
            }
        } catch (e) {}

        // 6. SDK Intelligence & Key Extraction
        try {
            info.sdkIntelligence = await sdkIntelligence.scanApk(apkPath, manifest, info.permissions);
            const detectedSdks = info.sdkIntelligence.sdks || {};
            info.sdkInfo.ads = info.sdkInfo.ads || Object.values(detectedSdks).some(sdk => sdk.category === 'ADS' && sdk.detected);
            info.sdkInfo.firebase = info.sdkInfo.firebase || !!detectedSdks.firebase?.detected || !!detectedSdks.firebase_analytics?.detected;
        } catch (e) {}

        // 7. Asset Integrity — narrative-game-focused checks (0-byte stubs,
        //    tiny audio placeholders, duplicates, localization gaps). Cheap
        //    enough to run on every APK so non-narrative builds also benefit
        //    from the duplicate-asset warning.
        try {
            info.assetIntegrity = await assetIntegrityAnalyzer.analyzeAssets(apkPath);
        } catch (e) {
            console.error("[StaticAnalyzer] Asset integrity scan failed:", e.message);
        }

        return info;
    }

}

module.exports = new ApkAnalyzer();
