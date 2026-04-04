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
        this.restartTracker = new Map(); // Tracks start times for loop protection
        this.startTimes = new Map();
        this.haConnector = null;
        this.mqttManager = null;
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
        this.nativeEntities = new Map(); // entityId -> Payload (Config)
        this.activeRunEntities = new Map(); // filename -> Set<entityId> (Mark-and-Sweep for current run)
        this.protectedEntities = new Map(); // filename -> Set<entityId> (from @expose headers)
        this.scriptEntityMap = new Map(); // filename -> Set<entityId> (RAM Cache)
        this.registryPath = '';
        this.saveRegistryTimer = null;
        this.pendingAsks = new Map(); // correlationId -> worker (for ha.ask())
        this._notificationListenerActive = false;

        // Request RAM usage statistics from all workers every 5 seconds.
        setInterval(() => this.broadcastToWorkers({ type: 'get_stats' }), 5000);
    }

    /**
     * Subscribes to HA mobile_app_notification_action events (lazy, once).
     * Called automatically on the first ha.ask() from any worker.
     * @private
     */
    _ensureNotificationListener() {
        if (this._notificationListenerActive || !this.haConnector) return;
        this._notificationListenerActive = true;

        this.haConnector.subscribeToEvents((event) => {
            if (event.event_type !== 'mobile_app_notification_action') return;
            const action = event.data?.action;
            if (!action || !action.includes('__jsa_ask__')) return;

            const sepIdx = action.lastIndexOf('__jsa_ask__');
            const correlationId = action.slice(sepIdx + '__jsa_ask__'.length);
            const originalAction = action.slice(0, sepIdx);

            const worker = this.pendingAsks.get(correlationId);
            if (!worker) return;

            this.pendingAsks.delete(correlationId);
            worker.postMessage({ type: 'ask_response', correlationId, action: originalAction });
        });
    }

    /**
     * Loads the persistent registry of dynamic entities from storage.
     */
    loadRegistry() {
        this.registryPath = path.join(this.storageDir, 'entity_registry.json');
        this.emit('log', { source: 'System', message: 'Loading entity registry...', level: 'debug' });
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
     * Performs the physical save operation of the registry.
     * @private
     */
    _performSaveRegistry() {
        if (!this.registryPath) return;
        try {
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

        // Debounce: Cancel existing timer and restart to protect disk
        if (this.saveRegistryTimer) clearTimeout(this.saveRegistryTimer);

        this.saveRegistryTimer = setTimeout(() => {
            this._performSaveRegistry();
            this.saveRegistryTimer = null;
        }, 1000); // Wait 1 second before saving
    }

    setConnector(connector) { 
        this.haConnector = connector; 
        if (connector) {
            // Automatically sync services once connected
            setTimeout(() => this.syncServiceDefinitions(), 3000);
        }
    }

    setMqttManager(manager) {
        this.mqttManager = manager;
    }

    /**
     * Fetches all available services from HA and generates a services.d.ts for IntelliSense.
     */
    async syncServiceDefinitions() {
        if (!this.haConnector || !this.haConnector.isReady) return;
        
        try {
            this.emit('log', { source: 'System', message: 'Syncing HA services...', level: 'debug' });
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
            
            this.emit('log', { source: 'System', message: `ServiceMap generated: ${Object.keys(services).length} domains mapped.`, level: 'debug' });
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
        if (this.mqttManager && this.mqttManager.isConnected) {
            this.emit('log', { source: 'System', message: `[WorkerManager] Removing entity ${entityId} via MQTT`, level: 'debug' });

            const domain = entityId.split('.')[0];
            const derivedObjectId = entityId.split('.').slice(1).join('.');
            // Clear discovery topics
            this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${derivedObjectId}/config`, '', { retain: true });
            if (payload?.unique_id && payload.unique_id !== derivedObjectId) {
                this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${payload.unique_id}/config`, '', { retain: true });
            }
            // Clear retained state/attributes topic (empty string = truly deletes the retained message)
            const stateTopic = payload?.state_topic || `jsa/${domain}/${derivedObjectId}/data`;
            this.mqttManager.publish(stateTopic, '', { retain: true });
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
     * Re-publishes all registered native entities to MQTT.
     * @param {boolean} onlyIfMissing - If true, existing entities are skipped (integrity check).
     */
    async republishNativeEntities(onlyIfMissing = false) {
        if (!this.mqttManager || !this.mqttManager.isConnected || this.nativeEntities.size === 0) return;
        
        let count = 0;
        const total = this.nativeEntities.size;
        
        if (!onlyIfMissing) {
            this.emit('log', { source: 'System', message: `Syncing ${total} native entities...`, level: 'debug' });
        }
        
        for (const [entityId, payload] of this.nativeEntities) {
            const domain = entityId.split('.')[0];
            const topicId = payload.object_id || payload.unique_id;
            const configTopic = `${this.mqttManager.discoveryPrefix}/${domain}/${topicId}/config`;

            // Integrity check for MQTT relies on checking local status, but since we use retained 
            // messages, we usually just republish everything on reconnect.
            if (onlyIfMissing) {
                // For MQTT, we could check if HA is online before skipping, but republishing is safer.
            }

            this.mqttManager.publish(configTopic, payload, { retain: true });
            
            // Also publish the last known state if available
            const stateObj = this.haConnector?.states[entityId];
            const currentStateValue = stateObj?.state;
            const currentAttributes = stateObj?.attributes;
            this.mqttManager.publishEntityState(payload, currentStateValue, currentAttributes);
            
            count++;
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
                if (this.mqttManager && this.mqttManager.isConnected) {
                    const domain = entityId.split('.')[0];
                    const derivedObjectId = entityId.split('.').slice(1).join('.');
                    // Clear discovery topics
                    this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${derivedObjectId}/config`, '', { retain: true });
                    if (payload?.unique_id && payload.unique_id !== derivedObjectId) {
                        this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${payload.unique_id}/config`, '', { retain: true });
                    }
                    // Clear retained state/attributes topic
                    const stateTopic = payload?.state_topic || `jsa/${domain}/${derivedObjectId}/data`;
                    this.mqttManager.publish(stateTopic, '', { retain: true });
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
                if (this.mqttManager && this.mqttManager.isConnected) {
                    const domain = entityId.split('.')[0];
                    const derivedObjectId = entityId.split('.').slice(1).join('.');
                    // Clear discovery topics
                    this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${derivedObjectId}/config`, '', { retain: true });
                    if (payload?.unique_id && payload.unique_id !== derivedObjectId) {
                        this.mqttManager.publish(`${this.mqttManager.discoveryPrefix}/${domain}/${payload.unique_id}/config`, '', { retain: true });
                    }
                    // Clear retained state/attributes topic
                    const stateTopic = payload?.state_topic || `jsa/${domain}/${derivedObjectId}/data`;
                    this.mqttManager.publish(stateTopic, '', { retain: true });
                }
                this.nativeEntities.delete(entityId);
                knownEntities.delete(entityId);

                // Notify EntityManager to also remove from HA's WebSocket registry
                this.emit('sweep_entity_removed', entityId);
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
        // Only keep starts from the last 60 seconds
        const recentRestarts = restarts.filter(t => now - t < this.settings.restart_protection_time);
        
        if (recentRestarts.length >= this.settings.restart_protection_count) {
            this.emit('log', { source: 'System', message: `🛑 Script '${name}' stopped due to excessive restart rate (>${this.settings.restart_protection_count} restarts in ${this.settings.restart_protection_time / 1000}s).`, level: 'error' });
            this.lastExitState.set(scriptId, 'error');
            return; // Abort start
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
                    this.emit('log', { source: name, message: msg.message, level: msg.level || 'info' });
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

                if (msg.type === 'update_state') {
                    // Relay update event to EntityManager for MQTT handling
                    this.emit('update_entity_state', { entityId: msg.entityId, state: msg.state, attributes: msg.attributes });

                    // CLEANUP RELIC: REST Fallback for legacy entities.
                    // This is only used for entities created by the old custom integration bridge.
                    // Note: This logic can be removed once all existing entities have been 
                    // migrated/purged to the MQTT registry.
                    if (!this.nativeEntities.has(msg.entityId) && this.haConnector?.isReady) {
                        this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
                    }
                }
                
                if (msg.type === 'create_entity') {
                    this.emit('log', { source: 'System', message: `[WorkerManager] Received ha.register for '${msg.entityId}' from ${name}`, level: 'debug' });
                    // Delegate to EntityManager via event
                    this.emit('create_entity', { filename: scriptMeta.filename, entityId: msg.entityId, config: msg.config });

                    if (this.activeRunEntities.has(scriptMeta.filename)) {
                        this.activeRunEntities.get(scriptMeta.filename).add(msg.entityId);
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

                // 5. ha.ask() — register a pending notification action listener
                if (msg.type === 'register_ask') {
                    this.pendingAsks.set(msg.correlationId, worker);
                    this._ensureNotificationListener();
                }

                // 6. Stats Response
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

                // Clean up any ha.ask() promises that will never resolve
                for (const [correlationId, askWorker] of this.pendingAsks.entries()) {
                    if (askWorker === worker) this.pendingAsks.delete(correlationId);
                }
                
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

        // Accelerate RAM measurement: Request directly after 1s (instead of waiting for 5s interval)
        setTimeout(() => {
            if (this.workers.has(scriptMeta.filename)) worker.postMessage({ type: 'get_stats' });
        }, 1000);
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
            // restartTracker reset is handled in the 'script_exit' event in server.js
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
     * Shuts down the manager, saves pending data, and stops all workers.
     */
    shutdown() {
        // 1. Force Save Registry if timer is running
        if (this.saveRegistryTimer) {
            clearTimeout(this.saveRegistryTimer);
            this.emit('log', { source: 'System', message: `[WorkerManager] Force saving registry on shutdown...`, level: 'debug' });
            this._performSaveRegistry();
        }
        
        // 2. Stop all workers
        for (const filename of this.workers.keys()) {
            this.stopScript(filename, 'system shutdown');
        }
    }
}

module.exports = new WorkerManager();