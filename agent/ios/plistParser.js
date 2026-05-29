/**
 * Minimal plist parser supporting BOTH:
 *   1. Binary plist (bplist00) — used in most app bundles for Info.plist
 *   2. XML plist (<?xml … <plist>…</plist>) — used in entitlements,
 *      embedded.mobileprovision payload, and some dev builds
 *
 * Scope is intentionally narrow: we only need to extract the top-level
 * scalar values (string, int, bool, real, date), arrays of scalars, and
 * dictionaries of scalars. Nested-of-nested is supported because Info.plist
 * has a few levels (e.g. NSAppTransportSecurity dict, UIDeviceFamily array).
 *
 * Binary plist format reference:
 *   https://medium.com/@karaiskc/understanding-apples-binary-property-list-format-281e6da00dbd
 *   https://opensource.apple.com/source/CF/CF-1153.18/CFBinaryPList.c.auto.html
 *
 * Pure module — no I/O, no logger calls. parsePlist(buffer | string) returns
 * a plain JS object (or array, depending on root).
 */

const HEADER_BIN = 'bplist00';

function parsePlist(input) {
    if (Buffer.isBuffer(input)) {
        if (input.length >= 8 && input.slice(0, 8).toString('ascii') === HEADER_BIN) {
            return parseBinaryPlist(input);
        }
        // Fall through: assume XML
        return parseXmlPlist(input.toString('utf8'));
    }
    if (typeof input === 'string') return parseXmlPlist(input);
    throw new Error('plistParser: unsupported input type');
}

// ── XML plist ──────────────────────────────────────────────────────────────
// We use a tiny recursive parser tuned for Apple's XML plist shape. No DOM
// parser dependency — Apple's plists are well-formed and use a fixed
// vocabulary, so a streaming-style parse is enough.

function parseXmlPlist(xml) {
    // Strip XML declaration + doctype
    let s = String(xml).replace(/^[\s﻿\xA0]+/, '');
    s = s.replace(/<\?xml[^?]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
    // Get content inside <plist>...</plist>
    const m = s.match(/<plist[^>]*>([\s\S]*)<\/plist>/i);
    const body = (m ? m[1] : s).trim();
    const cursor = { i: 0, s: body };
    return readXmlNode(cursor);
}

function skipXmlWs(c) {
    while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
}

function readXmlNode(c) {
    skipXmlWs(c);
    if (c.i >= c.s.length) return null;
    if (c.s[c.i] !== '<') return null;
    const tagMatch = c.s.slice(c.i).match(/^<(\w+)(\s[^>]*)?(\/?)>/);
    if (!tagMatch) return null;
    const tag = tagMatch[1].toLowerCase();
    const selfClose = tagMatch[3] === '/';
    c.i += tagMatch[0].length;

    if (selfClose) {
        if (tag === 'true') return true;
        if (tag === 'false') return false;
        if (tag === 'dict') return {};
        if (tag === 'array') return [];
        return null;
    }

    switch (tag) {
        case 'true':  closeTag(c, 'true');  return true;
        case 'false': closeTag(c, 'false'); return false;
        case 'string': {
            const text = readUntilClose(c, 'string');
            return decodeXmlEntities(text);
        }
        case 'integer': {
            const text = readUntilClose(c, 'integer').trim();
            return Number(text);
        }
        case 'real': {
            const text = readUntilClose(c, 'real').trim();
            return Number(text);
        }
        case 'date': {
            const text = readUntilClose(c, 'date').trim();
            return text;
        }
        case 'data': {
            const text = readUntilClose(c, 'data').trim();
            return Buffer.from(text.replace(/\s+/g, ''), 'base64');
        }
        case 'dict': {
            const out = {};
            while (true) {
                skipXmlWs(c);
                if (c.s.slice(c.i, c.i + 7).toLowerCase() === '</dict>') { c.i += 7; break; }
                const keyTag = c.s.slice(c.i).match(/^<key>([\s\S]*?)<\/key>/i);
                if (!keyTag) {
                    // Skip stray whitespace or comment
                    c.i++;
                    if (c.i >= c.s.length) break;
                    continue;
                }
                c.i += keyTag[0].length;
                const key = decodeXmlEntities(keyTag[1]).trim();
                const val = readXmlNode(c);
                out[key] = val;
            }
            return out;
        }
        case 'array': {
            const arr = [];
            while (true) {
                skipXmlWs(c);
                if (c.s.slice(c.i, c.i + 8).toLowerCase() === '</array>') { c.i += 8; break; }
                const val = readXmlNode(c);
                if (val === null && (c.i >= c.s.length)) break;
                if (val !== undefined) arr.push(val);
            }
            return arr;
        }
        default: {
            // Unknown element — skip until closing tag
            const closeIdx = c.s.indexOf(`</${tag}>`, c.i);
            if (closeIdx >= 0) c.i = closeIdx + tag.length + 3;
            return null;
        }
    }
}

function closeTag(c, name) {
    const closer = `</${name}>`;
    const idx = c.s.indexOf(closer, c.i);
    if (idx >= 0) c.i = idx + closer.length;
}

function readUntilClose(c, name) {
    const closer = `</${name}>`;
    const idx = c.s.indexOf(closer, c.i);
    if (idx < 0) return '';
    const out = c.s.slice(c.i, idx);
    c.i = idx + closer.length;
    return out;
}

function decodeXmlEntities(s) {
    return String(s)
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g,  (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ── Binary plist (bplist00) ────────────────────────────────────────────────
//
// File layout (Apple CFBinaryPList.c):
//   [0..8]                  "bplist00"
//   [8..end-32]             object table (variable-length tagged objects)
//   [end-32..end-8]         trailer:
//     6 bytes  unused
//     1 byte   sort version (ignored)
//     1 byte   offset int size
//     1 byte   ref int size
//     8 bytes  number of objects (be uint64)
//     8 bytes  top object ref (be uint64)
//     8 bytes  offset of offset table (be uint64)
//   [offsetTableStart..end-32]  offset table — each entry is offset-int-size bytes,
//                              big-endian, pointing at an object in the table.

function parseBinaryPlist(buf) {
    if (buf.length < 40) throw new Error('binary plist too small');
    const trailer = buf.slice(buf.length - 32);
    const offsetIntSize = trailer[6];
    const objectRefSize = trailer[7];
    const numObjects = readUIntBE(trailer, 8, 8);
    const topObject  = readUIntBE(trailer, 16, 8);
    const offsetTblOff = readUIntBE(trailer, 24, 8);

    const offsets = new Array(numObjects);
    for (let i = 0; i < numObjects; i++) {
        offsets[i] = readUIntBE(buf, offsetTblOff + i * offsetIntSize, offsetIntSize);
    }

    function readObject(ref) {
        const off = offsets[ref];
        if (off == null) return null;
        const marker = buf[off];
        const type = marker >> 4;
        const info = marker & 0x0f;
        switch (type) {
            case 0x0: {
                if (info === 0) return null;
                if (info === 8) return false;
                if (info === 9) return true;
                if (info === 15) return null;
                return null;
            }
            case 0x1: {
                // Int: info = log2(byte count). Value follows marker, big endian.
                const byteLen = 1 << info;
                return readUIntBE(buf, off + 1, byteLen);
            }
            case 0x2: {
                // Real
                const byteLen = 1 << info;
                if (byteLen === 4) return buf.readFloatBE(off + 1);
                if (byteLen === 8) return buf.readDoubleBE(off + 1);
                return null;
            }
            case 0x3: {
                // Date — 8 bytes float seconds since 2001-01-01 UTC
                const seconds = buf.readDoubleBE(off + 1);
                return new Date(978307200000 + seconds * 1000);
            }
            case 0x4: {
                // Data (raw bytes). Length = info, or extended length follows.
                const { length, headerEnd } = readLength(buf, off, info);
                return buf.slice(headerEnd, headerEnd + length);
            }
            case 0x5: {
                // ASCII string
                const { length, headerEnd } = readLength(buf, off, info);
                return buf.slice(headerEnd, headerEnd + length).toString('utf8');
            }
            case 0x6: {
                // UTF-16-BE string
                const { length, headerEnd } = readLength(buf, off, info);
                return buf.slice(headerEnd, headerEnd + length * 2).swap16().toString('utf16le');
            }
            case 0x8: {
                // UID — value follows marker (info + 1 bytes)
                return { CFKeyedArchiverUID: readUIntBE(buf, off + 1, info + 1) };
            }
            case 0xa: {
                // Array of refs
                const { length, headerEnd } = readLength(buf, off, info);
                const out = [];
                for (let i = 0; i < length; i++) {
                    const r = readUIntBE(buf, headerEnd + i * objectRefSize, objectRefSize);
                    out.push(readObject(r));
                }
                return out;
            }
            case 0xc: {
                // Set of refs — treat as array
                const { length, headerEnd } = readLength(buf, off, info);
                const out = [];
                for (let i = 0; i < length; i++) {
                    const r = readUIntBE(buf, headerEnd + i * objectRefSize, objectRefSize);
                    out.push(readObject(r));
                }
                return out;
            }
            case 0xd: {
                // Dict — n key refs followed by n value refs
                const { length, headerEnd } = readLength(buf, off, info);
                const keyRefStart = headerEnd;
                const valRefStart = headerEnd + length * objectRefSize;
                const out = {};
                for (let i = 0; i < length; i++) {
                    const kr = readUIntBE(buf, keyRefStart + i * objectRefSize, objectRefSize);
                    const vr = readUIntBE(buf, valRefStart + i * objectRefSize, objectRefSize);
                    const k = readObject(kr);
                    const v = readObject(vr);
                    if (k != null) out[String(k)] = v;
                }
                return out;
            }
            default:
                return null;
        }
    }

    function readLength(b, off, info) {
        if (info < 0x0f) {
            return { length: info, headerEnd: off + 1 };
        }
        // Extended length: next byte is "1F" then a marker 0x10..0x13 giving log2(byteCount)
        const lenMarker = b[off + 1];
        const lenByteCount = 1 << (lenMarker & 0x0f);
        const length = readUIntBE(b, off + 2, lenByteCount);
        return { length, headerEnd: off + 2 + lenByteCount };
    }

    return readObject(topObject);
}

function readUIntBE(b, off, len) {
    let v = 0;
    for (let i = 0; i < len; i++) {
        v = v * 256 + b[off + i];
    }
    return v;
}

module.exports = { parsePlist, parseBinaryPlist, parseXmlPlist };
