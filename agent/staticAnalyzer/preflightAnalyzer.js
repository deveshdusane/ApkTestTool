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

    /**
     * Detect APK Signature Scheme v2/v3 by locating the APK Signing Block, read
     * straight from the file bytes — no aapt/apksigner needed. The block sits
     * just before the ZIP Central Directory:
     *     uint64 sizeOfBlock | id-value pairs | uint64 sizeOfBlock | "APK Sig Block 42"
     * Scheme IDs: v2 = 0x7109871a, v3 = 0xf05368c0, v3.1 = 0x1b93ad61.
     *
     * Returns { hasBlock, v2, v3 } or null when it genuinely can't tell (e.g.
     * Zip64). Callers MUST treat null as "unknown" and not assert a failure —
     * the previous check grepped aapt badging for a "v2-signing-ready" string
     * that aapt never emits, so it falsely flagged every APK as legacy-signed.
     */
    detectSigningScheme(apkPath) {
        const MAGIC = 'APK Sig Block 42';
        let fd;
        try {
            const size = fs.statSync(apkPath).size;
            fd = fs.openSync(apkPath, 'r');

            // 1. Find End Of Central Directory (sig 0x06054b50) in the last ~64KB.
            const tailLen = Math.min(size, 65557);
            const tail = Buffer.alloc(tailLen);
            fs.readSync(fd, tail, 0, tailLen, size - tailLen);
            let eocd = -1;
            for (let i = tail.length - 22; i >= 0; i--) {
                if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) return null;

            const cdOffset = tail.readUInt32LE(eocd + 16);
            if (cdOffset <= 0 || cdOffset >= size || cdOffset === 0xffffffff) return null; // odd / Zip64
            if (cdOffset < 24) return { hasBlock: false, v2: false, v3: false };

            // 2. Layout of the last 24 bytes before the central directory:
            //    [cdOffset-24] uint64 trailing block size   (foot[0..8])
            //    [cdOffset-16] "APK Sig Block 42" magic      (foot[8..24])
            const foot = Buffer.alloc(24);
            fs.readSync(fd, foot, 0, 24, cdOffset - 24);
            if (foot.toString('latin1', 8, 24) !== MAGIC) {
                return { hasBlock: false, v2: false, v3: false }; // v1-only / unsigned
            }

            const blockSize = foot.readUInt32LE(0); // trailing size, low dword (block < 4GB)
            const blockStart = cdOffset - blockSize - 8;
            if (blockStart < 0) return { hasBlock: true, v2: false, v3: false };
            const readLen = cdOffset - blockStart;
            if (readLen > 64 * 1024 * 1024) return { hasBlock: true, v2: false, v3: false }; // sanity cap

            const block = Buffer.alloc(readLen);
            fs.readSync(fd, block, 0, readLen, blockStart);

            // 3. Walk id-value pairs (after the leading uint64 size).
            let v2 = false, v3 = false;
            let p = 8;
            const end = block.length - 24; // before trailing size8 + magic16
            while (p + 12 <= end) {
                const pairLen = block.readUInt32LE(p); // low dword of uint64 pair length
                if (pairLen < 4) break;
                const id = block.readUInt32LE(p + 8);
                if (id === 0x7109871a) v2 = true;
                else if (id === 0xf05368c0 || id === 0x1b93ad61) v3 = true;
                p += 8 + pairLen;
            }
            return { hasBlock: true, v2, v3 };
        } catch (_) {
            return null;
        } finally {
            if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
        }
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

            // Signing scheme — read the real APK Signing Block. Only flag legacy
            // signing when we POSITIVELY confirm there's no v2/v3 block. If
            // detection is inconclusive (null), stay silent — never assert a
            // failure we can't substantiate.
            const signing = this.detectSigningScheme(apkPath);
            if (signing && !signing.v2 && !signing.v3) {
                results.issues.push({
                    id: 'legacy_signing',
                    severity: 'MEDIUM',
                    title: 'Legacy APK signing scheme',
                    desc: 'APK is signed with v1 (JAR) signing only — no APK Signature Scheme v2/v3 block found. v1-only signing is more tampering-prone and is not accepted for modern Play uploads.',
                    fix: 'Enable APK Signature Scheme v2/v3 in the build configuration.',
                    evidence: 'No "APK Sig Block 42" present before the ZIP central directory.',
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
                { name: 'arm64-v8a', value: hasArm64 ? 'Present' : (hasLib ? 'Missing' : 'No native libs') },
                { name: 'Signing', value: signing ? (signing.v3 ? 'v3' : signing.v2 ? 'v2' : (signing.hasBlock ? 'v2+ block' : 'v1 only')) : 'Unverified' }
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
