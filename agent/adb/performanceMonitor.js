/**
 * Performance Monitor Utility
 * Tracks Memory and Frame performance via ADB dumpsys.
 */

const adbHelper = require('./adbHelper');
const config = require('../config/config');
const logger = require('../utils/logger');

class PerformanceMonitor {
    constructor() {
        this.package = config.packageName;
        this.interval = null;
        this.data = {
            memory: [],
            cpu: [],
            fpsDrops: 0,
            frameTimes: []
        };
        this.lastJankCount = -1; // -1 = no baseline yet
    }

    /**
     * Starts tracking performance metrics.
     * @param {string} packageName
     * @param {number} intervalMs 
     */
    start(packageName, intervalMs = 5000) {
        this.package = packageName || config.packageName;
        this.data = { memory: [], cpu: [], fpsDrops: 0, frameTimes: [] };
        this.lastJankCount = -1;

        this.interval = setInterval(async () => {
            await this.trackMemory();
            await this.trackCPU();
            await this.trackFPS();
        }, intervalMs);
        logger.logInfo(`Performance monitoring started for ${this.package}`);
    }

    /**
     * Stops tracking.
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.logInfo('Performance monitoring stopped');
        return this.data;
    }

    /**
     * Tracks Memory Usage (PSS)
     */
    async trackMemory() {
        try {
            const output = await adbHelper.runADB(['shell', 'dumpsys', 'meminfo', this.package]);
            // Extract "TOTAL" PSS memory (More robust regex)
            const match = output.match(/TOTAL\s+PSS:\s*(\d+)/i) || output.match(/TOTAL:\s*(\d+)/i) || output.match(/TOTAL\s+(\d+)/i);
            if (match) {
                const memoryMB = Math.round(parseInt(match[1]) / 1024);
                if (memoryMB > 0) this.data.memory.push(memoryMB);
            }
        } catch (err) {}
    }

    /**
     * Tracks CPU Usage (%)
     */
    async trackCPU() {
        try {
            const output = await adbHelper.runADB(['shell', 'dumpsys', 'cpuinfo']);
            // Look for the package in cpuinfo output
            // Format: 12% 1234/com.pkg: 10% user + 2% kernel
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes(this.package)) {
                    const match = line.match(/(\d+)%\s+\d+\//);
                    if (match) {
                        this.data.cpu.push(parseInt(match[1]));
                        break;
                    }
                }
            }
        } catch (err) {}
    }

    /**
     * Tracks FPS/Frame Drops
     */
    async trackFPS() {
        try {
            const output = await adbHelper.runADB(['shell', 'dumpsys', 'gfxinfo', this.package]);
            const jankMatch = output.match(/Janky frames: (\d+)/);
            if (jankMatch) {
                const jankCount = parseInt(jankMatch[1]);
                if (this.lastJankCount >= 0 && jankCount > this.lastJankCount) {
                    this.data.fpsDrops += jankCount - this.lastJankCount;
                }
                this.lastJankCount = jankCount;
            }
        } catch (err) {}
    }

    /**
     * Simple analysis of collected data.
     */
    getAnalysis() {
        const mem = this.data.memory;
        const cpu = this.data.cpu;
        let status = 'Stable';
        let issues = [];

        // Memory Analysis
        if (mem.length > 0) {
            const maxMem = Math.max(...mem);
            const initialMem = mem[0];
            if (maxMem > initialMem * 1.5) {
                status = 'Performance issues detected';
                issues.push(`Major memory growth: Peak ${maxMem}MB (Started at ${initialMem}MB)`);
            }
        }

        // CPU Analysis
        if (cpu.length > 0) {
            const avgCpu = Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length);
            if (avgCpu > 70) {
                status = 'Performance issues detected';
                issues.push(`High average CPU usage: ${avgCpu}%`);
            }
        }

        // FPS Analysis
        if (this.data.fpsDrops > 30) {
            status = status === 'Stable' ? 'Minor lag' : 'Performance issues detected';
            issues.push(`Significant frame drops: ${this.data.fpsDrops} janky frames detected`);
        }

        return {
            status,
            issues,
            data: this.data,
            peakMemory: mem.length ? Math.max(...mem) : 0,
            avgCPU: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : 0
        };
    }
}

module.exports = new PerformanceMonitor();
