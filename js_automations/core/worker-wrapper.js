/**
 * JS AUTOMATIONS - Worker Wrapper (v2.16.x)
 * Features: Local Cache, Sync Store, Graceful Shutdown, Global Libraries.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const Module = require('module');

// --- 1. MODULE PATH INJECTION ---
if (workerData.storageDir) {
    const nodeModulesPath = path.resolve(workerData.storageDir, 'node_modules');
    // Inject into global search paths
    Module.globalPaths.push(nodeModulesPath);
    module.paths.unshift(nodeModulesPath);
    process.env.NODE_PATH = nodeModulesPath;
    // Force Node.js to re-evaluate paths
    if (typeof Module._initPaths === 'function') {
        Module._initPaths();
    }
}

// --- AXIOS MONKEY-PATCH ---
// This ensures that any script `require('axios')` gets the proper defaults
// to prevent the worker process from hanging.
const originalRequire = Module.prototype.require;
Module.prototype.require = function(requestPath) {
  const requiredModule = originalRequire.apply(this, arguments);
  if (requestPath === 'axios') {
    try {
        const http = require('http');
        const https = require('https');
        requiredModule.defaults.httpAgent = new http.Agent({ keepAlive: false });
        requiredModule.defaults.httpsAgent = new https.Agent({ keepAlive: false });
        if (!requiredModule.defaults.headers.common) requiredModule.defaults.headers.common = {};
        requiredModule.defaults.headers.common['Connection'] = 'close';
    } catch(e) {
        // This could happen if http/https are not available, though unlikely.
        console.error("[Worker] Failed to apply essential defaults to axios:", e);
    }
  }
  return requiredModule;
};

// Default: Allow thread to exit if nothing is happening
parentPort.unref();

// 🛡️ GLOBALER CRASH HANDLER
// Fängt Fehler ab, die das Skript sonst kommentarlos beenden würden.
process.on('uncaughtException', (err) => {
    if (parentPort) {
        parentPort.postMessage({
            type: 'log',
            level: 'error',
            source: workerData.name || 'System',
            message: `🔥 CRASH: ${err.message}\n${err.stack}`
        });
    } else {
        console.error("🔥 CRASH:", err);
    }
    // Kurze Pause, damit die Nachricht sicher über den Bus geht, dann beenden
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
    if (parentPort) parentPort.postMessage({ type: 'log', level: 'error', source: workerData.name || 'System', message: `⚠️ Unhandled Rejection: ${reason}` });
});

// 🛡️ GLOBALER SIGNAL HANDLER
// Fängt SIGTERM (Stop-Signal) ab und beendet mit Code 0 statt 143.
process.on('SIGTERM', () => {
    process.exit(0);
});

// --- 2. LOGGING LOGIC ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        let finalMessage = msg;
        if (msg instanceof Error) {
            finalMessage = msg.stack || msg.toString();
        } else if (typeof msg === 'object' && msg !== null) {
            try {
                // Pretty-print for better readability in logs
                finalMessage = JSON.stringify(msg, null, 2);
            } catch (e) {
                finalMessage = '[Unserializable Object]';
            }
        }
        parentPort.postMessage({ type: 'log', level, message: String(finalMessage) });
    }
};

// --- 3. CACHE & SYNC ---
// Deep copy initialStates to prevent any potential shared references or mutation issues
// This ensures the worker's state cache is truly isolated.
const states = JSON.parse(JSON.stringify(workerData.initialStates || {}));

const storeValues = workerData.initialStore || {};
const storeListeners = {};
const subscriptionCallbacks = [];
const stopCallbacks = [];
let isListening = false;

/**
 * EntitySelector Class for bulk actions
 */
class EntitySelector {
    constructor(entities, parentHa) {
        this.list = entities; // Array of HA State objects
        this.ha = parentHa;
    }

    /** Returns the number of entities in the current selection */
    get count() { return this.list.length; }

    /** Filters the current selection using a callback function */
    where(callback) {
        return new EntitySelector(this.list.filter(callback), this.ha);
    }

    /** Executes a function for each entity in the selection */
    each(callback) {
        this.list.forEach(callback);
        return this;
    }

    /** Calls a service for all entities in the selection */
    call(service, data = {}) {
        this.list.forEach(entity => {
            const domain = entity.entity_id.split('.')[0];
            this.ha.callService(domain, service, { ...data, entity_id: entity.entity_id });
        });
        return this;
    }

    /** Shortcut to turn all selected entities ON */
    turnOn(data = {}) { return this.call('turn_on', data); }

    /** Shortcut to turn all selected entities OFF */
    turnOff(data = {}) { return this.call('turn_off', data); }

    /** Expands groups to their members */
    expand() {
        const expanded = new Map();
        this.list.forEach(entity => {
            const members = entity.attributes?.entity_id;
            if (Array.isArray(members) && members.length > 0) {
                members.forEach(mid => {
                    const mState = this.ha.states[mid];
                    if (mState) expanded.set(mid, mState);
                });
            } else {
                expanded.set(entity.entity_id, entity);
            }
        });
        return new EntitySelector(Array.from(expanded.values()), this.ha);
    }

    /** Returns the raw array of state objects */
    toArray() { return this.list; }
}

/** Helper: Checks if an entity ID matches a pattern (String, Wildcard, Array, RegExp) */
function matches(entityId, pattern) {
    if (typeof pattern === 'string') {
        if (pattern === entityId) return true;
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            return regex.test(entityId);
        }
        return false;
    }
    if (Array.isArray(pattern)) return pattern.includes(entityId);
    if (pattern instanceof RegExp) return pattern.test(entityId);
    return false;
}

/**
 * Ensures the worker is listening for updates from the master.
 */
function ensureMessageListener() {
    if (isListening) return;
    isListening = true;

    parentPort.on('message', async (msg) => {
        // Real-time state cache sync
        if (msg.type === 'state_update') {
            if (msg.state) {
                // Deep clone the incoming state to ensure no external references are held
                // and to create a truly independent object for the worker's cache.
                states[msg.entity_id] = JSON.parse(JSON.stringify(msg.state));
            } else { // msg.state is null or undefined, so delete the entity
                delete states[msg.entity_id];
            }
        }

        // Real-time global store sync
        if (msg.type === 'store_update') {
            const oldValue = storeValues[msg.key];
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;

            if (storeListeners[msg.key]) {
                storeListeners[msg.key].forEach(cb => {
                    try { cb(msg.value, oldValue); } catch (e) { console.error(`Store Listener Error (${msg.key}):`, e); }
                });
            }
        }

        // Handle ha.on() triggers
        if (msg.type === 'ha_event') {
            // FIX: Update cache immediately so ha.states is current in the callback
            if (msg.state) states[msg.entity_id] = JSON.parse(JSON.stringify(msg.state));

            subscriptionCallbacks.forEach(sub => {
                // 1. Check Pattern Match
                if (!matches(msg.entity_id, sub.pattern)) return;

                // 2. Check Filter Logic (if present)
                if (sub.filter && sub.filter !== 'any') {
                    const valNew = msg.state?.state;
                    const valOld = msg.old_state?.state;
                    
                    // Helper for numeric conversion
                    const nNew = parseFloat(valNew);
                    const nOld = parseFloat(valOld);
                    // Check if values are valid numbers for numeric comparisons
                    const isNum = !isNaN(nNew) && (sub.threshold === undefined ? !isNaN(nOld) : true);
                    
                    // Determine comparison value (Threshold or Old Value)
                    const compVal = sub.threshold !== undefined ? parseFloat(sub.threshold) : nOld;
                    const compValStr = sub.threshold !== undefined ? String(sub.threshold) : valOld;

                    let match = false;
                    switch (sub.filter) {
                        case 'ne': match = sub.threshold !== undefined ? valNew != compValStr : valNew !== valOld; break;
                        case 'eq': match = sub.threshold !== undefined ? valNew == compValStr : valNew === valOld; break;
                        case 'gt': match = isNum && nNew > compVal; break;
                        case 'ge': match = isNum && nNew >= compVal; break;
                        case 'lt': match = isNum && nNew < compVal; break;
                        case 'le': match = isNum && nNew <= compVal; break;
                    }
                    if (!match) return;
                }

                sub.callback({
                    entity_id: msg.entity_id,
                    state: msg.state.state,
                    old_state: msg.old_state?.state,
                    attributes: msg.state.attributes
                });
            });
        }

        // Handle master request to stop gracefully
        if (msg.type === 'stop_request') {
            for (const cb of stopCallbacks) {
                try { await cb(); } catch (e) { console.error("onStop Error:", e); }
            }
            process.exit(0);
        }

        // Handle stats request
        if (msg.type === 'get_stats') {
            const mem = process.memoryUsage();
            parentPort.postMessage({
                type: 'stats',
                heapUsed: mem.heapUsed,
                rss: mem.rss
            });
        }
    });
}

// --- 4. THE GLOBAL API ---
const ha = {
    // Logging
    debug: (m) => sendLog('debug', m),
    log: (m) => sendLog('info', m),
    warn: (m) => sendLog('warn', m),
    error: (m) => sendLog('error', m),
    stop: (reason) => parentPort.postMessage({ type: 'script_lifecycle', action: 'stop', reason }),
    restart: (reason) => parentPort.postMessage({ type: 'script_lifecycle', action: 'restart', reason }),
    
    // Commands
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),
    
    update: (entityId, arg2, arg3) => {
        let state = arg2;
        let attributes = arg3;

        // Overload: ha.update(id, { attributes }) -> Keep current state
        if (attributes === undefined && typeof arg2 === 'object' && arg2 !== null && !Array.isArray(arg2)) {
            const current = states[entityId];
            state = current ? current.state : undefined;
            attributes = arg2;
        }

        // ALIAS: name -> friendly_name (für Konsistenz mit ha.register)
        if (attributes && attributes.name && !attributes.friendly_name) {
            attributes = { ...attributes, friendly_name: attributes.name };
            delete attributes.name;
        }

        // ALIAS: unit -> unit_of_measurement
        if (attributes && attributes.unit && !attributes.unit_of_measurement) {
            attributes = { ...attributes, unit_of_measurement: attributes.unit };
            delete attributes.unit;
        }

        parentPort.postMessage({ type: 'update_state', entityId, state, attributes: attributes || {} });
    },
    
    /**
     * Registriert eine native Home Assistant Entität (via Integration).
     * Erstellt sie neu oder aktualisiert die Konfiguration, falls vorhanden.
     * @param {string} entityId - Die gewünschte Entity ID (z.B. 'sensor.mein_wert')
     * @param {object} config - Konfiguration (name, icon, type, unit_of_measurement, etc.)
     */
    register: (entityId, config = {}) => {
        // ALIAS: unit -> unit_of_measurement
        if (config.unit && !config.unit_of_measurement) {
            config = { ...config, unit_of_measurement: config.unit };
            delete config.unit;
        }
        // Wir senden den Intent an den Hauptprozess, der entscheidet (Integration vs. Legacy)
        parentPort.postMessage({ type: 'create_entity', entityId, config });
    },
    
    // Real-time Data
    states: states,
    getState: (entityId) => states[entityId],
    getAttr: (entityId, attr) => states[entityId]?.attributes?.[attr],
    getStateValue: (entityId) => {
        const val = states[entityId]?.state;
        if (val === undefined) return undefined;
        if (val === 'on') return true;
        if (val === 'off') return false;
        const num = Number(val);
        if (!isNaN(num) && val.trim() !== '') return num;
        return val;
    },
    getGroupMembers: (entityId) => {
        const s = states[entityId];
        return (s && Array.isArray(s.attributes?.entity_id)) ? s.attributes.entity_id : [];
    },
    
    /**
     * Liest einen Wert aus dem Skript-Header.
     */
    getHeader: (key, defaultValue) => {
        if (!key) return defaultValue;
        const k = key.toLowerCase();
        const val = workerData[k];
        return val !== undefined ? val : defaultValue;
    },

    select: (pattern) => {
        const allIds = Object.keys(states);
        let matchedIds = [];

        if (typeof pattern === 'string') {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                matchedIds = allIds.filter(id => regex.test(id));
            } else {
                matchedIds = allIds.filter(id => id === pattern);
            }
        } else if (pattern instanceof RegExp) {
            matchedIds = allIds.filter(id => pattern.test(id));
        } else if (Array.isArray(pattern)) {
            matchedIds = allIds.filter(id => pattern.includes(id));
        }

        const matchedStates = matchedIds.map(id => states[id]);
        return new EntitySelector(matchedStates, ha);
    },
    
    on: (pattern, arg2, arg3, arg4) => {
        parentPort.ref(); // Keep alive
        ensureMessageListener();
        parentPort.postMessage({ type: 'subscribe', pattern });
        
        let callback, filter, threshold;
        if (typeof arg2 === 'function') {
            callback = arg2;
        } else if (typeof arg3 === 'function') {
            filter = arg2;
            callback = arg3;
        } else {
            filter = arg2;
            threshold = arg3;
            callback = arg4;
        }
        subscriptionCallbacks.push({ pattern, callback, filter, threshold });
    },
    
    onStop: (cb) => {
        ensureMessageListener();
        stopCallbacks.push(cb);
    },

    // Persistent Store
    store: {
        val: storeValues,
        set: (key, value, isSecret = false) => {
            storeValues[key] = value;
            parentPort.postMessage({ type: 'store_set', key, value, isSecret });
        },
        get: (key) => storeValues[key],
        delete: (key) => {
            delete storeValues[key];
            parentPort.postMessage({ type: 'store_delete', key });
        },
        on: (key, cb) => {
            if (typeof cb !== 'function') return;
            if (!storeListeners[key]) storeListeners[key] = [];
            storeListeners[key].push(cb);
            parentPort.ref(); // Keep process alive
            ensureMessageListener();
        }
    }
};

// Injection
global.ha = ha;

global.schedule = (exp, cb) => {
    parentPort.ref(); // Keep alive for cron
    ensureMessageListener();
    // Lazy Load Cron only when used
    return require('node-cron').schedule(exp, cb);
};
global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- 5. LIBRARY INJECTION ---
function loadLibraries() {
    const scriptPath = workerData.path;
    try {
        // 1. Skript-Inhalt lesen, um Header zu parsen
        const content = fs.readFileSync(scriptPath, 'utf8');
        
        // 2. Alle @include Tags finden (unterstützt mehrere Zeilen und Komma-Trennung)
        // Matches: @include lib1.js, lib2.js
        const includeMatches = content.matchAll(/@include\s+(.+)/g);
        const librariesToLoad = new Set();

        for (const match of includeMatches) {
            match[1].split(',').forEach(lib => {
                const cleanName = lib.trim();
                if (cleanName) librariesToLoad.add(cleanName);
            });
        }

        // 3. Libraries laden und ausführen
        if (librariesToLoad.size > 0) {
            // Wir gehen davon aus, dass der 'libraries' Ordner im selben Verzeichnis liegt
            const libDir = path.join(path.dirname(scriptPath), 'libraries');
            
            librariesToLoad.forEach(libName => {
                // .js Endung sicherstellen
                if (!libName.endsWith('.js')) libName += '.js';
                
                const libPath = path.join(libDir, libName);
                
                if (fs.existsSync(libPath)) {
                    const libCode = fs.readFileSync(libPath, 'utf8');
                    // Führt den Code im globalen Kontext dieses Workers aus
                    vm.runInThisContext(libCode, { filename: libPath });
                } else {
                    ha.warn(`Library not found: ${libName} (checked in ${libDir})`);
                }
            });
        }
    } catch (e) {
        ha.error(`Library Injection Error: ${e.message}`);
    }
}

// --- 6. EXECUTION ---
try {
    loadLibraries(); // Zuerst Libraries laden
    const scriptPath = require.resolve(workerData.path);
    delete require.cache[scriptPath]; // Avoid stale code
    require(scriptPath);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
    console.error(`[Worker Error] ${workerData.filename}:`, err);
    // Exit after a short delay to allow log delivery
    setTimeout(() => process.exit(1), 100);
}