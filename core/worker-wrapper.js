/**
 * JS AUTOMATIONS - Worker Wrapper (v2.16.x)
 * Features: Local Cache, Sync Store, Graceful Shutdown, Global Libraries.
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
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

// Load built-in libraries
const axios = require('axios');
const cron = require('node-cron');

// Default: Allow thread to exit if nothing is happening
parentPort.unref();

// 🛡️ GLOBALER CRASH HANDLER
// Fängt Fehler ab, die das Skript sonst kommentarlos beenden würden.
process.on('uncaughtException', (err) => {
    if (parentPort) {
        parentPort.postMessage({
            type: 'log',
            level: 'error',
            source: 'System',
            message: `🔥 CRASH: ${err.message}\n${err.stack}`
        });
    } else {
        console.error("🔥 CRASH:", err);
    }
    // Kurze Pause, damit die Nachricht sicher über den Bus geht, dann beenden
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
    if (parentPort) parentPort.postMessage({ type: 'log', level: 'error', source: 'System', message: `⚠️ Unhandled Rejection: ${reason}` });
});

// --- 2. LOGGING LOGIC ---
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const scriptLevel = LOG_LEVELS[workerData.loglevel?.toLowerCase()] ?? 1;

const sendLog = (level, msg) => {
    if (LOG_LEVELS[level] >= scriptLevel) {
        parentPort.postMessage({ type: 'log', level, message: msg });
    }
};

// --- 3. CACHE & SYNC ---
const states = workerData.initialStates || {};
const storeValues = workerData.initialStore || {};
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

    /** Returns the raw array of state objects */
    toArray() { return this.list; }
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
            if (msg.state) states[msg.entity_id] = msg.state;
            else delete states[msg.entity_id];
        }

        // Real-time global store sync
        if (msg.type === 'store_update') {
            if (msg.value === undefined) delete storeValues[msg.key];
            else storeValues[msg.key] = msg.value;
        }

        // Handle ha.on() triggers
        if (msg.type === 'ha_event') {
            subscriptionCallbacks.forEach(sub => sub.callback({
                entity_id: msg.entity_id,
                state: msg.state.state,
                old_state: msg.old_state?.state,
                attributes: msg.state.attributes
            }));
        }

        // Handle master request to stop gracefully
        if (msg.type === 'stop_request') {
            for (const cb of stopCallbacks) {
                try { await cb(); } catch (e) { console.error("onStop Error:", e); }
            }
            process.exit(0);
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
    
    // Commands
    callService: (domain, service, data) => parentPort.postMessage({ type: 'call_service', domain, service, data }),
    updateState: (entityId, state, attributes = {}) => parentPort.postMessage({ type: 'update_state', entityId, state, attributes }),
    
    // Real-time Data
    states: states,

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
    
    on: (pattern, callback) => {
        parentPort.ref(); // Keep alive
        ensureMessageListener();
        parentPort.postMessage({ type: 'subscribe', pattern });
        subscriptionCallbacks.push({ pattern, callback });
    },
    
    onStop: (cb) => {
        ensureMessageListener();
        stopCallbacks.push(cb);
    },

    // Persistent Store
    store: {
        val: storeValues,
        set: (key, value) => {
            storeValues[key] = value;
            parentPort.postMessage({ type: 'store_set', key, value });
        },
        get: (key) => storeValues[key],
        delete: (key) => {
            delete storeValues[key];
            parentPort.postMessage({ type: 'store_delete', key });
        }
    }
};

// Injection
global.ha = ha;
global.axios = axios;
global.schedule = (exp, cb) => {
    parentPort.ref(); // Keep alive for cron
    ensureMessageListener();
    return cron.schedule(exp, cb);
};
global.sleep = (ms) => new Promise(res => setTimeout(res, ms));

// --- 5. EXECUTION ---
try {
    const scriptPath = require.resolve(workerData.path);
    delete require.cache[scriptPath]; // Avoid stale code
    require(scriptPath);
} catch (err) {
    ha.error(`Runtime Error: ${err.message}`);
    console.error(`[Worker Error] ${workerData.filename}:`, err);
    // Exit after a short delay to allow log delivery
    setTimeout(() => process.exit(1), 100);
}