/**
 * Insight Engine Utility
 * Generates human-readable summaries and actionable recommendations from QA data.
 */

/**
 * Generates AI-style insights based on rule patterns.
 * @param {Object} reportData 
 * @returns {Object}
 */
function generateInsights(reportData) {
    const { checklist, metrics, performance } = reportData;
    const insights = [];
    const recommendations = [];

    // 1. Crash/ANR Analysis
    if (checklist.crash === 'FAIL') {
        insights.push("Application experienced a crash during testing.");
        recommendations.push("Investigate crash logs and null references.");
    }

    if (checklist.anr === 'FAIL') {
        insights.push("App became unresponsive (ANR), likely due to main thread blocking.");
        recommendations.push("Optimize heavy operations on the main thread.");
    }

    // 2. Stability Analysis
    if (metrics.errorCount > 20) {
        insights.push("High number of runtime errors detected, indicating core instability.");
        recommendations.push("Review technical logcat logs for recurring logic exceptions.");
    } else if (metrics.errorCount > 0) {
        insights.push("Occasional runtime errors detected, which may affect edge-case stability.");
    }

    // 3. Performance Analysis
    if (performance) {
        // Simple memory spike detection check (already checked in perfMonitor but we reinforce here)
        const mem = performance.memory || [];
        if (mem.length > 2) {
            const initial = mem[0];
            const peak = Math.max(...mem);
            if (peak > initial * 1.3) {
                insights.push("Memory usage increased significantly over time, indicating a possible memory leak.");
                recommendations.push("Check object allocation, pool management, and memory cleanup.");
            }
        }

        if (performance.fpsDrops > 10) {
            insights.push("Frequent frame drops detected, significantly affecting gameplay smoothness.");
            recommendations.push("Optimize rendering pipelines and reduce draw calls/overdraw.");
        }

        if (performance.avgCPU > 70) {
            insights.push(`Average CPU usage is very high (${performance.avgCPU}%). This can lead to device heating and battery drain.`);
            recommendations.push("Profile CPU usage to find hot functions or inefficient background threads.");
        }
    }

    // 4. Lifecycle Analysis
    if (checklist.lifecycle === 'WARNING') {
        insights.push("App failed to reach 'Resumed' state or lifecycle events were missing.");
        recommendations.push("Verify Activity lifecycle handling, especially onResume and onCreate.");
    }

    // Composite Summary
    let summary = insights.length > 0 
        ? insights.join(' ') 
        : "Session was highly stable with no significant technical or performance issues detected.";

    return {
        summary,
        recommendations: [...new Set(recommendations)], // Deduplicate
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    generateInsights
};
