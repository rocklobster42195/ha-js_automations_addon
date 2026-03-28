
const path = require('path');
const fs = require('fs');
const ScriptHeaderParser = require('./script-header-parser');

class EntityManager {

    /**
     * @param {object} haConnection - The Home Assistant connection manager.
     * @param {object} workerManager - The worker thread manager.
     * @param {object} stateManager - The script state persistence manager.
     * @param {object} depManager - The dependency manager for NPM packages.
     * @param {object} systemService - The system monitoring service.
     * @param {object} compilerManager - The TypeScript compiler manager.
     */
    constructor(haConnection, workerManager, stateManager, depManager, systemService, compilerManager) {
        this.haConnection = haConnection;
        this.workerManager = workerManager;
        this.stateManager = stateManager;
        this.depManager = depManager;
        this.systemService = systemService;
        this.compilerManager = compilerManager;
        this.typingTimer = null;

        this.haConnection.subscribeToEvents(this.handleEvent.bind(this));
        this.workerManager.on('script_start', (data) => this.handleScriptLifecycle(data, 'start'));
        this.workerManager.on('script_exit', (data) => this.handleScriptLifecycle(data, 'stop'));
        this.workerManager.on('request_device_cleanup', (name) => this.checkDeviceCleanup(name));
        this.systemService.on('system_stats_updated', (stats) => this.updateSystemStates(stats));
        
        // Listen for store changes to update TypeScript definitions reactively
        if (this.workerManager.storeManager) {
            this.workerManager.storeManager.on('changed', () => this.generateTypeDefinitions());
        }

        this.startWatcher();
    }

    /**
     * Generates a dynamic TypeScript definition file for all HA entities.
     * This enables IntelliSense for ha.states['entity_id'] in Monaco.
     */
    generateTypeDefinitions() {
        if (this.typingTimer) clearTimeout(this.typingTimer);

        this.typingTimer = setTimeout(async () => {
            try {
                const states = this.haConnection.states || {};
                const services = this.haConnection.services || {};
                const entityIds = Object.keys(states);
                const storeData = this.workerManager.storeManager ? this.workerManager.storeManager.getAll() : {};
                
                let content = `/** Automatically generated entity definitions **/\n\n`;
                content += `interface HAEntities {\n`;
                
                const attrMapping = {
                    light: 'LightAttributes',
                    media_player: 'MediaPlayerAttributes',
                    climate: 'ClimateAttributes',
                    sensor: 'SensorAttributes',
                    binary_sensor: 'HAAttributes'
                };

                entityIds.forEach(id => {
                    const stateObj = states[id];
                    const friendlyName = stateObj.attributes?.friendly_name || '';
                    const domain = id.split('.')[0];
                    const attrType = attrMapping[domain] || 'HAAttributes';

                    content += `  /** ${friendlyName} */\n`;
                    content += `  "${id}": HAState<${attrType}>;\n`;
                });
                
                content += `}\n\n`;

                content += `interface ServiceMap {\n`;
                for (const [domain, domainServices] of Object.entries(services)) {
                    content += `  "${domain}": {\n`;
                    for (const [service, details] of Object.entries(domainServices)) {
                        const description = (details.description || '').replace(/\*/g, '').replace(/\n/g, ' ');
                        content += `    /** ${description} */\n`;
                        content += `    "${service}": {\n`;
                        if (details.fields) {
                            for (const [field, fDetails] of Object.entries(details.fields)) {
                                const fDesc = (fDetails.description || '').replace(/\*/g, '').replace(/\n/g, ' ');
                                content += `      /** ${fDesc} */\n`;
                                content += `      "${field}"?: any;\n`;
                            }
                        }
                        content += `      [key: string]: any;\n`;
                        content += `    };\n`;
                    }
                    content += `  };\n`;
                }
                content += `}\n\n`;

                // Generate GlobalStoreSchema based on actual store content
                content += `interface GlobalStoreSchema {\n`;
                for (const [key, entry] of Object.entries(storeData)) {
                    if (Object.prototype.hasOwnProperty.call(storeData, key)) {
                        const value = entry.value;
                        const inferredType = this._inferStoreValueType(value);
                        content += `  /**\n`;
                        content += `   * Stored value for key "${key}"\n`;
                        content += `   */\n`;
                        content += `  "${key}": ${inferredType};\n`;
                    }
                }
                content += `}\n\n`;

                content += `/** Merges dynamic types into the global HA interface **/\n`;
                content += `interface HA {\n`;
                content += `  readonly states: HAEntities;\n`;
                content += `}\n`;

                const filePath = path.join(this.workerManager.storageDir, 'entities.d.ts');
                fs.writeFileSync(filePath, content, 'utf8');
                this.workerManager.emit('typings_generated');
                this.workerManager.emit('log', { source: 'System', message: `Updated entities.d.ts with ${entityIds.length} entities.`, level: 'debug' });
            } catch (e) {
                console.error("Failed to generate entities.d.ts:", e);
            }
        }, 2000); // Debounce to avoid constant writes during state storms
    }

    /**
     * Infers a basic TypeScript type from a JavaScript value.
     * @private
     */
    _inferStoreValueType(value, depth = 0) {
        if (depth > 3) return 'any'; // Prevent deep recursion or huge definitions
        if (value === null) return 'null';
        if (typeof value === 'string') return 'string';
        if (typeof value === 'number') return 'number';
        if (typeof value === 'boolean') return 'boolean';
        if (Array.isArray(value)) {
            if (value.length === 0) return 'any[]';
            const subType = this._inferStoreValueType(value[0], depth + 1);
            return `${subType}[]`;
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) return 'Record<string, any>';
            
            // Build a small interface representation for the object
            let objDef = '{ ';
            for (const key of keys.slice(0, 10)) { // Limit to first 10 keys for readability
                objDef += `"${key}": ${this._inferStoreValueType(value[key], depth + 1)}; `;
            }
            if (keys.length > 10) objDef += '... ';
            objDef += '}';
            return objDef;
        }
        return 'any';
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

    /**
     * Updates the HA state of a script's control entity (switch/button) 
     * based on its running status.
     */
    async handleScriptLifecycle({ filename, meta }, action) {
        if (!meta || !meta.expose || !this.haConnection.isReady) return;

        const ext = path.extname(filename);
        const scriptName = path.basename(filename, ext);
        const domain = meta.expose === 'button' ? 'button' : 'switch';
        const uniqueId = `jsa_${domain}_${scriptName}`.toLowerCase();
        const isRunning = (action === 'start');

        // Update internal state manager
        const entityId = `${domain}.jsa_${scriptName}`.toLowerCase();
        this.stateManager.set(entityId, isRunning ? 'on' : 'off');

        // Update Home Assistant
        try {
            const hasIntegration = await this.haConnection.checkIntegrationAvailable();
            if (hasIntegration) {
                const payload = { 
                    unique_id: uniqueId, 
                    state: isRunning ? 'on' : 'off'
                };
                
                // Icon adjustments based on state
                if (domain === 'switch') {
                    payload.icon = isRunning ? 'mdi:stop' : (meta.icon || 'mdi:play');
                }

                await this.haConnection.callService('js_automations', 'update_entity', payload);
            } else {
                // Fallback for legacy mode
                const legacyIcon = domain === 'switch' ? (isRunning ? 'mdi:stop' : 'mdi:play') : meta.icon;
                await this.haConnection.updateState(entityId, isRunning ? 'on' : 'off', { icon: legacyIcon });
            }
        } catch (e) {
            console.error(`[EntityManager] Failed to update lifecycle state for ${scriptName}:`, e.message);
        }
    }

    /**
     * Robust extraction helper for numeric values from various data structures.
     * @private
     */
    _getNumericValue(raw, keys) {
        if (raw === undefined || raw === null) return undefined;
        if (typeof raw === 'object') {
            for (const key of keys) {
                if (raw[key] !== undefined && raw[key] !== null) return parseFloat(raw[key]);
            }
            return undefined;
        }
        return parseFloat(raw);
    }

    /**
     * Updates the actual state of the system entities in Home Assistant.
     * Called whenever the SystemService provides new statistics.
     */
    async updateSystemStates(stats) {
        if (!this.haConnection.isReady) return;
        
        // Defensive extraction for CPU
        const cpuValue = this._getNumericValue(stats.cpu, ['usage', 'percent', 'percentage']);

        // Defensive extraction for RAM
        // Check multiple common property names for memory stats.
        // statusbar.js uses 'app_ram' (Node RSS) and 'app_heap' (V8 Memory).
        let ramRaw = stats.ram;
        if (ramRaw === undefined) ramRaw = stats.memory;
        if (ramRaw === undefined) ramRaw = stats.mem;
        if (ramRaw === undefined) ramRaw = stats.app_ram;
        if (ramRaw === undefined) ramRaw = stats.app_heap;

        const ramValue = this._getNumericValue(ramRaw, ['used', 'usage', 'mem_usage', 'percentage', 'percent', 'value', 'rss', 'heapUsed', 'app_ram']);

        const updates = [
            { unique_id: 'jsa_system_cpu_usage', state: cpuValue },
            { unique_id: 'jsa_system_mem_usage', state: ramValue }
        ];

        for (const update of updates) {
            if (update.state === undefined || update.state === null || isNaN(update.state)) continue;
            try {
                await this.haConnection.callService('js_automations', 'update_entity', update);
            } catch (e) {
                // Ignore errors during periodic updates to prevent log spam
            }
        }
    }

    /**
     * Ensures that system-wide entities (CPU, RAM) are registered 
     * within the central "JS Automations" device.
     */
    async createSystemEntities() {
        const payloadBase = {
            device_info: {
                identifiers: [['js_automations', 'jsa_system_device']],
                name: "JS Automations",
                manufacturer: "JS Automations",
                model: "System",
            },
            attributes: { source: 'JS Automations Addon' }
        };

        const entities = [
            { unique_id: 'jsa_system_cpu_usage', name: 'System CPU Usage', icon: 'mdi:chip', unit_of_measurement: '%', state_class: 'measurement', entity_id: 'sensor.jsa_system_cpu_usage' },
            { unique_id: 'jsa_system_mem_usage', name: 'System RAM Usage', icon: 'mdi:memory', unit_of_measurement: 'MB', state_class: 'measurement', entity_id: 'sensor.jsa_system_mem_usage' }
        ];

        for (const entity of entities) {
            try {
                const fullPayload = { ...payloadBase, ...entity };
                await this.haConnection.callService('js_automations', 'create_entity', fullPayload);
                
                // Register in the native registry so the system knows these are managed entities.
                // This is crucial for state updates and persistence.
                this.workerManager.registerEntity('system', entity.entity_id, fullPayload);
            } catch (e) {
                this.workerManager.emit('log', { 
                    source: 'System', 
                    message: `[EntityManager] Failed to register system entity ${entity.unique_id}: ${e.message}`, 
                    level: 'error' 
                });
            }
        }
    }

    async createExposedEntities(hasIntegration = false, onlyIfMissing = false) {
        const scripts = await this.workerManager.getScripts();
        
        // Metadaten für Lookup laden
        const { areas, labels } = await this.haConnection.getHAMetadata();

        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Syncing exposed entities for ${scripts.length} scripts`, level: 'debug' });

        // Register system entities if integration is active
        if (hasIntegration) {
            await this.createSystemEntities();
            
            // Initial generation of type definitions for Monaco
            this.generateTypeDefinitions();
        }

        for (const scriptPath of scripts) {
            // Skip libraries (they are passive and live in /libraries subfolder)
            if (path.basename(path.dirname(scriptPath)) === 'libraries') continue;

            const meta = ScriptHeaderParser.parse(scriptPath);
            const ext = path.extname(scriptPath);
            const scriptName = path.basename(scriptPath, ext);
            
            const protectedIds = [];
            // Nur wenn @expose gesetzt ist, erstellen wir eine Entität
            if (!meta.expose) continue;

            // Check current state (for reconnects/restarts)
            const isRunning = this.workerManager.workers.has(scriptPath);

            const domain = meta.expose === 'button' ? 'button' : 'switch';
            const entityId = `${domain}.jsa_${scriptName}`.toLowerCase();
            
            let entityIcon = meta.icon;
            if (domain === 'button') entityIcon = 'mdi:play';
            else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

            const initialState = (domain === 'switch' && isRunning) ? 'on' : 'off';

            if (hasIntegration) {
                // Native Creation (Persistent & Unique ID)
                const uniqueId = `jsa_${domain}_${scriptName}`.toLowerCase();

                // IDs auflösen
                const areaId = this.resolveId(meta.area, areas, 'area_id');
                
                // Labels auflösen (Array oder Komma-String)
                let resolvedLabels = [];
                if (meta.label) {
                    const rawLabels = Array.isArray(meta.label) ? meta.label : String(meta.label).split(',');
                    resolvedLabels = rawLabels.map(l => {
                        const id = this.resolveId(l, labels, 'label_id');
                        if (!id) this.workerManager.emit('log', { source: 'System', message: `⚠️ Could not resolve Label '${l.trim()}' for ${scriptName}`, level: 'warn' });
                        return id;
                    }).filter(id => id);
                }

                if (meta.area && !areaId) this.workerManager.emit('log', { source: 'System', message: `⚠️ Could not resolve Area '${meta.area}' for ${scriptName}`, level: 'warn' });
                
                const payload = {
                    entity_id: entityId,
                    unique_id: uniqueId,
                    name: meta.name,
                    icon: entityIcon,
                    area_id: areaId,
                    labels: resolvedLabels,
                    device_info: {
                        identifiers: [['js_automations', `jsa_script_${scriptName}`]],
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

                // SKIP Check: If onlyIfMissing is requested and entity exists/healthy
                let skipHA = false;
                if (onlyIfMissing) {
                    const currentState = this.haConnection.states[entityId];
                    if (currentState && currentState.state !== 'unavailable' && currentState.state !== 'unknown') {
                        skipHA = true;
                    }
                }

                if (!skipHA) {
                    await this.haConnection.callService('js_automations', 'create_entity', payload);
                }

                // Register in central registry for lifecycle management
                this.workerManager.registerEntity(path.basename(scriptPath), entityId, payload);
                protectedIds.push(entityId);
            } else {
                // Legacy Creation (Ephemeral)
                // Buttons werden in Legacy als Switch simuliert (da Button-Domain nicht via HTTP setzbar ist ohne State)
                // Wir erstellen sie trotzdem, damit sie im UI auftauchen.
                if (domain === 'switch' || domain === 'button') {
                    this.haConnection.createEntity(domain, scriptName, 'jsa', {
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
            this.workerManager.setProtectedEntities(path.basename(scriptPath), protectedIds);
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

            // PROTECT SYSTEM ENTITIES: Explicitly skip any system related unique_ids
            if (entity.unique_id && (entity.unique_id.includes('_system_'))) {
                continue;
            }

            if (device && device.identifiers) {
                // Only look for script identifiers to determine ownership
                const mainIdentifier = device.identifiers.find(idPair => 
                    idPair.length > 1 && 
                    idPair[0] === 'js_automations' && 
                    (idPair[1].startsWith('jsa_script_') || idPair[1].startsWith('js_automations_script_'))
                );

                if (mainIdentifier) {
                    const idStr = mainIdentifier[1];
                    scriptName = idStr.startsWith('jsa_script_') 
                        ? idStr.substring('jsa_script_'.length)
                        : idStr.substring('js_automations_script_'.length);
                }
            }

            if (!scriptName) {
                const parts = entity.unique_id.split('_');
                if (parts[0] === 'jsa') {
                     scriptName = parts.slice(2).join('_');
                } else if (parts.length > 3 && parts[0] === 'js' && parts[1] === 'automations') {
                     scriptName = parts.slice(3).join('_');
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
            } else if (entity.unique_id && entity.unique_id.startsWith('js_automations_')) {
                // Migration: Remove old prefix if the new one should exist
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Removing legacy prefix entity ${entity.entity_id} for migration.`, level: 'debug' });
                await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: entity.unique_id });
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
                
                // SAFETY: Only prune if it's explicitly a script device identifier.
                // This protects the main "JS Automations" system device from accidental pruning.
                const identifiers = device.identifiers
                    .filter(idPair => idPair[1].includes('_script_'))
                    .map(idPair => idPair[1]);
                
                if (identifiers.length > 0) {
                    await this.haConnection.callService('js_automations', 'remove_device', { 
                        identifiers: identifiers // The integration expects a list of ID strings
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
                identifiers: [`jsa_script_${scriptName}`] 
            });
        }
    }

    startWatcher() {
        if (!this.workerManager.scriptsDir) return;
        
        // Simple debounce map to avoid double events on save
        const debounceTimers = new Map();
        
        const onWatch = (dir, eventType, filename) => {
            if (filename && (filename.endsWith('.js') || filename.endsWith('.ts'))) {
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
        const extension = path.extname(scriptPath);
        const scriptName = path.basename(scriptPath, extension);
        const fileName = path.basename(scriptPath);

        // --- DELETION HANDLING for deleted file ---
        if (!fs.existsSync(scriptPath)) {
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Script file deleted: ${fileName}. Starting cleanup for ${scriptName}`, level: 'debug' });
            
            this.workerManager.stopScript(fileName, 'file deleted');
            await this.workerManager.removeScriptEntities(fileName);
            this.stateManager.unregisterScript(scriptPath);

            if (extension === '.ts') {
                this.compilerManager.cleanup(scriptPath);
            }

            // Update types after deletion
            this.generateTypeDefinitions();
            return; 
        }
        
        try {
            if (extension === '.ts') {
                const success = await this.compilerManager.transpile(scriptPath);
                if (!success) return; 
            }

            const meta = ScriptHeaderParser.parse(scriptPath);

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

            // --- SMART CLEANUP for Type Changes ---
            // If script changed from switch to button (or vice versa), remove the opposite one.
            try {
                const otherDomain = meta.expose === 'button' ? 'switch' : 'button';
                const idsToRemove = [
                    `jsa_${otherDomain}_${scriptName}`,
                    `js_automations_${otherDomain}_${scriptName}`
                ];
                
                // If no expose at all, remove both
                if (!meta.expose) {
                    idsToRemove.push(`jsa_switch_${scriptName}`, `jsa_button_${scriptName}`);
                }

                for (const uid of idsToRemove) {
                    await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: uid });
                }
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
            const entityId = `${domain}.jsa_${scriptName}`.toLowerCase();
            const uniqueId = `jsa_${domain}_${scriptName}`.toLowerCase();
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
                    identifiers: [['js_automations', `jsa_script_${scriptName}`]],
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
                    if (!id) this.workerManager.emit('log', { source: 'System', message: `⚠️ Could not resolve Label '${l.trim()}' for ${scriptName}`, level: 'warn' });
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

            // Update types after new script processing
            this.generateTypeDefinitions();

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
