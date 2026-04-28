const path = require('path');
const fs = require('fs');

/**
 * Robust path resolution for bundled tools (adb, aapt, etc.)
 * Works in both development and production (packaged) environments.
 */
function getToolPath(toolName) {
    // 1. Production Path (Electron Resources)
    // process.resourcesPath is set by Electron when packaged
    if (process.resourcesPath) {
        const prodPath = path.join(process.resourcesPath, 'tools', toolName);
        if (fs.existsSync(prodPath)) return prodPath;
    }

    // 2. Development Paths (Check various relative locations)
    const devPaths = [
        path.join(process.cwd(), 'tools', toolName), // Project Root
        path.join(process.cwd(), '..', 'tools', toolName), // inside electron-app/
        path.join(__dirname, '..', '..', 'tools', toolName), // Relative to utils/
        path.join(__dirname, '..', '..', '..', 'tools', toolName) // Relative to deep modules
    ];

    for (const p of devPaths) {
        if (fs.existsSync(p)) return p;
    }

    // Fallback to most likely dev path if not found
    return devPaths[0];
}

module.exports = { getToolPath };
