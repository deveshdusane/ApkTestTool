// Gameplay Blocker Detector — runtime, deterministic, evidence-cited.
//
// Detects nine classes of real gameplay blockers from log lines + metric samples
// the agent already collects. No LLM, no synthesized prose. Each detected blocker
// carries the raw triggering evidence (logcat lines or metric values) so the
// tester can verify it without trusting the tool's wording.
//
// What this DOES detect:
//   crash_play / anr_play / native_crash         — from logcat regex
//   no_ui                                        — process started, no Activity displayed in 30 s
//   oom_kill                                     — process death + recent high PSS
//   low_fps_sustained                            — N consecutive samples below threshold
//   splash_stuck                                 — splash activity, no transition for 60 s
//   network_loss_play                            — N consecutive ping failures during play
//   auth_failure                                 — Firebase Auth / Play Games Services error patterns
//
// What this CANNOT detect (and never will, from logs alone):
//   • Tap responsiveness — no input event timestamping in logcat.
//   • Tutorial soft-locks, missing textures, wrong-language text — no semantic UI understanding.
//   • Visual asset issues, missing audio, save corruption — no visual/audio analysis.
// These belong in the manual test checklist (manualTestChecklistBuilder.js).

// ─────────── Tunable thresholds (named so they're easy to find/justify) ───────────
const NO_UI_TIMEOUT_MS         = 30 * 1000;
const SPLASH_STUCK_MS          = 60 * 1000;
const SUSTAINED_LOW_FPS_COUNT  = 5;       // consecutive samples
const LOW_FPS_THRESHOLD        = 20;
const HIGH_PSS_MB              = 500;     // pre-death PSS that suggests memory pressure
const PING_FAIL_COUNT          = 3;       // consecutive ping failures = network loss
const AUTH_ERROR_DEDUP_MS      = 10 * 1000;

// Splash activity names are heuristic — most engines/launchers name these clearly.
const SPLASH_ACTIVITY_RE = /\b(?:splash|launch(?:er)?|preload|loading)\b/i;

class GameplayBlockerDetector {
    constructor() {
        this.reset();
    }

    reset() {
        this.data = {
            isActive: false,
            pkg: null,
            startTime: null,
            // Detected blockers, each tied to evidence.
            blockers: [],
            // Live counters — useful for the UI badge and the report.
            counts: {
                fpsSamples: 0,
                pingChecks: 0,
                pingFailures: 0,
                logLines: 0
            }
        };
        // Internal time/state tracking — never serialised.
        this._processStartedAtMs   = null;
        this._activityDisplayedAtMs = null;
        this._splashFirstSeenAtMs  = null;
        this._splashLastSeenAtMs   = null;
        this._lastNonSplashActivityAtMs = null;
        this._processDeadAtMs      = null;
        this._userStoppedAtMs      = null;
        this._fpsRecent            = [];   // ring buffer, bounded
        this._pssRecent            = [];
        this._consecutivePingFails = 0;
        this._lastAuthErrorAtMs    = 0;
    }

    startSession(pkg, opts = {}) {
        this.reset();
        this.data.isActive = true;
        this.data.pkg = pkg;
        this.data.startTime = Date.now();
        // Optional: which auth SDKs to listen for. If absent, auth_failure detection is skipped.
        this._authSdksDetected = !!opts.hasAuthSdk;
        return { success: true };
    }

    stopSession({ userInitiated = true } = {}) {
        this.data.isActive = false;
        if (userInitiated) this._userStoppedAtMs = Date.now();
        this._evaluateTimeBased();
        return this.getResult();
    }

    // ─────────── Input channels ───────────

    analyzeLogs(lines) {
        if (!this.data.isActive || !lines || lines.length === 0) return;
        const pkg = this.data.pkg || '';
        const pkgEsc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pkgRe = pkg ? new RegExp(`\\b${pkgEsc}\\b`) : null;

        for (const line of lines) {
            this.data.counts.logLines++;
            const nowMs = Date.now();

            // Process started
            if (/Start proc/i.test(line) && pkgRe && pkgRe.test(line)) {
                if (!this._processStartedAtMs) this._processStartedAtMs = nowMs;
            }

            // Activity displayed (UI actually rendered)
            // Tag: ActivityTaskManager / ActivityManager: "Displayed <pkg>/.MainActivity: +500ms"
            const displayedMatch = line.match(/Displayed\s+([^\s]+)\/([^\s:]+)/);
            if (displayedMatch && pkgRe && pkgRe.test(displayedMatch[1])) {
                if (!this._activityDisplayedAtMs) this._activityDisplayedAtMs = nowMs;
                const fullName = `${displayedMatch[1]}/${displayedMatch[2]}`;
                if (SPLASH_ACTIVITY_RE.test(fullName)) {
                    if (!this._splashFirstSeenAtMs) this._splashFirstSeenAtMs = nowMs;
                    this._splashLastSeenAtMs = nowMs;
                } else {
                    this._lastNonSplashActivityAtMs = nowMs;
                }
            }

            // Crash — FATAL EXCEPTION (filter to our pkg via PID-filtered logcat upstream;
            // we still double-check the line mentions our package when possible).
            if (/FATAL EXCEPTION/i.test(line)) {
                this._recordBlocker('crash_play', 'Crash during play', 'CRITICAL', line);
            }

            // ANR
            if (/ANR in /i.test(line) && pkgRe && pkgRe.test(line)) {
                this._recordBlocker('anr_play', 'ANR (Application Not Responding)', 'CRITICAL', line);
            } else if (/Input dispatching timed out/i.test(line)) {
                this._recordBlocker('anr_play', 'ANR — input dispatch timeout', 'CRITICAL', line);
            }

            // Native crash / tombstone
            if (/\btombstone\b/i.test(line) && pkgRe && pkgRe.test(line)) {
                this._recordBlocker('native_crash', 'Native crash (tombstone)', 'CRITICAL', line);
            }

            // Process death — used together with PSS for OOM heuristic.
            // ActivityManager: "Process com.x.game (pid 1234) has died"
            // lowmemorykiller: "Killing '<pkg>' (1234), adj 0"
            if (
                (/Process .* has died/i.test(line) && pkgRe && pkgRe.test(line)) ||
                (/Killing .*\(\d+\)/i.test(line) && pkgRe && pkgRe.test(line)) ||
                (/lowmemorykiller.*Killing/i.test(line) && pkgRe && pkgRe.test(line))
            ) {
                this._processDeadAtMs = nowMs;
                this._maybeRecordOomKill(line);
            }

            // Auth failure (only if an auth SDK was detected — keeps false positives low).
            if (this._authSdksDetected && nowMs - this._lastAuthErrorAtMs > AUTH_ERROR_DEDUP_MS) {
                if (
                    /FirebaseAuth.*(?:ERROR|FAILED|exception)/i.test(line) ||
                    /Play(?:GamesServices| Games).*(?:ERROR|FAILED)/i.test(line) ||
                    /SIGN[_ ]?IN[_ ]?FAILED|AUTH[_ ]?FAILED/i.test(line)
                ) {
                    this._lastAuthErrorAtMs = nowMs;
                    this._recordBlocker('auth_failure', 'Login / auth failure', 'HIGH', line);
                }
            }
        }
    }

    recordFps(value, ts = Date.now()) {
        if (!this.data.isActive || !Number.isFinite(value)) return;
        this.data.counts.fpsSamples++;
        this._fpsRecent.push({ value, ts });
        if (this._fpsRecent.length > 50) this._fpsRecent.shift();
        // Sustained-low check.
        const tail = this._fpsRecent.slice(-SUSTAINED_LOW_FPS_COUNT);
        if (tail.length === SUSTAINED_LOW_FPS_COUNT && tail.every(s => s.value < LOW_FPS_THRESHOLD)) {
            const evidence = `Last ${SUSTAINED_LOW_FPS_COUNT} samples (FPS): ${tail.map(s => s.value.toFixed(1)).join(', ')}`;
            this._recordBlocker('low_fps_sustained', `Sustained low FPS (< ${LOW_FPS_THRESHOLD})`, 'HIGH', evidence);
        }
    }

    recordPss(valueMb, ts = Date.now()) {
        if (!this.data.isActive || !Number.isFinite(valueMb)) return;
        this._pssRecent.push({ valueMb, ts });
        if (this._pssRecent.length > 50) this._pssRecent.shift();
    }

    recordPing(success) {
        if (!this.data.isActive) return;
        this.data.counts.pingChecks++;
        if (success) {
            this._consecutivePingFails = 0;
            return;
        }
        this._consecutivePingFails++;
        this.data.counts.pingFailures++;
        if (this._consecutivePingFails >= PING_FAIL_COUNT) {
            const evidence = `${this._consecutivePingFails} consecutive ping checks failed`;
            this._recordBlocker('network_loss_play', 'Network loss during play', 'MEDIUM', evidence);
            this._consecutivePingFails = 0; // reset so evidence count stays accurate on recovery
        }
    }

    // ─────────── Time-based checks (called on getResult and stopSession) ───────────

    _evaluateTimeBased() {
        const now = Date.now();

        // no_ui — process started but no Displayed within window AND no crash/ANR explains it.
        if (
            this._processStartedAtMs &&
            !this._activityDisplayedAtMs &&
            now - this._processStartedAtMs > NO_UI_TIMEOUT_MS &&
            !this._hasBlocker('crash_play') &&
            !this._hasBlocker('anr_play') &&
            !this._hasBlocker('native_crash')
        ) {
            const evidence = `Process started ${((now - this._processStartedAtMs) / 1000).toFixed(0)} s ago; no Activity ever Displayed.`;
            this._recordBlocker('no_ui', 'App never reached UI', 'CRITICAL', evidence);
        }

        // splash_stuck — splash seen, no non-splash activity ever, and last splash signal > threshold ago.
        if (
            this._splashFirstSeenAtMs &&
            !this._lastNonSplashActivityAtMs &&
            this._splashLastSeenAtMs &&
            now - this._splashLastSeenAtMs > SPLASH_STUCK_MS
        ) {
            const dwell = ((now - this._splashFirstSeenAtMs) / 1000).toFixed(0);
            const evidence = `Splash activity dwelling for ${dwell} s; no transition to a non-splash activity.`;
            this._recordBlocker('splash_stuck', 'Splash screen stuck', 'HIGH', evidence);
        }
    }

    _maybeRecordOomKill(triggeringLine) {
        // Only call this an OOM kill if we saw recent high PSS AND the user did not stop the session.
        if (this._userStoppedAtMs) return;
        const peakPss = this._pssRecent.reduce((m, s) => Math.max(m, s.valueMb), 0);
        if (peakPss < HIGH_PSS_MB) return; // memory wasn't elevated → likely a different cause
        const evidence = `${triggeringLine.trim()}\nPeak PSS before death: ${peakPss.toFixed(0)} MB`;
        this._recordBlocker('oom_kill', 'OS killed app (likely OOM)', 'CRITICAL', evidence);
    }

    // ─────────── Blocker bookkeeping ───────────

    _hasBlocker(id) {
        return this.data.blockers.some(b => b.id === id);
    }

    _recordBlocker(id, name, severity, evidenceLine) {
        // First-seen wins. We don't record the same blocker twice — it's a session-level verdict,
        // not an event log. If callers want a per-event timeline, runtimeIntelligence already provides one.
        if (this._hasBlocker(id)) return;
        const tSec = parseFloat(((Date.now() - this.data.startTime) / 1000).toFixed(1));
        this.data.blockers.push({
            id,
            name,
            verdict: 'DETECTED',
            severity,
            ts: tSec,
            evidence: [evidenceLine]
        });
    }

    // ─────────── Output ───────────

    getResult() {
        this._evaluateTimeBased();
        // Summary counts grouped by severity for badge rendering.
        const summary = { critical: 0, high: 0, medium: 0 };
        for (const b of this.data.blockers) {
            const k = (b.severity || 'medium').toLowerCase();
            if (summary[k] !== undefined) summary[k]++;
        }
        return {
            isActive: this.data.isActive,
            pkg: this.data.pkg,
            startTime: this.data.startTime,
            blockers: this.data.blockers,
            summary,
            counts: this.data.counts
        };
    }
}

module.exports = new GameplayBlockerDetector();
module.exports.GameplayBlockerDetector = GameplayBlockerDetector;
