
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

    async createExposedEntities(hasIntegration = false) {
        const scripts = await this.workerManager.getScripts();
        for (const scriptPath of scripts) {
            // Skip libraries (they are passive and live in /libraries subfolder)
            if (path.basename(path.dirname(scriptPath)) === 'libraries') continue;

            const meta = ScriptParser.parse(scriptPath);
            const scriptName = path.basename(scriptPath, '.js');
            
            // Nur wenn @expose gesetzt ist, erstellen wir eine Entität
            if (!meta.expose) continue;

            const domain = meta.expose === 'button' ? 'button' : 'switch';
            const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();

            if (hasIntegration) {
                // Native Creation (Persistent & Unique ID)
                const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();
                
                const payload = {
                    entity_id: entityId,
                    unique_id: uniqueId,
                    name: meta.name,
                    icon: meta.icon,
                    attributes: {
                        source: 'JS Automations Addon',
                        script: scriptName
                    }
                };

                // Switch braucht einen initialen State
                if (domain === 'switch') {
                    payload.state = 'off';
                }

                await this.haConnection.callService('js_automations', 'create_entity', {
                    ...payload
                });
            } else {
                // Legacy Creation (Ephemeral)
                // Buttons werden in Legacy als Switch simuliert (da Button-Domain nicht via HTTP setzbar ist ohne State)
                // Wir erstellen sie trotzdem, damit sie im UI auftauchen.
                if (domain === 'switch' || domain === 'button') {
                    this.haConnection.createEntity(domain, scriptName, 'js_automations', {
                        friendly_name: meta.name,
                        icon: meta.icon,
                    });
                }
            }

            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, 'off');
        }
    }

    handleEvent(event) {
        if (event.event_type !== 'call_service') {
            return;
        }

        const { domain, service, service_data } = event.data;

        // Allow 'switch' and 'homeassistant' domains, and handle 'toggle'
        if (!['switch', 'button', 'homeassistant'].includes(domain) || !['turn_on', 'turn_off', 'toggle', 'press'].includes(service)) {
            return;
        }

        if (!service_data || !service_data.entity_id) return;
        const entityIds = Array.isArray(service_data.entity_id) ? service_data.entity_id : [service_data.entity_id];

        entityIds.forEach(rawId => {
            // FIX: Lookup muss lowercase sein, da HA IDs immer lowercase sendet
            const entityId = rawId.toLowerCase();
            const scriptPath = this.stateManager.getScriptNameForEntity(entityId);
            
            if (scriptPath) {
                const scriptName = path.basename(scriptPath);
                console.log(`[EntityManager] Action for script ${scriptName}: ${service}`);
                
                if (service === 'turn_on') {
                    this.workerManager.startScript(scriptName);
                } else if (service === 'turn_off') {
                    this.workerManager.stopScript(scriptName);
                } else if (service === 'toggle') {
                    const isRunning = this.workerManager.workers.has(scriptName);
                    if (isRunning) this.workerManager.stopScript(scriptName);
                    else this.workerManager.startScript(scriptName);
                } else if (service === 'press') {
                    // Button Logic: Start or Restart
                    this.workerManager.startScript(scriptName);
                }
            }
        });
    }
}

module.exports = EntityManager;
