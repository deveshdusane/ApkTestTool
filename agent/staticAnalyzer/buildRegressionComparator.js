'use strict';

const fs = require('fs');
const path = require('path');
const apkAnalyzer = require('./apkAnalyzer');
const projectManager = require('../manager/projectManager');

const RISKY_PERMISSIONS = new Set([
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_SMS',
    'android.permission.SEND_SMS',
    'android.permission.RECEIVE_SMS',
    'android.permission.READ_PHONE_STATE',
    'android.permission.READ_PHONE_NUMBERS',
    'android.permission.CALL_PHONE',
    'android.permission.PROCESS_OUTGOING_CALLS',
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.PACKAGE_USAGE_STATS',
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.READ_CALL_LOG',
    'android.permission.WRITE_CALL_LOG',
    'android.permission.READ_CALENDAR',
    'android.permission.WRITE_CALENDAR'
]);

function compareVersions(a, b) {
    const partsA = String(a || '0').split('.').map(n => parseInt(n) || 0);
    const partsB = String(b || '0').split('.').map(n => parseInt(n) || 0);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const av = partsA[i] || 0;
        const bv = partsB[i] || 0;
        if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
}

function diffArrays(oldArr, newArr) {
    const oldSet = new Set(oldArr || []);
    const newSet = new Set(newArr || []);
    const added = [...newSet].filter(x => !oldSet.has(x));
    const removed = [...oldSet].filter(x => !newSet.has(x));
    return { added, removed };
}

function bytesHuman(n) {
    if (!n && n !== 0) return 'N/A';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

class BuildRegressionComparator {
    /**
     * Compare two APKs and produce a structured diff.
     * @param {Object} args
     * @param {string} args.oldApkPath
     * @param {string} args.newApkPath
     * @param {string} [args.projectName] - to pull session-history performance deltas
     */
    async compare({ oldApkPath, newApkPath, projectName = null }) {
        if (!oldApkPath || !fs.existsSync(oldApkPath)) {
            return { success: false, error: 'Old APK not found at ' + oldApkPath };
        }
        if (!newApkPath || !fs.existsSync(newApkPath)) {
            return { success: false, error: 'New APK not found at ' + newApkPath };
        }
        if (path.resolve(oldApkPath) === path.resolve(newApkPath)) {
            return { success: false, error: 'Old and new APK paths are identical' };
        }

        const [oldInfo, newInfo] = await Promise.all([
            apkAnalyzer.analyze(oldApkPath),
            apkAnalyzer.analyze(newApkPath)
        ]);
        if (!oldInfo) return { success: false, error: 'Failed to analyze old APK' };
        if (!newInfo) return { success: false, error: 'Failed to analyze new APK' };

        const oldSize = this._safeFileSize(oldApkPath);
        const newSize = this._safeFileSize(newApkPath);

        const sizeDelta = this._buildSizeDiff(oldSize, newSize);
        const versionDelta = this._buildVersionDiff(oldInfo, newInfo);
        const sdkLevelDelta = this._buildSdkLevelDiff(oldInfo, newInfo);
        const permissionsDelta = this._buildPermissionsDiff(oldInfo, newInfo);
        const sdksDelta = this._buildSdksDiff(oldInfo, newInfo);
        const manifestDelta = this._buildManifestDiff(oldInfo, newInfo);
        const securityDelta = this._buildSecurityDiff(oldInfo, newInfo);
        const performanceDelta = projectName ? this._buildPerformanceDiff(projectName, oldInfo, newInfo) : null;

        const verdict = this._buildVerdict({
            sizeDelta, versionDelta, permissionsDelta, sdksDelta, manifestDelta, securityDelta
        });

        return {
            success: true,
            old: {
                file: path.basename(oldApkPath),
                size: oldSize,
                sizeHuman: bytesHuman(oldSize),
                packageName: oldInfo.packageName,
                versionName: oldInfo.versionName,
                versionCode: oldInfo.versionCode
            },
            new: {
                file: path.basename(newApkPath),
                size: newSize,
                sizeHuman: bytesHuman(newSize),
                packageName: newInfo.packageName,
                versionName: newInfo.versionName,
                versionCode: newInfo.versionCode
            },
            packageMatch: oldInfo.packageName === newInfo.packageName,
            sizeDelta,
            versionDelta,
            sdkLevelDelta,
            permissionsDelta,
            sdksDelta,
            manifestDelta,
            securityDelta,
            performanceDelta,
            verdict
        };
    }

    _safeFileSize(p) {
        try {
            return fs.statSync(p).size;
        } catch {
            return 0;
        }
    }

    _buildSizeDiff(oldSize, newSize) {
        const delta = newSize - oldSize;
        const pct = oldSize > 0 ? (delta / oldSize) * 100 : 0;
        let severity = 'OK';
        if (Math.abs(pct) >= 25) severity = 'HIGH';
        else if (Math.abs(pct) >= 10) severity = 'MEDIUM';
        else if (Math.abs(pct) >= 3) severity = 'LOW';
        return {
            oldBytes: oldSize,
            newBytes: newSize,
            deltaBytes: delta,
            deltaHuman: (delta >= 0 ? '+' : '') + bytesHuman(Math.abs(delta)),
            percent: Number(pct.toFixed(2)),
            direction: delta > 0 ? 'INCREASED' : delta < 0 ? 'DECREASED' : 'UNCHANGED',
            severity
        };
    }

    _buildVersionDiff(oldInfo, newInfo) {
        const oldVc = parseInt(oldInfo.versionCode) || 0;
        const newVc = parseInt(newInfo.versionCode) || 0;
        let issue = null;
        if (newVc < oldVc) issue = 'versionCode regressed (Play Store will reject)';
        else if (newVc === oldVc && oldInfo.versionName !== newInfo.versionName) issue = 'versionName changed but versionCode unchanged';
        return {
            oldVersionName: oldInfo.versionName,
            newVersionName: newInfo.versionName,
            oldVersionCode: oldInfo.versionCode,
            newVersionCode: newInfo.versionCode,
            versionCodeDelta: newVc - oldVc,
            versionNameComparison: compareVersions(oldInfo.versionName, newInfo.versionName),
            issue
        };
    }

    _buildSdkLevelDiff(oldInfo, newInfo) {
        const oldMin = parseInt(oldInfo.minSdk) || 0;
        const newMin = parseInt(newInfo.minSdk) || 0;
        const oldTgt = parseInt(oldInfo.targetSdk) || 0;
        const newTgt = parseInt(newInfo.targetSdk) || 0;
        const issues = [];
        if (newMin > oldMin) issues.push(`minSdk raised from ${oldMin} to ${newMin} — drops users on older Android`);
        if (newTgt < oldTgt) issues.push(`targetSdk lowered from ${oldTgt} to ${newTgt} — Play Store may reject`);
        return {
            oldMinSdk: oldInfo.minSdk,
            newMinSdk: newInfo.minSdk,
            oldTargetSdk: oldInfo.targetSdk,
            newTargetSdk: newInfo.targetSdk,
            minSdkDelta: newMin - oldMin,
            targetSdkDelta: newTgt - oldTgt,
            issues
        };
    }

    _buildPermissionsDiff(oldInfo, newInfo) {
        const { added, removed } = diffArrays(oldInfo.permissions, newInfo.permissions);
        const addedRisky = added.filter(p => RISKY_PERMISSIONS.has(p));
        const removedRisky = removed.filter(p => RISKY_PERMISSIONS.has(p));
        return {
            added,
            removed,
            addedRisky,
            removedRisky,
            severity: addedRisky.length > 0 ? 'HIGH' : added.length > 0 ? 'MEDIUM' : 'OK'
        };
    }

    _buildSdksDiff(oldInfo, newInfo) {
        const oldSdks = oldInfo.sdkIntelligence?.sdks || {};
        const newSdks = newInfo.sdkIntelligence?.sdks || {};
        const oldNames = Object.keys(oldSdks).filter(k => oldSdks[k]?.detected);
        const newNames = Object.keys(newSdks).filter(k => newSdks[k]?.detected);
        const { added, removed } = diffArrays(oldNames, newNames);

        const versionChanges = [];
        for (const name of oldNames.filter(n => newNames.includes(n))) {
            const ov = oldSdks[name]?.version;
            const nv = newSdks[name]?.version;
            if (ov && nv && ov !== nv) {
                versionChanges.push({ name, oldVersion: ov, newVersion: nv });
            }
        }

        return {
            added: added.map(n => ({ name: n, category: newSdks[n]?.category, version: newSdks[n]?.version })),
            removed: removed.map(n => ({ name: n, category: oldSdks[n]?.category, version: oldSdks[n]?.version })),
            versionChanges,
            engineChanged: oldInfo.sdkInfo?.engine !== newInfo.sdkInfo?.engine,
            oldEngine: oldInfo.sdkInfo?.engine,
            newEngine: newInfo.sdkInfo?.engine
        };
    }

    _buildManifestDiff(oldInfo, newInfo) {
        const flags = [];
        if (oldInfo.debug !== newInfo.debug) {
            flags.push({
                key: 'debuggable',
                oldValue: oldInfo.debug,
                newValue: newInfo.debug,
                severity: newInfo.debug ? 'HIGH' : 'OK',
                note: newInfo.debug ? 'New build is debuggable — must NOT ship to production' : 'Debuggable flag removed (good)'
            });
        }
        const oldExports = (oldInfo.exportedComponents || []).map(c => c.name || c).sort();
        const newExports = (newInfo.exportedComponents || []).map(c => c.name || c).sort();
        const { added: addedExports, removed: removedExports } = diffArrays(oldExports, newExports);
        return { flags, addedExports, removedExports };
    }

    _buildSecurityDiff(oldInfo, newInfo) {
        const oldRisk = oldInfo.security?.riskLevel || 'LOW';
        const newRisk = newInfo.security?.riskLevel || 'LOW';
        const order = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
        const direction = (order[newRisk] || 0) - (order[oldRisk] || 0);
        return {
            oldRisk,
            newRisk,
            direction: direction > 0 ? 'WORSENED' : direction < 0 ? 'IMPROVED' : 'UNCHANGED',
            severity: direction > 0 ? 'HIGH' : 'OK'
        };
    }

    _buildPerformanceDiff(projectName, oldInfo, newInfo) {
        try {
            const history = projectManager.getHistory(projectName) || [];
            const matchSession = (versionCode) => {
                const matches = history.filter(h =>
                    String(h.apkVersionCode || h.versionCode || '') === String(versionCode)
                );
                return matches.length ? matches[matches.length - 1] : null;
            };
            const oldSession = matchSession(oldInfo.versionCode);
            const newSession = matchSession(newInfo.versionCode);

            if (!oldSession && !newSession) {
                return { available: false, reason: 'No prior session data for either version' };
            }

            const extract = (s) => s ? {
                sessionId: s.sessionId,
                avgFps: s.metrics?.avgFps ?? s.avgFps ?? null,
                minFps: s.metrics?.minFps ?? s.minFps ?? null,
                avgMemoryMb: s.metrics?.avgMemoryMb ?? s.avgMemoryMb ?? null,
                peakMemoryMb: s.metrics?.peakMemoryMb ?? s.peakMemoryMb ?? null,
                crashes: s.crashes ?? s.metrics?.crashes ?? 0,
                anrs: s.anrs ?? s.metrics?.anrs ?? 0
            } : null;

            const o = extract(oldSession);
            const n = extract(newSession);

            const issues = [];
            if (o && n) {
                if (typeof o.avgFps === 'number' && typeof n.avgFps === 'number') {
                    const fpsDelta = n.avgFps - o.avgFps;
                    if (fpsDelta < -3) issues.push(`Average FPS dropped ${Math.abs(fpsDelta).toFixed(1)} (${o.avgFps.toFixed(1)} → ${n.avgFps.toFixed(1)})`);
                }
                if (typeof o.peakMemoryMb === 'number' && typeof n.peakMemoryMb === 'number') {
                    const memDelta = n.peakMemoryMb - o.peakMemoryMb;
                    if (memDelta > 30) issues.push(`Peak memory increased ${memDelta.toFixed(0)} MB (${o.peakMemoryMb.toFixed(0)} → ${n.peakMemoryMb.toFixed(0)})`);
                }
                if (n.crashes > o.crashes) issues.push(`Crash count increased: ${o.crashes} → ${n.crashes}`);
                if (n.anrs > o.anrs) issues.push(`ANR count increased: ${o.anrs} → ${n.anrs}`);
            }

            return {
                available: !!(o || n),
                old: o,
                new: n,
                issues,
                severity: issues.length > 0 ? 'MEDIUM' : 'OK'
            };
        } catch (e) {
            return { available: false, reason: e.message };
        }
    }

    _buildVerdict(parts) {
        const blockers = [];
        const warnings = [];
        const wins = [];

        if (parts.versionDelta.issue) blockers.push(parts.versionDelta.issue);
        if (parts.sdkLevelDelta.issues?.length) {
            for (const issue of parts.sdkLevelDelta.issues) {
                if (issue.includes('Play Store may reject')) blockers.push(issue);
                else warnings.push(issue);
            }
        }
        if (parts.manifestDelta.flags?.length) {
            for (const f of parts.manifestDelta.flags) {
                if (f.severity === 'HIGH') blockers.push(f.note);
                else wins.push(f.note);
            }
        }
        if (parts.permissionsDelta.addedRisky?.length) {
            warnings.push(`${parts.permissionsDelta.addedRisky.length} risky permission(s) added: ${parts.permissionsDelta.addedRisky.join(', ')}`);
        }
        if (parts.sdksDelta.engineChanged) {
            blockers.push(`Engine changed: ${parts.sdksDelta.oldEngine} → ${parts.sdksDelta.newEngine} — full regression test required`);
        }
        if (parts.sizeDelta.severity === 'HIGH') {
            warnings.push(`APK size ${parts.sizeDelta.direction.toLowerCase()} by ${parts.sizeDelta.percent}% (${parts.sizeDelta.deltaHuman})`);
        }
        if (parts.securityDelta.direction === 'WORSENED') {
            warnings.push(`Security risk worsened: ${parts.securityDelta.oldRisk} → ${parts.securityDelta.newRisk}`);
        }

        let status;
        if (blockers.length) status = 'BLOCK';
        else if (warnings.length) status = 'CAUTION';
        else status = 'OK';

        return { status, blockers, warnings, wins };
    }
}

module.exports = new BuildRegressionComparator();
