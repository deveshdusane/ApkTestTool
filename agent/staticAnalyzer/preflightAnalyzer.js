// Pre-flight Checks — static APK compliance scanner.
//
// What this verifies *from the APK file alone*, deterministically:
//   1. 64-bit native architecture (arm64-v8a present when lib/ exists)
//   2. Target SDK ≥ Play Store minimum (currently API 33)
//   3. Debuggable flag — must be false for release builds
//   4. Cleartext network traffic — opens MITM exposure
//   5. High-risk permissions — privacy-policy implications
//   6. V2/V3 signing — required for tamper-resistance
//
// These are NOT gameplay blockers — they are *build/release* compliance issues
// surfaced before the tester even installs the APK. Runtime gameplay blockers
// live in agent/advanced/gameplayBlockerDetector.js.
//
// Severity weights (-40, -30, -20, -10, -5) are authored, not measured. They map
// roughly to Play Store rejection risk: arm64 missing rejects the upload outright,
// debuggable just lowers the readiness score. Treat them as a heuristic ranking,
// not a precise risk model.

const { exec } = require('child_process');
const fs = require('fs');
const securityAnalyzer = require('./securityAnalyzer');
const aaptResolver = require('../utils/aaptResolver');

class PreflightAnalyzer {
    constructor() {
        this.PLAY_STORE_MIN_TARGET_SDK = 33;
    }

    async runAaptCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err) return reject(err);
                resolve(stdout);
            });
        });
    }

    async analyze(apkPath) {
        if (!apkPath || !fs.existsSync(apkPath)) {
            return { error: 'APK file not found.' };
        }

        const aaptCmd = aaptResolver.resolve();
        const results = {
            summary: { critical: 0, high: 0, medium: 0 },
            issues: [],
            environment: [],
            score: 100,
            status: 'Stable'
        };

        try {
            const badging = await this.runAaptCommand(`"${aaptCmd}" dump badging "${apkPath}"`);
            const targetSdkMatch = badging.match(/targetSdkVersion:'(\d+)'/);
            const targetSdk = targetSdkMatch ? parseInt(targetSdkMatch[1]) : 0;
            const versionMatch = badging.match(/versionName='([^']+)'/);
            const packageMatch = badging.match(/package: name='([^']+)'/);

            const listOutput = await this.runAaptCommand(`"${aaptCmd}" list "${apkPath}"`);
            const files = listOutput.split('\n');
            const hasArm64 = files.some(f => f.includes('lib/arm64-v8a/'));
            const hasLib = files.some(f => f.includes('lib/'));

            const securityAudit = await securityAnalyzer.analyze(apkPath);

            // CRITICAL — Play Store will reject the upload.
            if (hasLib && !hasArm64) {
                results.issues.push({
                    id: 'arm64_missing',
                    severity: 'CRITICAL',
                    title: 'Missing 64-bit Architecture',
                    desc: 'Native 32-bit libraries detected without arm64-v8a. Google Play requires 64-bit support for any app shipping native code.',
                    fix: 'Enable arm64-v8a in build settings (Unity: Scripting Backend IL2CPP + Target Architecture ARM64).',
                    evidence: `lib/ present, lib/arm64-v8a/ absent (from \`aapt list ${require('path').basename(apkPath)}\`)`,
                    icon: '🚫'
                });
                results.summary.critical++;
                results.score -= 40;
            }

            if (targetSdk < this.PLAY_STORE_MIN_TARGET_SDK) {
                results.issues.push({
                    id: 'target_sdk_low',
                    severity: 'CRITICAL',
                    title: `Target SDK below Play Store minimum (${targetSdk})`,
                    desc: `Targets API ${targetSdk}; Play Store requires ≥ API ${this.PLAY_STORE_MIN_TARGET_SDK}.`,
                    fix: `Update targetSdkVersion to ${this.PLAY_STORE_MIN_TARGET_SDK} or higher.`,
                    evidence: `aapt: targetSdkVersion:'${targetSdk}'`,
                    icon: '🚩'
                });
                results.summary.critical++;
                results.score -= 30;
            }

            // HIGH — passes Play Store but represents a real risk.
            if (securityAudit.debuggable) {
                results.issues.push({
                    id: 'debuggable',
                    severity: 'HIGH',
                    title: 'Debuggable Build',
                    desc: 'android:debuggable="true" is set. Slows performance, exposes app data via adb.',
                    fix: 'Build a release configuration; ensure debuggable is false.',
                    evidence: 'AndroidManifest.xml: android:debuggable="true"',
                    icon: '🐛'
                });
                results.summary.high++;
                results.score -= 20;
            }

            if (securityAudit.usesCleartextTraffic) {
                results.issues.push({
                    id: 'cleartext_http',
                    severity: 'HIGH',
                    title: 'Cleartext HTTP traffic allowed',
                    desc: 'App permits unencrypted HTTP. Vulnerable to MITM on hostile networks.',
                    fix: 'Set usesCleartextTraffic="false" or use a Network Security Configuration restricting HTTP to specific dev hosts.',
                    evidence: 'AndroidManifest.xml: android:usesCleartextTraffic="true"',
                    icon: '📡'
                });
                results.summary.high++;
                results.score -= 10;
            }

            // MEDIUM — review-required.
            if (securityAudit.criticalDangerousPermissions?.length > 0) {
                const perms = securityAudit.criticalDangerousPermissions.map(p => p.split('.').pop());
                results.issues.push({
                    id: 'dangerous_perms',
                    severity: 'MEDIUM',
                    title: 'High-risk permissions requested',
                    desc: `Requests: ${perms.join(', ')}. May require explicit privacy-policy disclosures and runtime prompts.`,
                    fix: 'Justify each permission against a concrete gameplay feature; remove if unused.',
                    evidence: securityAudit.criticalDangerousPermissions.join('\n'),
                    icon: '🔒'
                });
                results.summary.medium++;
                results.score -= 5;
            }

            if (!badging.includes('v2-signing-ready')) {
                results.issues.push({
                    id: 'legacy_signing',
                    severity: 'MEDIUM',
                    title: 'Legacy APK signing scheme',
                    desc: 'APK lacks v2/v3 signature. Older v1-only signing is more tampering-prone.',
                    fix: 'Enable v2/v3 signing in the build configuration.',
                    evidence: 'aapt dump badging: no `v2-signing-ready` line',
                    icon: '✍'
                });
                results.summary.medium++;
                results.score -= 5;
            }

            results.environment = [
                { name: 'Package', value: packageMatch ? packageMatch[1] : 'Unknown' },
                { name: 'Version', value: versionMatch ? versionMatch[1] : 'Unknown' },
                { name: 'Min SDK', value: badging.match(/sdkVersion:'(\d+)'/)?.[1] || 'Unknown' },
                { name: 'Target SDK', value: targetSdk || 'Unknown' },
                { name: 'arm64-v8a', value: hasArm64 ? 'Present' : (hasLib ? 'Missing' : 'No native libs') }
            ];

            results.score = Math.max(0, results.score);
            results.status = results.summary.critical > 0 ? 'Blocked' : results.summary.high > 0 ? 'At Risk' : 'Ready';

            return results;
        } catch (err) {
            return { error: err.message };
        }
    }
}

module.exports = new PreflightAnalyzer();
