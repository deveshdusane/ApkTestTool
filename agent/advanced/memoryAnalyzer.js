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
        
        if (this.memoryHistory.length > 60) this.memoryHistory.shift();

        // Track Peak
        if (currentMemory > this.peakMemory) {
            this.peakMemory = currentMemory;
        }

        // Track Idle (first 5-6 seconds)
        // If we are within the first 6 seconds, update idle memory
        if (Date.now() - this.startTime <= 6000) {
            this.idleMemory = currentMemory;
        }

        const leakDetected = this.detectLeak();
        const issues = [];
        
        if (leakDetected) {
            issues.push({ 
                type: "MEMORY_LEAK", 
                severity: "HIGH", 
                message: "Possible memory leak detected: continuous memory growth observed." 
            });
        }

        return {
            ...this.getResult(),
            leakDetected,
            issues
        };
    }

    detectLeak() {
        if (this.memoryHistory.length < 10) return false;
        
        // Check for continuous growth in the last 6 samples (approx 12-18 seconds)
        const recent = this.memoryHistory.slice(-6).map(h => h.value);
        let growing = true;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] <= recent[i-1]) {
                growing = false;
                break;
            }
        }

        // Overall trend check: compare current to average of first few
        const firstFew = this.memoryHistory.slice(0, 5).map(h => h.value);
        const avgStart = firstFew.reduce((a, b) => a + b, 0) / firstFew.length;
        const current = this.memoryHistory[this.memoryHistory.length - 1].value;
        
        const steadyGrowth = current > avgStart * 1.4; // 40% increase over start

        return growing && steadyGrowth;
    }

    getResult() {
        return {
            peakMemory: this.peakMemory,
            idleMemory: this.idleMemory,
            ratio: this.idleMemory > 0 ? parseFloat((this.peakMemory / this.idleMemory).toFixed(2)) : 0,
            issues: []
        };
    }

    reset() {
        this.memoryHistory = [];
        this.peakMemory = 0;
        this.idleMemory = 0;
        this.startTime = 0;
    }
}

module.exports = new MemoryAnalyzer();
