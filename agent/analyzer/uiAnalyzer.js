/**
 * UI Analyzer Module
 *
 * Evaluates UI quality for the session report. Findings are derived from the
 * Text Overflow Detector (`textOverflowDetector`), which parses the live
 * `uiautomator` view hierarchy during the session and flags real, measured
 * layout/text problems (truncation, edge clipping, missing-string placeholders,
 * empty/squashed widgets).
 *
 * NOTE: This module performs NO image/pixel analysis. It does not OCR or run a
 * vision model — it surfaces the deterministic widget-level findings already
 * collected at runtime. If no view-hierarchy data is available (dump failed,
 * app blocked dumping, or session too short), it honestly reports NOT TESTED
 * rather than inventing findings.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Map textOverflowDetector finding codes → tester-facing UI issue types.
const CODE_MAP = {
    missing_string_placeholder: { type: 'Missing String / Localization', weight: 15 },
    truncated_ellipsis:         { type: 'Text Truncated',                 weight: 8  },
    clipped_at_edge:            { type: 'UI Clipping',                     weight: 8  },
    empty_textview:             { type: 'Empty Text Widget',              weight: 3  },
    extremely_small:            { type: 'Squashed Text',                  weight: 3  }
};

class UIAnalyzer {
    /**
     * @param {string} sessionDir
     * @param {Object} logAnalysis        Result from logAnalyzer (unused for now, kept for signature stability).
     * @param {Object} textOverflowSnap   Result from textOverflowDetector.getReportSummary().
     */
    analyzeUI(sessionDir, logAnalysis = null, textOverflowSnap = null) {
        // frameCount is still useful context for the report (how much was captured).
        let frameCount = 0;
        try {
            const screenshotDir = path.join(sessionDir, 'screenshots');
            if (fs.existsSync(screenshotDir)) {
                frameCount = fs.readdirSync(screenshotDir)
                    .filter(f => f.endsWith('.png') || f.endsWith('.jpg')).length;
            }
        } catch (_) { /* frameCount stays 0 */ }

        // No view-hierarchy data → be honest, don't fabricate.
        if (!textOverflowSnap || !Array.isArray(textOverflowSnap.findings)) {
            return {
                status: 'NOT TESTED',
                findings: [],
                frameCount,
                score: 0,
                source: 'textOverflowDetector',
                note: 'No UI hierarchy data was captured this session.'
            };
        }

        const dumpsTaken = textOverflowSnap.dumpsTaken || 0;
        if (dumpsTaken === 0) {
            return {
                status: 'NOT TESTED',
                findings: [],
                frameCount,
                score: 0,
                source: 'textOverflowDetector',
                note: textOverflowSnap.discoveryError
                    || 'uiautomator produced no UI dumps (app may block dumping, or session was too short).'
            };
        }

        const screen = textOverflowSnap.screen || { width: 0, height: 0 };
        const findings = textOverflowSnap.findings.map(f => this.mapFinding(f, screen));

        // Score: start at 100, subtract per finding by mapped weight. Floor at 0.
        const penalty = findings.reduce((sum, f) => sum + (f._weight || 0), 0);
        const score = Math.max(0, 100 - penalty);

        const errors = findings.filter(f => f.severity === 'error').length;
        const warns  = findings.filter(f => f.severity === 'warn').length;
        const status = errors > 0 ? 'FAIL' : warns > 0 ? 'WARNING' : 'PASS';

        // Strip the internal weight before returning.
        const cleanFindings = findings.map(({ _weight, ...rest }) => rest);

        return {
            status,
            findings: cleanFindings,
            frameCount,
            dumpsTaken,
            score,
            source: 'textOverflowDetector',
            counts: { errors, warnings: warns, total: findings.length }
        };
    }

    mapFinding(f, screen) {
        const mapped = CODE_MAP[f.code] || { type: f.code || 'UI Issue', weight: 5 };
        return {
            type: mapped.type,
            code: f.code,
            severity: f.severity || 'info',
            detail: f.message || '',
            text: f.text || '',
            location: this.boundsToLocation(f.bounds, screen),
            resourceId: f.resourceId || null,
            className: f.className || null,
            timestamp: this.toTime(f.at),
            _weight: mapped.weight
        };
    }

    // Convert pixel bounds → human region label (e.g. "Top-Right", "Center", "Bottom-Edge").
    boundsToLocation(b, screen) {
        if (!b || !screen || !screen.width || !screen.height) return 'Unknown';
        const cx = (b.x1 + b.x2) / 2;
        const cy = (b.y1 + b.y2) / 2;
        const vBand = cy < screen.height / 3 ? 'Top'
                    : cy > (screen.height * 2) / 3 ? 'Bottom' : 'Center';
        const hBand = cx < screen.width / 3 ? 'Left'
                    : cx > (screen.width * 2) / 3 ? 'Right' : 'Center';
        if (vBand === 'Center' && hBand === 'Center') return 'Center';
        return `${vBand}-${hBand}`;
    }

    toTime(ms) {
        if (!ms) return '00:00:00';
        try { return new Date(ms).toLocaleTimeString(); }
        catch (_) { return '00:00:00'; }
    }
}

module.exports = new UIAnalyzer();
