
const path = require('path');
const fs = require('fs');

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
        for (const script of scripts) {
            const scriptName = path.basename(script, '.js');
            const entityId = `switch.js_automation_${scriptName}`;
            const icon = await this.getIconFromScript(script);

            this.haConnection.createEntity('switch', scriptName, 'js_automation', {
                name: scriptName,
                icon: icon || 'mdi:script-text-outline',
            });
            this.stateManager.registerEntity(entityId, script);
            this.stateManager.set(entityId, 'off');
        }
    }

    async getIconFromScript(scriptPath) {
        const content = await fs.promises.readFile(scriptPath, 'utf8');
        const match = content.match(/\/\/\s*icon:\s*(mdi:[a-z0-9-]+)/);
        return match ? match[1] : null;
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
