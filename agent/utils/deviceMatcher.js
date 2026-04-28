const fs = require('fs');
const path = require('path');

class DeviceMatcher {
    constructor() {
        this.profiles = [];
        this.loadProfiles();
    }

    loadProfiles() {
        try {
            const data = fs.readFileSync(path.join(__dirname, '../data/deviceProfiles.json'), 'utf8');
            this.profiles = JSON.parse(data);
        } catch (e) {
            console.error('Failed to load device profiles:', e);
            this.profiles = [];
        }
    }

    /**
     * Finds the best matching profile for the current hardware.
     */
    findMatch(deviceInfo) {
        if (!deviceInfo || !deviceInfo.model) return this.getDefaultProfile(deviceInfo);

        const model = deviceInfo.model.toLowerCase();
        
        // Direct name match
        let match = this.profiles.find(p => model.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(model));
        
        if (match) return match;

        // Fallback to tier-based defaults if no direct match
        return this.getDefaultProfile(deviceInfo);
    }

    getDefaultProfile(deviceInfo) {
        const ram = parseInt(deviceInfo.ram) || 4;
        
        if (ram >= 12) return this.profiles.find(p => p.name === 'Samsung Galaxy S24 Ultra');
        if (ram >= 8) return this.profiles.find(p => p.name === 'Samsung Galaxy S23');
        if (ram >= 6) return this.profiles.find(p => p.name === 'Redmi Note 13 Pro');
        
        return this.profiles.find(p => p.name === 'Generic Low-end');
    }

    getAllProfiles() {
        return this.profiles;
    }
}

module.exports = new DeviceMatcher();
