class InteractionAnalyzer {
    constructor() {
        this.clickHistory = []; // Array of timestamps
        this.lastInputTime = 0;
        this.lastResponseTime = 0;
        this.ghostClickThreshold = 2000; // 2 seconds without response
        this.totalInputs = 0;
        this.totalResponses = 0;
    }

    analyze(fps, newLogs = []) {
        const now = Date.now();
        
        // Tracking clicks from logs (both generic INPUT_DETECTED and SDK specific)
        newLogs.forEach(line => {
            if (line.includes('INPUT_DETECTED') || line.includes('INPUT_TIME')) {
                this.clickHistory.push(now);
                this.lastInputTime = now;
                this.totalInputs++;
            }

            // SDK Response logic
            if (line.includes('[TESTMATE] INPUT_TIME:')) {
                const match = line.match(/INPUT_TIME:\s*(\d+)/);
                if (match) this.pendingInputTime = parseInt(match[1]);
            }
            
            if (line.includes('[TESTMATE] RESPONSE_TIME:')) {
                const match = line.match(/RESPONSE_TIME:\s*(\d+)/);
                if (match && this.pendingInputTime) {
                    this.lastResponseTime = parseInt(match[1]) - this.pendingInputTime;
                    this.totalResponses++;
                    this.pendingInputTime = null;
                    this.lastInputTime = 0; // Reset pending input timer
                }
            }
        });

        // Clean up click history (only keep last 5 seconds)
        this.clickHistory = this.clickHistory.filter(ts => now - ts < 5000);
        
        const clicksPerSecond = this.clickHistory.length / 5;
        const issues = [];

        // 1. Button Mashing Detection
        if (clicksPerSecond > 4 && fps < 35) {
            issues.push({
                type: "UI_STRESS",
                severity: "HIGH",
                message: `UI Stress: High interaction rate (${clicksPerSecond.toFixed(1)} clicks/s) causing performance drop.`
            });
        }

        // 2. Ghost Click Detection
        // If an input was detected but no response for > 2 seconds
        if (this.lastInputTime > 0 && (now - this.lastInputTime > this.ghostClickThreshold)) {
            issues.push({
                type: "GHOST_CLICK",
                severity: "YELLOW",
                message: "Possible ghost click: Input detected without UI response event."
            });
            this.lastInputTime = 0; // Prevent duplicate alerts
        }

        return {
            interactionStress: clicksPerSecond > 3 ? "HIGH" : (clicksPerSecond > 1 ? "MEDIUM" : "LOW"),
            clicksPerSecond: parseFloat(clicksPerSecond.toFixed(1)),
            responseTime: this.lastResponseTime,
            issues
        };
    }

    reset() {
        this.clickHistory = [];
        this.lastInputTime = 0;
        this.lastResponseTime = 0;
        this.pendingInputTime = null;
        this.totalInputs = 0;
        this.totalResponses = 0;
    }
}

module.exports = new InteractionAnalyzer();
