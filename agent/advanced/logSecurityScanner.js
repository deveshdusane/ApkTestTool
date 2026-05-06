const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class LogSecurityScanner {
    constructor() {
        this.patterns = {
            TOKEN: {
                regex: /(eyJhbGci|Bearer\s+[a-zA-Z0-9\-\._~+/]+=*)/gi,
                label: 'Potential Auth Token Leak',
                severity: 'CRITICAL'
            },
            EMAIL: {
                regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
                label: 'PII Leak (Email)',
                severity: 'HIGH'
            },
            API_KEY: {
                regex: /(api[-_]key|secret|password|passwd|auth[-_]token)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-]{8,})["']?/gi,
                label: 'Credential Leak',
                severity: 'CRITICAL'
            },
            INTERNAL_IP: {
                regex: /10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+/g,
                label: 'Internal Network Info Leak',
                severity: 'MEDIUM'
            },
            GENERIC_ID: {
                regex: /(uid|user[-_]id|player[-_]id)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-]{4,})["']?/gi,
                label: 'User Identity Leak',
                severity: 'MEDIUM'
            }
        };

        this.findings = [];
        this.isScanning = false;
        this.logFile = null;
        this.lastReadSize = 0;
    }

    start(logFilePath, onFinding) {
        if (!fs.existsSync(logFilePath)) {
            // Wait for file creation if it doesn't exist yet
            const dir = path.dirname(logFilePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(logFilePath, '');
        }

        this.logFile = logFilePath;
        this.findings = [];
        this.isScanning = true;
        this.lastReadSize = 0;
        this.onFinding = onFinding;

        logger.logInfo(`Log Security Scanner started for: ${logFilePath}`);

        // Poll the file for changes
        this.watchInterval = setInterval(() => {
            this.scanNewContent();
        }, 2000);
    }

    stop() {
        this.isScanning = false;
        if (this.watchInterval) clearInterval(this.watchInterval);
        logger.logInfo('Log Security Scanner stopped.');
        return this.findings;
    }

    scanNewContent() {
        if (!this.isScanning || !this.logFile) return;

        try {
            const stats = fs.statSync(this.logFile);
            if (stats.size <= this.lastReadSize) return;

            const stream = fs.createReadStream(this.logFile, {
                start: this.lastReadSize,
                end: stats.size
            });

            let content = '';
            stream.on('data', (chunk) => {
                content += chunk.toString();
            });

            stream.on('end', () => {
                this.lastReadSize = stats.size;
                this.processLines(content);
            });
        } catch (e) {
            console.error('Error scanning logs:', e);
        }
    }

    processLines(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;

            for (const [key, pattern] of Object.entries(this.patterns)) {
                const matches = line.match(pattern.regex);
                if (matches) {
                    for (const match of matches) {
                        // Avoid duplicates for the same line/match
                        const exists = this.findings.some(f => f.match === match && f.line === line.trim());
                        if (!exists) {
                            const finding = {
                                type: key,
                                label: pattern.label,
                                severity: pattern.severity,
                                match: match,
                                line: line.trim().substring(0, 500), // Cap length
                                timestamp: new Date().toISOString()
                            };
                            this.findings.push(finding);
                            if (this.onFinding) this.onFinding(finding);
                        }
                    }
                }
            }
        }
    }

    getFindings() {
        return this.findings;
    }
}

module.exports = new LogSecurityScanner();
