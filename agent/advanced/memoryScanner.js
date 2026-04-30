const adbHelper = require('../adb/adbHelper');
const sdkIntelligence = require('./sdkIntelligence');

const MAX_REGION_BYTES = 8 * 1024 * 1024;  // scan up to 8MB per region
const MAX_REGIONS      = 20;               // scan at most 20 regions

// Parse /proc/<pid>/maps and return writable heap / anonymous regions
function parseMaps(mapsText) {
    const regions = [];
    for (const line of mapsText.split('\n')) {
        const m = line.match(/^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+\S+\s+\S+\s+\d+\s*(.*)$/i);
        if (!m) continue;
        const start = parseInt(m[1], 16);
        const end   = parseInt(m[2], 16);
        const perms = m[3];
        const name  = m[4].trim();
        const size  = end - start;
        // Only writable, non-file-backed regions that are likely heap / JVM allocations
        const isHeap = name === '[heap]'
            || name === ''
            || name.startsWith('[anon:dalvik')
            || name.startsWith('[anon:libc_malloc')
            || name.startsWith('[anon:');
        const isWritable = perms.includes('w');
        const okSize = size > 0 && size <= MAX_REGION_BYTES;
        if (isHeap && isWritable && okSize) regions.push({ start, end, size });
    }
    return regions;
}

/**
 * Scan the live process heap of a debuggable APK for SDK keys.
 *
 * Returns: number of NEW keys found, or -1 if app is not debuggable.
 */
async function scanMemory(deviceId, packageName, pid, sdkIntel) {
    if (!deviceId || !packageName || !pid || !sdkIntel) return 0;

    // --- Step 1: Read /proc/<pid>/maps ---
    let mapsText;
    try {
        mapsText = await adbHelper.runADB(
            ['-s', deviceId, 'shell', `run-as ${packageName} cat /proc/${pid}/maps`],
            { timeout: 8000 }
        );
    } catch (e) {
        return 0;
    }

    if (!mapsText || !mapsText.trim()) return 0;

    // Detect non-debuggable build
    if (mapsText.includes('not debuggable') || mapsText.includes('Package') && mapsText.includes('unknown')) {
        return -1;
    }

    const regions = parseMaps(mapsText);
    if (!regions.length) return 0;

    // --- Step 2: Dump each region through `strings`, scan for SDK key patterns ---
    let newKeys = 0;

    for (const region of regions.slice(0, MAX_REGIONS)) {
        const skipPages  = Math.floor(region.start / 4096);
        const countPages = Math.ceil(region.size  / 4096);

        let stringsOut;
        try {
            stringsOut = await adbHelper.runADB(
                ['-s', deviceId, 'shell',
                 `run-as ${packageName} sh -c 'dd if=/proc/${pid}/mem bs=4096 skip=${skipPages} count=${countPages} 2>/dev/null | strings -n 8'`
                ],
                { timeout: 15000 }
            );
        } catch (e) {
            continue;
        }

        if (!stringsOut || !stringsOut.trim()) continue;

        const before = sdkIntel.keys.length;
        sdkIntelligence.scanTextForKeys(sdkIntel, stringsOut, 'memory');
        newKeys += sdkIntel.keys.length - before;
    }

    return newKeys;
}

module.exports = { scanMemory, parseMaps };
