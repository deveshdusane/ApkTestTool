/**
 * Simple Logger Utility
 * Provides formatted console output for success, warning, and error messages.
 */

const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m"
};

const logger = {
    logSuccess: (message) => {
        console.log(`${colors.green}✔ ${message}${colors.reset}`);
    },
    logWarning: (message) => {
        console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
    },
    logError: (message) => {
        console.log(`${colors.red}✖ ${message}${colors.reset}`);
    },
    logInfo: (message) => {
        console.log(`${colors.cyan}ℹ ${message}${colors.reset}`);
    }
};

module.exports = logger;
