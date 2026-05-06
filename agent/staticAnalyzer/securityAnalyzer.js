
const { exec } = require('child_process');
const fs = require('fs');
const unzipper = require('unzipper');
const ManifestParser = require('app-info-parser/src/xml-parser/manifest');

const { getToolPath } = require('../utils/toolPaths');

/**
 * Security & Permission Audit Module
 * Analyzes APK security risks based on manifest and permissions.
 */
class SecurityAnalyzer {
    constructor() {
        this.DANGEROUS_PERMISSIONS = [
            "READ_EXTERNAL_STORAGE",
            "WRITE_EXTERNAL_STORAGE",
            "READ_MEDIA_AUDIO",
            "READ_MEDIA_IMAGES",
            "READ_MEDIA_VIDEO",
            "READ_CONTACTS",
            "WRITE_CONTACTS",
            "GET_ACCOUNTS",
            "ACCESS_COARSE_LOCATION",
            "ACCESS_FINE_LOCATION",
            "ACCESS_BACKGROUND_LOCATION",
            "RECORD_AUDIO",
            "CAMERA",
            "READ_PHONE_STATE",
            "READ_PHONE_NUMBERS",
            "ANSWER_PHONE_CALLS",
            "READ_SMS",
            "RECEIVE_SMS",
            "SEND_SMS",
            "CALL_PHONE",
            "BODY_SENSORS",
            "POST_NOTIFICATIONS"
        ];

        this.CRITICAL_DANGEROUS_PERMISSIONS = [
            "READ_SMS",
            "RECORD_AUDIO",
            "READ_CONTACTS",
            "READ_CALL_LOG"
        ];

        this.AD_TRACKING_PERMISSIONS = [
            "AD_ID",
            "ACCESS_ADSERVICES_AD_ID",
            "ACCESS_ADSERVICES_ATTRIBUTION",
            "ACCESS_ADSERVICES_TOPICS",
            "ACCESS_ADSERVICES_CUSTOM_AUDIENCE"
        ];

        this.PRIVACY_RELEVANT_PERMISSIONS = [
            "AD_ID",
            "ACCESS_ADSERVICES_AD_ID",
            "ACCESS_ADSERVICES_ATTRIBUTION",
            "ACCESS_ADSERVICES_TOPICS",
            "ACCESS_ADSERVICES_CUSTOM_AUDIENCE",
            "BLUETOOTH_CONNECT"
        ];

        this.STANDARD_SDK_COMPONENT_PREFIXES = [
            "androidx.work.",
            "androidx.profileinstaller.",
            "com.amazon.aps.ads.",
            "com.amazon.device.ads.",
            "com.applovin.",
            "com.chartboost.",
            "com.facebook.",
            "com.google.android.gms.",
            "com.google.firebase.",
            "com.ironsource.",
            "com.mbridge.",
            "com.ogury.",
            "com.unity3d.",
            "com.vungle."
        ];
    }

    async parseManifest(apkPath) {
        const directory = await unzipper.Open.file(apkPath);
        const manifestEntry = directory.files.find(file => /^AndroidManifest\.xml$/i.test(file.path));
        if (!manifestEntry) throw new Error('AndroidManifest.xml not found in APK');

        const buffer = await manifestEntry.buffer();
        return new ManifestParser(buffer).parse();
    }

    getPermissionNames(manifest) {
        const manifestPermissions = [
            ...(manifest?.usesPermissions || []),
            ...(manifest?.usesPermissionsSDK23 || [])
        ];

        return [...new Set(manifestPermissions.map(permission => permission.name).filter(Boolean))];
    }

    normalizeBoolean(value) {
        return value === true || value === 'true' || value === 1 || value === '1';
    }

    isExplicitFalse(value) {
        return value === false || value === 'false' || value === 0 || value === '0';
    }

    resolveComponentName(packageName, componentName) {
        if (!componentName) return 'Unknown';
        if (componentName.startsWith('.')) return `${packageName || ''}${componentName}`;
        if (!componentName.includes('.') && packageName) return `${packageName}.${componentName}`;
        return componentName;
    }

    shortComponentName(fullName) {
        return fullName.split('.').pop() || fullName;
    }

    hasIntentFilters(component) {
        return Array.isArray(component.intentFilters) && component.intentFilters.length > 0;
    }

    isLauncherComponent(component) {
        return (component.intentFilters || []).some(filter => {
            const hasMain = (filter.actions || []).some(action => action.name === 'android.intent.action.MAIN');
            const hasLauncher = (filter.categories || []).some(category => category.name === 'android.intent.category.LAUNCHER');
            return hasMain && hasLauncher;
        });
    }

    getIntentActions(component) {
        const actions = [];
        for (const filter of component.intentFilters || []) {
            for (const action of filter.actions || []) {
                if (action.name && !actions.includes(action.name)) actions.push(action.name);
            }
        }
        return actions;
    }

    getPermissionShortName(permission) {
        return permission.split('.').pop();
    }

    hasAnyPermission(permissions, shortNames) {
        return permissions.some(permission => shortNames.includes(this.getPermissionShortName(permission)));
    }

    isStandardSdkComponent(component) {
        const fullName = component.fullName || '';
        return this.STANDARD_SDK_COMPONENT_PREFIXES.some(prefix => fullName.startsWith(prefix));
    }

    classifyRisk(score) {
        if (score >= 50) return "HIGH";
        if (score >= 20) return "MEDIUM";
        return "LOW";
    }

    createFinding(message, severity, score = 0) {
        return { message, severity, score };
    }

    collectExportedComponents(manifest) {
        const packageName = manifest?.package || '';
        const app = manifest?.application || {};
        const groups = [
            { type: 'Activity', items: app.activities || [] },
            { type: 'Activity Alias', items: app.activityAliases || [] },
            { type: 'Service', items: app.services || [] },
            { type: 'Receiver', items: app.receivers || [] },
            { type: 'Provider', items: app.providers || [] }
        ];
        const exported = [];

        for (const group of groups) {
            for (const component of group.items) {
                const explicitExported = Object.prototype.hasOwnProperty.call(component, 'exported');
                const hasFilters = this.hasIntentFilters(component);
                const isExported = explicitExported
                    ? this.normalizeBoolean(component.exported)
                    : (group.type !== 'Provider' && hasFilters);

                if (!isExported) continue;

                const fullName = this.resolveComponentName(packageName, component.name);
                exported.push({
                    type: group.type,
                    name: this.shortComponentName(fullName),
                    fullName,
                    exported: true,
                    exportedSource: explicitExported ? 'explicit' : 'implicit-intent-filter',
                    enabled: !this.isExplicitFalse(component.enabled),
                    launcher: group.type === 'Activity' || group.type === 'Activity Alias'
                        ? this.isLauncherComponent(component)
                        : false,
                    permission: component.permission || component.readPermission || component.writePermission || null,
                    authorities: component.authorities || null,
                    actions: this.getIntentActions(component)
                });
            }
        }

        return exported;
    }

    buildAudit(manifest, permissions = []) {
        const app = manifest?.application || {};
        const permissionNames = permissions.length ? permissions : this.getPermissionNames(manifest);
        const exportedComponents = this.collectExportedComponents(manifest);
        const riskyExportedComponents = exportedComponents.filter(component => (
            component.enabled &&
            !component.launcher &&
            !component.permission
        ));
        const unprotectedExportedComponents = riskyExportedComponents.filter(component => (
            !this.isStandardSdkComponent(component)
        ));

        const audit = {
            riskLevel: "LOW",
            riskScore: 0,
            source: "apk-manifest",
            dangerousPermissions: [],
            criticalDangerousPermissions: [],
            privacyPermissions: [],
            exportedComponents,
            riskyExportedComponents,
            unprotectedExportedComponents,
            riskReasons: [],
            safeFindings: [],
            debuggable: this.normalizeBoolean(app.debuggable),
            allowBackup: this.normalizeBoolean(app.allowBackup),
            usesCleartextTraffic: this.normalizeBoolean(app.usesCleartextTraffic)
        };

        audit.dangerousPermissions = permissionNames.filter(p => {
            const shortName = this.getPermissionShortName(p);
            return this.DANGEROUS_PERMISSIONS.includes(shortName);
        });
        audit.criticalDangerousPermissions = permissionNames.filter(p => {
            const shortName = this.getPermissionShortName(p);
            return this.CRITICAL_DANGEROUS_PERMISSIONS.includes(shortName);
        });
        audit.privacyPermissions = permissionNames.filter(p => {
            const shortName = this.getPermissionShortName(p);
            return this.PRIVACY_RELEVANT_PERMISSIONS.includes(shortName);
        });
        audit.usesAdTrackingPermissions = this.hasAnyPermission(permissionNames, this.AD_TRACKING_PERMISSIONS);

        if (audit.debuggable) {
            audit.riskScore += 50;
            audit.riskReasons.push(this.createFinding("Debuggable build enabled", "HIGH", 50));
        }

        if (audit.criticalDangerousPermissions.length > 0) {
            audit.riskScore += 40;
            audit.riskReasons.push(this.createFinding(
                `Critical dangerous permissions requested: ${audit.criticalDangerousPermissions.map(p => this.getPermissionShortName(p)).join(', ')}`,
                "HIGH",
                40
            ));
        }

        if (audit.unprotectedExportedComponents.length > 0) {
            audit.riskScore += 30;
            audit.riskReasons.push(this.createFinding(
                `Unprotected app-exported components: ${audit.unprotectedExportedComponents.map(c => c.name).join(', ')}`,
                "HIGH",
                30
            ));
        }

        if (audit.allowBackup) {
            audit.riskScore += 15;
            audit.riskReasons.push(this.createFinding("Backup enabled", "MEDIUM", 15));
        }

        if (exportedComponents.length > 10) {
            audit.riskScore += 10;
            audit.riskReasons.push(this.createFinding("Too many exported components", "MEDIUM", 10));
        }

        if (audit.usesAdTrackingPermissions) {
            audit.riskScore += 5;
            audit.riskReasons.push(this.createFinding("Ad tracking permissions present", "LOW", 5));
        }

        if (audit.criticalDangerousPermissions.length === 0) {
            audit.safeFindings.push(this.createFinding("No critical dangerous permissions found", "SAFE"));
        }
        if (audit.unprotectedExportedComponents.length === 0) {
            audit.safeFindings.push(this.createFinding("No unprotected app-exported components found", "SAFE"));
        }
        if (!audit.debuggable) {
            audit.safeFindings.push(this.createFinding("Debuggable flag disabled", "SAFE"));
        }

        audit.riskLevel = this.classifyRisk(audit.riskScore);
        return audit;
    }

    /**
     * Performs a security audit on the APK.
     * @param {string} apkPath 
     * @param {string[]} permissions List of permissions already extracted
     * @param {string} aaptPath Optional path to bundled aapt
     */
    async analyze(apkPath, permissions = [], aaptPath = null) {
        try {
            const manifest = await this.parseManifest(apkPath);
            return this.buildAudit(manifest, permissions);
        } catch (manifestError) {
            const audit = {
                riskLevel: "LOW",
                riskScore: 0,
                source: "aapt-xmltree",
                dangerousPermissions: [],
                privacyPermissions: [],
                exportedComponents: [],
                riskyExportedComponents: [],
                debuggable: false,
                allowBackup: false,
                usesCleartextTraffic: false,
                criticalDangerousPermissions: [],
                unprotectedExportedComponents: [],
                riskReasons: [],
                safeFindings: [],
                usesAdTrackingPermissions: false
            };

            try {
                audit.dangerousPermissions = permissions.filter(p => {
                    const shortName = this.getPermissionShortName(p);
                    return this.DANGEROUS_PERMISSIONS.includes(shortName);
                });
                audit.criticalDangerousPermissions = permissions.filter(p => {
                    const shortName = this.getPermissionShortName(p);
                    return this.CRITICAL_DANGEROUS_PERMISSIONS.includes(shortName);
                });
                audit.privacyPermissions = permissions.filter(p => {
                    const shortName = this.getPermissionShortName(p);
                    return this.PRIVACY_RELEVANT_PERMISSIONS.includes(shortName);
                });
                audit.usesAdTrackingPermissions = this.hasAnyPermission(permissions, this.AD_TRACKING_PERMISSIONS);

                // 2. Use passed AAPT path or resolve fallback
                const aaptExecName = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
                let aaptCmd = aaptPath || getToolPath(aaptExecName);

                if (aaptCmd !== 'aapt' && !fs.existsSync(aaptCmd)) {
                    try {
                        require('child_process').execSync('aapt version', { stdio: 'ignore' });
                        aaptCmd = 'aapt';
                    } catch (e) {
                        return audit;
                    }
                }


                if (aaptCmd) {
                    // 3. Check Manifest Intelligence (Debuggable & Exported Components)
                    const aaptCmdStr = aaptCmd === 'aapt' ? 'aapt' : `"${aaptCmd}"`;
                    const manifestXml = await this.execPromise(`${aaptCmdStr} dump xmltree "${apkPath}" AndroidManifest.xml`);

                    // Detection: Debuggable
                    if (manifestXml.includes('android:debuggable(0x0101000f)=(type 0x12)0xffffffff') ||
                        manifestXml.includes('android:debuggable(0x0101000f)=(type 0x12)0x1')) {
                        audit.debuggable = true;
                    }

                    // Robust Detection: Exported Components
                    const components = manifestXml.split(/E:\s+(activity|service|receiver|provider)/g);

                    for (let i = 1; i < components.length; i += 2) {
                        const type = components[i];
                        const content = components[i + 1];

                        // Extract name
                        const nameMatch = content.match(/android:name\(0x01010003\)="([^"]+)"/);
                        if (!nameMatch) continue;

                        const name = nameMatch[1];

                        // Check for explicit exported="true"
                        const isExplicitlyExported = content.includes('android:exported(0x01010010)=(type 0x12)0xffffffff') ||
                            content.includes('android:exported(0x01010010)=(type 0x12)0x1');

                        // Check for explicit exported="false"
                        const isExplicitlyHidden = content.includes('android:exported(0x01010010)=(type 0x12)0x0');

                        // Check for intent-filter
                        const hasIntentFilter = content.includes('E: intent-filter');

                        if (isExplicitlyExported || (hasIntentFilter && !isExplicitlyHidden)) {
                            audit.exportedComponents.push({
                                type: type.charAt(0).toUpperCase() + type.slice(1),
                                name: name.split('.').pop(),
                                fullName: name,
                                exported: true,
                                exportedSource: isExplicitlyExported ? 'explicit' : 'implicit-intent-filter',
                                enabled: true,
                                launcher: false,
                                permission: null,
                                authorities: null,
                                actions: []
                            });
                        }
                    }

                    if (audit.exportedComponents.length > 0) {
                        audit.riskyExportedComponents = audit.exportedComponents.filter(component => (
                            component.enabled &&
                            !component.launcher &&
                            !component.permission
                        ));
                        audit.unprotectedExportedComponents = audit.riskyExportedComponents.filter(component => (
                            !this.isStandardSdkComponent(component)
                        ));
                    }
                }

                if (audit.debuggable) {
                    audit.riskScore += 50;
                    audit.riskReasons.push(this.createFinding("Debuggable build enabled", "HIGH", 50));
                }

                if (audit.criticalDangerousPermissions.length > 0) {
                    audit.riskScore += 40;
                    audit.riskReasons.push(this.createFinding(
                        `Critical dangerous permissions requested: ${audit.criticalDangerousPermissions.map(p => this.getPermissionShortName(p)).join(', ')}`,
                        "HIGH",
                        40
                    ));
                }

                if (audit.unprotectedExportedComponents.length > 0) {
                    audit.riskScore += 30;
                    audit.riskReasons.push(this.createFinding(
                        `Unprotected exported components: ${audit.unprotectedExportedComponents.map(c => c.name).join(', ')}`,
                        "HIGH",
                        30
                    ));
                }

                if (audit.allowBackup) {
                    audit.riskScore += 15;
                    audit.riskReasons.push(this.createFinding("Backup enabled", "MEDIUM", 15));
                }

                if (audit.exportedComponents.length > 10) {
                    audit.riskScore += 10;
                    audit.riskReasons.push(this.createFinding("Too many exported components", "MEDIUM", 10));
                }

                if (audit.usesAdTrackingPermissions) {
                    audit.riskScore += 5;
                    audit.riskReasons.push(this.createFinding("Ad tracking permissions present", "LOW", 5));
                }

                if (audit.criticalDangerousPermissions.length === 0) {
                    audit.safeFindings.push(this.createFinding("No critical dangerous permissions found", "SAFE"));
                }
                if (audit.unprotectedExportedComponents.length === 0) {
                    audit.safeFindings.push(this.createFinding("No unprotected app-exported components found", "SAFE"));
                }
                if (!audit.debuggable) {
                    audit.safeFindings.push(this.createFinding("Debuggable flag disabled", "SAFE"));
                }

                audit.riskLevel = this.classifyRisk(audit.riskScore);

                return audit;

            } catch (error) {
                return {
                    riskLevel: "N/A",
                    riskScore: 0,
                    source: "unavailable",
                    error: "Security analysis limited",
                    dangerousPermissions: [],
                    privacyPermissions: [],
                    exportedComponents: [],
                    riskyExportedComponents: [],
                    debuggable: false,
                    allowBackup: false,
                    usesCleartextTraffic: false
                };
            }
        }
    }

    /**
     * Helper to run shell commands as promises.
     */
    execPromise(command) {
        return new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }
                resolve(stdout);
            });
        });
    }
}

module.exports = new SecurityAnalyzer();
