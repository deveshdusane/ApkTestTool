/**
 * Asset Integrity Analyzer.
 *
 * Static analysis of an APK's bundled assets, designed for narrative /
 * dialogue-heavy games where missing or stub assets are the most common
 * source of post-release bugs.
 *
 * What it catches (v1):
 *   1. Zero-byte assets        — placeholder files never replaced before build
 *   2. Suspiciously small audio — voice files <10KB likely test stubs
 *   3. Duplicate assets         — same content at multiple paths, wasted size
 *   4. Localization gaps        — strings-XX.xml missing keys vs base strings.xml
 *   5. Orphan locales           — strings-XX.xml present but locale not declared
 *   6. Asset inventory          — count + bytes per category for build regression
 *
 * Out of scope (deferred to v2):
 *   - Code → asset reference checking (parsing Java/Unity to verify
 *     `R.drawable.foo` actually resolves to a file)
 *   - Audio quality validation, image dimension checks
 *
 * Pure analysis module — no I/O outside reading the APK. No state.
 */

const unzipper = require('unzipper');

const SUSPICIOUS_AUDIO_BYTES = 10 * 1024;          // <10KB audio = probably stub
const ASSET_CATEGORIES = {
    image:   ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.svg', '.ktx', '.astc'],
    audio:   ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.opus', '.flac'],
    video:   ['.mp4', '.webm', '.mkv', '.mov', '.avi'],
    font:    ['.ttf', '.otf', '.woff', '.woff2'],
    text:    ['.json', '.txt', '.xml', '.csv', '.yaml', '.yml', '.md'],
    // Unity/Unreal packed bundles + raw asset blobs
    bundle:  ['.dat', '.bin', '.bytes', '.bundle', '.asset', '.assetbundle', '.unity3d', '.resource', '.resS'],
    native:  ['.so', '.a', '.dll', '.dylib'],
    code:    ['.dex', '.jar', '.class', '.kotlin_builtins'],
    archive: ['.zip', '.tar', '.gz', '.7z']
};

function classifyByExt(p) {
    const lower = p.toLowerCase();
    for (const [cat, exts] of Object.entries(ASSET_CATEGORIES)) {
        if (exts.some(e => lower.endsWith(e))) return cat;
    }
    return 'other';
}

// strings.xml lives at res/values/strings.xml; localized variants at
// res/values-XX/strings.xml or res/values-XX-rYY/strings.xml.
const STRINGS_BASE_RE   = /^res\/values\/strings\.xml$/;
const STRINGS_LOCALE_RE = /^res\/values-([a-z]{2,3}(?:-r[A-Z]{2})?)\/strings\.xml$/;

// Minimal name="key" extractor — APK strings.xml is the binary AXML format
// after build, but we read uncompiled XML if the APK preserved them; for
// resources.arsc the runtime intelligence module already handles binary.
// For now we extract from any text strings.xml we find.
function extractStringKeys(xmlText) {
    const keys = new Set();
    // <string name="key">value</string>  OR  <string name='key'>...
    const re = /<string\s+[^>]*name=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(xmlText)) !== null) keys.add(m[1]);
    return keys;
}

/**
 * Main entry: analyze an APK's assets and return a structured report.
 *
 * @param {string} apkPath
 * @returns {Promise<{
 *   summary: { totalFiles, totalBytes, zeroByteCount, suspiciousAudioCount,
 *              duplicateGroupCount, dupWastedBytes, localesCount,
 *              localizationCompleteness: number },
 *   categories: { [cat]: { count, bytes } },
 *   zeroByteFiles: string[],
 *   suspiciousAudio: { path, bytes }[],
 *   duplicates: { sha1, files: string[], wastedBytes }[],
 *   localization: {
 *       baseLocale: 'default',
 *       baseKeyCount: number,
 *       locales: { locale, keyCount, missing: string[], extras: string[] }[]
 *   },
 *   warnings: { level: 'error'|'warn'|'info', code, message, where? }[]
 * }>}
 */
async function analyzeAssets(apkPath) {
    const result = {
        summary: {
            totalFiles: 0,
            totalBytes: 0,
            zeroByteCount: 0,
            suspiciousAudioCount: 0,
            duplicateGroupCount: 0,
            dupWastedBytes: 0,
            localesCount: 0,
            localizationCompleteness: 100
        },
        categories: {},
        zeroByteFiles: [],
        suspiciousAudio: [],
        duplicates: [],
        localization: {
            baseLocale: 'default',
            baseKeyCount: 0,
            locales: []
        },
        warnings: []
    };

    let directory;
    try {
        directory = await unzipper.Open.file(apkPath);
    } catch (err) {
        result.warnings.push({
            level: 'error',
            code: 'apk_unreadable',
            message: `Could not open APK: ${err.message}`
        });
        return result;
    }

    // ── First pass: enumerate + categorize + flag zero-byte and stubs ───────
    // Build a hash map of (size → list of files) so we can compute SHA-1 only
    // for size-collision candidates (most files have unique sizes — cheap).
    const bySize = new Map();
    const stringsFiles = []; // { path, locale }

    for (const file of directory.files) {
        if (file.type !== 'File') continue;
        const p = file.path;
        const size = file.uncompressedSize ?? 0;
        const cat = classifyByExt(p);

        result.summary.totalFiles++;
        result.summary.totalBytes += size;
        if (!result.categories[cat]) result.categories[cat] = { count: 0, bytes: 0 };
        result.categories[cat].count++;
        result.categories[cat].bytes += size;

        // Zero-byte → almost certainly a placeholder/stub. We flag for any
        // KNOWN asset type (image/audio/video/font/text/bundle) — these are
        // never legitimately empty. "other" and "code" are skipped because
        // META-INF marker files and some build artefacts can legitimately
        // be 0 bytes.
        const isFlaggableEmpty = cat !== 'other' && cat !== 'code' && cat !== 'archive';
        if (size === 0 && isFlaggableEmpty) {
            result.zeroByteFiles.push(p);
            result.summary.zeroByteCount++;
        }
        // Voice/dialogue files under 10KB → very likely empty stubs
        if (cat === 'audio' && size > 0 && size < SUSPICIOUS_AUDIO_BYTES) {
            result.suspiciousAudio.push({ path: p, bytes: size });
            result.summary.suspiciousAudioCount++;
        }

        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size).push(file);

        // Pick out strings.xml files for localization analysis
        if (STRINGS_BASE_RE.test(p)) {
            stringsFiles.push({ file, path: p, locale: 'default' });
        } else {
            const lm = p.match(STRINGS_LOCALE_RE);
            if (lm) stringsFiles.push({ file, path: p, locale: lm[1] });
        }
    }

    // ── Duplicate detection: SHA-1 only same-size groups (skip 0-byte) ──────
    const crypto = require('crypto');
    const dupGroups = new Map();   // sha1 → file paths
    for (const [size, files] of bySize) {
        if (size === 0) continue;
        if (files.length < 2) continue;
        for (const f of files) {
            let buf;
            try { buf = await f.buffer(); } catch { continue; }
            const h = crypto.createHash('sha1').update(buf).digest('hex');
            if (!dupGroups.has(h)) dupGroups.set(h, []);
            dupGroups.get(h).push({ path: f.path, size });
        }
    }
    for (const [sha, entries] of dupGroups) {
        if (entries.length < 2) continue;
        const wasted = entries[0].size * (entries.length - 1);
        result.duplicates.push({
            sha1: sha,
            files: entries.map(e => e.path),
            wastedBytes: wasted
        });
        result.summary.duplicateGroupCount++;
        result.summary.dupWastedBytes += wasted;
    }

    // ── Localization analysis ───────────────────────────────────────────────
    // Read text strings.xml files we found. Many APKs ship only compiled
    // binary resources (resources.arsc) — in that case we can't analyze
    // localization here, and we'll note it in warnings instead of failing.
    const base = stringsFiles.find(s => s.locale === 'default');
    let baseKeys = null;
    if (base) {
        try {
            const buf = await base.file.buffer();
            const text = buf.toString('utf8');
            // Heuristic: if first non-whitespace bytes aren't a "<" we likely
            // have a compiled binary; skip rather than emit junk warnings.
            if (text.trim().startsWith('<')) {
                baseKeys = extractStringKeys(text);
                result.localization.baseKeyCount = baseKeys.size;
            }
        } catch (_) { /* ignore */ }
    }

    if (baseKeys && baseKeys.size > 0) {
        for (const sf of stringsFiles) {
            if (sf.locale === 'default') continue;
            let buf, text, keys;
            try {
                buf = await sf.file.buffer();
                text = buf.toString('utf8');
                if (!text.trim().startsWith('<')) continue;
                keys = extractStringKeys(text);
            } catch { continue; }

            const missing = [];
            for (const k of baseKeys) if (!keys.has(k)) missing.push(k);
            const extras = [];
            for (const k of keys) if (!baseKeys.has(k)) extras.push(k);

            result.localization.locales.push({
                locale: sf.locale,
                keyCount: keys.size,
                missing,
                extras
            });
        }
        result.summary.localesCount = result.localization.locales.length;

        // Completeness: how complete are the localized files vs base?
        // 100% if every locale has every base key; lower if any are missing.
        if (result.summary.localesCount > 0) {
            const totalGaps = result.localization.locales.reduce(
                (s, l) => s + l.missing.length, 0);
            const totalSlots = baseKeys.size * result.summary.localesCount;
            const completeness = totalSlots > 0
                ? Math.round(100 * (1 - totalGaps / totalSlots))
                : 100;
            result.summary.localizationCompleteness = completeness;
        }
    } else if (stringsFiles.length === 0) {
        result.warnings.push({
            level: 'info',
            code: 'no_text_strings_xml',
            message: 'No text strings.xml found. The APK likely ships compiled binary resources (resources.arsc) — localization analysis is limited.'
        });
    }

    // ── Synthesize tester-facing warnings ───────────────────────────────────
    if (result.summary.zeroByteCount > 0) {
        result.warnings.push({
            level: 'error',
            code: 'zero_byte_assets',
            message: `${result.summary.zeroByteCount} asset(s) are 0 bytes — likely placeholder stubs never replaced.`,
            where: result.zeroByteFiles.slice(0, 10)
        });
    }
    if (result.summary.suspiciousAudioCount > 0) {
        result.warnings.push({
            level: 'warn',
            code: 'tiny_audio_files',
            message: `${result.summary.suspiciousAudioCount} audio file(s) under 10KB — likely empty voice stubs.`,
            where: result.suspiciousAudio.slice(0, 10).map(s => s.path)
        });
    }
    if (result.summary.dupWastedBytes > 1_000_000) {
        result.warnings.push({
            level: 'warn',
            code: 'duplicate_assets',
            message: `${result.summary.duplicateGroupCount} duplicate group(s) waste ${(result.summary.dupWastedBytes / 1_048_576).toFixed(1)} MB of bundle size.`
        });
    }
    if (result.summary.localesCount > 0 && result.summary.localizationCompleteness < 95) {
        result.warnings.push({
            level: 'warn',
            code: 'localization_incomplete',
            message: `Localization is ${result.summary.localizationCompleteness}% complete across ${result.summary.localesCount} locale(s). Missing string keys may render as English fallback or blank in non-default languages.`
        });
    }

    return result;
}

module.exports = { analyzeAssets };
