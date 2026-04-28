/**
 * Performance Scaler Utility
 * Deterministic hardware-aware performance prediction engine.
 */

const DEVICE_PROFILES = {
    flagship: { cpuScore: 90, gpuScore: 95, memoryScore: 90, maxFPS: 120 },
    mid: { cpuScore: 65, gpuScore: 60, memoryScore: 65, maxFPS: 60 },
    budget: { cpuScore: 40, gpuScore: 35, memoryScore: 45, maxFPS: 30 }
};

class PerformanceScaler {
    /**
     * Predicts FPS and performance metrics for a target device based on current session data.
     * @param {Object} currentData - Metrics from the current test session.
     * @param {Object} currentDeviceProfile - Hardware profile of the testing device (unused in new logic but kept for compatibility).
     * @param {Object} targetDeviceProfile - Hardware profile of the device to predict for.
     * @returns {Object} Prediction result.
     */
    static predict(currentData, currentDeviceProfile, targetDeviceProfile) {
        if (!currentData || !currentData.fps || currentData.fps <= 0) {
            return { error: 'Insufficient runtime data' };
        }

        // 1 & 2. Use real runtime data as base input
        const baseFPS = currentData.fps;
        const baseMemory = currentData.memory || 0;
        const baseCPU = currentData.cpuUsage || 60;

        // Map target tier to profile for maxFPS and scores if missing
        const profile = DEVICE_PROFILES[targetDeviceProfile.tier] || DEVICE_PROFILES.mid;
        
        // 3. Replace simple scaling with weighted scaling
        // Using target scores from the database if available, otherwise from the generic profile
        const targetCpuScore = targetDeviceProfile.cpuScore || profile.cpuScore;
        const targetGpuScore = targetDeviceProfile.gpuScore || profile.gpuScore;

        const cpuFactor = targetCpuScore / 100;
        const gpuFactor = targetGpuScore / 100;

        const scalingFactor = (cpuFactor * 0.4) + (gpuFactor * 0.6);
        let predictedFPS = baseFPS * scalingFactor;

        // 4. Apply GPU limitation (critical realism fix)
        if (targetGpuScore < 50) predictedFPS *= 0.65;
        if (targetGpuScore < 35) predictedFPS *= 0.5;

        // 5. Apply device FPS cap
        const maxFPS = targetDeviceProfile.refreshRate || profile.maxFPS;
        predictedFPS = Math.min(predictedFPS, maxFPS);

        // 6. Add realistic variance (remove perfect results)
        // Using a stable seed based on the device name to prevent jumping numbers
        const nameHash = targetDeviceProfile.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const varianceSeed = (nameHash % 100) / 100; // 0 to 1
        const variance = (varianceSeed * 6) - 3; // -3 to +3
        predictedFPS += variance;
        predictedFPS = Math.max(10, predictedFPS);
        
        predictedFPS = Math.round(predictedFPS);

        // 7. Calculate frame time
        const frameTime = (1000 / predictedFPS).toFixed(1);

        // 8. Add bottleneck detection (used per-device if needed, but usually global)
        const bottleneck = this.detectBottleneck(baseCPU, targetGpuScore, baseMemory);

        // 9. Improve verdict logic
        const verdict = this.getVerdict(predictedFPS);

        // 11. Final output structure per device
        return {
            deviceName: targetDeviceProfile.name,
            tier: targetDeviceProfile.tier,
            region: targetDeviceProfile.region,
            ram: targetDeviceProfile.ram,
            gpu: targetDeviceProfile.gpu,
            predictedFPS,
            frameTime,
            verdict,
            bottleneck
        };
    }

    /**
     * Detects the primary performance bottleneck.
     */
    static detectBottleneck(cpuUsage, gpuScore, memoryUsage) {
        if (cpuUsage > 80) return "CPU Bound";
        if (gpuScore < 50) return "GPU Bound";
        if (memoryUsage > 800) return "Memory Pressure";
        return "Balanced";
    }

    /**
     * Improved verdict logic.
     */
    static getVerdict(fps) {
        if (fps >= 60) return "SMOOTH";
        if (fps >= 35) return "PLAYABLE";
        return "LAGGY";
    }

    /**
     * Calculates confidence score based on data quality.
     */
    static calculateConfidence(sessionInfo) {
        let confidence = 70; // Base confidence

        if (sessionInfo.fpsStable) confidence += 10;
        if (sessionInfo.deviceMatchedInDB) confidence += 10;
        if (sessionInfo.duration > 60) confidence += 10;

        return Math.min(confidence, 95);
    }
}

module.exports = PerformanceScaler;

