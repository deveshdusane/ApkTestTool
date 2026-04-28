/**
 * Device Performance Prediction Engine (Production Grade)
 * Deterministically scales runtime telemetry across hardware-aware targets.
 */

(function() {
    let predictionInterval = null;
    let currentFilterTier = 'all';
    let currentFilterRegion = 'all';
    let lastData = null;

    const UI = {
        emptyState: document.getElementById('prediction-empty-state'),
        content: document.getElementById('prediction-content'),
        tableBody: document.getElementById('prediction-table-body'),
        insightsList: document.getElementById('pred-insights-list'),
        recommendationsList: document.getElementById('pred-recommendations-list'),
        confidenceBadge: document.getElementById('pred-confidence-badge'),
        currentDeviceName: document.getElementById('pred-current-device'),
        currentFPS: document.getElementById('pred-current-fps'),
        currentMem: document.getElementById('pred-current-mem'),
        filterTier: document.getElementById('pred-filter-tier'),
        filterRegion: document.getElementById('pred-filter-region'),
        filterNotice: document.getElementById('pred-filter-notice')
    };

    function init() {
        if (UI.filterTier) {
            UI.filterTier.addEventListener('change', (e) => {
                currentFilterTier = e.target.value;
                if (lastData) render(lastData);
            });
        }
        if (UI.filterRegion) {
            UI.filterRegion.addEventListener('change', (e) => {
                currentFilterRegion = e.target.value;
                if (lastData) render(lastData);
            });
        }
    }

    async function updatePredictions() {
        try {
            const data = await window.api.getPredictions();
            
            if (data.error) {
                // Show empty state if insufficient data
                if (UI.emptyState) UI.emptyState.classList.remove('hidden');
                if (UI.content) UI.content.classList.add('hidden');
                
                if (UI.emptyState) {
                    const msg = UI.emptyState.querySelector('p');
                    if (msg) msg.textContent = data.error;
                }
                return;
            }

            lastData = data;
            
            if (UI.emptyState) UI.emptyState.classList.add('hidden');
            if (UI.content) UI.content.classList.remove('hidden');

            render(data);
        } catch (err) {
            console.error('Prediction Update Error:', err);
        }
    }

    function getFilteredDevices(allDevices, selectedTier, selectedRegion) {
        let filtered = [];
        let mode = 'strict';

        // Step 1: Try strict match
        filtered = allDevices.filter(device => {
            const tierMatch = selectedTier === "all" || selectedTier === "All" || device.tier === selectedTier;
            const regionMatch = selectedRegion === "all" || selectedRegion === "All" || device.region === selectedRegion;
            return tierMatch && regionMatch;
        });

        // Step 2: If too few results, relax region filter
        if (filtered.length < 5) {
            mode = 'relaxed-region';
            filtered = allDevices.filter(device => {
                return selectedTier === "all" || selectedTier === "All" || device.tier === selectedTier;
            });
        }

        // Step 3: If still too few, fallback to all devices
        if (filtered.length < 5) {
            mode = 'fallback-all';
            filtered = allDevices;
        }

        return { devices: filtered, isExpanded: mode !== 'strict' };
    }

    function sortByRegionPriority(devices, selectedRegion) {
        return devices.sort((a, b) => {
            if (selectedRegion === 'all' || selectedRegion === 'All') return 0;
            if (a.region === selectedRegion && b.region !== selectedRegion) return -1;
            if (b.region === selectedRegion && a.region !== selectedRegion) return 1;
            return 0;
        });
    }

    function render(data) {
        const { currentDevice, predictions, bottleneck, confidence, duration } = data;

        // Update Header
        if (UI.currentDeviceName) UI.currentDeviceName.textContent = currentDevice.name;
        if (UI.currentFPS) UI.currentFPS.textContent = currentDevice.fps;
        if (UI.currentMem) UI.currentMem.textContent = `${currentDevice.memory} MB`;
        if (UI.confidenceBadge) {
            UI.confidenceBadge.textContent = `Confidence: ${confidence}%`;
            UI.confidenceBadge.style.background = confidence > 80 ? 'rgba(45,212,191,0.1)' : 'rgba(251,191,36,0.1)';
            UI.confidenceBadge.style.color = confidence > 80 ? '#2dd4bf' : '#fbbf24';
        }

        // Smart Filtering
        const { devices, isExpanded } = getFilteredDevices(predictions, currentFilterTier, currentFilterRegion);
        const sorted = sortByRegionPriority(devices, currentFilterRegion);

        // Show/Hide filter notice
        if (UI.filterNotice) {
            if (isExpanded) {
                UI.filterNotice.classList.remove('hidden');
            } else {
                UI.filterNotice.classList.add('hidden');
            }
        }

        const filtered = sorted;

        // Render Table
        if (UI.tableBody) {
            UI.tableBody.innerHTML = filtered.length > 0 
                ? filtered.map(p => {
                    const verdictClass = p.verdict === 'SMOOTH' ? 'pass' : (p.verdict === 'PLAYABLE' ? 'warning' : 'fail');
                    const verdictColor = p.verdict === 'SMOOTH' ? '#2dd4bf' : (p.verdict === 'PLAYABLE' ? '#fbbf24' : '#fca5a5');
                    
                    return `
                        <tr>
                            <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="font-weight: 600; color: #fff;">${p.deviceName}</div>
                                <div style="font-size: 10px; color: #71717a;">${p.tier.toUpperCase()} • ${p.region}</div>
                            </td>
                            <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #a1a1aa; font-size: 12px;">
                                ${p.ram}GB RAM / ${p.gpu}
                            </td>
                            <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-weight: bold; color: ${verdictColor};">
                                ${p.predictedFPS} FPS
                            </td>
                            <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #71717a; font-size: 12px;">
                                ${p.frameTime} ms
                            </td>
                            <td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <span class="metric" style="background: ${verdictColor}15; color: ${verdictColor}; font-size: 10px;">${p.verdict}</span>
                            </td>
                        </tr>
                    `;
                }).join('')
                : `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #71717a;">No devices match filters.</td></tr>`;
        }

        // Render Insights
        if (UI.insightsList) {
            const insights = [];
            if (bottleneck !== 'Balanced') {
                insights.push(`<div style="color: #fca5a5; font-size: 13px;">⚠️ <strong>Bottleneck Detected:</strong> System is primarily ${bottleneck}-bound.</div>`);
            } else {
                insights.push(`<div style="color: #2dd4bf; font-size: 13px;">✅ <strong>Balanced:</strong> Resource usage is optimized for current hardware.</div>`);
            }

            const lowEnd = predictions.find(p => p.tier === 'budget');
            if (lowEnd && lowEnd.predictedFPS < 30) {
                insights.push(`<div style="color: #a1a1aa; font-size: 13px;">• Budget devices (${lowEnd.region}) will struggle to maintain playable frame rates.</div>`);
            }

            const flagship = predictions.find(p => p.tier === 'flagship');
            if (flagship && flagship.predictedFPS >= 60) {
                insights.push(`<div style="color: #a1a1aa; font-size: 13px;">• High-end hardware has significant thermal and compute headroom.</div>`);
            }

            UI.insightsList.innerHTML = insights.join('');
        }

        // Render Recommendations
        if (UI.recommendationsList) {
            const recs = [];
            if (bottleneck === 'GPU') {
                recs.push('<div style="color: #a78bfa; font-size: 13px;">• Reduce shader complexity and particle counts to improve FPS.</div>');
                recs.push('<div style="color: #a78bfa; font-size: 13px;">• Lower resolution scale on budget devices.</div>');
            } else if (bottleneck === 'CPU') {
                recs.push('<div style="color: #a78bfa; font-size: 13px;">• Optimize scripts and physics calculations.</div>');
                recs.push('<div style="color: #a78bfa; font-size: 13px;">• Reduce number of active game objects or draw calls.</div>');
            } else if (bottleneck === 'Memory') {
                recs.push('<div style="color: #a78bfa; font-size: 13px;">• Enable texture compression and prune unused assets.</div>');
            } else {
                recs.push('<div style="color: #a1a1aa; font-size: 13px;">Current implementation is efficient. No critical optimizations needed.</div>');
            }
            UI.recommendationsList.innerHTML = recs.join('');
        }
    }

    function start() {
        if (predictionInterval) return;
        init();
        updatePredictions();
        predictionInterval = setInterval(updatePredictions, 3000);
    }

    function stop() {
        if (predictionInterval) {
            clearInterval(predictionInterval);
            predictionInterval = null;
        }
    }

    window.DevicePrediction = {
        start,
        stop
    };
})();
