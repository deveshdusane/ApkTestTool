/**
 * History Manager Utility
 * Handles persistent storage of QA reports grouped by project.
 */

const path = require('path');
const logger = require('../utils/logger');
const projectManager = require('../manager/projectManager');

function getHistoryFilePath(projectName) {
    return path.join(projectManager.getReportsPath(projectName), 'history.json');
}

/**
 * Saves the current session report to the project's history.
 * @param {string} sessionId 
 * @param {Object} reportData 
 * @param {string} projectName
 */
const saveToHistory = (sessionId, reportData, projectName = 'default') => {
    const entry = {
        sessionId,
        projectName,
        timestamp: reportData.timestamp,
        apkName: reportData.apkName || 'N/A',
        packageName: reportData.packageName || reportData.apkInfo?.packageName || 'N/A',
        duration: reportData.duration,
        metrics: reportData.metrics,
        summary: reportData.summary,
        summaryText: reportData.summaryText || (typeof reportData.summary === 'string' ? reportData.summary : ''),
        crash: reportData.summary?.crash ?? reportData.checklist?.crash === 'FAIL',
        anr: reportData.summary?.anr ?? reportData.checklist?.anr === 'FAIL'
    };

    projectManager.appendHistory(projectName, entry);
    logger.logSuccess('Metrics calculated and Report enhanced');
};

/**
 * Returns all history entries for a given project.
 * @param {string} projectName 
 */
const getProjectHistory = (projectName) => {
    return projectManager.getHistory(projectName);
};

/**
 * Removes a session entry from history.json.
 */
const removeFromHistory = (projectName, sessionId) => {
    projectManager.removeFromHistory(projectName, sessionId);
};

module.exports = {
    saveToHistory,
    getProjectHistory,
    removeFromHistory
};
