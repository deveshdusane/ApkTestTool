/**
 * Dialog OCR — read on-screen text from a game frame.
 *
 * Increment 2 of the Narrative Auto-Test feature. Unity draws dialog onto a
 * single SurfaceView that uiautomator cannot read, so the ONLY way to verify
 * that a scripted line actually appears in-game is to screenshot the frame and
 * OCR it. This module is that reader.
 *
 *   preprocess (jimp)  →  recognize (tesseract.js WASM)  →  { text, lines, conf }
 *
 * Generic across games: the caller passes an optional `region` (fractions of the
 * frame) to crop to the dialog band and skip the 3D scene/HUD — cropping is the
 * single biggest accuracy win, because Tesseract chokes on rendered 3D art.
 *
 * Pure-JS deps (tesseract.js + jimp) — no native build, runs on Windows/Mac.
 * The worker is lazy-created and kept warm; call terminate() when done.
 */

const path = require('path');
const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');

// Persist the downloaded language model so it's fetched once, then reused
// offline (matters on locked-down office networks).
const CACHE_PATH = path.join(__dirname, '.tesseract-cache');

let _worker = null;
let _workerPromise = null;

// Lazy singleton worker. First call downloads eng.traineddata into CACHE_PATH
// (~10 MB, once); subsequent calls reuse it.
async function getWorker() {
    if (_worker) return _worker;
    if (!_workerPromise) {
        _workerPromise = createWorker('eng', 1, {
            cachePath: CACHE_PATH,
            logger: () => {},      // silence progress spam
            errorHandler: () => {}
        }).then(w => { _worker = w; return w; });
    }
    return _workerPromise;
}

async function terminate() {
    try { if (_worker) await _worker.terminate(); } catch (_) { /* ignore */ }
    _worker = null; _workerPromise = null;
}

/**
 * Preprocess a frame for OCR: optional crop to a region, greyscale, contrast
 * boost, and upscale small frames. Returns a PNG Buffer ready for recognize().
 *
 * @param {string|Buffer} input  image path or raw image buffer
 * @param {object} [region]      {x,y,w,h} as 0..1 fractions of the frame
 */
async function preprocess(input, region) {
    const img = await Jimp.read(input);
    if (region) {
        const W = img.bitmap.width, H = img.bitmap.height;
        const x = Math.max(0, Math.round((region.x || 0) * W));
        const y = Math.max(0, Math.round((region.y || 0) * H));
        const w = Math.min(W - x, Math.round((region.w || 1) * W));
        const h = Math.min(H - y, Math.round((region.h || 1) * H));
        if (w > 0 && h > 0) img.crop(x, y, w, h);
    }
    // Upscale narrow crops — Tesseract likes ~30px cap height.
    if (img.bitmap.width < 1000) img.scale(Math.min(3, 1000 / img.bitmap.width));
    img.greyscale().contrast(0.35).normalize();
    return img.getBufferAsync(Jimp.MIME_PNG);
}

/**
 * OCR a frame (or a region of it). Returns recognized text plus per-line
 * text + confidence + bounding boxes.
 *
 * @param {string|Buffer} input
 * @param {object} [opts]
 * @param {object} [opts.region] {x,y,w,h} fractions — crop before OCR
 * @param {number} [opts.psm]    page-seg mode (6 = uniform block, 11 = sparse)
 * @param {boolean} [opts.raw]   if true, skip preprocessing (OCR input as-is)
 */
async function ocrImage(input, opts = {}) {
    const worker = await getWorker();
    const psm = String(opts.psm != null ? opts.psm : (opts.region ? 6 : 11));
    await worker.setParameters({ tessedit_pageseg_mode: psm });

    const buf = opts.raw ? input : await preprocess(input, opts.region);
    const { data } = await worker.recognize(buf);

    const lines = (data.lines || [])
        .map(l => ({
            text: (l.text || '').trim(),
            confidence: Math.round(l.confidence || 0),
            bbox: l.bbox || null
        }))
        .filter(l => l.text.length > 0);

    return {
        text: (data.text || '').trim(),
        meanConfidence: Math.round(data.confidence || 0),
        lines,
        words: (data.words || []).length
    };
}

// Default dialog band for portrait phone games: the lower ~40% holds the
// dialog/choice boxes. Starts at 60% to skip the top HUD/stats bar (Health/
// Reputation/Power), which otherwise gets OCR'd as the first line. Callers
// should override per game via the calibrated dialogRegion.
const DEFAULT_DIALOG_REGION = { x: 0.0, y: 0.6, w: 1.0, h: 0.38 };

module.exports = { ocrImage, preprocess, getWorker, terminate, DEFAULT_DIALOG_REGION };
