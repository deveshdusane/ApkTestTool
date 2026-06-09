/**
 * Performance Scaler — Hardware-Aware Deterministic FPS Predictor
 *
 * Core formula: predictedFPS = baseFPS × (targetScore / currentScore)
 *
 * This correctly scales relative to the connected device's own hardware tier.
 * A budget device running at 26 FPS → flagship device predicts 60+ FPS.
 * A flagship device running at 26 FPS → other flagships predict ~26 FPS.
 */

const TIER_DEFAULTS = {
    flagship: { cpuScore: 90, gpuScore: 95, maxFPS: 120 },
    mid:      { cpuScore: 65, gpuScore: 60, maxFPS: 60  },
    budget:   { cpuScore: 40, gpuScore: 35, maxFPS: 30  }
};

class PerformanceScaler {
    /**
     * Predicts FPS for targetDeviceProfile given measured session data
     * on the connected device (currentDeviceProfile).
     */
    static predict(currentData, currentDeviceProfile, targetDeviceProfile) {
        if (!currentData || !currentData.fps || currentData.fps <= 0) {
            return { error: 'Insufficient runtime data' };
        }

        const baseFPS    = currentData.fps;
        const baseMemory = currentData.memory   || 0;
        const baseCPU    = currentData.cpuUsage || 0;

        // ── Connected device combined score ──────────────────────────────────
        // Fall back to RAM-based tier estimate if device not in DB
        const curDefaults = TIER_DEFAULTS[currentDeviceProfile?.tier] || TIER_DEFAULTS.mid;
        const curCpuScore = currentDeviceProfile?.cpuScore ?? curDefaults.cpuScore;
        const curGpuScore = currentDeviceProfile?.gpuScore ?? curDefaults.gpuScore;
        // Weighted: GPU matters more for mobile rendering
        const currentScore = Math.max(1, curCpuScore * 0.4 + curGpuScore * 0.6);

        // ── Target device combined score ─────────────────────────────────────
        const tgtDefaults  = TIER_DEFAULTS[targetDeviceProfile.tier] || TIER_DEFAULTS.mid;
        const tgtCpuScore  = targetDeviceProfile.cpuScore ?? tgtDefaults.cpuScore;
        const tgtGpuScore  = targetDeviceProfile.gpuScore ?? tgtDefaults.gpuScore;
        const targetScore  = tgtCpuScore * 0.4 + tgtGpuScore * 0.6;

        // ── Relative scaling — the core formula ──────────────────────────────
        const scalingFactor = targetScore / currentScore;
        let predictedFPS = baseFPS * scalingFactor;

        // Budget GPU penalty: diminishing returns from low-end graphics chips
        if (tgtGpuScore < 50) predictedFPS *= 0.80;
        if (tgtGpuScore < 35) predictedFPS *= 0.75;

        // Cap at device max refresh rate
        const maxFPS = targetDeviceProfile.refreshRate || tgtDefaults.maxFPS;
        predictedFPS = Math.min(predictedFPS, maxFPS);
        predictedFPS = Math.max(1, Math.round(predictedFPS));

        // HONESTY: this is a linear GPU/CPU-score scaling heuristic, NOT a
        // benchmark. Real cross-device error is commonly ±15-30%. So we expose
        // an estimate RANGE (not just a point) and never let the single number
        // read as a measurement. Earlier code added a fake ±2 "variance" by
        // hashing the device name — removed; it implied precision we don't have.
        const ESTIMATE_MARGIN = 0.25; // ±25%
        const lowFPS  = Math.max(1, Math.round(predictedFPS * (1 - ESTIMATE_MARGIN)));
        const highFPS = Math.min(maxFPS, Math.round(predictedFPS * (1 + ESTIMATE_MARGIN)));

        const frameTime = (1000 / predictedFPS).toFixed(1);
        const verdict   = this.getVerdict(predictedFPS);
        const bottleneck = this.detectBottleneck(baseCPU, tgtGpuScore, baseMemory);

        return {
            deviceName:   targetDeviceProfile.name,
            platform:     targetDeviceProfile.platform || 'android',
            tier:         targetDeviceProfile.tier,
            region:       targetDeviceProfile.region,
            ram:          targetDeviceProfile.ram,
            gpu:          targetDeviceProfile.gpu,
            predictedFPS,
            fpsRange:     [lowFPS, highFPS],
            frameTime,
            verdict,
            bottleneck,
            // Make the nature of the number unmistakable to any consumer.
            estimate: true,
            method: 'heuristic-scaling',
            note: 'Estimate from linear GPU/CPU-score scaling, not an on-device benchmark. Typical error ±15-30%. Verify on a real device for sign-off.'
        };
    }

    /**
     * Returns 'CPU', 'GPU', 'Memory', or 'Balanced'.
     * These exact strings are used by devicePrediction.js renderer checks.
     */
    static detectBottleneck(cpuUsage, gpuScore, memoryUsage) {
        if (cpuUsage > 75) return 'CPU';
        if (gpuScore  < 50) return 'GPU';
        if (memoryUsage > 700) return 'Memory';
        return 'Balanced';
    }

    static getVerdict(fps) {
        if (fps >= 55) return 'SMOOTH';
        if (fps >= 30) return 'PLAYABLE';
        return 'LAGGY';
    }

    // Confidence in the ESTIMATE (not a measurement). Ceiling is deliberately
    // low: even with a stable long session on a known device, a linear scaling
    // heuristic can't earn high confidence. 95% read as near-certain and was
    // misleading. Base 45, capped at 70.
    static calculateConfidence(sessionInfo) {
        let confidence = 45;
        if (sessionInfo.fpsStable)         confidence += 10;
        if (sessionInfo.deviceMatchedInDB) confidence += 10;
        if (sessionInfo.duration > 60)     confidence += 5;
        return Math.min(confidence, 70);
    }
}

module.exports = PerformanceScaler;
