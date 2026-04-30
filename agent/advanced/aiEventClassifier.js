'use strict';

const INTERESTING_PATTERNS = [
    /(?:logEvent|trackEvent|sendEvent|logAppEvent|logPurchase|sendAnalytics)/i,
    /(?:purchase|payment|subscription|revenue)\b/i,
    /(?:level_|stage_|quest_|mission_|achievement)/i,
    /(?:ad_show|ad_load|ad_click|ad_impression|rewarded|interstitial|banner_load)/i,
    /(?:analytics|telemetry|setUserProperty|user_property)/i,
    /(?:session_start|session_end|app_open|first_open|app_install)/i,
    /(?:GameAnalytics|AppsFlyerLib|AdjustEvent|FBTRACE|FacebookSDK|BillingClient)/i,
];

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

class AIEventClassifier {
    constructor() {
        this._apiKey = null;
        this._buffer = [];
        this._pendingEvents = [];
        this._maxBuffer = 4;
        this._processing = false;
        this._sessionStartTime = Date.now();
        this._lastStatus = 'idle'; // idle | ok | error
        this._lastError = null;
    }

    reset() {
        this._buffer = [];
        this._pendingEvents = [];
        this._processing = false;
        this._sessionStartTime = Date.now();
        this._lastStatus = 'idle';
        this._lastError = null;
    }

    setApiKey(key) {
        this._apiKey = key ? key.trim() : null;
    }

    get hasKey() {
        return !!this._apiKey;
    }

    get lastStatus() {
        return this._lastStatus;
    }

    isInterestingLine(line) {
        if (!line || !line.trim()) return false;
        return INTERESTING_PATTERNS.some(p => p.test(line));
    }

    addLine(line) {
        if (!this._apiKey || !this.isInterestingLine(line)) return;

        const eventTime = parseFloat(((Date.now() - this._sessionStartTime) / 1000).toFixed(1));
        this._buffer.push({ line: line.trim(), time: eventTime });

        if (this._buffer.length >= this._maxBuffer && !this._processing) {
            const batch = this._buffer.splice(0, this._maxBuffer);
            this._classifyBatch(batch);
        }
    }

    async _classifyBatch(batch) {
        this._processing = true;
        try {
            const logLines = batch.map((b, i) => `${i + 1}. [${b.time}s] ${b.line}`).join('\n');

            const prompt = `You are a mobile game analytics expert analyzing Android logcat output.
Identify any analytics/tracking events in these log lines.

Return ONLY a JSON array. No markdown, no explanation.
Each item: {"event_type":"GA|FIREBASE|FACEBOOK|IAP|APPSFLYER|ADJUST|ADS|LIFECYCLE|CUSTOM","name":"snake_case_name","detail":"brief description","time":0.0}

Rules:
- Only include lines you are confident contain real analytics events (confidence > 0.7)
- name must be snake_case, max 40 chars
- If no events found, return []

Log lines:
${logLines}`;

            const response = await fetch(`${GEMINI_ENDPOINT}?key=${this._apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
                })
            });

            if (!response.ok) {
                this._lastStatus = 'error';
                this._lastError = `HTTP ${response.status}`;
                return;
            }

            const result = await response.json();
            const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

            const jsonMatch = text.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) {
                this._lastStatus = 'ok';
                return;
            }

            const events = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(events)) {
                this._lastStatus = 'ok';
                return;
            }

            for (const ev of events) {
                if (!ev.name) continue;
                this._pendingEvents.push({
                    name: String(ev.name).slice(0, 40).replace(/\s+/g, '_'),
                    category: ev.event_type || 'CUSTOM',
                    detail: String(ev.detail || '').slice(0, 80),
                    time: typeof ev.time === 'number' ? ev.time : batch[0]?.time || 0,
                    confidence: 'AI'
                });
            }

            if (this._pendingEvents.length > 200) {
                this._pendingEvents = this._pendingEvents.slice(-200);
            }

            this._lastStatus = 'ok';
        } catch (e) {
            this._lastStatus = 'error';
            this._lastError = e.message;
        } finally {
            this._processing = false;
        }
    }

    drainPendingEvents() {
        // Flush any remaining buffered lines that haven't hit the threshold yet
        if (this._buffer.length > 0 && !this._processing) {
            const batch = this._buffer.splice(0);
            this._classifyBatch(batch);
        }
        const events = [...this._pendingEvents];
        this._pendingEvents = [];
        return events;
    }
}

module.exports = new AIEventClassifier();
