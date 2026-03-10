
const path = require('path');
const fs = require('fs');
const ScriptHeaderParser = require('./script-header-parser');

class EntityManager {

    /**
     * @param {object} haConnection - The Home Assistant connection manager.
     * @param {object} workerManager - The worker thread manager.
     * @param {object} stateManager - The script state persistence manager.
     * @param {object} depManager - The dependency manager for NPM packages.
     */
    constructor(haConnection, workerManager, stateManager, depManager) {
        this.haConnection = haConnection;
        this.workerManager = workerManager;
        this.stateManager = stateManager;
        this.haConnection.subscribeToEvents(this.handleEvent.bind(this));
        this.workerManager.on('request_device_cleanup', (name) => this.checkDeviceCleanup(name));
        this.startWatcher();
    }

    /**
     * Attempts to resolve a name (e.g., "Living Room") to an ID (e.g., "living_room") using HA metadata.
     */
    resolveId(input, list, idField) {
        if (!input || typeof input !== 'string') return undefined;
        const cleanInput = input.trim();
        if (!cleanInput || !list || list.length === 0) return undefined;

        const lowerInput = cleanInput.toLowerCase();
        
        // 1. Direkter ID Match
        const directMatch = list.find(item => item[idField] === cleanInput);
        if (directMatch) return directMatch[idField];

        // 2. Namens-Match (Case-Insensitive)
        const nameMatch = list.find(item => item.name && item.name.toLowerCase() === lowerInput);
        return nameMatch ? nameMatch[idField] : undefined;
    }

    async createExposedEntities(hasIntegration = false) {
        const scripts = await this.workerManager.getScripts();
        
        // Metadaten für Lookup laden
        const { areas, labels } = await this.haConnection.getHAMetadata();

        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Syncing exposed entities for ${scripts.length} scripts`, level: 'debug' });

        for (const scriptPath of scripts) {
            // Skip libraries (they are passive and live in /libraries subfolder)
            if (path.basename(path.dirname(scriptPath)) === 'libraries') continue;

            const meta = ScriptHeaderParser.parse(scriptPath);
            const scriptName = path.basename(scriptPath, '.js');
            
            const protectedIds = [];
            // Nur wenn @expose gesetzt ist, erstellen wir eine Entität
            if (!meta.expose) continue;

            // Check current state (for reconnects/restarts)
            const isRunning = this.workerManager.workers.has(scriptPath);

            const domain = meta.expose === 'button' ? 'button' : 'switch';
            const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();
            
            let entityIcon = meta.icon;
            if (domain === 'button') entityIcon = 'mdi:play';
            else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

            const initialState = (domain === 'switch' && isRunning) ? 'on' : 'off';

            if (hasIntegration) {
                // Native Creation (Persistent & Unique ID)
                const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();

                // IDs auflösen
                const areaId = this.resolveId(meta.area, areas, 'area_id');
                
                // Labels auflösen (Array oder Komma-String)
                let resolvedLabels = [];
                if (meta.label) {
                    const rawLabels = Array.isArray(meta.label) ? meta.label : String(meta.label).split(',');
                    resolvedLabels = rawLabels.map(l => {
                        const id = this.resolveId(l, labels, 'label_id');
                        if (!id) console.warn(`[EntityManager] ⚠️ Could not resolve Label '${l.trim()}' for ${scriptName}`);
                        return id;
                    }).filter(id => id);
                }

                if (meta.area && !areaId) console.warn(`[EntityManager] ⚠️ Could not resolve Area '${meta.area}' for ${scriptName}`);
                
                const payload = {
                    entity_id: entityId,
                    unique_id: uniqueId,
                    name: meta.name,
                    icon: entityIcon,
                    area_id: areaId,
                    labels: resolvedLabels,
                    device_info: {
                        identifiers: [`js_automations_script_${scriptName}`],
                        name: meta.name || scriptName,
                        manufacturer: "JS Automations",
                        model: "Script",
                    },
                    attributes: {
                        source: 'JS Automations Addon',
                        script: scriptName
                    }
                };

                // Switch braucht einen initialen State
                if (domain === 'switch') {
                    payload.state = initialState;
                }

                await this.haConnection.callService('js_automations', 'create_entity', {
                    ...payload
                });

                // Register in central registry for lifecycle management
                this.workerManager.registerEntity(scriptName + '.js', entityId, payload);
                protectedIds.push(entityId);
            } else {
                // Legacy Creation (Ephemeral)
                // Buttons werden in Legacy als Switch simuliert (da Button-Domain nicht via HTTP setzbar ist ohne State)
                // Wir erstellen sie trotzdem, damit sie im UI auftauchen.
                if (domain === 'switch' || domain === 'button') {
                    this.haConnection.createEntity(domain, scriptName, 'js_automations', {
                        friendly_name: meta.name,
                        icon: entityIcon,
                    });
                    
                    // Bei Legacy müssen wir den State separat setzen, falls er 'on' sein soll
                    if (initialState === 'on') {
                        this.haConnection.updateState(entityId, 'on', { icon: 'mdi:stop' });
                    }
                }
            }

            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, initialState);

            // Mark as protected from Mark-and-Sweep
            this.workerManager.setProtectedEntities(scriptName + '.js', protectedIds);
        }
    }

    /**
     * Compares the Home Assistant entity registry with local scripts.
     * 1. Removes entities in HA that no longer have a corresponding script file.
     * 2. Ensures all @expose entities exist (Self-Healing).
     */
    async cleanupOrphanedEntities(activeScriptNames) {
        const hasIntegration = await this.haConnection.checkIntegrationAvailable();
        if (!hasIntegration) return;

        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Starting global cleanup of orphaned entities (using device linking)', level: 'debug' });
        const entityReg = await this.haConnection.getEntityRegistry();
        const deviceReg = await this.haConnection.getDeviceRegistry();
        
        const deviceMap = new Map(deviceReg.map(d => [d.id, d]));
        const lowerActiveScripts = activeScriptNames.map(n => n.toLowerCase());
        const noActiveScripts = lowerActiveScripts.length === 0;

        const ourEntities = entityReg.filter(e => e.platform === 'js_automations');
        
        for (const entity of ourEntities) {
            // Handle entities without a unique_id - they are always orphans if no scripts exist.
            if (!entity.unique_id) {
                if (noActiveScripts) {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned entity ${entity.entity_id} with no unique_id. Removing...`, level: 'debug' });
                    // Use the newly robust service to remove by entity_id
                    await this.haConnection.callService('js_automations', 'remove_entity', { entity_id: entity.entity_id });
                } else {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Skipping entity ${entity.entity_id} with no unique_id as scripts are still active.`, level: 'warn' });
                }
                continue; // Move to next entity
            }

            let scriptName = null;
            const device = entity.device_id ? deviceMap.get(entity.device_id) : null;

            if (device && device.identifiers) {
                const mainIdentifier = device.identifiers.find(idPair => idPair.length > 1 && idPair[0] === 'js_automations' && idPair[1].startsWith('js_automations_script_'));
                if (mainIdentifier) {
                    scriptName = mainIdentifier[1].substring('js_automations_script_'.length);
                }
            }

            if (!scriptName) {
                const parts = entity.unique_id.split('_');
                if (parts.length > 3 && parts[0] === 'js' && parts[1] === 'automations') {
                     scriptName = parts.slice(3).join('_');
                     this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Using current unique_id format fallback for ${entity.entity_id} -> ${scriptName}`, level: 'debug' });
                } 
                else if (parts.length > 2 && parts[0] === 'js' && parts[1] === 'automations') {
                    scriptName = parts.slice(2).join('_');
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Using legacy unique_id format fallback for ${entity.entity_id} -> ${scriptName}`, level: 'debug' });
                }
            }
            
            if (!scriptName) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Could not determine script name for ${entity.entity_id}, skipping cleanup.`, level: 'debug' });
                continue;
            }

            if (!lowerActiveScripts.includes(scriptName.toLowerCase())) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned entity ${entity.entity_id} (Script ${scriptName} missing). Removing from HA...`, level: 'debug' });
                await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: entity.unique_id });
                await this.workerManager.removeScriptEntities(scriptName + '.js');
            }
        }

        // After cleaning entities, clean up any devices that are now empty
        await this.cleanupOrphanedDevices();
        
        // Finally, run self-healing to create entities for scripts that might be missing them
        await this.createExposedEntities(true);
    }

    /**
     * Removes devices from the 'js_automations' integration that no longer have any entities.
     */
    async cleanupOrphanedDevices() {
        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Starting cleanup of orphaned devices', level: 'debug' });
        
        const devices = await this.haConnection.getDeviceRegistry();
        const entities = await this.haConnection.getEntityRegistry();

        // Get all devices managed by this integration
        const ourDevices = devices.filter(d => d.manufacturer === 'JS Automations');
        if (ourDevices.length === 0) return;

        // Create a set of all device_ids that are actually in use by entities
        const usedDeviceIds = new Set(entities.map(e => e.device_id).filter(id => id));

        for (const device of ourDevices) {
            if (!usedDeviceIds.has(device.id)) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned device "${device.name_by_user || device.name}". Removing from HA...`, level: 'debug' });
                
                // Extract the raw identifiers for the service call, e.g., ['js_automations_script_xyz']
                const rawIdentifiers = device.identifiers.map(idPair => idPair[1]);
                
                if (rawIdentifiers.length > 0) {
                    await this.haConnection.callService('js_automations', 'remove_device', { 
                        identifiers: rawIdentifiers
                    });
                }
            }
        }
    }

    /**
     * Checks if a script still has any associated entities.
     * If no entities remain, the device is removed from Home Assistant.
     */
    async checkDeviceCleanup(scriptName) {
        const hasIntegration = await this.haConnection.checkIntegrationAvailable();
        if (!hasIntegration) return;

        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Checking if device for ${scriptName} should be removed`, level: 'debug' });

        const fileName = scriptName + '.js';
        const dynamicEntities = this.workerManager.scriptEntityMap.get(fileName);
        
        // Check if @expose entities still exist by parsing the file
        const meta = fs.existsSync(path.join(this.workerManager.scriptsDir, fileName)) 
            ? ScriptHeaderParser.parse(path.join(this.workerManager.scriptsDir, fileName)) 
            : { expose: null };

        if (!meta.expose && (!dynamicEntities || dynamicEntities.size === 0)) {
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] No entities left for ${scriptName}. Removing device from HA.`, level: 'debug' });
            await this.haConnection.callService('js_automations', 'remove_device', { 
                identifiers: [`js_automations_script_${scriptName}`] 
            });
        }
    }

    startWatcher() {
        if (!this.workerManager.scriptsDir) return;
        
        // Simple debounce map to avoid double events on save
        const debounceTimers = new Map();
        
        const onWatch = (dir, eventType, filename) => {
            if (filename && filename.endsWith('.js')) {
                const fullPath = path.join(dir, filename);
                if (debounceTimers.has(fullPath)) clearTimeout(debounceTimers.get(fullPath));
                
                debounceTimers.set(fullPath, setTimeout(() => {
                    debounceTimers.delete(fullPath); // FIX: Map-Eintrag nach Ausführung löschen
                    this.processSingleScript(fullPath);
                }, 500));
            }
        };

        try {
            // Watch Root
            fs.watch(this.workerManager.scriptsDir, (eventType, filename) => onWatch(this.workerManager.scriptsDir, eventType, filename));
            
            // Watch Libraries (Explicitly for Linux compatibility)
            const libDir = path.join(this.workerManager.scriptsDir, 'libraries');
            if (fs.existsSync(libDir)) {
                fs.watch(libDir, (eventType, filename) => onWatch(libDir, eventType, filename));
            }
        } catch (e) {
            console.error("[EntityManager] Failed to watch scripts directory:", e);
        }
    }

    async processSingleScript(scriptPath) {
        const scriptName = path.basename(scriptPath, '.js');

        // --- DELETION HANDLING for deleted file ---
        if (!fs.existsSync(scriptPath)) {
            const fileName = path.basename(scriptPath);
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Script file deleted: ${fileName}. Starting cleanup for ${scriptName}`, level: 'debug' });
            
            this.workerManager.stopScript(fileName, 'file deleted');
            await this.workerManager.removeScriptEntities(fileName);
            this.stateManager.unregisterScript(scriptPath);
            return; 
        }
        
        try {
            const meta = ScriptHeaderParser.parse(scriptPath);
            const fileName = path.basename(scriptPath);

            // --- Library Handling: Check dependents ---
            if (path.basename(path.dirname(scriptPath)) === 'libraries') {
                const runningScripts = Array.from(this.workerManager.workers.keys());
                for (const runningScriptFile of runningScripts) {
                    const runningScriptPath = path.join(this.workerManager.scriptsDir, runningScriptFile);
                    const runningMeta = ScriptHeaderParser.parse(runningScriptPath);
                    const depends = runningMeta.includes && runningMeta.includes.some(lib => lib === fileName || lib === scriptName || lib + '.js' === fileName);
                    if (depends) {
                        this.workerManager.startScript(runningScriptFile);
                    }
                }
                return; // Libraries don't have entities
            }

            const hasIntegration = await this.haConnection.checkIntegrationAvailable();
            if (!hasIntegration) return;

            // --- BRUTE-FORCE CLEANUP on every save ---
            // To handle type changes (switch->button), we first remove both possible entities.
            // The service call is a no-op if they don't exist.
            try {
                const switchUniqueId = `js_automations_switch_${scriptName}`.toLowerCase();
                const buttonUniqueId = `js_automations_button_${scriptName}`.toLowerCase();
                await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: switchUniqueId });
                await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: buttonUniqueId });
            } catch (e) {
                console.warn(`[EntityManager] Issue during pre-emptive entity cleanup for ${scriptName}. This might be okay.`, e);
            }

            // --- EXIT if no @expose is defined ---
            if (!meta.expose || !['switch', 'button'].includes(meta.expose)) {
                this.workerManager.setProtectedEntities(fileName, []); // No protected entities
                await this.checkDeviceCleanup(scriptName); // Check if the device should be removed
                return;
            }

            // --- RE-CREATE the correct entity ---
            const isRunning = this.workerManager.workers.has(scriptPath);
            const { areas, labels } = await this.haConnection.getHAMetadata();

            const domain = meta.expose;
            const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();
            const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();
            const initialState = (domain === 'switch' && isRunning) ? 'on' : 'off';
            let entityIcon = meta.icon;
            if (domain === 'button') entityIcon = 'mdi:play';
            else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

            const payload = {
                entity_id: entityId,
                unique_id: uniqueId,
                name: meta.name,
                icon: entityIcon,
                area_id: this.resolveId(meta.area, areas, 'area_id'),
                labels: [],
                device_info: {
                    identifiers: [`js_automations_script_${scriptName}`],
                    name: meta.name || scriptName,
                    manufacturer: "JS Automations",
                    model: "Script",
                },
                attributes: { source: 'JS Automations Addon', script: scriptName }
            };

            if (meta.label) {
                const rawLabels = Array.isArray(meta.label) ? meta.label : String(meta.label).split(',');
                payload.labels = rawLabels.map(l => {
                    const id = this.resolveId(l, labels, 'label_id');
                    if (!id) console.warn(`[EntityManager] ⚠️ Could not resolve Label '${l.trim()}' for ${scriptName}`);
                    return id;
                }).filter(id => id);
            }

            if (domain === 'switch') {
                payload.state = initialState;
            }

            await this.haConnection.callService('js_automations', 'create_entity', payload);
            
            const protectedIds = [entityId];
            this.workerManager.registerEntity(fileName, entityId, payload);
            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, initialState);
            this.workerManager.setProtectedEntities(fileName, protectedIds);

        } catch (e) {
            console.error(`[EntityManager] Error processing ${scriptPath}:`, e);
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
