const path = require('path');
const fs = require('fs');

/**
 * Robust path resolution for bundled tools (adb, aapt, etc.).
 * Works in both development and production (packaged) environments.
 *
 * Tools live under tools/<platform>/ where <platform> is `win`, `mac`, or
 * `linux`. We search the platform-specific subdir first, then fall back to
 * the legacy flat tools/ layout so older dev checkouts still work.
 */
const PLATFORM_DIR = process.platform === 'win32' ? 'win'
                  : process.platform === 'darwin' ? 'mac'
                  : 'linux';

function candidates(toolName) {
    const subPaths = [
        path.join('tools', PLATFORM_DIR, toolName),  // preferred layout
        path.join('tools', toolName)                 // legacy flat layout
    ];
    const roots = [];
    if (process.resourcesPath) roots.push(process.resourcesPath);
    roots.push(
        process.cwd(),
        path.join(process.cwd(), '..'),
        path.join(__dirname, '..', '..'),
        path.join(__dirname, '..', '..', '..')
    );
    const out = [];
    for (const r of roots) {
        for (const sp of subPaths) out.push(path.join(r, sp));
    }
    return out;
}

function getToolPath(toolName) {
    for (const p of candidates(toolName)) {
        if (fs.existsSync(p)) return p;
    }
    // Fall back to the most likely dev path so error messages contain a real path.
    return path.join(process.cwd(), 'tools', PLATFORM_DIR, toolName);
}

module.exports = { getToolPath };
