
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

        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Starting global cleanup of orphaned entities', level: 'debug' });
        const registry = await this.haConnection.getEntityRegistry();
        
        const ourEntities = registry.filter(e => e.platform === 'js_automations');
        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found ${ourEntities.length} entities belonging to js_automations`, level: 'debug' });
        
        const lowerActiveScripts = activeScriptNames.map(n => n.toLowerCase());

        for (const entity of ourEntities) {
            // Wir extrahieren den Skriptnamen aus der UniqueID 
            // Format: js_automations_{domain}_{scriptname} oder via device_info
            const parts = entity.unique_id.split('_');
            const scriptName = parts.slice(3).join('_'); // Alles nach js_automations_{domain}_
            
            if (!lowerActiveScripts.includes(scriptName.toLowerCase())) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned entity ${entity.entity_id} (Script ${scriptName} missing). Removing from HA...`, level: 'debug' });
                await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: entity.unique_id });
                
                // Sync local registry: Remove the script from WorkerManager's map to allow device cleanup
                await this.workerManager.removeScriptEntities(scriptName + '.js');
            }
        }

        // 2. Self-Healing: Re-trigger all @expose entities
        // If the user deleted them in HA, they will be recreated here.
        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Running self-healing for exposed entities', level: 'debug' });
        await this.createExposedEntities(true);
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

        // --- DELETION HANDLING ---
        if (!fs.existsSync(scriptPath)) {
            const fileName = path.basename(scriptPath);
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Script file deleted: ${fileName}. Starting cleanup for ${scriptName}`, level: 'debug' });
            
            // Stop worker to free resources
            this.workerManager.stopScript(fileName, 'file deleted');

            // 1. Clean up dynamic entities (via WorkerManager)
            await this.workerManager.removeScriptEntities(fileName);

            // 2. Clean up internal state mappings
            this.stateManager.unregisterScript(scriptPath);

            // NOTE: workerManager.removeScriptEntities already handles HA removal 
            // of all entities in the registry (including exposed ones now).
            // Device cleanup is triggered via event from WorkerManager.
            return; 
        }
        
        try {
            const meta = ScriptHeaderParser.parse(scriptPath);
            const fileName = path.basename(scriptPath);

            // 1. Library Handling: Check dependents
            if (path.basename(path.dirname(scriptPath)) === 'libraries') {
                const runningScripts = Array.from(this.workerManager.workers.keys());
                for (const runningScriptFile of runningScripts) {
                    const runningScriptPath = path.join(this.workerManager.scriptsDir, runningScriptFile);
                    // Parse running script to check includes (lightweight op)
                    const runningMeta = ScriptHeaderParser.parse(runningScriptPath);
                    
                    const depends = runningMeta.includes && runningMeta.includes.some(lib => {
                        return lib === fileName || lib === scriptName || lib + '.js' === fileName;
                    });

                    if (depends) {
                        console.log(`[EntityManager] Restarting ${runningScriptFile} due to library update (${fileName}).`);
                        this.workerManager.startScript(runningScriptFile);
                    }
                }
                return; // Libraries don't have entities
            }

            // Wir entfernen den Early-Return, um auch Löschungen zu verarbeiten
            // if (!meta.expose) return;

            const hasIntegration = await this.haConnection.checkIntegrationAvailable();
            const isRunning = this.workerManager.workers.has(scriptPath);
            
            // Metadaten für Lookup laden
            const { areas, labels } = await this.haConnection.getHAMetadata();
            
            // Wir prüfen beide möglichen Domänen, um ggf. alte Typen zu löschen (z.B. Wechsel von switch zu button)
            const domains = ['switch', 'button'];

            const protectedIds = [];
            for (const domain of domains) {
                const shouldExist = meta.expose === domain;
                const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();
                const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();
                
                let entityIcon = meta.icon;
                if (domain === 'button') entityIcon = 'mdi:play';
                else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

                if (shouldExist) {
                    // --- CREATE / UPDATE ---
                    if (hasIntegration) {
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
                            attributes: { source: 'JS Automations Addon', script: scriptName }
                        };
                        // Note: We do NOT send 'state' here to avoid resetting a running switch to 'off' on save.
                        await this.haConnection.callService('js_automations', 'create_entity', payload);
                    } else {
                        // Legacy Update (Best Effort)
                        this.haConnection.createEntity(domain, scriptName, 'js_automations', {
                            friendly_name: meta.name,
                            icon: entityIcon,
                        });
                    }
                    this.stateManager.registerEntity(entityId, scriptPath);
                } else {
                    // --- DELETE / CLEANUP ---
                    if (hasIntegration) {
                        try {
                            await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: uniqueId });
                        } catch (e) {
                            // Ignorieren, falls Entität nicht existierte
                        }
                    }
                    // Legacy Entitäten können nicht ohne Restart gelöscht werden
                }
            }

            // Nach dem Update prüfen, ob das Device weg kann (falls expose entfernt wurde)
            await this.checkDeviceCleanup(scriptName);
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
