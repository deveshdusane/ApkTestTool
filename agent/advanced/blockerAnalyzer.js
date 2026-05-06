const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const securityAnalyzer = require('../staticAnalyzer/securityAnalyzer');
const aaptResolver = require('../utils/aaptResolver');

class BlockerAnalyzer {
    constructor() {
        this.PLAY_STORE_MIN_TARGET_SDK = 33; // Android 13
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
            summary: {
                critical: 0,
                high: 0,
                medium: 0
            },
            issues: [],
            environment: [],
            score: 100,
            status: 'Stable'
        };

        try {
            // 1. Get Badging Info
            const badging = await this.runAaptCommand(`"${aaptCmd}" dump badging "${apkPath}"`);
            const targetSdkMatch = badging.match(/targetSdkVersion:'(\d+)'/);
            const targetSdk = targetSdkMatch ? parseInt(targetSdkMatch[1]) : 0;
            const versionMatch = badging.match(/versionName='([^']+)'/);
            const packageMatch = badging.match(/package: name='([^']+)'/);

            // 2. Check Architecture
            const listOutput = await this.runAaptCommand(`"${aaptCmd}" list "${apkPath}"`);
            const files = listOutput.split('\n');
            const hasArm64 = files.some(f => f.includes('lib/arm64-v8a/'));
            const hasLib = files.some(f => f.includes('lib/'));

            // 3. Security Audit
            const securityAudit = await securityAnalyzer.analyze(apkPath);

            // --- CRITICAL BLOCKERS ---
            
            // 64-bit Requirement
            if (hasLib && !hasArm64) {
                results.issues.push({
                    severity: 'CRITICAL',
                    title: 'Missing 64-bit Architecture',
                    desc: 'The APK contains native 32-bit libraries but lacks arm64-v8a support. Google Play requires all apps with native code to provide 64-bit versions.',
                    fix: 'Enable arm64-v8a in the project build settings (Unity: Scripting Backend IL2CPP + Target Architecture ARM64).',
                    icon: '🚫'
                });
                results.summary.critical++;
                results.score -= 40;
            }

            // Target SDK Compliance
            if (targetSdk < this.PLAY_STORE_MIN_TARGET_SDK) {
                results.issues.push({
                    severity: 'CRITICAL',
                    title: `Invalid Target SDK (${targetSdk})`,
                    desc: `This APK targets API level ${targetSdk}. Google Play currently requires a minimum of API level ${this.PLAY_STORE_MIN_TARGET_SDK}.`,
                    fix: `Update targetSdkVersion to ${this.PLAY_STORE_MIN_TARGET_SDK} or higher in the AndroidManifest.xml or build.gradle.`,
                    icon: '🚩'
                });
                results.summary.critical++;
                results.score -= 30;
            }

            // --- HIGH PRIORITY ---

            // Debuggable Flag
            if (securityAudit.debuggable) {
                results.issues.push({
                    severity: 'HIGH',
                    title: 'Debuggable Build Detected',
                    desc: 'The android:debuggable flag is set to true. This significantly reduces performance and allows unauthorized access to app data.',
                    fix: 'Set android:debuggable="false" in the AndroidManifest.xml or ensure a Release build is generated.',
                    icon: '🐛'
                });
                results.summary.high++;
                results.score -= 20;
            }

            // Cleartext Traffic
            if (securityAudit.usesCleartextTraffic) {
                results.issues.push({
                    severity: 'HIGH',
                    title: 'Unencrypted Network Traffic',
                    desc: 'The app allows cleartext HTTP traffic. This exposes user data to Man-In-The-Middle (MITM) attacks during gameplay.',
                    fix: 'Disable android:usesCleartextTraffic or use a Network Security Configuration to enforce HTTPS.',
                    icon: '📡'
                });
                results.summary.high++;
                results.score -= 10;
            }

            // --- MEDIUM REVIEW ---

            // Dangerous Permissions
            if (securityAudit.criticalDangerousPermissions?.length > 0) {
                const perms = securityAudit.criticalDangerousPermissions.map(p => p.split('.').pop());
                results.issues.push({
                    severity: 'MEDIUM',
                    title: 'Privacy-Sensitive Permissions',
                    desc: `The app requests high-risk permissions: ${perms.join(', ')}. These often require explicit privacy policy disclosures.`,
                    fix: 'Verify if these permissions are absolutely necessary for core gameplay features.',
                    icon: '🔒'
                });
                results.summary.medium++;
                results.score -= 5;
            }

            // V2 Signing
            if (!badging.includes('v2-signing-ready')) {
                results.issues.push({
                    severity: 'MEDIUM',
                    title: 'Legacy APK Signing',
                    desc: 'APK is not using V2/V3 signing scheme. Older signing schemes are more vulnerable to tampering.',
                    fix: 'Enable V2/V3 signing in the APK Signature scheme settings during the build process.',
                    icon: '✍'
                });
                results.summary.medium++;
                results.score -= 5;
            }

            // --- ENVIRONMENT CHECKLIST ---
            results.environment = [
                { name: 'Package Name', value: packageMatch ? packageMatch[1] : 'Unknown' },
                { name: 'Version', value: versionMatch ? versionMatch[1] : 'Unknown' },
                { name: 'Min SDK', value: badging.match(/sdkVersion:'(\d+)'/)?.[1] || 'Unknown' },
                { name: 'Arm64-v8a', value: hasArm64 ? 'Detected' : 'Missing' }
            ];

            results.score = Math.max(0, results.score);
            results.status = results.summary.critical > 0 ? 'Blocked' : results.summary.high > 0 ? 'Unstable' : 'Ready';

            return results;
        } catch (err) {
            return { error: err.message };
        }
    }
}

module.exports = new BlockerAnalyzer();
