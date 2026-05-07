// Per-project state for the QA Checklist tab.
// State shape: { itemId: { status: 'pass'|'fail'|'pending', notes: '', ts: <ms> } }
// Stored at projects/<name>/qa-checklist.json so it travels with the project.

const fs = require('fs');
const path = require('path');
const projectManager = require('./projectManager');
const { buildTemplate, totalItemCount } = require('../data/qaChecklistTemplate');
const logger = require('../utils/logger');

const VALID_STATUSES = new Set(['pass', 'fail', 'pending']);

function statePath(projectName) {
    return path.join(projectManager.getProjectPath(projectName), 'qa-checklist.json');
}

function readState(projectName) {
    const p = statePath(projectName);
    if (!fs.existsSync(p)) return {};
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        return (raw && typeof raw === 'object') ? raw : {};
    } catch (err) {
        logger.logError(`QA checklist read failed: ${err.message}`);
        return {};
    }
}

function writeState(projectName, state) {
    const p = statePath(projectName);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

// Returns the merged template + state. Items missing from saved state default
// to 'pending'. Unknown ids in saved state are ignored (e.g. after a template
// update that removes an item).
function getChecklist(projectName) {
    const template = buildTemplate();
    if (!projectName) {
        return { sections: template, state: {}, totals: emptyTotals(template) };
    }
    const state = readState(projectName);
    const totals = computeTotals(template, state);
    return { sections: template, state, totals };
}

function setItemStatus(projectName, itemId, status, notes) {
    if (!projectName) return { success: false, error: 'No active project.' };
    if (!itemId) return { success: false, error: 'itemId required.' };
    if (!VALID_STATUSES.has(status)) return { success: false, error: `invalid status: ${status}` };

    if (!isKnownItem(itemId)) {
        return { success: false, error: `unknown item: ${itemId}` };
    }

    const state = readState(projectName);
    if (status === 'pending') {
        delete state[itemId];
    } else {
        state[itemId] = {
            status,
            notes: typeof notes === 'string' ? notes : (state[itemId]?.notes || ''),
            ts: Date.now()
        };
    }
    writeState(projectName, state);
    return { success: true };
}

// Bulk-apply a status to a list of itemIds. Used by Pass-All-Visible /
// Fail-All-Visible / per-section Pass All. Items not in the template are
// silently skipped so the UI can pass whatever set it has rendered.
function bulkSetStatus(projectName, itemIds, status) {
    if (!projectName) return { success: false, error: 'No active project.' };
    if (!Array.isArray(itemIds)) return { success: false, error: 'itemIds must be an array.' };
    if (!VALID_STATUSES.has(status)) return { success: false, error: `invalid status: ${status}` };

    const state = readState(projectName);
    const known = knownItemIdSet();
    const ts = Date.now();
    let changed = 0;
    for (const id of itemIds) {
        if (!known.has(id)) continue;
        if (status === 'pending') {
            if (state[id]) { delete state[id]; changed++; }
        } else {
            state[id] = { status, notes: state[id]?.notes || '', ts };
            changed++;
        }
    }
    writeState(projectName, state);
    return { success: true, changed };
}

function resetAll(projectName) {
    if (!projectName) return { success: false, error: 'No active project.' };
    writeState(projectName, {});
    return { success: true };
}

// Build a portable JSON report of the current state. The renderer wires this
// to the "export report" button and writes it to a user-chosen file.
function exportReport(projectName) {
    const { sections, state, totals } = getChecklist(projectName);
    const sectionsOut = sections.map(section => ({
        id: section.id,
        title: section.title,
        icon: section.icon,
        items: section.items.map(item => ({
            id: item.id,
            label: item.label,
            status: state[item.id]?.status || 'pending',
            notes: state[item.id]?.notes || '',
            ts: state[item.id]?.ts || null
        }))
    }));
    return {
        project: projectName,
        generatedAt: new Date().toISOString(),
        totals,
        sections: sectionsOut
    };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isKnownItem(itemId) {
    return knownItemIdSet().has(itemId);
}

let _idCache = null;
function knownItemIdSet() {
    if (_idCache) return _idCache;
    const set = new Set();
    for (const section of buildTemplate()) {
        for (const item of section.items) set.add(item.id);
    }
    _idCache = set;
    return set;
}

function emptyTotals(template) {
    const total = template.reduce((n, s) => n + s.items.length, 0);
    return { total, passed: 0, failed: 0, pending: total, progressPct: 0 };
}

function computeTotals(template, state) {
    const total = template.reduce((n, s) => n + s.items.length, 0);
    let passed = 0, failed = 0;
    for (const v of Object.values(state)) {
        if (v?.status === 'pass') passed++;
        else if (v?.status === 'fail') failed++;
    }
    const decided = passed + failed;
    const pending = Math.max(0, total - decided);
    const progressPct = total === 0 ? 0 : Math.round((decided / total) * 100);
    return { total, passed, failed, pending, progressPct };
}

module.exports = {
    getChecklist,
    setItemStatus,
    bulkSetStatus,
    resetAll,
    exportReport,
    totalItemCount
};
