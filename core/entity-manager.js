
const path = require('path');
const fs = require('fs');
const ScriptParser = require('./parser');

class EntityManager {

    /**
     * @param {object} haConnection
     * @param {object} workerManager
     */
    constructor(haConnection, workerManager, stateManager) {
        this.haConnection = haConnection;
        this.workerManager = workerManager;
        this.stateManager = stateManager;
        this.haConnection.subscribeToEvents(this.handleEvent.bind(this));
    }

    async createSwitches() {
        const scripts = await this.workerManager.getScripts();
        for (const scriptPath of scripts) {
            const meta = ScriptParser.parse(scriptPath);
            const scriptName = path.basename(scriptPath, '.js');
            const entityId = `switch.js_automations_${scriptName}`;

            this.haConnection.createEntity('switch', scriptName, 'js_automations', {
                friendly_name: meta.name,
                icon: meta.icon,
            });
            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, 'off');
        }
    }

    handleEvent(event) {
        if (event.event_type !== 'call_service') {
            return;
        }

        const { domain, service, service_data } = event.data;

        if (domain !== 'switch' || !['turn_on', 'turn_off'].includes(service)) {
            return;
        }

        const entityId = service_data.entity_id;
        const scriptPath = this.stateManager.getScriptNameForEntity(entityId);

        if (scriptPath) {
            const scriptName = path.basename(scriptPath);
            if (service === 'turn_on') {
                this.workerManager.startScript(scriptName);
            } else if (service === 'turn_off') {
                this.workerManager.stopScript(scriptName);
            }
        }
    }
}

module.exports = EntityManager;
