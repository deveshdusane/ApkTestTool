const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * AAPT Resolver Utility
 * Responsibly locates aapt or aapt2 within the Android SDK or system.
 */
class AaptResolver {
    constructor() {
        this.cachedPath = null;
    }

    resolve() {
        if (this.cachedPath) return this.cachedPath;

        // 1. Try bundled tool first (Portable)
        const { getToolPath } = require('./toolPaths');
        const aaptExecName = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
        const bundled = getToolPath(aaptExecName);
        if (fs.existsSync(bundled)) {
            this.cachedPath = bundled;
            return bundled;
        }

        // 2. Try system path
        if (this.isAaptInPath()) {
            this.cachedPath = 'aapt';
            return 'aapt';
        }

        // 2. Try Environment Variables
        const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (sdkRoot) {
            const found = this.searchInSdk(sdkRoot);
            if (found) {
                this.cachedPath = `"${found}"`;
                return this.cachedPath;
            }
        }

        // 3. Common System Locations
        const commonPaths = this.getCommonPaths();
        for (const p of commonPaths) {
            if (fs.existsSync(p)) {
                const found = this.searchInSdk(p);
                if (found) {
                    this.cachedPath = `"${found}"`;
                    return this.cachedPath;
                }
            }
        }

        return null;
    }

    /**
     * Checks if aapt is available in the system PATH.
     */
    isAaptInPath() {
        try {
            execSync('aapt version', { stdio: 'ignore' });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Gets platform-specific common SDK locations.
     */
    getCommonPaths() {
        const paths = [];
        const home = process.env.HOME || process.env.USERPROFILE;

        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA;
            if (localAppData) paths.push(path.join(localAppData, 'Android', 'Sdk'));
            paths.push('C:\\Android\\Sdk');
            paths.push('D:\\Android\\Sdk');
        } else if (process.platform === 'darwin') {
            if (home) paths.push(path.join(home, 'Library', 'Android', 'sdk'));
            paths.push('/Users/Shared/Android/sdk');
        } else {
            if (home) paths.push(path.join(home, 'Android', 'Sdk'));
            paths.push('/usr/local/lib/android/sdk');
        }

        return paths;
    }

    /**
     * Searches for aapt inside an SDK root.
     */
    searchInSdk(sdkRoot) {
        try {
            const buildToolsPath = path.join(sdkRoot, 'build-tools');
            if (!fs.existsSync(buildToolsPath)) return null;

            const versions = fs.readdirSync(buildToolsPath);
            if (versions.length === 0) return null;

            // Sort versions descending (numeric sort for semver-like folders)
            versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

            for (const v of versions) {
                const aaptExec = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
                const fullPath = path.join(buildToolsPath, v, aaptExec);
                if (fs.existsSync(fullPath)) return fullPath;
            }
        } catch (err) {
            console.error('[AaptResolver] Error searching SDK:', err.message);
        }
        return null;
    }
}

module.exports = new AaptResolver();
