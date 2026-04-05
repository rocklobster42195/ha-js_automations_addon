// core/script-command-router.js
const path = require('path');

/**
 * Routes incoming commands from two sources to the WorkerManager:
 *   - HA service calls  (switch.turn_on, button.press, homeassistant.toggle, …)
 *   - MQTT commands     (jsa/<domain>/<scriptId>/set)
 *
 * This class has no entity-management concerns — it only translates
 * external signals into script lifecycle actions (start / stop / broadcast).
 */
class ScriptCommandRouter {
    /**
     * @param {object} workerManager
     * @param {object} stateManager
     * @param {object} haConnection  - provides subscribeToEvents()
     * @param {object} mqttManager   - emits 'command' events
     */
    constructor(workerManager, stateManager, haConnection, mqttManager) {
        this.workerManager = workerManager;
        this.stateManager = stateManager;

        haConnection.subscribeToEvents(this._onHaEvent.bind(this));
        mqttManager.on('command', (cmd) => this._onMqttCommand(cmd));
    }

    /**
     * Handles HA service call events (switch/button/homeassistant domain).
     * @private
     */
    _onHaEvent(event) {
        if (event.event_type !== 'call_service') return;

        const { domain, service, service_data } = event.data;

        if (!['switch', 'button', 'homeassistant'].includes(domain) ||
            !['turn_on', 'turn_off', 'toggle', 'press'].includes(service)) {
            return;
        }

        if (!service_data?.entity_id) return;

        const entityIds = Array.isArray(service_data.entity_id)
            ? service_data.entity_id
            : [service_data.entity_id];

        for (const rawId of entityIds) {
            const entityId = rawId.toLowerCase();
            const scriptPath = this.stateManager.getScriptNameForEntity(entityId);
            if (!scriptPath) continue;

            const scriptName = path.basename(scriptPath);

            // Only trigger lifecycle actions for exposed control entities (jsa_ prefix)
            const isExposedAction = entityId.includes('.jsa_');

            if (isExposedAction && (service === 'turn_on' || service === 'press')) {
                this.workerManager.startScript(scriptName);
            } else if (isExposedAction && service === 'turn_off') {
                this.workerManager.stopScript(scriptName);
            } else if (isExposedAction && service === 'toggle') {
                if (this.workerManager.workers.has(scriptName))
                    this.workerManager.stopScript(scriptName);
                else
                    this.workerManager.startScript(scriptName);
            }
        }
    }

    /**
     * Handles incoming MQTT commands on jsa/<domain>/<scriptId>/set topics.
     * @param {{ domain: string, scriptId: string, payload: string }} cmd
     * @private
     */
    _onMqttCommand({ domain, scriptId, payload }) {
        this.workerManager.emit('log', {
            source: 'System',
            message: `[ScriptCommandRouter] MQTT command for ${domain}.${scriptId}: ${payload}`,
            level: 'debug'
        });

        const entityId = Array.from(this.workerManager.nativeEntities.keys()).find(id => {
            const parts = id.split('.');
            return parts[0] === domain && (parts[1] === scriptId || parts[1] === `jsa_${scriptId}`);
        });

        if (!entityId) return;

        const filename = this.stateManager.getScriptNameForEntity(entityId);
        if (!filename) return;

        const scriptName = path.basename(filename);

        if (entityId.includes('.jsa_')) {
            // Exposed entity — lifecycle control
            if (payload === 'ON') this.workerManager.startScript(scriptName);
            else if (payload === 'OFF') this.workerManager.stopScript(scriptName);
            else if (domain === 'button' && payload === 'PRESS') this.workerManager.startScript(scriptName);
        } else {
            // Dynamic entity (ha.register) — forward to worker
            this.workerManager.broadcastToWorkers({ type: 'mqtt_command', entityId, domain, payload });
        }
    }
}

module.exports = ScriptCommandRouter;
