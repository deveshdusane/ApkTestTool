/**
 * Platform dispatch.
 *
 * Single small router that maps an input file to its platform handler. This
 * is the ONLY place in the codebase that should know about .apk vs .ipa.
 * Everywhere else — UI, project manager, history, reports — treats them
 * uniformly through whatever shape this module returns.
 *
 * The dispatch is intentionally one-way (file → platform). We never go the
 * other way and look at the OS to decide; the file extension is canonical.
 * Result: an APK on a Mac still runs the Android pipeline, an IPA on
 * Windows still runs the iOS static-only pipeline (with a clear "macOS
 * required for runtime" message at session-start time).
 *
 * Adding a 3rd platform later (web build .apks bundle, an .aab, etc.):
 *   - extend extToPlatform with the new extension
 *   - register the new analyzer / device / install / runtime modules
 *   - no changes needed elsewhere
 */

const path = require('path');

const PLATFORM_ANDROID = 'android';
const PLATFORM_IOS     = 'ios';
const PLATFORM_UNKNOWN = 'unknown';

function detectPlatform(filePath) {
    if (!filePath || typeof filePath !== 'string') return PLATFORM_UNKNOWN;
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.apk':
        case '.aab':       // App Bundle — not supported yet but routes to Android
            return PLATFORM_ANDROID;
        case '.ipa':
            return PLATFORM_IOS;
        default:
            return PLATFORM_UNKNOWN;
    }
}

/**
 * Does the current host OS support runtime testing for this platform?
 *   - Android: any host OS with adb (we bundle adb for Win + Mac + Linux)
 *   - iOS:    only macOS (libimobiledevice on Windows is incomplete; xctrace
 *             is macOS-exclusive)
 *
 * Static analysis is host-agnostic for BOTH platforms and runs anywhere.
 */
function canRunSessionForPlatform(platform) {
    if (platform === PLATFORM_ANDROID) return true;
    if (platform === PLATFORM_IOS)     return process.platform === 'darwin';
    return false;
}

function sessionUnavailableReason(platform) {
    if (platform === PLATFORM_IOS && process.platform !== 'darwin') {
        return 'iOS test sessions require macOS. Static analysis of the IPA still works on Windows / Linux, but install / log / performance need a Mac with libimobiledevice + Xcode.';
    }
    if (platform === PLATFORM_UNKNOWN) {
        return 'Unknown file type. Supported: .apk (Android), .ipa (iOS).';
    }
    return null;
}

module.exports = {
    PLATFORM_ANDROID,
    PLATFORM_IOS,
    PLATFORM_UNKNOWN,
    detectPlatform,
    canRunSessionForPlatform,
    sessionUnavailableReason
};
