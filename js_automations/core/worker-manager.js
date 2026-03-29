/**
 * JS AUTOMATIONS - Worker Manager (v2.16.x)
 * Handles lifecycle, message routing, and event subscriptions.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const ScriptHeaderParser = require('./script-header-parser');

class WorkerManager extends EventEmitter {
    constructor() {
        super();
        this.workers = new Map();
        this.stopReasons = new Map();
        this.lastExitState = new Map();
        this.stats = new Map();
        this.restartTracker = new Map(); // Trackt Startzeiten für Loop-Protection
        this.startTimes = new Map();
        this.haConnector = null;
        this.storeManager = null;
        this.settings = {
            restart_protection_count: 5,
            restart_protection_time: 60000,
            node_memory: 256,
            ui_language: 'auto',
            default_throttle: 0
        };
        this.subscriptions = new Map(); // filename -> patterns[]
        this.storageDir = ''; 
        this.scriptsDir = '';
        this.distDir = '';
        this.systemLanguage = 'en';
        this.nativeEntities = new Map(); // Trackt Entitäten: entityId -> Payload (Config)
        this.activeRunEntities = new Map(); // Track entities registered during the current script run (Mark-and-Sweep)
        this.protectedEntities = new Map(); // Track entities from headers (@expose) to protect them from sweep: filename -> Set<entityId>
        this.scriptEntityMap = new Map(); // RAM-Cache: filename -> Set<entityId>
        this.registryPath = '';
        this.saveRegistryTimer = null; // Timer für Debounce

        // RAM Polling: Alle 5 Sekunden Stats von allen Workern anfordern
        setInterval(() => this.broadcastToWorkers({ type: 'get_stats' }), 5000);
    }

    /**
     * Loads the persistent registry of dynamic entities from storage.
     */
    loadRegistry() {
        this.registryPath = path.join(this.storageDir, 'entity_registry.json');
        this.emit('log', { source: 'System', message: `[WorkerManager] Loading entity registry from ${this.registryPath}`, level: 'debug' });
        if (fs.existsSync(this.registryPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
                for (const [file, entitiesObj] of Object.entries(data)) {
                    const entityIds = Object.keys(entitiesObj);
                    this.scriptEntityMap.set(file, new Set(entityIds));
                    
                    // Restore nativeEntities payloads so we can delete them even after restart
                    for (const [entityId, payload] of Object.entries(entitiesObj)) {
                        this.nativeEntities.set(entityId, payload);
                    }
                }
            } catch (e) {
                this.emit('log', { source: 'System', message: `Failed to load entity_registry.json: ${e.message}`, level: 'error' });
            }
        }
    }

    /**
     * Führt den physischen Speichervorgang durch.
     * @private
     */
    _performSaveRegistry() {
        if (!this.registryPath) return;
        try {
            this.emit('log', { source: 'System', message: `[WorkerManager] Saving entity registry to: ${this.registryPath}`, level: 'debug' });
            const data = {};
            for (const [file, entityIds] of this.scriptEntityMap.entries()) {
                data[file] = {};
                for (const id of entityIds) {
                    const payload = this.nativeEntities.get(id);
                    if (payload) {
                        data[file][id] = payload;
                    }
                }
            }
            fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error("Failed to save entity_registry.json", e);
        }
    }

    /**
     * Persists the current entity registry to a JSON file.
     */
    saveRegistry() {
        if (!this.registryPath) return;

        // Debounce: Bestehenden Timer abbrechen und neu starten
        if (this.saveRegistryTimer) clearTimeout(this.saveRegistryTimer);

        this.saveRegistryTimer = setTimeout(() => {
            this._performSaveRegistry();
            this.saveRegistryTimer = null;
        }, 1000); // 1 Sekunde warten bevor gespeichert wird
    }

    setConnector(connector) { 
        this.haConnector = connector; 
        if (connector) {
            // Automatisch Dienste synchronisieren, sobald die Verbindung steht
            setTimeout(() => this.syncServiceDefinitions(), 3000);
        }
    }

    /**
     * Ruft alle verfügbaren Dienste von HA ab und generiert eine services.d.ts für IntelliSense.
     */
    async syncServiceDefinitions() {
        if (!this.haConnector || !this.haConnector.isReady) return;
        
        try {
            this.emit('log', { source: 'System', message: 'Synchronizing Home Assistant service definitions...', level: 'debug' });
            const services = await this.haConnector.getServices() || {};
            
            let dts = "/** AUTO-GENERATED - DO NOT EDIT **/\n\ninterface ServiceMap {\n";
            
            for (const [domain, domainServices] of Object.entries(services)) {
                dts += `  "${domain}": {\n`;
                for (const [service, details] of Object.entries(domainServices)) {
                    const cleanDesc = (details.description || '').replace(/\*/g, '').replace(/\n/g, ' ');
                    dts += `    /** ${cleanDesc} */\n`;
                    dts += `    "${service}": {\n`;
                    if (details.fields) {
                        for (const [field, fDetails] of Object.entries(details.fields)) {
                            const type = this._mapHaTypeToTs(fDetails);
                            const fieldDesc = (fDetails.description || '').replace(/\*/g, '').replace(/\n/g, ' ');
                            const isOptional = fDetails.required ? '' : '?';
                            dts += `      "${field}"${isOptional}: ${type}; // ${fieldDesc}\n`;
                        }
                    }
                    dts += `    };\n`;
                }
                dts += `  };\n`;
            }
            dts += "}\n";

            const targetPath = path.join(this.storageDir, 'services.d.ts');
            fs.writeFileSync(targetPath, dts);
            
            this.emit('log', { source: 'System', message: `ServiceMap generated: ${Object.keys(services).length} domains mapped.`, level: 'info' });
        } catch (e) {
            this.emit('log', { source: 'System', message: `Failed to sync services: ${e.message}`, level: 'error' });
        }
    }

    _mapHaTypeToTs(field) {
        if (field.selector?.boolean !== undefined) return 'boolean';
        if (field.selector?.number !== undefined) return 'number';
        if (field.selector?.select !== undefined) {
            const options = field.selector.select.options;
            if (Array.isArray(options)) return options.map(o => `'${o.value || o}'`).join(' | ');
            return 'string';
        }
        if (field.selector?.text !== undefined) return 'string';
        return 'any';
    }

    setStore(store) { this.storeManager = store; }
    setSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.emit('log', { source: 'System', message: `Settings updated. Restart protection: ${this.settings.restart_protection_count} starts in ${this.settings.restart_protection_time / 1000}s.`, level: 'debug' });
    }
    setStorageDir(dir) { 
        this.storageDir = dir;
        this.distDir = path.join(dir, 'dist');
        this.loadRegistry();
        this.saveRegistry(); // Ensure file exists even if empty
        this.ensureApiDefinitions();
    }

    /**
     * Ensures that the ha-api.d.ts entry point exists in the storage directory
     * so that the browser editor can resolve types correctly.
     */
    ensureApiDefinitions() {
        if (!this.storageDir) return;
        try {
            const masterPath = path.join(__dirname, 'types', 'ha-api.d.ts');
            const targetPath = path.join(this.storageDir, 'ha-api.d.ts');
            
            if (fs.existsSync(masterPath)) {
                fs.copyFileSync(masterPath, targetPath);
            }
        } catch (e) {
            this.emit('log', { source: 'System', message: `Failed to sync ha-api.d.ts: ${e.message}`, level: 'error' });
        }
    }
    setScriptsDir(dir) { this.scriptsDir = dir; }

    setSystemLanguage(lang) {
        this.systemLanguage = lang;
    }

    /**
     * Defines which entities are "protected" (e.g. from @expose header).
     * These will be ignored by the Mark-and-Sweep cleanup.
     */
    setProtectedEntities(filename, entityIds) {
        this.protectedEntities.set(filename, new Set(entityIds));
    }

    /**
     * Registers an entity in the central registry.
     * Used by EntityManager for exposed entities and internally for dynamic ones.
     */
    registerEntity(filename, entityId, payload) {
        this.nativeEntities.set(entityId, payload);
        if (!this.scriptEntityMap.has(filename)) {
            this.scriptEntityMap.set(filename, new Set());
        }
        this.scriptEntityMap.get(filename).add(entityId);
        this.saveRegistry();
    }

    /**
     * Removes a specific entity from HA and the registry.
     */
    async unregisterEntity(filename, entityId) {
        const payload = this.nativeEntities.get(entityId);
        if (payload && payload.unique_id && this.haConnector) {
            try {
                this.emit('log', { source: 'System', message: `[WorkerManager] Removing entity ${entityId} from HA`, level: 'debug' });
                await this.haConnector.callService('js_automations', 'remove_entity', { unique_id: payload.unique_id });
            } catch (e) { /* Ignore if already gone */ }
        }
        this.nativeEntities.delete(entityId);
        if (this.scriptEntityMap.has(filename)) {
            this.scriptEntityMap.get(filename).delete(entityId);
        }
        this.saveRegistry();
        const scriptName = path.basename(filename, path.extname(filename));
        this.emit('request_device_cleanup', scriptName);
    }

    getScripts() {
        if (!this.scriptsDir) return [];
        const results = [];
        
        // 1. Automations (Root)
        const files = fs.readdirSync(this.scriptsDir).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'));
        
        // Prioritize TS over JS for same-named files to avoid duplicates
        const tsBasenames = new Set(files.filter(f => f.endsWith('.ts')).map(f => path.basename(f, '.ts')));
        const filteredFiles = files.filter(f => {
            if (f.endsWith('.js')) {
                return !tsBasenames.has(path.basename(f, '.js'));
            }
            return true;
        });

        results.push(...filteredFiles.map(f => path.join(this.scriptsDir, f)));

        // 2. Libraries (Subfolder)
        const libDir = path.join(this.scriptsDir, 'libraries');
        if (fs.existsSync(libDir)) {
            const libs = fs.readdirSync(libDir).filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'));
            results.push(...libs.map(f => path.join(libDir, f)));
        }
        return results;
    }

    getScriptStats(filename) {
        return this.stats.get(filename);
    }

    /**
     * Sendet alle registrierten nativen Entitäten erneut an HA.
     * @param {boolean} onlyIfMissing - Wenn true, werden existierende Entitäten übersprungen (Integritäts-Check).
     */
    async republishNativeEntities(onlyIfMissing = false) {
        if (!this.haConnector || this.nativeEntities.size === 0) return;
        
        let count = 0;
        const total = this.nativeEntities.size;
        
        if (!onlyIfMissing) {
            this.emit('log', { source: 'System', message: `Syncing ${total} native entities...`, level: 'debug' });
        }
        
        for (const [entityId, payload] of this.nativeEntities) {
            try {
                // Check current state in HA cache
                const currentState = this.haConnector.states[entityId];
                const isAlive = currentState && currentState.state !== 'unavailable' && currentState.state !== 'unknown';

                // Scenario 1: Integrity Check (Hourly) - Skip if healthy
                if (onlyIfMissing && isAlive) {
                    continue;
                }

                // Scenario 2: Smart Republish (Reconnect)
                // Preserve dynamic state (icon, attributes) instead of resetting to initial config.
                let finalPayload = { ...payload };
                
                if (isAlive && !onlyIfMissing) {
                    finalPayload.state = currentState.state;
                    if (currentState.attributes) {
                        if (currentState.attributes.icon) finalPayload.icon = currentState.attributes.icon;
                        const exclude = ['friendly_name', 'icon', 'access_token', 'entity_picture', 'supported_features', 'restored'];
                        finalPayload.attributes = { ...finalPayload.attributes }; 
                        for (const [k, v] of Object.entries(currentState.attributes)) {
                            if (!exclude.includes(k)) finalPayload.attributes[k] = v;
                        }
                    }
                }

                await this.haConnector.callService('js_automations', 'create_entity', finalPayload);
                count++;
            } catch (e) {
                this.emit('log', { source: 'System', message: `Failed to republish ${entityId}: ${e.message}`, level: 'warn' });
            }
        }
        
        if (count > 0) {
            this.emit('log', { source: 'System', message: `Republished ${count} entities (Skipped ${total - count} healthy ones).`, level: 'debug' });
        }
    }

    /**
     * Removes all native entities created by a specific script.
     */
    async removeScriptEntities(filename) {
        this.lastExitState.delete(filename);
        this.restartTracker.delete(filename);
        this.stopReasons.delete(filename);
        this.protectedEntities.delete(filename);
        this.emit('log', { source: 'System', message: `[WorkerManager] Cleaning up metadata for ${filename}`, level: 'debug' });

        // Case-insensitive lookup for the filename in the map
        let actualKey = filename;
        if (!this.scriptEntityMap.has(filename)) {
            const lowerName = filename.toLowerCase();
            for (const key of this.scriptEntityMap.keys()) {
                if (key.toLowerCase() === lowerName) {
                    actualKey = key;
                    break;
                }
            }
        }

        // Clean up entities if any exist
        if (this.scriptEntityMap.has(actualKey)) {
            const entities = this.scriptEntityMap.get(actualKey);
            this.emit('log', { source: 'System', message: `Cleaning up ${entities.size} dynamic entities for script: ${path.basename(filename)}`, level: 'info' });
            
            for (const entityId of entities) {
                const payload = this.nativeEntities.get(entityId);
                if (payload && payload.unique_id && this.haConnector) {
                    try {
                        await this.haConnector.callService('js_automations', 'remove_entity', { unique_id: payload.unique_id });
                    } catch (e) { /* Ignore errors during cleanup */ }
                }
                this.nativeEntities.delete(entityId);
            }
        }

        this.scriptEntityMap.delete(actualKey);
        this.saveRegistry();

        // Request device cleanup check
        const scriptName = path.basename(filename, path.extname(filename));
        this.emit('request_device_cleanup', scriptName);
    }

    /**
     * Removes dynamic entities that were previously registered but are no longer present in the script code.
     * This is part of the Mark-and-Sweep logic triggered after script start.
     * @param {string} filename The script filename.
     * @private
     */
    async _sweepOrphanedDynamicEntities(filename) {
        // If the script was stopped or restarted in the meantime, we skip the sweep for this specific run
        if (!this.workers.has(filename)) return;

        const knownEntities = this.scriptEntityMap.get(filename);
        const currentRunEntities = this.activeRunEntities.get(filename);
        const protectedEntities = this.protectedEntities.get(filename) || new Set();

        if (!knownEntities || !currentRunEntities) return;

        this.emit('log', { source: 'System', message: `[WorkerManager] Running sweep for orphaned dynamic entities in ${filename}`, level: 'debug' });

        for (const entityId of knownEntities) {
            // Skip entities defined in headers (@expose)
            if (protectedEntities.has(entityId)) continue;

            if (!currentRunEntities.has(entityId)) {
                this.emit('log', { source: 'System', message: `[WorkerManager] Entity ${entityId} is no longer requested by ${filename}. Removing from Home Assistant.`, level: 'debug' });
                
                const payload = this.nativeEntities.get(entityId);
                if (payload && payload.unique_id && this.haConnector) {
                    try {
                        await this.haConnector.callService('js_automations', 'remove_entity', { unique_id: payload.unique_id });
                    } catch (e) { /* Ignore errors if entity already gone */ }
                }
                this.nativeEntities.delete(entityId);
                knownEntities.delete(entityId);
            }
        }

        this.saveRegistry();
        
        // Check if the device should be removed (if no entities are left)
        const scriptName = path.basename(filename, path.extname(filename));
        this.emit('request_device_cleanup', scriptName);
    }

    /**
     * Starts a script in an isolated thread.
     */
    startScript(filename) {
        let fullPath = path.isAbsolute(filename) ? filename : path.join(this.scriptsDir, filename);
        const isTypeScript = fullPath.endsWith('.ts');
        let executionPath = fullPath;

        if (!fs.existsSync(fullPath)) {
            this.emit('log', { source: 'System', message: `Script not found: ${filename}`, level: 'error' });
            return;
        }

        if (isTypeScript) {
            const relativePath = path.relative(this.scriptsDir, fullPath);
            const compiledPath = path.join(this.distDir, relativePath.replace(/\.ts$/, '.js'));
            
            if (!fs.existsSync(compiledPath)) {
                const displayFile = path.basename(filename);
                this.emit('log', { source: 'System', message: `Compiled version for ${displayFile} not found in dist. Was it transpiled? Check logs for Compiler errors.`, level: 'error' });
                return;
            }
            executionPath = compiledPath;
        }

        const scriptMeta = ScriptHeaderParser.parse(fullPath);
        const { name } = scriptMeta;
        const scriptId = scriptMeta.filename;

        // --- SAFEGUARD: Excessive Restart Protection ---
        const now = Date.now();
        const restarts = this.restartTracker.get(scriptId) || [];
        // Nur Starts der letzten 60 Sekunden behalten
        const recentRestarts = restarts.filter(t => now - t < this.settings.restart_protection_time);
        
        if (recentRestarts.length >= this.settings.restart_protection_count) {
            this.emit('log', { source: 'System', message: `🛑 Script '${name}' stopped due to excessive restart rate (>${this.settings.restart_protection_count} restarts in ${this.settings.restart_protection_time / 1000}s).`, level: 'error' });
            this.lastExitState.set(scriptId, 'error');
            return; // Start abbrechen
        }
        recentRestarts.push(now);
        this.restartTracker.set(scriptId, recentRestarts);
        
        // Restart if already running
        if (this.workers.has(scriptId)) {
            this.stopScript(scriptId, 'restarting');
        }

        this.lastExitState.delete(scriptId);
        this.subscriptions.set(scriptId, []);

        // Initialize tracking for entities registered during this run (Mark-and-Sweep)
        this.activeRunEntities.set(scriptId, new Set());
        
        // Schedule a sweep to remove entities that are no longer in the script code.
        // We wait 10 seconds to give the script time to perform its initial ha.register() calls.
        this.emit('log', { source: 'System', message: `[WorkerManager] Scheduled entity sweep for ${scriptId} in 10s`, level: 'debug' });
        setTimeout(() => this._sweepOrphanedDynamicEntities(scriptId), 10000);

        // Prepare initial data dump for the worker
        const initialStoreValues = {};
        if (this.storeManager) {
            for (let k in this.storeManager.data) {
                initialStoreValues[k] = this.storeManager.data[k].value;
            }
        }

        // Determine Memory Limit (Priority: Script Header > Settings > Default)
        let memoryLimit = this.settings.node_memory || 256;
        try {
            // Quick scan for @memory tag since ScriptHeaderParser might not support it yet
            const content = fs.readFileSync(fullPath, 'utf8');
            const match = content.match(/@memory\s+(\d+)/);
            if (match) {
                memoryLimit = parseInt(match[1], 10);
            }
        } catch (e) { /* ignore read error, file existence checked above */ }

        // Determine Language
        const language = (this.settings.ui_language && this.settings.ui_language !== 'auto') 
            ? this.settings.ui_language 
            : (this.systemLanguage || 'en');

        const worker = new Worker(path.join(__dirname, 'worker-wrapper.js'), {
            resourceLimits: {
                maxOldGenerationSizeMb: memoryLimit
            },
            workerData: {
                ...scriptMeta,
                path: executionPath,
                initialStates: this.haConnector ? this.haConnector.states : {},
                initialStore: initialStoreValues,
                storageDir: this.storageDir,
                loglevel: scriptMeta.loglevel || 'info',
                language: language,
                defaultThrottle: this.settings.default_throttle || 0
            },
            env: { 
                ...process.env, 
                NODE_PATH: path.resolve(this.storageDir, 'node_modules') 
            },
            execArgv: ['--enable-source-maps']
        });

        worker.on('message', async (msg) => {
            try {
                // 1. Logging
                if (msg.type === 'log') {
                    this.emit('log', { source: name, message: msg.message, level: msg.level });
                }
                
                // 2. Home Assistant Actions
                if (msg.type === 'call_service' && this.haConnector) {
                    try {
                        const result = await this.haConnector.callService(msg.domain, msg.service, msg.data);
                        if (msg.callId) worker.postMessage({ type: 'service_response', callId: msg.callId, result });
                    } catch (err) {
                        if (msg.callId) worker.postMessage({ type: 'service_response', callId: msg.callId, error: err.message });
                    }
                }

                if (msg.type === 'update_state' && this.haConnector) {
                    // Hybrid-Logik: Wenn nativ bekannt, nutze Service, sonst Legacy HTTP
                    if (this.nativeEntities.has(msg.entityId)) {
                        const entityPayload = this.nativeEntities.get(msg.entityId);
                        try {
                            await this.haConnector.callService('js_automations', 'update_entity', {
                                unique_id: entityPayload.unique_id,
                                state: msg.state,
                                attributes: msg.attributes
                            });
                        } catch (e) {
                            // Fallback bei Fehler (z.B. Integration entladen)
                            let errorMsg = `Native Update failed for ${msg.entityId}: ${e.message}`;
                            if (e.message && (e.message.includes('not found') || e.message.includes('Unable to find service'))) {
                                errorMsg += " -> Check if 'js_automations' integration is installed.";
                            }
                            this.emit('log', { source: 'System', message: errorMsg + " Falling back to legacy.", level: 'warn' });
                            try {
                                await this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
                            } catch (err) { /* ignore */ }
                        }
                    } else {
                        try {
                            await this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
                        } catch (err) {
                            this.emit('log', { source: 'System', message: `Legacy update failed for ${msg.entityId}: ${err.message}`, level: 'error' });
                        }
                    }
                }
                
                // 2b. Native Entity Creation (Integration)
                if (msg.type === 'create_entity' && this.haConnector) {
                    const { entityId, config } = msg;
                    this.emit('log', { source: 'System', message: `Creating native entity: ${entityId}`, level: 'debug' });
                    const payload = await this._prepareEntityPayload(entityId, config, scriptMeta);
                    
                    try {
                        await this.haConnector.callService('js_automations', 'create_entity', payload);
                        this.registerEntity(scriptMeta.filename, entityId, payload);
                        
                        if (this.activeRunEntities.has(scriptMeta.filename)) {
                            this.activeRunEntities.get(scriptMeta.filename).add(entityId);
                        }
                    } catch (e) {
                        this.emit('log', { source: 'System', message: `Dynamic registration failed for ${entityId}: ${e.message}`, level: 'error' });
                    }
                }

                // 3. Subscriptions (ha.on)
                if (msg.type === 'subscribe') {
                    this.subscriptions.get(scriptMeta.filename).push(msg.pattern);
                }

                // 4. Store Operations
                if (msg.type === 'store_set' && this.storeManager) {
                    const currentEntry = this.storeManager.data[msg.key];
                    const currentValue = currentEntry ? currentEntry.value : undefined;

                    if (currentValue !== msg.value) {
                        this.storeManager.set(msg.key, msg.value, name, msg.isSecret);
                        this.broadcastToWorkers({ type: 'store_update', key: msg.key, value: msg.value }, worker);
                    }
                }
                if (msg.type === 'store_delete' && this.storeManager) {
                    if (this.storeManager.data[msg.key] !== undefined) {
                        this.storeManager.delete(msg.key);
                        this.broadcastToWorkers({ type: 'store_update', key: msg.key, value: undefined }, worker);
                    }
                }

                // 5. Stats Response
                if (msg.type === 'stats') {
                    this.stats.set(scriptMeta.filename, {
                        ram_usage: Math.round(msg.heapUsed / 1024 / 1024 * 100) / 100, // MB
                        rss: Math.round(msg.rss / 1024 / 1024 * 100) / 100
                    });
                }

                // 6. Lifecycle Control (ha.restart / ha.stop)
                if (msg.type === 'script_lifecycle') {
                    const reason = msg.reason || (msg.action === 'restart' ? 'restarted by script' : 'stopped by script');
                    this.emit('log', { source: name, message: `Requesting ${msg.action}: ${reason}`, level: 'info' });

                    if (msg.action === 'stop') {
                        this.stopScript(scriptMeta.filename, reason);
                    } else if (msg.action === 'restart') {
                        this.stopScript(scriptMeta.filename, reason);
                        setTimeout(() => this.startScript(fullPath), 500);
                    }
                }
            } catch (err) {
                this.emit('log', { source: name, message: `Service call execution failed: ${err.message}`, level: 'error' });
            }
        });

        worker.on('error', (err) => {
            this.emit('log', { source: name, message: `❌ CRITICAL: ${err.message}`, level: 'error' });
            this.lastExitState.set(scriptMeta.filename, 'error');
        });

        worker.on('exit', (code) => {
            if (this.workers.get(scriptMeta.filename) === worker) {
                this.workers.delete(scriptMeta.filename);
                this.subscriptions.delete(scriptMeta.filename);
                this.stats.delete(scriptMeta.filename);
                this.startTimes.delete(scriptMeta.filename);
                
                let reason = this.stopReasons.get(scriptMeta.filename) || (code === 0 ? 'finished' : `crashed (Code ${code})`);
                const type = (code !== 0 && !this.stopReasons.has(scriptMeta.filename)) ? 'error' : 'success';
                
                if (type === 'error') this.lastExitState.set(scriptMeta.filename, 'error');
                this.stopReasons.delete(scriptMeta.filename);
                
                this.emit('script_exit', { filename: scriptMeta.filename, reason, type, meta: scriptMeta });
            }
        });

        this.workers.set(scriptMeta.filename, worker);
        this.startTimes.set(scriptMeta.filename, Date.now());
        this.emit('script_start', { filename: scriptMeta.filename, meta: scriptMeta });

        // RAM-Messung beschleunigen: Nach 1s direkt anfragen (statt auf 5s Interval warten)
        setTimeout(() => {
            if (this.workers.has(scriptMeta.filename)) worker.postMessage({ type: 'get_stats' });
        }, 1000);
    }

    /**
     * Internal helper to prepare the payload for HA create_entity service.
     * @private
     */
    async _prepareEntityPayload(entityId, config, scriptMeta) {
        const { areas, labels } = await this.haConnector.getHAMetadata();
        
        const resolveId = (input, list, idField) => {
            if (!input || typeof input !== 'string') return undefined;
            const cleanInput = input.trim();
            if (!cleanInput || !list) return undefined;
            const lowerInput = cleanInput.toLowerCase();
            const directMatch = list.find(item => item[idField] === cleanInput);
            if (directMatch) return directMatch[idField];
            const nameMatch = list.find(item => item.name && item.name.toLowerCase() === lowerInput);
            return nameMatch ? nameMatch[idField] : undefined;
        };

        let resolvedAreaId = config.area_id;
        if (!resolvedAreaId && config.area) {
            resolvedAreaId = resolveId(config.area, areas, 'area_id');
        }

        let resolvedLabels = [];
        if (config.labels && Array.isArray(config.labels)) {
            resolvedLabels = config.labels.map(l => resolveId(l, labels, 'label_id')).filter(id => id);
        }

        const payload = {
            entity_id: entityId.replace('js_automations_', 'jsa_'),
            unique_id: config.unique_id || entityId,
            name: config.name || config.friendly_name || entityId,
            icon: config.icon,
            attributes: { ...(config.attributes || {}) }
        };
        
        if (config.initial_state !== undefined) {
            payload.state = config.initial_state;
        }
        
        const haStandardKeys = ['unit_of_measurement', 'device_class', 'state_class', 'entity_picture', 'device_info'];
        const internalKeys = ['entity_id', 'unique_id', 'name', 'friendly_name', 'icon', 'state', 'initial_state', 'area_id', 'area', 'labels', 'device', 'attributes', 'type'];

        // Move known HA root keys to payload
        haStandardKeys.forEach(key => {
            if (config[key]) payload[key] = config[key];
        });

        // Move all other "unknown" keys (like options, min, max, step, mode) to attributes
        // so the python platforms can access them.
        Object.keys(config).forEach(key => {
            if (!haStandardKeys.includes(key) && !internalKeys.includes(key)) {
                payload.attributes[key] = config[key];
            }
        });

        if (resolvedAreaId) payload.area_id = resolvedAreaId;
        if (resolvedLabels.length > 0) payload.labels = resolvedLabels;

        // Smart Device Linking
        if (config.device === 'system') {
            payload.device_info = {
                identifiers: [['js_automations', 'jsa_system_device']],
                name: "JS Automations",
                manufacturer: "JS Automations",
                model: "System",
            };
        } else if (config.device === 'none') {
            delete payload.device_info;
        } else if (!payload.device_info) {
            // Default: 'script'
            const scriptName = path.basename(scriptMeta.filename, path.extname(scriptMeta.filename));
            payload.device_info = {
                identifiers: [['js_automations', `jsa_script_${scriptName}`]],
                name: scriptMeta.name || scriptName,
                manufacturer: "JS Automations",
                model: "Script",
            };
        }

        return payload;
    }

    /**
     * Sends a message to all running workers.
     */
    broadcastToWorkers(payload, exceptWorker = null) {
        for (const worker of this.workers.values()) {
            if (worker === exceptWorker) continue;
            worker.postMessage(payload);
        }
    }

    /**
     * Routes state changes from HA to interested workers.
     */
    dispatchStateChange(entityId, newState, oldState) {
        for (const [filename, patterns] of this.subscriptions) {
            const worker = this.workers.get(filename);
            if (!worker) continue;

            const isMatched = patterns.some(p => this.matches(entityId, p));
            if (isMatched) {
                worker.postMessage({ type: 'ha_event', entity_id: entityId, state: newState, old_state: oldState });
            }
            
            // Always sync the local cache of every worker
            worker.postMessage({ type: 'state_update', entity_id: entityId, state: newState });
        }
    }

    /**
     * Helper for wildcard/regex/string matching.
     */
    matches(entityId, pattern) {
        if (typeof pattern === 'string') {
            if (pattern === entityId) return true;
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                return regex.test(entityId);
            }
        }
        if (Array.isArray(pattern)) return pattern.includes(entityId);
        if (pattern instanceof RegExp || (typeof pattern === 'object' && pattern.source)) {
            const r = pattern instanceof RegExp ? pattern : new RegExp(pattern.source, pattern.flags);
            return r.test(entityId);
        }
        return false;
    }

    /**
     * Stops a script gracefully.
     */
    stopScript(filename, reason = "stopped by user") {
        const worker = this.workers.get(filename);
        if (worker) {
            this.stopReasons.set(filename, reason);
            this.stats.delete(filename);
            this.startTimes.delete(filename);
            // this.restartTracker.delete(filename); // Der Reset des Zählers wird nun im 'script_exit'-Event in server.js gehandhabt.
            // 1. Try graceful shutdown
            worker.postMessage({ type: 'stop_request' });
            // 2. Force terminate after 2 seconds if still alive
            setTimeout(() => {
                if (this.workers.get(filename) === worker) {
                    worker.terminate();
                }
            }, 2000);
        }
    }

    /**
     * Fährt den Manager herunter, speichert ausstehende Daten und stoppt Worker.
     */
    shutdown() {
        // 1. Force Save Registry wenn Timer läuft
        if (this.saveRegistryTimer) {
            clearTimeout(this.saveRegistryTimer);
            this.emit('log', { source: 'System', message: `[WorkerManager] Force saving registry on shutdown...`, level: 'debug' });
            this._performSaveRegistry();
        }
        
        // 2. Alle Worker stoppen
        for (const filename of this.workers.keys()) {
            this.stopScript(filename, 'system shutdown');
        }
    }
}

module.exports = new WorkerManager();