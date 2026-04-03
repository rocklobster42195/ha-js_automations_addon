// core/script-watcher.js
const path = require('path');
const fs = require('fs');
const ScriptHeaderParser = require('./script-header-parser');

/**
 * Watches the scripts directory for file changes and orchestrates the
 * script lifecycle (add, update, delete) including TypeScript compilation
 * and MQTT Discovery updates for @expose entities.
 */
class ScriptWatcher {
    /**
     * @param {object} workerManager
     * @param {object} stateManager
     * @param {object} mqttManager
     * @param {object} haConnection
     * @param {object} compilerManager
     * @param {object} callbacks - EntityManager methods needed for entity sync:
     *   resolveId, checkDeviceCleanup, warnIconConflict, onTypingsNeeded
     */
    constructor(workerManager, stateManager, mqttManager, haConnection, compilerManager, callbacks) {
        this.workerManager = workerManager;
        this.stateManager = stateManager;
        this.mqttManager = mqttManager;
        this.haConnection = haConnection;
        this.compilerManager = compilerManager;
        this.callbacks = callbacks;
    }

    start() {
        if (!this.workerManager.scriptsDir) return;

        const debounceTimers = new Map();

        const onWatch = (dir, eventType, filename) => {
            if (filename && (filename.endsWith('.js') || filename.endsWith('.ts'))) {
                const fullPath = path.join(dir, filename);
                if (debounceTimers.has(fullPath)) clearTimeout(debounceTimers.get(fullPath));

                debounceTimers.set(fullPath, setTimeout(() => {
                    debounceTimers.delete(fullPath);
                    this.processScript(fullPath);
                }, 500));
            }
        };

        try {
            fs.watch(this.workerManager.scriptsDir, (eventType, filename) =>
                onWatch(this.workerManager.scriptsDir, eventType, filename));

            const libDir = path.join(this.workerManager.scriptsDir, 'libraries');
            if (fs.existsSync(libDir)) {
                fs.watch(libDir, (eventType, filename) => onWatch(libDir, eventType, filename));
            }
        } catch (e) {
            console.error('[ScriptWatcher] Failed to watch scripts directory:', e);
        }
    }

    async processScript(scriptPath) {
        const extension = path.extname(scriptPath);
        const scriptNameRaw = path.basename(scriptPath, extension);
        const slug = scriptNameRaw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const fileName = path.basename(scriptPath);

        // --- DELETION ---
        if (!fs.existsSync(scriptPath)) {
            this.workerManager.emit('log', { source: 'System', message: `[ScriptWatcher] Script deleted: ${fileName}. Starting cleanup for ${scriptNameRaw}`, level: 'debug' });

            this.workerManager.stopScript(fileName, 'file deleted');
            await this.workerManager.removeScriptEntities(fileName);
            this.stateManager.unregisterScript(scriptPath);

            if (extension === '.ts') {
                this.compilerManager.cleanup(scriptPath);
            }

            this.callbacks.onTypingsNeeded();
            return;
        }

        try {
            if (extension === '.ts') {
                const success = await this.compilerManager.transpile(scriptPath);
                if (!success) return;
            }

            const meta = ScriptHeaderParser.parse(scriptPath);

            // --- Library change: restart all scripts that depend on it ---
            if (path.basename(path.dirname(scriptPath)) === 'libraries') {
                const runningScripts = Array.from(this.workerManager.workers.keys());
                for (const runningScriptFile of runningScripts) {
                    const runningScriptPath = path.join(this.workerManager.scriptsDir, runningScriptFile);
                    const runningMeta = ScriptHeaderParser.parse(runningScriptPath);
                    const depends = runningMeta.includes && runningMeta.includes.some(lib => {
                        const cleanLib = lib.replace(/\.(js|ts)$/, '').toLowerCase();
                        const cleanTarget = scriptNameRaw.toLowerCase();
                        return lib === fileName || cleanLib === cleanTarget || lib + '.js' === fileName || lib + '.ts' === fileName;
                    });
                    if (depends) {
                        this.workerManager.startScript(runningScriptFile);
                    }
                }
                return;
            }

            const displayName = (meta.name && meta.name !== fileName)
                ? meta.name
                : scriptNameRaw.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            if (!this.mqttManager.isConnected) {
                if (meta.expose) {
                    this.workerManager.emit('log', { source: 'System', message: `⚠️ Script ${displayName} has @expose but MQTT is not connected. Entity will not be available in HA.`, level: 'warn' });
                }
                return;
            }

            const domain = meta.expose === 'button' ? 'button' : 'switch';

            // --- Smart cleanup for domain type changes (switch ↔ button) ---
            const otherDomain = domain === 'button' ? 'switch' : 'button';
            const idsToRemove = [
                `jsa_${otherDomain}_${slug}`,
                `js_automations_${otherDomain}_${slug}`,
                `js_automations_${domain}_${slug}`
            ];

            if (!meta.expose) {
                idsToRemove.push(`jsa_switch_${slug}`, `jsa_button_${slug}`);
            }

            for (const uid of idsToRemove) {
                const d = uid.includes('switch') ? 'switch' : 'button';
                this.mqttManager.publish(`homeassistant/${d}/${uid}/config`, '', { retain: true });
            }

            // --- No @expose: clean up and exit ---
            if (!meta.expose || !['switch', 'button'].includes(meta.expose)) {
                this.workerManager.setProtectedEntities(fileName, []);
                await this.callbacks.checkDeviceCleanup(slug);
                return;
            }

            // --- Publish / update the exposed entity ---
            const isRunning = this.workerManager.workers.has(fileName);
            const { areas } = await this.haConnection.getHAMetadata();

            const entityId = `${domain}.jsa_${slug}`;
            const uniqueId = `jsa_${domain}_${slug}`;
            const initialState = (domain === 'switch' && isRunning) ? 'ON' : 'OFF';
            let entityIcon = meta.icon;
            if (domain === 'button') entityIcon = 'mdi:play';
            else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

            const discoveryTopic = `homeassistant/${domain}/${uniqueId}/config`;

            const payload = {
                name: null,
                unique_id: uniqueId,
                state_topic: `jsa/${domain}/${slug}/data`,
                value_template: '{{ value_json.state }}',
                json_attributes_topic: `jsa/${domain}/${slug}/data`,
                json_attributes_template: '{{ value_json.attributes | tojson }}',
                icon_template: `{{ value_json.icon if value_json.icon is defined else '${entityIcon || 'mdi:script-text'}' }}`,
                force_update: true,
                has_entity_name: true,
                availability_topic: 'jsa/status',
                command_topic: `jsa/${domain}/${slug}/set`,
                device: {
                    identifiers: [`jsa_script_${slug}`],
                    name: displayName,
                    manufacturer: 'JS Automations',
                    model: 'Script',
                }
            };

            if (this.callbacks.resolveId(meta.area, areas, 'area_id')) {
                payload.device.suggested_area = meta.area;
            }

            if (payload.device_class && (meta.icon || (meta.attributes && meta.attributes.icon))) {
                this.callbacks.warnIconConflict(entityId, payload.device_class);
            }

            this.mqttManager.publish(discoveryTopic, payload, { retain: true });
            this.mqttManager.publishEntityState(payload, initialState, { icon: entityIcon });

            this.workerManager.registerEntity(fileName, entityId, payload);
            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, initialState.toLowerCase());
            this.workerManager.setProtectedEntities(fileName, [entityId]);

            this.callbacks.onTypingsNeeded();

        } catch (e) {
            console.error(`[ScriptWatcher] Error processing ${scriptPath}:`, e);
        }
    }
}

module.exports = ScriptWatcher;
