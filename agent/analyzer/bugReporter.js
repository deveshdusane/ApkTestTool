/**
 * Bug Reporter Utility
 * Converts technical log issues into human-readable bug reports using templates.
 */

const BUG_TEMPLATES = {
    'Crash': {
        title: 'Application Crash Detected',
        description: 'The application encountered a fatal exception and was forced to close.',
        steps: [
            'Launch the application',
            'Perform typical user interactions',
            'Observe forced closure or ANR'
        ],
        expected: 'The application should remain stable and responsive.',
        actual: 'Application crashed or became non-responsive (ANR).'
    },
    'Network': {
        title: 'Network Communication Failure',
        description: 'Detected failures or timeouts during network requests.',
        steps: [
            'Ensure device has internet connectivity',
            'Perform actions requiring server data',
            'Check for data loading failures'
        ],
        expected: 'Network requests should complete successfully and return data.',
        actual: 'Network requests failed or exceeded timeout limit.'
    },
    'UI': {
        title: 'UI Rendering / View Error',
        description: 'Errors detected in the UI hierarchy or view rendering process.',
        steps: [
            'Navigate through different app screens',
            'Observe UI elements and layouts',
            'Check for missing or incorrectly rendered views'
        ],
        expected: 'UI should render without technical errors or missing views.',
        actual: 'Errors detected during view measurement or rendering.'
    },
    'Runtime Error': {
        title: 'Runtime Exception / Logic Error',
        description: 'Non-fatal runtime exception detected in application logic.',
        steps: [
            'Interact with various app features',
            'Monitor performance and behavior',
            'Observe unexpected logic branches or errors'
        ],
        expected: 'Application logic should execute without exceptions.',
        actual: 'Code execution triggered a runtime exception/error.'
    },
    'Memory': {
        title: 'Memory Leak or Resource Pressure',
        description: 'Detected high memory consumption or OutOfMemory conditions in the application process.',
        steps: [
            'Launch the application',
            'Perform heavy usage or long-running tasks',
            'Monitor memory usage in analytics panel'
        ],
        expected: 'Application should manage resources efficiently without OOM crashes.',
        actual: 'Memory pressure detected, leading to potential stability issues.'
    },
    'Security': {
        title: 'Security or Permission Violation',
        description: 'The application attempted an action without necessary permissions or triggered a security exception.',
        steps: [
            'Perform feature requiring specific permissions (Camera, Storage, etc.)',
            'Observe application reaction to permission request'
        ],
        expected: 'Application should handle permissions gracefully or request them.',
        actual: 'SecurityException triggered during operation.'
    },
    'Database': {
        title: 'Database Persistence Error',
        description: 'Errors detected in the local database layer (SQLite), likely due to locks or schema issues.',
        steps: [
            'Perform actions requiring data persistence (Save/Load)',
            'Check for data integrity or loading failures'
        ],
        expected: 'Data should be saved and retrieved without SQL errors.',
        actual: 'SQLiteException or database locking detected.'
    },
    'Generic': {
        title: 'Unclassified Log Error',
        description: 'An unidentified error pattern was detected in logs.',
        steps: [
            'Run the test session duration',
            'Analyze logs for suspicious patterns'
        ],
        expected: 'Logcat should be free of high-severity technical errors.',
        actual: 'Suspicious error patterns detected in logs.'
    }
};

/**
 * Generates structured bug reports from a list of raw issues.
 * @param {Array} issues 
 * @returns {Array}
 */
function generateBugReports(issues) {
    if (!issues || !Array.isArray(issues)) return [];

    return issues.map(issue => {
        const template = BUG_TEMPLATES[issue.type] || BUG_TEMPLATES['Generic'];
        
        return {
            title: template.title,
            priority: issue.priority,
            type: issue.type,
            description: `${template.description} (Technical Reference: ${issue.message.substring(0, 50)}...)`,
            steps: template.steps,
            expected: template.expected,
            actual: template.actual,
            technicalDetails: issue.message
        };
    });
}

module.exports = {
    generateBugReports
};
