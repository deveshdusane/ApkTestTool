const adbHelper = require('../adb/adbHelper');
const config = require('../config/config');

class NetworkAnalyzer {
    constructor() {
        this.networkHistory = [];
        this.lastType = "OFF";
    }

    async analyze() {
        try {
            const type = await this.getNetworkType();
            const latency = await this.getPing();
            
            const entry = {
                type,
                ping: latency,
                timestamp: Date.now()
            };

            this.networkHistory.push(entry);
            if (this.networkHistory.length > 50) this.networkHistory.shift();

            const issues = [];
            
            // Detect Connectivity Drop
            if (this.lastType !== "OFF" && type === "OFF") {
                issues.push({ type: "NETWORK_DROP", severity: "HIGH", message: "Network connection lost" });
            }
            this.lastType = type;

            // Detect High Latency
            if (latency > 150) {
                issues.push({ type: "LATENCY", severity: "YELLOW", message: `High ping: ${latency}ms` });
            }

            return {
                current: entry,
                history: this.networkHistory,
                issues
            };
        } catch (e) {
            return { current: { type: "OFF", ping: 0, timestamp: Date.now() }, issues: [] };
        }
    }

    async getNetworkType() {
        try {
            const out = await adbHelper.runADB(['shell', 'dumpsys', 'connectivity']);
            // Standard check for connectivity state
            if (out.includes('WIFI') && out.includes('state: CONNECTED')) return "WiFi";
            if (out.includes('MOBILE') && out.includes('state: CONNECTED')) return "Mobile";
            
            // Fallback check if standard string not found
            const summaryMatch = out.match(/Active network:.*\[ type: (\w+)/);
            if (summaryMatch) {
                return summaryMatch[1].toUpperCase();
            }
            
            return "OFF";
        } catch (e) {
            return "OFF";
        }
    }

    async getPing() {
        try {
            // Ping with timeout to avoid hanging
            const out = await adbHelper.runADB(['shell', 'ping', '-c', '1', '-W', '2', 'google.com']);
            const match = out.match(/time=([\d.]+) ms/);
            return match ? Math.round(parseFloat(match[1])) : 0;
        } catch (e) {
            return 0;
        }
    }

    async getDataUsage() {
        try {
            const out = await adbHelper.runADB(['shell', 'dumpsys', 'netstats']);
            // Look for total bytes (very approximate)
            const match = out.match(/totalBytes=(\d+)/) || out.match(/bytes=(\d+)/);
            if (match) return (parseInt(match[1]) / (1024 * 1024)).toFixed(2);
            return "0";
        } catch (e) { return "0"; }
    }

    reset() {
        this.networkHistory = [];
        this.lastType = "OFF";
    }
}

module.exports = new NetworkAnalyzer();
