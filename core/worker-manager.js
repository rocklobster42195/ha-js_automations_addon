/**
 * JS AUTOMATIONS - Worker Manager (v2.16.x)
 * Handles lifecycle, message routing, and event subscriptions.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const ScriptParser = require('./parser');

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
            restart_protection_time: 60000
        };
        this.subscriptions = new Map(); // filename -> patterns[]
        this.storageDir = ''; 
        this.scriptsDir = '';
        this.nativeEntities = new Map(); // Trackt Entitäten: entityId -> Payload (Config)
        this.scriptEntityMap = new Map(); // Trackt Zugehörigkeit: filename -> Set<entityId>

        // RAM Polling: Alle 5 Sekunden Stats von allen Workern anfordern
        setInterval(() => this.broadcastToWorkers({ type: 'get_stats' }), 5000);
    }

    setConnector(connector) { this.haConnector = connector; }
    setStore(store) { this.storeManager = store; }
    setSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.emit('log', { source: 'System', message: `Settings updated. Restart protection: ${this.settings.restart_protection_count} starts in ${this.settings.restart_protection_time / 1000}s.`, level: 'info' });
    }
    setStorageDir(dir) { this.storageDir = dir; }
    setScriptsDir(dir) { this.scriptsDir = dir; }

    getScripts() {
        if (!this.scriptsDir) return [];
        const results = [];
        
        // 1. Automations (Root)
        const files = fs.readdirSync(this.scriptsDir).filter(f => f.endsWith('.js'));
        results.push(...files.map(f => path.join(this.scriptsDir, f)));

        // 2. Libraries (Subfolder)
        const libDir = path.join(this.scriptsDir, 'libraries');
        if (fs.existsSync(libDir)) {
            const libs = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
            results.push(...libs.map(f => path.join(libDir, f)));
        }
        return results;
    }

    getScriptStats(filename) {
        return this.stats.get(filename);
    }

    /**
     * Sendet alle registrierten nativen Entitäten erneut an HA (z.B. nach Reconnect).
     */
    async republishNativeEntities() {
        if (!this.haConnector || this.nativeEntities.size === 0) return;
        this.emit('log', { source: 'System', message: `Republishing ${this.nativeEntities.size} native entities...`, level: 'info' });
        
        for (const [entityId, payload] of this.nativeEntities) {
            try {
                await this.haConnector.callService('js_automations', 'create_entity', payload);
            } catch (e) {
                this.emit('log', { source: 'System', message: `Failed to republish ${entityId}: ${e.message}`, level: 'warn' });
            }
        }
    }

    /**
     * Löscht alle nativen Entitäten, die von einem bestimmten Skript erstellt wurden.
     */
    async removeScriptEntities(filename) {
        if (!this.scriptEntityMap.has(filename)) return;
        
        const entities = this.scriptEntityMap.get(filename);
        this.emit('log', { source: 'System', message: `Cleaning up ${entities.size} native entities for deleted script: ${path.basename(filename)}`, level: 'info' });
        
        for (const entityId of entities) {
            const payload = this.nativeEntities.get(entityId);
            if (payload && payload.unique_id && this.haConnector) {
                try {
                    await this.haConnector.callService('js_automations', 'remove_entity', { unique_id: payload.unique_id });
                } catch (e) { /* Ignore errors during cleanup */ }
            }
            this.nativeEntities.delete(entityId);
        }
        this.scriptEntityMap.delete(filename);
    }

    /**
     * Starts a script in an isolated thread.
     */
    startScript(filename) {
        const fullPath = path.isAbsolute(filename) ? filename : path.join(this.scriptsDir, filename);
        if (!fs.existsSync(fullPath)) {
            this.emit('log', `[System] Script not found: ${filename}`, 'error');
            return;
        }

        const scriptMeta = ScriptParser.parse(fullPath);
        const { name } = scriptMeta;

        // --- SAFEGUARD: Excessive Restart Protection ---
        const now = Date.now();
        const restarts = this.restartTracker.get(scriptMeta.filename) || [];
        // Nur Starts der letzten 60 Sekunden behalten
        const recentRestarts = restarts.filter(t => now - t < this.settings.restart_protection_time);
        
        if (recentRestarts.length >= this.settings.restart_protection_count) {
            this.emit('log', { source: 'System', message: `🛑 Script '${name}' stopped due to excessive restart rate (>${this.settings.restart_protection_count} restarts in ${this.settings.restart_protection_time / 1000}s).`, level: 'error' });
            this.lastExitState.set(scriptMeta.filename, 'error');
            return; // Start abbrechen
        }
        recentRestarts.push(now);
        this.restartTracker.set(scriptMeta.filename, recentRestarts);
        
        // Restart if already running
        if (this.workers.has(scriptMeta.filename)) {
            this.stopScript(scriptMeta.filename, 'restarting');
        }

        this.lastExitState.delete(scriptMeta.filename);
        this.subscriptions.set(scriptMeta.filename, []);

        // Prepare initial data dump for the worker
        const initialStoreValues = {};
        if (this.storeManager) {
            for (let k in this.storeManager.data) {
                initialStoreValues[k] = this.storeManager.data[k].value;
            }
        }

        const worker = new Worker(path.join(__dirname, 'worker-wrapper.js'), {
            workerData: {
                ...scriptMeta,
                initialStates: this.haConnector ? this.haConnector.states : {},
                initialStore: initialStoreValues,
                storageDir: this.storageDir,
                loglevel: scriptMeta.loglevel || 'info'
            },
            env: { 
                ...process.env, 
                NODE_PATH: path.resolve(this.storageDir, 'node_modules') 
            }
        });

        worker.on('message', async (msg) => {
            // 1. Logging
            if (msg.type === 'log') {
                this.emit('log', { source: name, message: msg.message, level: msg.level });
            }
            
            // 2. Home Assistant Actions
            if (msg.type === 'call_service' && this.haConnector) {
                await this.haConnector.callService(msg.domain, msg.service, msg.data);
            }

            if (msg.type === 'update_state' && this.haConnector) {
                // Hybrid-Logik: Wenn nativ bekannt, nutze Service, sonst Legacy HTTP
                if (this.nativeEntities.has(msg.entityId)) {
                    const entityPayload = this.nativeEntities.get(msg.entityId);
                    const [domain] = msg.entityId.split('.');
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
                        // Wir löschen es hier nicht sofort, damit ein Republish noch möglich ist, falls es nur ein temporärer Fehler war
                        await this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
                    }
                } else {
                    await this.haConnector.updateState(msg.entityId, msg.state, msg.attributes);
                }
            }
            
            // 2b. Native Entity Creation (Integration)
            if (msg.type === 'create_entity' && this.haConnector) {
                const { entityId, config } = msg;

                this.emit('log', { source: 'System', message: `Creating native entity: ${entityId}`, level: 'debug' });

                // --- RESOLVE METADATA (Area & Labels) ---
                const { areas, labels } = await this.haConnector.getHAMetadata();
                
                const resolveId = (input, list, idField) => {
                    if (!input || typeof input !== 'string') return undefined;
                    const cleanInput = input.trim();
                    if (!cleanInput || !list) return undefined;
                    const lowerInput = cleanInput.toLowerCase();
                    // 1. ID Match
                    const directMatch = list.find(item => item[idField] === cleanInput);
                    if (directMatch) return directMatch[idField];
                    // 2. Name Match
                    const nameMatch = list.find(item => item.name && item.name.toLowerCase() === lowerInput);
                    return nameMatch ? nameMatch[idField] : undefined;
                };

                // Area auflösen (unterstützt config.area_id und config.area)
                let resolvedAreaId = config.area_id;
                if (!resolvedAreaId && config.area) {
                    resolvedAreaId = resolveId(config.area, areas, 'area_id');
                    if (!resolvedAreaId) this.emit('log', { source: 'System', message: `⚠️ Could not resolve Area '${config.area}' for ${entityId}`, level: 'warn' });
                }

                // Labels auflösen (unterstützt Namen und IDs gemischt)
                let resolvedLabels = [];
                if (config.labels && Array.isArray(config.labels)) {
                    resolvedLabels = config.labels.map(l => {
                        const id = resolveId(l, labels, 'label_id');
                        if (!id) this.emit('log', { source: 'System', message: `⚠️ Could not resolve Label '${l}' for ${entityId}`, level: 'warn' });
                        return id;
                    }).filter(id => id);
                }

                const payload = {
                    entity_id: entityId,
                    unique_id: config.unique_id || entityId,
                    name: config.name || config.friendly_name || entityId,
                    icon: config.icon,
                    attributes: config.attributes || {}
                };
                
                // FIX: state direkt an create_entity übergeben (Schema erwartet 'state')
                if (config.initial_state !== undefined) {
                    payload.state = config.initial_state;
                }
                
                // Map common attributes to payload.attributes
                // Map common attributes to the top-level payload for the integration
                // NOTE: area_id und labels behandeln wir separat oben
                ['unit_of_measurement', 'device_class', 'state_class', 'entity_picture', 'device_info'].forEach(key => {
                    if (config[key]) payload[key] = config[key];
                });

                if (resolvedAreaId) payload.area_id = resolvedAreaId;
                if (resolvedLabels.length > 0) payload.labels = resolvedLabels;

                // AUTO-INJECT DEVICE INFO if missing
                // Damit landen Sensoren automatisch im Gerät des Skripts
                if (!payload.device_info) {
                    const scriptName = path.basename(scriptMeta.filename, '.js');
                    payload.device_info = {
                        identifiers: [`js_automations_script_${scriptName}`],
                        name: scriptMeta.name || scriptName,
                        manufacturer: "JS Automations",
                        model: "Script",
                    };
                }

                try {
                    // Wir senden den Befehl und warten nicht auf eine Antwort, aber fangen Fehler ab.
                    await this.haConnector.callService('js_automations', 'create_entity', payload);
                    this.nativeEntities.set(entityId, payload);
                    
                    // Track ownership for cleanup
                    if (!this.scriptEntityMap.has(scriptMeta.filename)) {
                        this.scriptEntityMap.set(scriptMeta.filename, new Set());
                    }
                    this.scriptEntityMap.get(scriptMeta.filename).add(entityId);

                    this.emit('log', { source: 'System', message: `Successfully sent registration for ${entityId}`, level: 'debug' });
                } catch (e) {
                    // Dieser Fehler wird geworfen, wenn die Integration nicht da ist oder der Payload falsch ist.
                    let errorMsg = `Failed to create native entity ${entityId}: ${e.message}`;
                    if (e.message && (e.message.includes('not found') || e.message.includes('Unable to find service'))) {
                        errorMsg += " -> Check if 'js_automations' integration is installed and HA is restarted.";
                    }
                    this.emit('log', { source: 'System', message: errorMsg, level: 'error' });
                }
            }

            // 3. Subscriptions (ha.on)
            if (msg.type === 'subscribe') {
                this.subscriptions.get(scriptMeta.filename).push(msg.pattern);
            }

            // 4. Store Operations
            if (msg.type === 'store_set' && this.storeManager) {
                // DEDUPLICATION: Nur senden, wenn sich der Wert wirklich geändert hat
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
                    // Kurze Verzögerung für Cleanup, dann Neustart
                    // Wir nutzen fullPath aus dem Scope von startScript
                    setTimeout(() => this.startScript(fullPath), 500);
                }
            }
        });

        worker.on('error', (err) => {
            this.emit('log', `[${name}] ❌ CRITICAL: ${err.message}`, 'error');
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
}

module.exports = new WorkerManager();