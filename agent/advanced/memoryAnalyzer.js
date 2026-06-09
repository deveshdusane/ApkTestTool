// Tuning. A real leak raises the post-GC LOW-WATER MARK (floor) over time;
// transient allocations (asset loads, ad creatives) and SDK init spikes do not.
// So we compare floors, not raw values — and only after init has settled and
// the session has run long enough for a slow leak to actually show.
const INIT_GRACE_SAMPLES   = 12;   // ~36s at 3s cadence — skip Firebase/AppLovin/Adjust init ramp
const FLOOR_WINDOW         = 8;    // samples per low-water-mark window
const MIN_SAMPLES_FOR_LEAK = INIT_GRACE_SAMPLES + FLOOR_WINDOW * 2;  // need enough post-init data
const LEAK_FLOOR_RATIO     = 1.5;  // recent floor must exceed early post-init floor by 50%

class MemoryAnalyzer {
    constructor() {
        this.memoryHistory = [];
        this.startTime = 0;
        this.idleMemory = 0;
        this.peakMemory = 0;
    }

    analyze(currentMemory) {
        if (!currentMemory || currentMemory <= 0) return this.getResult();

        if (this.memoryHistory.length === 0) {
            this.startTime = Date.now();
        }

        this.memoryHistory.push({
            value: currentMemory,
            timestamp: Date.now()
        });

        if (this.memoryHistory.length > 200) this.memoryHistory.shift();

        // Track Peak
        if (currentMemory > this.peakMemory) {
            this.peakMemory = currentMemory;
        }

        // Idle baseline = the post-init low-water mark (min of the FLOOR_WINDOW
        // samples right after the init grace period), not an early raw reading.
        // This stops normal SDK-init growth from inflating the baseline downward.
        this.idleMemory = this.computeIdleFloor() || this.idleMemory || currentMemory;

        const leakSuspected = this.detectLeak();
        const issues = [];

        if (leakSuspected) {
            issues.push({
                type: "MEMORY_GROWTH_SUSPECTED",
                severity: "MEDIUM",
                message: "Suspected sustained memory growth: the post-GC low-water mark kept rising across the session. Heuristic only — confirm with a heap profiler before treating as a leak."
            });
        }

        // Persist so getResult() (used by realtimeMonitor for the report) surfaces it.
        this._leakSuspected = leakSuspected;
        this._issues = issues;

        return {
            ...this.getResult(),
            // `leakDetected` kept for backward-compat consumers, but it now means
            // "suspected" — a heuristic signal, not a confirmed leak.
            leakDetected: leakSuspected,
            leakSuspected,
            issues
        };
    }

    // Min of the first FLOOR_WINDOW samples after the init grace period.
    computeIdleFloor() {
        const vals = this.memoryHistory.map(h => h.value);
        const postInit = vals.slice(INIT_GRACE_SAMPLES);
        if (postInit.length < FLOOR_WINDOW) return 0;
        return Math.min(...postInit.slice(0, FLOOR_WINDOW));
    }

    detectLeak() {
        // Need enough post-init samples for a slow leak to show. Short sessions
        // (and the whole init ramp) are never flagged.
        if (this.memoryHistory.length < MIN_SAMPLES_FOR_LEAK) return false;

        const vals = this.memoryHistory.map(h => h.value);
        const postInit = vals.slice(INIT_GRACE_SAMPLES);

        // Compare low-water marks: early post-init floor vs most-recent floor.
        // A rising floor is the signature of a real leak; transient spikes and
        // GC sawtooth do not move the floor.
        const earlyFloor  = Math.min(...postInit.slice(0, FLOOR_WINDOW));
        const recentFloor = Math.min(...postInit.slice(-FLOOR_WINDOW));
        if (earlyFloor <= 0) return false;

        return recentFloor > earlyFloor * LEAK_FLOOR_RATIO;
    }

    getResult() {
        return {
            peakMemory: this.peakMemory,
            idleMemory: this.idleMemory,
            ratio: this.idleMemory > 0 ? parseFloat((this.peakMemory / this.idleMemory).toFixed(2)) : 0,
            // Surface the (conservative, heuristic) growth signal so it reaches
            // the report instead of being computed and dropped. Callers that
            // only read getResult() now see it too.
            leakSuspected: this._leakSuspected || false,
            issues: this._issues ? this._issues.slice() : []
        };
    }

    reset() {
        this.memoryHistory = [];
        this.peakMemory = 0;
        this.idleMemory = 0;
        this.startTime = 0;
        this._leakSuspected = false;
        this._issues = [];
    }
}

module.exports = new MemoryAnalyzer();
