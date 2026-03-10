/**
 * HA-JS-STUDIO: Phase 5.1 - State Manager
 * 
 * Saves and loads the "running" state of scripts to ensure 
 * persistence across server restarts.
 */

const fs = require('fs');
const path = require('path');

class StateManager {
    constructor(rootDir) {
        this.stateFile = path.join(rootDir, 'state.json');
        this.state = { enabledScripts: [] };
        this.liveStates = new Map();
        this.entityScriptMap = new Map();
        this.load();
    }

    /** Load state from file */
    load() {
        if (fs.existsSync(this.stateFile)) {
            try {
                const data = fs.readFileSync(this.stateFile, 'utf8');
                this.state = JSON.parse(data);
            } catch (e) {
                console.error("❌ Failed to parse state.json, starting fresh.");
            }
        }
    }

    /** Save state to file */
    save() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (e) {
            console.error("❌ Failed to save state.json:", e.message);
        }
    }

    set(entityId, state) {
        this.liveStates.set(entityId, state);
    }

    get(entityId) {
        return this.liveStates.get(entityId);
    }

    registerEntity(entityId, scriptName) {
        this.entityScriptMap.set(entityId, scriptName);
    }

    /**
     * Removes all entity mappings associated with a specific script path.
     * @param {string} scriptPath - The full path of the script to unregister.
     */
    unregisterScript(scriptPath) {
        for (const [entityId, path] of this.entityScriptMap.entries()) {
            if (path === scriptPath) {
                this.entityScriptMap.delete(entityId);
            }
        }
    }

    getScriptNameForEntity(entityId) {
        return this.entityScriptMap.get(entityId);
    }

    /** Mark a script as enabled */
    saveScriptStarted(filename) {
        if (!this.state.enabledScripts.includes(filename)) {
            this.state.enabledScripts.push(filename);
            this.save();
        }
    }

    /** Mark a script as disabled */
    saveScriptStopped(filename) {
        this.state.enabledScripts = this.state.enabledScripts.filter(f => f !== filename);
        this.save();
    }

    /** Get list of all scripts that should be running */
    getEnabledScripts() {
        return this.state.enabledScripts;
    }
}

module.exports = StateManager;