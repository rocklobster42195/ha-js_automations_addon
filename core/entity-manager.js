
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
        this.startWatcher();
    }

    /**
     * Versucht, einen Namen (z.B. "Wohnzimmer") in eine ID (z.B. "wohnzimmer") aufzulösen.
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

        for (const scriptPath of scripts) {
            // Skip libraries (they are passive and live in /libraries subfolder)
            if (path.basename(path.dirname(scriptPath)) === 'libraries') continue;

            const meta = ScriptParser.parse(scriptPath);
            const scriptName = path.basename(scriptPath, '.js');
            
            // Nur wenn @expose gesetzt ist, erstellen wir eine Entität
            if (!meta.expose) continue;

            const domain = meta.expose === 'button' ? 'button' : 'switch';
            const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();
            const entityIcon = domain === 'button' ? 'mdi:play' : meta.icon;
            
            // Check current state (for reconnects/restarts)
            const isRunning = this.workerManager.workers.has(scriptPath);
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
                    if (isRunning) payload.icon = 'mdi:play';
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
                        icon: entityIcon,
                    });
                    
                    // Bei Legacy müssen wir den State separat setzen, falls er 'on' sein soll
                    if (initialState === 'on') {
                        this.haConnection.updateState(entityId, 'on', { icon: 'mdi:play' });
                    }
                }
            }

            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, initialState);
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
            console.log(`[EntityManager] Script deleted: ${scriptName}. Cleaning up entities...`);
            
            // 1. Clean up dynamic entities (via WorkerManager)
            await this.workerManager.removeScriptEntities(scriptPath);

            // 2. Clean up exposed entities (Switch/Button) - Blind cleanup based on ID pattern
            const hasIntegration = await this.haConnection.checkIntegrationAvailable();
            if (hasIntegration) {
                const domains = ['switch', 'button'];
                for (const domain of domains) {
                    const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();
                    try {
                        await this.haConnection.callService('js_automations', 'remove_entity', { unique_id: uniqueId });
                    } catch (e) { /* Ignore if not exists */ }
                }
            }
            return;
        }
        
        try {
            const meta = ScriptParser.parse(scriptPath);
            const fileName = path.basename(scriptPath);

            // 1. Library Handling: Check dependents
            if (path.basename(path.dirname(scriptPath)) === 'libraries') {
                const runningScripts = Array.from(this.workerManager.workers.keys());
                for (const runningScriptFile of runningScripts) {
                    const runningScriptPath = path.join(this.workerManager.scriptsDir, runningScriptFile);
                    // Parse running script to check includes (lightweight op)
                    const runningMeta = ScriptParser.parse(runningScriptPath);
                    
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
            
            // Metadaten für Lookup laden
            const { areas, labels } = await this.haConnection.getHAMetadata();
            
            // Wir prüfen beide möglichen Domänen, um ggf. alte Typen zu löschen (z.B. Wechsel von switch zu button)
            const domains = ['switch', 'button'];

            for (const domain of domains) {
                const shouldExist = meta.expose === domain;
                const uniqueId = `js_automations_${domain}_${scriptName}`.toLowerCase();
                const entityId = `${domain}.js_automations_${scriptName}`.toLowerCase();
                const entityIcon = domain === 'button' ? 'mdi:play' : meta.icon;

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
