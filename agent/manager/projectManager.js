const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ProjectManager {
    constructor() {
        this.baseDir = path.join(__dirname, '../../projects');
        this.ensureBaseDir();
    }

    ensureBaseDir() {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    getProjectPath(projectName) {
        if (!projectName) throw new Error('Project name is required.');
        return path.join(this.baseDir, projectName);
    }

    getReportsPath(projectName) {
        return path.join(this.getProjectPath(projectName), 'reports');
    }

    /**
     * Creates a new project structure.
     * @param {string} projectName 
     */
    createProject(projectName) {
        const projectPath = path.join(this.baseDir, projectName);
        if (fs.existsSync(projectPath)) {
            throw new Error(`Project "${projectName}" already exists.`);
        }

        const dirs = ['apks', 'sessions', 'reports'];
        dirs.forEach(dir => {
            fs.mkdirSync(path.join(projectPath, dir), { recursive: true });
        });

        const metadata = {
            name: projectName,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            apks: []
        };

        fs.writeFileSync(
            path.join(projectPath, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        fs.writeFileSync(
            path.join(projectPath, 'reports', 'history.json'),
            JSON.stringify([], null, 2)
        );

        return { success: true, projectName, path: projectPath };
    }

    /**
     * Lists all available projects.
     */
    listProjects() {
        if (!fs.existsSync(this.baseDir)) return [];
        return fs.readdirSync(this.baseDir)
            .filter(name => fs.statSync(path.join(this.baseDir, name)).isDirectory());
    }

    /**
     * Gets project metadata.
     */
    getProjectMetadata(projectName) {
        const metadataPath = path.join(this.getProjectPath(projectName), 'metadata.json');
        if (fs.existsSync(metadataPath)) {
            return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        }
        return null;
    }

    getHistory(projectName) {
        const reportsDir = this.getReportsPath(projectName);
        fs.mkdirSync(reportsDir, { recursive: true });

        const historyPath = path.join(reportsDir, 'history.json');
        if (!fs.existsSync(historyPath)) {
            fs.writeFileSync(historyPath, JSON.stringify([], null, 2));
            console.log('Fetched history:', []);
            return [];
        }

        try {
            const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            const history = Array.isArray(data) ? data : [];
            console.log('Fetched history:', history);
            return history;
        } catch (err) {
            logger.logError(`Get History Error: ${err.message}`);
            return [];
        }
    }

    appendHistory(projectName, session) {
        const reportsDir = this.getReportsPath(projectName);
        fs.mkdirSync(reportsDir, { recursive: true });

        const historyPath = path.join(reportsDir, 'history.json');
        let history = [];

        if (fs.existsSync(historyPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
                history = Array.isArray(data) ? data : [];
            } catch (err) {
                logger.logError(`History parse failed, recreating index: ${err.message}`);
            }
        }

        const existingIndex = history.findIndex(item => item.sessionId === session.sessionId);
        if (existingIndex === -1) {
            history.push(session);
        } else {
            history[existingIndex] = { ...history[existingIndex], ...session };
        }

        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        console.log('History updated:', history.length);
        return history;
    }

    removeFromHistory(projectName, sessionId) {
        const historyPath = path.join(this.getReportsPath(projectName), 'history.json');
        if (!fs.existsSync(historyPath)) return;

        try {
            const history = this.getHistory(projectName);
            const filtered = history.filter(item => item.sessionId !== sessionId);
            fs.writeFileSync(historyPath, JSON.stringify(filtered, null, 2));
        } catch (err) {
            logger.logError(`Remove History Error: ${err.message}`);
        }
    }

    /**
     * Adds an APK to a project and updates metadata.
     */
    addApkToProject(projectName, sourceApkPath) {
        const projectPath = this.getProjectPath(projectName);
        const fileName = path.basename(sourceApkPath);
        const destinationPath = path.join(projectPath, 'apks', fileName);

        // Copy APK to project folder (Avoid duplicate storage within the same project if needed, 
        // but here we just copy it to ensure portability of the project folder)
        fs.copyFileSync(sourceApkPath, destinationPath);

        const metadata = this.getProjectMetadata(projectName);
        if (metadata) {
            if (!metadata.apks.includes(fileName)) {
                metadata.apks.push(fileName);
                metadata.lastUsed = new Date().toISOString();
                fs.writeFileSync(
                    path.join(projectPath, 'metadata.json'),
                    JSON.stringify(metadata, null, 2)
                );
            }
        }

        return destinationPath;
    }

    /**
     * Cleanup system: Keeps only last 5 sessions per project.
     */
    cleanupProjectSessions(projectName, limit = 5) {
        const sessionsDir = path.join(this.getProjectPath(projectName), 'sessions');
        if (!fs.existsSync(sessionsDir)) return;

        const sessions = fs.readdirSync(sessionsDir)
            .map(name => ({
                name,
                path: path.join(sessionsDir, name),
                time: fs.statSync(path.join(sessionsDir, name)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // Newest first

        if (sessions.length > limit) {
            const toDelete = sessions.slice(limit);
            toDelete.forEach(session => {
                fs.rmSync(session.path, { recursive: true, force: true });
                logger.logInfo(`Cleaned up old session: ${session.name} in ${projectName}`);
            });
        }
    }
    /**
     * Deletes a project and all its contents.
     */
    deleteProject(projectName) {
        const projectPath = this.getProjectPath(projectName);
        if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
            return { success: true, message: `✔ Project "${projectName}" deleted.` };
        }
        return { success: false, message: `❌ Project "${projectName}" not found.` };
    }

    /**
     * Deletes a specific session.
     */
    deleteSession(projectName, sessionId) {
        try {
            const projectPath = this.getProjectPath(projectName);
            const sessionPath = path.join(projectPath, 'sessions', sessionId);
            const reportPath = path.join(projectPath, 'reports', `${sessionId}.json`);

            if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
            if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);

            return { success: true };
        } catch (err) {
            logger.logError(`Delete Session Error: ${err.message}`);
            return { success: false, message: err.message };
        }
    }
}

module.exports = new ProjectManager();
