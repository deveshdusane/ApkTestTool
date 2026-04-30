'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_DIR = path.join(os.homedir(), '.testmate');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

let _cache = null;

function _load() {
    if (_cache) return _cache;
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            _cache = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    _cache = _cache || {};
    return _cache;
}

function _save() {
    try {
        if (!fs.existsSync(SETTINGS_DIR)) {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        }
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_cache, null, 2), 'utf8');
    } catch (e) {}
}

function get(key, defaultValue = null) {
    const data = _load();
    return data[key] !== undefined ? data[key] : defaultValue;
}

function set(key, value) {
    _load();
    _cache[key] = value;
    _save();
}

module.exports = { get, set };
