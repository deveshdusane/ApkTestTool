const adbHelper = require('../adb/adbHelper');
const config = require('../config/config');
const sdkIntelligence = require('./sdkIntelligence');
const networkDomainMonitor = require('../metrics/networkDomainMonitor');
const { EventEngine } = require('./eventEngine');

/**
 * Runtime Intelligence Layer
 * Detects engine, ads, and firebase usage by analyzing live logs and system state.
 */
class RuntimeIntelligence {
    constructor() {
        this.staticSdkIntelligence = sdkIntelligence.createEmptyIntelligence();
        this._eventEngine = new EventEngine();
        this.reset();
        this.lastBytes = 0;
    }

    reset() {
        this.data = {
            engine: "Native",
            ads: {
                status: 'Not Detected',
                usage: 'Idle',
                count: 0,
                type: 'Unknown',
                firstEventTime: null,
                delay: 'NORMAL', // FAST | NORMAL | SLOW
                health: 'NOT_DETECTED',
                adTypes: []
            },
            firebase: {
                status: 'Not Detected',
                usage: 'Idle',
                count: 0,
                firstEventTime: null,
                health: 'NOT_DETECTED'
            },
            warnings: [],
            insights: [],
            recommendations: [],
            staticAds: false,
            staticFirebase: false,
            grantedPermissions: [],
            networkCalls: 0,
            networkIntel: {
                ping: 0,
                dataUsedMB: 0,
                disconnects: 0,
                status: 'ONLINE'
            },
            checklist: {
                splash_screen: false,
                game_start: false,
                firebase_init: false,
                ads_sdk: false,
                appsflyer: false,
                build_64bit: false,
                build_release: false,
                safe_permissions: false
            },
            events: [{ name: 'app_started', category: 'SYSTEM', detail: 'Session started', time: 0 }],
            sdkIntelligence: sdkIntelligence.cloneStatic(this.staticSdkIntelligence),
            hasRuntimeData: false
        };
        this.lastAdsLog = 0;
        this.lastFirebaseLog = 0;
        this.firebaseSignalCount = 0;
        this._adsActivityVisible = false;
        this.activePids = new Set();
        this.sessionStartTime = Date.now();
        this._lastEventTimes = new Map([['app_started', 0]]);
        this._lastNetworkScan = 0;
        if (this._eventEngine) this._eventEngine.reset();
        try { networkDomainMonitor.reset(); } catch (e) { }
    }

    setStaticSDKs(sdks) {
        if (sdks) {
            const staticInput = sdks.sdkIntelligence ? sdks : { sdkIntelligence: null, sdkInfo: sdks };
            if (staticInput.sdkIntelligence) {
                this.staticSdkIntelligence = sdkIntelligence.cloneStatic(staticInput.sdkIntelligence);
            } else {
                this.staticSdkIntelligence = sdkIntelligence.createEmptyIntelligence();
            }

            this.data.sdkIntelligence = sdkIntelligence.cloneStatic(this.staticSdkIntelligence);
            const detected = this.data.sdkIntelligence.sdks || {};
            const sdkInfo = staticInput.sdkInfo || staticInput;
            this.data.staticAds = !!sdkInfo.ads || Object.values(detected).some(sdk => sdk.category === 'ADS' && sdk.detected);
            this.data.staticFirebase = !!sdkInfo.firebase || !!detected.firebase?.detected || !!detected.firebase_analytics?.detected;
            const firstAd = Object.values(detected).find(sdk => sdk.category === 'ADS' && sdk.detected);
            if (firstAd) {
                this.data.ads.status = 'Detected';
                this.data.ads.type = firstAd.name;
            }
            if (this.data.staticFirebase) this.data.firebase.status = 'Detected';
        }
    }

    /**
     * Processes log lines to find signatures of engines and SDKs.
     * @param {string[]} lines 
     */
    analyzeLogs(lines, packageName = null) {
        if (!lines || lines.length === 0) return;

        this.data.hasRuntimeData = true;

        for (const line of lines) {
            // Extract PID from standard Android threadtime log format (e.g. "04-24 10:15:30.123 10450 10500 V")
            const pidMatch = line.match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+(\d+)\s+/);
            const pid = pidMatch ? pidMatch[1] : null;

            // Log belongs to app if: no package specified, line includes package name, OR the log's PID matches the app's PID
            const belongsToApp = packageName ? (line.includes(packageName) || (pid && this.activePids && this.activePids.has(pid))) : true;
            const lowLine = line.toLowerCase();
            const eventTime = parseFloat(((Date.now() - this.sessionStartTime) / 1000).toFixed(1));

            // 1. Engine Detection (Log Fallback)
            if (belongsToApp && (line.includes('UnityEngine') || line.includes('libunity') || line.includes('UnityPlayer'))) {
                this.data.engine = "Unity";
            }

            // 2. Ads Intelligence — only fire if the line belongs to the app OR the APK scan
            //    already confirmed an ad SDK is present (guarding against GMS logs for other apps)
            const adSignals = ['AdRequest', 'AdLoaded', 'AdImpression', 'onAdLoaded', 'onAdShown', 'AdMob', 'UnityAds', 'AudienceNetwork', 'MAX Ad', 'AppLovin', 'IronSource'];
            const isGmsAdLine = line.includes('com.google.android.gms.ads') || line.includes('com.google.android.gms/ads');
            if (adSignals.some(sig => line.includes(sig)) && (belongsToApp || (isGmsAdLine && this.data.staticAds))) {
                this.data.ads.status = 'Detected';
                this.data.ads.usage = 'Active';
                this.data.ads.count++;
                this.lastAdsLog = Date.now();

                if (!this.data.ads.firstEventTime) {
                    this.data.ads.firstEventTime = eventTime;
                }

                if (line.includes('com.google.android.gms.ads')) this.data.ads.type = 'AdMob';
                else if (line.includes('unityads')) this.data.ads.type = 'UnityAds';
                else if (line.includes('AudienceNetwork')) this.data.ads.type = 'MetaAds';

                if (line.includes('Banner')) this.addAdType('Banner');
                if (line.includes('Interstitial')) this.addAdType('Interstitial');
                if (line.includes('Rewarded')) this.addAdType('Rewarded');

                // Ads ID extraction
                const adsIdMatch = line.match(/ca-app-pub-[a-zA-Z0-9/~-]+/);
                if (adsIdMatch && !this.data.ads.id) {
                    this.data.ads.id = adsIdMatch[0];
                }
            }

            // 3. Firebase Intelligence
            const firebaseTags = ['FirebaseApp', 'FA', 'FA-SVC', 'FirebaseAnalytics', 'FA-Event'];
            const firebaseEvents = ['Logging event', 'Event recorded', 'App measurement initialized'];
            const falseSources = ['GooglePlayServices', 'GmsCore', 'SystemServer', 'AdsService', 'NetworkScheduler'];

            const hasFirebaseTag = firebaseTags.some(tag => line.includes(` ${tag} `) || line.includes(`${tag}:`) || line.includes(`/${tag}`));
            const hasFirebaseEvent = firebaseEvents.some(event => line.includes(event));
            const isFalseSource = falseSources.some(source => line.includes(source));

            if (belongsToApp && (hasFirebaseTag || hasFirebaseEvent) && !isFalseSource) {
                this.firebaseSignalCount++;
                if (this.firebaseSignalCount >= 2) {
                    this.data.firebase.status = 'Detected';
                    this.data.firebase.usage = 'Active';
                    this.lastFirebaseLog = Date.now();

                    if (!this.data.firebase.firstEventTime) {
                        this.data.firebase.firstEventTime = eventTime;
                    }
                }
                if (this.data.firebase.status === 'Detected') {
                    this.data.firebase.count++;
                }
            }

            // 4. Network Detection
            if (belongsToApp && (lowLine.includes('googleads') || lowLine.includes('firebase') || lowLine.includes('http') || lowLine.includes('adservice.google.com') || lowLine.includes('doubleclick.net'))) {
                this.data.networkCalls++;
                if (lowLine.includes('googleads') || lowLine.includes('adservice')) {
                    this.data.ads.count++;
                }
            }

            if (this.data.sdkIntelligence) {
                const sdkMatches = sdkIntelligence.matchRuntimeLine(line);
                for (const sdkId of sdkMatches) {
                    // Allow GMS ad lines only when the APK scan already confirmed the ad SDK
                    // is in this app — prevents counting another app's GMS ad traffic as ours
                    const sdkDef = sdkIntelligence.SDK_DEFINITIONS.find(d => d.id === sdkId);
                    const isAdSdk = sdkDef?.category === 'ADS';
                    const gmsAdBypass = isAdSdk && this.data.staticAds &&
                        (line.includes('com.google.android.gms.ads') || line.includes('com.google.android.gms/ads'));
                    if (belongsToApp || gmsAdBypass) {
                        sdkIntelligence.markRuntime(this.data.sdkIntelligence, sdkId, {
                            time: eventTime,
                            source: 'logcat',
                            message: line.slice(0, 240)
                        });
                    }
                }

                // Only extract keys from lines confirmed to belong to this app
                if (belongsToApp) {
                    const adUnitMatch = line.match(/ca-app-pub-\d{16}[~/]\d{10}/);
                    if (adUnitMatch) {
                        const admob = this.data.sdkIntelligence.sdks.admob;
                        if (admob && !admob.runtime.adUnitIds.includes(adUnitMatch[0])) {
                            admob.runtime.adUnitIds.push(adUnitMatch[0]);
                        }
                    }

                    // Logcat key capture: SDKs often print their App ID / API key during initialization
                    sdkIntelligence.scanTextForKeys(this.data.sdkIntelligence, line, 'logcat');
                }

                const adTypeMap = [
                    ['Banner', /banner/i],
                    ['Interstitial', /interstitial/i],
                    ['Rewarded', /rewarded/i]
                ];
                const activeAds = Object.values(this.data.sdkIntelligence.sdks).filter(sdk => sdk.category === 'ADS' && sdk.active);
                for (const sdk of activeAds) {
                    for (const [label, pattern] of adTypeMap) {
                        if (pattern.test(line) && !sdk.runtime.adTypes.includes(label)) sdk.runtime.adTypes.push(label);
                    }
                }
            }

            // 5. QA Checklist Validation Engine & Event Extraction
            if (belongsToApp) {
                // Game Start Detection
                if (!this.data.checklist.game_start &&
                    (line.includes('GameStart') || lowLine.includes('game_start') || lowLine.includes('session_start') ||
                        line.includes('Application started') || line.includes('UnityMain') || line.includes('Initialized engine') ||
                        lowLine.includes('level_start') || line.includes('start_session'))) {
                    this.data.checklist.game_start = true;
                }

                // Firebase Init Detection
                if (!this.data.checklist.firebase_init &&
                    (line.includes('FirebaseApp initialized') || line.includes('App measurement initialized') || line.includes('FA initialized'))) {
                    this.data.checklist.firebase_init = true;
                }

                // AppsFlyer Detection
                if (!this.data.checklist.appsflyer &&
                    (line.includes('AppsFlyerLib') || lowLine.includes('af_event') || lowLine.includes('af_start'))) {
                    this.data.checklist.appsflyer = true;
                }

                // Splash Screen Detection (Log based)
                if (!this.data.checklist.splash_screen &&
                    (lowLine.includes('splash') || lowLine.includes('loading') || line.includes('LoadingScreen') || lowLine.includes('scene \'splash\''))) {
                    this.data.checklist.splash_screen = true;
                }

                // Event Extraction & Timeline Builder (category-aware)
                let tlName = null;
                let tlCategory = null;
                let tlDetail = '';

                // SYSTEM: Activity displayed (from ActivityManager — line contains pkg name)
                if (!tlName && (line.includes('ActivityManager:') || line.includes('ActivityTaskManager:')) && line.includes('Displayed') && packageName && line.includes(packageName)) {
                    const actMatch = line.match(/Displayed\s+[\w.]+\/([\w.]+)/);
                    const actShort = actMatch ? actMatch[1].split('.').pop() : 'Activity';
                    tlName = 'activity_displayed';
                    tlCategory = 'SYSTEM';
                    tlDetail = actShort;
                }

                // SYSTEM: App process start
                if (!tlName && line.includes('Start proc') && packageName && line.includes(packageName)) {
                    tlName = 'app_started';
                    tlCategory = 'SYSTEM';
                    tlDetail = 'Process launched';
                }

                // SYSTEM: Game lifecycle
                if (!tlName && (line.includes('GameStart') || lowLine.includes('game_start') || line.includes('start_session'))) {
                    tlName = 'game_start';
                    tlCategory = 'SYSTEM';
                    tlDetail = 'Game session began';
                } else if (!tlName && (lowLine.includes('level_start') || lowLine.includes('scene_start'))) {
                    const lvlMatch = line.match(/level[_ ]?(\d+)/i) || line.match(/stage[_ ]?(\d+)/i);
                    tlName = 'level_start';
                    tlCategory = 'SYSTEM';
                    tlDetail = lvlMatch ? `Level ${lvlMatch[1]}` : 'Level started';
                } else if (!tlName && (lowLine.includes('level_end') || lowLine.includes('level_complete') || lowLine.includes('level_fail'))) {
                    tlName = 'level_end';
                    tlCategory = 'SYSTEM';
                    tlDetail = lowLine.includes('fail') ? 'Level failed' : 'Level complete';
                }

                // FIREBASE: named events
                if (!tlName && (line.includes('Logging event') || line.includes('Event recorded') || line.includes('FA-Event'))) {
                    const nameMatch = line.match(/name=([a-zA-Z_][a-zA-Z0-9_]{1,49})/);
                    const bracketMatch = line.match(/\(([a-zA-Z_][a-zA-Z0-9_]{1,49})\)/);
                    const parsed = (nameMatch && nameMatch[1]) || (bracketMatch && bracketMatch[1]) || null;
                    tlName = parsed || 'firebase_event';
                    tlCategory = 'FIREBASE';
                    tlDetail = parsed || 'event logged';
                } else if (!tlName && (line.includes('App measurement initialized') || line.includes('FA initialized') || line.includes('FirebaseApp initialized'))) {
                    tlName = 'firebase_init';
                    tlCategory = 'FIREBASE';
                    tlDetail = 'Analytics ready';
                } else if (!tlName && lowLine.includes('session_start')) {
                    tlName = 'session_start';
                    tlCategory = 'FIREBASE';
                    tlDetail = 'Session started';
                } else if (!tlName && (lowLine.includes('screen_view') || lowLine.includes('screen view'))) {
                    const screenMatch = line.match(/screen_name[=: ]+([a-zA-Z0-9_]+)/i) || line.match(/firebase_screen[=: ]+([a-zA-Z0-9_]+)/i);
                    tlName = 'screen_view';
                    tlCategory = 'FIREBASE';
                    tlDetail = screenMatch ? screenMatch[1] : 'screen viewed';
                }

                // ADS: specific events
                if (!tlName && (line.includes('AdRequest') || lowLine.includes('ad_request'))) {
                    const adType = line.includes('Interstitial') ? 'Interstitial' : line.includes('Banner') ? 'Banner' : line.includes('Rewarded') ? 'Rewarded' : 'Ad';
                    tlName = 'ad_request';
                    tlCategory = 'ADS';
                    tlDetail = `${adType} requested`;
                } else if (!tlName && (line.includes('AdLoaded') || line.includes('onAdLoaded'))) {
                    const adType = line.includes('Interstitial') ? 'Interstitial' : line.includes('Banner') ? 'Banner' : line.includes('Rewarded') ? 'Rewarded' : 'Ad';
                    tlName = 'ad_loaded';
                    tlCategory = 'ADS';
                    tlDetail = `${adType} loaded`;
                } else if (!tlName && (line.includes('AdImpression') || lowLine.includes('ad_impression') || line.includes('onAdShown'))) {
                    const adType = line.includes('Interstitial') ? 'Interstitial' : line.includes('Banner') ? 'Banner' : line.includes('Rewarded') ? 'Rewarded' : 'Ad';
                    tlName = 'ad_impression';
                    tlCategory = 'ADS';
                    tlDetail = `${adType} shown`;
                }

                if (tlName && tlCategory) {
                    // O(1) dedup: same event name not seen within last 2 seconds
                    const lastTime = this._lastEventTimes.get(tlName);
                    if (lastTime === undefined || (eventTime - lastTime) > 2.0) {
                        this._lastEventTimes.set(tlName, eventTime);
                        this.data.events.push({ name: tlName, category: tlCategory, detail: tlDetail, time: eventTime });
                        if (this.data.events.length > 300) this.data.events.shift();
                    }
                }

                // EventEngine: detect business events (GA, Facebook, IAP, AppsFlyer, Adjust, Lifecycle)
                const engineEvent = this._eventEngine.parseLine(line, packageName, this.activePids);
                if (engineEvent) {
                    this.data.events.push(engineEvent);
                    if (this.data.events.length > 300) this.data.events.shift();
                }
            }
        }
    }

    async updateAppPid(deviceId, packageName) {
        if (!deviceId || !packageName) return;
        try {
            const out = await adbHelper.runADB(['-s', deviceId, 'shell', 'pidof', packageName]);
            if (out && out.trim()) {
                const pids = out.trim().split(/\s+/);
                if (!this.activePids) this.activePids = new Set();
                pids.forEach(p => this.activePids.add(p));
            }
        } catch (e) { }
    }

    addAdType(type) {
        if (!this.data.ads.adTypes.includes(type)) {
            this.data.ads.adTypes.push(type);
        }
    }

    evaluateHealth() {
        const sessionDuration = (Date.now() - this.sessionStartTime) / 1000;

        // Ads Health (Hybrid Classification)
        if (!this.data.staticAds && this.data.ads.count === 0 && this.data.ads.status !== 'Detected') {
            this.data.ads.health = 'NOT_DETECTED';
        } else if (sessionDuration < 15 && this.data.ads.count === 0) {
            this.data.ads.health = 'INITIALIZING';
        } else if (this.data.staticAds && this.data.ads.count === 0) {
            this.data.ads.health = 'INSTALLED_NOT_ACTIVE';
        } else if (this.data.ads.count >= 1) {
            this.data.ads.health = 'ACTIVE';
        } else {
            this.data.ads.health = this.data.ads.count > 0 ? 'ACTIVE' : 'NOT_DETECTED';
        }

        // Delay Analysis (Only if active)
        if (this.data.ads.firstEventTime) {
            if (this.data.ads.firstEventTime < 5) this.data.ads.delay = 'FAST';
            else if (this.data.ads.firstEventTime <= 15) this.data.ads.delay = 'NORMAL';
            else this.data.ads.delay = 'SLOW';
        }

        // Firebase Health (Hybrid Classification)
        if (!this.data.staticFirebase && this.data.firebase.count === 0 && this.data.firebase.status !== 'Detected') {
            this.data.firebase.health = 'NOT_DETECTED';
        } else if (this.data.staticFirebase && this.data.firebase.count === 0) {
            this.data.firebase.health = 'INSTALLED_NOT_ACTIVE';
        } else if (this.data.firebase.count > 0 && this.data.firebase.count < 3) {
            this.data.firebase.health = 'LOW_ACTIVITY';
        } else if (this.data.firebase.count >= 3) {
            this.data.firebase.health = 'HEALTHY';
        } else {
            // Fallback for log-only detection
            this.data.firebase.health = this.data.firebase.count > 0 ? 'HEALTHY' : 'NOT_DETECTED';
        }
    }

    generateInsights() {
        const insightsSet = new Set();
        const recommendationsSet = new Set();
        const isOffline = this.data.networkIntel.status === 'OFFLINE';

        // Step 4 & 6: Logic for NOT_DETECTED
        if (this.data.ads.status !== 'Detected' && this.data.firebase.status !== 'Detected') {
            this.data.insights = ["ℹ No Ads or Analytics SDK found in this build"];
            this.data.warnings = [];
            this.data.recommendations = [
                "Consider integrating Ads SDK for monetization",
                "Consider integrating Firebase for analytics tracking"
            ];
            return;
        }

        // Helper to add standardized insights
        const addInsight = (msg) => insightsSet.add(msg);
        const addRec = (msg) => recommendationsSet.add(msg);

        // Ads Insights & Warnings
        if (this.data.ads.status === 'Detected' || this.data.staticAds) {
            if (this.data.ads.health === 'INSTALLED_NOT_ACTIVE') {
                addInsight("⚠ Ads SDK detected but no ads triggered yet");
            } else if (this.data.ads.health === 'ACTIVE') {
                addInsight("✔ Ads are actively rendering in session");
            }

            const delay = this.data.ads.firstEventTime || 0;
            if (delay > 15) {
                addInsight(`⚠ Ads initialization delayed (${delay}s)`);
                addRec("Preload ads earlier during app startup");
            }
        }

        // Firebase Insights
        if (this.data.firebase.status === 'Detected' || this.data.staticFirebase) {
            if (this.data.staticFirebase && this.data.firebase.count === 0) {
                addInsight("⚠ Firebase installed but no events triggered");
            }

            if (this.data.firebase.health === 'HEALTHY') {
                addInsight(`✔ Firebase actively logging events (${this.data.firebase.count})`);
            } else if (this.data.firebase.count > 0) {
                addInsight("⚠ Firebase integrated but not actively logging events");
            }
        }

        // Final sorting and categorization
        const allInsights = Array.from(insightsSet);
        const warnings = allInsights.filter(i =>
            i.includes('⚠') || i.toLowerCase().includes('delayed') ||
            i.toLowerCase().includes('low') || i.toLowerCase().includes('not triggered')
        );
        const success = allInsights.filter(i => !warnings.includes(i));

        // Priority order: Warnings then Success
        this.data.insights = [...warnings, ...success];

        if (this.data.insights.length === 0) {
            this.data.insights = ["✔ No major SDK issues detected"];
        }

        this.data.recommendations = Array.from(recommendationsSet);
    }

    /**
     * Hybrid Detection: Scans APK binary for SDK signatures.
     * @param {string} packageName 
     * @param {string} deviceId 
     */
    async runBinaryScan(packageName, deviceId) {
        if (!packageName || !deviceId) return;

        try {
            const pathOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'pm', 'path', packageName]);
            if (!pathOut || !pathOut.includes('package:')) return;
            const apkPath = pathOut.replace('package:', '').trim();

            const unitySignatures = ['libunity.so', 'libil2cpp.so', 'assets/bin/Data/'];
            const nativeSignatures = ['libmain.so', 'libgame.so'];

            const adsSignatures = [
                'com/google/android/gms/ads',
                'com/unity3d/ads',
                'com/applovin',
                'com/ironsource',
                'com/chartboost'
            ];

            const firebaseSignatures = [
                'com/google/firebase/analytics',
                'com/google/firebase/messaging',
                'com/google/firebase/crashlytics'
            ];

            let listOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'unzip', '-l', apkPath]);

            if (!listOut || listOut.includes('not found') || listOut.includes('No such file')) {
                console.warn('[RuntimeIntelligence] unzip not available on device. Falling back to log analysis.');
                this.data.insights.push('⚠ APK binary scan skipped (unzip unavailable on device), using runtime fallback');
                return;
            }

            if (listOut) {
                // Engine Detection (Primary)
                if (unitySignatures.some(sig => listOut.includes(sig))) {
                    this.data.engine = "Unity";
                } else if (nativeSignatures.some(sig => listOut.includes(sig))) {
                    this.data.engine = "Native";
                } else {
                    this.data.engine = "Unknown";
                }

                this.data.staticAds = adsSignatures.some(sig => listOut.includes(sig));
                this.data.staticFirebase = firebaseSignatures.some(sig => listOut.includes(sig));

                // 64-bit architecture compliance
                this.data.checklist.build_64bit = listOut.includes('lib/arm64-v8a/');

                if (this.data.staticAds) this.data.ads.status = 'Detected';
                if (this.data.staticFirebase) this.data.firebase.status = 'Detected';
            }

            // Dumpsys Package Analysis (For Debug & Permissions)
            const dumpOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'dumpsys', 'package', packageName]);
            if (dumpOut) {
                // Verify Release Build (No DEBUGGABLE flag)
                this.data.checklist.build_release = !dumpOut.includes('DEBUGGABLE');

                // Verify Safe Permissions
                const dangerousPerms = [
                    'android.permission.READ_CONTACTS',
                    'android.permission.ACCESS_FINE_LOCATION',
                    'android.permission.READ_SMS',
                    'android.permission.CAMERA',
                    'android.permission.RECORD_AUDIO',
                    'android.permission.CALL_PHONE'
                ];
                const hasDangerous = dangerousPerms.some(perm => dumpOut.includes(`${perm}: granted=true`));
                this.data.checklist.safe_permissions = !hasDangerous;
            }

        } catch (err) {
            console.error('[RuntimeIntelligence] Binary scan failed:', err.message);
        }
    }

    /**
     * One-shot heap memory scan for SDK keys.
     * Only works on debuggable builds (debug APK or QA build).
     */
    async runMemoryScan(deviceId, packageName) {
        if (!deviceId || !packageName || !this.data.sdkIntelligence) return;
        // Get PID if not yet known
        await this.updateAppPid(deviceId, packageName);
        const pid = this.activePids ? [...this.activePids][0] : null;
        if (!pid) return;

        const memoryScanner = require('./memoryScanner');
        const result = await memoryScanner.scanMemory(deviceId, packageName, pid, this.data.sdkIntelligence);

        if (result === -1) {
            console.log('[MemoryScan] App is not debuggable — memory scan skipped');
            this.data.sdkIntelligence.memoryScanStatus = 'not_debuggable';
        } else if (result > 0) {
            console.log(`[MemoryScan] Found ${result} new key(s) from heap memory`);
            sdkIntelligence.finalize(this.data.sdkIntelligence);
            this.data.sdkIntelligence.memoryScanStatus = 'done';
        } else {
            this.data.sdkIntelligence.memoryScanStatus = 'done';
        }
    }

    async updateAdsActivation(deviceId) {
        if (!deviceId) return;
        try {
            const topActivity = await adbHelper.runADB(['-s', deviceId, 'shell', 'dumpsys', 'activity', 'top']);

            // Map visible activity patterns → specific SDK ID to call markRuntime
            const adSdkMap = [
                { sdkId: 'admob', patterns: ['com.google.android.gms.ads', 'InterstitialAdActivity', 'RewardedAdActivity', 'AdActivity'] },
                { sdkId: 'unity_ads', patterns: ['com.unity3d.services.ads', 'com.unity3d.ads'] },
                { sdkId: 'applovin', patterns: ['com.applovin'] },
            ];
            const adActivityPatterns = adSdkMap.flatMap(e => e.patterns).concat(['com.ironsource.mediationsdk']);
            const adVisible = adActivityPatterns.some(p => topActivity.includes(p));

            if (adVisible) {
                const eventTime = parseFloat(((Date.now() - this.sessionStartTime) / 1000).toFixed(1));
                this.lastAdsLog = Date.now();
                this.data.ads.status = 'Detected';
                this.data.ads.usage = 'Active';

                if (!this._adsActivityVisible) {
                    this.data.ads.count++;
                    this._adsActivityVisible = true;
                    if (!this.data.ads.firstEventTime) this.data.ads.firstEventTime = eventTime;

                    // Mark the exact SDK whose activity is confirmed on screen
                    if (this.data.sdkIntelligence) {
                        for (const entry of adSdkMap) {
                            if (entry.patterns.some(p => topActivity.includes(p))) {
                                sdkIntelligence.markRuntime(this.data.sdkIntelligence, entry.sdkId, {
                                    time: eventTime,
                                    source: 'dumpsys',
                                    message: 'Ad activity confirmed visible on screen'
                                });
                            }
                        }
                    }
                }
            } else {
                this._adsActivityVisible = false;
            }
        } catch (e) { }
    }

    async updateNetworkDetection(deviceId, packageName) {
        if (!deviceId || !packageName) return;
        const now = Date.now();
        if (now - this._lastNetworkScan < 10000) return; // run every 10s
        this._lastNetworkScan = now;

        try {
            const detections = await networkDomainMonitor.scan(deviceId, packageName);
            for (const det of detections) {
                const eventTime = parseFloat(((Date.now() - this.sessionStartTime) / 1000).toFixed(1));

                // Mark the SDK runtime-active (network connection = SDK is running)
                if (this.data.sdkIntelligence) {
                    sdkIntelligence.markRuntime(this.data.sdkIntelligence, det.sdkId, {
                        time: eventTime,
                        source: 'network',
                        message: `Connected to ${det.hostname}`
                    });
                }

                // Push one timeline event per SDK per session (isNew guard)
                if (det.isNew) {
                    const key = `net_${det.sdkId}`;
                    const lastTime = this._lastEventTimes.get(key);
                    if (lastTime === undefined || (eventTime - lastTime) > 30.0) {
                        this._lastEventTimes.set(key, eventTime);
                        const shortHost = det.hostname
                            ? det.hostname.split('.').slice(-2).join('.')
                            : 'server';
                        this.data.events.push({
                            name: `${det.sdkId} connected`,
                            category: det.tlCategory,
                            detail: shortHost,
                            time: eventTime
                        });
                        if (this.data.events.length > 200) this.data.events.shift();
                    }
                }
            }
        } catch (e) { }
    }

    /**
     * Fetches granted permissions from the system.
     * @param {string} packageName
     * @param {string} deviceId
     */
    async updateRuntimePermissions(packageName, deviceId) {
        if (!packageName || !deviceId) return;

        try {
            const output = await adbHelper.runADB(['-s', deviceId, 'shell', 'dumpsys', 'package', packageName]);
            const permissions = [];

            // Install permissions (static grants at install time)
            const installIdx = output.indexOf('install permissions:');
            if (installIdx !== -1) {
                for (const line of output.substring(installIdx).split('\n')) {
                    if (line.includes('runtime permissions:')) break;
                    if (line.includes('granted=true')) {
                        const match = line.match(/android\.permission\.[A-Z_]+/);
                        if (match) permissions.push(match[0]);
                    }
                }
            }

            // Runtime permissions (user-granted dangerous permissions — CAMERA, LOCATION, etc.)
            const runtimeIdx = output.indexOf('runtime permissions:');
            if (runtimeIdx !== -1) {
                for (const line of output.substring(runtimeIdx).split('\n').slice(1)) {
                    // Runtime section ends when a line is no longer a permission entry
                    if (!line.match(/\s+android\.permission\./)) break;
                    if (line.includes('granted=true')) {
                        const match = line.match(/android\.permission\.[A-Z_]+/);
                        if (match) permissions.push(match[0]);
                    }
                }
            }

            this.data.grantedPermissions = [...new Set(permissions)];
        } catch (err) {
            console.error('[RuntimeIntelligence] Permission check failed:', err.message);
        }
    }

    /**
     * Real-time network awareness using system traffic stats.
     * Filters by app UID; falls back to /proc/uid_stat on Android 10+.
     * @param {string} deviceId
     * @param {string} [packageName]
     */
    async updateNetworkAwareness(deviceId, packageName) {
        if (!deviceId) return;

        try {
            // Resolve app UID once (networkDomainMonitor caches it)
            let appUid = null;
            if (packageName) {
                try { appUid = await networkDomainMonitor.getAppUid(deviceId, packageName); } catch (e) { }
            }

            let total = 0;
            let gotTraffic = false;

            // Primary: xt_qtaguid (Android < 10) — filter by app UID
            try {
                const stdout = await adbHelper.runADB(['-s', deviceId, 'shell', 'cat', '/proc/net/xt_qtaguid/stats']);
                if (stdout && stdout.trim().length > 10) {
                    for (const line of stdout.split('\n')) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length < 8) continue;
                        if (appUid) {
                            // uid_tag_int = (tag << 32) | uid — extract lower 32 bits
                            const raw = parts[3];
                            const entryUid = raw.length <= 10
                                ? parseInt(raw)
                                : Number(BigInt(raw) & BigInt(0xFFFFFFFF));
                            if (entryUid !== parseInt(appUid)) continue;
                        }
                        total += (parseInt(parts[5]) || 0) + (parseInt(parts[7]) || 0);
                    }
                    if (total > 0) gotTraffic = true;
                }
            } catch (e) { }

            // Fallback: /proc/uid_stat/<uid>/ (Android 10+ eBPF)
            if (!gotTraffic && appUid) {
                try {
                    const rcvOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'cat', `/proc/uid_stat/${appUid}/tcp_rcv`]);
                    const sndOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'cat', `/proc/uid_stat/${appUid}/tcp_snd`]);
                    const rcv = parseInt(rcvOut) || 0;
                    const snd = parseInt(sndOut) || 0;
                    total = rcv + snd;
                    if (total > 0) gotTraffic = true;
                } catch (e) { }
            }

            if (gotTraffic && total > 0) {
                if (this.lastBytes > 0) {
                    const delta = total - this.lastBytes;
                    if (delta > 0) {
                        this.data.networkCalls += 1;
                        this.data.networkIntel.dataUsedMB = parseFloat((this.data.networkIntel.dataUsedMB + (delta / (1024 * 1024))).toFixed(2));
                        this.data.hasRuntimeData = true;
                    }
                }
                this.lastBytes = total;
            }

            // Ping check
            const pingOut = await adbHelper.runADB(['-s', deviceId, 'shell', 'ping', '-c', '1', '8.8.8.8'], { timeout: 2000 });
            if (!pingOut || pingOut.includes('100% packet loss') || pingOut.includes('unreachable')) {
                this.data.networkIntel.disconnects++;
                this.data.networkIntel.status = 'OFFLINE';
                this.data.networkIntel.ping = 0;
            } else {
                const match = pingOut.match(/time=([\d.]+)\s*ms/);
                if (match) {
                    this.data.networkIntel.ping = Math.round(parseFloat(match[1]));
                    this.data.networkIntel.status = 'ONLINE';
                }
            }
        } catch (err) { }
    }

    getResult() {
        const now = Date.now();
        // 15 sec window for Active status
        if (now - this.lastAdsLog > 15000) this.data.ads.usage = 'Idle';
        if (now - this.lastFirebaseLog > 15000) this.data.firebase.usage = 'Idle';

        this.evaluateHealth();
        this.data.sdkIntelligence = sdkIntelligence.finalize(this.data.sdkIntelligence || sdkIntelligence.createEmptyIntelligence());
        this.generateInsights();

        // Finalize Ads SDK checklist
        this.data.checklist.ads_sdk = this.data.ads.status === 'Detected';

        return {
            ...this.data,
            // Maintain old flags for backward compatibility if needed
            adsDetected: this.data.ads.status === 'Detected',
            firebaseDetected: this.data.firebase.status === 'Detected'
        };
    }
}

module.exports = new RuntimeIntelligence();
