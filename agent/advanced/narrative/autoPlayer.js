/**
 * Auto-Player — drive a narrative game and capture every dialog frame.
 *
 * Increment 3 of the Narrative Auto-Test feature. Presses "Next" to walk the
 * story, screenshots each frame, OCRs the dialog band, and detects whether the
 * tap actually advanced the screen (frame-diff). When the screen stops changing
 * it treats the frame as a choice point and taps a calibrated choice slot.
 *
 * GENERIC across games via a per-game calibration PROFILE (all coords are 0..1
 * fractions of the screen, so they survive any resolution):
 *   { next:{x,y}, dialogRegion:{x,y,w,h}, choices:[{x,y}...] }
 *
 * Reuses the shared serialized ADB queue (adbHelper) — taps and the binary
 * screencap stream go through the same lock as the rest of the app, so this
 * never collides with logcat/dumpsys running in a live session.
 */

const Jimp = require('jimp');
const adbHelper = require('../../adb/adbHelper');
const ocr = require('./dialogOcr');

const delay = ms => new Promise(r => setTimeout(r, ms));

// Tell real dialog prose apart from OCR noise read off a 3D scene / minigame.
// Real lines have several proper word-shaped tokens; garbage is single chars,
// symbols and nonsense ("Bv ///Se lW Nq"). Requires >= 3 word-like tokens.
function looksLikeProse(text) {
    const t = String(text || '').trim();
    if (t.length < 8) return false;
    const realWords = t.split(/\s+/).filter(w => /^[A-Za-z][a-z]{2,}$/.test(w)).length;
    return realWords >= 3;
}

let _size = null; // cached screen size

// ── Device primitives ────────────────────────────────────────────────────────
async function getScreenSize(force = false) {
    if (_size && !force) return _size;
    const out = await adbHelper.runADB(['shell', 'wm', 'size']);
    // Prefer an override size if present, else physical.
    const over = out.match(/Override size:\s*(\d+)x(\d+)/i);
    const phys = out.match(/Physical size:\s*(\d+)x(\d+)/i);
    const any  = out.match(/(\d+)x(\d+)/);
    const m = over || phys || any;
    _size = m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
    return _size;
}

// Capture the current frame as a PNG Buffer (binary-safe via spawn stdout).
function screencap(timeout = 8000) {
    return new Promise((resolve, reject) => {
        const proc = adbHelper.spawnCommand(['exec-out', 'screencap', '-p']);
        if (!proc) return reject(new Error('ADB binary not available.'));
        const chunks = [];
        const to = setTimeout(() => { try { proc.kill(); } catch (_) {} reject(new Error('screencap timed out')); }, timeout);
        proc.stdout.on('data', d => chunks.push(d));
        proc.on('error', e => { clearTimeout(to); reject(e); });
        proc.on('close', () => { clearTimeout(to); resolve(Buffer.concat(chunks)); });
    });
}

async function tapFraction(fx, fy, size) {
    const s = size || await getScreenSize();
    const px = Math.round(fx * s.w), py = Math.round(fy * s.h);
    await adbHelper.runADB(['shell', 'input', 'tap', String(px), String(py)]);
    return { px, py };
}

// Fraction of pixels that changed between two frames (downscaled greyscale).
// Used to decide whether a Next-tap actually advanced the screen.
async function frameDiff(bufA, bufB) {
    const [a, b] = await Promise.all([Jimp.read(bufA), Jimp.read(bufB)]);
    a.resize(48, Jimp.AUTO).greyscale();
    b.resize(48, Jimp.AUTO).greyscale();
    const w = Math.min(a.bitmap.width, b.bitmap.width);
    const h = Math.min(a.bitmap.height, b.bitmap.height);
    if (w === 0 || h === 0) return 1;
    let diff = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const pa = Jimp.intToRGBA(a.getPixelColor(x, y)).r;
            const pb = Jimp.intToRGBA(b.getPixelColor(x, y)).r;
            if (Math.abs(pa - pb) > 24) diff++;
        }
    }
    return diff / (w * h);
}

// ── Auto-play loop ────────────────────────────────────────────────────────────
/**
 * Walk the story by tapping Next, capturing + OCR-ing each frame.
 *
 * @param {object} profile  { next:{x,y}, dialogRegion:{x,y,w,h}, choices:[{x,y}] }
 * @param {object} [opts]
 * @param {number} [opts.steps=40]      max frames to capture
 * @param {number} [opts.settleMs=800]  wait after a tap before re-capturing
 * @param {boolean}[opts.ocr=true]      OCR each frame's dialog band
 * @param {number} [opts.changeThresh=0.02]  min frame-diff to count as advanced
 * @param {function}[opts.onStep]       called with each frame record (for live UI)
 * @param {function}[opts.shouldStop]   return true to abort the run early
 */
async function runAutoPlay(profile, opts = {}) {
    if (!profile || !profile.next) return { ok: false, error: 'No calibration profile — set the Next button first.' };
    const steps   = opts.steps || 40;
    const settle  = opts.settleMs || 800;
    const doOcr   = opts.ocr !== false;
    const thresh  = opts.changeThresh != null ? opts.changeThresh : 0.02;
    const onStep  = typeof opts.onStep === 'function' ? opts.onStep : () => {};
    const region  = profile.dialogRegion || ocr.DEFAULT_DIALOG_REGION;
    const size    = await getScreenSize(true);

    const frames = [];
    let prev = await screencap();

    try {
        for (let i = 0; i < steps; i++) {
            if (opts.shouldStop && opts.shouldStop()) break;

            const rec = { step: i + 1, lines: [], text: '', advanced: false, noDialog: false };
            if (doOcr) {
                try {
                    const r = await ocr.ocrImage(prev, { region, psm: 6 });
                    // Keep only prose-like lines — drops noise OCR'd off minigame /
                    // cutscene / 3D-scene frames that carry no dialog text.
                    rec.lines = (r.lines || []).filter(l => looksLikeProse(l.text));
                    rec.text = rec.lines.map(l => l.text).join(' ');
                    rec.meanConfidence = r.meanConfidence;
                    rec.noDialog = rec.lines.length === 0;
                } catch (_) { /* leave empty on OCR failure */ }
            }

            // Tap Next, settle, re-capture.
            await tapFraction(profile.next.x, profile.next.y, size);
            await delay(settle);
            let cur = await screencap();
            let change = await frameDiff(prev, cur);

            if (change <= thresh) {
                // The primary Next didn't move the screen. Could be:
                //   - a day-end / transition screen with a DIFFERENT button
                //     ("Start Next Day", "Completed → NEXT") at another position
                //   - a choice point waiting for a choice
                // Try, in order: calibrated continue buttons → choice slots →
                // a generic center-column sweep (catches any centred bottom button
                // even if it wasn't calibrated). First tap that advances wins.
                const sweep = [0.80, 0.84, 0.88, 0.92].map(y => ({ pt: { x: 0.5, y }, kind: 'continue' }));
                const candidates = [].concat(
                    (profile.extraButtons || []).map(b => ({ pt: b, kind: 'continue' })),
                    (profile.choices || []).map(b => ({ pt: b, kind: 'choice' })),
                    sweep
                );
                let recoveredCap = null, recoveredKind = null;
                for (const cand of candidates) {
                    await tapFraction(cand.pt.x, cand.pt.y, size);
                    await delay(settle);
                    const c2 = await screencap();
                    if (await frameDiff(prev, c2) > thresh) { recoveredCap = c2; recoveredKind = cand.kind; break; }
                }
                if (recoveredCap) {
                    rec.advanced = true;
                    if (recoveredKind === 'choice') rec.tookChoice = true; else rec.tookContinue = true;
                    frames.push(rec); onStep(rec);
                    prev = recoveredCap; continue;
                }
                rec.stuck = true;        // genuinely blocked / end of content
                frames.push(rec); onStep(rec);
                break;
            }

            rec.advanced = true;
            frames.push(rec); onStep(rec);
            prev = cur;
        }
    } finally {
        // keep the OCR worker warm across runs; caller terminates on shutdown
    }

    return {
        ok: true,
        steps: frames.length,
        advanced: frames.filter(f => f.advanced).length,
        stuckAt: (frames.find(f => f.stuck) || {}).step || null,
        frames
    };
}

module.exports = { getScreenSize, screencap, tapFraction, frameDiff, runAutoPlay };
